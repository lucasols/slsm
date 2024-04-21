// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { useCallback } from 'react';
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
      a: {},
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
      a: {},
    },
  });

  const { result } = renderHook(() => {
    return localStore.useKeyWithSelector('a')((value) => value?.b);
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

test('useKey with selector and useExternalDeps', () => {
  const localStore = createSmartLocalStorage<{
    a: { b: string; c: number };
  }>({
    items: {
      a: {},
    },
  });

  const { result, rerender } = renderHook(
    ({ value }: { value: number }) => {
      return localStore.useKeyWithSelector('a')(
        useCallback((current) => (current?.c ?? 0) + value, [value]),
        true,
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
