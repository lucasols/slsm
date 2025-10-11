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

const TTL_BASE_MS = Date.UTC(2025, 0, 1);
const MS_PER_MINUTE = 60_000;
const toMinuteStamp = (timestamp: number) =>
  Math.round((timestamp - TTL_BASE_MS) / MS_PER_MINUTE);

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
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          ttl: {
            minutes: 1,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    const stored = JSON.parse(localStorage.getItem('slsm||a') ?? '{}') as {
      t: number;
      p?: Record<string, number>;
      _v: unknown;
    };

    expect(stored._v).toBe('hello');
    expect(stored.t).toBe(toMinuteStamp(TTL_BASE_MS));
    expect(stored.p).toBeUndefined();

    vi.useRealTimers();
  });

  test('whole item ttl expires after duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          ttl: {
            minutes: 1,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    vi.advanceTimersByTime(2 * MS_PER_MINUTE);
    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });

  test('part ttl prunes expired segments', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            minutes: 1,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    localStore.set('feed', ['alpha']);

    vi.setSystemTime(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2);

    localStore.set('feed', ['alpha', 'beta']);

    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE - 1);

    expect(localStore.get('feed')).toEqual(['beta']);

    const stored = JSON.parse(localStorage.getItem('slsm||feed') ?? '{}') as {
      t: number;
      p?: Record<string, number>;
      _v: string[];
    };

    expect(stored._v).toEqual(['beta']);
    expect(stored.p).toEqual({
      beta: toMinuteStamp(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2),
    });

    vi.useRealTimers();
  });

  test('startup sweep removes expired ttl items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS + 5 * MS_PER_MINUTE);

    localStorage.setItem(
      'slsm||a',
      JSON.stringify({
        t: toMinuteStamp(TTL_BASE_MS - MS_PER_MINUTE),
        _v: 'stale',
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
            minutes: 1,
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
    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

    localStorage.setItem(
      'slsm||feed',
      JSON.stringify({
        t: toMinuteStamp(TTL_BASE_MS + 2 * MS_PER_MINUTE),
        p: {
          old: toMinuteStamp(TTL_BASE_MS - MS_PER_MINUTE),
          fresh: toMinuteStamp(TTL_BASE_MS + 2 * MS_PER_MINUTE),
        },
        _v: ['old', 'fresh'],
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
            minutes: 1,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    expect(localStore.get('feed')).toEqual(['fresh']);

    const stored = JSON.parse(localStorage.getItem('slsm||feed') ?? '{}') as {
      t: number;
      p?: Record<string, number>;
      _v: string[];
    };

    expect(stored._v).toEqual(['fresh']);
    expect(stored.p).toEqual({
      fresh: toMinuteStamp(TTL_BASE_MS + 2 * MS_PER_MINUTE),
    });

    vi.useRealTimers();
  });

  test('storage event clears expired ttl entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: '',
          syncTabsState: true,
          ttl: {
            minutes: 1,
          },
        },
      },
    });

    localStore.set('a', 'fresh');

    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

    const expiredEnvelope = JSON.stringify({
      t: toMinuteStamp(TTL_BASE_MS - MS_PER_MINUTE),
      _v: 'stale',
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
            minutes: 1,
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
    vi.setSystemTime(TTL_BASE_MS);

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
            minutes: 5,
          },
        },
      },
    });

    localStore.set('counter', { value: 1 });

    vi.setSystemTime(TTL_BASE_MS + 5 * MS_PER_MINUTE);

    localStore.produce('counter', (draft) => {
      draft.value += 1;
    });

    const stored = JSON.parse(
      localStorage.getItem('slsm||counter') ?? '{}',
    ) as {
      t: number;
      p?: Record<string, number>;
      _v: { value: number };
    };

    expect(stored.t).toBe(toMinuteStamp(TTL_BASE_MS + 5 * MS_PER_MINUTE));
    expect(stored._v).toEqual({ value: 2 });

    vi.useRealTimers();
  });

  test('raw value is wrapped into ttl envelope on load', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

    localStorage.setItem('slsm||legacy', '"hello"');

    const localStore = createSmartLocalStorage<{
      legacy: string;
    }>({
      items: {
        legacy: {
          schema: rc_string,
          default: '',
          ttl: {
            minutes: 2,
          },
        },
      },
    });

    expect(localStore.get('legacy')).toBe('hello');

    const stored = JSON.parse(localStorage.getItem('slsm||legacy') ?? '{}') as {
      t: number;
      p?: Record<string, number>;
      _v: string;
    };

    expect(stored._v).toBe('hello');
    expect(stored.t).toBe(toMinuteStamp(TTL_BASE_MS + 2 * MS_PER_MINUTE));

    vi.useRealTimers();
  });

  test('part ttl removes missing parts on set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            minutes: 1,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
    });

    localStore.set('feed', ['a']);

    const firstStored = JSON.parse(
      localStorage.getItem('slsm||feed') ?? '{}',
    ) as {
      t: number;
      p?: Record<string, number>;
      _v: string[];
    };

    expect(firstStored.t).toBe(toMinuteStamp(TTL_BASE_MS));
    expect(firstStored.p).toEqual({ a: toMinuteStamp(TTL_BASE_MS) });

    vi.setSystemTime(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2);

    localStore.set('feed', ['a', 'b']);

    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE - 1);

    expect(localStore.get('feed')).toEqual(['b']);

    const secondStored = JSON.parse(
      localStorage.getItem('slsm||feed') ?? '{}',
    ) as {
      t: number;
      p?: Record<string, number>;
      _v: string[];
    };

    expect(secondStored.t).toBe(
      toMinuteStamp(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2),
    );
    expect(secondStored._v).toEqual(['b']);
    expect(secondStored.p).toEqual({
      b: toMinuteStamp(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2),
    });

    vi.useRealTimers();
  });

  test('session storage ttl expires item and clears entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      sessionItem: string;
    }>({
      items: {
        sessionItem: {
          schema: rc_string,
          default: '',
          useSessionStorage: true,
          ttl: {
            minutes: 1,
          },
        },
      },
    });

    localStore.set('sessionItem', 'value');

    expect(sessionStorage.getItem('slsm|s||sessionItem')).not.toBeNull();

    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

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

