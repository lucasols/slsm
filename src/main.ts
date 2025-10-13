import { sortBy } from '@lucasols/utils/arrayUtils';
import { isFunction } from '@lucasols/utils/assertions';
import { deepEqual } from '@lucasols/utils/deepEqual';
import { klona } from 'klona';
import {
  rc_number,
  rc_obj_builder,
  rc_record,
  rc_string,
  rc_unknown,
  RcType,
} from 'runcheck';
import { Store } from 't-state';

type SyncDelay =
  | { type: 'debounce'; ms: number; maxWaitMs?: number }
  | { type: 'onIdleCallback'; timeoutMs: number; maxWaitMs?: number };

type Compress = {
  /**
   * Function to compress the raw JSON string, should return a compressed string format
   */
  compressFn: (rawJsonString: string) => string;
  /**
   * Function to decompress the compressed string format, should return a raw JSON string
   */
  decompressFn: (compressedJsonString: string) => string;
  /**
   * Id to identify the compressed format
   */
  format: string;
};

type ItemOptions<V> = {
  schema: RcType<V>;
  default: V;
  syncTabsState?: boolean;
  /**
   * if storage is full, the item with the lowest priority will be removed first to free up space
   * @default 0
   */
  priority?: number;
  ignoreSessionId?: boolean;
  useSessionStorage?: boolean;
  ttl?:
    | {
        /**
         * The minimum time in minutes to keep the item in storage
         */
        minutes: number;
      }
    | {
        /**
         * The minimum time in minutes to keep the item part in storage
         */
        minutes: number;
        /**
         * Allows to split the items into parts, and remove the part when the TTL expires
         */
        splitIntoParts: (value: V) => string[];
        /**
         * Function to remove the part when the TTL expires
         */
        removePart: (value: V, partKey: string) => V;
      };
  autoPrune?: (value: V) => V;
  /**
   * If the item is larger than the maxKb, the item will be pruned by calling a function repeatedly until the item is smaller than the maxKb
   */
  autoPruneBySize?: {
    maxKb: number;
    performPruneStep: (value: V) => V;
  };
  /**
   * The compress function to use for the item
   */
  compress?: Compress;
  /**
   * Delay storage sync to the store. Use `false` to disable the global sync delay.
   */
  syncDelay?: SyncDelay | false;
  /**
   * Called when stored data fails schema validation.
   * Use this to migrate data from old schema shapes to new ones.
   *
   * @param invalidValue - The parsed value that failed validation
   * @param validationErrors - Errors from runcheck schema validation
   * @returns Valid migrated value, or undefined to use default
   */
  migrate?: (invalidValue: unknown, validationErrors: unknown) => V | undefined;
};

type ItemTtlOption<V> = NonNullable<ItemOptions<V>['ttl']>;

type TtlMetadata = {
  updatedAt: number;
  parts?: Record<string, number>;
};

type TtlState<Items extends PropertyKey> = {
  key: Items;
  updatedAt: number;
  parts?: Record<string, number>;
  timerId?: ReturnType<typeof setTimeout>;
};

type ParsedStorageValue<V> = {
  value: V;
  metadata: TtlMetadata | undefined;
};

type InitialReadResult<V> = {
  value: V;
  metadata: TtlMetadata | undefined;
  shouldPersist: boolean;
};

type SmartLocalStorageOptions<Schemas extends Record<string, unknown>> = {
  getSessionId?: () => string | false;
  items: {
    [K in keyof Schemas]: ItemOptions<Schemas[K]>;
  };
  /**
   * Global compress function to use for all items
   */
  compress?: Compress;
  /**
   * Global sync delay to use for all items
   */
  syncDelay?: SyncDelay;
};

type ValueOrSetter<T> = T | ((currentValue: T) => T);

type Envelope = {
  t?: number;
  p?: Record<string, number>;
  _v: unknown;
  c?: string;
};

const envelopeSchema = rc_obj_builder<Envelope>()({
  t: rc_number.optional(),
  p: rc_record(rc_number).optional(),
  _v: rc_unknown,
  c: rc_string.optional(),
});

const MS_PER_MINUTE = 60_000;
const TTL_REFERENCE_EPOCH_MS = Date.UTC(2025, 0, 1);

function toEnvelopeMinutes(timestamp: number): number {
  return Math.round((timestamp - TTL_REFERENCE_EPOCH_MS) / MS_PER_MINUTE);
}

function fromEnvelopeMinutes(minuteStamp: number): number {
  return TTL_REFERENCE_EPOCH_MS + minuteStamp * MS_PER_MINUTE;
}

function getTtlDurationMs<V>(ttl: ItemTtlOption<V>): number {
  return ttl.minutes * MS_PER_MINUTE;
}

