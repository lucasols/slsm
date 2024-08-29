import { rc_array, rc_number, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockQuota, getBytes, mockedLocalStorage } =
  mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
});

test('set and read a value in store', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string },
    },
  });

  localStore.set('a', 'hello');

  expect(localStore.get('a')).toBe('hello');

  expect(localStorage.getItem('slsm||a')).toBe('"hello"');
});

test('get value from store that is set in localStorage', () => {
  localStorage.setItem('slsm||a', '"hello"');

  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string },
    },
  });

  expect(localStore.get('a')).toBe('hello');
});

test('produce value', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string) },
    },
  });

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

test('set with setter function', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string) },
    },
  });

  localStore.set('a', (currentValue) => [...(currentValue ?? []), 'hello']);

  expect(localStore.get('a')).toEqual(['hello']);

  localStore.set('a', (currentValue) => [...(currentValue ?? []), 'world']);

  expect(localStore.get('a')).toEqual(['hello', 'world']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
});

test('delete value', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string },
    },
  });

  localStore.set('a', 'hello');

  localStore.delete('a');

  expect(localStore.get('a')).toBeUndefined();
  expect(localStorage.getItem('slsm||a')).toBeNull();
});

describe('session id', () => {
  test('store item scoped to session id', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'session-id',
      items: { a: { schema: rc_string } },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm-session-id||a')).toBe('"hello"');
  });

  test('get scoped item', () => {
    localStorage.setItem('slsm-session-id||a', '"hello"');

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'session-id',
      items: {
        a: { schema: rc_string },
      },
    });

    expect(localStore.get('a')).toBe('hello');
  });

  test('delete scoped item', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'session-id',
      items: { a: { schema: rc_string } },
    });

    localStore.set('a', 'hello');

    localStore.delete('a');

    expect(localStore.get('a')).toBeUndefined();
    expect(localStorage.getItem('slsm-session-id||a')).toBeNull();
  });

  test('change session id', () => {
    let sessionId = 'session-id';

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => sessionId,
      items: { a: { schema: rc_string } },
    });

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
      items: {
        a: { ignoreSessionId: true, schema: rc_string },
        b: { schema: rc_string },
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
      e: string;
    }>({
      getSessionId: () => sessionId,
      items: {
        c: { ignoreSessionId: true, schema: rc_string },
        d: { useSessionStorage: true, schema: rc_string },
        b: { schema: rc_string },
        a: { schema: rc_string },
        e: {
          useSessionStorage: true,
          ignoreSessionId: true,
          schema: rc_string,
        },
      },
    });

    localStore.set('a', 'hello');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    localStore.set('d', 'hello4');

    localStore.set('e', 'hello5');

    mockedLocalStorage.storage.setItem('external-key', 'hello');

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "external-key": "hello",
          "slsm-new-session-id||b": ""hello2"",
          "slsm-session-id||a": ""hello"",
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm-new-session-id|s||d": ""hello4"",
          "slsm|s||e": ""hello5"",
        },
      }
    `);

    localStore.clearAll();

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "external-key": "hello",
        },
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
      items: {
        c: { ignoreSessionId: true, schema: rc_string },
        d: { useSessionStorage: true, schema: rc_string },
        b: { schema: rc_string },
        a: { schema: rc_string },
      },
    });

    localStore.set('a', 'hello');

    localStore.set('d', 'hello4');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    expect(localStore.get('d')).toBe(undefined);

    localStore.set('d', 'hello4');

    localStore.clearAllBy({
      sessionId: 'new-session-id',
    });

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-session-id||a": ""hello"",
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm-session-id|s||d": ""hello4"",
        },
      }
    `);

    expect(localStore.get('a')).toBeUndefined();
    expect(localStore.get('b')).toBeUndefined();
    expect(localStore.get('c')).toBe('hello3');

    localStore.clearAllBy({
      sessionId: 'session-id',
    });

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm||c": ""hello3"",
        },
        "session": {},
      }
    `);

    localStore.set('a', 'hello');

    localStore.clearAllBy({
      withNoSessionId: true,
    });

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||a": ""hello"",
        },
        "session": {},
      }
    `);
  });

  test('clear all session ids', () => {
    let sessionId = 'session-id';

    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
      c: string;
      d: string;
      e: string;
    }>({
      getSessionId: () => sessionId,
      items: {
        c: { ignoreSessionId: true, schema: rc_string },
        d: { useSessionStorage: true, schema: rc_string },
        b: { schema: rc_string },
        a: { schema: rc_string },
        e: {
          useSessionStorage: true,
          ignoreSessionId: true,
          schema: rc_string,
        },
      },
    });

    localStore.set('a', 'hello');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    sessionId = 'new-session-id-2';

    localStore.set('d', 'hello4');

    localStore.set('e', 'hello5');

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm-new-session-id||b": ""hello2"",
          "slsm-session-id||a": ""hello"",
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm-new-session-id-2|s||d": ""hello4"",
          "slsm|s||e": ""hello5"",
        },
      }
    `);

    localStore.clearAllBy({
      allSessionIds: true,
    });

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm||c": ""hello3"",
        },
        "session": {
          "slsm|s||e": ""hello5"",
        },
      }
    `);
  });
});

