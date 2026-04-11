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

   Signaling column: T (index 19, 1-based 20) — to match the Android + web app.
   ============================================================ */

import { RTCPeerConnection } from "werift";

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
const OFFER_MAX_AGE  = 3 * 60_000; // ms — stale offer: rebuild if unanswered for 3 min

const TOTAL_ROWS = MAX_SLOTS * BLOCK_SIZE + BLOCK_START;
const SIG_RANGE  = `Sheet1!T1:T${TOTAL_ROWS + 1}`;

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const STUN_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
];

/** How long to retain a notification in the buffer for late-joining or reconnecting peers. */
const NOTIF_BUFFER_TTL = 5 * 60_000;  // 5 minutes
/** Maximum buffered notifications per peer instance (oldest are dropped when full). */
const NOTIF_BUFFER_MAX = 100;

/* ---------- SheetWebRtcPeer ---------- */

/**
 * Participates in a Waymark WebRTC peer mesh using Google Sheets for signaling.
 *
 * @param {object} opts
 * @param {string}              opts.sheetId      - Google Sheets spreadsheet ID
 * @param {import('google-auth-library').GoogleAuth} opts.auth - Authenticated GoogleAuth
 * @param {string}              opts.peerId       - 8-char hex peer ID for this instance
 * @param {string}              opts.displayName  - Human-readable name shown in peer lists
 * @param {function}            [opts.onMessage]  - (remotePeerId, message) callback
 * @param {function}            [opts.onConnect]  - (remotePeerId) called on DataChannel open
 */
export class SheetWebRtcPeer {
    constructor({ sheetId, auth, getToken, peerId, displayName, onMessage, onConnect }) {
        this.sheetId      = sheetId;
        this.auth         = auth;
        this._getTokenFn  = getToken || null;  // preferred over auth when provided
        this.peerId       = peerId;
        this.displayName  = displayName;
        this.onMessage    = onMessage;
        this.onConnect    = onConnect;

        /** @type {Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel|null, state: string }>} */
        this.peers = new Map();

        this.block     = -1;
        this.destroyed = false;
        this._polling        = false;  // guard: prevent concurrent poll cycles
        this._heartbeatTimer = null;
        this._pollTimer      = null;

        /**
         * Notification delivery buffer.  Each entry: { json, ts, deliveredTo: Set<peerId> }.
         * Flushed to a peer when its DataChannel first opens.
         */
        this._notifQueue = [];
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
    }

    stop() {
        this.destroyed = true;
        clearInterval(this._heartbeatTimer);
        clearInterval(this._pollTimer);
        if (this.block >= 0) {
            this._clearPresence().catch(() => {});
        }
        for (const id of [...this.peers.keys()]) {
            this._closeOne(id);
        }
    }

    /**
     * Send a message to all connected Android peers via DataChannel.
     * @param {object|string} message
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
        // Buffer notification messages.  When a new (or reconnected) peer opens a
        // DataChannel, _flushNotifQueue() delivers anything it missed.
        if (isNotif) this._enqueueNotif(json, deliveredTo);
        return sent;
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
                result[i + BLOCK_START] = row[0];
            }
        }
        return result;
    }

    async _writeCell(rowIdx, value) {
        const token = await this._getToken();
        const sheetsRow = rowIdx; // already 1-based (BLOCK_START=1)
        const range = `Sheet1!T${sheetsRow}`;
        const body = JSON.stringify({
            range,
            majorDimension: "ROWS",
            values: [[value ?? ""]],
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
                        // Build offer
                        await this._createOffer(remoteId, myOffers).catch(e =>
                            this._log(`createOffer for ${remoteId} failed: ${e.message}`)
                        );
                        offDirty = false; // _writeOffers called inside _createOffer
                    } else if (entry.state !== "connected") {
                        // Look for answer from remote
                        const remoteAnswers = this._parseJson(vals[remoteBlock + OFF_ANSWERS]) || {};
                        const ans = remoteAnswers[this.peerId];
                        if (ans) {
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
                            await this._createAnswer(remoteId, offer.sdp, myAnswers).catch(e =>
                                this._log(`createAnswer for ${remoteId} failed: ${e.message}`)
                            );
                            ansDirty = false; // _writeAnswers called inside _createAnswer
                        }
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
    }

    /* ---------- Offer / Answer builders ---------- */

    async _createOffer(remotePeerId, myOffers) {
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        const dc = pc.createDataChannel("waymark");
        this.peers.set(remotePeerId, { pc, dc, state: "connecting" });
        this._attachDataChannel(dc, remotePeerId);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this._waitForIceGathering(pc);

        myOffers[remotePeerId] = { sdp: pc.localDescription.sdp, ts: Date.now() };
        await this._writeOffers(myOffers);
    }

    async _createAnswer(remotePeerId, offerSdp, myAnswers) {
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        this.peers.set(remotePeerId, { pc, dc: null, state: "connecting" });

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

        myAnswers[remotePeerId] = { sdp: pc.localDescription.sdp, ts: Date.now() };
        await this._writeAnswers(myAnswers);
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
            this._log(`DataChannel open with ${remotePeerId}`);
            // Deliver any notifications buffered while this peer was disconnected
            this._flushNotifQueue(remotePeerId, dc);
            if (this.onConnect) this.onConnect(remotePeerId);
        };
        dc.onclose = () => {
            this._log(`DataChannel closed with ${remotePeerId}`);
            const entry = this.peers.get(remotePeerId);
            if (entry) entry.state = "disconnected";
        };
        dc.onmessage = (event) => {
            try {
                const msg = JSON.parse(typeof event === "string" ? event : event.data);
                if (this.onMessage) this.onMessage(remotePeerId, msg);
            } catch {}
        };
    }

    /* ---------- Notification buffer ---------- */

    _enqueueNotif(json, deliveredTo) {
        const now = Date.now();
        // Prune expired items and enforce the size cap
        this._notifQueue = this._notifQueue
            .filter(n => now - n.ts < NOTIF_BUFFER_TTL)
            .slice(-(NOTIF_BUFFER_MAX - 1));
        this._notifQueue.push({ json, ts: now, deliveredTo: new Set(deliveredTo) });
    }

    /**
     * Deliver any buffered notifications that `remotePeerId` has not yet received.
     * Called each time a DataChannel opens — covers both fresh joins and reconnects.
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
                break;
            }
        }
        if (flushed) this._log(`flushed ${flushed} buffered notification(s) to ${remotePeerId}`);
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