describe('autoPruneBySize', () => {
  test('prunes item when size exceeds maxKb', () => {
    mockQuota(Infinity);

    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    const largeMessages = Array.from({ length: 100 }, (_, i) => `Message ${i}`);
    localStore.set('chat', { messages: largeMessages });

    const result = localStore.get('chat');
    const resultSize = JSON.stringify(result).length;

    expect(resultSize).toBeLessThanOrEqual(1024);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(largeMessages.length);
    expect(result.messages[0]).not.toBe('Message 0');
  });

  test('does not prune when size is within maxKb', () => {
    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 10,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    const smallMessages = ['Message 1', 'Message 2', 'Message 3'];
    localStore.set('chat', { messages: smallMessages });

    const result = localStore.get('chat');
    expect(result.messages).toEqual(smallMessages);
  });

  test('works with produce', () => {
    mockQuota(Infinity);

    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    localStore.set('chat', { messages: [] });

    localStore.produce('chat', (draft) => {
      for (let i = 0; i < 100; i++) {
        draft.messages.push(`Message ${i}`);
      }
    });

    const result = localStore.get('chat');
    const resultSize = JSON.stringify(result).length;

    expect(resultSize).toBeLessThanOrEqual(1024);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(100);
  });

  test('works together with autoPrune', () => {
    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPrune: (value) => {
            if (value.messages.length > 50) {
              return { messages: value.messages.slice(-50) };
            }
            return value;
          },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    const largeMessages = Array.from({ length: 100 }, (_, i) => `Message ${i}`);
    localStore.set('chat', { messages: largeMessages });

    const result = localStore.get('chat');
    const resultSize = JSON.stringify(result).length;

    expect(result.messages.length).toBeLessThanOrEqual(50);
    expect(resultSize).toBeLessThanOrEqual(1024);
  });

  test('prevents infinite loop when prune step does not decrease size', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    type Item = { data: string; counter: number };

    const localStore = createSmartLocalStorage<{
      item: Item;
    }>({
      items: {
        item: {
          schema: rc_object({
            data: rc_string,
            counter: rc_number,
          }),
          default: { data: '', counter: 0 },
          autoPruneBySize: {
            maxKb: 0.1,
            performPruneStep: (value) => ({
              ...value,
              counter: value.counter + 1,
            }),
          },
        },
      },
    });

    const largeData = 'x'.repeat(200);
    localStore.set('item', { data: largeData, counter: 0 });

    const result = localStore.get('item');

    expect(result.data).toBe(largeData);
    expect(result.counter).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('did not decrease'),
    );

    consoleErrorSpy.mockRestore();
  });

  test('prevents infinite loop and logs error when prune step increases size', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 0.1,
            performPruneStep: (value) => ({
              messages: [...value.messages, 'extra message'],
            }),
          },
        },
      },
    });

    const messages = Array.from({ length: 20 }, (_, i) => `Message ${i}`);
    localStore.set('chat', { messages });

    const result = localStore.get('chat');

    expect(result.messages).toEqual(messages);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('increased'),
    );

    consoleErrorSpy.mockRestore();
  });

  test('prevents true infinite loop with max iterations', () => {
    mockQuota(Infinity);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    type Item = { messages: string[] };

    let callCount = 0;
    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 0.01,
            performPruneStep: (value) => {
              callCount++;

              if (value.messages.length <= 1) {
                return { messages: value.messages };
              }
              return {
                messages: value.messages.slice(0, -1),
              };
            },
          },
        },
      },
    });

    const largeMessages = Array.from({ length: 2000 }, (_, i) => `Msg${i}`);
    localStore.set('chat', { messages: largeMessages });

    expect(callCount).toBeLessThan(1100);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('max iterations'),
    );

    consoleErrorSpy.mockRestore();
  });

  test('stops pruning when value becomes identical', () => {
    type Item = { messages: string[] };

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 0.1,
            performPruneStep: (value) => {
              if (value.messages.length <= 1) return value;
              return {
                messages: value.messages.slice(1),
              };
            },
          },
        },
      },
    });

    const messages = ['Message 1', 'Message 2', 'Message 3'];
    localStore.set('chat', { messages });

    const result = localStore.get('chat');

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThanOrEqual(messages.length);
  });
});

