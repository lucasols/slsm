import { rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockedLocalStorage } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
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

describe('sessionStorage with session id', () => {
  test('set to undefined works with session scoped items', () => {
    const localStore = createSmartLocalStorage<{
      a: string | undefined;
    }>({
      getSessionId: () => 'test-session',
      items: {
        a: { schema: rc_string.optional(), default: '' },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm-test-session||a')).toBe('"hello"');

    localStore.set('a', undefined);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm-test-session||a')).toBeNull();
  });

  test('set to undefined works with sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string | undefined;
    }>({
      items: {
        a: {
          schema: rc_string.optional(),
          default: '',
          useSessionStorage: true,
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(sessionStorage.getItem('slsm|s||a')).toBe('"hello"');

    localStore.set('a', undefined);

    expect(localStore.get('a')).toBe('');
    expect(sessionStorage.getItem('slsm|s||a')).toBeNull();
  });

  test('set to default works with session scoped items', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      getSessionId: () => 'test-session',
      items: {
        a: { schema: rc_string, default: 'default' },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm-test-session||a')).toBe('"hello"');

    localStore.set('a', 'default');

    expect(localStore.get('a')).toBe('default');
    expect(localStorage.getItem('slsm-test-session||a')).toBeNull();
  });

  test('set to default works with sessionStorage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: {
          schema: rc_string,
          default: 'default',
          useSessionStorage: true,
        },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(sessionStorage.getItem('slsm|s||a')).toBe('"hello"');

    localStore.set('a', 'default');

    expect(localStore.get('a')).toBe('default');
    expect(sessionStorage.getItem('slsm|s||a')).toBeNull();
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

test('ignores storage events for stale item keys', () => {
  const localStore = createSmartLocalStorage<{
    known: string;
  }>({
    items: {
      known: { schema: rc_string, default: '', syncTabsState: true },
    },
  });

  localStore.set('known', 'current');

  expect(() => {
    mockedLocalStorage.mockExternalChange('slsm||removedItem', null);
  }).not.toThrow();

  expect(localStore.get('known')).toBe('current');
});

test('clearAll ignores stale item keys', () => {
  const localStore = createSmartLocalStorage<{
    known: string;
  }>({
    items: {
      known: { schema: rc_string, default: '' },
    },
  });

  localStore.set('known', 'current');
  localStorage.setItem('slsm||removedItem', '"stale"');

  expect(() => {
    localStore.clearAll();
  }).not.toThrow();

  expect(getStorageItems()).toMatchInlineSnapshot(`
    {
      "local": {},
      "session": {},
    }
  `);
});
