// The server auto-starts one SheetWebRtcPeer. We track its peerId here and
// use it for all /notify calls. The peer connects to the Android app over WebRTC.
let serverPeerId = null;
let phoneConnected = false;
let connectedPeerIds = [];

function setStatus(msg, ok = true) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = ok ? 'green' : 'red';
}

function setConnStatus(msg, color) {
  const el = document.getElementById('conn-status');
  el.textContent = msg;
  el.style.color = color;
}

function log(msg) {
  const l = document.getElementById('log');
  const ts = new Date().toISOString();
  l.textContent = `${ts} ${msg}\n` + l.textContent;
}

function formatAge(ms) {
  if (ms == null) return 'n/a';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function renderDiagnostics(data) {
  const summaryEl = document.getElementById('diag-summary');
  const rawEl = document.getElementById('diag-json');

  if (!data || !Array.isArray(data.peers) || data.peers.length === 0) {
    summaryEl.textContent = 'No active server peers';
    rawEl.textContent = JSON.stringify(data || {}, null, 2);
    return;
  }

  const p = data.peers[0];
  const d = p.diagnostics || {};
  const c = d.counters || {};
  const l = d.last || {};
  const cfg = d.config || {};

  const lines = [
    `Peer: ${p.peerId}  block=T${p.block}`,
    `Connected peers (${(p.connectedPeers || []).length}): ${(p.connectedPeers || []).join(', ') || 'none'}`,
    `Uptime: ${formatAge(p.uptimeMs)}`,
    `Config: poll=${cfg.POLL_MS}ms, heartbeat=${cfg.HEARTBEAT_MS}ms, ping=${cfg.DC_PING_MS}ms, pongTimeout=${cfg.DC_PONG_TIMEOUT_MS}ms, handshakeTimeout=${cfg.HANDSHAKE_TIMEOUT_MS}ms`,
    `Sheet I/O: reads=${c.readRangeCalls || 0} (fail=${c.readRangeFailures || 0}), writes=${c.writeCellCalls || 0} (fail=${c.writeCellFailures || 0}), retries=${c.fetchRetries || 0}`,
    `Polling: ticks=${c.pollTicks || 0}, skippedConcurrent=${c.pollSkippedConcurrent || 0}, failures=${c.pollFailures || 0}, lastDuration=${l.lastPollDurationMs ?? 'n/a'}ms`,
    `Handshake: offers=${c.offersBuilt || 0} (fail=${c.offerBuildFailures || 0}), answers=${c.answersBuilt || 0} (fail=${c.answerBuildFailures || 0}), answersApplied=${c.answersApplied || 0} (fail=${c.answerApplyFailures || 0})`,
    `Resets: nonce=${c.nonceResets || 0}, handshakeTimeout=${c.handshakeTimeoutResets || 0}, pcTeardown=${c.pcTeardown || 0}`,
    `DC: open=${c.dcOpen || 0}, close=${c.dcClose || 0}, pingSent=${c.pingSent || 0}, pongReceived=${c.pongReceived || 0}, pongTimeoutClose=${c.pongTimeoutCloses || 0}`,
    `Messaging: broadcastCalls=${c.broadcastCalls || 0}, broadcastDelivered=${c.broadcastDelivered || 0}, targetedCalls=${c.targetedCalls || 0}, targetedDelivered=${c.targetedDelivered || 0}`,
    `Last errors: read=${l.lastReadError?.msg || 'none'} | write=${l.lastWriteError?.msg || 'none'}`,
    `Events buffered: ${(d.events || []).length}`,
  ];

  summaryEl.textContent = lines.join('\n');
  rawEl.textContent = JSON.stringify(data, null, 2);
}

async function refreshDiagnostics() {
  try {
    const res = await fetch('/diagnostics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDiagnostics(data);
  } catch (err) {
    document.getElementById('diag-summary').textContent = `Diagnostics unavailable: ${err.message}`;
  }
}

function renderTargetPeers() {
  const sel = document.getElementById('target-peer');
  const prev = sel.value;
  sel.innerHTML = '';

  sel.appendChild(new Option('All Connected Peers', '__all__'));
  for (const id of connectedPeerIds) {
    sel.appendChild(new Option(id, id));
  }

  if (prev && [...sel.options].some(o => o.value === prev)) {
    sel.value = prev;
  }
}

async function refreshStatus() {
  try {
    const res = await fetch('/peers');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const peers = data.peers || [];
    const btn = document.getElementById('send');

    if (peers.length === 0) {
      serverPeerId = null;
      phoneConnected = false;
      connectedPeerIds = [];
      renderTargetPeers();
      setConnStatus('Server peer not started yet…', '#999');
      btn.disabled = true;
      return;
    }

    // Pick the first server peer (auto-started)
    const p = peers[0];
    serverPeerId = p.peerId;
    connectedPeerIds = Array.isArray(p.connectedPeers) ? p.connectedPeers : [];
    renderTargetPeers();
    const connected = connectedPeerIds.length > 0;
    phoneConnected = connected;

    if (connected) {
      setConnStatus(`Connected peers: ${connectedPeerIds.join(', ')}`, 'green');
      btn.disabled = false;
    } else {
      setConnStatus(`Server peer ready — waiting for phone to connect…`, '#e67e00');
      btn.disabled = false; // allow queued sends
    }
  } catch (err) {
    setConnStatus('Cannot reach server', 'red');
    log('ERROR polling status: ' + err.message);
  }
}

document.getElementById('send').addEventListener('click', async () => {
  if (!serverPeerId) return setStatus('Server peer not ready — wait a moment', false);
  const title  = document.getElementById('title').value.trim() || 'Waymark';
  const body   = document.getElementById('body').value.trim();
  const targetPeerId = document.getElementById('target-peer').value;
  if (!body) return setStatus('Type a notification body', false);
  setStatus('Sending…');
  try {
    const payload = { peerId: serverPeerId, title, body };
    if (targetPeerId && targetPeerId !== '__all__') payload.targetPeerId = targetPeerId;
    const res = await fetch('/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'notify failed');
    if (data.queued) {
      const queuedTarget = payload.targetPeerId || 'all connected peers';
      setStatus(`Queued for delivery to ${queuedTarget}`, true);
      log(`Queued "${title}: ${body}" bufferedId=${data.bufferedId || 'n/a'} target=${queuedTarget}`);
      return;
    }

    // Backward-compatible path for older immediate-send responses.
    const sent = data.sent ?? 0;
    if (sent === 0) {
      setStatus('Not delivered (target not connected)', false);
    } else {
      const mode = data.mode === 'target' ? `peer ${data.targetPeerId}` : `${sent} peer${sent > 1 ? 's' : ''}`;
      setStatus(`Sent to ${mode}`, true);
    }
    log(`Sent "${title}: ${body}" mode=${data.mode || 'legacy'} sent=${sent}`);
  } catch (err) {
    setStatus('Send failed', false);
    log('ERROR send: ' + err.message);
  }
});

// Poll server status every 5 s
refreshStatus();
setInterval(refreshStatus, 5000);
refreshDiagnostics();
setInterval(refreshDiagnostics, 5000);
