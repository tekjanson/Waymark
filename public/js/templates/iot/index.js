/* ============================================================
   iot/index.js — IoT Sensor Log template

   Architecture:
     • One sheet = one physical sensor (time-series row log)
     • A folder of sensor sheets → Fleet Dashboard (directoryView)
     • Legacy multi-sensor sheets still render as a fleet grid

   Live ingestion: WebSocket · HTTP polling · MQTT-over-WS · Web Serial
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, registerCrossFeature, delegateEvent, buildDirSyncBtn } from '../shared.js';
import {
  ALERT_STATES,
  parseNumber,
  evaluateThreshold,
  resolveState,
  formatReading,
  formatTimestamp,
  averageReading,
} from './helpers.js';

const LOG_LIMIT = 500;

/* ─── MQTT binary codec (pure-browser, no external deps) ─── */

function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function mqttStr(value) {
  const b = new TextEncoder().encode(value || '');
  return concatBytes([new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]), b]);
}

function mqttRemainingLen(len) {
  const out = [];
  let x = len;
  do {
    let enc = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) enc |= 128;
    out.push(enc);
  } while (x > 0);
  return new Uint8Array(out);
}

function buildMqttConnectPacket(clientId) {
  const varHdr = concatBytes([mqttStr('MQTT'), new Uint8Array([0x04, 0x02, 0x00, 0x1e])]);
  const payload = mqttStr(clientId || 'waymark-iot-client');
  const rem = mqttRemainingLen(varHdr.length + payload.length);
  return concatBytes([new Uint8Array([0x10]), rem, varHdr, payload]);
}

function buildMqttSubscribePacket(topic, packetId) {
  const varHdr = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const payload = concatBytes([mqttStr(topic), new Uint8Array([0x00])]);
  const rem = mqttRemainingLen(varHdr.length + payload.length);
  return concatBytes([new Uint8Array([0x82]), rem, varHdr, payload]);
}

function decodeMqttPublishPayload(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length || (bytes[0] >> 4) !== 3) return null;
  let mult = 1, val = 0, idx = 1, enc;
  do {
    if (idx >= bytes.length) return null;
    enc = bytes[idx++];
    val += (enc & 127) * mult;
    mult *= 128;
  } while ((enc & 128) !== 0);
  if (idx + 2 > bytes.length) return null;
  const tLen = (bytes[idx] << 8) + bytes[idx + 1];
  idx += 2 + tLen;
  if ((bytes[0] >> 1) & 0x03) idx += 2;
  if (idx > bytes.length) return null;
  return new TextDecoder().decode(bytes.slice(idx));
}

/* ─── Local log buffer per-sheet ─── */

