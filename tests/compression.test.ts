import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { rc_array, rc_number, rc_object, rc_string } from 'runcheck';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSmartLocalStorage } from '../src/main.js';
import { mockEnv } from './utils.js';

const { reset, mockedLocalStorage } = mockEnv();

vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

beforeEach(() => {
  reset();
});

const TTL_BASE_MS = Date.UTC(2025, 0, 1);
const MS_PER_MINUTE = 60_000;

function createFflateCompression() {
  return {
    format: 'fflate-deflate',
    compressFn: (rawJsonString: string) => {
      const uint8Array = strToU8(rawJsonString);
      const compressed = deflateSync(uint8Array);
      return btoa(String.fromCharCode(...compressed));
    },
    decompressFn: (compressedString: string) => {
      const binaryString = atob(compressedString);
      const uint8Array = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
      const decompressed = inflateSync(uint8Array);
      return strFromU8(decompressed);
    },
  };
}

describe('compression', () => {
  test('basic compression and decompression with global config', () => {
    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: '' },
      },
      compress: compression,
    });

    localStore.set('data', 'hello world');

    expect(localStore.get('data')).toBe('hello world');

    const stored = localStorage.getItem('slsm||data');
    expect(stored).toBeDefined();

    const parsed = JSON.parse(stored!) as { _v: string; c: string };
    expect(parsed.c).toBe('fflate-deflate');
    expect(typeof parsed._v).toBe('string');

    const decompressed = compression.decompressFn(parsed._v);
    expect(JSON.parse(decompressed)).toBe('hello world');
  });

  test('item-level compression overrides global compression', () => {
    const globalCompression = createFflateCompression();
    const itemCompression = {
      ...createFflateCompression(),
      format: 'item-specific',
    };

    const localStore = createSmartLocalStorage<{
      globalCompressed: string;
      itemCompressed: string;
    }>({
      items: {
        globalCompressed: { schema: rc_string, default: '' },
        itemCompressed: {
          schema: rc_string,
          default: '',
          compress: itemCompression,
        },
      },
      compress: globalCompression,
    });

    localStore.set('globalCompressed', 'test1');
    localStore.set('itemCompressed', 'test2');

    const stored1 = JSON.parse(localStorage.getItem('slsm||globalCompressed')!);
    const stored2 = JSON.parse(localStorage.getItem('slsm||itemCompressed')!);

    expect(stored1.c).toBe('fflate-deflate');
    expect(stored2.c).toBe('item-specific');

    expect(localStore.get('globalCompressed')).toBe('test1');
    expect(localStore.get('itemCompressed')).toBe('test2');
  });

  test('compression with TTL metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: {
          schema: rc_string,
          default: '',
          ttl: { minutes: 5 },
        },
      },
      compress: compression,
    });

    localStore.set('data', 'test with ttl');

    expect(localStore.get('data')).toBe('test with ttl');

    const stored = JSON.parse(localStorage.getItem('slsm||data')!) as {
      _v: string;
      c: string;
    };
    expect(stored.c).toBe('fflate-deflate');

    const decompressed = compression.decompressFn(stored._v);
    const decompressedParsed = JSON.parse(decompressed) as {
      t: number;
      _v: string;
    };

    expect(decompressedParsed.t).toBeDefined();
    expect(decompressedParsed._v).toBe('test with ttl');

    vi.advanceTimersByTime(6 * MS_PER_MINUTE);
    vi.setSystemTime(TTL_BASE_MS + 6 * MS_PER_MINUTE);

    expect(localStore.get('data')).toBe('');
    expect(localStorage.getItem('slsm||data')).toBeNull();

    vi.useRealTimers();
  });

  test('compression with session storage', () => {
    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      sessionData: string;
    }>({
      items: {
        sessionData: {
          schema: rc_string,
          default: '',
          useSessionStorage: true,
        },
      },
      compress: compression,
    });

    localStore.set('sessionData', 'session value');

    expect(localStore.get('sessionData')).toBe('session value');

    const stored = JSON.parse(sessionStorage.getItem('slsm|s||sessionData')!);
    expect(stored.c).toBe('fflate-deflate');
  });

  test('format mismatch handling', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const compression = createFflateCompression();

    localStorage.setItem(
      'slsm||data',
      JSON.stringify({
        _v: 'some-compressed-data',
        c: 'different-format',
      }),
    );

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: 'fallback' },
      },
      compress: compression,
    });

    expect(localStore.get('data')).toBe('fallback');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] compression format mismatch',
      {
        expected: 'fflate-deflate',
        found: 'different-format',
      },
    );

    consoleErrorSpy.mockRestore();
  });

  test('decompression error handling', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const compression = createFflateCompression();

    localStorage.setItem(
      'slsm||data',
      JSON.stringify({
        _v: 'invalid-base64-!@#$%',
        c: 'fflate-deflate',
      }),
    );

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: 'fallback' },
      },
      compress: compression,
    });

    expect(localStore.get('data')).toBe('fallback');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] error decompressing value',
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });

  test('backward compatibility - reading uncompressed values with compression enabled', () => {
    localStorage.setItem('slsm||data', JSON.stringify('plain value'));

    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: '' },
      },
      compress: compression,
    });

    expect(localStore.get('data')).toBe('plain value');
  });

  test('storage space savings verification', () => {
    const compression = createFflateCompression();

    const largeData = {
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `This is a description for item ${i}`,
        tags: ['tag1', 'tag2', 'tag3'],
      })),
    };

    const localStoreCompressed = createSmartLocalStorage<{
      data: typeof largeData;
    }>({
      items: {
        data: {
          schema: rc_object({
            items: rc_array(
              rc_object({
                id: rc_number,
                name: rc_string,
                description: rc_string,
                tags: rc_array(rc_string),
              }),
            ),
          }),
          default: { items: [] },
        },
      },
      compress: compression,
    });

    localStoreCompressed.set('data', largeData);

    const compressedSize = localStorage.getItem('slsm||data')!.length;

    reset();

    const localStoreUncompressed = createSmartLocalStorage<{
      data: typeof largeData;
    }>({
      items: {
        data: {
          schema: rc_object({
            items: rc_array(
              rc_object({
                id: rc_number,
                name: rc_string,
                description: rc_string,
                tags: rc_array(rc_string),
              }),
            ),
          }),
          default: { items: [] },
        },
      },
    });

    localStoreUncompressed.set('data', largeData);

    const uncompressedSize = localStorage.getItem('slsm||data')!.length;

    expect(compressedSize).toBeLessThan(uncompressedSize);

    const savingsPercent =
      ((uncompressedSize - compressedSize) / uncompressedSize) * 100;
    expect(savingsPercent).toBeGreaterThan(0);
  });

  test('compression with produce', () => {
    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      items: string[];
    }>({
      items: {
        items: { schema: rc_array(rc_string), default: [] },
      },
      compress: compression,
    });

    localStore.set('items', ['a', 'b']);
    localStore.produce('items', (draft) => {
      draft.push('c');
    });

    expect(localStore.get('items')).toEqual(['a', 'b', 'c']);

    const stored = JSON.parse(localStorage.getItem('slsm||items')!);
    expect(stored.c).toBe('fflate-deflate');
  });

  test('compression without config shows error', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const compression = createFflateCompression();

    localStorage.setItem(
      'slsm||data',
      JSON.stringify({
        _v: compression.compressFn(JSON.stringify('test')),
        c: 'fflate-deflate',
      }),
    );

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: 'fallback' },
      },
    });

    expect(localStore.get('data')).toBe('fallback');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slsm] compressed value found but no compression config provided',
    );

    consoleErrorSpy.mockRestore();
  });

  test('external storage event with compression', () => {
    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      data: string;
    }>({
      items: {
        data: { schema: rc_string, default: '', syncTabsState: true },
      },
      compress: compression,
    });

    localStore.set('data', 'initial');

    const compressedValue = compression.compressFn(JSON.stringify('updated'));
    const envelope = JSON.stringify({
      _v: compressedValue,
      c: 'fflate-deflate',
    });

    mockedLocalStorage.mockExternalChange('slsm||data', envelope);

    expect(localStore.get('data')).toBe('updated');
  });

  test('compression with part TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TTL_BASE_MS);

    const compression = createFflateCompression();

    const localStore = createSmartLocalStorage<{
      feed: string[];
    }>({
      items: {
        feed: {
          schema: rc_array(rc_string),
          default: [],
          ttl: {
            minutes: 1,
            splitIntoParts: (value) => value,
            removePart: (value, partKey) =>
              value.filter((entry) => entry !== partKey),
          },
        },
      },
      compress: compression,
    });

    localStore.set('feed', ['alpha']);

    vi.setSystemTime(TTL_BASE_MS + (MS_PER_MINUTE * 3) / 2);

    localStore.set('feed', ['alpha', 'beta']);

    vi.setSystemTime(TTL_BASE_MS + 2 * MS_PER_MINUTE - 1);

    expect(localStore.get('feed')).toEqual(['beta']);

    vi.useRealTimers();
  });
});
