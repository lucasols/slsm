/* eslint-disable @ls-stack/require-description -- will be handled later */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { isFunction } from '@lucasols/utils/assertions';
import { sortBy } from '@lucasols/utils/arrayUtils';
import { klona } from 'klona';
import { RcType, rc_parse_json } from 'runcheck';
import { Store } from 't-state';

type ItemOptions<V> = {
  schema: RcType<V>;
  default: V;
  syncTabsState?: boolean;
  /**
   * if storage is full, the item with the lowest priority will be removed first to free up space
   * @default 0
   */
  priority?: number;
  ignoreSessionId?: boolean;
  useSessionStorage?: boolean;
  autoPrune?: (value: V) => V;
};

type SmartLocalStorageOptions<Schemas extends Record<string, unknown>> = {
  getSessionId?: () => string | false;
  items: {
    [K in keyof Schemas]: ItemOptions<Schemas[K]>;
  };
};

type ValueOrSetter<T> = T | ((currentValue: T) => T);

type SmartLocalStorage<Schemas extends Record<string, unknown>> = {
  set: <K extends keyof Schemas>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ) => void;
  setUnknownValue: (key: string, value: unknown) => void;
  get: <K extends keyof Schemas>(key: K) => Schemas[K];
  produce: <K extends keyof Schemas>(
    key: K,
    fn: (draft: Schemas[K]) => void | Schemas[K],
  ) => void;

  delete: <K extends keyof Schemas>(key: K) => void;

  clearAll: () => void;
  clearAllBy: (clearBy: {
    sessionId?: string;
    allSessionIds?: boolean;
    withNoSessionId?: boolean;
  }) => void;
  useKey: <K extends keyof Schemas>(key: K) => Readonly<Schemas[K]>;
  useKeyWithSelector: <K extends keyof Schemas>(
    key: K,
  ) => <S>(selector: (value: Schemas[K]) => S) => S;
  getStore: <K extends keyof Schemas>(key: K) => Store<Schemas[K]>;
};

export function createSmartLocalStorage<
  Schemas extends Record<string, unknown>,
