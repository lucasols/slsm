import { rc_object, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset } = mockEnv();

beforeEach(() => {
  reset();
});

const TTL_BASE_MS = Date.UTC(2025, 0, 1);
const MS_PER_MINUTE = 60_000;
const toMinuteStamp = (timestamp: number) =>
  Math.round((timestamp - TTL_BASE_MS) / MS_PER_MINUTE);

describe('initializeFrom', () => {
  test('initializes data from another item when current item is empty', () => {
    localStorage.setItem(
      'slsm||oldUser',
      JSON.stringify({ username: 'john', preferences: { theme: 'dark' } }),
    );

    const localStore = createSmartLocalStorage<{
      oldUser: { username: string; preferences: { theme: string } };
      newUser: { name: string; settings: { theme: string } };
    }>({
      items: {
        oldUser: {
          schema: rc_object({
            username: rc_string,
            preferences: rc_object({ theme: rc_string }),
          }),
          default: { username: '', preferences: { theme: 'light' } },
        },
        newUser: {
          schema: rc_object({
            name: rc_string,
            settings: rc_object({ theme: rc_string }),
          }),
          default: { name: '', settings: { theme: 'light' } },
          initializeFrom: (getOtherItemValue) => {
            const old = getOtherItemValue('oldUser', false);
            if (old.username) {
              return {
                name: old.username,
                settings: { theme: old.preferences.theme },
              };
            }
            return undefined;
          },
        },
      },
    });

    expect(localStore.get('newUser')).toEqual({
      name: 'john',
      settings: { theme: 'dark' },
    });
    // Verify it was persisted
    expect(localStorage.getItem('slsm||newUser')).not.toBeNull();
  });

  test('returns default when initializeFrom returns undefined', () => {
    const localStore = createSmartLocalStorage<{
      source: { value: string };
      target: { data: string };
    }>({
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: '' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: () => undefined,
        },
      },
    });

    expect(localStore.get('target')).toEqual({ data: 'default' });
  });

  test('validates initialized value and falls back to default on invalid', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStorage.setItem('slsm||source', JSON.stringify({ value: 'test' }));

    const localStore = createSmartLocalStorage<{
      source: { value: string };
      target: { data: string };
    }>({
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: '' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: () => {
            return { data: 123 } as unknown as { data: string };
          },
        },
      },
    });

    expect(localStore.get('target')).toEqual({ data: 'default' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] initializeFrom value failed validation',
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });

  test('handles errors in initializeFrom gracefully', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const localStore = createSmartLocalStorage<{
      target: { data: string };
    }>({
      items: {
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: () => {
            throw new Error('Migration failed');
          },
        },
      },
    });

    expect(localStore.get('target')).toEqual({ data: 'default' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error during initializeFrom',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  test('initializeFrom is not called when item already exists', () => {
    const migrateFn = vi.fn();

    localStorage.setItem('slsm||target', JSON.stringify({ data: 'existing' }));

    const localStore = createSmartLocalStorage<{
      target: { data: string };
    }>({
      items: {
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: migrateFn,
        },
      },
    });

    expect(localStore.get('target')).toEqual({ data: 'existing' });
    expect(migrateFn).not.toHaveBeenCalled();
  });

  test('getOtherItemValue returns default for non-existent items', () => {
    let receivedValue: unknown;

    const localStore = createSmartLocalStorage<{
      source: { value: string };
      target: { data: string };
    }>({
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: 'source-default' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'target-default' },
          initializeFrom: (getOtherItemValue) => {
            receivedValue = getOtherItemValue('source', false);
            return undefined;
          },
        },
      },
    });

    localStore.get('target');
    expect(receivedValue).toEqual({ value: 'source-default' });
  });

  test('does not re-run initializeFrom after value is set back to default', () => {
    type Schemas = {
      source: { value: string };
      target: { data: string };
    };

    const initializeFn = vi.fn(
      (
        getOtherItemValue: <K extends keyof Schemas>(
          key: K,
          deleteAfterRead: boolean,
        ) => Schemas[K],
      ) => {
        const source = getOtherItemValue('source', true);
        if (source.value) {
          return { data: source.value };
        }
        return undefined;
      },
    );

    localStorage.setItem(
      'slsm||source',
      JSON.stringify({ value: 'migrated' }),
    );

    // First creation: initializeFrom runs and migrates data
    const store1 = createSmartLocalStorage<Schemas>({
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: '' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: initializeFn,
        },
      },
    });

    expect(store1.get('target')).toEqual({ data: 'migrated' });
    expect(initializeFn).toHaveBeenCalledTimes(1);

    // Source key should have been deleted after migration
    expect(localStorage.getItem('slsm||source')).toBeNull();

    // User explicitly sets the value back to default
    store1.set('target', { data: 'default' });
    expect(store1.get('target')).toEqual({ data: 'default' });

    initializeFn.mockClear();

    // Second creation: initializeFrom runs but source was deleted, so it
    // returns undefined and target stays at default (no re-migration)
    const store2 = createSmartLocalStorage<Schemas>({
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: '' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: initializeFn,
        },
      },
    });

    // Should remain at default, not re-migrate from source
    expect(store2.get('target')).toEqual({ data: 'default' });
    // Source was deleted so initializeFn returns undefined — no actual migration
    expect(localStorage.getItem('slsm||source')).toBeNull();
  });

  test('runs initializeFrom when session id becomes available after creation', () => {
    let sessionId: string | false = false;

    localStorage.setItem(
      'slsm-session-1||source',
      JSON.stringify({ value: 'migrated-late' }),
    );

    const localStore = createSmartLocalStorage<{
      source: { value: string };
      target: { data: string };
    }>({
      getSessionId: () => sessionId,
      items: {
        source: {
          schema: rc_object({ value: rc_string }),
          default: { value: '' },
        },
        target: {
          schema: rc_object({ data: rc_string }),
          default: { data: 'default' },
          initializeFrom: (getOtherItemValue) => {
            const source = getOtherItemValue('source', true);
            return source.value ? { data: source.value } : undefined;
          },
        },
      },
    });

    sessionId = 'session-1';

    expect(localStore.get('target')).toEqual({ data: 'migrated-late' });
    expect(localStorage.getItem('slsm-session-1||target')).toBe(
      JSON.stringify({ data: 'migrated-late' }),
    );
    expect(localStorage.getItem('slsm-session-1||source')).toBeNull();
  });

  test('initializeFrom persists ttl metadata and expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    localStorage.setItem('slsm||source', JSON.stringify('seed'));

    const localStore = createSmartLocalStorage<{
      source: string;
      target: string;
    }>({
      items: {
        source: {
          schema: rc_string,
          default: '',
        },
        target: {
          schema: rc_string,
          default: '',
          ttl: { minutes: 1 },
          initializeFrom: (getOtherItemValue) =>
            getOtherItemValue('source', false),
        },
      },
    });

    expect(localStore.get('target')).toBe('seed');

    const stored = JSON.parse(localStorage.getItem('slsm||target') ?? '{}') as {
      t?: number;
      _v?: unknown;
    };

    expect(stored._v).toBe('seed');
    expect(stored.t).toBe(toMinuteStamp(TTL_BASE_MS));

    vi.advanceTimersByTime(2 * MS_PER_MINUTE);
    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE);

    expect(localStore.get('target')).toBe('');
    expect(localStorage.getItem('slsm||target')).toBeNull();

    vi.useRealTimers();
  });

  test('multiple items reading from same source both get migrated data before source is deleted', () => {
    localStorage.setItem(
      'slsm||legacy',
      JSON.stringify({ name: 'alice', role: 'admin' }),
    );

    const localStore = createSmartLocalStorage<{
      legacy: { name: string; role: string };
      userName: string;
      userRole: string;
    }>({
      items: {
        legacy: {
          schema: rc_object({ name: rc_string, role: rc_string }),
          default: { name: '', role: '' },
        },
        userName: {
          schema: rc_string,
          default: '',
          initializeFrom: (getOtherItemValue) => {
            const old = getOtherItemValue('legacy', true);
            return old.name || undefined;
          },
        },
        userRole: {
          schema: rc_string,
          default: '',
          initializeFrom: (getOtherItemValue) => {
            const old = getOtherItemValue('legacy', true);
            return old.role || undefined;
          },
        },
      },
    });

    // Both items should have been initialized from the same source
    expect(localStore.get('userName')).toBe('alice');
    expect(localStore.get('userRole')).toBe('admin');

    // Source key should be deleted after all migrations complete
    expect(localStorage.getItem('slsm||legacy')).toBeNull();

    // Values should be persisted
    expect(localStorage.getItem('slsm||userName')).not.toBeNull();
    expect(localStorage.getItem('slsm||userRole')).not.toBeNull();
  });
});
