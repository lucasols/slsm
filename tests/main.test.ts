/* eslint-disable @typescript-eslint/consistent-type-assertions -- assertions in tests are ok */
import {
  rc_array,
  rc_boolean,
  rc_number,
  rc_object,
  rc_string,
} from 'runcheck';
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
      a: { schema: rc_string, default: '' },
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
      a: { schema: rc_string, default: '' },
    },
  });

  expect(localStore.get('a')).toBe('hello');
});

test('produce value', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  localStore.produce('a', (draft) => {
    draft.push('hello');
  });

  expect(localStore.get('a')).toEqual(['hello']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello"]');

  localStore.produce('a', (draft) => {
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
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  localStore.set('a', (currentValue) => [...currentValue, 'hello']);

  expect(localStore.get('a')).toEqual(['hello']);

  localStore.set('a', (currentValue) => [...currentValue, 'world']);

  expect(localStore.get('a')).toEqual(['hello', 'world']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
});

test('delete value', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string, default: '' },
    },
  });

  localStore.set('a', 'hello');

  localStore.delete('a');

  expect(localStore.get('a')).toBe('');
  expect(localStorage.getItem('slsm||a')).toBeNull();
});

describe('session id', () => {
  test('store item scoped to session id', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'session-id',
      items: { a: { schema: rc_string, default: '' } },
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
        a: { schema: rc_string, default: '' },
      },
    });

    expect(localStore.get('a')).toBe('hello');
  });

  test('delete scoped item', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'session-id',
      items: { a: { schema: rc_string, default: '' } },
    });

    localStore.set('a', 'hello');

    localStore.delete('a');

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm-session-id||a')).toBeNull();
  });

  test('change session id', () => {
    let sessionId = 'session-id';

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => sessionId,
      items: { a: { schema: rc_string, default: '' } },
    });

    localStore.set('a', 'hello');

    sessionId = 'new-session-id';

    expect(localStore.get('a')).toBe('');

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
        a: { ignoreSessionId: true, schema: rc_string, default: '' },
        b: { schema: rc_string, default: '' },
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
        c: { ignoreSessionId: true, schema: rc_string, default: '' },
        d: { useSessionStorage: true, schema: rc_string, default: '' },
        b: { schema: rc_string, default: '' },
        a: { schema: rc_string, default: '' },
        e: {
          useSessionStorage: true,
          ignoreSessionId: true,
          schema: rc_string,
          default: '',
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

    expect(localStore.get('a')).toBe('');
    expect(localStore.get('b')).toBe('');
    expect(localStore.get('c')).toBe('');
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
        c: { ignoreSessionId: true, schema: rc_string, default: '' },
        d: { useSessionStorage: true, schema: rc_string, default: '' },
        b: { schema: rc_string, default: '' },
        a: { schema: rc_string, default: '' },
      },
    });

    localStore.set('a', 'hello');

    localStore.set('d', 'hello4');

    sessionId = 'new-session-id';

    localStore.set('b', 'hello2');

    localStore.set('c', 'hello3');

    expect(localStore.get('d')).toBe('');

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

    expect(localStore.get('a')).toBe('');
    expect(localStore.get('b')).toBe('');
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
        c: { ignoreSessionId: true, schema: rc_string, default: '' },
        d: { useSessionStorage: true, schema: rc_string, default: '' },
        b: { schema: rc_string, default: '' },
        a: { schema: rc_string, default: '' },
        e: {
          useSessionStorage: true,
          ignoreSessionId: true,
          schema: rc_string,
          default: '',
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
        a: { schema: rc_string, default: '' },
      },
    });

    localStore.set('a', 'hello');
  }

  {
    const localStore = createSmartLocalStorage<{
      a: number;
    }>({
      items: {
        a: { schema: rc_number, default: 0 },
      },
    });

    expect(localStore.get('a')).toBe(0);

    localStore.set('a', 1);

    expect(localStore.get('a')).toBe(1);
  }
});

