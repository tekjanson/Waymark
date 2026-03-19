/* ============================================================
   iot/helpers.js — Pure helpers for IoT Sensor Dashboard
   ============================================================ */

export const ALERT_STATES = ['Normal', 'Watch', 'Alert', 'Offline'];

/**
 * Parse a string value into a finite number.
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize free-form alert text into a canonical state.
 * @param {string|null|undefined} value
 * @returns {'Normal'|'Watch'|'Alert'|'Offline'|null}
 */
export function normaliseAlert(value) {
  const v = (value || '').toLowerCase().trim();
  if (!v) return null;
  if (/^normal|ok|good|stable|clear/.test(v)) return 'Normal';
  if (/^watch|warn|caution/.test(v)) return 'Watch';
  if (/^alert|critical|high|low|alarm/.test(v)) return 'Alert';
  if (/^offline|down|lost|unknown/.test(v)) return 'Offline';
  return null;
}

/**
 * Evaluate where a reading sits against min/max thresholds.
 * @param {number|null} reading
 * @param {number|null} min
 * @param {number|null} max
 * @returns {'normal'|'low'|'high'|'unknown'}
 */
export function evaluateThreshold(reading, min, max) {
  if (reading === null) return 'unknown';
  if (min !== null && reading < min) return 'low';
  if (max !== null && reading > max) return 'high';
  return 'normal';
}

/**
 * Resolve the display state for a sensor row.
 * Explicit alert states in the sheet override threshold-inferred state.
 * @param {number|null} reading
 * @param {number|null} min
 * @param {number|null} max
 * @param {string|null|undefined} rawAlert
 * @returns {'Normal'|'Watch'|'Alert'|'Offline'}
 */
export function resolveState(reading, min, max, rawAlert) {
  const explicit = normaliseAlert(rawAlert);
  if (explicit) return explicit;

  const threshold = evaluateThreshold(reading, min, max);
  if (threshold === 'unknown') return 'Offline';
  if (threshold === 'normal') return 'Normal';
  return 'Alert';
}

/**
 * Format a sensor reading for display.
 * @param {number|null} reading
 * @param {string} unit
 * @returns {string}
 */
export function formatReading(reading, unit) {
  if (reading === null) return 'No reading';
  const rounded = Number.isInteger(reading) ? String(reading) : reading.toFixed(1);
  return unit ? `${rounded} ${unit}` : rounded;
}

/**
 * Format timestamp into a compact local string.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatTimestamp(value) {
  if (!value) return 'No timestamp';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Compute average reading over numeric values only.
 * @param {Array<{ reading: number|null }>} sensors
 * @returns {number|null}
 */
export function averageReading(sensors) {
  const nums = sensors.map(s => s.reading).filter(v => v !== null);
  if (nums.length === 0) return null;
  const total = nums.reduce((sum, v) => sum + v, 0);
  return total / nums.length;
}