>({
  getSessionId = () => '',
  items,
}: SmartLocalStorageOptions<Schemas>): SmartLocalStorage<Schemas> {
  const IS_BROWSER = typeof window !== 'undefined';

  type Items = keyof Schemas;

  if (IS_BROWSER) {
    requestIdleCallback(() => {
      function cleanStorage(storage: Storage) {
        for (const storageKey of getStorageItemKeys(storage)) {
          const itemKey = storageKey.split('||')[1];

          if (itemKey) {
            const isConfigured = !!items[itemKey];

            if (!isConfigured) {
              localStorage.removeItem(storageKey);
            }
          }
        }
      }

      cleanStorage(localStorage);
      cleanStorage(sessionStorage);
    });
  }

  function getItemStorage(key: Items) {
    return items[key].useSessionStorage ? sessionStorage : localStorage;
  }

  function getLocalStorageItemKey(key: Items) {
    const itemOptions = items[key];

    const usesDefaultSessionId = itemOptions.ignoreSessionId;

    const sessionId = usesDefaultSessionId ? '' : getSessionId();

    if (sessionId === false) return false;

    return `slsm${sessionId ? `-${sessionId}` : ''}${
      itemOptions.useSessionStorage ? '|s' : ''
    }||${String(key)}`;
  }

  function getInitialValue<K extends Items>(key: K): Schemas[K] | undefined {
    if (!IS_BROWSER) return undefined;

    const itemKey = getLocalStorageItemKey(key);
    if (!itemKey) return undefined;

    const itemStorage = getItemStorage(key);
    const itemValue = itemStorage.getItem(itemKey);

    if (itemValue === null) return undefined;

    const itemOptions = items[key];
    const validationResult = rc_parse_json(itemValue, itemOptions.schema);

    if (validationResult.errors) {
      console.error('[slsm] error parsing value', validationResult.errors);
      return undefined;
    }

    return validationResult.value;
  }

  // Create stores keyed by storage key (includes session ID) to handle session changes
  const itemStores = new Map<string, Store<any>>();

  function getStore<K extends Items>(key: K): Store<Schemas[K]> {
    const storageKey = getLocalStorageItemKey(key);
    if (!storageKey) {
      // Return a temporary store with default value if session ID is false
      return new Store<Schemas[K]>({ state: items[key].default });
    }

    let store = itemStores.get(storageKey) as Store<Schemas[K]> | undefined;
    if (!store) {
      // Initialize store with value from storage or default value
      const valueFromStorage = getInitialValue(key);
      store = new Store<Schemas[K]>({
        state: valueFromStorage ?? items[key].default,
      });
      itemStores.set(storageKey, store);
    }

    return store;
  }

  function deleteItemByStorageKey(storageKey: string, key?: Items) {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);

    // Reset to default value if we know the key
    if (key) {
      const store = getStore(key);
      const itemOptions = items[key];
      store.setState(itemOptions.default);
    }
  }

  function handleQuotaExceeded(
    storageKey: string,
    operation: () => void,
    error: DOMException,
  ): void {
    function tryOperation() {
      try {
        operation();
        return true;
      } catch (retryError) {
        if (
          retryError instanceof DOMException &&
          retryError.name === 'QuotaExceededError'
        ) {
          return false;
        }
        throw retryError;
      }
    }

    // Try removing all session storage items first
    const sessionStorageKeys = getStorageItemKeys(sessionStorage, storageKey);

    if (sessionStorageKeys.length !== 0) {
      for (const itemKey of sessionStorageKeys) {
        deleteItemByStorageKey(itemKey);
      }

      if (tryOperation()) return;
    }

    // If still failing, remove localStorage items based on priority
    const currentSessionId = getSessionId();

    function getItemPriority(itemStorageKey: string): number {
      const itemKey = itemStorageKey.split('||')[1] as Items | undefined;
      if (!itemKey) return 0;
      return items[itemKey].priority ?? 0;
    }

    function sortByPriorityAndSize(storageKeys: string[]) {
      return sortBy(storageKeys, (key) => {
        const priority = getItemPriority(key);
        const size = localStorage.getItem(key)?.length ?? 0;
        // Lower priority first, larger size first (negate for descending)
        return [priority, -size];
      });
    }

    // Keep removing items until operation succeeds or we run out of items
    while (true) {
      const localStorageKeys = getStorageItemKeys(localStorage, storageKey);

      if (localStorageKeys.length === 0) break;

      // Try to remove from different sessions first (sorted by priority)
      const itemsInDifferentSessions = localStorageKeys.filter(
        (itemKey) =>
          !itemKey.startsWith(`slsm-${currentSessionId}`) &&
          !itemKey.startsWith(`slsm|`),
      );

      const sortedDifferentSessions = sortByPriorityAndSize(
        itemsInDifferentSessions,
      );

      const firstDifferentSession = sortedDifferentSessions[0];
      if (firstDifferentSession) {
        localStorage.removeItem(firstDifferentSession);
        if (tryOperation()) return;
        continue;
      }

      // Remove from current session as last resort (sorted by priority)
      const sortedCurrentSession = sortByPriorityAndSize(localStorageKeys);

      const firstCurrentSession = sortedCurrentSession[0];
      if (firstCurrentSession) {
        localStorage.removeItem(firstCurrentSession);
        if (tryOperation()) return;
      } else {
        break;
      }
    }

    // Could not free up enough space
    throw error;
  }

  // Centralized function to write value to storage with quota handling
  function writeToStorage(storageKey: string, value: any, storage: Storage) {
    function write() {
      storage.setItem(storageKey, JSON.stringify(value));
    }

    if (!IS_BROWSER) return;

    try {
      write();
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        handleQuotaExceeded(storageKey, write, error);
      } else {
        throw error;
      }
    }
  }

  // Update store state and persist to storage
  function updateItem<K extends Items>(
    key: K,
    value: Schemas[K],
    storageKey: string,
  ) {
    const store = getStore(key);
    store.setState(klona(value));

    const itemStorage = getItemStorage(key);
    writeToStorage(storageKey, value, itemStorage);
  }

  function setItemValue<K extends Items>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ): void {
    const storageKey = getLocalStorageItemKey(key);
    if (!storageKey) return;

    const itemOptions = items[key];
    const store = getStore(key);

    let finalValue = isFunction(value) ? value(store.state) : value;

    if (itemOptions.autoPrune) {
      finalValue = itemOptions.autoPrune(finalValue);
    }

    updateItem(key, finalValue, storageKey);
  }

  if (IS_BROWSER) {
    globalThis.addEventListener('storage', (event) => {
      if (!event.key?.startsWith('slsm')) return;

      const storageKey = event.key;

      // Extract the item key from storage key (format: slsm[-sessionId][|s]||itemKey)
      const itemKey = storageKey.split('||')[1] as Items | undefined;
      if (!itemKey) return;

      const itemOptions = items[itemKey];
      if (!itemOptions.syncTabsState) return;

      const store = getStore(itemKey);

      if (event.newValue === null) {
        // Reset to default value
        store.setState(itemOptions.default);
        return;
      }

      const validationResult = rc_parse_json(
        event.newValue,
        itemOptions.schema,
      );

      if (validationResult.errors) {
        console.error('[slsm] error parsing value', validationResult.errors);
        return;
      }

      store.setState(validationResult.value);
    });
  }

  function getValue<K extends Items>(key: K): Schemas[K] {
    return getStore(key).state;
  }

  function setUnknownValue(key: string, value: unknown) {
    const itemOptions = items[key];
    if (itemOptions) {
      const validationResult = itemOptions.schema.parse(value);

      if (validationResult.errors) {
        console.error('[slsm] error parsing value', validationResult.errors);
        return;
      }

      setItemValue(key, validationResult.value);
    }
  }

  return {
    set: setItemValue,
    get: getValue,
    setUnknownValue,

    produce: (key, recipe) => {
      const storageKey = getLocalStorageItemKey(key);
      if (!storageKey) return;

      const itemOptions = items[key];
      const store = getStore(key);

      store.produceState((draft) => {
        const result = recipe(draft);
        // If recipe returns a value, use it; otherwise mutations are applied
        return result !== undefined ? result : draft;
      });

      let finalValue = store.state;

      if (itemOptions.autoPrune) {
        finalValue = itemOptions.autoPrune(finalValue);
        store.setState(finalValue);
      }

      // Persist to storage (store already updated by produceState/setState)
      const itemStorage = getItemStorage(key);
      writeToStorage(storageKey, finalValue, itemStorage);
    },

    delete: (key) => {
      const itemKey = getLocalStorageItemKey(key);

      if (!itemKey) return;

      const itemStorage = getItemStorage(key);

      itemStorage.removeItem(itemKey);

      // Reset to default value
      const store = getStore(key);
      const itemOptions = items[key];
      store.setState(itemOptions.default);
    },

    clearAll: () => {
      for (const storageKey of getStorageItemKeys(localStorage)) {
        localStorage.removeItem(storageKey);

        // Reset corresponding store to default value
        const itemKey = storageKey.split('||')[1] as Items | undefined;
        if (itemKey) {
          const store = getStore(itemKey);
          store.setState(items[itemKey].default);
        }
      }

      for (const storageKey of getStorageItemKeys(sessionStorage)) {
        sessionStorage.removeItem(storageKey);

        // Reset corresponding store to default value
        const itemKey = storageKey.split('||')[1] as Items | undefined;
        if (itemKey) {
          const store = getStore(itemKey);
          store.setState(items[itemKey].default);
        }
      }
    },

    clearAllBy: ({ sessionId, allSessionIds, withNoSessionId }) => {
      function removeKeyFromStorage(storageKey: string, storage: Storage) {
        let shouldRemove = false;

        const hasSessionId = !storageKey.startsWith(`slsm|`);

        if (withNoSessionId) {
          shouldRemove = !hasSessionId;
        } else if (allSessionIds) {
          shouldRemove = hasSessionId;
        } else if (sessionId) {
          shouldRemove =
            hasSessionId && storageKey.startsWith(`slsm-${sessionId}`);
        }

        if (shouldRemove) {
          storage.removeItem(storageKey);

          // Reset corresponding store to default value
          const itemKey = storageKey.split('||')[1] as Items | undefined;
          if (itemKey) {
            const store = getStore(itemKey);
            store.setState(items[itemKey].default);
          }
        }
      }

      for (const storageKey of getStorageItemKeys(localStorage)) {
        removeKeyFromStorage(storageKey, localStorage);
      }

      for (const storageKey of getStorageItemKeys(sessionStorage)) {
        removeKeyFromStorage(storageKey, sessionStorage);
      }
    },

    useKey: (key) => {
      const store = getStore(key);
      return store.useState();
    },

    useKeyWithSelector: (key) => {
      return function useSelector<S>(
        selector: (value: Schemas[typeof key]) => S,
      ) {
        const store = getStore(key);
        return store.useSelector(selector, { useExternalDeps: true }) as S;
      };
    },

    getStore,
  };
}

function getStorageItemKeys(storage: Storage, except?: string) {
  const keys: string[] = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);

    if (key === except) continue;

    if (key?.startsWith('slsm')) {
      keys.push(key);
    }
  }

  return keys;
}

function requestIdleCallback(callback: () => void) {
  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(callback);
  }

  setTimeout(callback, 50);
}
