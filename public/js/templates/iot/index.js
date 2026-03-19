/* ============================================================
   iot/index.js — IoT Sensor Dashboard template
   Browser-only live ingestion (WebSocket or HTTP polling)
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate } from '../shared.js';
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

function currentSheetId() {
  const m = (window.location.hash || '').match(/sheet\/([^/?#]+)/);
  return m ? m[1] : 'unknown';
}

function loadLogBuffer() {
  try {
    const raw = localStorage.getItem(`waymark_iot_log_${currentSheetId()}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLogBuffer(entries) {
  try {
    localStorage.setItem(`waymark_iot_log_${currentSheetId()}`, JSON.stringify(entries.slice(-LOG_LIMIT)));
  } catch {
    /* best-effort */
  }
}

const definition = {
  name: 'IoT Sensor Dashboard',
  icon: '📡',
  color: '#0f766e',
  priority: 24,
  itemNoun: 'Sensor',
  defaultHeaders: ['Sensor', 'Reading', 'Unit', 'Timestamp', 'Min', 'Max', 'Alert'],

  detect(lower) {
    const hasSensor = lower.some(h => /^(sensor|device|probe|node|meter)/.test(h));
    const hasReading = lower.some(h => /^(reading|value|measurement|current)/.test(h));
    const hasThreshold = lower.some(h => /^(min|max|threshold|limit)/.test(h));
    return hasSensor && hasReading && hasThreshold;
  },

  columns(lower) {
    const cols = { sensor: -1, reading: -1, unit: -1, timestamp: -1, min: -1, max: -1, alert: -1 };
    cols.sensor = lower.findIndex(h => /^(sensor|device|probe|node|meter|name)/.test(h));
    cols.reading = lower.findIndex((h, i) => i !== cols.sensor && /^(reading|value|measurement|current)/.test(h));
    cols.unit = lower.findIndex((h, i) => i !== cols.sensor && i !== cols.reading && /^(unit|uom)/.test(h));
    cols.timestamp = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && /^(timestamp|time|updated|last.?seen|recorded)/.test(h),
    );
    cols.min = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp && /^(min|minimum|low)/.test(h),
    );
    cols.max = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp && i !== cols.min && /^(max|maximum|high)/.test(h),
    );
    cols.alert = lower.findIndex((h, i) =>
      i !== cols.sensor && i !== cols.reading && i !== cols.unit && i !== cols.timestamp && i !== cols.min && i !== cols.max && /^(alert|status|state|health)/.test(h),
    );
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'sensor', label: 'Sensor', colIndex: cols.sensor, type: 'text', placeholder: 'Sensor name', required: true },
      { role: 'reading', label: 'Reading', colIndex: cols.reading, type: 'text', placeholder: 'Current value' },
      { role: 'unit', label: 'Unit', colIndex: cols.unit, type: 'text', placeholder: 'C, %, V...' },
      { role: 'timestamp', label: 'Timestamp', colIndex: cols.timestamp, type: 'text', placeholder: 'ISO date/time' },
      { role: 'min', label: 'Min', colIndex: cols.min, type: 'text', placeholder: 'Minimum' },
      { role: 'max', label: 'Max', colIndex: cols.max, type: 'text', placeholder: 'Maximum' },
      { role: 'alert', label: 'Alert', colIndex: cols.alert, type: 'select', options: ALERT_STATES, defaultValue: 'Normal' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    const sensors = rows
      .map((row, idx) => {
        const sensor = cols.sensor >= 0 ? cell(row, cols.sensor).trim() : '';
        if (!sensor) return null;

        const readingRaw = cols.reading >= 0 ? cell(row, cols.reading) : '';
        const reading = parseNumber(readingRaw);
        const min = cols.min >= 0 ? parseNumber(cell(row, cols.min)) : null;
        const max = cols.max >= 0 ? parseNumber(cell(row, cols.max)) : null;
        const unit = cols.unit >= 0 ? cell(row, cols.unit).trim() : '';
        const timestamp = cols.timestamp >= 0 ? cell(row, cols.timestamp) : '';
        const rawAlert = cols.alert >= 0 ? cell(row, cols.alert) : '';

        return {
          row,
          rowIndex: idx + 1,
          sensor,
          unit,
          timestamp,
          reading,
          min,
          max,
          rawAlert,
          state: resolveState(reading, min, max, rawAlert),
        };
      })
      .filter(Boolean);

    let filter = 'all';
    let streamMode = 'ws';
    let ws = null;
    let pollTimer = null;
    let connected = false;
    let logEntries = loadLogBuffer();

    const summaryCards = el('div', { className: 'iot-summary-cards' });
    const toolbar = el('div', { className: 'iot-toolbar' });
    const grid = el('div', { className: 'iot-grid' });
    const streamPanel = el('section', { className: 'iot-stream-panel' });
    const streamLog = el('div', { className: 'iot-stream-log' });

    const allBtn = el('button', {
      className: 'iot-filter-btn active',
      on: {
        click: () => {
          filter = 'all';
          allBtn.classList.add('active');
          alertsBtn.classList.remove('active');
          renderGrid();
        },
      },
    }, ['All Sensors']);

    const alertsBtn = el('button', {
      className: 'iot-filter-btn',
      on: {
        click: () => {
          filter = 'alerts';
          alertsBtn.classList.add('active');
          allBtn.classList.remove('active');
          renderGrid();
        },
      },
    }, ['Needs Attention']);

    toolbar.append(allBtn, alertsBtn);

    const endpointInput = el('input', {
      className: 'iot-stream-input',
      type: 'text',
      value: 'ws://localhost:8080',
      placeholder: 'ws://host:port or /api/iot/live',
    });

    const modeSelect = el('select', { className: 'iot-stream-select' }, [
      el('option', { value: 'ws', selected: true }, ['WebSocket stream']),
      el('option', { value: 'poll' }, ['HTTP JSON polling']),
    ]);

    const intervalInput = el('input', {
      className: 'iot-stream-input iot-stream-interval',
      type: 'number',
      value: '2',
      min: '1',
      max: '120',
      step: '1',
      title: 'Poll interval (seconds)',
    });

    const writeThroughCheck = el('input', { type: 'checkbox', checked: 'checked' });

    const connectBtn = el('button', {
      className: 'iot-stream-connect',
      on: {
        click: () => {
          if (connected) disconnectStream();
          else connectStream();
        },
      },
    }, ['Connect']);

    const exportBtn = el('button', {
      className: 'iot-stream-secondary',
      on: {
        click: () => {
          if (!logEntries.length) return;
          const header = 'timestamp,sensor,reading,unit,state';
          const rowsCsv = logEntries.map(e => [e.timestamp, e.sensor, e.reading, e.unit, e.state].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
          const csv = [header, ...rowsCsv].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `iot-log-${currentSheetId()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        },
      },
    }, ['Export CSV']);

    const clearLogBtn = el('button', {
      className: 'iot-stream-secondary',
      on: {
        click: () => {
          logEntries = [];
          saveLogBuffer(logEntries);
          renderLog();
        },
      },
    }, ['Clear Log']);

    const streamStatus = el('span', { className: 'iot-stream-status iot-stream-disconnected' }, ['Disconnected']);

    modeSelect.addEventListener('change', () => {
      streamMode = modeSelect.value;
      intervalInput.classList.toggle('hidden', streamMode !== 'poll');
    });

    function setStreamStatus(text, tone) {
      streamStatus.textContent = text;
      streamStatus.className = `iot-stream-status iot-stream-${tone}`;
      connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
    }

    function renderSummary() {
      summaryCards.innerHTML = '';
      const attention = sensors.filter(s => s.state !== 'Normal').length;
      const offline = sensors.filter(s => s.state === 'Offline').length;
      const avg = averageReading(sensors);

      summaryCards.append(
        el('div', { className: 'iot-summary-card' }, [
          el('div', { className: 'iot-summary-label' }, ['Sensors']),
          el('div', { className: 'iot-summary-value' }, [String(sensors.length)]),
        ]),
        el('div', { className: 'iot-summary-card' }, [
          el('div', { className: 'iot-summary-label' }, ['Needs Attention']),
          el('div', { className: 'iot-summary-value' }, [String(attention)]),
        ]),
        el('div', { className: 'iot-summary-card' }, [
          el('div', { className: 'iot-summary-label' }, ['Offline']),
          el('div', { className: 'iot-summary-value' }, [String(offline)]),
        ]),
        el('div', { className: 'iot-summary-card' }, [
          el('div', { className: 'iot-summary-label' }, ['Average Reading']),
          el('div', { className: 'iot-summary-value' }, [avg === null ? 'N/A' : avg.toFixed(1)]),
        ]),
      );

      alertsBtn.textContent = `Needs Attention (${attention})`;
    }

    function renderLog() {
      streamLog.innerHTML = '';
      const recent = logEntries.slice(-20).reverse();
      if (!recent.length) {
        streamLog.append(el('div', { className: 'iot-log-empty' }, ['No stream samples yet.']));
        return;
      }
      for (const entry of recent) {
        streamLog.append(el('div', { className: 'iot-log-row' }, [
          el('span', { className: 'iot-log-time' }, [formatTimestamp(entry.timestamp)]),
          el('span', { className: 'iot-log-sensor' }, [entry.sensor]),
          el('span', { className: 'iot-log-reading' }, [formatReading(parseNumber(entry.reading), entry.unit)]),
          el('span', { className: `iot-log-state iot-log-state-${entry.state.toLowerCase()}` }, [entry.state]),
        ]));
      }
    }

    function upsertSensorReading(payload, sourceTag) {
      if (!payload || typeof payload !== 'object') return;
      const sensorName = String(payload.sensor || payload.device || payload.name || '').trim();
      if (!sensorName) return;

      const target = sensors.find(s => s.sensor === sensorName);
      if (!target) {
        setStreamStatus(`Ignored unknown sensor: ${sensorName}`, 'warn');
        return;
      }

      if (payload.reading !== undefined && cols.reading >= 0) {
        const nextReading = String(payload.reading);
        target.row[cols.reading] = nextReading;
        target.reading = parseNumber(nextReading);
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.reading, nextReading);
      }
      if (payload.unit !== undefined && cols.unit >= 0) {
        const nextUnit = String(payload.unit || '');
        target.row[cols.unit] = nextUnit;
        target.unit = nextUnit;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.unit, nextUnit);
      }
      if (payload.timestamp !== undefined && cols.timestamp >= 0) {
        const nextTs = String(payload.timestamp || '');
        target.row[cols.timestamp] = nextTs;
        target.timestamp = nextTs;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.timestamp, nextTs);
      } else if (cols.timestamp >= 0) {
        const nowIso = new Date().toISOString();
        target.row[cols.timestamp] = nowIso;
        target.timestamp = nowIso;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.timestamp, nowIso);
      }
      if (payload.min !== undefined && cols.min >= 0) {
        const nextMin = String(payload.min);
        target.row[cols.min] = nextMin;
        target.min = parseNumber(nextMin);
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.min, nextMin);
      }
      if (payload.max !== undefined && cols.max >= 0) {
        const nextMax = String(payload.max);
        target.row[cols.max] = nextMax;
        target.max = parseNumber(nextMax);
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.max, nextMax);
      }
      if (payload.alert !== undefined && cols.alert >= 0) {
        const nextAlert = String(payload.alert || '');
        target.row[cols.alert] = nextAlert;
        target.rawAlert = nextAlert;
        if (writeThroughCheck.checked) emitEdit(target.rowIndex, cols.alert, nextAlert);
      }

      target.state = resolveState(target.reading, target.min, target.max, target.rawAlert);
      const logEntry = {
        timestamp: target.timestamp || new Date().toISOString(),
        sensor: target.sensor,
        reading: target.reading,
        unit: target.unit,
        state: target.state,
      };
      logEntries.push(logEntry);
      if (logEntries.length > LOG_LIMIT) logEntries = logEntries.slice(-LOG_LIMIT);
      saveLogBuffer(logEntries);

      setStreamStatus(`Live update from ${sourceTag}: ${target.sensor}`, 'ok');
      renderSummary();
      renderGrid();
      renderLog();
    }

    function ingestPayload(data, sourceTag) {
      if (!data) return;
      if (Array.isArray(data)) {
        data.forEach(item => upsertSensorReading(item, sourceTag));
        return;
      }
      if (Array.isArray(data.readings)) {
        data.readings.forEach(item => upsertSensorReading(item, sourceTag));
        return;
      }
      upsertSensorReading(data, sourceTag);
    }

    async function pollOnce() {
      const endpoint = (endpointInput.value || '').trim();
      if (!endpoint) return;
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        ingestPayload(payload, 'poll');
      } catch (err) {
        setStreamStatus(`Poll error: ${err.message}`, 'error');
      }
    }

    function disconnectStream() {
      connected = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      setStreamStatus('Disconnected', 'disconnected');
    }

    function connectStream() {
      const endpoint = (endpointInput.value || '').trim();
      if (!endpoint) {
        setStreamStatus('Provide an endpoint URL first', 'warn');
        return;
      }

      disconnectStream();
      connected = true;
      setStreamStatus('Connecting…', 'warn');

      if (streamMode === 'poll') {
        const seconds = Math.max(1, Math.min(120, Number(intervalInput.value || '2')));
        pollOnce();
        pollTimer = setInterval(pollOnce, seconds * 1000);
        setStreamStatus(`Polling every ${seconds}s`, 'ok');
        return;
      }

      try {
        ws = new WebSocket(endpoint);
        ws.addEventListener('open', () => setStreamStatus('WebSocket connected', 'ok'));
        ws.addEventListener('message', (event) => {
          try {
            const payload = JSON.parse(event.data);
            ingestPayload(payload, 'ws');
          } catch {
            setStreamStatus('Received non-JSON WS payload', 'error');
          }
        });
        ws.addEventListener('error', () => setStreamStatus('WebSocket error', 'error'));
        ws.addEventListener('close', () => {
          connected = false;
          setStreamStatus('WebSocket disconnected', 'disconnected');
        });
      } catch (err) {
        connected = false;
        setStreamStatus(`Connect failed: ${err.message}`, 'error');
      }
    }

    function cycleState(sensor) {
      const current = ALERT_STATES.indexOf(sensor.state);
      const next = ALERT_STATES[(current + 1) % ALERT_STATES.length];
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

      if (visible.length === 0) {
        grid.append(el('div', { className: 'iot-empty' }, ['No sensors match this filter.']));
        return;
      }

      for (const sensor of visible) {
        const threshold = evaluateThreshold(sensor.reading, sensor.min, sensor.max);
        const tone = sensor.state === 'Alert'
          ? 'alert'
          : sensor.state === 'Offline'
            ? 'offline'
            : threshold === 'low'
              ? 'low'
              : threshold === 'high'
                ? 'high'
                : sensor.state === 'Watch'
                  ? 'watch'
                  : 'normal';

        const readingCell = cols.reading >= 0
          ? editableCell('div', { className: 'iot-reading-value' }, String(cell(sensor.row, cols.reading)), sensor.rowIndex, cols.reading, {
              onCommit: (newValue) => {
                sensor.row[cols.reading] = newValue;
                sensor.reading = parseNumber(newValue);
                if (!sensor.rawAlert || sensor.rawAlert === 'Normal') {
                  sensor.state = resolveState(sensor.reading, sensor.min, sensor.max, sensor.rawAlert);
                }
                renderSummary();
                renderGrid();
              },
            })
          : el('div', { className: 'iot-reading-value' }, [formatReading(sensor.reading, sensor.unit)]);

        if (cols.reading >= 0) {
          readingCell.textContent = formatReading(sensor.reading, sensor.unit);
        }

        const stateBtn = el('button', {
          className: `iot-state-btn iot-state-${tone}`,
          title: 'Click to cycle state',
          on: { click: () => cycleState(sensor) },
        }, [sensor.state]);

        grid.append(el('article', { className: `iot-card iot-tone-${tone}` }, [
          el('div', { className: 'iot-card-header' }, [
            el('h3', { className: 'iot-sensor-name' }, [sensor.sensor]),
            stateBtn,
          ]),
          el('div', { className: 'iot-reading-row' }, [readingCell]),
          el('div', { className: 'iot-meta-row' }, [
            el('span', { className: 'iot-meta-label' }, ['Range']),
            el('span', { className: 'iot-range-cell' }, [sensor.min === null ? '—' : String(sensor.min)]),
            el('span', { className: 'iot-range-sep' }, ['to']),
            el('span', { className: 'iot-range-cell' }, [sensor.max === null ? '—' : String(sensor.max)]),
          ]),
          el('div', { className: 'iot-meta-row' }, [
            el('span', { className: 'iot-meta-label' }, ['Updated']),
            el('span', { className: 'iot-timestamp' }, [formatTimestamp(sensor.timestamp)]),
          ]),
        ]));
      }
    }

    streamPanel.append(
      el('div', { className: 'iot-stream-head' }, [
        el('h3', { className: 'iot-stream-title' }, ['Live Device Stream']),
        streamStatus,
      ]),
      el('p', { className: 'iot-stream-hint' }, [
        'Send JSON via WebSocket or a polling endpoint. Supported payloads: { sensor, reading, unit, timestamp, min, max, alert } or { readings: [...] }.',
      ]),
      el('div', { className: 'iot-stream-controls' }, [
        modeSelect,
        endpointInput,
        intervalInput,
        connectBtn,
      ]),
      el('div', { className: 'iot-stream-options' }, [
        el('label', { className: 'iot-stream-toggle' }, [
          writeThroughCheck,
          el('span', {}, ['Write-through to sheet']),
        ]),
        exportBtn,
        clearLogBtn,
      ]),
      el('div', { className: 'iot-stream-log-wrap' }, [
        el('div', { className: 'iot-stream-log-title' }, ['Recent Samples']),
        streamLog,
      ]),
    );

    const view = el('div', { className: 'iot-view' }, [summaryCards, streamPanel, toolbar, grid]);
    container.append(view);
    renderSummary();
    renderGrid();
    renderLog();
  },
};

registerTemplate('iot', definition);
export default definition;
