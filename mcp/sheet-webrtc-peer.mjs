/* ============================================================
   sheet-webrtc-peer.mjs — Node.js WebRTC peer using Google Sheets signaling

   Replicates the row-based signaling protocol from OrchestratorPeer.kt and
   webrtc.js.  Uses a Google service account (via google-auth-library) to
   read/write the signaling column (column T) of a designated Google Sheet,
   and werift for the actual WebRTC peer connections.

   Once connected to Android peers, broadcast() sends DataChannel messages
   that trigger Android notifications in the existing OrchestratorPeer handler.

   Block layout in column T (0-based row index, BLOCK_START = 1):
     block + 0  PRESENCE  { peerId, name, ts }
     block + 1  OFFERS    { targetPeerId: { sdp, ts }, ... }
     block + 2  ANSWERS   { toPeerId: { sdp, ts }, ... }

   All cell values are AES-256-GCM encrypted when an encryptionKey is
   provided.  The format is compatible with SignalingEncryption.kt on Android:
     ENCRYPT_PREFIX + Base64( iv[12] + ciphertext + authTag[16] )

   Signaling column: T (index 19, 1-based 20) — to match the Android + web app.
   ============================================================ */

import { RTCPeerConnection } from "werift";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* ---------- Cell encryption helpers (mirrors SignalingEncryption.kt) ---------- */

/** Prefix identifying an encrypted signaling cell. Matches Android ENCRYPT_PREFIX. */
const ENCRYPT_PREFIX = "\uD83D\uDD10SIG:";

/**
 * Encrypt a signaling cell value with AES-256-GCM.
 *
 * @param {string} plaintext  - JSON string to encrypt
 * @param {string} keyHex     - 64-char hex AES-256 key
 * @returns {string}           ENCRYPT_PREFIX + Base64(iv[12] + ciphertext + authTag[16])
 */
function encryptCell(plaintext, keyHex) {
    const key = Buffer.from(keyHex, "hex");
    const iv  = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();                    // 16 bytes
    const combined = Buffer.concat([iv, encrypted, tag]);
    return ENCRYPT_PREFIX + combined.toString("base64");
}

/**
 * Decrypt a signaling cell value encrypted by [encryptCell] or
 * SignalingEncryption.kt#encrypt().
 *
 * Cells that do not start with ENCRYPT_PREFIX are returned unchanged
 * (backward compatibility with any unencrypted rows).
 *
 * @param {string|null} encoded  - Cell value from the sheet
 * @param {string}      keyHex   - 64-char hex AES-256 key
 * @returns {string|null} Decrypted plaintext, original value if not encrypted,
 *                         or null if decryption fails (wrong key / corrupt data)
 */
function decryptCell(encoded, keyHex) {
    if (!encoded) return encoded;
    if (!encoded.startsWith(ENCRYPT_PREFIX)) return encoded;  // plaintext passthrough
    try {
        const key     = Buffer.from(keyHex, "hex");
        const combined = Buffer.from(encoded.slice(ENCRYPT_PREFIX.length), "base64");
        const iv      = combined.subarray(0, 12);
        const tag     = combined.subarray(combined.length - 16);
        const data    = combined.subarray(12, combined.length - 16);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
        return null;  // Wrong key or corrupted ciphertext
    }
}

/* ---------- Protocol constants (mirrors WaymarkConfig.kt) ---------- */

const BLOCK_SIZE  = 5;
const BLOCK_START = 1;
const MAX_SLOTS   = 8;
const OFF_PRESENCE = 0;
const OFF_OFFERS   = 1;
const OFF_ANSWERS  = 2;
const ALIVE_TTL      = 50_000;   // ms — matches Android ALIVE_TTL
const POLL_MS        = 5_000;    // ms — matches Android POLL_MS
const HEART_MS       = 15_000;   // ms — matches Android HEART_MS
const OFFER_MAX_AGE           = 3 * 60_000; // ms — stale offer: rebuild if unanswered for 3 min
const HANDSHAKE_TIMEOUT_MS    = 90_000;      // ms — evict entry if DC never opened within this window
const ICE_DISCONNECT_GRACE_MS = 30_000;      // ms — wait before closing on ICE DISCONNECTED (give path changes time to recover)
const NOTIF_BUFFER_TTL        = 5 * 60_000; // ms — max age of a buffered notification
const NOTIF_BUFFER_MAX        = 100;         // max buffered entries
const DC_PING_MS              = 30_000;      // ms — interval between DataChannel keepalive pings
const DC_PONG_TIMEOUT_MS      = 90_000;      // ms — close peer if no pong received for this long

