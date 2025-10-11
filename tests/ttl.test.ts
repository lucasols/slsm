import { rc_array, rc_number, rc_object, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset, mockedLocalStorage } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
});

const TTL_BASE_MS = Date.UTC(2025, 0, 1);
const MS_PER_MINUTE = 60_000;
const toMinuteStamp = (timestamp: number) =>
  Math.round((timestamp - TTL_BASE_MS) / MS_PER_MINUTE);

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

describe('set to undefined or default clears TTL', () => {
  test('set to undefined clears TTL state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      a: string | undefined;
    }>({
      items: {
        a: {
          schema: rc_string.optional(),
          default: '',
          ttl: {
            minutes: 5,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStorage.getItem('slsm||a')).not.toBeNull();

    localStore.set('a', undefined);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });

  test('set to default clears TTL state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: 'default',
          ttl: {
            minutes: 5,
          },
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStorage.getItem('slsm||a')).not.toBeNull();

    localStore.set('a', 'default');

    expect(localStore.get('a')).toBe('default');
    expect(localStorage.getItem('slsm||a')).toBeNull();

    vi.useRealTimers();
  });
});

