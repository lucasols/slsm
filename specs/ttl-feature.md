# TTL Feature Implementation Plan

## 1. Goals

- Add time-to-live (TTL) support for configured items.
- Support both whole-item TTL and per-part TTL (parts derived from the item value).
- Keep existing storage behavior backward-compatible and schema-driven.
- Minimize storage footprint while adding metadata.

## 2. Storage Envelope

- Wrap persisted values only when TTL metadata exists (`items[key].ttl` defined).
- Compact format: `{ "_": { "t": number, "p"?: Record<string, number> }, "v": any }`
  - `_` holds metadata; `t` is last update timestamp (ms).
  - `p` stores part timestamps keyed by `getPartKey(value)` output.
  - Future metadata can add short keys under `_`.
- Leave values without TTL untouched (no envelope).
- Continue to accept legacy raw JSON values; convert to envelope lazily (on first write or update).
- Parser rules:
  - If value matches the compact envelope, validate `v` via schema and extract metadata.
  - Otherwise treat as legacy raw value and synthesize metadata on-the-fly for TTL.
- Serialization rules:
  - When persisting, envelope is written with minimal metadata. Omit `p` when empty.
  - Ensure tests assert serialized JSON to guard against size regressions.

## 3. In-Memory TTL State

- Maintain `ttlStates: Map<string, { key, updatedAt, parts?, timerId? }>` keyed by storage key.
  - `updatedAt` mirrors metadata `t`.
  - `parts` mirrors metadata `p`.
  - `timerId` (if timers used) tracks scheduled cleanup callbacks.
- Helper utilities:
  - `setTtlState` to sync map after parsing or writes.
  - `clearTtlState` to cancel timers and drop metadata when item removed.
  - `scheduleNextTtlCheck` to compute next expiry from `updatedAt` or part timestamps.
  - `runTtlCleanup` to remove expired items or parts (shared across triggers).

## 4. Persistence Workflow

- Replace direct `JSON.stringify` writes with `persistValue` helper:
  1. Clone value for in-memory store.
  2. Update store state (`Store` with deep-equality).
  3. Build envelope + metadata when TTL enabled.
  4. Update `ttlStates`.
  5. Write JSON to selected storage via centralized `writeToStorage`.
- `set` / `produce` / `setUnknownValue` must funnel through `persistValue`.

## 5. TTL Enforcement Triggers

### 5.1 Initialization (`getInitialValue`)

- Parse stored string via envelope parser.
- If TTL enabled, hydrate `ttlStates`.
- Immediately drop expired whole items; resync store to default.
- For part TTL, leave pruning to scheduled cleanup (or immediate run if parts already expired).
- When legacy raw data encountered, wrap on first successful write.

### 5.2 Startup Sweep

- Extend existing `requestIdleCallback` to:
  - Clean unconfigured keys (current behavior).
  - Pull each configured TTL key, parse value, and run `runTtlCleanup` to prune expired items/parts.
- Use `ensureTtlFreshness` on reads to guard against stale data exposed before sweep runs.

### 5.3 Mutation Hooks

- On every `set`/`produce`, refresh TTL metadata:
  - Whole TTL: set `updatedAt = Date.now()`.
  - Part TTL: derive part key via `getPartKey`, update timestamp, and optionally clear missing parts.
  - After mutation, call `runTtlCleanup` once to prune expired parts (per user request) before writing.
- Respect `autoPrune` before persisting.

### 5.4 Storage Events

- For cross-tab sync when `syncTabsState` true:
  - Parse new value.
  - If TTL enabled, update `ttlStates` and run cleanup.
  - Reset to default if expired (delete item from storage).
  - Otherwise, update store state with validated value.

### 5.5 Quota Exceeded Handling

- On `QuotaExceededError`, before evicting other keys:
  - Run TTL cleanup (whole + part) across all TTL-enabled items to free space.
  - Retry operation after cleanup.
- Only fall back to existing priority-based eviction when TTL cleanup insufficient.

## 6. Cleanup Operations

Ensure `clearAll`, `clearAllBy`, `delete`, quota evictions, and session changes always call `clearTtlState`. When TTL cleanup removes an item or part, propagate the change back through `persistValue` so stores stay consistent.

## 7. Testing Strategy

- Use Vitest (`pnpm test:run`) with `happy-dom`.
- Add suite in `tests/main.test.ts` (or dedicated file) covering:
  - Whole-item TTL expiry via idle callback and via explicit `get`.
  - Part TTL pruning during idle sweep and after updates.
  - Storage event propagation removing expired data in secondary instance.
  - Quota recovery: TTL cleanup triggered before session priority eviction.
- Use `vi.useFakeTimers()` to simulate time jumps; verify storage snapshots (`getStorageItems()`) include compact envelope.
- Verify no regressions for non-TTL keys.

## 8. Lint & Type Safety

- Avoid custom type guards; rely on helper functions without `value is` signatures unless placed in allowed files.
- Stay within existing lint rules (no type assertions) by structuring parsing helpers to return typed objects.
- Add succinct comments only where logic is non-obvious (e.g., explaining compact metadata keys).

## 9. Documentation

- Update README or developer notes (AGENTS.md) with TTL usage instructions if necessary.
- Mention compact envelope for contributors; note that storage snapshots will now show `_` metadata.

## 10. Verification

- After implementation run:
  - `pnpm lint`
  - `pnpm test:run`
- Optionally run `pnpm build:no-test` to confirm bundling unaffected.
