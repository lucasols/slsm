import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';

let storageEventListeners: ((event: StorageEvent) => void)[] = [];

function createStorage() {
  let items: Record<string, string | null> = {};

  const storage: Storage = {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
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
    get items() {
      return items;
    },
    mockExternalChange: (key: string, value: string | null) => {
      const oldValue = items[key];

      items[key] = value;

      storageEventListeners.forEach((callback) => {
        const event: Pick<
          StorageEvent,
          'key' | 'newValue' | 'oldValue' | 'storageArea'
        > = {
          key,
          newValue: value,
          oldValue: oldValue ?? null,
          storageArea: storage,
        };

        callback(event as StorageEvent);
      });
    },
  };
}

const mockedLocalStorage = createStorage();
const mockedSessionStorage = createStorage();

vi.stubGlobal('localStorage', mockedLocalStorage.storage);
vi.stubGlobal('sessionStorage', mockedSessionStorage.storage);

vi.stubGlobal(
  'addEventListener',
  (eventName: string, callback: (event: StorageEvent) => void) => {
    if (eventName === 'storage') {
      storageEventListeners.push(callback);
    }
  },
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  storageEventListeners = [];
});

test('set and read a value in store', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>();

  localStore.set('a', 'hello');

  expect(localStore.get('a')).toBe('hello');

  expect(localStorage.getItem('slsm||a')).toBe('"hello"');
});

test('get value from store that is set in localStorage', () => {
  localStorage.setItem('slsm||a', '"hello"');

  const localStore = createSmartLocalStorage<{
    a: string;
  }>();

  expect(localStore.get('a')).toBe('hello');
});

test('produce value', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>();

  localStore.produce('a', [], (draft) => {
    draft.push('hello');
  });

  expect(localStore.get('a')).toEqual(['hello']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello"]');

  localStore.produce('a', [], (draft) => {
    draft.push('world');
  });

  expect(localStore.get('a')).toEqual(['hello', 'world']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
});

test('delete value', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>();

  localStore.set('a', 'hello');

  localStore.delete('a');

  expect(localStore.get('a')).toBeUndefined();
  expect(localStorage.getItem('slsm||a')).toBeNull();
});

describe('session id', () => {
  test('store item scoped to session id', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({ getSessionId: () => 'session-id' });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm-session-id||a')).toBe('"hello"');
  });

  test('get scoped item', () => {
    localStorage.setItem('slsm-session-id||a', '"hello"');

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({ getSessionId: () => 'session-id' });

    expect(localStore.get('a')).toBe('hello');
  });

  test('delete scoped item', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({ getSessionId: () => 'session-id' });

    localStore.set('a', 'hello');

    localStore.delete('a');

    expect(localStore.get('a')).toBeUndefined();
    expect(localStorage.getItem('slsm-session-id||a')).toBeNull();
  });

  test('change session id', () => {
    let sessionId = 'session-id';

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({ getSessionId: () => sessionId });

    localStore.set('a', 'hello');

    sessionId = 'new-session-id';

    expect(localStore.get('a')).toBe(undefined);

    localStore.set('a', 'hello2');

    expect(localStore.get('a')).toBe('hello2');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-new-session-id||a": ""hello2"",
        "slsm-session-id||a": ""hello"",
      }
    `);

    sessionId = 'session-id';

    localStore.delete('a');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-new-session-id||a": ""hello2"",
      }
    `);
  });

  test('items with fixed default session id', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
    }>({
      getSessionId: () => 'session-id',
      itemsOptions: {
        a: { ignoreSessionId: true },
      },
    });

    localStore.set('a', 'hello');
    localStore.set('b', 'hello2');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-session-id||b": ""hello2"",
        "slsm||a": ""hello"",
      }
    `);
  });

  test('clear all', () => {
    let sessionId = 'session-id';
    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
      c: string;
      d: string;
    }>({
      getSessionId: () => sessionId,
      itemsOptions: {
        c: { ignoreSessionId: true },
        d: { useSessionStorage: true },
      },
    });

    localStore.set('a', 'hello');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    localStore.set('d', 'hello4');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-new-session-id||b": ""hello2"",
        "slsm-session-id||a": ""hello"",
        "slsm||c": ""hello3"",
      }
    `);

    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-new-session-id:s||d": ""hello4"",
      }
    `);

    localStore.clearAll();

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {}
    `);

    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`{}`);

    expect(localStore.get('a')).toBeUndefined();
    expect(localStore.get('b')).toBeUndefined();
    expect(localStore.get('c')).toBeUndefined();
  });

  test('clear all by session id', () => {
    let sessionId = 'session-id';

    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
      c: string;
      d: string;
    }>({
      getSessionId: () => sessionId,
      itemsOptions: {
        c: { ignoreSessionId: true },
        d: { useSessionStorage: true },
      },
    });

    localStore.set('a', 'hello');

    localStore.set('d', 'hello4');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    expect(localStore.get('d')).toBe(undefined);

    localStore.set('d', 'hello4');

    localStore.clearAllBySessionId('new-session-id');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-session-id||a": ""hello"",
        "slsm||c": ""hello3"",
      }
    `);

    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-session-id:s||d": ""hello4"",
      }
    `);

    expect(localStore.get('a')).toBeUndefined();
    expect(localStore.get('b')).toBeUndefined();
    expect(localStore.get('c')).toBe('hello3');

    localStore.clearAllBySessionId('session-id');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm||c": ""hello3"",
      }
    `);

    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`{}`);

    localStore.set('a', 'hello');

    localStore.clearAllBySessionId(false);

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm-new-session-id||a": ""hello"",
      }
    `);
  });
});

test('item validation', () => {
  {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>();

    localStore.set('a', 'hello');
  }

  {
    const localStore = createSmartLocalStorage<{
      a: number;
    }>({
      itemsOptions: {
        a: {
          validate: (value) => (typeof value === 'number' ? value : undefined),
        },
      },
    });

    expect(localStore.get('a')).toBeUndefined();

    localStore.set('a', 1);

    expect(localStore.get('a')).toBe(1);
  }
});

describe('item with sessionStorage', () => {
  test('set item as sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      itemsOptions: {
        a: {
          useSessionStorage: true,
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`{}`);
    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`
      {
        "slsm:s||a": ""hello"",
      }
    `);
  });

  test('delete item as sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
    }>({
      itemsOptions: {
        a: {
          useSessionStorage: true,
        },
      },
    });

    localStore.set('a', 'hello');
    localStore.set('b', 'hello2');

    localStore.delete('a');

    expect(localStore.get('a')).toBeUndefined();

    expect(mockedLocalStorage.items).toMatchInlineSnapshot(`
      {
        "slsm||b": ""hello2"",
      }
    `);
    expect(mockedSessionStorage.items).toMatchInlineSnapshot(`{}`);
  });
});

test('invalidate key on storage event', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>();

  localStore.set('a', 'hello');

  mockedLocalStorage.mockExternalChange('slsm||a', 'hello2');

  expect(localStore.get('a')).toBe('hello2');
});

// FIX: sync multiple tabs
// FIX: auto prune
// FIX: recover from max quota reached
// FIX: useKey
// FIX: useKeyWith selector