function currentSheetId() {
  const m = (window.location.hash || '').match(/sheet\/([^/?#]+)/);
  return m ? m[1] : 'unknown';
}

function loadLogBuffer() {
  try {
    const raw = localStorage.getItem(`waymark_iot_log_${currentSheetId()}`);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function saveLogBuffer(entries) {
  try {
    localStorage.setItem(`waymark_iot_log_${currentSheetId()}`, JSON.stringify(entries.slice(-LOG_LIMIT)));
  } catch { /* best-effort */ }
}

/* ─── Stream panel builder (shared by single-sensor and multi-sensor views) ─── */

/**
 * Build the Live Stream collapsible panel.
 * @param {object} opts
 * @param {function} opts.onIngest - called as onIngest(payload, tag, helpers)
 *   helpers = { logFn, setStatus, writeThroughCheck }
 * @returns {{ panel: HTMLElement, disconnect: function }}
 */
function buildStreamPanel({ onIngest }) {
  let streamMode = 'ws';
  let ws = null, pollTimer = null, mqttPingTimer = null;
  let mqttPacketId = 1;
  let serialPort = null, serialReader = null, serialKeepReading = false;
  let connected = false;
  let logEntries = loadLogBuffer();

  const endpointInput = el('input', {
    className: 'iot-stream-input',
    type: 'text',
    value: 'ws://localhost:8080',
    placeholder: 'ws://host:port or endpoint URL',
  });
  const topicInput = el('input', {
    className: 'iot-stream-input iot-stream-topic hidden',
    type: 'text',
    value: 'waymark/sensors',
    placeholder: 'MQTT topic  (e.g. sensors/room-1)',
  });
  const baudInput = el('input', {
    className: 'iot-stream-input iot-stream-baud hidden',
    type: 'number', value: '115200', min: '300', step: '1',
    title: 'Baud rate',
  });
  const intervalInput = el('input', {
    className: 'iot-stream-input iot-stream-interval hidden',
    type: 'number', value: '2', min: '1', max: '120', step: '1',
    title: 'Poll interval (s)',
  });
  const modeSelect = el('select', { className: 'iot-stream-select' }, [
    el('option', { value: 'ws', selected: true }, ['WebSocket']),
    el('option', { value: 'poll' }, ['HTTP Polling']),
    el('option', { value: 'mqtt' }, ['MQTT over WS']),
    el('option', { value: 'serial' }, ['Web Serial']),
  ]);
  const writeThroughCheck = el('input', { type: 'checkbox', checked: 'checked' });
  const connectBtn = el('button', { className: 'iot-stream-connect' }, ['Connect']);
  const streamStatus = el('span', { className: 'iot-stream-status iot-stream-disconnected' }, ['Disconnected']);
  const exportBtn = el('button', { className: 'iot-stream-secondary' }, ['Export CSV']);
  const clearBtn = el('button', { className: 'iot-stream-secondary' }, ['Clear Log']);
  const streamLog = el('div', { className: 'iot-stream-log' });

  function updateModeUi() {
    intervalInput.classList.toggle('hidden', streamMode !== 'poll');
    topicInput.classList.toggle('hidden', streamMode !== 'mqtt');
    baudInput.classList.toggle('hidden', streamMode !== 'serial');
    if (streamMode === 'mqtt') {
      endpointInput.placeholder = 'ws://broker:9001/mqtt';
      if (!endpointInput.value || endpointInput.value === 'ws://localhost:8080') {
        endpointInput.value = 'ws://localhost:9001/mqtt';
      }
    } else if (streamMode === 'serial') {
      endpointInput.placeholder = 'Port selected on Connect';
    } else if (streamMode === 'poll') {
      endpointInput.placeholder = '/api/iot/live or JSON feed URL';
    } else {
      endpointInput.placeholder = 'ws://host:port';
    }
  }

  function setStatus(text, tone) {
    streamStatus.textContent = text;
    streamStatus.className = `iot-stream-status iot-stream-${tone}`;
    connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  }

  function renderLog() {
    streamLog.innerHTML = '';
    const recent = logEntries.slice(-20).reverse();
    if (!recent.length) {
      streamLog.append(el('div', { className: 'iot-log-empty' }, ['No stream samples yet.']));
      return;
    }
    for (const e of recent) {
      streamLog.append(el('div', { className: 'iot-log-row' }, [
        el('span', { className: 'iot-log-time' }, [formatTimestamp(e.timestamp)]),
        e.sensor ? el('span', { className: 'iot-log-sensor' }, [e.sensor]) : null,
        el('span', { className: 'iot-log-reading' }, [formatReading(parseNumber(e.reading), e.unit)]),
        el('span', { className: `iot-log-state iot-log-state-${(e.state || 'normal').toLowerCase()}` }, [e.state || 'Normal']),
      ]));
    }
  }

  function logFn(entry) {
    logEntries.push(entry);
    if (logEntries.length > LOG_LIMIT) logEntries = logEntries.slice(-LOG_LIMIT);
    saveLogBuffer(logEntries);
    renderLog();
  }

  function ingestOne(payload, tag) {
    if (!payload || typeof payload !== 'object') return;
    onIngest(payload, tag, { logFn, setStatus, writeThroughCheck });
  }

  function ingestPayload(data, tag) {
    if (!data) return;
    if (Array.isArray(data)) { data.forEach(item => ingestOne(item, tag)); return; }
    if (Array.isArray(data.readings)) { data.readings.forEach(item => ingestOne(item, tag)); return; }
    ingestOne(data, tag);
  }

  async function pollOnce() {
    const url = endpointInput.value.trim();
    if (!url) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ingestPayload(await res.json(), 'poll');
    } catch (err) { setStatus(`Poll error: ${err.message}`, 'error'); }
  }

  function disconnect() {
    connected = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (mqttPingTimer) { clearInterval(mqttPingTimer); mqttPingTimer = null; }
    if (ws) { ws.close(); ws = null; }
    if (serialReader) {
      serialKeepReading = false;
      try { serialReader.cancel(); } catch { /* noop */ }
      try { serialReader.releaseLock(); } catch { /* noop */ }
      serialReader = null;
    }
    if (serialPort) { try { serialPort.close(); } catch { /* noop */ } serialPort = null; }
    setStatus('Disconnected', 'disconnected');
  }

  function connect() {
    const endpoint = endpointInput.value.trim();
    disconnect();
    connected = true;
    setStatus('Connecting…', 'warn');

    if (streamMode === 'poll') {
      const s = Math.max(1, Math.min(120, Number(intervalInput.value || '2')));
      pollOnce();
      pollTimer = setInterval(pollOnce, s * 1000);
      setStatus(`Polling every ${s}s`, 'ok');
      return;
    }

    if (streamMode === 'serial') {
      if (typeof navigator?.serial?.requestPort !== 'function') {
        connected = false;
        setStatus('Web Serial not supported in this browser', 'warn');
        return;
      }
      const baudRate = Math.max(300, Number(baudInput.value || '115200'));
      navigator.serial.requestPort()
        .then(async port => {
          serialPort = port;
          await serialPort.open({ baudRate });
          serialReader = serialPort.readable.getReader();
          serialKeepReading = true;
          setStatus(`Serial @ ${baudRate} baud`, 'ok');
          let buf = '';
          const dec = new TextDecoder();
          while (serialKeepReading) {
            const { value, done } = await serialReader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (line) {
                try { ingestPayload(JSON.parse(line), 'serial'); }
                catch { setStatus('Serial line not valid JSON', 'warn'); }
              }
            }
          }
        })
        .catch(err => { connected = false; setStatus(`Serial error: ${err.message}`, 'error'); });
      return;
    }

    if (streamMode === 'mqtt') {
      const topic = topicInput.value.trim();
      if (!topic) { connected = false; setStatus('Enter an MQTT topic', 'warn'); return; }
      const clientId = `waymark-${Math.random().toString(16).slice(2, 10)}`;
      try { ws = new WebSocket(endpoint, ['mqtt']); } catch { ws = new WebSocket(endpoint); }
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => {
        ws.send(buildMqttConnectPacket(clientId));
        setStatus('MQTT handshake…', 'warn');
      });
      ws.addEventListener('message', async ev => {
        let bytes;
        if (ev.data instanceof ArrayBuffer) bytes = new Uint8Array(ev.data);
        else if (ev.data instanceof Blob) bytes = new Uint8Array(await ev.data.arrayBuffer());
        else if (typeof ev.data === 'string') {
          try { ingestPayload(JSON.parse(ev.data), 'mqtt'); } catch { /* noop */ }
          return;
        } else return;
        const type = bytes[0] >> 4;
        if (type === 2) {
          const pid = mqttPacketId;
          mqttPacketId = mqttPacketId >= 65535 ? 1 : mqttPacketId + 1;
          ws.send(buildMqttSubscribePacket(topic, pid));
          if (mqttPingTimer) clearInterval(mqttPingTimer);
          mqttPingTimer = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xc0, 0x00]));
          }, 25000);
          setStatus(`MQTT subscribed: ${topic}`, 'ok');
          return;
        }
        if (type === 3) {
          const text = decodeMqttPublishPayload(bytes);
          if (!text) return;
          try { ingestPayload(JSON.parse(text), 'mqtt'); }
          catch { setStatus('MQTT payload must be JSON', 'warn'); }
        }
      });
      ws.addEventListener('error', () => setStatus('MQTT socket error', 'error'));
      ws.addEventListener('close', () => {
        connected = false;
        if (mqttPingTimer) { clearInterval(mqttPingTimer); mqttPingTimer = null; }
        setStatus('MQTT disconnected', 'disconnected');
      });
      return;
    }

    /* Default: plain WebSocket */
    try {
      ws = new WebSocket(endpoint);
      ws.addEventListener('open', () => setStatus('WebSocket connected', 'ok'));
      ws.addEventListener('message', ev => {
        try { ingestPayload(JSON.parse(ev.data), 'ws'); }
        catch { setStatus('Non-JSON WebSocket data', 'error'); }
      });
      ws.addEventListener('error', () => setStatus('WebSocket error', 'error'));
      ws.addEventListener('close', () => { connected = false; setStatus('Disconnected', 'disconnected'); });
    } catch (err) { connected = false; setStatus(`Connect failed: ${err.message}`, 'error'); }
  }

  /* Wire UI events */
  modeSelect.addEventListener('change', () => { streamMode = modeSelect.value; updateModeUi(); });
  connectBtn.addEventListener('click', () => { if (connected) disconnect(); else connect(); });
  exportBtn.addEventListener('click', () => {
    if (!logEntries.length) return;
    const hdr = 'timestamp,sensor,reading,unit,state';
    const cx = logEntries.map(e =>
      [e.timestamp, e.sensor, e.reading, e.unit, e.state]
        .map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[hdr, ...cx].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `iot-log-${currentSheetId()}.csv`; a.click();
    URL.revokeObjectURL(url);
  });
  clearBtn.addEventListener('click', () => { logEntries = []; saveLogBuffer(logEntries); renderLog(); });

  const panel = el('section', { className: 'iot-stream-panel' }, [
    el('div', { className: 'iot-stream-head' }, [
      el('h3', { className: 'iot-stream-title' }, ['Live Stream']),
      streamStatus,
    ]),
    el('div', { className: 'iot-stream-controls' }, [
      modeSelect, endpointInput, topicInput, baudInput, intervalInput, connectBtn,
    ]),
    el('div', { className: 'iot-stream-options' }, [
      el('label', { className: 'iot-stream-toggle' }, [writeThroughCheck, el('span', {}, ['Write-through to sheet'])]),
      exportBtn,
      clearBtn,
    ]),
    el('div', { className: 'iot-stream-log-wrap' }, [
      el('div', { className: 'iot-stream-log-title' }, ['Recent Samples']),
      streamLog,
    ]),
  ]);

  updateModeUi();
  renderLog();
  return { panel, disconnect };
}

