/* ============================================================
   templates/charts.js — Pure vanilla SVG chart rendering engine
   
   Provides: drawLineChart, drawBarChart, drawPieChart
   Pure helpers: normalizeValues, polarToCartesian,
                 computePieAngles, formatAxisLabel
   
   No external dependencies. Templates access these functions
   via re-exports in shared.js.
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {string[]} Default color palette for chart series and segments */
const DEFAULT_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706',
  '#7c3aed', '#0891b2', '#be185d', '#f59e0b',
];

/* ---------- SVG element factory ---------- */

/**
 * Create a namespaced SVG element.
 * Applies string attributes directly; `style` object merges into style.
 * @param {string} tag
 * @param {Object} attrs
 * @param {(string|SVGElement)[]} [children]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'style' && typeof val === 'object') {
      Object.assign(node.style, val);
    } else {
      node.setAttribute(key, val);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(
      typeof child === 'string' ? document.createTextNode(child) : child
    );
  }
  return node;
}

/* ---------- Pure math helpers (exported for unit tests) ---------- */

/**
 * Normalize an array of numbers to a {min, max, normalized} descriptor.
 * min is clamped to 0 when all values are non-negative.
 * @param {number[]} values
 * @returns {{ normalized: number[], min: number, max: number }}
 */
export function normalizeValues(values) {
  if (!values || !values.length) return { normalized: [], min: 0, max: 0 };
  const finite = values.filter(v => typeof v === 'number' && isFinite(v));
  if (!finite.length) return { normalized: values.map(() => 0), min: 0, max: 0 };
  const rawMin = Math.min(...finite);
  const min = rawMin >= 0 ? 0 : rawMin;
  const max = Math.max(...finite);
  const range = max - min || 1;
  return {
    normalized: values.map(v => (typeof v === 'number' && isFinite(v) ? (v - min) / range : 0)),
    min,
    max,
  };
}

/**
 * Convert polar coordinates to Cartesian (0° = top, clockwise).
 * @param {number} cx  — center x
 * @param {number} cy  — center y
 * @param {number} r   — radius
 * @param {number} angleDeg — angle in degrees (0 = top, clockwise)
 * @returns {{ x: number, y: number }}
 */
export function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/**
 * Compute cumulative start/end angles (degrees, 0=top, CW) for each pie segment.
 * @param {Array<{value: number}>} segments
 * @returns {Array<{startAngle: number, endAngle: number, fraction: number}>}
 */
export function computePieAngles(segments) {
  if (!segments || !segments.length) return [];
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value || 0), 0);
  if (total === 0) return segments.map(() => ({ startAngle: 0, endAngle: 0, fraction: 0 }));
  let cursor = 0;
  return segments.map((seg) => {
    const fraction = Math.max(0, seg.value || 0) / total;
    const startAngle = cursor;
    const endAngle = cursor + fraction * 360;
    cursor = endAngle;
    return { startAngle, endAngle, fraction };
  });
}

/**
 * Format a number for axis labels: 1500 → "1.5k", 1_000_000 → "1M".
 * Integers are kept exact; decimals are trimmed to 3 significant figures.
 * @param {number} n
 * @returns {string}
 */
