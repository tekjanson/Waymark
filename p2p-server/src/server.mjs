import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { SheetWebRtcPeer } from './sheet-webrtc-peer.mjs';
import { NotificationStore } from './notification-store.mjs';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve the simple frontend from /public
const publicDir = path.resolve(new URL(import.meta.url).pathname, '..', '..', 'public');
app.use(express.static(publicDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = parseInt(process.env.PORT || '8080', 10);
const AUTO_PUSH_INTERVAL_MS = parseInt(process.env.NOTIFICATION_AUTO_PUSH_INTERVAL_MS || '2000', 10);
const STABLE_GRACE_MS = parseInt(process.env.NOTIFICATION_STABLE_GRACE_MS || '1500', 10);

// In-memory peers map: peerId -> instance
const peers = new Map();

const dataDir = path.resolve(new URL(import.meta.url).pathname, '..', '..', 'data');
const notificationStore = new NotificationStore({
    bufferFile: process.env.NOTIFICATION_BUFFER_FILE || path.join(dataDir, 'notification-buffer.json'),
    historyFile: process.env.NOTIFICATION_HISTORY_FILE || path.join(dataDir, 'notification-history.jsonl'),
});
await notificationStore.init();

function resolveNotificationInput(body = {}) {
    const { peerId, targetPeerId, title, body: msgBody, message } = body;
    const resolvedTitle = title || (typeof message === 'object' ? message?.title : undefined) || 'Waymark';
    const resolvedBody = msgBody
        || (typeof message === 'object' ? (message?.body ?? message?.text) : (typeof message === 'string' ? message : ''))
        || '';
    return {
        peerId,
        targetPeerId: targetPeerId || null,
        title: resolvedTitle,
        body: resolvedBody,
    };
}

function forwardNotification(entry) {
    const peer = peers.get(entry.peerId);
    if (!peer) {
        return {
            ok: false,
            sent: 0,
            mode: entry.targetPeerId ? 'target' : 'broadcast',
            targetPeerId: entry.targetPeerId || null,
            error: 'peer not found',
        };
    }

    if (entry.targetPeerId) {
        const ok = peer.sendToPeer(entry.targetPeerId, { title: entry.title, body: entry.body });
        return {
            ok,
            sent: ok ? 1 : 0,
            mode: 'target',
            targetPeerId: entry.targetPeerId,
            error: ok ? null : 'target peer not connected',
        };
    }

    const sent = peer.broadcast({ title: entry.title, body: entry.body });
    return {
        ok: sent > 0,
        sent,
        mode: 'broadcast',
        targetPeerId: null,
        error: sent > 0 ? null : 'no connected peers',
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function attemptStableDelivery(entry) {
    const peer = peers.get(entry.peerId);
    if (!peer) {
        return {
            ok: false,
            sent: 0,
            mode: entry.targetPeerId ? 'target' : 'broadcast',
            targetPeerId: entry.targetPeerId || null,
            error: 'peer not found',
            stable: false,
        };
    }

    const preConnected = new Set(peer.connectedPeers());
    const desiredTargets = entry.targetPeerId
        ? [entry.targetPeerId]
        : [...preConnected];

    // Stable-open precondition: for target sends the target must already be open,
    // for broadcast there must be at least one open peer to receive.
    if (entry.targetPeerId && !preConnected.has(entry.targetPeerId)) {
        return {
            ok: false,
            sent: 0,
            mode: 'target',
            targetPeerId: entry.targetPeerId,
            error: 'target peer not connected',
            stable: false,
        };
    }
    if (!entry.targetPeerId && desiredTargets.length === 0) {
        return {
            ok: false,
            sent: 0,
            mode: 'broadcast',
            targetPeerId: null,
            error: 'no connected peers',
            stable: false,
        };
    }

    const sendResult = forwardNotification(entry);
    if (!sendResult.ok) {
        return { ...sendResult, stable: false };
    }

    await sleep(STABLE_GRACE_MS);
    const postConnected = new Set(peer.connectedPeers());
    const allTargetsStillConnected = desiredTargets.every(id => postConnected.has(id));
    const expectedSent = desiredTargets.length;
    const sentAllExpected = sendResult.sent >= expectedSent;
    const stable = allTargetsStillConnected && sentAllExpected;

    return {
        ...sendResult,
        stable,
        expectedRecipients: expectedSent,
        postConnectedCount: postConnected.size,
        error: stable ? null : 'connection not stable after send',
    };
}

async function enqueueNotification(input, metadata = {}) {
    return notificationStore.enqueue({ ...input, metadata });
}

let autoPushRunning = false;

async function drainBufferedNotificationsOnce() {
    if (autoPushRunning) return;
    autoPushRunning = true;
    try {
        const bufferedItems = await notificationStore.listBuffer();
        for (const buffered of bufferedItems) {
            const pushResult = await attemptStableDelivery(buffered);
            if (pushResult.ok && pushResult.stable) {
                await notificationStore.moveBufferedToHistory(buffered.id, pushResult);
            }
        }
    } catch (err) {
        console.error('auto buffer drain failed:', err?.message || String(err));
    } finally {
        autoPushRunning = false;
    }
}

app.post('/start', async (req, res) => {
    const { sheetId, displayName } = req.body || {};
    if (!sheetId) return res.status(400).json({ error: 'sheetId required' });
    try {
        const peer = new SheetWebRtcPeer({ sheetId, getToken: undefined, displayName });
        await peer.start();
        peers.set(peer.peerId, peer);
        return res.json({ peerId: peer.peerId });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Broadcast to all connected Android peers via every registered server peer.
// No peerId needed — the server picks whichever peer(s) it manages.
// Body: { title?, body, priority?, event?, type? }
app.post('/broadcast', (req, res) => {
    const { title, body, priority, event, type } = req.body || {};
    if (!body && !title) return res.status(400).json({ error: 'title or body required' });
    console.log(`[broadcast] event=${event || 'none'} title="${title || ''}" body="${(body || '').slice(0, 60)}"`);
    let totalSent = 0;
    const results = [];
    for (const peer of peers.values()) {
        const sent = peer.broadcast({
            type:     type || 'orchestrator-alert',
            title:    title || event || 'Waymark',
            body:     body || '',
            priority: priority || 'normal',
            event:    event || null,
            ts:       Date.now(),
        });
        totalSent += sent;
        results.push({ peerId: peer.peerId, sent });
    }
    res.json({
        ok:          true,
        sent:        totalSent,
        serverPeers: peers.size,
        results,
        reason:      peers.size === 0 ? 'no server peers registered yet' : (totalSent === 0 ? 'no Android peers connected' : null),
    });
});

app.post('/notify', async (req, res) => {
    const input = resolveNotificationInput(req.body || {});
    if (!input.peerId) return res.status(400).json({ error: 'peerId required' });
    if (!input.body) return res.status(400).json({ error: 'body (or message) required' });
    try {
        const buffered = await enqueueNotification(input, {
            source: 'notify',
            requesterIp: req.ip,
        });
        return res.json({
            ok: true,
            queued: true,
            bufferedId: buffered.id,
            buffered,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/notifications/buffer', async (req, res) => {
    try {
        const notifications = await notificationStore.listBuffer();
        return res.json({ notifications, count: notifications.length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/notifications/push', async (req, res) => {
    const { id, all } = req.body || {};
    try {
        const pushed = [];
        const deferred = [];

        if (id) {
            const buffered = await notificationStore.getBufferedById(id);
            if (!buffered) return res.status(404).json({ error: 'buffered notification not found' });
            const pushResult = await attemptStableDelivery(buffered);
            if (pushResult.ok && pushResult.stable) {
                const history = await notificationStore.moveBufferedToHistory(buffered.id, pushResult);
                pushed.push({ id: buffered.id, pushResult, history });
            } else {
                deferred.push({ id: buffered.id, pushResult });
            }
            return res.json({ ok: true, pushedCount: pushed.length, deferredCount: deferred.length, pushed, deferred });
        }

        if (all) {
            const bufferedItems = await notificationStore.listBuffer();
            for (const buffered of bufferedItems) {
                const pushResult = await attemptStableDelivery(buffered);
                if (pushResult.ok && pushResult.stable) {
                    const history = await notificationStore.moveBufferedToHistory(buffered.id, pushResult);
                    if (history) pushed.push({ id: buffered.id, pushResult, history });
                } else {
                    deferred.push({ id: buffered.id, pushResult });
                }
            }
            return res.json({ ok: true, pushedCount: pushed.length, deferredCount: deferred.length, pushed, deferred });
        }

        return res.status(400).json({ error: 'Provide id or all=true' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/notifications/history', async (req, res) => {
    try {
        const limit = req.query?.limit;
        const notifications = await notificationStore.listHistory({ limit });
        return res.json({ notifications, count: notifications.length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Initiate an offer from a server-side peer to a target remote peerId
app.post('/offer', async (req, res) => {
    const { peerId, targetPeerId } = req.body || {};
    if (!peerId || !targetPeerId) return res.status(400).json({ error: 'peerId and targetPeerId required' });
    const peer = peers.get(peerId);
    if (!peer) return res.status(404).json({ error: 'peer not found' });
    try {
        const r = await peer.initiateOffer(targetPeerId);
        return res.json(r);
    } catch (e) {
        console.error('offer error', e);
        return res.status(500).json({ error: e.message });
    }
});

app.get('/peers', (req, res) => {
    const list = [...peers.values()].map(p => ({
        peerId:         p.peerId,
        sheetId:        p.sheetId,
        block:          p.block,
        displayName:    p.displayName,
        connectedPeers: p.connectedPeers(),
        diagnosticsSummary: {
            uptimeMs: Date.now() - (p._diag?.startedAtMs || Date.now()),
            pollTicks: p._diag?.counters?.pollTicks || 0,
            pollFailures: p._diag?.counters?.pollFailures || 0,
            dcOpen: p._diag?.counters?.dcOpen || 0,
            dcClose: p._diag?.counters?.dcClose || 0,
        },
    }));
    res.json({ peers: list });
});

app.get('/diagnostics', (req, res) => {
    const list = [...peers.values()].map(p => p.getDiagnostics());
    res.json({
        tsMs: Date.now(),
        peerCount: list.length,
        peers: list,
    });
});

app.post('/stop', (req, res) => {
    const { peerId } = req.body || {};
    if (!peerId) return res.status(400).json({ error: 'peerId required' });
    const peer = peers.get(peerId);
    if (!peer) return res.status(404).json({ error: 'peer not found' });
    peer.stop();
    peers.delete(peerId);
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`p2p-sheet-bridge listening on ${PORT}`);
});

setInterval(() => {
    drainBufferedNotificationsOnce();
}, AUTO_PUSH_INTERVAL_MS);

// Auto-start a server-side SheetWebRtcPeer when running in container with SHEET_ID set.
// This makes the app continuously look for mesh peers without requiring an external POST /start.
(() => {
    const sheetId = process.env.SHEET_ID || process.env.WAYMARK_SHEET_ID;
    if (!sheetId) return;

    const displayName = process.env.DISPLAY_NAME || 'web-server';

    async function startAutoPeer() {
        try {
            const peer = new SheetWebRtcPeer({ sheetId, getToken: undefined, displayName });
            await peer.start();
            peers.set(peer.peerId, peer);
            console.log(`auto-started server peer ${peer.peerId} block=${peer.block}`);
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            console.error('Failed to auto-start server peer:', msg);
            // Retry with backoff for transient errors (quota / network)
            const retryDelay = 30_000; // 30s
            console.log(`Retrying auto-start in ${retryDelay/1000}s`);
            setTimeout(startAutoPeer, retryDelay);
        }
    }

    // Kick off initial attempt
    startAutoPeer();
})();