/* ─── Per-sensor time-series view ─── */

function renderSingleSensor(container, rows, cols) {
  /* Build readings list ordered oldest → newest */
  const readings = rows
    .map((row, idx) => {
      const sensorName = cols.sensor >= 0 ? cell(row, cols.sensor).trim() : '';
      const readingRaw = cols.reading >= 0 ? cell(row, cols.reading) : '';
      const reading = parseNumber(readingRaw);
      const unit = cols.unit >= 0 ? cell(row, cols.unit).trim() : '';
      const timestamp = cols.timestamp >= 0 ? cell(row, cols.timestamp) : '';
      const min = cols.min >= 0 ? parseNumber(cell(row, cols.min)) : null;
      const max = cols.max >= 0 ? parseNumber(cell(row, cols.max)) : null;
      const rawAlert = cols.alert >= 0 ? cell(row, cols.alert) : '';
      return {
        row, rowIndex: idx + 1, sensorName, reading, readingRaw,
        unit, timestamp, min, max, rawAlert,
        state: resolveState(reading, min, max, rawAlert),
      };
    })
    .filter(r => r.sensorName || r.readingRaw);

  const latest = readings.length ? readings[readings.length - 1] : null;
  const sensorName = latest?.sensorName || 'Sensor';
  const firstSensorName = readings[0]?.sensorName || sensorName;

  function toneOf(state) {
    return state === 'Alert' ? 'alert'
      : state === 'Offline' ? 'offline'
      : state === 'Watch' ? 'watch'
      : 'normal';
  }

  const initTone = toneOf(latest?.state || 'Normal');

  /* Hero card */
  const heroReading = el('div', { className: 'iot-hero-reading' }, [
    latest ? formatReading(latest.reading, latest.unit) : '—',
  ]);
  const heroBadge = el('span', { className: `iot-hero-badge iot-badge-${initTone}` }, [
    latest?.state || 'No data',
  ]);
  const heroMeta = el('div', { className: 'iot-hero-meta' });

  function refreshHeroMeta(r) {
    heroMeta.innerHTML = '';
    if (r && r.min !== null && r.max !== null) {
      heroMeta.append(el('span', { className: 'iot-hero-range' }, [
        `Range ${r.min}\u2013${r.max}${r.unit ? ' ' + r.unit : ''}`,
      ]));
    }
    if (r?.timestamp) {
      heroMeta.append(el('span', { className: 'iot-hero-updated' }, [
        `Updated ${formatTimestamp(r.timestamp)}`,
      ]));
    }
    if (readings.length) {
      heroMeta.append(el('span', { className: 'iot-hero-count' }, [
        `${readings.length} reading${readings.length !== 1 ? 's' : ''}`,
      ]));
    }
  }

  refreshHeroMeta(latest);

  const hero = el('div', { className: `iot-hero iot-hero-${initTone}` }, [
    el('div', { className: 'iot-hero-top' }, [
      el('h2', { className: 'iot-hero-name' }, [sensorName]),
      heroBadge,
    ]),
    heroReading,
    heroMeta,
  ]);

  /* Threshold range bar */
  let threshBar = null;
  if (latest && latest.reading !== null && latest.min !== null && latest.max !== null && latest.max > latest.min) {
    const pct = Math.max(0, Math.min(100, ((latest.reading - latest.min) / (latest.max - latest.min)) * 100));
    const fillTone = pct < 10 || pct > 90 ? 'danger' : pct < 25 || pct > 75 ? 'warn' : 'ok';
    threshBar = el('div', { className: 'iot-thresh-wrap' }, [
      el('div', { className: 'iot-thresh-labels' }, [
        el('span', {}, [String(latest.min)]),
        el('span', { className: 'iot-thresh-unit' }, [latest.unit]),
        el('span', {}, [String(latest.max)]),
      ]),
      el('div', { className: 'iot-thresh-track' }, [
        el('div', { className: `iot-thresh-fill iot-thresh-${fillTone}`, style: `width:${pct}%` }),
        el('div', { className: 'iot-thresh-marker', style: `left:calc(${pct}% - 5px)` }),
      ]),
    ]);
  }

  /* History table */
  const historyList = el('div', { className: 'iot-history-list' });
  const histTitle = el('h3', { className: 'iot-history-title' }, [
    `Reading History (${readings.length})`,
  ]);

  function renderHistory() {
    historyList.innerHTML = '';
    const items = readings.slice().reverse().slice(0, 200);
    if (!items.length) {
      historyList.append(el('div', { className: 'iot-history-empty' }, [
        'No readings yet — add a row or connect a live stream.',
      ]));
      return;
    }
    const tbl = el('div', { className: 'iot-history-table' });
    tbl.append(el('div', { className: 'iot-history-hdr' }, [
      el('span', {}, ['Time']),
      el('span', {}, ['Reading']),
      el('span', {}, ['Status']),
    ]));
    for (const r of items) {
      tbl.append(el('div', { className: 'iot-history-row' }, [
        el('span', { className: 'iot-history-time' }, [formatTimestamp(r.timestamp) || '—']),
        el('span', { className: 'iot-history-reading' }, [formatReading(r.reading, r.unit)]),
        el('span', { className: `iot-history-badge iot-badge-${toneOf(r.state)}` }, [r.state]),
      ]));
    }
    historyList.append(tbl);
  }

  renderHistory();

  /* Stream panel — incoming readings APPEND new rows */
  const colCount = Math.max(...Object.values(cols).filter(v => v >= 0), -1) + 1;

  const { panel: streamPanel } = buildStreamPanel({
    onIngest(payload, tag, { logFn, setStatus, writeThroughCheck }) {
      const readingVal = payload.reading !== undefined ? String(payload.reading) : null;
      if (!readingVal) { setStatus('Missing "reading" in payload', 'warn'); return; }

      const nowIso = payload.timestamp || new Date().toISOString();
      const prevLatest = readings[readings.length - 1];
      const newUnit = (payload.unit !== undefined ? String(payload.unit) : '') || prevLatest?.unit || '';
      const newAlert = payload.alert ? String(payload.alert) : '';
      const newMin = payload.min !== undefined ? parseNumber(String(payload.min)) : prevLatest?.min ?? null;
      const newMax = payload.max !== undefined ? parseNumber(String(payload.max)) : prevLatest?.max ?? null;
      const newReading = parseNumber(readingVal);
      const newState = resolveState(newReading, newMin, newMax, newAlert);
      const newTone = toneOf(newState);

      /* Build new data row */
      const newRow = new Array(Math.max(colCount, 7)).fill('');
      if (cols.sensor >= 0) newRow[cols.sensor] = payload.sensor || firstSensorName;
      if (cols.reading >= 0) newRow[cols.reading] = readingVal;
      if (cols.unit >= 0) newRow[cols.unit] = newUnit;
      if (cols.timestamp >= 0) newRow[cols.timestamp] = nowIso;
      if (cols.min >= 0 && newMin !== null) newRow[cols.min] = String(newMin);
      if (cols.max >= 0 && newMax !== null) newRow[cols.max] = String(newMax);
      if (cols.alert >= 0) newRow[cols.alert] = newAlert;

      const newRowIndex = rows.length + 1;
      rows.push(newRow);
      readings.push({
        row: newRow, rowIndex: newRowIndex,
        sensorName: newRow[cols.sensor] || firstSensorName,
        reading: newReading, readingRaw: readingVal, unit: newUnit,
        timestamp: nowIso, min: newMin, max: newMax, rawAlert: newAlert, state: newState,
      });

      /* Write-through: one emitEdit per populated column */
      if (writeThroughCheck.checked) {
        Object.entries(cols).forEach(([, colIdx]) => {
          if (colIdx >= 0 && newRow[colIdx]) emitEdit(newRowIndex, colIdx, newRow[colIdx]);
        });
      }

      /* Refresh hero */
      heroReading.textContent = formatReading(newReading, newUnit);
      heroBadge.textContent = newState;
      heroBadge.className = `iot-hero-badge iot-badge-${newTone}`;
      hero.className = `iot-hero iot-hero-${newTone}`;
      refreshHeroMeta(readings[readings.length - 1]);
      histTitle.textContent = `Reading History (${readings.length})`;

      logFn({ timestamp: nowIso, sensor: firstSensorName, reading: readingVal, unit: newUnit, state: newState });
      setStatus(`${formatReading(newReading, newUnit)} — ${newState}`, 'ok');
      renderHistory();
    },
  });

  const view = el('div', { className: 'iot-view iot-single-view' }, [
    hero,
    threshBar,
    streamPanel,
    el('div', { className: 'iot-history-section' }, [histTitle, historyList]),
  ].filter(Boolean));

  container.append(view);
}

