import { rc_array, rc_number, rc_object, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset, mockQuota } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
});

const TTL_BASE_MS = Date.UTC(2025, 0, 1);
const toMinuteStamp = (timestamp: number) =>
  Math.round((timestamp - TTL_BASE_MS) / 60_000);

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
