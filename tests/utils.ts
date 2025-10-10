import { vi } from 'vitest';

export function mockEnv() {
  let storageEventListeners: ((event: StorageEvent) => void)[] = [];

  let quota = Infinity;

  function mockQuota(bytes: number) {
    quota = bytes;
  }

  function getBytes() {
    return (
      JSON.stringify(mockedLocalStorage.getItems()).length +
      JSON.stringify(mockedSessionStorage.getItems()).length
    );
  }

  function checkQuotaError(
    type: 'local' | 'session',
    key: string,
    newValue: string,
  ) {
    if (quota !== Infinity) {
      const newLocalBytes = JSON.stringify(
        type === 'local' ?
          { ...mockedLocalStorage.getItems(), [key]: newValue }
        : mockedLocalStorage.getItems(),
      ).length;

      const newSessionBytes = JSON.stringify(
        type === 'session' ?
          { ...mockedSessionStorage.getItems(), [key]: newValue }
        : mockedSessionStorage.getItems(),
      ).length;

      const newTotalBytes = newLocalBytes + newSessionBytes;

      if (newTotalBytes > quota) {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
    }
  }

  function createStorage(type: 'local' | 'session') {
    let items: Record<string, string | null> = {};

    const storage: Storage = {
      getItem: (key) => {
        return items[key] ?? null;
      },
      setItem: (key, value) => {
        checkQuotaError(type, key, value);

        items[key] = value;
      },
      removeItem: (key: string) => {
        delete items[key];
      },
      clear: () => {
        items = {};
      },
      get length() {
        return Object.keys(items).length;
      },
      key(index) {
        return Object.keys(items)[index] ?? null;
      },
    };

    return {
      storage,
      mockQuota,
      getItems() {
        return items;
      },
      mockExternalChange: (key: string, value: string | null) => {
        const oldValue = items[key];

        items[key] = value;

        for (const callback of storageEventListeners) {
          const event: Pick<
            StorageEvent,
            'key' | 'newValue' | 'oldValue' | 'storageArea'
          > = {
            key,
            newValue: value,
            oldValue: oldValue ?? null,
            storageArea: storage,
          };

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- this is fine here
          callback(event as StorageEvent);
        }
      },
    };
  }

  const mockedLocalStorage = createStorage('local');
  const mockedSessionStorage = createStorage('session');

  vi.stubGlobal('localStorage', mockedLocalStorage.storage);
  vi.stubGlobal('sessionStorage', mockedSessionStorage.storage);
  vi.stubGlobal('window', {
    localStorage: mockedLocalStorage.storage,
    sessionStorage: mockedSessionStorage.storage,
  });

  vi.stubGlobal(
    'addEventListener',
    (eventName: string, callback: (event: StorageEvent) => void) => {
      if (eventName === 'storage') {
        storageEventListeners.push(callback);
      }
    },
  );

  function getStorageItems() {
    return {
      local: mockedLocalStorage.getItems(),
      session: mockedSessionStorage.getItems(),
    };
  }

  function reset() {
    mockedLocalStorage.storage.clear();
    mockedSessionStorage.storage.clear();
    storageEventListeners = [];
  }

  return {
    mockedLocalStorage,
    mockedSessionStorage,
    getStorageItems,
    reset,
    getBytes,
    mockQuota,
  };
}
