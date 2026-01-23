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
            const old = getOtherItemValue('oldUser');
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
            receivedValue = getOtherItemValue('source');
            return undefined;
          },
        },
      },
    });

    localStore.get('target');
    expect(receivedValue).toEqual({ value: 'source-default' });
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
            getOtherItemValue('source'),
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
});
