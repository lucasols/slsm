import { rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockedLocalStorage } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
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
