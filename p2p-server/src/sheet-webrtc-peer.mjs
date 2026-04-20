import { GoogleAuth } from 'google-auth-library';
import { randomBytes } from 'crypto';
import { RTCPeerConnection } from 'werift';

function envMs(name, fallback) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── Signaling layout (column T, matches OrchestratorPeer.kt / SheetsSignalingClient.kt) ───
//
//  this.block  = 1-based sheet row of THIS peer's presence cell (1, 6, 11 …)
//
//  When reading rows[] from _readRange().values  (0-based array index):
//    rows[block - 1]  = T{block}   = presence  { peerId, name, ts, nonce }
//    rows[block]      = T{block+1} = offers    { targetPeerId: { sdp, ts }, … }
//    rows[block + 1]  = T{block+2} = answers   { initiatorPeerId: { sdp, ts }, … }
//
//  For a remote peer at remoteBlock (1-based):
//    rows[remoteBlock - 1]  = their presence
//    rows[remoteBlock]      = their offers
//    rows[remoteBlock + 1]  = their answers
//
//  Master/slave election: higher signaling row is master (offerer), lower row is slave.
//  If rows match unexpectedly, fall back to peerId lexicographic order.

const BLOCK_SIZE       = 5;
const MAX_SLOTS        = 8;
const BLOCK_START      = 1;          // first slot's 1-based row
const TOTAL_ROWS       = MAX_SLOTS * BLOCK_SIZE; // 40
const ALIVE_TTL        = 50_000;     // 50 s (matches OrchestratorPeer.kt ALIVE_TTL)
const OFFER_MAX_AGE    = 3 * 60_000; // 3 min stale-offer timeout
const POLL_MS            = envMs('WAYMARK_POLL_MS', 5_000);
const HEARTBEAT_MS       = envMs('WAYMARK_HEARTBEAT_MS', 15_000);
const ICE_GATHER_TIMEOUT = envMs('WAYMARK_ICE_GATHER_TIMEOUT_MS', 12_000);
// Lower default ping cadence to keep NAT/router bindings warm.
const DC_PING_MS         = envMs('WAYMARK_DC_PING_MS', 10_000);
const DC_PONG_TIMEOUT_MS = envMs('WAYMARK_DC_PONG_TIMEOUT_MS', 45_000);
const HANDSHAKE_TIMEOUT_MS = envMs('WAYMARK_HANDSHAKE_TIMEOUT_MS', 30_000);
const ICE_DISCONNECT_GRACE_MS = envMs('WAYMARK_ICE_DISCONNECT_GRACE_MS', 15_000);
const DIAG_MAX_EVENTS = 1500;
const MAX_SLAVE_POLL_OFFSET_MS = 2_000;
const MAX_SLAVE_HANDSHAKE_DELAY_MS = 2_200;

const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302'  },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
];

export class SheetWebRtcPeer {
    constructor({ sheetId, getToken, peerId, displayName, bufferFile, onMessage, onConnect }) {
        this.sheetId = sheetId;
        this._getTokenFn = getToken || null;
        this.peerId = peerId || randomBytes(4).toString('hex').slice(0, 8);
        this.displayName = displayName || `peer-${this.peerId}`;
        this.bufferFile = bufferFile || null;
        this._onMessage = onMessage || null;
        this._onConnect = onConnect || null;

        this.block = -1;
        this.destroyed = false;
        this._pollTimer = null;
        this._heartbeatTimer = null;
        this._pingTimer = null;
        this._sessionNonce = randomBytes(4).toString('hex');
        this._polling = false; // prevents concurrent poll executions

        // Per-remote-peer connection state
        // state: 'offering' | 'answering' | 'answer-applied' | 'connected'
        this._pcs = new Map();
        // Epoch-ms of last pong received per remote peer
        this._lastPong = new Map();
        // Track the last seen session nonce per remote peer to detect restarts.
        this._remoteNonces = new Map();
        // Per-peer adaptive thrash score used by slave timing.
        this._slaveThrashScore = new Map();
        this._nextPollDelayMs = POLL_MS;

        // Backward-compat single-peer references kept for broadcast() / sendKeyExchangeTo()
        this._dc = null;
        this._connected = false;
        this._remotePeerId = null;

        this._diag = {
            startedAtMs: Date.now(),
            config: {
                BLOCK_SIZE,
                MAX_SLOTS,
                BLOCK_START,
                TOTAL_ROWS,
                ALIVE_TTL,
                OFFER_MAX_AGE,
                POLL_MS,
                HEARTBEAT_MS,
                DC_PING_MS,
                DC_PONG_TIMEOUT_MS,
                HANDSHAKE_TIMEOUT_MS,
                ICE_GATHER_TIMEOUT,
                ICE_DISCONNECT_GRACE_MS,
                STUN_SERVERS,
            },
            counters: {
                readRangeCalls: 0,
                readRangeFailures: 0,
                writeCellCalls: 0,
                writeCellFailures: 0,
                fetchRetries: 0,
                fetchRetryableStatuses: 0,
                pollTicks: 0,
                pollSkippedConcurrent: 0,
                pollFailures: 0,
                heartbeatAttempts: 0,
                heartbeatFailures: 0,
                offersBuilt: 0,
                offerBuildFailures: 0,
                answersBuilt: 0,
                answerBuildFailures: 0,
                answersApplied: 0,
                answerApplyFailures: 0,
                handshakeTimeoutResets: 0,
                nonceResets: 0,
                dcOpen: 0,
                dcClose: 0,
                pingSent: 0,
                pongReceived: 0,
                pongTimeoutCloses: 0,
                broadcastCalls: 0,
                broadcastDelivered: 0,
                targetedCalls: 0,
                targetedDelivered: 0,
                pcTeardown: 0,
            },
            last: {
                lastPollStartedMs: null,
                lastPollDurationMs: null,
                lastHeartbeatMs: null,
                lastReadError: null,
                lastWriteError: null,
                lastPcTeardown: null,
            },
            peers: {},
            events: [],
        };
    }

