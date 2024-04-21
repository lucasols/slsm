import { beforeEach, describe, expect, test } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockQuota, getBytes, mockedLocalStorage } =
  mockEnv();

beforeEach(() => {
  reset();
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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||a": ""hello2"",
          "slsm-session-id||a": ""hello"",
        },
        "session": {},
      }
    `);

    sessionId = 'session-id';

    localStore.delete('a');

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||a": ""hello2"",
        },
        "session": {},
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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-session-id||b": ""hello2"",
          "slsm||a": ""hello"",
        },
        "session": {},
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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||b": ""hello2"",
          "slsm-session-id||a": ""hello"",
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm-new-session-id:s||d": ""hello4"",
        },
      }
    `);

    localStore.clearAll();

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {},
        "session": {},
      }
    `);

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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-session-id||a": ""hello"",
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm-session-id:s||d": ""hello4"",
        },
      }
    `);

    expect(localStore.get('a')).toBeUndefined();
    expect(localStore.get('b')).toBeUndefined();
    expect(localStore.get('c')).toBe('hello3');

    localStore.clearAllBySessionId('session-id');

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm||c": ""hello3"",
        },
        "session": {},
      }
    `);

    localStore.set('a', 'hello');

    localStore.clearAllBySessionId(false);

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||a": ""hello"",
        },
        "session": {},
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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {},
        "session": {
          "slsm:s||a": ""hello"",
        },
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

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm||b": ""hello2"",
        },
        "session": {},
      }
    `);
  });
});

test('invalidate key on storage event', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>();

  localStore.set('a', 'hello');

  mockedLocalStorage.mockExternalChange('slsm||a', '"world"');

  expect(localStore.get('a')).toBe('world');
});

test('recover from max quota reached', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
    b: string;
    c: string;
    d: string;
    e: string;
    session: string;
  }>({
    itemsOptions: {
      session: {
        useSessionStorage: true,
      },
    },
  });

  function getItemsInStores() {
    return {
      local: Object.keys(getStorageItems().local),
      session: Object.keys(getStorageItems().session),
      size: getBytes(),
    };
  }

  mockQuota(900);

  localStore.set('a', 'hello'.repeat(30));

  localStore.set('b', 'hello'.repeat(30));

  localStore.set('c', 'hello'.repeat(30));
  localStore.set('d', 'hello'.repeat(30));

  localStore.set('session', 'hello'.repeat(10));

  expect(getItemsInStores()).toMatchInlineSnapshot(`
    {
      "local": [
        "slsm||a",
        "slsm||b",
        "slsm||c",
        "slsm||d",
      ],
      "session": [
        "slsm:s||session",
      ],
      "size": 745,
    }
  `);

  localStore.set('e', 'hello'.repeat(40));

  // clean session items and try to set `e` again
  expect(getItemsInStores()).toMatchInlineSnapshot(`
    {
      "local": [
        "slsm||a",
        "slsm||b",
        "slsm||c",
        "slsm||d",
        "slsm||e",
      ],
      "session": [],
      "size": 888,
    }
  `);

  localStore.set('e', 'hello'.repeat(60));

  // remove local items until there is available space
  expect(getItemsInStores()).toMatchInlineSnapshot(`
    {
      "local": [
        "slsm||b",
        "slsm||c",
        "slsm||d",
        "slsm||e",
      ],
      "session": [],
      "size": 821,
    }
  `);

  localStore.set('a', 'hello'.repeat(110));

  // remove session items until there is available space
  expect(getItemsInStores()).toMatchInlineSnapshot(`
    {
      "local": [
        "slsm||d",
        "slsm||a",
      ],
      "session": [],
      "size": 737,
    }
  `);
});

test('auto prune', () => {
  const localStore = createSmartLocalStorage<{
    items: number[];
  }>({
    itemsOptions: {
      items: {
        autoPrune: (value) => {
          if (value.length > 4) {
            return value.slice(-4);
          }

          return value;
        },
      },
    },
  });

  localStore.set('items', [1, 2, 3]);

  expect(localStore.get('items')).toEqual([1, 2, 3]);

  localStore.set('items', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  expect(localStore.get('items')).toEqual([7, 8, 9, 10]);

  localStore.produce('items', [], (draft) => {
    draft.push(11);
  });

  expect(localStore.get('items')).toEqual([8, 9, 10, 11]);
});
