import { rc_array, rc_number, rc_object, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset, mockQuota } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
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
    localStorage.setItem(
      'slsm||items',
      JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    );

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
    expect(JSON.parse(localStorage.getItem('slsm||items') ?? '[]')).toEqual([
      7, 8, 9, 10,
    ]);
  });

  test('autoPruneBySize is applied when loading oversized value from storage', () => {
    mockQuota(Infinity);

    type Item = { messages: string[] };

    const largeMessages = Array.from({ length: 100 }, (_, i) => `Message ${i}`);
    localStorage.setItem(
      'slsm||chat',
      JSON.stringify({ messages: largeMessages }),
    );

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

    const largeMessages = Array.from(
      { length: 100 },
      (_, i) => `Message with long text ${i}`,
    );
    localStorage.setItem(
      'slsm||chat',
      JSON.stringify({ messages: largeMessages }),
    );

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