type SmartLocalStorage<Schemas extends Record<string, unknown>> = {
  set: <K extends keyof Schemas>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ) => void;
  get: <K extends keyof Schemas>(key: K) => Schemas[K];
  produce: <K extends keyof Schemas>(
    key: K,
    fn: (draft: Schemas[K]) => void | Schemas[K],
  ) => void;

  produceWithFallback: <K extends keyof Schemas>(
    key: K,
    nullableFallback: NonNullable<Schemas[K]>,
    fn: (draft: NonNullable<Schemas[K]>) => void | Schemas[K],
  ) => void;

  delete: <K extends keyof Schemas>(key: K) => void;

  clearAll: () => void;
  clearAllBy: (clearBy: {
    sessionId?: string;
    allSessionIds?: boolean;
    withNoSessionId?: boolean;
  }) => void;
  useKey: <K extends keyof Schemas>(key: K) => Readonly<Schemas[K]>;
  useKeyWithSelector: <K extends keyof Schemas>(
    key: K,
  ) => <S>(selector: (value: Schemas[K]) => S) => S;
  getStore: <K extends keyof Schemas>(key: K) => Store<Schemas[K]>;
};

export function createSmartLocalStorage<
  Schemas extends Record<string, unknown>,
>({
  getSessionId = () => '',
  items,
  compress,
  syncDelay,
}: SmartLocalStorageOptions<Schemas>): SmartLocalStorage<Schemas> {
  const IS_BROWSER = typeof window !== 'undefined';

  type Items = keyof Schemas;

  const ttlStates = new Map<string, TtlState<Items>>();
  const itemStores = new Map<string, Store<any>>();
  const isInternalUpdate = new Map<string, boolean>();
  const pendingSyncOperations = new Map<
    string,
    {
      timerId?: ReturnType<typeof setTimeout>;
      cancelIdleCallback?: VoidFunction;
      value: unknown;
      metadata?: TtlMetadata;
      source?: 'cleanup' | 'mutation';
      firstScheduledAt?: number;
    }
  >();

  if (IS_BROWSER) {
    requestIdleCallback(function handleIdleCleanup() {
      function sweepStorage(storage: Storage) {
        for (const storageKey of getStorageItemKeys(storage, undefined)) {
          const itemKey = getItemKeyFromStorageKey(storageKey);

          if (!itemKey) {
            storage.removeItem(storageKey);
            clearTtlState(storageKey);
            continue;
          }

          const itemOptions = items[itemKey];

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- storage may contain keys removed from configuration
          if (!itemOptions) {
            storage.removeItem(storageKey);
            clearTtlState(storageKey);
            continue;
          }

          if (itemOptions.ttl) {
            runTtlCleanup(storageKey, Date.now());
          }
        }
      }

      sweepStorage(localStorage);
      sweepStorage(sessionStorage);
    });
  }

  function getItemStorage(key: Items) {
    return items[key].useSessionStorage ? sessionStorage : localStorage;
  }

  function getStorageForKey(storageKey: string) {
    return storageKey.includes('|s||') ? sessionStorage : localStorage;
  }

  function getLocalStorageItemKey(key: Items) {
    const itemOptions = items[key];
    const usesDefaultSessionId = itemOptions.ignoreSessionId;
    const sessionId = usesDefaultSessionId ? '' : getSessionId();

    if (sessionId === false) return false;

    return `slsm${sessionId ? `-${sessionId}` : ''}${
      itemOptions.useSessionStorage ? '|s' : ''
    }||${String(key)}`;
  }

  function getItemKeyFromStorageKey(storageKey: string): Items | undefined {
    return storageKey.split('||')[1];
  }

  function getCompressionForKey<K extends Items>(key: K): Compress | undefined {
    return items[key].compress ?? compress;
  }

  function getSyncDelayForKey<K extends Items>(key: K): SyncDelay | undefined {
    const itemSyncDelay = items[key].syncDelay;
    if (itemSyncDelay === false) return undefined;
    return itemSyncDelay ?? syncDelay;
  }

  function cancelPendingSync(storageKey: string) {
    const pending = pendingSyncOperations.get(storageKey);
    if (pending) {
      if (pending.timerId) {
        clearTimeout(pending.timerId);
      }
      if (pending.cancelIdleCallback) {
        pending.cancelIdleCallback();
      }
      pendingSyncOperations.delete(storageKey);
    }
  }

  function tryMigrateValue<K extends Items>(
    key: K,
    invalidValue: unknown,
    validationErrors: unknown,
  ): Schemas[K] | undefined {
    const migrate = items[key].migrate;
    if (!migrate) return undefined;

    try {
      const migratedValue = migrate(invalidValue, validationErrors);
      if (migratedValue === undefined) return undefined;

      const validationResult = items[key].schema.parse(migratedValue);
      if (validationResult.errors) {
        console.error(
          '[slsm] migrated value failed validation',
          validationResult.errors,
        );
        return undefined;
      }

      return validationResult.value;
    } catch (error) {
      console.error('[slsm] error during migration', error);
      return undefined;
    }
  }

  function createEnvelopePayload<K extends Items>(
    key: K,
    value: Schemas[K],
    metadata: TtlMetadata,
  ) {
    const payload: Envelope = {
      _v: value,
    };

    payload.t = toEnvelopeMinutes(metadata.updatedAt);

    if (metadata.parts && Object.keys(metadata.parts).length > 0) {
      const partsMinutes: Record<string, number> = {};
      for (const [partKey, timestamp] of Object.entries(metadata.parts)) {
        partsMinutes[partKey] = toEnvelopeMinutes(timestamp);
      }
      payload.p = partsMinutes;
    }

    return payload;
  }

  function parseStoredValue<K extends Items>(
    key: K,
    rawValue: string,
  ): ParsedStorageValue<Schemas[K]> | undefined {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawValue);
    } catch (error) {
      console.error('[slsm] error parsing value', error);
      return undefined;
    }

    const envelopeResult = envelopeSchema.parse(parsed);
    if (!envelopeResult.errors) {
      const envelope = envelopeResult.value;

      if (envelope.c !== undefined) {
        const compression = getCompressionForKey(key);

        if (!compression) {
          console.error(
            '[slsm] compressed value found but no compression config provided',
          );
          return undefined;
        }

        if (compression.format !== envelope.c) {
          console.error('[slsm] compression format mismatch', {
            expected: compression.format,
            found: envelope.c,
          });
          return undefined;
        }

        if (typeof envelope._v !== 'string') {
          console.error('[slsm] compressed value must be a string');
          return undefined;
        }

        let decompressed: string;
        try {
          decompressed = compression.decompressFn(envelope._v);
        } catch (error) {
          console.error('[slsm] error decompressing value', error);
          return undefined;
        }

        try {
          parsed = JSON.parse(decompressed);
        } catch (error) {
          console.error('[slsm] error parsing decompressed value', error);
          return undefined;
        }

        const decompressedEnvelopeResult = envelopeSchema.parse(parsed);
        if (!decompressedEnvelopeResult.errors) {
          const decompressedEnvelope = decompressedEnvelopeResult.value;

          if (decompressedEnvelope.t !== undefined) {
            const validationResult = items[key].schema.parse(
              decompressedEnvelope._v,
            );
            if (validationResult.errors) {
              console.error(
                '[slsm] error parsing value',
                validationResult.errors,
              );

              const migratedValue = tryMigrateValue(
                key,
                decompressedEnvelope._v,
                validationResult.errors,
              );

              if (migratedValue !== undefined) {
                const partsMetadata = decompressedEnvelope.p;
                let parts: Record<string, number> | undefined;
                if (partsMetadata && Object.keys(partsMetadata).length > 0) {
                  parts = {};
                  for (const [partKey, minuteStamp] of Object.entries(
                    partsMetadata,
                  )) {
                    parts[partKey] = fromEnvelopeMinutes(minuteStamp);
                  }
                }

                return {
                  value: migratedValue,
                  metadata: {
                    updatedAt: fromEnvelopeMinutes(decompressedEnvelope.t),
                    parts,
                  },
                };
              }

              return undefined;
            }

            const partsMetadata = decompressedEnvelope.p;
            let parts: Record<string, number> | undefined;
            if (partsMetadata && Object.keys(partsMetadata).length > 0) {
              parts = {};
              for (const [partKey, minuteStamp] of Object.entries(
                partsMetadata,
              )) {
                parts[partKey] = fromEnvelopeMinutes(minuteStamp);
              }
            }

            return {
              value: validationResult.value,
              metadata: {
                updatedAt: fromEnvelopeMinutes(decompressedEnvelope.t),
                parts,
              },
            };
          }
        }

        const validationResult = items[key].schema.parse(parsed);
        if (validationResult.errors) {
          console.error('[slsm] error parsing value', validationResult.errors);

          const migratedValue = tryMigrateValue(
            key,
            parsed,
            validationResult.errors,
          );

          if (migratedValue !== undefined) {
            return {
              value: migratedValue,
              metadata: undefined,
            };
          }

          return undefined;
        }

        return {
          value: validationResult.value,
          metadata: undefined,
        };
      }

      if (envelope.t !== undefined) {
        const validationResult = items[key].schema.parse(envelope._v);
        if (validationResult.errors) {
          console.error('[slsm] error parsing value', validationResult.errors);

          const migratedValue = tryMigrateValue(
            key,
            envelope._v,
            validationResult.errors,
          );

          if (migratedValue !== undefined) {
            const partsMetadata = envelope.p;
            let parts: Record<string, number> | undefined;
            if (partsMetadata && Object.keys(partsMetadata).length > 0) {
              parts = {};
              for (const [partKey, minuteStamp] of Object.entries(
                partsMetadata,
              )) {
                parts[partKey] = fromEnvelopeMinutes(minuteStamp);
              }
            }

            return {
              value: migratedValue,
              metadata: {
                updatedAt: fromEnvelopeMinutes(envelope.t),
                parts,
              },
            };
          }

          return undefined;
        }

        const partsMetadata = envelope.p;
        let parts: Record<string, number> | undefined;
        if (partsMetadata && Object.keys(partsMetadata).length > 0) {
          parts = {};
          for (const [partKey, minuteStamp] of Object.entries(partsMetadata)) {
            parts[partKey] = fromEnvelopeMinutes(minuteStamp);
          }
        }

        return {
          value: validationResult.value,
          metadata: {
            updatedAt: fromEnvelopeMinutes(envelope.t),
            parts,
          },
        };
      }
    }

    const validationResult = items[key].schema.parse(parsed);
    if (validationResult.errors) {
      console.error('[slsm] error parsing value', validationResult.errors);

      const migratedValue = tryMigrateValue(
        key,
        parsed,
        validationResult.errors,
      );

      if (migratedValue !== undefined) {
        return {
          value: migratedValue,
          metadata: undefined,
        };
      }

      return undefined;
    }

    return {
      value: validationResult.value,
      metadata: undefined,
    };
  }

  function synthesizeMetadataFromValue<K extends Items>(
    key: K,
    value: Schemas[K],
    ttl: ItemTtlOption<Schemas[K]>,
    now: number,
  ): TtlMetadata {
    if ('splitIntoParts' in ttl) {
      const parts: Record<string, number> = {};
      for (const partKey of ttl.splitIntoParts(value)) {
        parts[partKey] = now;
      }
      return {
        updatedAt: now,
        parts: Object.keys(parts).length === 0 ? undefined : parts,
      };
    }

    return { updatedAt: now };
  }

  function evaluateTtl<K extends Items>(
    key: K,
    value: Schemas[K],
    metadata: TtlMetadata,
    ttl: ItemTtlOption<Schemas[K]>,
    now: number,
  ): {
    expired: boolean;
    changed: boolean;
    value: Schemas[K];
    metadata: TtlMetadata;
  } {
    if (!('splitIntoParts' in ttl)) {
      const expired = now - metadata.updatedAt >= getTtlDurationMs(ttl);
      return { expired, changed: false, value, metadata };
    }

    const parts = { ...(metadata.parts ?? {}) };
    const expiredParts: string[] = [];

    for (const [partKey, lastUpdated] of Object.entries(parts)) {
      if (now - lastUpdated >= getTtlDurationMs(ttl)) {
        expiredParts.push(partKey);
      }
    }

    if (expiredParts.length === 0) {
      return { expired: false, changed: false, value, metadata };
    }

    let nextValue = value;
    for (const partKey of expiredParts) {
      nextValue = ttl.removePart(nextValue, partKey);
      delete parts[partKey];
    }

    const nextMetadata: TtlMetadata = {
      updatedAt: metadata.updatedAt,
      parts: Object.keys(parts).length === 0 ? undefined : parts,
    };

    return {
      expired: false,
      changed: true,
      value: nextValue,
      metadata: nextMetadata,
    };
  }

  function clearTtlState(storageKey: string) {
    const existing = ttlStates.get(storageKey);
    if (existing?.timerId) {
      clearTimeout(existing.timerId);
    }
    ttlStates.delete(storageKey);
  }

  function scheduleNextTtlCheck(storageKey: string, state: TtlState<Items>) {
    if (!IS_BROWSER) return;

    const itemOptions = items[state.key];
    const ttl = itemOptions.ttl;
    if (!ttl) return;

    let nextExpiry: number | undefined;

    if ('splitIntoParts' in ttl) {
      const partTimes = state.parts ? Object.values(state.parts) : [];
      if (partTimes.length > 0) {
        const ttlDuration = getTtlDurationMs(ttl);
        nextExpiry = Math.min(
          ...partTimes.map((timestamp) => timestamp + ttlDuration),
        );
      }
    } else {
      nextExpiry = state.updatedAt + getTtlDurationMs(ttl);
    }

    if (nextExpiry === undefined) return;

    const delay = Math.max(nextExpiry - Date.now(), 0);
    state.timerId = setTimeout(() => {
      runTtlCleanup(storageKey, Date.now());
    }, delay);
  }

  function setTtlState(
    storageKey: string,
    key: Items,
    metadata: TtlMetadata | undefined,
  ) {
    const existing = ttlStates.get(storageKey);
    if (existing?.timerId) {
      clearTimeout(existing.timerId);
    }

    if (!metadata) {
      ttlStates.delete(storageKey);
      return;
    }

    const state: TtlState<Items> = {
      key,
      updatedAt: metadata.updatedAt,
      parts: metadata.parts ? { ...metadata.parts } : undefined,
    };

    ttlStates.set(storageKey, state);
    scheduleNextTtlCheck(storageKey, state);
  }

  function runTtlCleanup(storageKey: string, now: number): boolean {
    if (!IS_BROWSER) return false;

    const itemKey = getItemKeyFromStorageKey(storageKey);
    if (!itemKey) return false;

    const itemOptions = items[itemKey];
    if (!itemOptions.ttl) return false;

    const storage = getStorageForKey(storageKey);

    const rawValue = storage.getItem(storageKey);

    if (rawValue === null) {
      clearTtlState(storageKey);
      return false;
    }

    const parsed = parseStoredValue(itemKey, rawValue);
    if (!parsed) return false;

    let metadata = parsed.metadata;

    if (!metadata) {
      metadata = synthesizeMetadataFromValue(
        itemKey,
        parsed.value,
        itemOptions.ttl,
        now,
      );
    }

    const evaluation = evaluateTtl(
      itemKey,
      parsed.value,
      metadata,
      itemOptions.ttl,
      now,
    );

    if (evaluation.expired) {
      storage.removeItem(storageKey);
      clearTtlState(storageKey);

      const scopedKey = getLocalStorageItemKey(itemKey);
      if (scopedKey && scopedKey === storageKey) {
        isInternalUpdate.set(storageKey, true);
        const store = getStore(itemKey);
        store.setState(items[itemKey].default);
      }

      return true;
    }

    if (evaluation.changed) {
      const scopedKey = getLocalStorageItemKey(itemKey);

      if (scopedKey && scopedKey === storageKey) {
        isInternalUpdate.set(storageKey, true);
        const store = getStore(itemKey);
        store.setState(klona(evaluation.value), { equalityCheck: deepEqual });
        persistValue(itemKey, evaluation.value, storageKey, {
          metadataOverride: evaluation.metadata,
          source: 'cleanup',
        });
      } else {
        const payload = createEnvelopePayload(
          itemKey,
          evaluation.value,
          evaluation.metadata,
        );
        writeToStorage(storageKey, payload, storage, true);
        setTtlState(storageKey, itemKey, evaluation.metadata);
      }

      return true;
    }

    setTtlState(storageKey, itemKey, metadata);
    return false;
  }

  function cleanupAllTtlItems(except: string): boolean {
    let cleaned = false;

    function sweep(storage: Storage) {
      const now = Date.now();
      for (const storageKey of getStorageItemKeys(storage, except)) {
        if (runTtlCleanup(storageKey, now)) {
          cleaned = true;
        }
      }
    }

    sweep(localStorage);
    sweep(sessionStorage);

    return cleaned;
  }

  function applyAutoPrune<K extends Items>(
    key: K,
    value: Schemas[K],
  ): Schemas[K] {
    const itemOptions = items[key];
    let nextValue = value;

    if (itemOptions.autoPrune) {
      nextValue = itemOptions.autoPrune(nextValue);
    }

    if (itemOptions.autoPruneBySize) {
      const { maxKb, performPruneStep } = itemOptions.autoPruneBySize;
      const maxBytes = maxKb * 1024;

      let serialized = JSON.stringify(nextValue);
      let previousSize = serialized.length;
      const MAX_ITERATIONS = 1000;
      let iterations = 0;

      while (serialized.length > maxBytes) {
        if (iterations >= MAX_ITERATIONS) {
          console.error(
            `[slsm] autoPruneBySize: max iterations (${MAX_ITERATIONS}) reached for key "${String(key)}". Prune canceled.`,
          );
          break;
        }

        const pruned = performPruneStep(nextValue);
        if (pruned === nextValue) break;
        nextValue = pruned;
        serialized = JSON.stringify(nextValue);
        const currentSize = serialized.length;

        if (currentSize >= previousSize) {
          console.error(
            `[slsm] autoPruneBySize: prune step ${currentSize >= previousSize && currentSize > previousSize ? 'increased' : 'did not decrease'} the size for key "${String(key)}" (from ${previousSize} to ${currentSize} bytes). Prune canceled.`,
          );
          nextValue = value;
          break;
        }

        previousSize = currentSize;
        iterations++;
      }
    }

    return nextValue;
  }

  function persistValue<K extends Items>(
    key: K,
    value: Schemas[K],
    storageKey: string,
    options?: {
      metadataOverride?: TtlMetadata;
      source?: 'cleanup' | 'mutation';
    },
  ) {
    if (!IS_BROWSER) return;

    const itemOptions = items[key];
    const ttl = itemOptions.ttl;

    let metadata = options?.metadataOverride;

    if (ttl && !metadata) {
      const now = Date.now();

      if ('splitIntoParts' in ttl) {
        const existingState = ttlStates.get(storageKey);
        const previousParts = existingState?.parts ?? {};
        const uniquePartKeys = Array.from(new Set(ttl.splitIntoParts(value)));
        const nextParts: Record<string, number> = {};

        for (const partKey of uniquePartKeys) {
          nextParts[partKey] = previousParts[partKey] ?? now;
        }

        metadata = {
          updatedAt: now,
          parts: Object.keys(nextParts).length === 0 ? undefined : nextParts,
        };
      } else {
        metadata = { updatedAt: now };
      }
    }

    function performWrite() {
      const storage = getItemStorage(key);
      const payload =
        ttl && metadata ? createEnvelopePayload(key, value, metadata) : value;

      writeToStorage(
        storageKey,
        payload,
        storage,
        options?.source === 'cleanup',
      );

      if (ttl && metadata) {
        setTtlState(storageKey, key, metadata);
      } else {
        clearTtlState(storageKey);
      }

      pendingSyncOperations.delete(storageKey);
    }

    // Only apply sync delay for user mutations, not for cleanup operations
    const syncDelayConfig =
      options?.source === 'mutation' ? getSyncDelayForKey(key) : undefined;

    if (syncDelayConfig) {
      const now = Date.now();
      const pending = pendingSyncOperations.get(storageKey);
      const maxWaitMs = syncDelayConfig.maxWaitMs;

      // Cancel any existing pending sync for this storage key
      const firstScheduledAt = pending?.firstScheduledAt ?? now;
      cancelPendingSync(storageKey);

      if (syncDelayConfig.type === 'debounce') {
        let delay = syncDelayConfig.ms;

        // If maxWaitMs is set, ensure we don't exceed it
        if (maxWaitMs) {
          const elapsed = now - firstScheduledAt;
          const timeUntilMaxWait = maxWaitMs - elapsed;

          if (timeUntilMaxWait <= 0) {
            // maxWaitMs already exceeded, write immediately
            performWrite();
            return;
          }

          // Schedule timer to fire no later than maxWaitMs
          delay = Math.min(delay, timeUntilMaxWait);
        }

        const timerId = setTimeout(performWrite, delay);
        pendingSyncOperations.set(storageKey, {
          timerId,
          value,
          metadata,
          source: options?.source,
          firstScheduledAt,
        });
      } else {
        // onIdleCallback
        const cancel = requestIdleCallback(
          performWrite,
          syncDelayConfig.timeoutMs,
        );
        pendingSyncOperations.set(storageKey, {
          cancelIdleCallback: cancel,
          value,
          metadata,
          source: options?.source,
          firstScheduledAt,
        });
      }
    } else {
      // No sync delay, write immediately
      performWrite();
    }
  }

  function getInitialValue<K extends Items>(
    key: K,
    storageKey: string,
  ): InitialReadResult<Schemas[K]> | undefined {
    if (!IS_BROWSER) return undefined;

    const storage = getItemStorage(key);
    const rawValue = storage.getItem(storageKey);

    if (rawValue === null) return undefined;

    const parsed = parseStoredValue(key, rawValue);
    if (!parsed) return undefined;

    const ttl = items[key].ttl;
    if (!ttl) {
      return { value: parsed.value, metadata: undefined, shouldPersist: false };
    }

    const now = Date.now();
    let metadata = parsed.metadata;
    const shouldPersist = metadata === undefined;

    if (!metadata) {
      metadata = synthesizeMetadataFromValue(key, parsed.value, ttl, now);
    }

    const evaluation = evaluateTtl(key, parsed.value, metadata, ttl, now);

    if (evaluation.expired) {
      storage.removeItem(storageKey);
      clearTtlState(storageKey);
      return undefined;
    }

    if (evaluation.changed) {
      return {
        value: evaluation.value,
        metadata: evaluation.metadata,
        shouldPersist: true,
      };
    }

    return {
      value: parsed.value,
      metadata,
      shouldPersist,
    };
  }

  function getStore<K extends Items>(key: K): Store<Schemas[K]> {
    const storageKey = getLocalStorageItemKey(key);
    if (!storageKey) {
      return new Store<Schemas[K]>({ state: items[key].default });
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- cache value retrieved from map keyed by storage identifiers
    let store = itemStores.get(storageKey) as Store<Schemas[K]> | undefined;

    if (!store) {
      const initial = getInitialValue(key, storageKey);
      let initialState = initial?.value ?? items[key].default;

      // Apply auto-pruning on initial load
      const prunedInitialState = applyAutoPrune(key, initialState);
      const wasPruned = prunedInitialState !== initialState;
      initialState = prunedInitialState;

      store = new Store<Schemas[K]>({
        state: initialState,
      });

      itemStores.set(storageKey, store);

      if (items[key].ttl && initial?.metadata) {
        setTtlState(storageKey, key, initial.metadata);
      }

      // Persist if TTL metadata was synthesized or if auto-pruning changed the value
      const shouldPersist =
        (items[key].ttl && initial?.shouldPersist && initial.metadata) ||
        wasPruned;

      if (shouldPersist) {
        persistValue(key, initialState, storageKey, {
          metadataOverride: initial?.metadata,
          source: 'cleanup',
        });
      }

      // Use middleware to apply transformations and persist changes
      store.addMiddleware(({ next }) => {
        // Skip if this is an internal update (from storage, TTL cleanup, etc.)
        if (isInternalUpdate.get(storageKey)) {
          isInternalUpdate.set(storageKey, false);
          return true; // Allow the update without transformation
        }

        // Apply auto-pruning to the next state
        const prunedValue = applyAutoPrune(key, next);

        // If the pruned value equals the default value, delete the item
        if (deepEqual(prunedValue, items[key].default)) {
          const storage = getItemStorage(key);
          storage.removeItem(storageKey);
          clearTtlState(storageKey);
          cancelPendingSync(storageKey);

          // Return the default value to the store
          return items[key].default;
        }

        // Persist the pruned value
        persistValue(key, prunedValue, storageKey, { source: 'mutation' });

        // Return pruned value if it changed, otherwise allow the update
        return prunedValue !== next ? prunedValue : true;
      });
    }

    return store;
  }

  function deleteItemByStorageKey(storageKey: string) {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);
    clearTtlState(storageKey);
    cancelPendingSync(storageKey);

    const itemKey = getItemKeyFromStorageKey(storageKey);
    if (!itemKey) return;

    const scopedKey = getLocalStorageItemKey(itemKey);
    if (scopedKey && scopedKey === storageKey) {
      isInternalUpdate.set(storageKey, true);
      const store = getStore(itemKey);
      store.setState(items[itemKey].default);
    }
  }

  function handleQuotaExceeded(
    storageKey: string,
    operation: () => void,
    error: DOMException,
    skipTtlCleanup = false,
  ): void {
    function tryOperation() {
      try {
        operation();
        return true;
      } catch (retryError) {
        if (
          retryError instanceof DOMException &&
          retryError.name === 'QuotaExceededError'
        ) {
          return false;
        }
        throw retryError;
      }
    }

    if (!skipTtlCleanup) {
      if (cleanupAllTtlItems(storageKey) && tryOperation()) {
        return;
      }
    }

    const sessionStorageKeys = getStorageItemKeys(sessionStorage, storageKey);
    if (sessionStorageKeys.length !== 0) {
      for (const itemKey of sessionStorageKeys) {
        deleteItemByStorageKey(itemKey);
      }

      if (tryOperation()) return;
    }

    const currentSessionId = getSessionId();

    function getItemPriority(itemStorageKey: string): number {
      const itemKey = getItemKeyFromStorageKey(itemStorageKey);
      if (!itemKey) return 0;
      return items[itemKey].priority ?? 0;
    }

    function sortByPriorityAndSize(storageKeys: string[]) {
      return sortBy(storageKeys, (key) => {
        const priority = getItemPriority(key);
        const size = localStorage.getItem(key)?.length ?? 0;
        return [priority, -size];
      });
    }

    while (true) {
      const localStorageKeys = getStorageItemKeys(localStorage, storageKey);
      if (localStorageKeys.length === 0) break;

      const itemsInDifferentSessions = localStorageKeys.filter(
        (key) =>
          !key.startsWith(`slsm-${currentSessionId}`) &&
          !key.startsWith(`slsm|`),
      );

      const sortedDifferentSessions = sortByPriorityAndSize(
        itemsInDifferentSessions,
      );

      const firstDifferentSession = sortedDifferentSessions[0];
      if (firstDifferentSession) {
        deleteItemByStorageKey(firstDifferentSession);
        if (tryOperation()) return;
        continue;
      }

      const sortedCurrentSession = sortByPriorityAndSize(localStorageKeys);
      const firstCurrentSession = sortedCurrentSession[0];
      if (firstCurrentSession) {
        deleteItemByStorageKey(firstCurrentSession);
        if (tryOperation()) return;
      } else {
        break;
      }
    }

    throw error;
  }

  function writeToStorage(
    storageKey: string,
    value: unknown,
    storage: Storage,
    skipTtlCleanup = false,
  ) {
    function write() {
      const itemKey = getItemKeyFromStorageKey(storageKey);
      const compression = itemKey ? getCompressionForKey(itemKey) : undefined;

      if (compression) {
        const rawJson = JSON.stringify(value);
        const compressed = compression.compressFn(rawJson);
        const envelope: Envelope = {
          _v: compressed,
          c: compression.format,
        };
        storage.setItem(storageKey, JSON.stringify(envelope));
      } else {
        storage.setItem(storageKey, JSON.stringify(value));
      }
    }

    if (!IS_BROWSER) return;

    try {
      write();
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        handleQuotaExceeded(storageKey, write, error, skipTtlCleanup);
      } else {
        throw error;
      }
    }
  }

  function setItemValue<K extends Items>(
    key: K,
    value: ValueOrSetter<Schemas[K]>,
  ): void {
    const storageKey = getLocalStorageItemKey(key);
    if (!storageKey) return;

    const store = getStore(key);
    const currentValue = store.state;
    const nextValue = isFunction(value) ? value(currentValue) : value;

    // If the resolved value is undefined or equals the default value, delete the item instead of storing it
    if (nextValue === undefined || deepEqual(nextValue, items[key].default)) {
      deleteItem(key);
      return;
    }

    store.setState(klona(nextValue), { equalityCheck: deepEqual });
  }

  if (IS_BROWSER) {
    globalThis.addEventListener('storage', (event) => {
      if (!event.key?.startsWith('slsm')) return;

      const storageKey = event.key;
      const itemKey = getItemKeyFromStorageKey(storageKey);
      if (!itemKey) return;

      const itemOptions = items[itemKey];
      if (!itemOptions.syncTabsState) return;

      isInternalUpdate.set(storageKey, true);
      const store = getStore(itemKey);

      if (event.newValue === null) {
        store.setState(itemOptions.default);
        clearTtlState(storageKey);
        return;
      }

      const parsed = parseStoredValue(itemKey, event.newValue);
      if (!parsed) return;

      const now = Date.now();

      if (itemOptions.ttl) {
        const metadata =
          parsed.metadata ??
          synthesizeMetadataFromValue(
            itemKey,
            parsed.value,
            itemOptions.ttl,
            now,
          );

        const cleanupApplied = runTtlCleanup(storageKey, now);

        if (cleanupApplied) return;

        setTtlState(storageKey, itemKey, metadata);
      }

      store.setState(klona(parsed.value), { equalityCheck: deepEqual });
    });
  }

  function getValue<K extends Items>(key: K): Schemas[K] {
    const storageKey = getLocalStorageItemKey(key);
    const store = getStore(key);

    if (storageKey && items[key].ttl) {
      runTtlCleanup(storageKey, Date.now());
    }

    return store.state;
  }

  function deleteItem(key: Items) {
    const storageKey = getLocalStorageItemKey(key);
    if (!storageKey) return;

    const storage = getItemStorage(key);
    storage.removeItem(storageKey);
    clearTtlState(storageKey);
    cancelPendingSync(storageKey);

    isInternalUpdate.set(storageKey, true);
    const store = getStore(key);
    store.setState(items[key].default);
  }

  function resetStoreToDefault(storageKey: string) {
    const itemKey = getItemKeyFromStorageKey(storageKey);
    if (itemKey) {
      cancelPendingSync(storageKey);
      isInternalUpdate.set(storageKey, true);
      const store = getStore(itemKey);
      store.setState(items[itemKey].default);
    }
  }

  return {
    set: setItemValue,
    get: getValue,

    produce: (key, recipe) => {
      const storageKey = getLocalStorageItemKey(key);
      if (!storageKey) return;

      const store = getStore(key);

      store.produceState((draft) => {
        const result = recipe(draft);
        return result !== undefined ? result : draft;
      });
    },

    produceWithFallback: (key, nullableFallback, recipe) => {
      const storageKey = getLocalStorageItemKey(key);
      if (!storageKey) return;

      const store = getStore(key);

      store.batch(() => {
        let currentValue: Schemas[typeof key];

        try {
          currentValue = store.state;
        } catch {
          // If store.state throws (e.g., when default is undefined), use the default
          currentValue = items[key].default;
        }

        if (currentValue === null || currentValue === undefined) {
          // Use fallback - create a copy and work with it directly
          const workingCopy = klona(nullableFallback);
          const result = recipe(workingCopy);
          const finalValue = result !== undefined ? result : workingCopy;
          store.setState(finalValue, { equalityCheck: deepEqual });
        } else {
          // Use current value with produceState
          store.produceState((draft) => {
            // Check runtime to ensure draft is not null/undefined before calling recipe
            if (draft !== null && draft !== undefined) {
              const result = recipe(draft);
              return result !== undefined ? result : draft;
            }
            return draft;
          });
        }
      });
    },

    delete: (key) => {
      deleteItem(key);
    },

    clearAll: () => {
      // Cancel all pending syncs first (including ones not yet written to storage)
      for (const key in items) {
        const storageKey = getLocalStorageItemKey(key);
        if (storageKey) {
          cancelPendingSync(storageKey);
        }
      }

      for (const storageKey of getStorageItemKeys(localStorage, undefined)) {
        localStorage.removeItem(storageKey);
        clearTtlState(storageKey);
        resetStoreToDefault(storageKey);
      }

      for (const storageKey of getStorageItemKeys(sessionStorage, undefined)) {
        sessionStorage.removeItem(storageKey);
        clearTtlState(storageKey);
        resetStoreToDefault(storageKey);
      }
    },

    clearAllBy: ({ sessionId, allSessionIds, withNoSessionId }) => {
      function removeKeyFromStorage(storageKey: string, storage: Storage) {
        let shouldRemove = false;

        const hasSessionId = !storageKey.startsWith(`slsm|`);

        if (withNoSessionId) {
          shouldRemove = !hasSessionId;
        } else if (allSessionIds) {
          shouldRemove = hasSessionId;
        } else if (sessionId) {
          shouldRemove =
            hasSessionId && storageKey.startsWith(`slsm-${sessionId}`);
        }

        if (shouldRemove) {
          storage.removeItem(storageKey);
          clearTtlState(storageKey);
          resetStoreToDefault(storageKey);
        }
      }

      for (const storageKey of getStorageItemKeys(localStorage, undefined)) {
        removeKeyFromStorage(storageKey, localStorage);
      }

      for (const storageKey of getStorageItemKeys(sessionStorage, undefined)) {
        removeKeyFromStorage(storageKey, sessionStorage);
      }
    },

    useKey: (key) => {
      const store = getStore(key);
      return store.useState();
    },

    useKeyWithSelector: (key) => {
      return function useSelector<S>(
        selector: (value: Schemas[typeof key]) => S,
      ) {
        const store = getStore(key);
        return store.useSelector(selector, { useExternalDeps: true });
      };
    },

    getStore,
  };
}

function getStorageItemKeys(storage: Storage, except: string | undefined) {
  const keys: string[] = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);

    if (key === except) continue;

    if (key?.startsWith('slsm')) {
      keys.push(key);
    }
  }

  return keys;
}

function requestIdleCallback(
  callback: () => void,
  timeoutMs?: number,
): VoidFunction {
  if ('requestIdleCallback' in globalThis) {
    const id = globalThis.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => globalThis.cancelIdleCallback(id);
  }

  const id = setTimeout(callback, 50);
  return () => clearTimeout(id);
}