describe('ttl', () => {
  test('persists ttl envelope metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          ttl: {
            ms: 1_000,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    const stored = JSON.parse(localStorage.getItem('slsm||a') ?? '{}') as {
      _: { t: number; p?: Record<string, number> };
      v: unknown;
    };

    expect(stored.v).toBe('hello');
    expect(stored._.t).toBe(0);
    expect(stored._.p).toBeUndefined();

    vi.useRealTimers();
  });

  test('whole item ttl expires after duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          ttl: {
            ms: 1_000,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    vi.advanceTimersByTime(1_200);
    vi.setSystemTime(1_200);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });

  test('part ttl prunes expired segments', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            ms: 1_000,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    localStore.set('feed', ['alpha']);

    vi.advanceTimersByTime(500);
    vi.setSystemTime(500);

    localStore.set('feed', ['alpha', 'beta']);

    vi.advanceTimersByTime(600);
    vi.setSystemTime(1_100);

    expect(localStore.get('feed')).toEqual(['beta']);

    const stored = JSON.parse(localStorage.getItem('slsm||feed') ?? '{}') as {
      _: { t: number; p?: Record<string, number> };
      v: string[];
    };

    expect(stored.v).toEqual(['beta']);
    expect(stored._.p).toEqual({ beta: 500 });

    vi.useRealTimers();
  });

  test('startup sweep removes expired ttl items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);

    localStorage.setItem(
      'slsm||a',
      JSON.stringify({
        _: { t: 0 },
        v: 'stale',
      }),
    );

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          ttl: {
            ms: 1_000,
          },
        },
      },
    });

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });

  test('initial load prunes expired ttl parts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_200);

    localStorage.setItem(
      'slsm||feed',
      JSON.stringify({
        _: { t: 600, p: { old: 0, fresh: 600 } },
        v: ['old', 'fresh'],
      }),
    );

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            ms: 1_000,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    expect(localStore.get('feed')).toEqual(['fresh']);

    const stored = JSON.parse(localStorage.getItem('slsm||feed') ?? '{}') as {
      _: { t: number; p?: Record<string, number> };
      v: string[];
    };

    expect(stored.v).toEqual(['fresh']);
    expect(stored._.p).toEqual({ fresh: 600 });

    vi.useRealTimers();
  });

  test('storage event clears expired ttl entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          syncTabsState: true,
          ttl: {
            ms: 1_000,
          },
        },
      },
    });

    localStore.set('a', 'fresh');

    vi.setSystemTime(2_000);

    const expiredEnvelope = JSON.stringify({
      _: { t: 0 },
      v: 'stale',
    });

    mockedLocalStorage.mockExternalChange('slsm||a', expiredEnvelope);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });

  test('quota cleanup prunes expired ttl before other keys', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const newValue = 'x'.repeat(90);

    const localStore = createSmartLocalStorage<{
      ttlKey: string;
      retained: string;
      newItem: string;
    }>({
      items: {
        ttlKey: {
          schema: rc_string,
          default: '',
          ttl: {
            ms: 1_000,
          },
        },
        retained: { schema: rc_string, default: '' },
        newItem: { schema: rc_string, default: '' },
      },
    });

    localStore.set('ttlKey', 'stale');
    localStore.set('retained', 'keep');

    const newValueSerialized = JSON.stringify(newValue);
    const currentItems = mockedLocalStorage.getItems();
    const bytesWithTtl = JSON.stringify({
      ...currentItems,
      'slsm||newItem': newValueSerialized,
    }).length;

    const { 'slsm||ttlKey': _removedTtl, ...itemsWithoutTtl } = currentItems;
    const bytesWithoutTtl = JSON.stringify({
      ...itemsWithoutTtl,
      'slsm||newItem': newValueSerialized,
    }).length;

    expect(bytesWithTtl).toBeGreaterThan(bytesWithoutTtl);

    mockQuota(bytesWithoutTtl + 5);

    vi.setSystemTime(2_000);

    expect(localStorage.getItem('slsm||ttlKey')).not.toBeNull();

    localStore.set('newItem', newValue);

    expect(localStorage.getItem('slsm||ttlKey')).toBeNull();
    expect(localStorage.getItem('slsm||retained')).toBe('"keep"');
    expect(JSON.parse(localStorage.getItem('slsm||newItem') ?? 'null')).toBe(
      newValue,
    );

    mockQuota(Infinity);
    vi.useRealTimers();
  });

  test('produce refreshes ttl timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      counter: { value: number };
    }>({
      items: {
        counter: {
          schema: rc_object({
            value: rc_number,
          }),
          default: { value: 0 },
          ttl: {
            ms: 10_000,
          },
        },
      },
    });

    localStore.set('counter', { value: 1 });

    vi.setSystemTime(5_000);

    localStore.produce('counter', (draft) => {
      draft.value += 1;
    });

    const stored = JSON.parse(localStorage.getItem('slsm||counter') ?? '{}') as {
      _: { t: number };
      v: { value: number };
    };

    expect(stored._.t).toBe(5_000);
    expect(stored.v).toEqual({ value: 2 });

    vi.useRealTimers();
  });

  test('raw value is wrapped into ttl envelope on load', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);

    localStorage.setItem('slsm||legacy', '"hello"');

    const localStore = createSmartLocalStorage<{
      legacy: string;
    }>({
      items: {
        legacy: {
          schema: rc_string,
          default: '',
          ttl: {
            ms: 5_000,
          },
        },
      },
    });

    expect(localStore.get('legacy')).toBe('hello');

    const stored = JSON.parse(localStorage.getItem('slsm||legacy') ?? '{}') as {
      _: { t: number };
      v: string;
    };

    expect(stored.v).toBe('hello');
    expect(stored._.t).toBe(2_000);

    vi.useRealTimers();
  });

  test('part ttl removes missing parts on set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            ms: 1_000,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    localStore.set('feed', ['a', 'b']);

    const firstStored = JSON.parse(
      localStorage.getItem('slsm||feed') ?? '{}',
    ) as {
      _: { t: number; p?: Record<string, number> };
      v: string[];
    };

    expect(firstStored._.p).toEqual({ a: 0, b: 0 });

    vi.setSystemTime(500);

    localStore.set('feed', ['b']);

    const secondStored = JSON.parse(
      localStorage.getItem('slsm||feed') ?? '{}',
    ) as {
      _: { t: number; p?: Record<string, number> };
      v: string[];
    };

    expect(secondStored.v).toEqual(['b']);
    expect(secondStored._.p).toEqual({ b: 0 });

    vi.useRealTimers();
  });

  test('session storage ttl expires item and clears entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const localStore = createSmartLocalStorage<{
      sessionItem: string;
    }>({
      items: {
        sessionItem: {
          schema: rc_string,
          default: '',
          useSessionStorage: true,
          ttl: {
            ms: 1_000,
          },
        },
      },
    });

    localStore.set('sessionItem', 'value');

    expect(sessionStorage.getItem('slsm|s||sessionItem')).not.toBeNull();

    vi.setSystemTime(2_000);

    expect(localStore.get('sessionItem')).toBe('');
    expect(sessionStorage.getItem('slsm|s||sessionItem')).toBeNull();

    vi.useRealTimers();
  });
});