describe('auto-prune on initial load', () => {
  test('autoPrune is applied when loading value from storage', () => {
    localStorage.setItem('slsm||items', JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

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

    expect(localStore.get('items')).toEqual([7, 8, 9, 10]);
    expect(JSON.parse(localStorage.getItem('slsm||items') ?? '[]')).toEqual([7, 8, 9, 10]);
  });

  test('autoPruneBySize is applied when loading oversized value from storage', () => {
    mockQuota(Infinity);

    type Item = { messages: string[] };

    const largeMessages = Array.from({ length: 100 }, (_, i) => `Message ${i}`);
    localStorage.setItem('slsm||chat', JSON.stringify({ messages: largeMessages }));

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    const result = localStore.get('chat');
    const resultSize = JSON.stringify(result).length;

    expect(resultSize).toBeLessThanOrEqual(1024);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(largeMessages.length);
    expect(result.messages[0]).not.toBe('Message 0');
  });

  test('both autoPrune and autoPruneBySize are applied on initial load', () => {
    mockQuota(Infinity);

    type Item = { messages: string[] };

    const largeMessages = Array.from({ length: 100 }, (_, i) => `Message with long text ${i}`);
    localStorage.setItem('slsm||chat', JSON.stringify({ messages: largeMessages }));

    const localStore = createSmartLocalStorage<{
      chat: Item;
    }>({
      items: {
        chat: {
          schema: rc_object({
            messages: rc_array(rc_string),
          }),
          default: { messages: [] },
          autoPrune: (value) => {
            if (value.messages.length > 50) {
              return { messages: value.messages.slice(-50) };
            }
            return value;
          },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              messages: value.messages.slice(1),
            }),
          },
        },
      },
    });

    const result = localStore.get('chat');
    const resultSize = JSON.stringify(result).length;

    expect(result.messages.length).toBeLessThanOrEqual(50);
    expect(resultSize).toBeLessThanOrEqual(1024);
  });
});

