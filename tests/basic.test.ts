import {
  rc_array,
  rc_boolean,
  rc_number,
  rc_object,
  rc_string,
} from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset } = mockEnv();

beforeEach(() => {
  reset();
});

test('set and read a value in store', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string, default: '' },
    },
  });

  localStore.set('a', 'hello');

  expect(localStore.get('a')).toBe('hello');

  expect(localStorage.getItem('slsm||a')).toBe('"hello"');
});

test('get value from store that is set in localStorage', () => {
  localStorage.setItem('slsm||a', '"hello"');

  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string, default: '' },
    },
  });

  expect(localStore.get('a')).toBe('hello');
});

test('produce value', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  localStore.produce('a', (draft) => {
    draft.push('hello');
  });

  expect(localStore.get('a')).toEqual(['hello']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello"]');

  localStore.produce('a', (draft) => {
    draft.push('world');
  });

  expect(localStore.get('a')).toEqual(['hello', 'world']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
});

describe('produce with undefined/null', () => {
  test('produce on item that does not exist yet uses default value', () => {
    const localStore = createSmartLocalStorage<{
      a: string[];
    }>({
      items: {
        a: { schema: rc_array(rc_string), default: ['default'] },
      },
    });

    expect(localStorage.getItem('slsm||a')).toBeNull();

    localStore.produce('a', (draft) => {
      draft.push('added');
    });

    expect(localStore.get('a')).toEqual(['default', 'added']);
    expect(localStorage.getItem('slsm||a')).toBe('["default","added"]');
  });

  test('produce recipe returning undefined keeps existing value', () => {
    const localStore = createSmartLocalStorage<{
      a: string[];
    }>({
      items: {
        a: { schema: rc_array(rc_string), default: [] },
      },
    });

    localStore.set('a', ['hello', 'world']);

    expect(localStore.get('a')).toEqual(['hello', 'world']);

    localStore.produce('a', () => {
      return undefined;
    });

    expect(localStore.get('a')).toEqual(['hello', 'world']);
    expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
  });

  test('produce can set value to null if schema allows', () => {
    const localStore = createSmartLocalStorage<{
      a: string[] | null;
    }>({
      items: {
        a: { schema: rc_array(rc_string).orNull(), default: null },
      },
    });

    localStore.set('a', ['hello']);

    expect(localStore.get('a')).toEqual(['hello']);

    localStore.produce('a', () => {
      return null;
    });

    expect(localStore.get('a')).toBeNull();
    expect(localStorage.getItem('slsm||a')).toBeNull();
  });

  test('produce with empty array default on non-existent item', () => {
    const localStore = createSmartLocalStorage<{
      a: { items: string[] };
    }>({
      items: {
        a: {
          schema: rc_object({ items: rc_array(rc_string) }),
          default: { items: [] },
        },
      },
    });

    expect(localStorage.getItem('slsm||a')).toBeNull();

    localStore.produce('a', (draft) => {
      draft.items.push('first');
    });

    expect(localStore.get('a')).toEqual({ items: ['first'] });
  });

  test('produce mutating draft without returning keeps changes', () => {
    const localStore = createSmartLocalStorage<{
      a: { count: number };
    }>({
      items: {
        a: {
          schema: rc_object({ count: rc_number }),
          default: { count: 0 },
        },
      },
    });

    localStore.set('a', { count: 5 });

    localStore.produce('a', (draft) => {
      draft.count += 10;
    });

    expect(localStore.get('a')).toEqual({ count: 15 });
  });
});

test('set with setter function', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  localStore.set('a', (currentValue) => [...currentValue, 'hello']);

  expect(localStore.get('a')).toEqual(['hello']);

  localStore.set('a', (currentValue) => [...currentValue, 'world']);

  expect(localStore.get('a')).toEqual(['hello', 'world']);
  expect(localStorage.getItem('slsm||a')).toBe('["hello","world"]');
});