    _diagPeer(remotePeerId) {
        if (!remotePeerId) return null;
        if (!this._diag.peers[remotePeerId]) {
            this._diag.peers[remotePeerId] = {
                firstSeenMs: Date.now(),
                lastSeenMs: Date.now(),
                offerAttempts: 0,
                offerSuccess: 0,
                offerFailures: 0,
                answerAttempts: 0,
                answerSuccess: 0,
                answerFailures: 0,
                answerApplied: 0,
                answerApplyFailures: 0,
                dcOpen: 0,
                dcClose: 0,
                pingSent: 0,
                pongReceived: 0,
                teardownCount: 0,
                lastState: null,
                lastError: null,
            };
        }
        this._diag.peers[remotePeerId].lastSeenMs = Date.now();
        return this._diag.peers[remotePeerId];
    }

    _diagEvent(type, payload = {}) {
        const evt = { tsMs: Date.now(), type, ...payload };
        this._diag.events.push(evt);
        if (this._diag.events.length > DIAG_MAX_EVENTS) {
            this._diag.events.splice(0, this._diag.events.length - DIAG_MAX_EVENTS);
        }
    }

    getDiagnostics() {
        return {
            peerId: this.peerId,
            displayName: this.displayName,
            sheetId: this.sheetId,
            block: this.block,
            destroyed: this.destroyed,
            connectedPeers: this.connectedPeers(),
            uptimeMs: Date.now() - this._diag.startedAtMs,
            diagnostics: this._diag,
        };
    }