test('item validation', () => {
  {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: { schema: rc_string },
      },
    });

    localStore.set('a', 'hello');
  }

  {
    const localStore = createSmartLocalStorage<{
      a: number;
    }>({
      items: {
        a: { schema: rc_number },
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
      items: {
        a: {
          useSessionStorage: true,
          schema: rc_string,
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {},
        "session": {
          "slsm|s||a": ""hello"",
        },
      }
    `);
  });

  test('delete item as sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
    }>({
      items: {
        a: {
          useSessionStorage: true,
          schema: rc_string,
        },
        b: { schema: rc_string },
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
  }>({
    items: {
      a: { schema: rc_string },
    },
  });

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
    items: {
      session: {
        useSessionStorage: true,
        schema: rc_string,
      },
      a: { schema: rc_string },
      b: { schema: rc_string },
      c: { schema: rc_string },
      d: { schema: rc_string },
      e: { schema: rc_string },
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
        "slsm|s||session",
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
    items: {
      items: {
        schema: rc_array(rc_number),
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

test.concurrent('auto prune deleted items', () => {
  {
    const localStore = createSmartLocalStorage<{
      items: number[];
      willBeDeleted: number[];
    }>({
      items: {
        items: {
          schema: rc_array(rc_number),
        },
        willBeDeleted: {
          schema: rc_array(rc_number),
        },
      },
    });

    localStore.set('items', [1, 2, 3]);
    localStore.set('willBeDeleted', [4, 5, 6]);
  }

  {
    const _localStore = createSmartLocalStorage<{
      items: number[];
    }>({
      items: {
        items: {
          schema: rc_array(rc_number),
        },
      },
    });

    expect(getStorageItems()).toMatchInlineSnapshot(`
      {
        "local": {
          "slsm||items": "[1,2,3]",
        },
        "session": {},
      }
    `);
  }
});

test('bug: store keeps reference of set values', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string) },
    },
  });

  const array = ['hello'];

  localStore.set('a', array);

  array.unshift('world', '!');

  array.push('!');

  expect(localStore.get('a')).toEqual(['hello']);
});

test('bug: set a item with a value that exceeds the quota', () => {
  mockQuota(900);

  const localStore = createSmartLocalStorage<{
    a: string;
    b: string;
    c: string;
    d: string;
    e: string;
  }>({
    items: {
      a: { schema: rc_string },
      b: { schema: rc_string },
      c: { schema: rc_string },
      d: { schema: rc_string },
      e: { schema: rc_string },
    },
  });

  localStore.set('a', 'hello'.repeat(10));
  localStore.set('b', 'hello'.repeat(10));

  expect(() => {
    localStore.set('c', 'hello'.repeat(1000));
  }).toThrowError();
});
