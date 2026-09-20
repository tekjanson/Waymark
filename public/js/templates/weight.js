/* ============================================================
   templates/weight.js — Weight Tracker

   Renders a weigh-in log (date + weight) as a progress view: a hero with
   latest / change / entry count, a dependency-free inline SVG sparkline, and a
   table of entries. Self-contained so it can never break the template registry.
   ============================================================ */

import { el, registerTemplate } from './shared.js';

const definition = {
  name: 'Weight Tracker',
  icon: '⚖️',
  color: '#06b6d4',
  priority: 22,

  detect(lower) {
    const hasWeight = lower.some((h) => /\b(weight|weigh-?in|body ?fat|bmi|lbs|kgs?)\b/.test(h));
    const hasDate = lower.some((h) => /\b(date|day|when|logged)\b/.test(h));
    return hasWeight && hasDate;
  },

  columns(lower) {
    return {
      date: lower.findIndex((h) => /\b(date|day|when|logged)\b/.test(h)),
      weight: lower.findIndex((h) => /\b(weight|weigh-?in|lbs|kgs?|mass)\b/.test(h)),
      unit: lower.findIndex((h) => /\bunit\b/.test(h)),
      bodyFat: lower.findIndex((h) => /\b(body ?fat|fat ?%?|bmi)\b/.test(h)),
      notes: lower.findIndex((h) => /\b(notes?|comment|remark)\b/.test(h)),
    };
  },

  render(container, rows, cols) {
    container.innerHTML = '';
    const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]) : '');

    const entries = rows
      .map((r, i) => ({
        rowIndex: i + 1,
        date: get(r, cols.date) || get(r, 0),
        weight: parseFloat(get(r, cols.weight >= 0 ? cols.weight : 1)) || 0,
        unit: get(r, cols.unit) || 'lbs',
        bodyFat: get(r, cols.bodyFat),
        notes: get(r, cols.notes),
      }))
      .filter((e) => e.weight > 0 || e.date);

    const sorted = [...entries].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const latest = sorted[sorted.length - 1] || { weight: 0, unit: 'lbs' };
    const first = sorted[0] || { weight: 0 };
    const diff = latest.weight && first.weight ? Math.round((latest.weight - first.weight) * 10) / 10 : 0;
    const diffLabel = diff === 0 ? '±0' : diff > 0 ? `+${diff}` : `${diff}`;

    container.append(
      el('div', { className: 'weight-hero', style: 'background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff;padding:20px 24px;border-radius:14px;margin-bottom:18px;' }, [
        el('h2', { style: 'margin:0 0 12px;font-size:1.4rem;font-weight:800;' }, ['⚖️ Weight Tracker']),
        el('div', { style: 'display:flex;gap:28px;flex-wrap:wrap;' }, [
          _stat(latest.weight ? String(latest.weight) : '—', `Latest (${latest.unit})`),
          _stat(diffLabel, 'Change'),
          _stat(String(sorted.length), 'Entries'),
        ]),
      ])
    );

    const spark = _sparkline(sorted.map((e) => e.weight));
    if (spark) {
      container.append(el('div', { style: 'margin:0 0 18px;border:1px solid var(--color-border);border-radius:10px;padding:10px;' }, [spark]));
    }

    const hasFat = cols.bodyFat >= 0;
    const tdStyle = 'padding:8px 10px;border-bottom:1px solid var(--color-border);';
    const tbody = el('tbody');
    (sorted.length ? sorted : entries).forEach((e) => {
      tbody.append(
        el('tr', {}, [
          el('td', { style: tdStyle }, [e.date || '—']),
          el('td', { style: tdStyle + 'font-weight:600;' }, [e.weight ? `${e.weight} ${e.unit}` : '—']),
          ...(hasFat ? [el('td', { style: tdStyle }, [e.bodyFat || '—'])] : []),
          el('td', { style: tdStyle }, [e.notes || '']),
        ])
      );
    });

    const th = (t) => el('th', { style: 'text-align:left;padding:8px 10px;border-bottom:2px solid var(--color-border);font-size:0.8rem;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;' }, [t]);
    container.append(
      el('table', { style: 'width:100%;border-collapse:collapse;' }, [
        el('thead', {}, [el('tr', {}, [th('Date'), th('Weight'), ...(hasFat ? [th('Body Fat')] : []), th('Notes')])]),
        tbody,
      ])
    );
  },
};

function _stat(value, label) {
  return el('div', {}, [
    el('div', { style: 'font-size:1.6rem;font-weight:800;line-height:1;' }, [value]),
    el('div', { style: 'font-size:0.75rem;opacity:0.9;margin-top:2px;' }, [label]),
  ]);
}

/** Dependency-free inline SVG sparkline from a numeric series (or null). */
function _sparkline(values) {
  const nums = values.filter((v) => typeof v === 'number' && v > 0);
  if (nums.length < 2) return null;
  const w = 600, h = 90, pad = 8;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const step = (w - pad * 2) / (nums.length - 1);
  const points = nums
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('style', 'width:100%;height:90px;display:block;');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#06b6d4');
  poly.setAttribute('stroke-width', '2');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  svg.appendChild(poly);
  return svg;
}

registerTemplate('weight', definition);
export default definition;