const TOTAL_ROWS = MAX_SLOTS * BLOCK_SIZE + BLOCK_START;
const SIG_RANGE  = `Sheet1!T1:T${TOTAL_ROWS + 1}`;

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const STUN_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
];

/* ---------- SheetWebRtcPeer ---------- */

/**
 * Participates in a Waymark WebRTC peer mesh using Google Sheets for signaling.
 *
 * @param {object} opts
 * @param {string}              opts.sheetId       - Google Sheets spreadsheet ID (public signaling sheet)
 * @param {import('google-auth-library').GoogleAuth} opts.auth - Authenticated GoogleAuth
 * @param {string}              opts.peerId        - 8-char hex peer ID for this instance
 * @param {string}              opts.displayName   - Human-readable name shown in peer lists
 * @param {function}            [opts.getToken]    - () => Promise<string> — preferred over auth when provided
 * @param {string}              [opts.encryptionKey] - 64-char hex AES-256 key from the private key sheet
 * @param {Array}               [opts.iceServers]   - RTCIceServer array; include TURN entries here for
 *                                                   hard-NAT / symmetric-NAT fallback. Defaults to
 *                                                   Google STUN only.
 * @param {function}            [opts.onMessage]   - (remotePeerId, message) callback
 * @param {function}            [opts.onConnect]   - (remotePeerId) called on DataChannel open
 * @param {string}              [opts.bufferFile]  - Optional path to persist the notification queue across restarts
 */
export class SheetWebRtcPeer {
    constructor({ sheetId, auth, getToken, peerId, displayName, encryptionKey, getEncryptionKey, iceServers, onMessage, onConnect, bufferFile }) {
        this.sheetId       = sheetId;
        this.auth          = auth;
        this._getTokenFn   = getToken || null;
        this.peerId        = peerId;
        this.displayName   = displayName;
        // getEncryptionKey() is called on every read/write so the key can be rotated live.
        // Fall back to the static encryptionKey string for backwards compatibility.
        this._getKeyFn     = getEncryptionKey || (encryptionKey ? () => encryptionKey : null);
        this._encKey       = encryptionKey || null;  // kept for read-only callers that inspect it directly
        this._iceServers   = iceServers || STUN_SERVERS;  // pass TURN entries here for hard-NAT fallback
        this.onMessage     = onMessage;
        this.onConnect     = onConnect;
        this._bufferFile   = bufferFile || null;

        /** @type {Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel|null, state: string }>} */
        this.peers = new Map();

        /** @type {Array<{ json: string, ts: number, deliveredTo: Set<string> }>} */
        this._notifQueue = [];

        this.block     = -1;
        this.destroyed = false;
        this._polling        = false;  // guard: prevent concurrent poll cycles
        this._heartbeatTimer = null;
        this._pollTimer      = null;
        this._pingTimer      = null;   // DataChannel keepalive interval
        this._lastPong       = new Map(); // remotePeerId → epoch-ms of last pong received
        this._peerNonces     = new Map(); // remotePeerId → last observed presence nonce

        // Load persisted buffer after all fields are initialized (survives process restarts)
        if (this._bufferFile) {
            try {
                const saved = JSON.parse(readFileSync(this._bufferFile, "utf8"));
                const now = Date.now();
                this._notifQueue = saved
                    .filter(n => now - n.ts < NOTIF_BUFFER_TTL)
                    .map(n => ({ ...n, deliveredTo: new Set(n.deliveredTo || []) }));
                this._log(`loaded ${this._notifQueue.length} buffered notification(s) from ${this._bufferFile}`);
            } catch { /* start fresh */ }
        }
    }

    /* ---------- Lifecycle ---------- */

    async start() {
        await this._join();
        if (this.block < 0) {
            this._log("no free signaling slot — mesh full, not joining");
            return;
        }
        this._log(`joined mesh block=${this.block}`);

        // Immediate first heartbeat then on interval
        await this._heartbeat().catch(e => this._log(`heartbeat error: ${e.message}`));
        this._heartbeatTimer = setInterval(() => {
            this._heartbeat().catch(e => this._log(`heartbeat error: ${e.message}`));
        }, HEART_MS);

        // Poll loop
        this._pollTimer = setInterval(() => {
            this._poll().catch(e => this._log(`poll error: ${e.message}`));
        }, POLL_MS);

        // DataChannel keepalive — detect dead Android connections within DC_PONG_TIMEOUT_MS
        this._pingTimer = setInterval(() => this._pingAndPrune(), DC_PING_MS);
    }

