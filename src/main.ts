/* eslint-disable @ls-stack/require-description -- will be handled later */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { isFunction } from '@lucasols/utils/assertions';
import { produce } from 'immer';
import { klona } from 'klona';
import { useCallback } from 'react';
import { RcType, rc_parse_json } from 'runcheck';
import { Store } from 't-state';

type ItemOptions<V> = {
  schema: RcType<V>;
  syncTabsState?: boolean;
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
type Setter<T> = (currentValue: T) => T;

type SmartLocalStorage<Schemas extends Record<string, unknown>> = {
  set: <K extends keyof Schemas>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ) => void;
  setWithDefault: <K extends keyof Schemas>(
    key: K,
    defaultValue: Schemas[K],
    setter: Setter<Schemas[K]>,
  ) => void;
  setUnknownValue: (key: string, value: unknown) => void;
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
  ) => <S>(selector: (value: Schemas[K] | undefined) => S) => S;
};

export function createSmartLocalStorage<
  Schemas extends Record<string, unknown>,
>({
  getSessionId = () => '',
  items,
}: SmartLocalStorageOptions<Schemas>): SmartLocalStorage<Schemas> {
  const IS_BROWSER = typeof window !== 'undefined';

  type Items = keyof Schemas;

  type Store = {
    [storeKey: string]:
      | {
          key: Items;
          value: Schemas[Items];
        }
      | undefined;
  };

  const valuesStore = new Store<Store>({
    state: {},
  });

  requestIdleCallback(() => {
    if (!IS_BROWSER) return;

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
      if (IS_BROWSER) {
        itemStorage.setItem(storageKey, JSON.stringify(finalValue));
      }
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

        const currentSessionId = getSessionId();

        const localStorageKeys = getStorageItemKeys(localStorage, storageKey);

        function checkLargestItem(itemsToCheck: string[]) {
          let largestItemSize = 0;
          let largestItemKey = '';

          for (const itemKey of itemsToCheck) {
            const itemSize = localStorage.getItem(itemKey)?.length ?? 0;

            if (itemSize > largestItemSize) {
              largestItemSize = itemSize;
              largestItemKey = itemKey;
            }
          }

          return largestItemKey || null;
        }

        if (localStorageKeys.length !== 0) {
          const itemsInDifferentSessions = localStorageKeys.filter(
            (itemKey) =>
              !itemKey.startsWith(`slsm-${currentSessionId}`) &&
              !itemKey.startsWith(`slsm|`),
          );

          const largestItemKeyInDifferentSessions = checkLargestItem(
            itemsInDifferentSessions,
          );

          if (largestItemKeyInDifferentSessions) {
            localStorage.removeItem(largestItemKeyInDifferentSessions);

            setItemValueInStore(storageKey, key, finalValue, itemStorage);
            return;
          } else {
            const largestItemKey = checkLargestItem(localStorageKeys);

            if (largestItemKey) {
              localStorage.removeItem(largestItemKey);

              setItemValueInStore(storageKey, key, finalValue, itemStorage);
              return;
            }
          }
        }

        throw error;
      }

      throw error;
    }

    valuesStore.setKey(storageKey, {
      key,
      value: klona(finalValue),
    });
  }

  function setItemValue<K extends Items>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ): void;
  function setItemValue<K extends Items>(
    key: K,
    value: Setter<Schemas[K]>,
    defaultValue: Schemas[K],
  ): void;
  function setItemValue<K extends Items>(
    key: K,
    value: ValueOrSetter<Schemas[K]> | Setter<Schemas[K]>,
    defaultValue?: Schemas[K],
  ): void {
    const itemKey = getLocalStorageItemKey(key);

    if (!itemKey) return;

    const itemOptions = items[key];

    const currentValue = getValue(key) ?? defaultValue;

    let finalValue =
      isFunction(value) ? value(currentValue as Schemas[K]) : value;

    if (itemOptions.autoPrune) {
      finalValue = itemOptions.autoPrune(finalValue);
    }

    const itemStorage = getItemStorage(key);

    setItemValueInStore(itemKey, key, finalValue, itemStorage);
  }

  if (IS_BROWSER) {
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

      const validationResult = rc_parse_json(
        event.newValue,
        itemOptions.schema,
      );

      if (validationResult.errors) {
        console.error('[slsm] error parsing value', validationResult.errors);
        return;
      }

      valuesStore.produceState((draft) => {
        const storeItem = draft[storeKey];

        if (!storeItem) return;

        storeItem.value = validationResult.value;
      });
    });
  }

  function getValue<K extends Items>(
    key: K,
    delayStoreUpdate?: boolean,
  ): Schemas[K] | undefined {
    const itemKey = getLocalStorageItemKey(key);

    if (!itemKey) return;

    const stateItem = valuesStore.state[itemKey]?.value;

    if (stateItem) return stateItem as Schemas[K] | undefined;

    const itemStorage = getItemStorage(key);

    const itemValue = itemStorage.getItem(itemKey);

    if (itemValue === null) return;

    const itemOptions = items[key];

    const validationResult = rc_parse_json(itemValue, itemOptions.schema);

    if (validationResult.error) {
      console.error('[slsm] error parsing value', validationResult.errors);
      return undefined;
    }

    const finalValue: Schemas[K] | undefined = validationResult.value;

    if (delayStoreUpdate) {
      queueMicrotask(() => {
        valuesStore.setKey(itemKey, { key, value: finalValue });
      });
    } else {
      valuesStore.setKey(itemKey, {
        key,
        value: finalValue,
      });
    }

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
    setWithDefault: (key, defaultValue, value) => {
      setItemValue(key, value, defaultValue);
    },
    get: getValue,
    setUnknownValue,

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
      return valuesStore.useSelector((state) => {
        const itemKey = getLocalStorageItemKey(key);

        if (!itemKey) return undefined;

        const value = state[itemKey]?.value;

        if (value === undefined) {
          const valueFromStorage = getValue(key, true);

          return valueFromStorage;
        } else {
          return value;
        }
      }) as any;
    },

    useKeyWithSelector: (key) => {
      return function useSelector(selector) {
        const cb = useCallback(
          (state: Store) => {
            const value = (() => {
              const itemKey = getLocalStorageItemKey(key);

              if (!itemKey) return;

              const valueFromState = state[itemKey]?.value as
                | Schemas[typeof key]
                | undefined;

              if (valueFromState === undefined) {
                const valueFromStorage = getValue(key, true);

                return valueFromStorage;
              } else {
                return valueFromState;
              }
            })();

            return selector(value);
          },
          [key, selector],
        );

        return valuesStore.useSelector(cb, { useExternalDeps: true }) as any;
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

function requestIdleCallback(callback: () => void) {
  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(callback);
  }

  setTimeout(callback, 50);
}