    async _getToken() {
        if (this._getTokenFn) return this._getTokenFn();
        if (process.env.SHEETS_ALLOW_ANON === '1' || process.env.SHEETS_ALLOW_ANON === 'true') {
            return 'anon-token';
        }
        const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!cred) throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set and no getToken provided');
        const auth = new GoogleAuth({ keyFile: cred, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const client = await auth.getClient();
        const { token } = await client.getAccessToken();
        return token;
    }

    async _readRange(range) {
        this._diag.counters.readRangeCalls += 1;
        const base = process.env.SHEETS_BASE || 'https://sheets.googleapis.com/v4/spreadsheets';
        const url = `${base}/${this.sheetId}/values/${encodeURIComponent(range)}`;
        const res = await this._fetchWithBackoff(url, async () => {
            const token = await this._getToken();
            return { headers: { Authorization: `Bearer ${token}` } };
        });
        if (!res.ok) {
            this._diag.counters.readRangeFailures += 1;
            const msg = `Sheets read failed ${res.status}: ${await res.text()}`;
            this._diag.last.lastReadError = { tsMs: Date.now(), range, msg };
            this._diagEvent('sheet-read-failed', { range, status: res.status });
            throw new Error(msg);
        }
        return res.json();
    }

    async _writeCell(range, value) {
        this._diag.counters.writeCellCalls += 1;
        const base = process.env.SHEETS_BASE || 'https://sheets.googleapis.com/v4/spreadsheets';
        const url = `${base}/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
        const body = JSON.stringify({ range, majorDimension: 'ROWS', values: [[value]] });
        const res = await this._fetchWithBackoff(url, async () => {
            const token = await this._getToken();
            return { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body };
        });
        if (!res.ok) {
            this._diag.counters.writeCellFailures += 1;
            const msg = `Sheets write failed ${res.status}: ${await res.text()}`;
            this._diag.last.lastWriteError = { tsMs: Date.now(), range, msg };
            this._diagEvent('sheet-write-failed', { range, status: res.status });
            throw new Error(msg);
        }
    }

    // Generic fetch with exponential backoff and jitter for transient errors (429, 5xx, network)
    async _fetchWithBackoff(url, makeOptsFn, maxRetries = 5) {
        let attempt = 0;
        const baseDelay = 1000; // 1s
        while (true) {
            attempt++;
            try {
                const opts = await makeOptsFn();
                const res = await fetch(url, opts);
                if (res.ok) return res;
                // Retry on 429 or 5xx
                if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                    if (attempt > maxRetries) return res;
                    this._diag.counters.fetchRetries += 1;
                    this._diag.counters.fetchRetryableStatuses += 1;
                    const delay = Math.floor(baseDelay * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4));
                    this._diagEvent('fetch-retry', { attempt, status: res.status, delayMs: delay });
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                return res;
            } catch (e) {
                // network or other error: retry
                if (attempt > maxRetries) throw e;
                this._diag.counters.fetchRetries += 1;
                const delay = Math.floor(baseDelay * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4));
                this._diagEvent('fetch-retry-error', { attempt, delayMs: delay, err: e?.message || String(e) });
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    // Append an entry (JSON) into a per-slot log column (keeps an array of entries)
    async _appendRowLog(col, row, entry) {
        try {
            const range = `Sheet1!${col}${row}`;
            const res = await this._readRange(range).catch(() => ({}));
            const existing = (res.values && res.values[0] && res.values[0][0]) || '';
            let arr = [];
            if (existing) {
                try { arr = JSON.parse(existing); } catch { arr = [existing]; }
            }
            arr.push(Object.assign({ ts: Date.now() }, entry));
            await this._writeCell(range, JSON.stringify(arr));
        } catch (e) {
            // best-effort logging; ignore failures
        }
    }

    async start() {
        if (!this.sheetId) throw new Error('sheetId required');
        const range = `Sheet1!T1:T${TOTAL_ROWS + 1}`;
        this._diagEvent('peer-start', { sheetId: this.sheetId });

        // ── Claim a free presence slot (empty cell or stale peer > ALIVE_TTL) ──
        const initData = await this._readRange(range);
        const initRows = initData.values || [];
        let chosen = -1;
        for (let i = 0; i < MAX_SLOTS; i++) {
            const slotRow = BLOCK_START + i * BLOCK_SIZE; // 1-based: 1, 6, 11 …
            const rowIdx  = slotRow - 1;                  // 0-based: 0, 5, 10 …
            const cell = initRows[rowIdx]?.[0];
            if (!cell) { chosen = slotRow; break; }
            try {
                const obj = JSON.parse(cell);
                if (!obj.peerId || Date.now() - (obj.ts || 0) > ALIVE_TTL) {
                    chosen = slotRow; break;
                }
            } catch { chosen = slotRow; break; }
        }
        if (chosen === -1) throw new Error('no free signaling slot');
        this.block = chosen;
        await this._writePresence();
        console.log(`[SheetWebRtcPeer] joined mesh at T${this.block} peer=${this.peerId}`);
        this._diagEvent('mesh-joined', { block: this.block, peerId: this.peerId });

        // ── Heartbeat: refresh presence timestamp every HEARTBEAT_MS ──
        this._heartbeatTimer = setInterval(() => {
            if (this.destroyed) return;
            this._writePresence().catch(e => console.error('[heartbeat]', e?.message));
        }, HEARTBEAT_MS);

        // ── Poll loop with adaptive slave timing ──
        const scheduleNextPoll = (delayMs) => {
            this._pollTimer = setTimeout(async () => {
                if (this.destroyed) return;
                try {
                    await this._poll(range);
                } catch (e) {
                    console.error('[poll]', e?.message);
                } finally {
                    if (!this.destroyed) {
                        scheduleNextPoll(this._nextPollDelayMs || POLL_MS);
                    }
                }
            }, delayMs);
        };
        scheduleNextPoll(POLL_MS);

        // ── DC ping/pong keepalive every DC_PING_MS ──
        this._pingTimer = setInterval(() => {
            if (this.destroyed) return;
            this._pingAndPrune();
        }, DC_PING_MS);
    }

    /** Write (or refresh) presence for this peer. */
    async _writePresence() {
        this._diag.counters.heartbeatAttempts += 1;
        const p = JSON.stringify({
            peerId: this.peerId,
            name:   this.displayName,
            ts:     Date.now(),
            nonce:  this._sessionNonce,
        });
        try {
            await this._writeCell(`Sheet1!T${this.block}`, p);
            this._diag.last.lastHeartbeatMs = Date.now();
        } catch (e) {
            this._diag.counters.heartbeatFailures += 1;
            this._diagEvent('heartbeat-failed', { err: e?.message || String(e) });
            throw e;
        }
    }

    /**
     * Core poll iteration.
     *
     * Row-index arithmetic:
     *   rows[block - 1]  = T{block}   presence
     *   rows[block]      = T{block+1} offers   { targetPeerId: { sdp, ts } }
     *   rows[block + 1]  = T{block+2} answers  { initiatorPeerId: { sdp, ts } }
     *
     * For a remote at remoteBlock (1-based):
     *   rows[remoteBlock - 1]  their presence
     *   rows[remoteBlock]      their offers
     *   rows[remoteBlock + 1]  their answers
     */
    async _poll(range) {
        if (this.destroyed || this.block < 0) return;
        this._diag.counters.pollTicks += 1;
        this._diag.last.lastPollStartedMs = Date.now();
        // Guard against concurrent executions — if the previous poll is still
        // awaiting Sheets I/O or ICE gathering, skip this tick entirely.
        if (this._polling) {
            this._diag.counters.pollSkippedConcurrent += 1;
            return;
        }
        this._polling = true;
        const pollStart = Date.now();
        try {
            await this._pollInner(range);
            this._diag.last.lastPollDurationMs = Date.now() - pollStart;
        } catch (e) {
            this._diag.counters.pollFailures += 1;
            this._diagEvent('poll-failed', { err: e?.message || String(e) });
            throw e;
        } finally {
            this._polling = false;
        }
    }

    async _pollInner(range) {
        if (this.destroyed || this.block < 0) return;

        const data = await this._readRange(range);
        const rows = data.values || [];

        // Read our own signaling cells
        let myOffers  = {};
        let myAnswers = {};
        let offDirty  = false;
        let ansDirty  = false;
        try { myOffers  = JSON.parse(rows[this.block]?.[0]     || '{}'); } catch {}
        try { myAnswers = JSON.parse(rows[this.block + 1]?.[0] || '{}'); } catch {}

        // Build alive peer maps from presence rows first so we can prune stale state.
        const aliveById = new Map(); // peerId -> { block, nonce, ts }
        for (let i = 0; i < MAX_SLOTS; i++) {
            const remoteBlock = BLOCK_START + i * BLOCK_SIZE;
            if (remoteBlock === this.block) continue;
            const raw = rows[remoteBlock - 1]?.[0];
            if (!raw) continue;
            let p;
            try { p = JSON.parse(raw); } catch { continue; }
            if (!p?.peerId) continue;
            const ts = p.ts || 0;
            if (Date.now() - ts > ALIVE_TTL) continue;
            // If duplicate rows exist for the same peerId, keep the freshest one only.
            const prev = aliveById.get(p.peerId);
            if (!prev || ts > prev.ts) {
                aliveById.set(p.peerId, { block: remoteBlock, nonce: p.nonce || '', ts });
            }
        }

        // 1) Drop local connection objects for peers no longer alive.
        for (const [peerId, entry] of this._pcs) {
            if (!aliveById.has(peerId)) {
                try { entry.pc.close(); } catch {}
                this._pcs.delete(peerId);
                this._lastPong.delete(peerId);
                this._remoteNonces.delete(peerId);
                if (this._remotePeerId === peerId) {
                    this._remotePeerId = null;
                    this._dc = null;
                    this._connected = false;
                }
            }
        }

        // 2) Remove stale signaling rows for peers that are no longer alive.
        for (const peerId of Object.keys(myOffers)) {
            if (!aliveById.has(peerId)) {
                delete myOffers[peerId];
                offDirty = true;
            }
        }
        for (const peerId of Object.keys(myAnswers)) {
            if (!aliveById.has(peerId)) {
                delete myAnswers[peerId];
                ansDirty = true;
            }
        }

        // ── Scan unique alive peers (deduped by peerId) ──
        for (const [remotePeerId, remoteInfo] of aliveById.entries()) {
            const remoteBlock = remoteInfo.block; // 1-based
            let entry = this._pcs.get(remotePeerId);

            // Restart detection: if presence nonce changed, remote restarted.
            // Drop stale connection and signaling so a fresh handshake starts now.
            const seenNonce = this._remoteNonces.get(remotePeerId);
            const nextNonce = remoteInfo.nonce || '';
            if (seenNonce && nextNonce && seenNonce !== nextNonce) {
                if (entry) {
                    console.log(`[poll] remote ${remotePeerId} nonce changed; resetting connection`);
                    this._diag.counters.nonceResets += 1;
                    this._diagEvent('nonce-reset', { remotePeerId });
                    try { entry.pc.close(); } catch {}
                    this._pcs.delete(remotePeerId);
                    this._lastPong.delete(remotePeerId);
                    entry = undefined;
                }
                if (myOffers[remotePeerId])  { delete myOffers[remotePeerId];  offDirty = true; }
                if (myAnswers[remotePeerId]) { delete myAnswers[remotePeerId]; ansDirty = true; }
            }
            this._remoteNonces.set(remotePeerId, nextNonce);

            // ── Dead-DC check: if the channel closed, tear down and fall through to rebuild ──
            if (entry) {
                const dcState = entry.dc?.readyState;
                if (dcState === 'closed' || dcState === 'closing') {
                    console.log(`[poll] DC with ${remotePeerId} is ${dcState} — tearing down for reconnect`);
                    try { entry.pc.close(); } catch {}
                    this._pcs.delete(remotePeerId);
                    this._lastPong.delete(remotePeerId);
                    if (myOffers[remotePeerId])  { delete myOffers[remotePeerId];  offDirty = true; }
                    if (myAnswers[remotePeerId]) { delete myAnswers[remotePeerId]; ansDirty = true; }
                    entry = undefined;
                }
            }

            // If handshake has been stuck too long, reset and try again.
            if (entry && entry.state !== 'connected') {
                const startedAt = entry.startedAt || 0;
                if (startedAt > 0 && Date.now() - startedAt > HANDSHAKE_TIMEOUT_MS) {
                    console.log(`[poll] handshake timeout for ${remotePeerId} in state=${entry.state}; resetting`);
                    this._diag.counters.handshakeTimeoutResets += 1;
                    this._diagEvent('handshake-timeout-reset', { remotePeerId, state: entry.state });
                    try { entry.pc.close(); } catch {}
                    this._pcs.delete(remotePeerId);
                    this._lastPong.delete(remotePeerId);
                    if (myOffers[remotePeerId])  { delete myOffers[remotePeerId];  offDirty = true; }
                    if (myAnswers[remotePeerId]) { delete myAnswers[remotePeerId]; ansDirty = true; }
                    entry = undefined;
                }
            }

            // Connected peers can have stale signaling cleaned immediately.
            if (entry?.state === 'connected') {
                if (myOffers[remotePeerId])  { delete myOffers[remotePeerId];  offDirty = true; }
                if (myAnswers[remotePeerId]) { delete myAnswers[remotePeerId]; ansDirty = true; }
                continue;
            }
            // For in-progress states, DO NOT clear myAnswers/myOffers yet.
            // Clearing early can delete the answer before the initiator reads it.
            if (entry?.state === 'answer-applied' || entry?.state === 'answering') {
                continue;
            }
            // Legacy: entry exists but uses old boolean connected flag
            if (entry?.connected) {
                if (myOffers[remotePeerId])  { delete myOffers[remotePeerId];  offDirty = true; }
                if (myAnswers[remotePeerId]) { delete myAnswers[remotePeerId]; ansDirty = true; }
                continue;
            }

            const weInit = this._shouldInitiateHandshake(remotePeerId, remoteBlock);

            if (weInit) {
                // ── We are the offerer ──
                if (!myOffers[remotePeerId]) {
                    // No offer sent yet — build one (vanilla ICE: SDP includes all candidates)
                    try {
                        this._diag.counters.offersBuilt += 1;
                        const pd = this._diagPeer(remotePeerId);
                        if (pd) pd.offerAttempts += 1;
                        const sdp = await this._buildOffer(remotePeerId); // sets state='offering'
                        if (sdp) {
                            const pd2 = this._diagPeer(remotePeerId);
                            if (pd2) pd2.offerSuccess += 1;
                            myOffers[remotePeerId] = { sdp, ts: Date.now() };
                            offDirty = true;
                        }
                    } catch (e) {
                        this._markSlaveThrash(remotePeerId);
                        this._diag.counters.offerBuildFailures += 1;
                        const pd3 = this._diagPeer(remotePeerId);
                        if (pd3) { pd3.offerFailures += 1; pd3.lastError = e?.message || String(e); }
                        this._diagEvent('build-offer-failed', { remotePeerId, err: e?.message || String(e) });
                        console.error(`[buildOffer → ${remotePeerId}]`, e?.message);
                    }
                } else {
                    // Drop stale offers and rebuild next cycle
                    if (Date.now() - (myOffers[remotePeerId].ts || 0) > OFFER_MAX_AGE) {
                        this._markSlaveThrash(remotePeerId);
                        delete myOffers[remotePeerId]; offDirty = true;
                        const e2 = this._pcs.get(remotePeerId);
                        if (e2) { try { e2.pc.close(); } catch {} this._pcs.delete(remotePeerId); }
                    } else {
                        // Check remote's answers cell (T{remoteBlock+2}) for an answer keyed by our peerId
                        // rows[remoteBlock + 1] = T{remoteBlock+2}
                        let remoteAnswers = {};
                        try { remoteAnswers = JSON.parse(rows[remoteBlock + 1]?.[0] || '{}'); } catch {}
                        const ans = remoteAnswers[this.peerId];
                        if (ans?.sdp && entry?.pc && entry.state === 'offering') {
                            const offerTs = myOffers[remotePeerId]?.ts || 0;
                            const ansTs = ans.ts || 0;
                            // Ignore stale answers left behind from a previous offer attempt.
                            if (ansTs > 0 && offerTs > 0 && ansTs < offerTs) {
                                continue;
                            }
                            try {
                                // Mark state immediately — prevents a second poll from
                                // calling setRemoteDescription again before the DC opens
                                entry.state = 'answer-applied';
                                await entry.pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
                                this._diag.counters.answersApplied += 1;
                                const pd = this._diagPeer(remotePeerId);
                                if (pd) pd.answerApplied += 1;
                                this._markSlaveStable(remotePeerId);
                                this._diagEvent('answer-applied', { remotePeerId });
                                console.log(`[poll] setRemoteDescription(answer) from ${remotePeerId} OK`);
                                delete myOffers[remotePeerId]; offDirty = true;
                            } catch (e) {
                                entry.state = 'offering'; // revert so we retry
                                this._markSlaveThrash(remotePeerId);
                                this._diag.counters.answerApplyFailures += 1;
                                const pd = this._diagPeer(remotePeerId);
                                if (pd) { pd.answerApplyFailures += 1; pd.lastError = e?.message || String(e); }
                                this._diagEvent('answer-apply-failed', { remotePeerId, err: e?.message || String(e) });
                                console.error(`[setRemoteDesc answer ${remotePeerId}]`, e?.message);
                            }
                        }
                    }
                }
            } else {
                // ── We are the answerer ──
                // Look in remote's offers cell (T{remoteBlock+1}) for an offer keyed by our peerId
                // rows[remoteBlock] = T{remoteBlock+1}
                let remoteOffers = {};
                try { remoteOffers = JSON.parse(rows[remoteBlock]?.[0] || '{}'); } catch {}
                const offer = remoteOffers[this.peerId];
                if (offer?.sdp && !entry) {
                    try {
                        const slaveDelay = this._slaveHandshakeDelayMs(remotePeerId, remoteBlock);
                        if (slaveDelay > 0) {
                            await new Promise(resolve => setTimeout(resolve, slaveDelay));
                        }
                        this._diag.counters.answersBuilt += 1;
                        const pd = this._diagPeer(remotePeerId);
                        if (pd) pd.answerAttempts += 1;
                        const answerSdp = await this._buildAnswer(remotePeerId, offer.sdp); // sets state='answering'
                        if (answerSdp) {
                            const pd2 = this._diagPeer(remotePeerId);
                            if (pd2) pd2.answerSuccess += 1;
                            myAnswers[remotePeerId] = { sdp: answerSdp, ts: Date.now() };
                            ansDirty = true;
                        }
                    } catch (e) {
                        this._markSlaveThrash(remotePeerId);
                        this._diag.counters.answerBuildFailures += 1;
                        const pd3 = this._diagPeer(remotePeerId);
                        if (pd3) { pd3.answerFailures += 1; pd3.lastError = e?.message || String(e); }
                        this._diagEvent('build-answer-failed', { remotePeerId, err: e?.message || String(e) });
                        console.error(`[buildAnswer ← ${remotePeerId}]`, e?.message);
                    }
                }
            }
        }

        this._nextPollDelayMs = this._computeAdaptivePollDelayMs(aliveById);

        // Flush dirty signaling cells
        if (offDirty) {
            const v = Object.keys(myOffers).length  ? JSON.stringify(myOffers)  : '';
            await this._writeCell(`Sheet1!T${this.block + 1}`, v).catch(() => {});
        }
        if (ansDirty) {
            const v = Object.keys(myAnswers).length ? JSON.stringify(myAnswers) : '';
            await this._writeCell(`Sheet1!T${this.block + 2}`, v).catch(() => {});
        }

        this._diagEvent('poll-snapshot', {
            alivePeers: aliveById.size,
            connectedPeers: this.connectedPeers().length,
            outstandingOffers: Object.keys(myOffers).length,
            outstandingAnswers: Object.keys(myAnswers).length,
        });
    }

    // ── WebRTC helpers ───────────────────────────────────────────────────────

    /**
     * Build a WebRTC offer using vanilla ICE.
     * Waits for ICE gathering to complete so the returned SDP contains all
     * candidate lines — Android's OrchestratorPeer expects a fully-complete SDP.
     */
    async _buildOffer(remotePeerId) {
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        const dc = pc.createDataChannel('waymark');
        this._pcs.set(remotePeerId, { pc, dc, connected: false, state: 'offering', startedAt: Date.now() });
        this._attachPcHandlers(pc, remotePeerId);
        this._attachDcHandlers(dc, remotePeerId);

        // Register ice handler BEFORE createOffer so no candidates are missed
        const gatherDone = this._iceGatheringPromise(pc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await gatherDone;

        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error('localDescription.sdp is null after gathering');
        return sdp;
    }

    /**
     * Accept a remote offer and build an answer using vanilla ICE.
     */
    async _buildAnswer(remotePeerId, offerSdp) {
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        this._pcs.set(remotePeerId, { pc, dc: null, connected: false, state: 'answering', startedAt: Date.now() });
        this._attachPcHandlers(pc, remotePeerId);

        pc.ondatachannel = ({ channel }) => {
            const e = this._pcs.get(remotePeerId);
            if (e) e.dc = channel;
            this._attachDcHandlers(channel, remotePeerId);
        };

        // Register ice handler BEFORE setRemoteDescription / createAnswer
        const gatherDone = this._iceGatheringPromise(pc);

        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await gatherDone;

        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error('localDescription.sdp is null after gathering');
        return sdp;
    }

    /**
     * Returns a Promise that resolves once ICE gathering is complete
     * (werift fires onicecandidate({ candidate: null }) to signal end).
     * Falls back to a hard timeout so we never hang indefinitely.
     */
    _iceGatheringPromise(pc) {
        return new Promise(resolve => {
            const t = setTimeout(resolve, ICE_GATHER_TIMEOUT);
            pc.onicecandidate = ({ candidate }) => {
                if (!candidate) { clearTimeout(t); resolve(); }
            };
        });
    }

    /**
     * Observe ICE/peer connection state and tear down broken links promptly
     * so the poll loop can rebuild without waiting for long stale timeouts.
     */
    _attachPcHandlers(pc, remotePeerId) {
        const teardown = reason => {
            const entry = this._pcs.get(remotePeerId);
            if (!entry || entry.pc !== pc) return;
            console.log(`[SheetWebRtcPeer] closing ${remotePeerId} due to ${reason}`);
            this._diag.counters.pcTeardown += 1;
            this._diag.last.lastPcTeardown = { tsMs: Date.now(), remotePeerId, reason };
            const pd = this._diagPeer(remotePeerId);
            if (pd) {
                pd.teardownCount += 1;
                pd.lastState = `teardown:${reason}`;
            }
            this._diagEvent('pc-teardown', { remotePeerId, reason });
            try { pc.close(); } catch {}
            this._pcs.delete(remotePeerId);
            this._lastPong.delete(remotePeerId);
            if (this._remotePeerId === remotePeerId) {
                this._remotePeerId = null;
                this._dc = null;
                this._connected = false;
            }
        };

        pc.oniceconnectionstatechange = () => {
            try {
                const s = pc.iceConnectionState;
                if (s === 'connected' || s === 'completed') return;
                if (s === 'failed' || s === 'closed') {
                    teardown(`ice=${s}`);
                    return;
                }
                if (s === 'disconnected') {
                    const captured = pc;
                    setTimeout(() => {
                        const entry = this._pcs.get(remotePeerId);
                        if (!entry || entry.pc !== captured) return;
                        if (captured.iceConnectionState === 'disconnected') {
                            teardown('ice=disconnected-timeout');
                        }
                    }, ICE_DISCONNECT_GRACE_MS);
                }
            } catch {}
        };

        pc.onconnectionstatechange = () => {
            try {
                const s = pc.connectionState;
                const pd = this._diagPeer(remotePeerId);
                if (pd) pd.lastState = `pc:${s}`;
                this._diagEvent('pc-state', { remotePeerId, state: s });
                if (s === 'failed' || s === 'closed') teardown(`pc=${s}`);
            } catch {}
        };
    }

    /** Wire up DataChannel event handlers. */
    _attachDcHandlers(dc, remotePeerId) {
        dc.onopen = () => {
            const entry = this._pcs.get(remotePeerId);
            if (entry) { entry.connected = true; entry.state = 'connected'; }
            // Seed pong tracking so the peer isn't immediately timed out
            this._lastPong.set(remotePeerId, Date.now());
            this._diag.counters.dcOpen += 1;
            const pd = this._diagPeer(remotePeerId);
            if (pd) { pd.dcOpen += 1; pd.lastState = 'dc:open'; }
            this._diagEvent('dc-open', { remotePeerId });
            // Single-peer backward compat
            this._remotePeerId = remotePeerId;
            this._dc  = dc;
            this._connected = true;
            console.log(`[SheetWebRtcPeer] DataChannel OPEN with ${remotePeerId}`);
            if (this._onConnect) this._onConnect(remotePeerId);
        };
        dc.onmessage = m => {
            try {
                const data = JSON.parse(m.data.toString());
                // Respond to Android's keepalive pings
                if (data.type === 'waymark-ping') {
                    try { dc.send(JSON.stringify({ type: 'waymark-pong', ts: Date.now() })); } catch {}
                    return;
                }
                if (data.type === 'waymark-pong') {
                    this._lastPong.set(remotePeerId, Date.now());
                    this._diag.counters.pongReceived += 1;
                    const pd = this._diagPeer(remotePeerId);
                    if (pd) { pd.pongReceived += 1; pd.lastState = 'dc:pong'; }
                    return;
                }
                if (this._onMessage) this._onMessage(remotePeerId, data);
            } catch {}
        };
        dc.onclose = () => {
            console.log(`[SheetWebRtcPeer] DataChannel CLOSED with ${remotePeerId} — will reconnect on next poll`);
            const entry = this._pcs.get(remotePeerId);
            if (entry) entry.connected = false;
            this._diag.counters.dcClose += 1;
            const pd = this._diagPeer(remotePeerId);
            if (pd) { pd.dcClose += 1; pd.lastState = 'dc:closed'; }
            this._diagEvent('dc-close', { remotePeerId });
            // Update backward-compat refs
            if (this._remotePeerId === remotePeerId) {
                this._connected = false;
                this._dc = null;
            }
        };
    }

    /**
     * Send pings on all open DataChannels and close any peer that hasn't
     * responded within DC_PONG_TIMEOUT_MS.  The poll loop re-establishes
     * the connection on the next cycle after _pcs is cleared here.
     */
    _pingAndPrune() {
        const now  = Date.now();
        const ping = JSON.stringify({ type: 'waymark-ping', ts: now });
        for (const [remotePeerId, entry] of this._pcs) {
            if (!entry.dc || entry.dc.readyState !== 'open') continue;
            try {
                entry.dc.send(ping);
                this._diag.counters.pingSent += 1;
                const pd = this._diagPeer(remotePeerId);
                if (pd) { pd.pingSent += 1; pd.lastState = 'dc:ping'; }
            } catch {}
            const last = this._lastPong.get(remotePeerId) ?? now;
            if (now - last > DC_PONG_TIMEOUT_MS) {
                console.log(`[SheetWebRtcPeer] pong timeout for ${remotePeerId} (${Math.round((now - last) / 1000)}s) — closing`);
                this._diag.counters.pongTimeoutCloses += 1;
                this._diagEvent('pong-timeout-close', { remotePeerId, ageMs: now - last });
                try { entry.pc.close(); } catch {}
                this._pcs.delete(remotePeerId);
                this._lastPong.delete(remotePeerId);
                if (this._remotePeerId === remotePeerId) { this._connected = false; this._dc = null; }
            }
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Return the list of currently connected remote peer IDs. */
    connectedPeers() {
        return [...this._pcs.entries()]
            .filter(([, e]) => e.connected)
            .map(([id]) => id);
    }

    /** Send a notification to one connected remote peer. */
    sendToPeer(remotePeerId, { title, body } = {}) {
        this._diag.counters.targetedCalls += 1;
        if (!remotePeerId) return false;
        const entry = this._pcs.get(remotePeerId);
        if (!entry?.dc || entry.dc.readyState !== 'open') return false;
        const json = JSON.stringify({
            type:  'orchestrator-alert',
            title: title || 'Waymark',
            body:  body  || '',
            ts:    Date.now(),
        });
        try {
            entry.dc.send(json);
            this._diag.counters.targetedDelivered += 1;
            this._diagEvent('targeted-send', { remotePeerId, ok: true });
            return true;
        } catch {
            this._diagEvent('targeted-send', { remotePeerId, ok: false });
            return false;
        }
    }

    /**
     * Broadcast a notification to all connected remote peers.
     * @param {object} opts  { title, body } — field names match Android handleMessage()
     */
    broadcast({ title, body } = {}) {
        this._diag.counters.broadcastCalls += 1;
        const json = JSON.stringify({
            type:  'orchestrator-alert',
            title: title || 'Waymark',
            body:  body  || '',
            ts:    Date.now(),
        });
        let sent = 0;
        for (const [, entry] of this._pcs) {
            try {
                if (entry.dc && entry.dc.readyState === 'open') {
                    entry.dc.send(json);
                    sent++;
                }
            } catch {}
        }
        this._diag.counters.broadcastDelivered += sent;
        this._diagEvent('broadcast-send', { sent });
        if (sent > 0) return sent;
        // Fallback: persist into notification slot (block+3)
        if (this.block > 0) {
            this._writeCell(`Sheet1!T${this.block + 3}`, json).catch(() => {});
        }
        return 0;
    }

    async sendKeyExchangeTo(remotePeerId, key) {
        const payload = JSON.stringify({ type: 'key-exchange', key, ts: Date.now() });
        const entry = this._pcs.get(remotePeerId);
        try {
            if (entry?.dc && entry.dc.readyState === 'open') {
                entry.dc.send(payload);
                return true;
            }
        } catch {}
        if (this.block > 0) {
            await this._writeCell(`Sheet1!T${this.block + 3}`, payload).catch(() => {});
            return true;
        }
        return false;
    }

    stop() {
        this.destroyed = true;
        this._diagEvent('peer-stop');
        clearInterval(this._heartbeatTimer);
        clearTimeout(this._pollTimer);
        clearInterval(this._pingTimer);
        for (const [, { pc }] of this._pcs) {
            try { pc.close(); } catch {}
        }
        this._pcs.clear();
        this._lastPong.clear();
        this._remoteNonces.clear();
        this._slaveThrashScore.clear();
    }

    _shouldInitiateHandshake(remotePeerId, remoteBlock) {
        if (this.block > remoteBlock) return true;
        if (this.block < remoteBlock) return false;
        return this.peerId < remotePeerId;
    }

    _markSlaveThrash(remotePeerId) {
        const cur = this._slaveThrashScore.get(remotePeerId) || 0;
        this._slaveThrashScore.set(remotePeerId, Math.min(10, cur + 1));
    }

    _markSlaveStable(remotePeerId) {
        const cur = this._slaveThrashScore.get(remotePeerId) || 0;
        this._slaveThrashScore.set(remotePeerId, Math.max(0, cur - 2));
    }

    _slaveHandshakeDelayMs(remotePeerId, remoteBlock) {
        if (this.block >= remoteBlock) return 0;
        const rowGap = Math.max(1, Math.floor((remoteBlock - this.block) / BLOCK_SIZE));
        const score = this._slaveThrashScore.get(remotePeerId) || 0;
        const base = 120 * rowGap;
        const adaptive = Math.min(1800, score * 150);
        const jitter = this._peerIdJitter() % 120;
        return Math.min(MAX_SLAVE_HANDSHAKE_DELAY_MS, base + adaptive + jitter);
    }

    _computeAdaptivePollDelayMs(aliveById) {
        let highestRemoteBlock = -1;
        for (const info of aliveById.values()) {
            if (info.block > highestRemoteBlock) highestRemoteBlock = info.block;
        }
        if (highestRemoteBlock <= this.block) return POLL_MS;
        let worstScore = 0;
        for (const score of this._slaveThrashScore.values()) {
            if (score > worstScore) worstScore = score;
        }
        return Math.min(POLL_MS + MAX_SLAVE_POLL_OFFSET_MS, POLL_MS + 150 + worstScore * 120);
    }

    _peerIdJitter() {
        let hash = 0;
        for (const ch of this.peerId) {
            hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
        }
        return hash % 200;
    }

    /**
     * Imperatively initiate an offer to a remote peer (called via REST /offer).
     * Writes the offer to OWN offers cell keyed by remotePeerId — matching the
     * OrchestratorPeer.kt convention so the Android side will find it.
     */
    async initiateOffer(remotePeerId) {
        if (!remotePeerId) throw new Error('remotePeerId required');
        const range = `Sheet1!T1:T${TOTAL_ROWS + 1}`;
        const data  = await this._readRange(range);
        const rows  = data.values || [];

        // Verify the target is alive
        let targetFound = false;
        for (let i = 0; i < MAX_SLOTS; i++) {
            const slotRow = BLOCK_START + i * BLOCK_SIZE;
            const cell    = rows[slotRow - 1]?.[0];
            if (!cell) continue;
            try {
                const obj = JSON.parse(cell);
                if (obj.peerId === remotePeerId) { targetFound = true; break; }
            } catch {}
        }
        if (!targetFound) throw new Error('target peer not found on sheet');

        // Build offer (vanilla ICE)
        const sdp = await this._buildOffer(remotePeerId);
        if (!sdp) throw new Error('failed to build offer SDP');

        // Write to OWN offers cell (T{block+1}), keyed by remotePeerId
        let myOffers = {};
        try { myOffers = JSON.parse(rows[this.block]?.[0] || '{}'); } catch {}
        myOffers[remotePeerId] = { sdp, ts: Date.now() };
        await this._writeCell(`Sheet1!T${this.block + 1}`, JSON.stringify(myOffers));

        return { ok: true };
    }
}