test('delete value', () => {
  const localStore = createSmartLocalStorage<{
    a: string;
  }>({
    items: {
      a: { schema: rc_string, default: '' },
    },
  });

  localStore.set('a', 'hello');

  localStore.delete('a');

  expect(localStore.get('a')).toBe('');
  expect(localStorage.getItem('slsm||a')).toBeNull();
});

describe('set to undefined or default deletes item', () => {
  test('set item to undefined directly', () => {
    const localStore = createSmartLocalStorage<{
      a: string | undefined;
    }>({
      items: {
        a: { schema: rc_string.optional(), default: '' },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm||a')).toBe('"hello"');

    localStore.set('a', undefined);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();
  });

  test('set item to undefined using setter function', () => {
    const localStore = createSmartLocalStorage<{
      a: string | undefined;
    }>({
      items: {
        a: { schema: rc_string.optional(), default: '' },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');

    localStore.set('a', () => undefined);

    expect(localStore.get('a')).toBe('');
    expect(localStorage.getItem('slsm||a')).toBeNull();
  });

  test('set item to default string value deletes storage', () => {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: { schema: rc_string, default: 'default' },
      },
    });

    localStore.set('a', 'hello');

    expect(localStore.get('a')).toBe('hello');
    expect(localStorage.getItem('slsm||a')).toBe('"hello"');

    localStore.set('a', 'default');

    expect(localStore.get('a')).toBe('default');
    expect(localStorage.getItem('slsm||a')).toBeNull();
  });

  test('set item to default number value deletes storage', () => {
    const localStore = createSmartLocalStorage<{
      count: number;
    }>({
      items: {
        count: { schema: rc_number, default: 0 },
      },
    });

    localStore.set('count', 42);

    expect(localStore.get('count')).toBe(42);
    expect(localStorage.getItem('slsm||count')).toBe('42');

    localStore.set('count', 0);

    expect(localStore.get('count')).toBe(0);
    expect(localStorage.getItem('slsm||count')).toBeNull();
  });

  test('set item to default object value deletes storage', () => {
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

    localStore.set('config', { theme: 'dark', fontSize: 16 });

    expect(localStore.get('config')).toEqual({ theme: 'dark', fontSize: 16 });
    expect(localStorage.getItem('slsm||config')).not.toBeNull();

    localStore.set('config', { theme: 'light', fontSize: 14 });

    expect(localStore.get('config')).toEqual({ theme: 'light', fontSize: 14 });
    expect(localStorage.getItem('slsm||config')).toBeNull();
  });

  test('set item to default array value deletes storage', () => {
    const localStore = createSmartLocalStorage<{
      items: string[];
    }>({
      items: {
        items: { schema: rc_array(rc_string), default: [] },
      },
    });

    localStore.set('items', ['a', 'b', 'c']);

    expect(localStore.get('items')).toEqual(['a', 'b', 'c']);
    expect(localStorage.getItem('slsm||items')).toBe('["a","b","c"]');

    localStore.set('items', []);

    expect(localStore.get('items')).toEqual([]);
    expect(localStorage.getItem('slsm||items')).toBeNull();
  });

  test('set to default with setter function deletes storage', () => {
    const localStore = createSmartLocalStorage<{
      count: number;
    }>({
      items: {
        count: { schema: rc_number, default: 0 },
      },
    });

    localStore.set('count', 10);

    expect(localStore.get('count')).toBe(10);
    expect(localStorage.getItem('slsm||count')).toBe('10');

    localStore.set('count', () => 0);

    expect(localStore.get('count')).toBe(0);
    expect(localStorage.getItem('slsm||count')).toBeNull();
  });
});

test('item validation', () => {
  {
    const localStore = createSmartLocalStorage<{
      a: string;
    }>({
      items: {
        a: { schema: rc_string, default: '' },
      },
    });

    localStore.set('a', 'hello');
  }

  {
    const localStore = createSmartLocalStorage<{
      a: number;
    }>({
      items: {
        a: { schema: rc_number, default: 0 },
      },
    });

    expect(localStore.get('a')).toBe(0);

    localStore.set('a', 1);

    expect(localStore.get('a')).toBe(1);
  }
});

test('loading invalid JSON from localStorage returns default', () => {
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  localStorage.setItem('slsm||data', '{invalid json}');

  const localStore = createSmartLocalStorage<{
    data: string;
  }>({
    items: {
      data: { schema: rc_string, default: 'fallback' },
    },
  });

  expect(localStore.get('data')).toBe('fallback');
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    '[slsm] error parsing value',
    expect.anything(),
  );

  consoleErrorSpy.mockRestore();
});

test('loading valid JSON but invalid shape from localStorage returns default', () => {
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  localStorage.setItem('slsm||user', JSON.stringify({ wrong: 'shape' }));

  const localStore = createSmartLocalStorage<{
    user: { name: string; age: number };
  }>({
    items: {
      user: {
        schema: rc_object({
          name: rc_string,
          age: rc_number,
        }),
        default: { name: 'Guest', age: 0 },
      },
    },
  });

  expect(localStore.get('user')).toEqual({ name: 'Guest', age: 0 });
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    '[slsm] error parsing value',
    expect.anything(),
  );

  consoleErrorSpy.mockRestore();
});

describe('data migration', () => {
  test('migrate old schema shape to new schema shape', () => {
    localStorage.setItem(
      'slsm||user',
      JSON.stringify({ name: 'John', age: 30 }),
    );

    const localStore = createSmartLocalStorage<{
      user: { name: string; age: number; email: string };
    }>({
      items: {
        user: {
          schema: rc_object({
            name: rc_string,
            age: rc_number,
            email: rc_string,
          }),
          default: { name: '', age: 0, email: '' },
          migrate: (invalidValue) => {
            if (
              invalidValue &&
              typeof invalidValue === 'object' &&
              'name' in invalidValue &&
              'age' in invalidValue &&
              !('email' in invalidValue)
            ) {
              return {
                name: invalidValue.name as string,
                age: invalidValue.age as number,
                email: 'migrated@example.com',
              };
            }
            return undefined;
          },
        },
      },
    });

    expect(localStore.get('user')).toEqual({
      name: 'John',
      age: 30,
      email: 'migrated@example.com',
    });
  });

  test('migrate returns undefined falls back to default', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStorage.setItem('slsm||data', JSON.stringify({ wrong: 'data' }));

    const localStore = createSmartLocalStorage<{
      data: { value: string };
    }>({
      items: {
        data: {
          schema: rc_object({
            value: rc_string,
          }),
          default: { value: 'default' },
          migrate: () => {
            return undefined;
          },
        },
      },
    });

    expect(localStore.get('data')).toEqual({ value: 'default' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error parsing value',
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });

  test('migrate returns invalid value falls back to default', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStorage.setItem('slsm||data', JSON.stringify({ wrong: 'data' }));

    const localStore = createSmartLocalStorage<{
      data: { value: string };
    }>({
      items: {
        data: {
          schema: rc_object({
            value: rc_string,
          }),
          default: { value: 'default' },
          migrate: () => {
            return { value: 123 } as unknown as { value: string };
          },
        },
      },
    });

    expect(localStore.get('data')).toEqual({ value: 'default' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error parsing value',
      expect.anything(),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] migrated value failed validation',
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });

  test('migrate is not called when data is valid', () => {
    const migrateFn = vi.fn();

    localStorage.setItem(
      'slsm||user',
      JSON.stringify({ name: 'John', age: 30, email: 'john@example.com' }),
    );

    const localStore = createSmartLocalStorage<{
      user: { name: string; age: number; email: string };
    }>({
      items: {
        user: {
          schema: rc_object({
            name: rc_string,
            age: rc_number,
            email: rc_string,
          }),
          default: { name: '', age: 0, email: '' },
          migrate: migrateFn,
        },
      },
    });

    expect(localStore.get('user')).toEqual({
      name: 'John',
      age: 30,
      email: 'john@example.com',
    });
    expect(migrateFn).not.toHaveBeenCalled();
  });

  test('migrate error is caught and falls back to default', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStorage.setItem('slsm||data', JSON.stringify({ wrong: 'data' }));

    const localStore = createSmartLocalStorage<{
      data: { value: string };
    }>({
      items: {
        data: {
          schema: rc_object({
            value: rc_string,
          }),
          default: { value: 'default' },
          migrate: () => {
            throw new Error('Migration failed');
          },
        },
      },
    });

    expect(localStore.get('data')).toEqual({ value: 'default' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error parsing value',
      expect.anything(),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error during migration',
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });
});

test('bug: store keeps reference of set values', () => {
  const localStore = createSmartLocalStorage<{
    a: string[];
  }>({
    items: {
      a: { schema: rc_array(rc_string), default: [] },
    },
  });

  const array = ['hello'];

  localStore.set('a', array);

  array.unshift('world', '!');

  array.push('!');

  expect(localStore.get('a')).toEqual(['hello']);
});

test('set with setter function using default value', () => {
  const localStore = createSmartLocalStorage<{
    a: boolean;
  }>({
    items: {
      a: { schema: rc_boolean, default: true },
    },
  });

  localStore.set('a', (currentValue) => !currentValue);

  expect(localStore.get('a')).toBe(false);
});

describe('produceWithNullableFallback', () => {
  test('uses fallback when value is null', () => {
    const localStore = createSmartLocalStorage<{
      data: { items: string[] } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ items: rc_array(rc_string) }).orNull(),
          default: null,
        },
      },
    });

    // Value is null (default), should use fallback
    localStore.produceWithFallback('data', { items: [] }, (draft) => {
      draft.items.push('first');
    });

    expect(localStore.get('data')).toEqual({ items: ['first'] });
    expect(localStorage.getItem('slsm||data')).not.toBeNull();
  });

  test('works when returning to default from non-default', () => {
    const localStore = createSmartLocalStorage<{
      data: { items: string[] } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ items: rc_array(rc_string) }).orNull(),
          default: null,
        },
      },
    });

    // Set a value first
    localStore.set('data', { items: ['existing'] });
    expect(localStore.get('data')).toEqual({ items: ['existing'] });

    // Now use produceWithNullableFallback to modify it
    localStore.produceWithFallback('data', { items: [] }, (draft) => {
      draft.items.push('added');
    });

    expect(localStore.get('data')).toEqual({ items: ['existing', 'added'] });
    expect(localStorage.getItem('slsm||data')).not.toBeNull();
  });

  test('uses actual value when it exists', () => {
    const localStore = createSmartLocalStorage<{
      data: { items: string[] } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ items: rc_array(rc_string) }).orNull(),
          default: null,
        },
      },
    });

    // Set an actual value first
    localStore.set('data', { items: ['existing'] });

    // Should use the actual value, not the fallback
    localStore.produceWithFallback('data', { items: [] }, (draft) => {
      draft.items.push('added');
    });

    expect(localStore.get('data')).toEqual({ items: ['existing', 'added'] });
  });

  test('recipe returning undefined keeps existing value', () => {
    const localStore = createSmartLocalStorage<{
      data: { items: string[] } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ items: rc_array(rc_string) }).orNull(),
          default: null,
        },
      },
    });

    localStore.set('data', { items: ['hello'] });

    // Recipe returns undefined - should keep existing value
    localStore.produceWithFallback('data', { items: [] }, () => {
      return undefined;
    });

    expect(localStore.get('data')).toEqual({ items: ['hello'] });
  });

  test('can return new value from recipe', () => {
    const localStore = createSmartLocalStorage<{
      data: { items: string[] } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ items: rc_array(rc_string) }).orNull(),
          default: null,
        },
      },
    });

    // Start with null
    localStore.produceWithFallback('data', { items: ['fallback'] }, (draft) => {
      return { items: [...draft.items, 'returned'] };
    });

    expect(localStore.get('data')).toEqual({ items: ['fallback', 'returned'] });
  });

  test('deletes storage when resulting value equals default', () => {
    const localStore = createSmartLocalStorage<{
      data: { count: number } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ count: rc_number }).orNull(),
          default: null,
        },
      },
    });

    // Set a value
    localStore.set('data', { count: 5 });
    expect(localStorage.getItem('slsm||data')).not.toBeNull();

    // Produce to set it back to null (default)
    localStore.produceWithFallback('data', { count: 0 }, () => {
      return null;
    });

    expect(localStore.get('data')).toBeNull();
    // Storage should be deleted since value equals default
    expect(localStorage.getItem('slsm||data')).toBeNull();
  });

  test('works with mutating draft without returning', () => {
    const localStore = createSmartLocalStorage<{
      counter: { value: number } | null;
    }>({
      items: {
        counter: {
          schema: rc_object({ value: rc_number }).orNull(),
          default: null,
        },
      },
    });

    // Start with null, use fallback
    localStore.produceWithFallback('counter', { value: 0 }, (draft) => {
      draft.value = 10;
    });

    expect(localStore.get('counter')).toEqual({ value: 10 });

    // Mutate again with existing value
    localStore.produceWithFallback('counter', { value: 0 }, (draft) => {
      draft.value += 5;
    });

    expect(localStore.get('counter')).toEqual({ value: 15 });
  });

  test('works with complex nested structures', () => {
    type UserData = {
      profile: { name: string; age: number };
      settings: { theme: string };
    } | null;

    const localStore = createSmartLocalStorage<{
      user: UserData;
    }>({
      items: {
        user: {
          schema: rc_object({
            profile: rc_object({ name: rc_string, age: rc_number }),
            settings: rc_object({ theme: rc_string }),
          }).orNull(),
          default: null,
        },
      },
    });

    const fallback = {
      profile: { name: 'Guest', age: 0 },
      settings: { theme: 'light' },
    };

    // First use with null value
    localStore.produceWithFallback('user', fallback, (draft) => {
      draft.profile.name = 'John';
      draft.profile.age = 30;
    });

    expect(localStore.get('user')).toEqual({
      profile: { name: 'John', age: 30 },
      settings: { theme: 'light' },
    });

    // Second use with existing value
    localStore.produceWithFallback('user', fallback, (draft) => {
      draft.settings.theme = 'dark';
    });

    expect(localStore.get('user')).toEqual({
      profile: { name: 'John', age: 30 },
      settings: { theme: 'dark' },
    });
  });

  test('works with arrays', () => {
    const localStore = createSmartLocalStorage<{
      tags: string[] | null;
    }>({
      items: {
        tags: {
          schema: rc_array(rc_string).orNull(),
          default: null,
        },
      },
    });

    // First use with null
    localStore.produceWithFallback('tags', [], (draft) => {
      draft.push('tag1', 'tag2');
    });

    expect(localStore.get('tags')).toEqual(['tag1', 'tag2']);

    // Second use with existing value
    localStore.produceWithFallback('tags', [], (draft) => {
      draft.push('tag3');
    });

    expect(localStore.get('tags')).toEqual(['tag1', 'tag2', 'tag3']);
  });

  test('fallback is not persisted when recipe returns null', () => {
    const localStore = createSmartLocalStorage<{
      data: { value: number } | null;
    }>({
      items: {
        data: {
          schema: rc_object({ value: rc_number }).orNull(),
          default: null,
        },
      },
    });

    // Recipe receives fallback but returns null
    localStore.produceWithFallback('data', { value: 100 }, () => {
      // Explicitly return null instead of using fallback
      return null;
    });

    expect(localStore.get('data')).toBeNull();
    expect(localStorage.getItem('slsm||data')).toBeNull();
  });
});