    stop() {
        this.destroyed = true;
        clearInterval(this._heartbeatTimer);
        clearInterval(this._pollTimer);
        clearInterval(this._pingTimer);
        this._lastPong.clear();
        this._peerNonces.clear();
        if (this.block >= 0) {
            this._clearPresence().catch(() => {});
        }
        for (const id of [...this.peers.keys()]) {
            this._closeOne(id);
        }
    }

    /**
     * Send a message to all connected peers via DataChannel.
     * If the message is a waymark-notification or orchestrator-alert, it is also
     * buffered so peers that are not yet connected (or reconnect later) receive it.
     * @param {object|string} message
     * @returns {number} count of peers the message was sent to immediately
     */
    broadcast(message) {
        const json = typeof message === "string" ? message : JSON.stringify(message);
        const isNotif = typeof message === "object" && message !== null &&
            (message.type === "waymark-notification" || message.type === "orchestrator-alert");
        const deliveredTo = new Set();
        let sent = 0;
        for (const [id, entry] of this.peers) {
            try {
                if (entry.dc && entry.dc.readyState === "open") {
                    entry.dc.send(json);
                    deliveredTo.add(id);
                    sent++;
                }
            } catch (e) {
                this._log(`broadcast to ${id} failed: ${e.message}`);
            }
        }
        if (isNotif) this._enqueueNotif(json, deliveredTo);
        return sent;
    }

    /* ---------- Notification buffer ---------- */

    /**
     * Add a notification to the buffer with the set of peers already delivered.
     * @param {string} json  - Serialised notification
     * @param {Set<string>} deliveredTo - Peers that received it on this broadcast
     */
    _enqueueNotif(json, deliveredTo) {
        const now = Date.now();
        // Evict expired + enforce cap before pushing
        this._notifQueue = this._notifQueue
            .filter(n => now - n.ts < NOTIF_BUFFER_TTL)
            .slice(-(NOTIF_BUFFER_MAX - 1));
        this._notifQueue.push({ json, ts: now, deliveredTo: new Set(deliveredTo) });
        this._persistBuffer();
    }

    /**
     * Flush queued notifications to a newly-opened DataChannel.
     * Items are only sent if the remotePeerId has not yet received them.
     * @param {string} remotePeerId
     * @param {RTCDataChannel} dc
     */
    _flushNotifQueue(remotePeerId, dc) {
        if (!this._notifQueue.length) return;
        const now = Date.now();
        let flushed = 0;
        for (const item of this._notifQueue) {
            if (now - item.ts >= NOTIF_BUFFER_TTL) continue;
            if (item.deliveredTo.has(remotePeerId)) continue;
            try {
                dc.send(item.json);
                item.deliveredTo.add(remotePeerId);
                flushed++;
            } catch (e) {
                this._log(`flush to ${remotePeerId} failed: ${e.message}`);
            }
        }
        if (flushed) {
            this._log(`flushed ${flushed} buffered notification(s) to ${remotePeerId}`);
            this._persistBuffer();
        }
    }

    /** Persist the current queue to disk (no-op if bufferFile not set).
     *  Uses a write-to-temp + rename pattern so a crash mid-write never corrupts
     *  the buffer — the rename is atomic on POSIX filesystems.
     */
    _persistBuffer() {
        if (!this._bufferFile) return;
        try {
            const toSave = this._notifQueue.map(n => ({
                json:        n.json,
                ts:          n.ts,
                deliveredTo: [...n.deliveredTo],
            }));
            const tmp = `${this._bufferFile}.tmp`;
            writeFileSync(tmp, JSON.stringify(toSave));
            renameSync(tmp, this._bufferFile);
        } catch (e) {
            this._log(`buffer persist failed: ${e.message}`);
        }
    }

    connectedPeers() {
        return [...this.peers.entries()]
            .filter(([, e]) => e.state === "connected")
            .map(([id]) => id);
    }

    /* ---------- Sheets helpers ---------- */

    async _getToken() {
        if (this._getTokenFn) return this._getTokenFn();
        const client = await this.auth.getClient();
        const { token } = await client.getAccessToken();
        return token;
    }