describe('direct store manipulation', () => {
  test('getStore().setState() persists to localStorage', () => {
    const localStore = createSmartLocalStorage<{
      counter: number;
    }>({
      items: {
        counter: { schema: rc_number, default: 0 },
      },
    });

    const store = localStore.getStore('counter');
    store.setState(42);

    expect(localStore.get('counter')).toBe(42);
    expect(localStorage.getItem('slsm||counter')).toBe('42');
  });

  test('getStore().setState() works with complex objects', () => {
    const localStore = createSmartLocalStorage<{
      user: { name: string; age: number };
    }>({
      items: {
        user: {
          schema: rc_object({
            name: rc_string,
            age: rc_number,
          }),
          default: { name: '', age: 0 },
        },
      },
    });

    const store = localStore.getStore('user');
    store.setState({ name: 'John', age: 30 });

    expect(localStore.get('user')).toEqual({ name: 'John', age: 30 });
    expect(JSON.parse(localStorage.getItem('slsm||user') ?? '{}')).toEqual({
      name: 'John',
      age: 30,
    });
  });

  test('getStore().setState() triggers auto-prune', () => {
    const localStore = createSmartLocalStorage<{
      items: number[];
    }>({
      items: {
        items: {
          schema: rc_array(rc_number),
          default: [],
          autoPrune: (value) => {
            if (value.length > 3) {
              return value.slice(-3);
            }
            return value;
          },
        },
      },
    });

    const store = localStore.getStore('items');
    store.setState([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(localStore.get('items')).toEqual([8, 9, 10]);
    expect(JSON.parse(localStorage.getItem('slsm||items') ?? '[]')).toEqual([
      8, 9, 10,
    ]);
  });

  test('getStore().setState() works with session scoped items', () => {
    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      getSessionId: () => 'test-session',
      items: {
        data: { schema: rc_string, default: '' },
      },
    });

    const store = localStore.getStore('data');
    store.setState('hello');

    expect(localStore.get('data')).toBe('hello');
    expect(localStorage.getItem('slsm-test-session||data')).toBe('"hello"');
  });

  test('getStore().setState() works with sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      tempData: string;
    }>({
      items: {
        tempData: {
          schema: rc_string,
          default: '',
          useSessionStorage: true,
        },
      },
    });

    const store = localStore.getStore('tempData');
    store.setState('temporary');

    expect(localStore.get('tempData')).toBe('temporary');
    expect(sessionStorage.getItem('slsm|s||tempData')).toBe('"temporary"');
    expect(localStorage.getItem('slsm|s||tempData')).toBeNull();
  });

  test('getStore().produceState() persists to localStorage', () => {
    const localStore = createSmartLocalStorage<{
      todos: string[];
    }>({
      items: {
        todos: { schema: rc_array(rc_string), default: [] },
      },
    });

    const store = localStore.getStore('todos');
    store.produceState((draft) => {
      draft.push('task 1');
      draft.push('task 2');
    });

    expect(localStore.get('todos')).toEqual(['task 1', 'task 2']);
    expect(JSON.parse(localStorage.getItem('slsm||todos') ?? '[]')).toEqual([
      'task 1',
      'task 2',
    ]);
  });

  test('getStore().produceState() works with objects', () => {
    const localStore = createSmartLocalStorage<{
      config: { theme: string; fontSize: number };
    }>({
      items: {
        config: {
          schema: rc_object({
            theme: rc_string,
            fontSize: rc_number,
          }),
          default: { theme: 'light', fontSize: 14 },
        },
      },
    });

    const store = localStore.getStore('config');
    store.produceState((draft) => {
      draft.theme = 'dark';
      draft.fontSize = 16;
    });

    expect(localStore.get('config')).toEqual({ theme: 'dark', fontSize: 16 });
    expect(JSON.parse(localStorage.getItem('slsm||config') ?? '{}')).toEqual({
      theme: 'dark',
      fontSize: 16,
    });
  });

  test('getStore().produceState() triggers auto-prune', () => {
    const localStore = createSmartLocalStorage<{
      messages: string[];
    }>({
      items: {
        messages: {
          schema: rc_array(rc_string),
          default: [],
          autoPrune: (value) => {
            if (value.length > 5) {
              return value.slice(-5);
            }
            return value;
          },
        },
      },
    });

    const store = localStore.getStore('messages');
    store.produceState((draft) => {
      for (let i = 1; i <= 10; i++) {
        draft.push(`msg${i}`);
      }
    });

    expect(localStore.get('messages')).toEqual([
      'msg6',
      'msg7',
      'msg8',
      'msg9',
      'msg10',
    ]);
    expect(JSON.parse(localStorage.getItem('slsm||messages') ?? '[]')).toEqual([
      'msg6',
      'msg7',
      'msg8',
      'msg9',
      'msg10',
    ]);
  });

  test('getStore().produceState() with TTL persists correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      data: { value: number };
    }>({
      items: {
        data: {
          schema: rc_object({
            value: rc_number,
          }),
          default: { value: 0 },
          ttl: {
            minutes: 5,
          },
        },
      },
    });

    const store = localStore.getStore('data');
    store.produceState((draft) => {
      draft.value = 100;
    });

    expect(localStore.get('data')).toEqual({ value: 100 });

    const stored = JSON.parse(localStorage.getItem('slsm||data') ?? '{}') as {
      t: number;
      _v: { value: number };
    };

    expect(stored._v).toEqual({ value: 100 });
    expect(stored.t).toBe(toMinuteStamp(TTL_BASE_MS));

    vi.useRealTimers();
  });

  test('getStore().produceState() works with autoPruneBySize', () => {
    mockQuota(Infinity);

    type Item = { items: string[] };

    const localStore = createSmartLocalStorage<{
      list: Item;
    }>({
      items: {
        list: {
          schema: rc_object({
            items: rc_array(rc_string),
          }),
          default: { items: [] },
          autoPruneBySize: {
            maxKb: 1,
            performPruneStep: (value) => ({
              items: value.items.slice(1),
            }),
          },
        },
      },
    });

    const store = localStore.getStore('list');
    store.produceState((draft) => {
      for (let i = 0; i < 200; i++) {
        draft.items.push(`Item ${i}`);
      }
    });

    const result = localStore.get('list');
    const resultSize = JSON.stringify(result).length;

    expect(resultSize).toBeLessThanOrEqual(1024);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(200);
  });
});
