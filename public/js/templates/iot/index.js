/* ============================================================
   iot/index.js — IoT Sensor Dashboard template
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

    const summaryCards = el('div', { className: 'iot-summary-cards' });
    const toolbar = el('div', { className: 'iot-toolbar' });
    const grid = el('div', { className: 'iot-grid' });

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

    function cycleState(sensor) {
      const current = ALERT_STATES.indexOf(sensor.state);
      const next = ALERT_STATES[(current + 1) % ALERT_STATES.length];
      sensor.state = next;
      sensor.rawAlert = next;
      if (cols.alert >= 0) emitEdit(sensor.rowIndex, cols.alert, next);
      renderSummary();
      renderGrid();
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

        const minCell = cols.min >= 0
          ? editableCell('span', { className: 'iot-range-cell' }, cell(sensor.row, cols.min), sensor.rowIndex, cols.min, {
              onCommit: (newValue) => {
                sensor.row[cols.min] = newValue;
                sensor.min = parseNumber(newValue);
                renderSummary();
                renderGrid();
              },
            })
          : el('span', { className: 'iot-range-cell' }, ['—']);

        const maxCell = cols.max >= 0
          ? editableCell('span', { className: 'iot-range-cell' }, cell(sensor.row, cols.max), sensor.rowIndex, cols.max, {
              onCommit: (newValue) => {
                sensor.row[cols.max] = newValue;
                sensor.max = parseNumber(newValue);
                renderSummary();
                renderGrid();
              },
            })
          : el('span', { className: 'iot-range-cell' }, ['—']);

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
            minCell,
            el('span', { className: 'iot-range-sep' }, ['to']),
            maxCell,
          ]),
          el('div', { className: 'iot-meta-row' }, [
            el('span', { className: 'iot-meta-label' }, ['Updated']),
            el('span', { className: 'iot-timestamp' }, [formatTimestamp(sensor.timestamp)]),
          ]),
        ]));
      }
    }

    const view = el('div', { className: 'iot-view' }, [summaryCards, toolbar, grid]);
    container.append(view);
    renderSummary();
    renderGrid();
  },
};

registerTemplate('iot', definition);
export default definition;