    async _readAll() {
        const token = await this._getToken();
        const res = await fetch(`${SHEETS_BASE}/${this.sheetId}/values/${SIG_RANGE}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Sheets read ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const rows = data.values || [];

        // Pad to TOTAL_ROWS so callers can index by 0-based row safely
        const result = new Array(TOTAL_ROWS + 2).fill(null);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row && row.length > 0 && row[0] !== "") {
                const raw = row[0];
                // Decrypt cell if a key is available; passthrough if no key or no prefix
                const key = this._getKeyFn ? this._getKeyFn() : null;
                result[i + BLOCK_START] = key ? (decryptCell(raw, key) ?? raw) : raw;
            }
        }
        return result;
    }

    async _writeCell(rowIdx, value) {
        const token = await this._getToken();
        const sheetsRow = rowIdx; // already 1-based (BLOCK_START=1)
        const range = `Sheet1!T${sheetsRow}`;
        // Encrypt non-empty values when a key is available
        const key = this._getKeyFn ? this._getKeyFn() : null;
        const cellValue = (value && key) ? encryptCell(value, key) : (value ?? "");
        const body = JSON.stringify({
            range,
            majorDimension: "ROWS",
            values: [[cellValue]],
        });
        const res = await fetch(
            `${SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body,
            }
        );
        if (!res.ok) throw new Error(`Sheets write ${res.status}: ${await res.text()}`);
    }

    _parseJson(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch { return null; }
    }

    /* ---------- Signaling: join ---------- */

    async _join() {
        const vals = await this._readAll();
        this.block = this._findSlot(vals);
        if (this.block < 0) return;

        // Write presence immediately to claim slot
        await this._heartbeat();

        // Collision guard — stagger by a jitter derived from peerId tail (mirrors Android)
        const jitter = parseInt(this.peerId.slice(-2), 16) % 200;
        await new Promise(r => setTimeout(r, 300 + jitter));
        if (this.destroyed) return;

        const recheck = await this._readAll();
        const claimed = this._parseJson(recheck[this.block]);
        if (!claimed || claimed.peerId !== this.peerId) {
            this._log(`slot ${this.block} collision — re-finding slot`);
            this.block = this._findSlot(recheck);
            if (this.block < 0) return;
            await this._heartbeat();
        }
    }

    _findSlot(vals) {
        for (let slot = 0; slot < MAX_SLOTS; slot++) {
            const row = BLOCK_START + slot * BLOCK_SIZE;
            const presence = this._parseJson(vals[row]);
            if (!presence) return row;
            const age = Date.now() - (presence.ts || 0);
            if (age > ALIVE_TTL) return row;
        }
        return -1;
    }

    /* ---------- Heartbeat ---------- */

    async _heartbeat() {
        if (this.destroyed || this.block < 0) return;
        await this._writeCell(this.block + OFF_PRESENCE, JSON.stringify({
            peerId: this.peerId,
            name:   this.displayName,
            ts:     Date.now(),
        }));
    }

    async _clearPresence() {
        if (this.block < 0) return;
        await this._writeCell(this.block + OFF_PRESENCE, "");
    }

    /* ---------- Poll cycle ---------- */