/* ─── Multi-sensor fleet sheet view ─── */

function renderMultiSensor(container, rows, cols) {
  const sensors = rows
    .map((row, idx) => {
      const sensor = cols.sensor >= 0 ? cell(row, cols.sensor).trim() : '';
      if (!sensor) return null;
      const readingRaw = cols.reading >= 0 ? cell(row, cols.reading) : '';
      const reading = parseNumber(readingRaw);
      const unit = cols.unit >= 0 ? cell(row, cols.unit).trim() : '';
      const timestamp = cols.timestamp >= 0 ? cell(row, cols.timestamp) : '';
      const min = cols.min >= 0 ? parseNumber(cell(row, cols.min)) : null;
      const max = cols.max >= 0 ? parseNumber(cell(row, cols.max)) : null;
      const rawAlert = cols.alert >= 0 ? cell(row, cols.alert) : '';
      return {
        row, rowIndex: idx + 1, sensor, unit, timestamp,
        reading, min, max, rawAlert,
        state: resolveState(reading, min, max, rawAlert),
      };
    })
    .filter(Boolean);

  let filter = 'all';
  const summaryBar = el('div', { className: 'iot-summary-bar' });
  const grid = el('div', { className: 'iot-grid' });

  const allBtn = el('button', {
    className: 'iot-filter-btn active',
    on: { click: () => { filter = 'all'; allBtn.classList.add('active'); alertsBtn.classList.remove('active'); renderGrid(); } },
  }, ['All Sensors']);

  const alertsBtn = el('button', {
    className: 'iot-filter-btn',
    on: { click: () => { filter = 'alerts'; alertsBtn.classList.add('active'); allBtn.classList.remove('active'); renderGrid(); } },
  }, ['Needs Attention']);

  function toneOf(state) {
    return state === 'Alert' ? 'alert'
      : state === 'Offline' ? 'offline'
      : state === 'Watch' ? 'watch'
      : 'normal';
  }

  function renderSummary() {
    summaryBar.innerHTML = '';
    const attention = sensors.filter(s => s.state !== 'Normal').length;
    const offline = sensors.filter(s => s.state === 'Offline').length;
    const avg = averageReading(sensors);

    summaryBar.append(
      el('div', { className: 'iot-summary-chip' }, [
        el('span', { className: 'iot-chip-n' }, [String(sensors.length)]),
        el('span', { className: 'iot-chip-lbl' }, ['sensors']),
      ]),
      attention > 0 ? el('div', { className: 'iot-summary-chip iot-chip-attention' }, [
        el('span', { className: 'iot-chip-n' }, [String(attention)]),
        el('span', { className: 'iot-chip-lbl' }, ['need attention']),
      ]) : null,
      offline > 0 ? el('div', { className: 'iot-summary-chip iot-chip-offline' }, [
        el('span', { className: 'iot-chip-n' }, [String(offline)]),
        el('span', { className: 'iot-chip-lbl' }, ['offline']),
      ]) : null,
      avg !== null ? el('div', { className: 'iot-summary-chip' }, [
        el('span', { className: 'iot-chip-n' }, [avg.toFixed(1)]),
        el('span', { className: 'iot-chip-lbl' }, ['avg']),
      ]) : null,
    );
    alertsBtn.textContent = `Needs Attention (${attention})`;
  }

  function cycleState(sensor) {
    const idx = ALERT_STATES.indexOf(sensor.state);
    const next = ALERT_STATES[(idx + 1) % ALERT_STATES.length];
    sensor.state = next;
    sensor.rawAlert = next;
    if (cols.alert >= 0) emitEdit(sensor.rowIndex, cols.alert, next);
    renderSummary();
    renderGrid();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const visible = filter === 'alerts'
      ? sensors.filter(s => s.state !== 'Normal')
      : sensors;
    if (!visible.length) {
      grid.append(el('div', { className: 'iot-empty' }, ['No sensors match this filter.']));
      return;
    }
    for (const s of visible) {
      const tone = toneOf(s.state);
      const readingEl = cols.reading >= 0
        ? editableCell('div', { className: 'iot-card-reading' },
            String(cell(s.row, cols.reading)), s.rowIndex, cols.reading, {
              onCommit: v => {
                s.row[cols.reading] = v;
                s.reading = parseNumber(v);
                if (!s.rawAlert || s.rawAlert === 'Normal') {
                  s.state = resolveState(s.reading, s.min, s.max, s.rawAlert);
                }
                renderSummary();
                renderGrid();
              },
            })
        : el('div', { className: 'iot-card-reading' }, [formatReading(s.reading, s.unit)]);

      if (cols.reading >= 0) readingEl.textContent = formatReading(s.reading, s.unit);

      grid.append(el('article', { className: `iot-card iot-card-${tone}` }, [
        el('div', { className: 'iot-card-header' }, [
          el('h3', { className: 'iot-card-name' }, [s.sensor]),
          el('button', {
            className: `iot-state-btn iot-state-${tone}`,
            title: 'Click to cycle state',
            on: { click: () => cycleState(s) },
          }, [s.state]),
        ]),
        readingEl,
        el('div', { className: 'iot-card-meta' }, [
          s.min !== null && s.max !== null
            ? el('span', { className: 'iot-card-range' }, [`${s.min}\u2013${s.max}`])
            : null,
          s.timestamp
            ? el('span', { className: 'iot-card-time' }, [formatTimestamp(s.timestamp)])
            : null,
        ]),
      ]));
    }
  }

  const { panel: streamPanel } = buildStreamPanel({
    onIngest(payload, tag, { logFn, setStatus, writeThroughCheck }) {
      const name = String(payload.sensor || payload.device || payload.name || '').trim();
      if (!name) return;
      const target = sensors.find(s => s.sensor === name);
      if (!target) { setStatus(`Unknown sensor: ${name}`, 'warn'); return; }

      if (payload.reading !== undefined && cols.reading >= 0) {
        const v = String(payload.reading);
        target.row[cols.reading] = v;
        target.reading = parseNumber(v);
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.reading, v);
      }
      const ts = payload.timestamp || new Date().toISOString();
      if (cols.timestamp >= 0) {
        target.row[cols.timestamp] = ts;
        target.timestamp = ts;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.timestamp, ts);
      }
      if (payload.alert !== undefined && cols.alert >= 0) {
        const al = String(payload.alert);
        target.row[cols.alert] = al;
        target.rawAlert = al;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.alert, al);
      }
      target.state = resolveState(target.reading, target.min, target.max, target.rawAlert);

      logFn({ timestamp: ts, sensor: target.sensor, reading: target.reading, unit: target.unit, state: target.state });
      setStatus(`${target.sensor} → ${formatReading(target.reading, target.unit)}`, 'ok');
      renderSummary();
      renderGrid();
    },
  });

  renderSummary();
  renderGrid();

  container.append(el('div', { className: 'iot-view iot-multi-view' }, [
    summaryBar,
    streamPanel,
    el('div', { className: 'iot-toolbar' }, [allBtn, alertsBtn]),
    grid,
  ]));
}

