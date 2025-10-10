# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**slsm** (Smart Local Storage Manager) is a TypeScript library that provides a type-safe, schema-validated wrapper around browser localStorage and sessionStorage. Built on top of `t-state` for reactive state management, it includes React hooks, session scoping, automatic quota management, and data validation using `runcheck`.

## Package Manager

This project uses **pnpm**. Always use `pnpm` commands, never `npm` or `npx`.

## Common Commands

### Testing
- `pnpm test` - Run tests in interactive UI mode with Vitest
- `pnpm test:run` - Run tests once without UI

### Type Checking & Linting
- `pnpm tsc` - Run TypeScript compiler (checks types only, no emit)
- `pnpm eslint` - Run ESLint with max warnings = 0
- `pnpm lint` - Run both `tsc` and `eslint` sequentially

### Building
- `pnpm build` - Full build: runs tests, lint, then builds the package
- `pnpm build:no-test` - Build package without running tests (uses tsup)
- `pnpm pre-publish` - Pre-publish check: validates sync state and builds

## Architecture

### Core Implementation

The entire library is implemented in a single file: `src/main.ts` (~490 lines). The main export is `createSmartLocalStorage<Schemas>()` which returns an object with methods to interact with storage.

### Key Architectural Concepts

1. **Schema-Based Storage**: Each storage key must be defined with a `runcheck` schema for runtime validation
2. **Session Scoping**: Items can be scoped to session IDs, allowing multiple users/sessions to have isolated storage
3. **Dual Storage**: Items can use either `localStorage` (persistent) or `sessionStorage` (tab-scoped) via `useSessionStorage` option
4. **Internal State Store**: Uses `t-state` Store to maintain an in-memory cache of storage values for React reactivity
5. **Storage Key Format**: Internal keys follow pattern `slsm[-{sessionId}][|s]||{itemKey}` where:
   - `slsm` is the prefix
   - `-{sessionId}` is optional session identifier
   - `|s` indicates sessionStorage (vs localStorage)
   - `||` separates metadata from the actual key name

### Storage Quota Management

The library includes automatic quota recovery logic (src/main.ts:136-206):
- When `QuotaExceededError` occurs, it attempts to free space by:
  1. First removing all sessionStorage items
  2. Then removing localStorage items from different sessions
  3. Finally removing the largest item in current session
  4. Retries the failed operation after each cleanup

### Validation & Type Safety

- All values are validated against their schema on read/write using `runcheck`
- Invalid values return `undefined` and log errors
- The library uses TypeScript generics to ensure compile-time type safety

### React Integration

Two React hooks are provided:
- `useKey(key)` - Returns the current value and subscribes to changes
- `useKeyWithSelector(key)` - Returns a selector function for optimized partial subscriptions

### Auto-Pruning

Items can specify an `autoPrune` function that runs on every set/produce operation to automatically trim data (e.g., keep only last N items).

### Storage Events

The library listens to the browser's `storage` event (src/main.ts:248-283) to synchronize state when localStorage is modified externally (e.g., from another tab).

## Test Environment

- **Test Runner**: Vitest
- **Test Files**: Located in `tests/*.test.ts`
- **DOM Environment**: Uses `happy-dom` for browser environment simulation
- **Test Utils**: `tests/utils.js` provides mocked localStorage/sessionStorage with quota simulation
- Tests include coverage for:
  - Basic CRUD operations
  - Session scoping and isolation
  - Quota management and recovery
  - React hooks behavior
  - Validation and error handling
  - Auto-pruning

## Build Configuration

- **Build Tool**: tsup
- **Entry Point**: `src/main.ts`
- **Output Formats**: ESM only
- **Source Maps**: Enabled
- **Type Definitions**: Generated automatically (`.d.ts`)
- **Property Mangling**: Properties ending with single underscore (e.g., `_`) are mangled for size optimization

## ESLint Configuration

The project uses `@ls-stack/eslint-cfg` with some rules disabled:
- `@typescript-eslint/no-explicit-any`: OFF
- `@typescript-eslint/no-unsafe-assignment`: OFF

## Important Notes

- The library automatically cleans up storage items that are no longer configured on initialization (src/main.ts:79-98)
- Values are deep-cloned using `klona` when stored to prevent reference mutations
- `requestIdleCallback` is used for non-critical cleanup operations
- The library checks for browser environment with `typeof localStorage !== 'undefined'`