    async _poll() {
        if (this.destroyed || this.block < 0 || this._polling) return;
        this._polling = true;
        try {
            const vals  = await this._readAll();
            const alive = this._scanAlive(vals);
            const aliveIds = new Set(alive.map(p => p.peerId));
            const buildJobs = []; // { type: 'offer'|'answer', remoteId, offerSdp? }

            // Evict entries still in 'connecting' state after HANDSHAKE_TIMEOUT_MS.
            // Only applies while state === 'connecting' — once a DC successfully opens
            // (state → 'connected') this guard is inactive, preventing a closed-and-
            // being-rebuilt connection from being incorrectly evicted based on its
            // original createdAt.
            const now = Date.now();
            for (const [id, entry] of this.peers) {
                if (entry.state === "connecting" && (now - (entry.createdAt || 0)) > HANDSHAKE_TIMEOUT_MS) {
                    this._log(`stuck handshake for ${id} (${Math.round((now - (entry.createdAt || 0)) / 1000)}s) — evicting`);
                    this._closeOne(id);
                }
            }

            // Remove dead peers
            for (const [id, { pc }] of this.peers) {
                if (!aliveIds.has(id)) {
                    this._closeOne(id);
                }
            }

            let myOffers  = this._parseJson(vals[this.block + OFF_OFFERS])  || {};
            let myAnswers = this._parseJson(vals[this.block + OFF_ANSWERS]) || {};
            let offDirty = false;
            let ansDirty = false;

            // Clean stale entries for dead peers
            for (const k of Object.keys(myOffers))  { if (!aliveIds.has(k)) { delete myOffers[k];  offDirty = true; } }
            for (const k of Object.keys(myAnswers)) { if (!aliveIds.has(k)) { delete myAnswers[k]; ansDirty = true; } }

            for (const remote of alive) {
                const remoteId    = remote.peerId;
                const remoteBlock = remote.block;
                if (remoteId === this.peerId || remoteBlock < 0) continue;

                // Detect a remote peer restart via nonce change — a changed nonce means
                // the remote crashed and rejoined without cleanly leaving the mesh.
                // Close the stale DataChannel now so the loop below rebuilds immediately.
                const remoteNonce = remote.nonce || "";
                if (remoteNonce) {
                    const knownNonce = this._peerNonces.get(remoteId);
                    if (knownNonce && knownNonce !== remoteNonce && this.peers.has(remoteId)) {
                        this._log(`peer ${remoteId} restarted (nonce changed) — closing stale connection for rebuild`);
                        if (myOffers[remoteId]) { delete myOffers[remoteId]; offDirty = true; }
                        if (myAnswers[remoteId]) { delete myAnswers[remoteId]; ansDirty = true; }
                        this._closeOne(remoteId);
                    }
                    this._peerNonces.set(remoteId, remoteNonce);
                }

                const entry  = this.peers.get(remoteId);

                // Clean up failed or closed ICE connections — will rebuild next cycle
                if (entry?.pc && (
                    entry.pc.iceConnectionState === "failed" ||
                    entry.pc.iceConnectionState === "closed"
                )) {
                    this._log(`ICE ${entry.pc.iceConnectionState} for ${remoteId} — resetting`);
                    this._closeOne(remoteId);
                    continue;
                }

                // If the DataChannel closed on us (remote disconnected) but the entry
                // survived, force cleanup so next poll cycle rebuilds the connection.
                if (entry?.dc && (entry.dc.readyState === "closed" || entry.dc.readyState === "closing")) {
                    this._log(`DC closed for ${remoteId} — resetting for rebuild`);
                    this._closeOne(remoteId);
                    continue;
                }

                // Already connected — clean up stale signal entries and skip renegotiation
                if (entry?.dc?.readyState === "open") {
                    if (myOffers[remoteId])  { delete myOffers[remoteId];  offDirty = true; }
                    if (myAnswers[remoteId]) { delete myAnswers[remoteId]; ansDirty = true; }
                    continue;
                }

                const weInit = this.peerId < remoteId; // lexicographic — matches Android logic

                if (weInit) {
                    // === INITIATOR: create offer, wait for answer ===
                    const existingOffer = myOffers[remoteId];
                    const offerStale = existingOffer && (Date.now() - (existingOffer.ts || 0) > OFFER_MAX_AGE);

                    if (!entry || offerStale) {
                        if (offerStale) {
                            this._log(`stale offer for ${remoteId} (age ${Math.round((Date.now() - existingOffer.ts) / 1000)}s) — rebuilding`);
                            this._closeOne(remoteId);
                        }
                        buildJobs.push({ type: "offer", remoteId });
                    } else if (entry.state !== "connected") {
                        // Look for answer from remote
                        const remoteAnswers = this._parseJson(vals[remoteBlock + OFF_ANSWERS]) || {};
                        const ans = remoteAnswers[this.peerId];
                        // Guard: only apply answer when in the correct offer state.
                        // Repeated poll cycles see the same answer; skip if already applied.
                        if (ans && entry.pc.signalingState === "have-local-offer") {
                            try {
                                await entry.pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
                                // state will become "connected" when dc.onopen fires
                                delete myOffers[remoteId];
                                offDirty = true;
                            } catch (e) {
                                this._log(`setRemoteDescription(answer) failed for ${remoteId}: ${e.message}`);
                                this._closeOne(remoteId);
                            }
                        }
                    }
                } else {
                    // === ANSWERER: look for offer in remote's OFFERS row ===
                    if (!entry) {
                        const remoteOffers = this._parseJson(vals[remoteBlock + OFF_OFFERS]) || {};
                        const offer = remoteOffers[this.peerId];
                        if (offer) {
                            buildJobs.push({ type: "answer", remoteId, offerSdp: offer.sdp });
                        }
                    }
                }
            }

            // Run all ICE-gathering builds in parallel — avoids serialising each peer's
            // ICE gathering phase (1-12 s each) when multiple peers need renegotiation.
            if (buildJobs.length) {
                const results = await Promise.allSettled(
                    buildJobs.map(job => job.type === "offer"
                        ? this._gatherOffer(job.remoteId)
                        : this._gatherAnswer(job.remoteId, job.offerSdp)
                    )
                );
                for (let i = 0; i < results.length; i++) {
                    const r   = results[i];
                    const job = buildJobs[i];
                    if (r.status === "fulfilled" && r.value) {
                        if (job.type === "offer") {
                            myOffers[job.remoteId] = r.value;
                            offDirty = true;
                        } else {
                            myAnswers[job.remoteId] = r.value;
                            ansDirty = true;
                        }
                    } else if (r.status === "rejected") {
                        this._log(`${job.type} build for ${job.remoteId} failed: ${r.reason?.message ?? "unknown"}`);
                    }
                }
            }

            if (offDirty) await this._writeOffers(myOffers);
            if (ansDirty) await this._writeAnswers(myAnswers);
        } catch (err) {
            this._log(`_poll error: ${err.message}`);
        } finally {
            this._polling = false;
        }
    }

