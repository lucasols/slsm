// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { useCallback } from 'react';
import { rc_number, rc_object, rc_string } from 'runcheck';
import { beforeEach, expect, test } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset, mockedLocalStorage } = mockEnv();

beforeEach(() => {
  reset();
});

test('useKey', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: {
        schema: rc_string,
        syncTabsState: true,
      },
    },
  });

  const { result } = renderHook(() => {
    return localStore.useKey('a');
  });

  expect(result.current).toBe(undefined);

  act(() => {
    localStore.set('a', 'hello');
  });

  expect(result.current).toBe('hello');

  act(() => {
    mockedLocalStorage.mockExternalChange('slsm||a', '"world"');
  });

  expect(result.current).toBe('world');
});

test('useKey with selector', () => {
  const localStore = createSmartLocalStorage<{
    a: { b: string; c: number };
  }>({
    items: {
      a: {
        schema: rc_object({ b: rc_string, c: rc_number }),
        syncTabsState: true,
      },
    },
  });

  const { result } = renderHook(() => {
    return localStore.useKeyWithSelector('a')(
      useCallback((value) => value?.b, []),
    );
  });

  expect(result.current).toBe(undefined);

  act(() => {
    localStore.set('a', { b: 'hello', c: 1 });
  });

  expect(result.current).toBe('hello');

  act(() => {
    mockedLocalStorage.mockExternalChange('slsm||a', '{"b":"world","c":2}');
  });

  expect(result.current).toBe('world');
});

test('useKey with selector with external deps', () => {
  const localStore = createSmartLocalStorage<{
    a: { b: string; c: number };
  }>({
    items: {
      a: { schema: rc_object({ b: rc_string, c: rc_number }) },
    },
  });

  const { result, rerender } = renderHook(
    ({ value }: { value: number }) => {
      return localStore.useKeyWithSelector('a')(
        useCallback((current) => (current?.c ?? 0) + value, [value]),
      );
    },
    {
      initialProps: { value: 1 },
    },
  );

  expect(result.current).toBe(1);

  act(() => {
    localStore.set('a', { b: 'hello', c: 1 });
  });

  expect(result.current).toBe(2);

  rerender({ value: 2 });

  expect(result.current).toBe(3);
});

test('useKey load value previously set', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string },
    },
  });

  mockedLocalStorage.storage.setItem('slsm||a', '"hello"');

  const { result } = renderHook(() => {
    return localStore.useKey('a');
  });

  expect(result.current).toBe('hello');
});

test('useKey with selector load value previously set', () => {
  const localStore = createSmartLocalStorage<{
    a: { b: string; c: number };
  }>({
    items: {
      a: { schema: rc_object({ b: rc_string, c: rc_number }) },
    },
  });

  mockedLocalStorage.storage.setItem('slsm||a', '{"b":"hello","c":1}');

  const { result } = renderHook(() => {
    return localStore.useKeyWithSelector('a')((value) => value?.b);
  });

  expect(result.current).toBe('hello');
});

test(
  'useKey with error parsing value',
  {
    timeout: 100,
  },
  () => {
    mockedLocalStorage.storage.setItem('slsm||a', '2');

    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: { schema: rc_string },
      },
    });

    let rerenderCount = 0;

    expect(() => {
      renderHook(() => {
        rerenderCount++;

        if (rerenderCount > 100) {
          throw new Error('Too many rerenders');
        }

        return localStore.useKey('a');
      });
    }).not.toThrow();
  },
);

test('useKey with selector should not rerender when value is the same', () => {
  mockedLocalStorage.storage.setItem('slsm||a', '{"b":"hello","c":1}');

  const localStore = createSmartLocalStorage<{
    a: { b: string; c: number };
  }>({
    items: {
      a: { schema: rc_object({ b: rc_string, c: rc_number }) },
    },
  });

  let renderCount = 0;
  let callCbCount = 0;

  const { result, rerender } = renderHook(() => {
    renderCount++;
    return localStore.useKeyWithSelector('a')(
      useCallback((value) => {
        callCbCount++;
        return value?.b;
      }, []),
    );
  });

  expect(result.current).toBe('hello');
  expect(renderCount).toBe(1);
  expect(callCbCount).toBe(1);

  // Rerender without changing the value or the selector
  rerender();
  expect(callCbCount).toBe(1);
  expect(renderCount).toBe(2);

  // Update the value but keep 'b' the same
  act(() => {
    localStore.produce('a', { b: 'hello', c: 1 }, (draft) => {
      draft.c = 2;
    });
  });
  expect(result.current).toBe('hello');
  expect(renderCount).toBe(2);

  // Update 'b' with same value
  act(() => {
    localStore.produce('a', { b: 'world', c: 2 }, (draft) => {
      draft.b = 'hello';
    });
  });
  expect(result.current).toBe('hello');
  expect(renderCount).toBe(2);
  expect(callCbCount).toBe(4);

  // Update 'b' with different value
  act(() => {
    localStore.produce('a', { b: 'world', c: 2 }, (draft) => {
      draft.b = 'hello2';
    });
  });

  expect(renderCount).toBe(3);
  expect(result.current).toBe('hello2');
  expect(callCbCount).toBe(5);
});
