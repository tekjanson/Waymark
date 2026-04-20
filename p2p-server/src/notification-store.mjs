import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

async function ensureFile(filePath, fallbackContent) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
        await fs.access(filePath);
    } catch {
        await fs.writeFile(filePath, fallbackContent, 'utf8');
    }
}

function normalizeLimit(limit, fallback = 100) {
    const n = Number.parseInt(String(limit ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, 1000);
}

export class NotificationStore {
    constructor({ bufferFile, historyFile }) {
        this.bufferFile = bufferFile;
        this.historyFile = historyFile;
        this._opChain = Promise.resolve();
    }

    async init() {
        await ensureFile(this.bufferFile, '[]\n');
        await ensureFile(this.historyFile, '');
    }

    _withLock(work) {
        const next = this._opChain.then(work, work);
        this._opChain = next.then(() => {}, () => {});
        return next;
    }

    async _readBufferUnsafe() {
        const raw = await fs.readFile(this.bufferFile, 'utf8');
        if (!raw.trim()) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }

    async _writeBufferUnsafe(entries) {
        await fs.writeFile(this.bufferFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    }

    async listBuffer() {
        return this._withLock(async () => this._readBufferUnsafe());
    }

    async getBufferedById(id) {
        return this._withLock(async () => {
            const entries = await this._readBufferUnsafe();
            return entries.find(e => e.id === id) || null;
        });
    }

    async enqueue(payload) {
        return this._withLock(async () => {
            const entries = await this._readBufferUnsafe();
            const now = Date.now();
            const entry = {
                id: randomUUID(),
                createdAtMs: now,
                status: 'buffered',
                peerId: payload.peerId,
                targetPeerId: payload.targetPeerId || null,
                mode: payload.targetPeerId ? 'target' : 'broadcast',
                title: payload.title,
                body: payload.body,
                metadata: payload.metadata || {},
            };
            entries.push(entry);
            await this._writeBufferUnsafe(entries);
            return entry;
        });
    }

    async moveBufferedToHistory(id, pushResult) {
        return this._withLock(async () => {
            const entries = await this._readBufferUnsafe();
            const idx = entries.findIndex(e => e.id === id);
            if (idx < 0) return null;

            const [entry] = entries.splice(idx, 1);
            await this._writeBufferUnsafe(entries);

            const historyEntry = {
                ...entry,
                status: 'pushed',
                pushedAtMs: Date.now(),
                pushResult,
            };
            await fs.appendFile(this.historyFile, `${JSON.stringify(historyEntry)}\n`, 'utf8');
            return historyEntry;
        });
    }

    async listHistory({ limit } = {}) {
        const max = normalizeLimit(limit, 100);
        return this._withLock(async () => {
            const raw = await fs.readFile(this.historyFile, 'utf8');
            if (!raw.trim()) return [];
            const lines = raw.trim().split('\n');
            const selected = lines.slice(-max);
            const items = [];
            for (const line of selected) {
                try {
                    items.push(JSON.parse(line));
                } catch {
                    // Skip malformed history lines instead of failing the API.
                }
            }
            return items;
        });
    }
}
