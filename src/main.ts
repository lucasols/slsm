import { produce } from 'immer';
import { Store } from 't-state';

type ItemOptions<V> = {
  ignoreSessionId?: boolean;
  useSessionStorage?: boolean;
  validate?: (value: unknown) => V | undefined;
  autoPrune?: (value: V) => V;
};

type SmartLocalStorageOptions<Schemas extends Record<string, unknown>> = {
  getSessionId?: () => string | false;
  itemsOptions?: {
    [K in keyof Schemas]?: ItemOptions<Schemas[K]>;
  };
};

type ValueOrSetter<T> = T | ((currentValue: T | undefined) => T);

type SmartLocalStorage<Schemas extends Record<string, unknown>> = {
  set: <K extends keyof Schemas>(key: K, value: Schemas[K]) => void;
  get: <K extends keyof Schemas>(key: K) => Schemas[K] | undefined;
  produce: <K extends keyof Schemas>(
    key: K,
    initialValue: Schemas[K],
    fn: (draft: Schemas[K]) => void | Schemas[K],
  ) => void;

  delete: <K extends keyof Schemas>(key: K) => void;

  clearAll: () => void;
  clearAllBySessionId: (sessionId: string | false) => void;
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
  itemsOptions,
}: SmartLocalStorageOptions<Schemas> = {}): SmartLocalStorage<Schemas> {
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

  function getItemStorage(key: Items) {
    return itemsOptions?.[key]?.useSessionStorage ?
        sessionStorage
      : localStorage;
  }

  function getLocalStorageItemKey(key: Items) {
    const itemOptions = itemsOptions?.[key];

    const usesDefaultSessionId = itemOptions?.ignoreSessionId;

    const sessionId = usesDefaultSessionId ? '' : getSessionId();

    if (sessionId === false) return false;

    return `slsm${sessionId ? `-${sessionId}` : ''}${
      itemOptions?.useSessionStorage ? ':s' : ''
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

    const itemOptions = itemsOptions?.[key];

    let finalValue = isFunction(value) ? value(getValue(key)) : value;

    if (itemOptions?.autoPrune) {
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

    const itemOptions = itemsOptions?.[stateItem.key];

    if (event.newValue === null) {
      valuesStore.setKey(storeKey, undefined);
      return;
    }

    let itemValueParsed = safeJsonParse(event.newValue);

    if (itemOptions?.validate) {
      itemValueParsed = itemOptions.validate(itemValueParsed);
    }

    valuesStore.produceState((draft) => {
      const storeItem = draft[storeKey];

      if (!storeItem) return;

      storeItem.value = itemValueParsed;
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

    const itemOptions = itemsOptions?.[key];

    let itemValueParsed = safeJsonParse(itemValue) as Schemas[K] | undefined;

    if (itemOptions?.validate) {
      itemValueParsed = itemOptions.validate(itemValueParsed);
    }

    valuesStore.setKey(itemKey, {
      key,
      value: itemValueParsed,
    });

    return itemValueParsed;
  }

  return {
    set: setItemValue,
    get: getValue,

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

    clearAllBySessionId: (sessionId) => {
      for (const key of getStorageItemKeys(localStorage)) {
        const shouldRemove =
          sessionId === false ?
            key.startsWith(`slsm||`)
          : key.startsWith(`slsm-${sessionId}`);

        if (shouldRemove) {
          valuesStore.setKey(key, undefined);
          localStorage.removeItem(key);
        }
      }

      for (const key of getStorageItemKeys(sessionStorage)) {
        if (key.startsWith(`slsm-${sessionId}`)) {
          valuesStore.setKey(key, undefined);
          sessionStorage.removeItem(key);
        }
      }
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

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error('[slsm] error parsing value', error);
    return;
  }
}
