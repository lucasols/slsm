import { produce } from 'immer';
import { RcType, rc_parse_json } from 'runcheck';
import { Store } from 't-state';

type ItemOptions<V> = {
  schema: RcType<V>;
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

type ValueOrSetter<T> = T | ((currentValue: T | undefined) => T);

type SmartLocalStorage<Schemas extends Record<string, unknown>> = {
  set: <K extends keyof Schemas>(key: K, value: Schemas[K]) => void;
  setUncheckedValue: (key: string, value: unknown) => void;
  get: <K extends keyof Schemas>(key: K) => Schemas[K] | undefined;
  produce: <K extends keyof Schemas>(
    key: K,
    initialValue: Schemas[K],
    fn: (draft: Schemas[K]) => void | Schemas[K],
  ) => void;

  delete: <K extends keyof Schemas>(key: K) => void;

  clearAll: () => void;
  clearAllBy: (clearBy: {
    sessionId?: string;
    allSessionIds?: boolean;
    withNoSessionId?: boolean;
  }) => void;
  useKey: <K extends keyof Schemas>(key: K) => Schemas[K] | undefined;
  useKeyWithSelector: <K extends keyof Schemas>(
    key: K,
  ) => <S>(
    selector: (value: Schemas[K] | undefined) => S,
    usesExternalDeps?: boolean,
  ) => S;
};

export function createSmartLocalStorage<
  Schemas extends Record<string, unknown>,
>({
  getSessionId = () => '',
  items,
}: SmartLocalStorageOptions<Schemas>): SmartLocalStorage<Schemas> {
  type Items = keyof Schemas;

  type Store = {
    [storeKey: string]:
      | {
          key: Items;
          value: unknown;
        }
      | undefined;
  };

  const valuesStore = new Store<Store>({
    state: {},
  });

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

  function deleteItemByStorageKey(storageKey: string) {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);

    valuesStore.setKey(storageKey, undefined);
  }

  function setItemValueInStore(
    storageKey: string,
    key: Items,
    finalValue: any,
    itemStorage: Storage,
  ) {
    try {
      itemStorage.setItem(storageKey, JSON.stringify(finalValue));
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        const sessionStorageKeys = getStorageItemKeys(
          sessionStorage,
          storageKey,
        );

        if (sessionStorageKeys.length !== 0) {
          for (const itemKey of sessionStorageKeys) {
            deleteItemByStorageKey(itemKey);
          }

          setItemValueInStore(storageKey, key, finalValue, itemStorage);
          return;
        }

        let largestItemSize = 0;
        let largestItemKey = '';

        const localStorageKeys = getStorageItemKeys(localStorage, storageKey);

        if (localStorageKeys.length !== 0) {
          for (const itemKey of localStorageKeys) {
            const itemSize = localStorage.getItem(itemKey)?.length ?? 0;

            if (itemSize > largestItemSize) {
              largestItemSize = itemSize;
              largestItemKey = itemKey;
            }
          }

          localStorage.removeItem(largestItemKey);

          setItemValueInStore(storageKey, key, finalValue, itemStorage);
          return;
        }

        throw error;
      }

      throw error;
    }

    valuesStore.setKey(storageKey, {
      key,
      value: finalValue,
    });
  }

  function setItemValue<K extends Items>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ) {
    const itemKey = getLocalStorageItemKey(key);

    if (!itemKey) return;

    const itemOptions = items[key];

    let finalValue = isFunction(value) ? value(getValue(key)) : value;

    if (itemOptions.autoPrune) {
      finalValue = itemOptions.autoPrune(finalValue);
    }

    const itemStorage = getItemStorage(key);

    setItemValueInStore(itemKey, key, finalValue, itemStorage);
  }

  globalThis.addEventListener('storage', (event) => {
    if (!event.key?.startsWith('slsm')) return;

    const storeKey = event.key;

    const stateItem = valuesStore.state[storeKey];

    if (!stateItem) return;

    const itemOptions = items[stateItem.key];

    if (event.newValue === null) {
      valuesStore.setKey(storeKey, undefined);
      return;
    }

    const validationResult = rc_parse_json(event.newValue, itemOptions.schema);

    if (validationResult.error) {
      console.error('[slsm] error parsing value', validationResult.error);
      return;
    }

    valuesStore.produceState((draft) => {
      const storeItem = draft[storeKey];

      if (!storeItem) return;

      storeItem.value = validationResult.value;
    });
  });

  function getValue<K extends Items>(key: K): Schemas[K] | undefined {
    const itemKey = getLocalStorageItemKey(key);

    if (!itemKey) return;

    const stateItem = valuesStore.state[itemKey]?.value;

    if (stateItem) return stateItem as Schemas[K] | undefined;

    const itemStorage = getItemStorage(key);

    const itemValue = itemStorage.getItem(itemKey);

    if (itemValue === null) return;

    const itemOptions = items[key];

    const validationResult = rc_parse_json(itemValue, itemOptions.schema);

    let finalValue: Schemas[K] | undefined = undefined;

    if (validationResult.error) {
      console.error('[slsm] error parsing value', validationResult.error);
    } else {
      finalValue = validationResult.value;
    }

    valuesStore.setKey(itemKey, {
      key,
      value: finalValue,
    });

    return finalValue;
  }

  function setUnknownValue(key: string, value: unknown) {
    const itemOptions = items[key];
    if (itemOptions) {
      const validationResult = rc_parse_json(value, itemOptions.schema);

      if (validationResult.error) {
        console.error('[slsm] error parsing value', validationResult.error);
        return;
      }

      setItemValue(key, validationResult.value);
    }
  }

  return {
    set: setItemValue,
    get: getValue,
    setUncheckedValue: setUnknownValue,

    produce: (key, initialValue, recipe) => {
      setItemValue(key, (currentValue) =>
        produce(currentValue || initialValue, recipe),
      );
    },

    delete: (key) => {
      const itemKey = getLocalStorageItemKey(key);

      if (!itemKey) return;

      const itemStorage = getItemStorage(key);

      itemStorage.removeItem(itemKey);

      valuesStore.setKey(itemKey, undefined);
    },

    clearAll: () => {
      for (const key of getStorageItemKeys(localStorage)) {
        valuesStore.setKey(key, undefined);
        localStorage.removeItem(key);
      }

      for (const key of getStorageItemKeys(sessionStorage)) {
        valuesStore.setKey(key, undefined);
        sessionStorage.removeItem(key);
      }
    },

    clearAllBy: ({ sessionId, allSessionIds, withNoSessionId }) => {
      valuesStore.batch(() => {
        function removeKeyFromStorage(key: string, storage: Storage) {
          let shouldRemove = false;

          const hasSessionId = !key.startsWith(`slsm|`);

          if (withNoSessionId) {
            shouldRemove = !hasSessionId;
          } else if (allSessionIds) {
            shouldRemove = hasSessionId;
          } else if (sessionId) {
            shouldRemove = hasSessionId && key.startsWith(`slsm-${sessionId}`);
          }

          if (shouldRemove) {
            valuesStore.setKey(key, undefined);
            storage.removeItem(key);
          }
        }

        for (const key of getStorageItemKeys(localStorage)) {
          removeKeyFromStorage(key, localStorage);
        }

        for (const key of getStorageItemKeys(sessionStorage)) {
          removeKeyFromStorage(key, sessionStorage);
        }
      });
    },

    useKey: (key) => {
      const itemKey = getLocalStorageItemKey(key);

      if (!itemKey) return;

      return valuesStore.useSelector((state) => state[itemKey]?.value) as any;
    },

    useKeyWithSelector: (key) => {
      return function useSelector(selector, useExternalDeps) {
        const itemKey = getLocalStorageItemKey(key);

        if (!itemKey) return;

        return valuesStore.useSelector(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          (state) => selector(state[itemKey]?.value as any),
          { useExternalDeps },
        ) as any;
      };
    },
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

function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === 'function';
}

function requestIdleCallback(callback: () => void) {
  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(callback);
  }

  setTimeout(callback, 50);
}