describe('item with sessionStorage', () => {
  test('set item as sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: { useSessionStorage: true, schema: rc_string, default: '' },
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
        a: { useSessionStorage: true, schema: rc_string, default: '' },
        b: { schema: rc_string, default: '' },
      },
    });

    localStore.set('a', 'hello');
    localStore.set('b', 'hello2');

    localStore.delete('a');

    expect(localStore.get('a')).toBe('');

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
      a: { schema: rc_string, default: '', syncTabsState: true },
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
      session: { useSessionStorage: true, schema: rc_string, default: '' },
      a: { schema: rc_string, default: '' },
      b: { schema: rc_string, default: '' },
      c: { schema: rc_string, default: '' },
      d: { schema: rc_string, default: '' },
      e: { schema: rc_string, default: '' },
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
        default: [],
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

  localStore.produce('items', (draft) => {
    draft.push(11);
  });

  expect(localStore.get('items')).toEqual([8, 9, 10, 11]);
});

test('auto prune deleted items', () => {
  vi.useRealTimers();

  {
    const localStore = createSmartLocalStorage<{
      items: number[];
      willBeDeleted: number[];
    }>({
      items: {
        items: { schema: rc_array(rc_number), default: [] },
        willBeDeleted: { schema: rc_array(rc_number), default: [] },
      },
    });

    localStore.set('items', [1, 2, 3]);
    localStore.set('willBeDeleted', [4, 5, 6]);
  }

  {
    createSmartLocalStorage<{
      items: number[];
    }>({
      items: {
        items: { schema: rc_array(rc_number), default: [] },
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
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  const array = ['hello'];

  localStore.set('a', array);

  array.unshift('world', '!');

  array.push('!');

  expect(localStore.get('a')).toEqual(['hello']);
});

describe('priority-based quota management', () => {
  test('items with lower priority are removed first when quota exceeded', () => {
    const localStore = createSmartLocalStorage<{
      lowPriority: string;
      mediumPriority: string;
      highPriority: string;
      newItem: string;
    }>({
      items: {
        lowPriority: { schema: rc_string, default: '', priority: 1 },
        mediumPriority: { schema: rc_string, default: '', priority: 5 },
        highPriority: { schema: rc_string, default: '', priority: 10 },
        newItem: { schema: rc_string, default: '', priority: 5 },
      },
    });

    // Fill up storage with items of different priorities
    localStore.set('lowPriority', 'x'.repeat(30));
    localStore.set('mediumPriority', 'x'.repeat(30));
    localStore.set('highPriority', 'x'.repeat(30));

    const currentSize = getBytes();
    mockQuota(currentSize + 50); // Set quota just above current size

    // This should trigger quota exceeded and remove lowPriority (priority 1)
    localStore.set('newItem', 'x'.repeat(30));

    const items = getStorageItems();
    expect(items.local['slsm||lowPriority']).toBeUndefined();
    expect(items.local['slsm||mediumPriority']).toBeDefined();
    expect(items.local['slsm||highPriority']).toBeDefined();
    expect(items.local['slsm||newItem']).toBeDefined();
  });

  test('within same priority, larger items are removed first', () => {
    const localStore = createSmartLocalStorage<{
      smallItem: string;
      largeItem: string;
      newItem: string;
    }>({
      items: {
        smallItem: { schema: rc_string, default: '', priority: 1 },
        largeItem: { schema: rc_string, default: '', priority: 1 },
        newItem: { schema: rc_string, default: '', priority: 5 },
      },
    });

    localStore.set('smallItem', 'x'.repeat(30));
    localStore.set('largeItem', 'x'.repeat(90));

    const currentSize = getBytes();
    mockQuota(currentSize + 80);

    // This should remove largeItem (same priority but larger)
    localStore.set('newItem', 'x'.repeat(90));

    const items = getStorageItems();
    expect(items.local['slsm||largeItem']).toBeUndefined();
    expect(items.local['slsm||smallItem']).toBeDefined();
    expect(items.local['slsm||newItem']).toBeDefined();
  });

  test('default priority is 0 when not specified', () => {
    const localStore = createSmartLocalStorage<{
      noPriority: string;
      withPriority: string;
      newItem: string;
    }>({
      items: {
        noPriority: { schema: rc_string, default: '' }, // priority defaults to 0
        withPriority: { schema: rc_string, default: '', priority: 5 },
        newItem: { schema: rc_string, default: '' },
      },
    });

    localStore.set('noPriority', 'x'.repeat(30));
    localStore.set('withPriority', 'x'.repeat(30));

    const currentSize = getBytes();
    mockQuota(currentSize + 50);

    // Should remove noPriority (priority 0) before withPriority (priority 5)
    localStore.set('newItem', 'x'.repeat(30));

    const items = getStorageItems();
    expect(items.local['slsm||noPriority']).toBeUndefined();
    expect(items.local['slsm||withPriority']).toBeDefined();
    expect(items.local['slsm||newItem']).toBeDefined();
  });

  test('removes multiple items if needed to free space', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
      b: string;
      c: string;
      d: string;
    }>({
      items: {
        a: { schema: rc_string, default: '', priority: 1 },
        b: { schema: rc_string, default: '', priority: 2 },
        c: { schema: rc_string, default: '', priority: 3 },
        d: { schema: rc_string, default: '', priority: 10 },
      },
    });

    localStore.set('a', 'x'.repeat(20));
    localStore.set('b', 'x'.repeat(20));
    localStore.set('c', 'x'.repeat(20));

    const currentSize = getBytes();
    mockQuota(currentSize + 70);

    // Should remove both a and b (lower priorities) to make space
    localStore.set('d', 'x'.repeat(100));

    const items = getStorageItems();
    expect(items.local['slsm||a']).toBeUndefined();
    expect(items.local['slsm||b']).toBeUndefined();
    expect(items.local['slsm||c']).toBeDefined();
    expect(items.local['slsm||d']).toBeDefined();
  });

  test('works correctly with different sessions', () => {
    const session1Store = createSmartLocalStorage<{
      a: string;
      b: string;
    }>({
      getSessionId: () => 'session1',
      items: {
        a: { schema: rc_string, default: '', priority: 5 },
        b: { schema: rc_string, default: '', priority: 1 },
      },
    });

    const session2Store = createSmartLocalStorage<{
      a: string;
      b: string;
    }>({
      getSessionId: () => 'session2',
      items: {
        a: { schema: rc_string, default: '', priority: 5 },
        b: { schema: rc_string, default: '', priority: 1 },
      },
    });

    // Set items in session 1
    session1Store.set('a', 'x'.repeat(20));
    session1Store.set('b', 'x'.repeat(20));

    // Set items in session 2
    session2Store.set('a', 'x'.repeat(20));

    const currentSize = getBytes();
    mockQuota(currentSize + 40);

    // should remove session1's low priority item first
    session2Store.set('b', 'x'.repeat(20));

    const items = getStorageItems();

    // Session 1's low priority item should be removed
    expect(items.local['slsm-session1||b']).toBeUndefined();
    // Session 1's high priority item should remain
    expect(items.local['slsm-session1||a']).toBeDefined();
    // All session 2 items should exist
    expect(items.local['slsm-session2||a']).toBeDefined();
    expect(items.local['slsm-session2||b']).toBeDefined();
  });

  test('removes from different sessions before current session', () => {
    const session1Store = createSmartLocalStorage<{
      item: string;
    }>({
      getSessionId: () => 'session1',
      items: {
        item: { schema: rc_string, default: '', priority: 10 },
      },
    });

    const session2Store = createSmartLocalStorage<{
      item: string;
      newItem: string;
    }>({
      getSessionId: () => 'session2',
      items: {
        item: { schema: rc_string, default: '', priority: 1 },
        newItem: { schema: rc_string, default: '', priority: 5 },
      },
    });

    // Set items in different sessions
    session1Store.set('item', 'x'.repeat(60));
    session2Store.set('item', 'x'.repeat(60));

    const currentSize = getBytes();
    mockQuota(currentSize + 80);

    // This should remove session1's item (different session, sorted by priority)
    session2Store.set('newItem', 'x'.repeat(60));

    const items = getStorageItems();

    // Session 1's item should be removed (different session, higher priority than session2's item)
    expect(items.local['slsm-session1||item']).toBeUndefined();
    // Session 2's items should remain
    expect(items.local['slsm-session2||item']).toBeDefined();
    expect(items.local['slsm-session2||newItem']).toBeDefined();
  });
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
      a: { schema: rc_string, default: '' },
      b: { schema: rc_string, default: '' },
      c: { schema: rc_string, default: '' },
      d: { schema: rc_string, default: '' },
      e: { schema: rc_string, default: '' },
    },
  });

  localStore.set('a', 'hello'.repeat(10));
  localStore.set('b', 'hello'.repeat(10));

  expect(() => {
    localStore.set('c', 'hello'.repeat(1000));
  }).toThrowError();
});

test('set with setter function using default value', () => {
  const localStore = createSmartLocalStorage<{
    a: boolean;
  }>({
    items: {
      a: { schema: rc_boolean, default: true },
    },
  });

  localStore.set('a', (currentValue) => !currentValue);

  expect(localStore.get('a')).toBe(false);
});
