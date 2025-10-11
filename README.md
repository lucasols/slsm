# slsm (Smart Local Storage Manager)

A type-safe, schema-validated wrapper around browser localStorage and sessionStorage with reactive state management, automatic quota recovery, and advanced features like TTL, auto-pruning, and session scoping.

## Features

- **Type-safe**: Full TypeScript support with compile-time type checking
- **Schema validation**: Runtime validation using [runcheck](https://github.com/lucasols/runcheck) schemas
- **Reactive**: Built on [t-state](https://github.com/lucasols/t-state) for reactive state management
- **React hooks**: Built-in `useKey()` and `useKeyWithSelector()` hooks
- **Session scoping**: Isolate storage per user/session
- **TTL support**: Automatic expiration for whole items or individual parts
- **Auto-pruning**: Automatic data cleanup by count or size limits
- **Quota management**: Intelligent recovery from storage quota exceeded errors
- **Priority-based eviction**: Control which items get removed first when quota is exceeded
- **Tab synchronization**: Keep state synchronized across browser tabs
- **Dual storage**: Use either localStorage or sessionStorage per item

## Installation

```bash
pnpm add slsm
```

## Quick Start

```typescript
import { createSmartLocalStorage } from 'slsm';
import { rc_string, rc_array, rc_object, rc_number, rc_boolean } from 'runcheck';

// Define your storage schema
const storage = createSmartLocalStorage({
  items: {
    username: {
      schema: rc_string,
      default: '',
    },
    todos: {
      schema: rc_array(rc_object({
        id: rc_number,
        text: rc_string,
        done: rc_boolean,
      })),
      default: [],
    },
  },
});

// Set values
storage.set('username', 'john');
storage.set('todos', [{ id: 1, text: 'Learn slsm', done: false }]);

// Get values
const username = storage.get('username'); // Type: string
const todos = storage.get('todos'); // Type: { id: number, text: string, done: boolean }[]

// Update values immutably with produce
storage.produce('todos', (draft) => {
  draft.push({ id: 2, text: 'Build app', done: false });
});
```

## React Integration

```typescript
import { createSmartLocalStorage } from 'slsm';

const storage = createSmartLocalStorage({
  items: {
    count: { schema: rc_number, default: 0 },
    user: { schema: rc_object({ name: rc_string }), default: { name: '' } },
  },
});

function Counter() {
  const count = storage.useKey('count');

  return (
    <button onClick={() => storage.set('count', count + 1)}>
      Count: {count}
    </button>
  );
}

function UserName() {
  // Use selector for optimized partial subscriptions
  const useUserSelector = storage.useKeyWithSelector('user');
  const name = useUserSelector((user) => user.name);

  return <div>Name: {name}</div>;
}
```

## API Reference

### `createSmartLocalStorage<Schemas>(options)`

Creates a smart storage instance.

#### Options

- **`items`** (required): Object defining storage items with their schemas and options
- **`getSessionId`** (optional): Function returning current session ID for scoping. Return `false` to disable storage for that session
- **`compress`** (optional): Global compression configuration (future feature)

#### Item Options

Each item in `items` can have the following options:

- **`schema`** (required): Runcheck schema for validation
- **`default`** (required): Default value when storage is empty
- **`syncTabsState`** (optional): Enable cross-tab synchronization via storage events
- **`priority`** (optional): Priority for quota eviction (higher = kept longer). Default: `0`
- **`ignoreSessionId`** (optional): Don't scope this item to session ID
- **`useSessionStorage`** (optional): Use sessionStorage instead of localStorage
- **`ttl`** (optional): Time-to-live configuration (see TTL section)
- **`autoPrune`** (optional): Function to automatically trim data on every write
- **`autoPruneBySize`** (optional): Automatically prune by size limits
- **`compress`** (optional): Item-specific compression configuration (future feature)

### Methods

#### `set(key, value)`

Set a value. Value can be a direct value or a setter function.

```typescript
storage.set('count', 5);
storage.set('count', (current) => current + 1);
```

#### `get(key)`

Get the current value.

```typescript
const count = storage.get('count');
```

#### `produce(key, fn)`

Update value using an Immer-like producer function.

```typescript
storage.produce('todos', (draft) => {
  draft[0].done = true;
});
```

#### `delete(key)`

Delete an item (resets to default value).

```typescript
storage.delete('count');
```

#### `clearAll()`

Clear all storage items managed by this instance.

```typescript
storage.clearAll();
```

#### `clearAllBy(options)`

Selective clearing based on session ID.

```typescript
// Clear specific session
storage.clearAllBy({ sessionId: 'session-123' });

// Clear all sessions
storage.clearAllBy({ allSessionIds: true });

// Clear items with no session ID
storage.clearAllBy({ withNoSessionId: true });
```

#### `useKey(key)`

React hook that returns the current value and subscribes to changes.

```typescript
const todos = storage.useKey('todos');
```

#### `useKeyWithSelector(key)`

React hook that returns a selector function for optimized partial subscriptions.

```typescript
const useUserSelector = storage.useKeyWithSelector('user');
const userName = useUserSelector((user) => user.name);
```

#### `getStore(key)`

Get the underlying t-state Store instance.

```typescript
const store = storage.getStore('count');
```

## Advanced Features

### Session Scoping

Isolate storage per user or session:

```typescript
const storage = createSmartLocalStorage({
  getSessionId: () => getCurrentUserId(), // e.g., 'user-123'
  items: {
    preferences: { schema: rc_object({ theme: rc_string }), default: { theme: 'light' } },
    // This item ignores session scoping
    appVersion: { schema: rc_string, default: '1.0.0', ignoreSessionId: true },
  },
});
```

Storage keys will be scoped: `slsm-user-123||preferences`

### TTL (Time To Live)

#### Whole Item TTL

Items expire after a specified duration:

```typescript
const storage = createSmartLocalStorage({
  items: {
    sessionToken: {
      schema: rc_string,
      default: '',
      ttl: {
        minutes: 30, // Expires after 30 minutes
      },
    },
  },
});
```

#### Per-Part TTL

Expire individual parts of a value:

```typescript
const storage = createSmartLocalStorage({
  items: {
    feed: {
      schema: rc_array(rc_object({ id: rc_string, content: rc_string })),
      default: [],
      ttl: {
        minutes: 60,
        splitIntoParts: (feed) => feed.map(item => item.id),
        removePart: (feed, partKey) => feed.filter(item => item.id !== partKey),
      },
    },
  },
});
```

Each feed item has its own TTL. When a part expires, it's automatically removed while keeping fresh items.

### Auto-Pruning

#### Prune by Count

Keep only the last N items:

```typescript
const storage = createSmartLocalStorage({
  items: {
    recentSearches: {
      schema: rc_array(rc_string),
      default: [],
      autoPrune: (searches) => {
        return searches.length > 10 ? searches.slice(-10) : searches;
      },
    },
  },
});
```

#### Prune by Size

Automatically trim data to stay under size limits:

```typescript
const storage = createSmartLocalStorage({
  items: {
    chatHistory: {
      schema: rc_object({ messages: rc_array(rc_string) }),
      default: { messages: [] },
      autoPruneBySize: {
        maxKb: 50, // Max 50KB
        performPruneStep: (chat) => ({
          messages: chat.messages.slice(1), // Remove oldest message
        }),
      },
    },
  },
});
```

### Priority-Based Quota Management

When storage quota is exceeded, items are removed based on:
1. Session (different sessions first)
2. Priority (lower priority first)
3. Size (larger items first within same priority)

```typescript
const storage = createSmartLocalStorage({
  items: {
    criticalData: { schema: rc_string, default: '', priority: 10 },
    cachedData: { schema: rc_string, default: '', priority: 1 },
    tempData: { schema: rc_string, default: '' }, // priority: 0 (default)
  },
});
```

When quota is exceeded, items are removed in this order: `tempData` → `cachedData` → `criticalData`

### Dual Storage (localStorage vs sessionStorage)

Use sessionStorage for tab-specific data:

```typescript
const storage = createSmartLocalStorage({
  items: {
    userPreferences: { schema: rc_object({}), default: {} }, // localStorage
    currentTab: { schema: rc_string, default: '', useSessionStorage: true }, // sessionStorage
  },
});
```

### Cross-Tab Synchronization

Enable synchronization across browser tabs:

```typescript
const storage = createSmartLocalStorage({
  items: {
    sharedState: {
      schema: rc_object({ count: rc_number }),
      default: { count: 0 },
      syncTabsState: true, // Changes sync across tabs
    },
  },
});
```

## Storage Key Format

Internal storage keys follow this pattern:

```
slsm[-{sessionId}][|s]||{itemKey}
```

Examples:
- `slsm||username` - No session, localStorage
- `slsm-user123||preferences` - With session, localStorage
- `slsm|s||tempData` - No session, sessionStorage
- `slsm-user123|s||tabState` - With session, sessionStorage

## License

MIT

## Credits

Built with:
- [t-state](https://github.com/lucasols/t-state) - Reactive state management
- [runcheck](https://github.com/lucasols/runcheck) - Runtime type validation