export function formatAxisLabel(n) {
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${+(n / 1e6).toPrecision(3)}M`;
  if (abs >= 1e3) return `${+(n / 1e3).toPrecision(3)}k`;
  if (n === Math.floor(n)) return String(n);
  return parseFloat(n.toPrecision(3)).toString();
}

/* ---------- Line Chart ---------- */

/**
 * Draw a line chart (time series) into `container`.
 * Replaces any existing content.
 *
 * @param {HTMLElement} container
 * @param {{
 *   labels: string[],
 *   series: Array<{name?: string, color?: string, values: number[]}>
 * }} data
 * @param {{
 *   width?: number,
 *   height?: number,
 *   showGrid?: boolean,
 *   showLegend?: boolean,
 *   title?: string,
 * }} [opts]
 */
export function drawLineChart(container, data, opts = {}) {
  _clearChart(container);
  container.style.position = 'relative';
  const { labels = [], series = [] } = data;
  if (!series.length || !labels.length) {
    container.appendChild(_emptyMsg());
    return;
  }

  const W = opts.width || 480;
  const H = opts.height || 240;
  const showGrid = opts.showGrid !== false;
  const showLegend = opts.showLegend !== false && series.length > 1;
  const PAD = { top: 20, right: 20, bottom: 46, left: 50 };
  const legendH = showLegend ? Math.ceil(series.length / 3) * 24 + 4 : 0;

  /* Flatten all values to compute global y range */
  const allVals = series.flatMap(s => (s.values || []).filter(v => isFinite(v)));
  const { min, max } = normalizeValues(allVals.length ? allVals : [0]);
  const yRange = (max - min) || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : plotW;

  function toX(i) {
    return PAD.left + (labels.length > 1 ? i * xStep : plotW / 2);
  }
  function toY(v) {
    return PAD.top + plotH - ((v - min) / yRange) * plotH;
  }

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H + legendH}`,
    class: 'chart-svg chart-line',
    role: 'img',
    'aria-label': opts.title || 'Line chart',
  });

  if (opts.title) svg.appendChild(svgEl('title', {}, [opts.title]));

  /* Grid lines & Y-axis labels */
  const TICKS = 5;
  if (showGrid) {
    for (let t = 0; t <= TICKS; t++) {
      const v = min + (yRange * t) / TICKS;
      const y = toY(v);
      svg.appendChild(svgEl('line', {
        x1: String(PAD.left), y1: String(y),
        x2: String(W - PAD.right), y2: String(y),
        class: 'chart-grid-line',
      }));
      svg.appendChild(svgEl('text', {
        x: String(PAD.left - 6), y: String(y + 4),
        class: 'chart-axis-label chart-axis-y',
        'text-anchor': 'end',
      }, [formatAxisLabel(v)]));
    }
  }

  /* X-axis labels */
  labels.forEach((label, i) => {
    svg.appendChild(svgEl('text', {
      x: String(toX(i).toFixed(1)),
      y: String(PAD.top + plotH + 18),
      class: 'chart-axis-label chart-axis-x',
      'text-anchor': 'middle',
    }, [label.length > 9 ? label.slice(0, 8) + '\u2026' : label]));
  });

  /* Axes */
  svg.appendChild(svgEl('line', {
    x1: String(PAD.left), y1: String(PAD.top),
    x2: String(PAD.left), y2: String(PAD.top + plotH),
    class: 'chart-axis',
  }));
  svg.appendChild(svgEl('line', {
    x1: String(PAD.left), y1: String(PAD.top + plotH),
    x2: String(W - PAD.right), y2: String(PAD.top + plotH),
    class: 'chart-axis',
  }));

  /* Series paths & dots */
  const dotTooltipItems = [];
  series.forEach((s, si) => {
    const color = s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length];
    const vals = s.values || [];
    const pts = vals.map((v, i) => ({ x: toX(i), y: toY(v), v, label: labels[i] || '' }));

    /* Line path — skip to next valid point on NaN */
    const dParts = [];
    pts.forEach((p, i) => {
      if (!isFinite(p.v)) return;
      dParts.push(`${i === 0 || !isFinite(vals[i - 1]) ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    });
    if (dParts.length > 0) {
      svg.appendChild(svgEl('path', {
        d: dParts.join(' '),
        class: 'chart-line-path',
        stroke: color,
        fill: 'none',
      }));
    }

    /* Dots */
    pts.forEach((p) => {
      if (!isFinite(p.v)) return;
      const dot = svgEl('circle', {
        cx: String(p.x.toFixed(1)),
        cy: String(p.y.toFixed(1)),
        r: '4',
        class: 'chart-dot',
        fill: color,
      });
      const seriesLabel = s.name ? `${s.name} — ${p.label}: ${p.v}` : `${p.label}: ${p.v}`;
      dotTooltipItems.push({ el: dot, label: seriesLabel });
      svg.appendChild(dot);
    });
  });

  /* Legend */
  if (showLegend) {
    const perRow = 3;
    series.forEach((s, si) => {
      const color = s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length];
      const col = si % perRow;
      const row = Math.floor(si / perRow);
      const lx = PAD.left + col * Math.floor((W - PAD.left - PAD.right) / perRow);
      const ly = H + 4 + row * 24;
      svg.appendChild(svgEl('rect', {
        x: String(lx), y: String(ly),
        width: '12', height: '12',
        fill: color, rx: '2',
      }));
      svg.appendChild(svgEl('text', {
        x: String(lx + 16), y: String(ly + 10),
        class: 'chart-legend-label',
      }, [s.name || `Series ${si + 1}`]));
    });
  }

  container.appendChild(svg);
  _attachHoverTooltip(container, dotTooltipItems);
}

/* ---------- Bar Chart ---------- */

/**
 * Draw a bar chart (comparisons) into `container`.
 * Replaces any existing content.
 *
 * @param {HTMLElement} container
 * @param {{
 *   labels: string[],
 *   values: number[],
 *   colors?: string[],
 *   color?: string,
 * }} data
 * @param {{
 *   width?: number,
 *   height?: number,
 *   showGrid?: boolean,
 *   showValues?: boolean,
 *   title?: string,
 * }} [opts]
 */
export function drawBarChart(container, data, opts = {}) {
  _clearChart(container);
  container.style.position = 'relative';
  const { labels = [], values = [] } = data;
  if (!values.length || !labels.length) {
    container.appendChild(_emptyMsg());
    return;
  }

  const W = opts.width || 480;
  const H = opts.height || 240;
  const showGrid = opts.showGrid !== false;
  const showValues = opts.showValues !== false;
  const PAD = { top: showValues ? 28 : 20, right: 20, bottom: 52, left: 50 };

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const { min, max } = normalizeValues(values);
  const yRange = (max - min) || 1;

  const barSpacing = plotW / labels.length;
  const barGap = 0.18;
  const barW = barSpacing * (1 - barGap);

  function toY(v) {
    return PAD.top + plotH - ((v - min) / yRange) * plotH;
  }
  function barHeight(v) {
    return Math.max(1, (PAD.top + plotH) - toY(v));
  }

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart-svg chart-bar',
    role: 'img',
    'aria-label': opts.title || 'Bar chart',
  });

  if (opts.title) svg.appendChild(svgEl('title', {}, [opts.title]));

  /* Grid + Y labels */
  const TICKS = 5;
  if (showGrid) {
    for (let t = 0; t <= TICKS; t++) {
      const v = min + (yRange * t) / TICKS;
      const y = toY(v);
      svg.appendChild(svgEl('line', {
        x1: String(PAD.left), y1: String(y),
        x2: String(W - PAD.right), y2: String(y),
        class: 'chart-grid-line',
      }));
      svg.appendChild(svgEl('text', {
        x: String(PAD.left - 6), y: String(y + 4),
        class: 'chart-axis-label chart-axis-y',
        'text-anchor': 'end',
      }, [formatAxisLabel(v)]));
    }
  }

  /* Axes */
  svg.appendChild(svgEl('line', {
    x1: String(PAD.left), y1: String(PAD.top),
    x2: String(PAD.left), y2: String(PAD.top + plotH),
    class: 'chart-axis',
  }));
  svg.appendChild(svgEl('line', {
    x1: String(PAD.left), y1: String(PAD.top + plotH),
    x2: String(W - PAD.right), y2: String(PAD.top + plotH),
    class: 'chart-axis',
  }));

  /* Bars */
  const barTooltipItems = [];
  values.forEach((v, i) => {
    const color = (data.colors && data.colors[i]) || data.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    const barX = PAD.left + i * barSpacing + (barSpacing - barW) / 2;
    const barY = toY(v);
    const bH = barHeight(v);

    const rect = svgEl('rect', {
      x: String(barX.toFixed(1)),
      y: String(barY.toFixed(1)),
      width: String(barW.toFixed(1)),
      height: String(bH.toFixed(1)),
      fill: color,
      class: 'chart-bar-rect',
      rx: '3',
    });
    barTooltipItems.push({ el: rect, label: `${labels[i]}: ${formatAxisLabel(v)}` });
    svg.appendChild(rect);

    /* X label */
    const lbl = labels[i] || '';
    svg.appendChild(svgEl('text', {
      x: String((barX + barW / 2).toFixed(1)),
      y: String(PAD.top + plotH + 16),
      class: 'chart-axis-label chart-axis-x',
      'text-anchor': 'middle',
    }, [lbl.length > 9 ? lbl.slice(0, 8) + '\u2026' : lbl]));

    /* Value label above bar */
    if (showValues) {
      svg.appendChild(svgEl('text', {
        x: String((barX + barW / 2).toFixed(1)),
        y: String(Math.max(PAD.top - 4, barY - 4)),
        class: 'chart-bar-value',
        'text-anchor': 'middle',
      }, [formatAxisLabel(v)]));
    }
  });

  container.appendChild(svg);
  _attachHoverTooltip(container, barTooltipItems);
}

/* ---------- Pie / Donut Chart ---------- */

/**
 * Draw a pie or donut chart (distributions) into `container`.
 * Replaces any existing content.
 *
 * @param {HTMLElement} container
 * @param {{
 *   segments: Array<{label: string, value: number, color?: string}>
 * }} data
 * @param {{
 *   width?: number,
 *   height?: number,
 *   donut?: boolean,
 *   showLegend?: boolean,
 *   title?: string,
 * }} [opts]
 */
export function drawPieChart(container, data, opts = {}) {
  _clearChart(container);
  container.style.position = 'relative';
  const { segments = [] } = data;
  const nonZero = segments.filter(s => s.value > 0);
  if (!nonZero.length) {
    container.appendChild(_emptyMsg());
    return;
  }

  /* Legend is rendered as HTML — viewBox only needs the chart area */
  const W = opts.width || 360;
  const H = opts.height || 220;
  const isDonut = !!opts.donut;
  const showLegend = opts.showLegend !== false;

  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(cx, cy) - 16;
  const innerR = isDonut ? r * 0.52 : 0;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: `chart-svg chart-pie${isDonut ? ' chart-donut' : ''}`,
    role: 'img',
    'aria-label': opts.title || (isDonut ? 'Donut chart' : 'Pie chart'),
  });

  if (opts.title) svg.appendChild(svgEl('title', {}, [opts.title]));

  const total = nonZero.reduce((s, seg) => s + seg.value, 0);
  const angles = computePieAngles(nonZero);
  const pieTooltipItems = [];

  angles.forEach((ang, i) => {
    const seg = nonZero[i];
    const color = seg.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];

    if (ang.fraction >= 1) {
      /* Full circle — arc path degenerates; use circle element */
      const circle = svgEl('circle', {
        cx: String(cx), cy: String(cy), r: String(r),
        fill: color, class: 'chart-pie-slice',
      });
      pieTooltipItems.push({ el: circle, label: `${seg.label}: ${formatAxisLabel(seg.value)} (100%)` });
      svg.appendChild(circle);
      if (isDonut) {
        svg.appendChild(svgEl('circle', {
          cx: String(cx), cy: String(cy), r: String(innerR),
          class: 'chart-donut-hole',
        }));
      }
    } else {
      const start = polarToCartesian(cx, cy, r, ang.startAngle);
      const end = polarToCartesian(cx, cy, r, ang.endAngle);
      const largeArc = ang.endAngle - ang.startAngle > 180 ? 1 : 0;

      let d;
      if (isDonut) {
        const iStart = polarToCartesian(cx, cy, innerR, ang.endAngle);
        const iEnd = polarToCartesian(cx, cy, innerR, ang.startAngle);
        d = [
          `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
          `A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
          `L ${iStart.x.toFixed(2)} ${iStart.y.toFixed(2)}`,
          `A ${innerR} ${innerR} 0 ${largeArc} 0 ${iEnd.x.toFixed(2)} ${iEnd.y.toFixed(2)}`,
          'Z',
        ].join(' ');
      } else {
        d = [
          `M ${cx} ${cy}`,
          `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
          `A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
          'Z',
        ].join(' ');
      }

      const path = svgEl('path', { d, fill: color, class: 'chart-pie-slice' });
      const pct = Math.round(ang.fraction * 100);
      pieTooltipItems.push({ el: path, label: `${seg.label}: ${formatAxisLabel(seg.value)} (${pct}%)` });
      svg.appendChild(path);
    }
  });

  /* Donut centre — show total amount only (title would overflow small hole) */
  if (isDonut) {
    svg.appendChild(svgEl('text', {
      x: String(cx), y: String(cy + 7),
      class: 'chart-donut-center-total',
      'text-anchor': 'middle',
    }, [formatAxisLabel(total)]));
  }

  container.appendChild(svg);
  _attachHoverTooltip(container, pieTooltipItems);

  /* Legend rendered as HTML for crisp typography */
  if (showLegend) {
    const legendDiv = document.createElement('div');
    legendDiv.className = 'chart-html-legend';
    nonZero.forEach((seg, i) => {
      const ang = angles[i];
      const pct = Math.round(ang.fraction * 100);
      const color = seg.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      const item = document.createElement('div');
      item.className = 'chart-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'chart-legend-swatch';
      swatch.style.background = color;
      const label = document.createElement('span');
      label.className = 'chart-legend-label';
      label.textContent = `${seg.label} (${pct}%)`;
      item.appendChild(swatch);
      item.appendChild(label);
      legendDiv.appendChild(item);
    });
    container.appendChild(legendDiv);
  }
}

/* ---------- Private helpers ---------- */

function _emptyMsg() {
  const span = document.createElement('span');
  span.className = 'chart-empty';
  span.textContent = 'No data';
  return span;
}

/**
 * Clear previous chart SVG, tooltip, and HTML legend from container.
 * Preserves non-chart children (e.g. title divs placed before chart).
 * @param {HTMLElement} container
 */
function _clearChart(container) {
  const prevSvg = container.querySelector('svg.chart-svg');
  if (prevSvg) prevSvg.remove();
  const prevTip = container.querySelector('.chart-tooltip');
  if (prevTip) prevTip.remove();
  const prevLegend = container.querySelector('.chart-html-legend');
  if (prevLegend) prevLegend.remove();
  const prevEmpty = container.querySelector('.chart-empty');
  if (prevEmpty) prevEmpty.remove();
}

/**
 * Attach a visible floating tooltip to interactive SVG elements.
 * Creates a `.chart-tooltip` div inside container (position: relative required).
 * @param {HTMLElement} container — wrapper with position:relative
 * @param {Array<{el: SVGElement, label: string}>} items
 */
function _attachHoverTooltip(container, items) {
  if (!items.length) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  container.appendChild(tip);
  items.forEach(({ el: svgNode, label }) => {
    svgNode.addEventListener('mouseenter', (e) => {
      tip.textContent = label;
      tip.classList.add('chart-tooltip-show');
      _moveTip(tip, e, container);
    });
    svgNode.addEventListener('mousemove', (e) => _moveTip(tip, e, container));
    svgNode.addEventListener('mouseleave', () => tip.classList.remove('chart-tooltip-show'));
  });
}

/**
 * Reposition tooltip near the mouse cursor within its container.
 * @param {HTMLElement} tip
 * @param {MouseEvent} e
 * @param {HTMLElement} container
 */
function _moveTip(tip, e, container) {
  const r = container.getBoundingClientRect();
  const x = e.clientX - r.left + 12;
  const y = e.clientY - r.top - 36;
  tip.style.left = `${Math.min(x, Math.max(0, container.offsetWidth - 160))}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}