    _scanAlive(vals) {
        const alive = [];
        for (let slot = 0; slot < MAX_SLOTS; slot++) {
            const row = BLOCK_START + slot * BLOCK_SIZE;
            const p = this._parseJson(vals[row]);
            if (!p || !p.peerId) continue;
            if (Date.now() - (p.ts || 0) > ALIVE_TTL) continue;
            alive.push({ ...p, block: row });
        }
        return alive;
    }

    /** Close and remove a single peer entry (mirrors browser webrtc.js _closeOne). */
    _closeOne(remoteId) {
        const entry = this.peers.get(remoteId);
        if (!entry) return;
        try { entry.dc?.close(); }  catch {}
        try { entry.pc?.close(); }  catch {}
        this.peers.delete(remoteId);
        this._lastPong.delete(remoteId);
    }

    /**
     * Send a ping on every open DataChannel and evict peers that have not ponged
     * within DC_PONG_TIMEOUT_MS.  Mirrors OrchestratorPeer.pingAndPrune() on Android.
     */
    _pingAndPrune() {
        if (this.destroyed) return;
        const now = Date.now();
        const ping = JSON.stringify({ type: "waymark-ping", ts: now });
        for (const [id, entry] of this.peers) {
            if (!entry.dc || entry.dc.readyState !== "open") continue;
            try { entry.dc.send(ping); } catch (e) {
                this._log(`ping to ${id} failed: ${e.message}`);
            }
            const last = this._lastPong.get(id) ?? (entry.createdAt || now);
            if (now - last > DC_PONG_TIMEOUT_MS) {
                this._log(`pong timeout for ${id} (${Math.round((now - last) / 1000)}s) — closing for rebuild`);
                this._closeOne(id);
            }
        }
    }

    /* ---------- Offer / Answer builders ---------- */

    /** Gather ICE for an offer and return { sdp, ts } without writing to the sheet. */
    async _gatherOffer(remotePeerId) {
        const pc = new RTCPeerConnection({ iceServers: this._iceServers });
        const dc = pc.createDataChannel("waymark");
        this.peers.set(remotePeerId, { pc, dc, state: "connecting", createdAt: Date.now() });
        this._monitorIce(pc, remotePeerId);
        this._attachDataChannel(dc, remotePeerId);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this._waitForIceGathering(pc);

        return { sdp: pc.localDescription.sdp, ts: Date.now() };
    }

    /** Gather ICE for an answer and return { sdp, ts } without writing to the sheet. */
    async _gatherAnswer(remotePeerId, offerSdp) {
        const pc = new RTCPeerConnection({ iceServers: this._iceServers });
        this.peers.set(remotePeerId, { pc, dc: null, state: "connecting", createdAt: Date.now() });
        this._monitorIce(pc, remotePeerId);

        pc.ondatachannel = (event) => {
            const dc = event.channel;
            const entry = this.peers.get(remotePeerId);
            if (entry) entry.dc = dc;
            this._attachDataChannel(dc, remotePeerId);
        };

        await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this._waitForIceGathering(pc);

        return { sdp: pc.localDescription.sdp, ts: Date.now() };
    }