/* ─── Template Definition ─── */

const definition = {
  name: 'IoT Sensor Log',
  icon: '📡',
  color: '#0f766e',
  priority: 24,
  itemNoun: 'Reading',
  defaultHeaders: ['Sensor', 'Timestamp', 'Reading', 'Unit', 'Min', 'Max', 'Alert'],

  detect(lower) {
    const hasSensor = lower.some(h => /^(sensor|device|probe|node|meter)/.test(h));
    const hasReading = lower.some(h => /^(reading|value|measurement|current)/.test(h));
    return hasSensor && hasReading;
  },

  columns(lower) {
    const cols = { sensor: -1, reading: -1, unit: -1, timestamp: -1, min: -1, max: -1, alert: -1 };
    cols.sensor = lower.findIndex(h => /^(sensor|device|probe|node|meter|name)/.test(h));
    cols.reading = lower.findIndex((h, i) => i !== cols.sensor && /^(reading|value|measurement|current)/.test(h));
    cols.unit = lower.findIndex((h, i) => i !== cols.sensor && i !== cols.reading && /^(unit|uom)/.test(h));
    cols.timestamp = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit &&
      /^(timestamp|time|updated|last.?seen|recorded)/.test(h));
    cols.min = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp &&
      /^(min|minimum|low)/.test(h));
    cols.max = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp && i !== cols.min &&
      /^(max|maximum|high)/.test(h));
    cols.alert = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp && i !== cols.min && i !== cols.max &&
      /^(alert|status|state|health)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'sensor', label: 'Sensor', colIndex: cols.sensor, type: 'text', placeholder: 'Sensor name', required: true },
      { role: 'timestamp', label: 'Timestamp', colIndex: cols.timestamp, type: 'text', placeholder: 'ISO date/time' },
      { role: 'reading', label: 'Reading', colIndex: cols.reading, type: 'text', placeholder: 'Value' },
      { role: 'unit', label: 'Unit', colIndex: cols.unit, type: 'text', placeholder: 'C, %, V…' },
      { role: 'min', label: 'Min', colIndex: cols.min, type: 'text', placeholder: 'Low threshold' },
      { role: 'max', label: 'Max', colIndex: cols.max, type: 'text', placeholder: 'High threshold' },
      { role: 'alert', label: 'Alert', colIndex: cols.alert, type: 'select', options: ALERT_STATES, defaultValue: 'Normal' },
    ];
  },

  hasDirectoryView: true,

  /** Extract latest reading stats for directory-level fleet roll-up. */
  computeDirStats(rows, cols) {
    if (!rows.length) {
      return { readingCount: 0, sensorName: '', latestReading: null, unit: '', status: 'Unknown', lastUpdated: '', min: null, max: null };
    }
    const lastRow = rows[rows.length - 1];
    const sensorName = cols.sensor >= 0 ? cell(lastRow, cols.sensor) : '';
    const reading = cols.reading >= 0 ? parseNumber(cell(lastRow, cols.reading)) : null;
    const unit = cols.unit >= 0 ? cell(lastRow, cols.unit) : '';
    const min = cols.min >= 0 ? parseNumber(cell(lastRow, cols.min)) : null;
    const max = cols.max >= 0 ? parseNumber(cell(lastRow, cols.max)) : null;
    const lastUpdated = cols.timestamp >= 0 ? cell(lastRow, cols.timestamp) : '';
    const rawAlert = cols.alert >= 0 ? cell(lastRow, cols.alert) : '';
    const status = resolveState(reading, min, max, rawAlert);
    return { readingCount: rows.length, sensorName, latestReading: reading, unit, status, lastUpdated, min, max };
  },

  /** Fleet Dashboard — rendered when a folder contains multiple IoT sensor sheets. */
  directoryView(container, sheets, navigateFn) {
    const stats = sheets.map(s => {
      const ds = s.dirStats || definition.computeDirStats(s.rows || [], s.cols || {});
      return { id: s.id, title: s.name, ...ds };
    });

    const total = stats.length;
    const attention = stats.filter(s => !['Normal', 'Unknown'].includes(s.status)).length;
    const offline = stats.filter(s => s.status === 'Offline').length;

    container.append(el('div', { className: 'iot-dir-header' }, [
      el('h2', { className: 'iot-dir-title' }, ['📡 Fleet Dashboard']),
      buildDirSyncBtn(container),
      el('div', { className: 'iot-dir-totals' }, [
        el('span', { className: 'iot-dir-total-item' }, [`${total} sensor${total !== 1 ? 's' : ''}`]),
        attention > 0
          ? el('span', { className: 'iot-dir-total-item iot-dir-total-attention' }, [`${attention} need attention`])
          : null,
        offline > 0
          ? el('span', { className: 'iot-dir-total-item iot-dir-total-offline' }, [`${offline} offline`])
          : null,
      ]),
    ]));

    const grid = el('div', { className: 'iot-dir-grid' });

    for (const s of stats) {
      const tone = s.status === 'Alert' ? 'alert'
        : s.status === 'Offline' ? 'offline'
        : s.status === 'Watch' ? 'watch'
        : 'normal';

      grid.append(el('div', {
        className: `iot-dir-card iot-dir-card-${tone}`,
        dataset: { sheetId: s.id, sheetName: s.title },
      }, [
        el('div', { className: 'iot-dir-card-top' }, [
          el('span', { className: 'iot-dir-sensor-name' }, [s.sensorName || s.title]),
          el('span', { className: `iot-dir-badge iot-badge-${tone}` }, [s.status]),
        ]),
        el('div', { className: 'iot-dir-reading' }, [
          s.latestReading !== null
            ? formatReading(s.latestReading, s.unit)
            : el('span', { className: 'iot-dir-no-reading' }, ['No reading']),
        ]),
        el('div', { className: 'iot-dir-meta' }, [
          s.min !== null && s.max !== null
            ? el('span', { className: 'iot-dir-range' }, [`${s.min}\u2013${s.max} ${s.unit}`])
            : null,
          s.lastUpdated
            ? el('span', { className: 'iot-dir-updated' }, [formatTimestamp(s.lastUpdated)])
            : null,
        ]),
        el('div', { className: 'iot-dir-count' }, [`${s.readingCount} reading${s.readingCount !== 1 ? 's' : ''}`]),
      ]));
    }

    container.append(grid);

    delegateEvent(grid, 'click', '.iot-dir-card', (e, card) => {
      navigateFn('sheet', card.dataset.sheetId, card.dataset.sheetName);
    });
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* Route to per-sensor or multi-sensor view based on distinct sensor names */
    const uniqueSensors = cols.sensor >= 0
      ? [...new Set(rows.map(r => cell(r, cols.sensor).trim()).filter(Boolean))]
      : [];

    if (uniqueSensors.length <= 1) {
      renderSingleSensor(container, rows, cols);
    } else {
      renderMultiSensor(container, rows, cols);
    }
  },
};

