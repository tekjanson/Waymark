/**
 * Contract tests for NotificationStore.
 *
 * These tests capture the BEHAVIOURAL CONTRACT of the current production
 * implementation. They serve as the verification harness for the Strangler
 * Fig re-implementation: if Gemini's generated code passes every case here,
 * it is a safe drop-in replacement.
 *
 * fs/promises and crypto are mocked so tests never touch the real filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs/promises before the module under test is imported ─────────────────
vi.mock('fs/promises', () => {
    const impl = {
        mkdir:      vi.fn().mockResolvedValue(undefined),
        access:     vi.fn().mockResolvedValue(undefined),
        readFile:   vi.fn().mockResolvedValue('[]'),
        writeFile:  vi.fn().mockResolvedValue(undefined),
        appendFile: vi.fn().mockResolvedValue(undefined),
    };
    return { default: impl, ...impl };
});

vi.mock('crypto', () => ({
    randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
}));

import fs from 'fs/promises';
import { NotificationStore } from './notification-store.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build N lines of NDJSON history entries. */
function buildHistoryLines(n) {
    return Array.from({ length: n }, (_, i) =>
        JSON.stringify({ id: `h${i}`, status: 'pushed', peerId: 'p', title: 't', body: 'b' })
    ).join('\n');
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('NotificationStore', () => {
    let store;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new NotificationStore({
            bufferFile:  '/tmp/test-buffer.json',
            historyFile: '/tmp/test-history.ndjson',
        });
    });

    // ── init() ───────────────────────────────────────────────────────────────

    describe('init()', () => {
        it('creates buffer file with "[]" when it does not exist', async () => {
            fs.access.mockRejectedValueOnce(new Error('ENOENT')).mockRejectedValueOnce(new Error('ENOENT'));
            await store.init();
            expect(fs.writeFile).toHaveBeenCalledWith('/tmp/test-buffer.json', '[]\n', 'utf8');
        });

        it('creates history file with empty string when it does not exist', async () => {
            fs.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ENOENT'));
            await store.init();
            expect(fs.writeFile).toHaveBeenCalledWith('/tmp/test-history.ndjson', '', 'utf8');
        });

        it('does not overwrite either file when both already exist', async () => {
            fs.access.mockResolvedValue(undefined); // both files exist
            await store.init();
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        it('creates parent directory for buffer file', async () => {
            fs.access.mockRejectedValue(new Error('ENOENT'));
            await store.init();
            expect(fs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
        });
    });

    // ── enqueue(payload) ─────────────────────────────────────────────────────

    describe('enqueue(payload)', () => {
        beforeEach(() => {
            fs.readFile.mockResolvedValue('[]');
        });

        it('returns a new entry with correct id and status', async () => {
            const entry = await store.enqueue({ peerId: 'peer-a', title: 'T', body: 'B' });
            expect(entry.id).toBe('test-uuid-1234');
            expect(entry.status).toBe('buffered');
        });

        it('sets mode to "broadcast" when targetPeerId is absent', async () => {
            const entry = await store.enqueue({ peerId: 'peer-a', title: 'T', body: 'B' });
            expect(entry.mode).toBe('broadcast');
            expect(entry.targetPeerId).toBeNull();
        });

        it('sets mode to "target" when targetPeerId is provided', async () => {
            const entry = await store.enqueue({
                peerId: 'peer-a', targetPeerId: 'peer-b', title: 'T', body: 'B',
            });
            expect(entry.mode).toBe('target');
            expect(entry.targetPeerId).toBe('peer-b');
        });

        it('includes a numeric createdAtMs timestamp', async () => {
            const before = Date.now();
            const entry = await store.enqueue({ peerId: 'p', title: 'T', body: 'B' });
            const after = Date.now();
            expect(typeof entry.createdAtMs).toBe('number');
            expect(entry.createdAtMs).toBeGreaterThanOrEqual(before);
            expect(entry.createdAtMs).toBeLessThanOrEqual(after);
        });

        it('passes through custom metadata', async () => {
            const entry = await store.enqueue({ peerId: 'p', title: 'T', body: 'B', metadata: { k: 1 } });
            expect(entry.metadata).toEqual({ k: 1 });
        });

        it('defaults metadata to {} when not provided', async () => {
            const entry = await store.enqueue({ peerId: 'p', title: 'T', body: 'B' });
            expect(entry.metadata).toEqual({});
        });

        it('persists the entry to the buffer file', async () => {
            await store.enqueue({ peerId: 'p', title: 'T', body: 'B' });
            expect(fs.writeFile).toHaveBeenCalledWith(
                '/tmp/test-buffer.json',
                expect.stringContaining('"test-uuid-1234"'),
                'utf8'
            );
        });

        it('appends to existing entries rather than overwriting them', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify([{ id: 'existing' }]));
            await store.enqueue({ peerId: 'p', title: 'T', body: 'B' });
            const written = fs.writeFile.mock.calls[0][1];
            const parsed = JSON.parse(written.trim());
            expect(parsed).toHaveLength(2);
            expect(parsed[0].id).toBe('existing');
        });
    });

    // ── listBuffer() ─────────────────────────────────────────────────────────

    describe('listBuffer()', () => {
        it('returns empty array when file contains "[]"', async () => {
            fs.readFile.mockResolvedValue('[]');
            expect(await store.listBuffer()).toEqual([]);
        });

        it('returns parsed entries', async () => {
            const entries = [{ id: '1', status: 'buffered' }];
            fs.readFile.mockResolvedValue(JSON.stringify(entries));
            expect(await store.listBuffer()).toEqual(entries);
        });

        it('returns empty array for whitespace-only file content', async () => {
            fs.readFile.mockResolvedValue('   ');
            expect(await store.listBuffer()).toEqual([]);
        });

        it('returns empty array if parsed value is not an array', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ not: 'an array' }));
            expect(await store.listBuffer()).toEqual([]);
        });
    });

    // ── getBufferedById(id) ───────────────────────────────────────────────────

    describe('getBufferedById(id)', () => {
        it('returns the matching entry by id', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify([
                { id: 'abc', status: 'buffered' },
                { id: 'xyz', status: 'buffered' },
            ]));
            const result = await store.getBufferedById('abc');
            expect(result).toMatchObject({ id: 'abc' });
        });

        it('returns null when id is not found', async () => {
            fs.readFile.mockResolvedValue('[]');
            expect(await store.getBufferedById('missing')).toBeNull();
        });
    });

    // ── moveBufferedToHistory(id, pushResult) ─────────────────────────────────

    describe('moveBufferedToHistory(id, pushResult)', () => {
        it('removes the entry from the buffer', async () => {
            const entry = { id: 'abc', status: 'buffered', peerId: 'p', title: 'T', body: 'B', metadata: {} };
            fs.readFile.mockResolvedValue(JSON.stringify([entry]));
            await store.moveBufferedToHistory('abc', { ok: true });
            const written = fs.writeFile.mock.calls[0][1];
            expect(JSON.parse(written.trim())).toEqual([]);
        });

        it('appends the history entry to the history file as NDJSON', async () => {
            const entry = { id: 'abc', status: 'buffered', peerId: 'p', title: 'T', body: 'B', metadata: {} };
            fs.readFile.mockResolvedValue(JSON.stringify([entry]));
            await store.moveBufferedToHistory('abc', { fcmId: 'x' });
            expect(fs.appendFile).toHaveBeenCalledWith(
                '/tmp/test-history.ndjson',
                expect.stringContaining('"abc"'),
                'utf8'
            );
        });

        it('returns a history entry with status "pushed" and pushResult', async () => {
            const entry = { id: 'abc', status: 'buffered', peerId: 'p', title: 'T', body: 'B', metadata: {} };
            fs.readFile.mockResolvedValue(JSON.stringify([entry]));
            const result = await store.moveBufferedToHistory('abc', { ok: true });
            expect(result).toMatchObject({ id: 'abc', status: 'pushed', pushResult: { ok: true } });
        });

        it('includes a numeric pushedAtMs timestamp in the history entry', async () => {
            const entry = { id: 'abc', status: 'buffered', peerId: 'p', title: 'T', body: 'B', metadata: {} };
            fs.readFile.mockResolvedValue(JSON.stringify([entry]));
            const result = await store.moveBufferedToHistory('abc', {});
            expect(typeof result.pushedAtMs).toBe('number');
        });

        it('returns null when the id does not exist in the buffer', async () => {
            fs.readFile.mockResolvedValue('[]');
            expect(await store.moveBufferedToHistory('missing', {})).toBeNull();
        });
    });

    // ── listHistory({ limit }) — also covers normalizeLimit ──────────────────

    describe('listHistory({ limit })', () => {
        it('returns empty array for empty history file', async () => {
            fs.readFile.mockResolvedValue('');
            expect(await store.listHistory()).toEqual([]);
        });

        it('returns empty array for whitespace-only file', async () => {
            fs.readFile.mockResolvedValue('   ');
            expect(await store.listHistory()).toEqual([]);
        });

        it('returns all entries when count is below default limit (100)', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(3));
            const result = await store.listHistory();
            expect(result).toHaveLength(3);
        });

        it('respects the limit parameter — returns most recent N lines', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(10));
            const result = await store.listHistory({ limit: 3 });
            expect(result).toHaveLength(3);
            // Most recent = last lines in the file
            expect(result[2]).toMatchObject({ id: 'h9' });
        });

        it('clamps limit to 1000 maximum (normalizeLimit cap)', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(5));
            // Even if 9999 is requested, only 5 lines exist — no error
            const result = await store.listHistory({ limit: 9999 });
            expect(result).toHaveLength(5);
        });

        it('falls back to default limit (100) for non-numeric strings', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(5));
            const result = await store.listHistory({ limit: 'garbage' });
            expect(result).toHaveLength(5);
        });

        it('falls back to default limit (100) for negative numbers', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(5));
            const result = await store.listHistory({ limit: -1 });
            expect(result).toHaveLength(5);
        });

        it('falls back to default limit (100) when limit is zero', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(5));
            const result = await store.listHistory({ limit: 0 });
            expect(result).toHaveLength(5);
        });

        it('skips malformed JSON lines without throwing', async () => {
            fs.readFile.mockResolvedValue(
                `{"id":"good1"}\nNOT_VALID_JSON\n{"id":"good2"}`
            );
            const result = await store.listHistory();
            expect(result).toHaveLength(2);
            expect(result.map(e => e.id)).toEqual(['good1', 'good2']);
        });

        it('returns correct entries when no limit argument is passed', async () => {
            fs.readFile.mockResolvedValue(buildHistoryLines(2));
            const result = await store.listHistory();
            expect(result).toHaveLength(2);
        });
    });
});
