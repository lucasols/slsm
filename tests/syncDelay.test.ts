import { rc_array, rc_number, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { getStorageItems, reset } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
  vi.useRealTimers();
});

describe('syncDelay', () => {
  describe('debounce', () => {
    test('debounces storage writes with global syncDelay', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        counter: number;
      }>({
        items: {
          counter: { schema: rc_number, default: 0 },
        },
        syncDelay: { type: 'debounce', ms: 100 },
      });

      localStore.set('counter', 1);

      // Storage should not be updated immediately
      expect(localStorage.getItem('slsm||counter')).toBeNull();
      expect(localStore.get('counter')).toBe(1);

      // Wait for debounce
      vi.advanceTimersByTime(100);

      // Now storage should be updated
      expect(localStorage.getItem('slsm||counter')).toBe('1');

      vi.useRealTimers();
    });

    test('debounces multiple rapid updates', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        counter: number;
      }>({
        items: {
          counter: { schema: rc_number, default: 0 },
        },
        syncDelay: { type: 'debounce', ms: 100 },
      });

      localStore.set('counter', 1);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 2);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 3);

      // No storage writes yet
      expect(localStorage.getItem('slsm||counter')).toBeNull();
      expect(localStore.get('counter')).toBe(3);

      // Wait for debounce
      vi.advanceTimersByTime(100);

      // Should only write the final value
      expect(localStorage.getItem('slsm||counter')).toBe('3');

      vi.useRealTimers();
    });

    test('item-level syncDelay overrides global syncDelay', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        fast: number;
        slow: number;
      }>({
        items: {
          fast: {
            schema: rc_number,
            default: 0,
            syncDelay: { type: 'debounce', ms: 50 },
          },
          slow: {
            schema: rc_number,
            default: 0,
            syncDelay: { type: 'debounce', ms: 200 },
          },
        },
        syncDelay: { type: 'debounce', ms: 100 },
      });

      localStore.set('fast', 1);
      localStore.set('slow', 1);

      vi.advanceTimersByTime(50);

      // Fast should be persisted
      expect(localStorage.getItem('slsm||fast')).toBe('1');
      // Slow should not
      expect(localStorage.getItem('slsm||slow')).toBeNull();

      vi.advanceTimersByTime(150);

      // Now slow should be persisted
      expect(localStorage.getItem('slsm||slow')).toBe('1');

      vi.useRealTimers();
    });

    test('item-level syncDelay=false disables global syncDelay', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        immediate: number;
        delayed: number;
      }>({
        items: {
          immediate: {
            schema: rc_number,
            default: 0,
            syncDelay: false,
          },
          delayed: {
            schema: rc_number,
            default: 0,
          },
        },
        syncDelay: { type: 'debounce', ms: 100 },
      });

      localStore.set('immediate', 1);
      localStore.set('delayed', 1);

      // Immediate should be persisted right away
      expect(localStorage.getItem('slsm||immediate')).toBe('1');
      // Delayed should not
      expect(localStorage.getItem('slsm||delayed')).toBeNull();

      vi.advanceTimersByTime(100);

      // Now delayed should be persisted
      expect(localStorage.getItem('slsm||delayed')).toBe('1');

      vi.useRealTimers();
    });

    test('debounce works with produce', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        items: number[];
      }>({
        items: {
          items: {
            schema: rc_array(rc_number),
            default: [],
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.produce('items', (draft) => {
        draft.push(1);
      });

      expect(localStorage.getItem('slsm||items')).toBeNull();
      expect(localStore.get('items')).toEqual([1]);

      localStore.produce('items', (draft) => {
        draft.push(2);
      });

      vi.advanceTimersByTime(100);

      expect(JSON.parse(localStorage.getItem('slsm||items') ?? '[]')).toEqual([1, 2]);

      vi.useRealTimers();
    });

    test('debounce works with getStore().setState()', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        counter: number;
      }>({
        items: {
          counter: {
            schema: rc_number,
            default: 0,
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      const store = localStore.getStore('counter');
      store.setState(1);

      expect(localStorage.getItem('slsm||counter')).toBeNull();
      expect(localStore.get('counter')).toBe(1);

      vi.advanceTimersByTime(100);

      expect(localStorage.getItem('slsm||counter')).toBe('1');

      vi.useRealTimers();
    });

    test('pending sync is canceled on delete', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        temp: string;
      }>({
        items: {
          temp: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.set('temp', 'value');

      expect(localStorage.getItem('slsm||temp')).toBeNull();

      // Delete before debounce completes
      localStore.delete('temp');

      vi.advanceTimersByTime(100);

      // Should not have written the value
      expect(localStorage.getItem('slsm||temp')).toBeNull();

      vi.useRealTimers();
    });

    test('pending sync is canceled when setting to undefined', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        temp: string | undefined;
      }>({
        items: {
          temp: {
            schema: rc_string.optional(),
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.set('temp', 'value');

      expect(localStorage.getItem('slsm||temp')).toBeNull();

      // Set to undefined before debounce completes
      localStore.set('temp', undefined);

      vi.advanceTimersByTime(100);

      // Should not have written the value
      expect(localStorage.getItem('slsm||temp')).toBeNull();
      expect(localStore.get('temp')).toBe('');

      vi.useRealTimers();
    });

    test('pending sync is canceled on clearAll', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        a: string;
        b: string;
      }>({
        items: {
          a: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
          b: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.set('a', 'value1');
      localStore.set('b', 'value2');

      expect(localStorage.getItem('slsm||a')).toBeNull();
      expect(localStorage.getItem('slsm||b')).toBeNull();

      // Clear all before debounce completes
      localStore.clearAll();

      vi.advanceTimersByTime(100);

      // Should not have written the values
      expect(getStorageItems()).toMatchInlineSnapshot(`
        {
          "local": {},
          "session": {},
        }
      `);

      vi.useRealTimers();
    });

    test('debounce does not affect cleanup operations', () => {
      vi.useFakeTimers();

      // Set an initial value that will need cleanup
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
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      // Trigger store initialization which will apply auto-prune
      localStore.get('items');

      // Auto-prune should happen immediately on load, not debounced
      expect(JSON.parse(localStorage.getItem('slsm||items') ?? '[]')).toEqual([7, 8, 9, 10]);

      vi.useRealTimers();
    });

    test('maxWaitMs forces write after maximum wait time', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        counter: number;
      }>({
        items: {
          counter: {
            schema: rc_number,
            default: 0,
            syncDelay: { type: 'debounce', ms: 100, maxWaitMs: 300 },
          },
        },
      });

      localStore.set('counter', 1);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 2);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 3);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 4);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 5);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 6);
      vi.advanceTimersByTime(50);

      // Total time elapsed: 300ms
      // Should have forced a write due to maxWaitMs

      expect(localStorage.getItem('slsm||counter')).toBe('6');

      vi.useRealTimers();
    });

    test('maxWaitMs works with continuous rapid updates', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        text: string;
      }>({
        items: {
          text: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 50, maxWaitMs: 200 },
          },
        },
      });

      // Update every 40ms for 10 times (400ms total)
      for (let i = 1; i <= 10; i++) {
        localStore.set('text', `update-${i}`);
        vi.advanceTimersByTime(40);

        if (i === 5) {
          // At 200ms (5 * 40), maxWaitMs should trigger
          expect(localStorage.getItem('slsm||text')).toBe('"update-5"');
        }
      }

      // After all updates, the last value should be persisted
      vi.advanceTimersByTime(50);
      expect(localStorage.getItem('slsm||text')).toBe('"update-10"');

      vi.useRealTimers();
    });

    test('maxWaitMs resets after a write completes', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        counter: number;
      }>({
        items: {
          counter: {
            schema: rc_number,
            default: 0,
            syncDelay: { type: 'debounce', ms: 100, maxWaitMs: 300 },
          },
        },
      });

      // First batch of updates
      localStore.set('counter', 1);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 2);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 3);

      // Wait for debounce to complete (200ms elapsed + 100ms)
      vi.advanceTimersByTime(200);

      // Value should be persisted
      expect(localStorage.getItem('slsm||counter')).toBe('3');

      // Start new batch of updates
      localStore.set('counter', 4);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 5);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 6);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 7);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 8);
      vi.advanceTimersByTime(50);
      localStore.set('counter', 9);

      // After 250ms from the first update in second batch, maxWaitMs should trigger
      vi.advanceTimersByTime(50);

      expect(localStorage.getItem('slsm||counter')).toBe('9');

      vi.useRealTimers();
    });
  });

  describe('onIdleCallback', () => {
    test('delays storage writes until idle', () => {
      let idleCallback: (() => void) | undefined;

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        idleCallback = cb;
        return 123;
      });

      const localStore = createSmartLocalStorage<{
        data: string;
      }>({
        items: {
          data: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'onIdleCallback', timeoutMs: 1000 },
          },
        },
      });

      localStore.set('data', 'value');

      // Should not be written yet
      expect(localStorage.getItem('slsm||data')).toBeNull();
      expect(localStore.get('data')).toBe('value');

      // Trigger idle callback
      expect(idleCallback).toBeDefined();
      idleCallback!();

      // Now should be written
      expect(localStorage.getItem('slsm||data')).toBe('"value"');

      // Restore
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());
    });

    test('cancels pending idle callback on delete', () => {
      const mockCancel = vi.fn();

      vi.stubGlobal('requestIdleCallback', (cb_: () => void) => {
        return 123;
      });

      vi.stubGlobal('cancelIdleCallback', mockCancel);

      const localStore = createSmartLocalStorage<{
        temp: string;
      }>({
        items: {
          temp: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'onIdleCallback', timeoutMs: 1000 },
          },
        },
      });

      localStore.set('temp', 'value');
      localStore.delete('temp');

      // Cancel should have been called
      expect(mockCancel).toHaveBeenCalled();

      // Restore
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());
    });
  });

  describe('edge cases', () => {
    test('syncDelay works with session-scoped items', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        data: string;
      }>({
        getSessionId: () => 'test-session',
        items: {
          data: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.set('data', 'value');

      expect(localStorage.getItem('slsm-test-session||data')).toBeNull();

      vi.advanceTimersByTime(100);

      expect(localStorage.getItem('slsm-test-session||data')).toBe('"value"');

      vi.useRealTimers();
    });

    test('syncDelay works with sessionStorage', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        temp: string;
      }>({
        items: {
          temp: {
            schema: rc_string,
            default: '',
            useSessionStorage: true,
            syncDelay: { type: 'debounce', ms: 100 },
          },
        },
      });

      localStore.set('temp', 'value');

      expect(sessionStorage.getItem('slsm|s||temp')).toBeNull();

      vi.advanceTimersByTime(100);

      expect(sessionStorage.getItem('slsm|s||temp')).toBe('"value"');

      vi.useRealTimers();
    });

    test('multiple keys can have different sync delays', () => {
      vi.useFakeTimers();

      const localStore = createSmartLocalStorage<{
        fast: string;
        medium: string;
        slow: string;
      }>({
        items: {
          fast: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 50 },
          },
          medium: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 100 },
          },
          slow: {
            schema: rc_string,
            default: '',
            syncDelay: { type: 'debounce', ms: 200 },
          },
        },
      });

      localStore.set('fast', 'f');
      localStore.set('medium', 'm');
      localStore.set('slow', 's');

      expect(localStorage.getItem('slsm||fast')).toBeNull();
      expect(localStorage.getItem('slsm||medium')).toBeNull();
      expect(localStorage.getItem('slsm||slow')).toBeNull();

      vi.advanceTimersByTime(50);

      expect(localStorage.getItem('slsm||fast')).toBe('"f"');
      expect(localStorage.getItem('slsm||medium')).toBeNull();
      expect(localStorage.getItem('slsm||slow')).toBeNull();

      vi.advanceTimersByTime(50);

      expect(localStorage.getItem('slsm||medium')).toBe('"m"');
      expect(localStorage.getItem('slsm||slow')).toBeNull();

      vi.advanceTimersByTime(100);

      expect(localStorage.getItem('slsm||slow')).toBe('"s"');

      vi.useRealTimers();
    });
  });
});
