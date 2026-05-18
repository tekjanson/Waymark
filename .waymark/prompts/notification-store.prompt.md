---
target: p2p-server/src/notification-store.mjs
test: p2p-server/src/notification-store.test.mjs
status: active
---

# NotificationStore — File-backed push notification buffer

## Purpose

A file-backed queue for push notifications in the Waymark P2P server.

Provides a two-file persistence model:
- A **JSON buffer** (`bufferFile`) holding pending (not-yet-delivered) notifications.
- An **append-only NDJSON history** (`historyFile`) of notifications that have been
  handed to the push delivery pipeline.

This is the single source of truth for the P2P notification lifecycle.

## Exports

### `class NotificationStore`

Constructor: `new NotificationStore({ bufferFile: string, historyFile: string })`

#### Methods

| Method | Signature | Returns |
|--------|-----------|---------|
| `init` | `async init()` | `Promise<void>` — ensure both files exist |
| `enqueue` | `async enqueue(payload)` | `Promise<Entry>` — add to buffer |
| `listBuffer` | `async listBuffer()` | `Promise<Entry[]>` — all buffered entries |
| `getBufferedById` | `async getBufferedById(id)` | `Promise<Entry\|null>` — find by UUID |
| `moveBufferedToHistory` | `async moveBufferedToHistory(id, pushResult)` | `Promise<HistoryEntry\|null>` |
| `listHistory` | `async listHistory({ limit? })` | `Promise<HistoryEntry[]>` — recent N entries |

## Internal Helpers (not exported, but MUST be present)

### `normalizeLimit(limit, fallback = 100)`

Pure helper function. Parses `limit` to an integer.

- Returns `fallback` if the value is not a finite positive number
  (handles `null`, `undefined`, strings, negative numbers, zero).
- Caps result at **1000** maximum.
- Used internally by `listHistory`.

### `ensureFile(filePath, fallbackContent)`

Async helper. Creates the file (and parent directory) with `fallbackContent`
if it does not already exist. Uses `fs.access` to check for existence.

## Concurrency Model

All public methods serialize through a promise chain (`this._opChain = Promise.resolve()`).
Each operation uses `_withLock(work)`:
```
_withLock(work) {
    const next = this._opChain.then(work, work);
    this._opChain = next.then(() => {}, () => {});
    return next;
}
```
This prevents concurrent reads/writes from corrupting the JSON buffer file.

## Entry Schema

### Buffered entry (returned by `enqueue`, `listBuffer`, `getBufferedById`)

```json
{
  "id": "uuid-v4",
  "createdAtMs": 1234567890,
  "status": "buffered",
  "peerId": "sender-peer-id",
  "targetPeerId": null,
  "mode": "broadcast",
  "title": "Notification title",
  "body": "Notification body text",
  "metadata": {}
}
```

Fields:
- `id` — `randomUUID()` from `node:crypto`
- `createdAtMs` — `Date.now()` at enqueue time
- `status` — always `'buffered'` in the buffer
- `mode` — `'target'` if `payload.targetPeerId` is truthy, otherwise `'broadcast'`
- `targetPeerId` — `payload.targetPeerId || null`
- `metadata` — `payload.metadata || {}`

### History entry (returned by `moveBufferedToHistory`, `listHistory`)

Extends the buffered entry:
```json
{
  "...all buffered fields...",
  "status": "pushed",
  "pushedAtMs": 1234567890,
  "pushResult": { "fcmId": "...", "ok": true }
}
```

## File Format Details

- **bufferFile**: Valid JSON array `[...entries]`, pretty-printed with 2-space indent.
  Empty state: `[]\n`
- **historyFile**: Newline-delimited JSON (NDJSON) — one JSON object per line.
  Empty state: `''` (empty string)
  `listHistory` reads the LAST `limit` lines from this file.
  Malformed lines are silently skipped.

## Module System

Pure ESM. Use these exact imports:
```js
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
```

Do NOT use `node:` prefix (for compatibility with the mock harness).