registerTemplate('iot', definition);

/* ---------- Cross-Feature: sensor-reading ----------
   Allows any consumer template to embed live sensor data widgets.
   The consumer just declares { featureId: 'sensor-reading' } and
   the generic orchestration in checklist.js handles the rest.
   -------------------------------------------------- */

registerCrossFeature('sensor-reading', {
  provider: 'iot',
  name: 'Live Sensor',
  icon: '📡',

  /**
   * Extract the latest reading per sensor from an IoT sheet.
   * @param {string[][]} rows — sheet data (excluding header row)
   * @param {Object} cols — column index map from iot.columns()
   * @returns {Array<{name:string, reading:number|null, unit:string, timestamp:string, state:string}>}
   */
  extractData(rows, cols) {
    const latest = new Map();
    for (const row of rows) {
      const name = cell(row, cols.sensor).trim();
      if (!name) continue;
      const reading = parseNumber(cell(row, cols.reading));
      const unit = cell(row, cols.unit);
      const ts = cell(row, cols.timestamp);
      const min = parseNumber(cell(row, cols.min));
      const max = parseNumber(cell(row, cols.max));
      const state = resolveState(reading, min, max, cell(row, cols.alert));
      const existing = latest.get(name);
      if (!existing || (ts && (!existing.timestamp || ts > existing.timestamp))) {
        latest.set(name, { name, reading, unit, timestamp: ts, min, max, state });
      }
    }
    return Array.from(latest.values());
  },

  /**
   * Build compact sensor-reading chip(s) inside a container.
   * @param {HTMLElement} container
   * @param {Array} data — result of extractData()
   */
  buildWidget(container, data) {
    for (const s of data) {
      const tone = s.state === 'Alert' ? 'alert'
        : s.state === 'Offline' ? 'offline'
        : s.state === 'Watch' ? 'watch' : 'normal';
      container.append(el('div', { className: `cross-sensor-chip cross-sensor-${tone}` }, [
        el('span', { className: 'cross-sensor-icon' }, ['📡']),
        el('span', { className: 'cross-sensor-name' }, [s.name]),
        el('span', { className: 'cross-sensor-value' }, [formatReading(s.reading, s.unit)]),
        s.timestamp
          ? el('span', { className: 'cross-sensor-time' }, [formatTimestamp(s.timestamp)])
          : null,
      ]));
    }
  },
});
