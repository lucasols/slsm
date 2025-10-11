import { rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockQuota, getBytes, mockedLocalStorage } =
  mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
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

    localStore.set('lowPriority', 'x'.repeat(30));
    localStore.set('mediumPriority', 'x'.repeat(30));
    localStore.set('highPriority', 'x'.repeat(30));

    const currentSize = getBytes();
    mockQuota(currentSize + 50);

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
        noPriority: { schema: rc_string, default: '' },
        withPriority: { schema: rc_string, default: '', priority: 5 },
        newItem: { schema: rc_string, default: '' },
      },
    });

    localStore.set('noPriority', 'x'.repeat(30));
    localStore.set('withPriority', 'x'.repeat(30));

    const currentSize = getBytes();
    mockQuota(currentSize + 50);

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

    session1Store.set('a', 'x'.repeat(20));
    session1Store.set('b', 'x'.repeat(20));

    session2Store.set('a', 'x'.repeat(20));

    const currentSize = getBytes();
    mockQuota(currentSize + 40);

    session2Store.set('b', 'x'.repeat(20));

    const items = getStorageItems();

    expect(items.local['slsm-session1||b']).toBeUndefined();
    expect(items.local['slsm-session1||a']).toBeDefined();
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

    session1Store.set('item', 'x'.repeat(60));
    session2Store.set('item', 'x'.repeat(60));

    const currentSize = getBytes();
    mockQuota(currentSize + 80);

    session2Store.set('newItem', 'x'.repeat(60));

    const items = getStorageItems();

    expect(items.local['slsm-session1||item']).toBeUndefined();
    expect(items.local['slsm-session2||item']).toBeDefined();
    expect(items.local['slsm-session2||newItem']).toBeDefined();
  });
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

  localStore.set('newItem', newValue);

  expect(localStorage.getItem('slsm||ttlKey')).toBeNull();
  expect(localStorage.getItem('slsm||retained')).toBe('"keep"');
  expect(JSON.parse(localStorage.getItem('slsm||newItem') ?? 'null')).toBe(
    newValue,
  );

  mockQuota(Infinity);
  vi.useRealTimers();
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