    /**
     * Listen for ICE connection state changes on a peer connection.
     * Gives ICE ICE_DISCONNECT_GRACE_MS to self-heal before tearing down.
     * Immediate close on FAILED/CLOSED so next poll rebuilds quickly.
     */
    _monitorIce(pc, remotePeerId) {
        let disconnectTimer = null;
        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            this._log(`ICE ${remotePeerId} → ${state}`);
            if (state === "disconnected") {
                // Give ICE a grace window to self-heal (path change, NAT rebind, WiFi blip)
                disconnectTimer = setTimeout(() => {
                    if (this.destroyed) return;
                    const entry = this.peers.get(remotePeerId);
                    if (entry?.pc === pc) {
                        this._log(`ICE ${remotePeerId} still disconnected after ${ICE_DISCONNECT_GRACE_MS / 1000}s — closing for rebuild`);
                        this._closeOne(remotePeerId);
                    }
                }, ICE_DISCONNECT_GRACE_MS);
            } else if (state === "connected" || state === "completed") {
                clearTimeout(disconnectTimer);
                disconnectTimer = null;
            } else if (state === "failed" || state === "closed") {
                clearTimeout(disconnectTimer);
                if (!this.destroyed) {
                    const entry = this.peers.get(remotePeerId);
                    if (entry?.pc === pc) this._closeOne(remotePeerId);
                }
            }
        };
    }

    /** Resolves when ICE gathering is complete or times out. */
    _waitForIceGathering(pc, timeoutMs = 12_000) {
        if (pc.iceGatheringState === "complete") return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(resolve, timeoutMs);
            const check = () => {
                if (pc.iceGatheringState === "complete") {
                    clearTimeout(timer);
                    resolve();
                }
            };
            pc.onicegatheringstatechange = check;
            // Also poll in case the event already fired
            const interval = setInterval(() => {
                check();
                if (pc.iceGatheringState === "complete") clearInterval(interval);
            }, 200);
            setTimeout(() => clearInterval(interval), timeoutMs);
        });
    }

    _attachDataChannel(dc, remotePeerId) {
        dc.onopen = () => {
            const entry = this.peers.get(remotePeerId);
            if (entry) entry.state = "connected";
            this._lastPong.set(remotePeerId, Date.now()); // seed keepalive clock
            this._log(`DataChannel open with ${remotePeerId}`);
            this._flushNotifQueue(remotePeerId, dc);
            if (this.onConnect) this.onConnect(remotePeerId);
        };
        dc.onclose = () => {
            this._log(`DataChannel closed with ${remotePeerId}`);
            // Clean up immediately so next _poll() cycle rebuilds the connection
            this._closeOne(remotePeerId);
        };
        dc.onmessage = (event) => {
            try {
                const raw = typeof event === "string" ? event : event.data;
                const msg = JSON.parse(raw);
                // Keep-alive: Android pings every 30 s (DC_PING_MS) and evicts peers
                // that haven't ponged within 90 s (DC_PONG_TIMEOUT_MS).  Reply here
                // so the connection is never torn down due to a missing pong.
                if (msg.type === "waymark-ping") {
                    try { dc.send(JSON.stringify({ type: "waymark-pong", ts: Date.now() })); } catch {}
                    return; // don't forward to orchestrator
                }
                if (msg.type === "waymark-pong") {
                    this._lastPong.set(remotePeerId, Date.now()); // update keepalive clock
                    return;
                }
                if (this.onMessage) this.onMessage(remotePeerId, msg);
            } catch {}
        };
    }

    async _writeOffers(offers) {
        const v = Object.keys(offers).length ? JSON.stringify(offers) : '';
        await this._writeCell(this.block + OFF_OFFERS, v);
    }

    async _writeAnswers(answers) {
        const v = Object.keys(answers).length ? JSON.stringify(answers) : '';
        await this._writeCell(this.block + OFF_ANSWERS, v);
    }

    _log(msg) {
        process.stderr.write(`sheet-peer [${this.peerId}]: ${msg}\n`);
    }
}

/* ---------- Module-level exports for testing ---------- */
export { encryptCell, decryptCell, ENCRYPT_PREFIX };
