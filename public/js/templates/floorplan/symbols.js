/* ============================================================
   floorplan/symbols.js — Top-down architectural symbol library

   Draws furniture, appliances, and fixtures the way they appear
   on a real floor plan (viewed from above) rather than as emoji.
   Every symbol is drawn centered on (0,0) inside a width×height
   bounding box so the caller can freely translate / rotate / flip
   it with a single SVG transform.
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* World scale: how many SVG units represent one real-world foot.
   10 units = 1 ft keeps the snap grid (10u) on clean 1-ft steps and
   the major grid lines (40u) on tidy 4-ft intervals. */
export const UNITS_PER_FOOT = 10;

const STROKE = '#334155';
const STROKE_SOFT = '#64748b';
const FILL = '#ffffff';
const ACCENT = '#e2e8f0';
const EL = '#15803d';   // electrical accent (green)
const PL = '#1d4ed8';   // plumbing accent (blue)

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') node.setAttribute('class', val);
    else node.setAttribute(key, val);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/* ---------- Dimension formatting ---------- */

/** Convert SVG units to a human-friendly feet/inches string.
 * @param {number} units — length in SVG units
 * @returns {string} e.g. `12' 6"` or `8"`
 */
export function formatFeet(units) {
  const totalInches = Math.round((Math.abs(units) / UNITS_PER_FOOT) * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet <= 0) return `${inches}"`;
  if (inches === 0) return `${feet}'`;
  return `${feet}' ${inches}"`;
}

/* ---------- Primitive builders (centered coordinate space) ---------- */

const rect = (w, h, opts = {}) => svgEl('rect', {
  x: -w / 2,
  y: -h / 2,
  width: w,
  height: h,
  rx: opts.rx ?? 0,
  fill: opts.fill ?? FILL,
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.5,
});

const box = (x, y, w, h, opts = {}) => svgEl('rect', {
  x, y, width: w, height: h,
  rx: opts.rx ?? 0,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const circle = (cx, cy, r, opts = {}) => svgEl('circle', {
  cx, cy, r,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const ellipse = (cx, cy, rx, ry, opts = {}) => svgEl('ellipse', {
  cx, cy, rx, ry,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const line = (x1, y1, x2, y2, opts = {}) => svgEl('line', {
  x1, y1, x2, y2,
  stroke: opts.stroke ?? STROKE_SOFT,
  'stroke-width': opts.sw ?? 1,
  'stroke-linecap': 'round',
});

const path = (d, opts = {}) => svgEl('path', {
  d,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
  'stroke-linecap': 'round',
});

/* ---------- Symbol drawings (top-down) ----------
   Each builder receives (w, h) in units and returns an array of
   SVG nodes drawn around the origin. "Up" (−y) is the canonical
   front/approach side for directional pieces. */

const SYMBOL_DRAWERS = {
  couch(w, h) {
    const back = h * 0.26;
    return [
      rect(w, h, { rx: 6, fill: '#f1f5f9' }),
      // backrest along the bottom edge
      box(-w / 2, h / 2 - back, w, back, { fill: ACCENT, rx: 3 }),
      // armrests
      box(-w / 2, -h / 2, w * 0.14, h, { fill: ACCENT, rx: 3 }),
      box(w / 2 - w * 0.14, -h / 2, w * 0.14, h, { fill: ACCENT, rx: 3 }),
      // seat cushions
      line(-w / 6, -h / 2 + h * 0.12, -w / 6, h / 2 - back),
      line(w / 6, -h / 2 + h * 0.12, w / 6, h / 2 - back),
    ];
  },
  chair(w, h) {
    return [
      rect(w * 0.8, h * 0.8, { rx: 3, fill: '#f1f5f9' }),
      box(-w / 2, h * 0.12, w, h * 0.18, { fill: ACCENT, rx: 2 }),
    ];
  },
  'dining-table'(w, h) {
    const tw = w * 0.62;
    const th = h * 0.58;
    const nodes = [ellipse(0, 0, tw / 2, th / 2, { fill: '#f8fafc' })];
    const seats = [
      [0, -h / 2 + h * 0.08], [0, h / 2 - h * 0.08],
      [-tw / 2 - w * 0.06, 0], [tw / 2 + w * 0.06, 0],
      [-tw / 3, -th / 2 - h * 0.02], [tw / 3, -th / 2 - h * 0.02],
      [-tw / 3, th / 2 + h * 0.02], [tw / 3, th / 2 + h * 0.02],
    ];
    seats.forEach(([cx, cy]) => nodes.push(svgEl('rect', {
      x: cx - w * 0.07, y: cy - h * 0.055, width: w * 0.14, height: h * 0.11,
      rx: 2, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1,
    })));
    return nodes;
  },
  'dining-table-rect'(w, h) {
    // Rectangular tabletop with top-down chairs along every edge. The chair
    // count scales with the parametric width/length so a longer table seats
    // more people automatically.
    const nodes = [
      rect(w, h, { rx: 3, fill: '#f8fafc' }),
      rect(Math.max(4, w - 8), Math.max(4, h - 8), { rx: 2, stroke: STROKE_SOFT }),
    ];
    const chair = (cx, cy, cw, ch) => svgEl('rect', {
      x: cx - cw / 2, y: cy - ch / 2, width: cw, height: ch,
      rx: 2, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1,
    });
    const seatRun = 14;          // ~1.4 ft of edge per chair
    const depth = Math.min(10, Math.max(6, h * 0.3));
    const perLong = Math.max(1, Math.floor((w - 4) / seatRun));
    const perShort = h >= 28 ? Math.max(1, Math.floor((h - 4) / seatRun)) : 0;
    for (let i = 0; i < perLong; i += 1) {
      const cx = -w / 2 + (w / perLong) * (i + 0.5);
      const cw = Math.min(seatRun - 3, (w / perLong) - 3);
      nodes.push(chair(cx, -h / 2 - depth / 2 - 1.5, cw, depth));
      nodes.push(chair(cx, h / 2 + depth / 2 + 1.5, cw, depth));
    }
    for (let i = 0; i < perShort; i += 1) {
      const cy = -h / 2 + (h / perShort) * (i + 0.5);
      const ch = Math.min(seatRun - 3, (h / perShort) - 3);
      nodes.push(chair(-w / 2 - depth / 2 - 1.5, cy, depth, ch));
      nodes.push(chair(w / 2 + depth / 2 + 1.5, cy, depth, ch));
    }
    return nodes;
  },
  'coffee-table'(w, h) {
    return [rect(w, h, { rx: 5, fill: '#f8fafc' }), rect(w * 0.7, h * 0.7, { rx: 3, stroke: STROKE_SOFT })];
  },
  bed(w, h) {
    const pillow = h * 0.16;
    return [
      rect(w, h, { rx: 4, fill: '#f8fafc' }),
      // blanket foot line
      line(-w / 2, h / 2 - h * 0.34, w / 2, h / 2 - h * 0.34),
      // pillows at the head (top)
      svgEl('rect', { x: -w / 2 + w * 0.08, y: -h / 2 + h * 0.05, width: w * 0.36, height: pillow, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
      svgEl('rect', { x: w * 0.06 - w * 0.02, y: -h / 2 + h * 0.05, width: w * 0.36, height: pillow, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
    ];
  },
  nightstand(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), line(-w / 2, -h * 0.1, w / 2, -h * 0.1), circle(0, h * 0.18, 1.3, { fill: STROKE_SOFT })];
  },
  dresser(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      line(0, -h / 2, 0, h / 2),
      circle(-w * 0.25, 0, 1.3, { fill: STROKE_SOFT }),
      circle(w * 0.25, 0, 1.3, { fill: STROKE_SOFT }),
    ];
  },
  desk(w, h) {
    return [
      box(-w / 2, -h / 2, w, h * 0.62, { fill: '#f8fafc', rx: 2 }),
      // chair tucked at the bottom
      svgEl('rect', { x: -w * 0.13, y: h * 0.07, width: w * 0.26, height: h * 0.3, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
    ];
  },
  bookshelf(w, h) {
    const nodes = [rect(w, h, { rx: 1, fill: '#f8fafc' })];
    for (let i = 1; i < 4; i += 1) nodes.push(line(-w / 2, -h / 2 + (h * i) / 4, w / 2, -h / 2 + (h * i) / 4, { stroke: STROKE_SOFT }));
    return nodes;
  },
  tv(w, h) {
    return [rect(w, h, { rx: 1, fill: '#1e293b', stroke: '#0f172a' }), line(-w * 0.2, h / 2 + 1.5, w * 0.2, h / 2 + 1.5, { stroke: STROKE, sw: 2 })];
  },
  fridge(w, h) {
    return [rect(w, h, { rx: 3, fill: '#f8fafc' }), line(-w / 2, -h * 0.18, w / 2, -h * 0.18), line(w * 0.28, -h * 0.4, w * 0.28, -h * 0.26, { stroke: STROKE, sw: 2 }), line(w * 0.28, h * 0.05, w * 0.28, h * 0.3, { stroke: STROKE, sw: 2 })];
  },
  stove(w, h) {
    const r = Math.min(w, h) * 0.17;
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      circle(-w * 0.22, -h * 0.22, r), circle(w * 0.22, -h * 0.22, r),
      circle(-w * 0.22, h * 0.22, r), circle(w * 0.22, h * 0.22, r),
    ];
  },
  oven(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w * 0.34, -h * 0.3, w * 0.68, h * 0.6, { stroke: STROKE_SOFT, rx: 2 }), line(-w * 0.18, -h * 0.38, w * 0.18, -h * 0.38, { stroke: STROKE, sw: 2 })];
  },
  microwave(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w / 2 + 1.5, -h / 2 + 1.5, w * 0.62, h - 3, { stroke: STROKE_SOFT, rx: 1 }), circle(w * 0.34, 0, 1.3, { fill: STROKE_SOFT })];
  },
  dishwasher(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w * 0.34, -h * 0.34, w * 0.68, h * 0.68, { stroke: STROKE_SOFT, rx: 1 }), line(-w * 0.18, -h * 0.42, w * 0.18, -h * 0.42, { stroke: STROKE, sw: 2 })];
  },
  sink(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      box(-w * 0.36, -h * 0.3, w * 0.72, h * 0.6, { stroke: STROKE_SOFT, rx: 4, fill: '#eef2f9' }),
      circle(0, 0, Math.min(w, h) * 0.08, { fill: STROKE_SOFT }),
      circle(0, -h * 0.4, Math.min(w, h) * 0.08),
    ];
  },
  toilet(w, h) {
    return [
      // tank at the top
      box(-w * 0.34, -h / 2, w * 0.68, h * 0.24, { fill: '#f8fafc', rx: 2 }),
      // bowl
      ellipse(0, h * 0.12, w * 0.38, h * 0.32, { fill: '#f8fafc' }),
      ellipse(0, h * 0.12, w * 0.24, h * 0.2, { stroke: STROKE_SOFT }),
    ];
  },
  shower(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#eef2f9' }),
      line(-w / 2, -h / 2, w / 2, h / 2, { stroke: STROKE_SOFT }),
      line(w / 2, -h / 2, -w / 2, h / 2, { stroke: STROKE_SOFT }),
      circle(0, 0, Math.min(w, h) * 0.1, { fill: FILL }),
    ];
  },
  bathtub(w, h) {
    return [
      rect(w, h, { rx: 4, fill: '#f8fafc' }),
      box(-w * 0.4, -h * 0.34, w * 0.66, h * 0.68, { stroke: STROKE_SOFT, rx: 10, fill: '#eef2f9' }),
      circle(w * 0.3, 0, Math.min(w, h) * 0.08),
    ];
  },
  washer(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), circle(0, 0, Math.min(w, h) * 0.32), circle(0, 0, Math.min(w, h) * 0.12, { stroke: STROKE_SOFT })];
  },
  dryer(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), circle(0, 0, Math.min(w, h) * 0.32), circle(0, 0, Math.min(w, h) * 0.12, { stroke: STROKE_SOFT })];
  },
  lamp(w, h) {
    const r = Math.min(w, h) / 2;
    return [circle(0, 0, r * 0.92, { fill: '#fef9c3' }), circle(0, 0, r * 0.4, { fill: '#fde68a', stroke: STROKE_SOFT }), circle(0, 0, 1.3, { fill: STROKE })];
  },
  plant(w, h) {
    const r = Math.min(w, h) / 2;
    return [
      circle(0, 0, r * 0.95, { fill: '#dcfce7', stroke: '#16a34a' }),
      circle(0, 0, r * 0.5, { fill: '#bbf7d0', stroke: '#16a34a' }),
      circle(0, 0, 1.4, { fill: '#15803d' }),
    ];
  },
  trash(w, h) {
    return [rect(w * 0.8, h * 0.9, { rx: 3, fill: '#f1f5f9' }), line(-w * 0.3, -h * 0.28, w * 0.3, -h * 0.28, { stroke: STROKE_SOFT })];
  },
  cabinet(w, h) {
    // upper cabinet convention: rectangle crossed with an X
    return [rect(w, h, { rx: 1, fill: '#f8fafc', stroke: STROKE_SOFT }), line(-w / 2, -h / 2, w / 2, h / 2, { stroke: STROKE_SOFT }), line(w / 2, -h / 2, -w / 2, h / 2, { stroke: STROKE_SOFT })];
  },
  island(w, h) {
    return [rect(w, h, { rx: 4, fill: '#f8fafc' }), rect(w * 0.9, h * 0.78, { rx: 3, stroke: STROKE_SOFT })];
  },
  rug(w, h) {
    return [
      svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3, fill: '#faf5ff', stroke: '#a855f7', 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }),
      rect(w * 0.82, h * 0.72, { rx: 2, stroke: '#c084fc' }),
    ];
  },
  ac(w, h) {
    const nodes = [rect(w, h, { rx: 2, fill: '#eff6ff' })];
    for (let i = 1; i < 5; i += 1) nodes.push(line(-w / 2 + (w * i) / 5, -h / 2 + 1.5, -w / 2 + (w * i) / 5, h / 2 - 1.5, { stroke: '#60a5fa' }));
    return nodes;
  },
  'water-heater'(w, h) {
    const r = Math.min(w, h) / 2;
    return [circle(0, 0, r * 0.95, { fill: '#f8fafc' }), circle(0, 0, r * 0.5, { stroke: STROKE_SOFT }), circle(0, 0, 1.4, { fill: STROKE_SOFT })];
  },
  stairs(w, h) {
    const nodes = [rect(w, h, { rx: 1, fill: '#f8fafc' })];
    const treads = 6;
    for (let i = 1; i < treads; i += 1) nodes.push(line(-w / 2 + (w * i) / treads, -h / 2, -w / 2 + (w * i) / treads, h / 2, { stroke: STROKE_SOFT }));
    // up-direction arrow
    nodes.push(line(-w / 2 + w * 0.1, 0, w / 2 - w * 0.1, 0, { stroke: STROKE, sw: 1.4 }));
    nodes.push(path(`M ${w / 2 - w * 0.1} 0 L ${w / 2 - w * 0.22} ${-h * 0.14} M ${w / 2 - w * 0.1} 0 L ${w / 2 - w * 0.22} ${h * 0.14}`, { stroke: STROKE, sw: 1.4 }));
    return nodes;
  },

  /* ---------- More furniture ---------- */
  armchair(w, h) {
    const back = h * 0.24;
    return [
      rect(w, h, { rx: 6, fill: '#f1f5f9' }),
      box(-w / 2, h / 2 - back, w, back, { fill: ACCENT, rx: 3 }),
      box(-w / 2, -h / 2, w * 0.2, h, { fill: ACCENT, rx: 3 }),
      box(w / 2 - w * 0.2, -h / 2, w * 0.2, h, { fill: ACCENT, rx: 3 }),
    ];
  },
  sectional(w, h) {
    const t = Math.min(w, h) * 0.42;
    return [
      box(-w / 2, -h / 2, w, t, { fill: '#f1f5f9', rx: 5, stroke: STROKE }),
      box(-w / 2, -h / 2, t, h, { fill: '#f1f5f9', rx: 5, stroke: STROKE }),
      box(-w / 2, -h / 2 + t - 2, w, 3, { fill: ACCENT }),
    ];
  },
  ottoman(w, h) {
    return [rect(w, h, { rx: 6, fill: '#f1f5f9' }), rect(w * 0.7, h * 0.7, { rx: 4, stroke: STROKE_SOFT })];
  },
  'tv-stand'(w, h) {
    return [rect(w, h, { rx: 1, fill: '#f8fafc' }), line(-w / 2, 0, w / 2, 0, { stroke: STROKE_SOFT })];
  },
  console(w, h) {
    return [rect(w, h, { rx: 1, fill: '#f8fafc' }), line(0, -h / 2, 0, h / 2, { stroke: STROKE_SOFT })];
  },
  fireplace(w, h) {
    return [
      rect(w, h, { fill: '#f1f5f9' }),
      box(-w / 2, -h / 2, w, h * 0.3, { fill: '#e2e8f0' }),
      path(`M ${-w * 0.3} ${h / 2} A ${w * 0.3} ${h * 0.5} 0 0 1 ${w * 0.3} ${h / 2} Z`, { stroke: STROKE, fill: '#fde68a' }),
    ];
  },
  vanity(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), ellipse(0, 0, w * 0.18, h * 0.3, { stroke: STROKE_SOFT, fill: '#eef2f9' }), circle(0, -h * 0.32, 1.4, { stroke: STROKE_SOFT })];
  },
  mirror(w, h) {
    return [rect(w, h, { rx: 2, fill: '#e0f2fe', stroke: '#0ea5e9' }), line(-w / 2 + 2, h / 2 - 2, w / 2 - 2, -h / 2 + 2, { stroke: '#bae6fd' })];
  },
  crib(w, h) {
    const nodes = [rect(w, h, { rx: 3, fill: '#f8fafc' })];
    for (let i = 1; i < 5; i += 1) nodes.push(line(-w / 2 + (w * i) / 5, -h / 2, -w / 2 + (w * i) / 5, h / 2, { stroke: STROKE_SOFT, sw: 0.8 }));
    return nodes;
  },
  wardrobe(w, h) {
    return [rect(w, h, { rx: 1, fill: '#f8fafc' }), line(0, -h / 2, 0, h / 2, { stroke: STROKE_SOFT }), circle(-w * 0.08, 0, 1.2, { fill: STROKE_SOFT }), circle(w * 0.08, 0, 1.2, { fill: STROKE_SOFT })];
  },
  closet(w, h) {
    const nodes = [rect(w, h, { rx: 1, fill: '#f8fafc' }), line(-w / 2, -h * 0.18, w / 2, -h * 0.18, { stroke: STROKE_SOFT })];
    for (let i = 1; i < 5; i += 1) nodes.push(line(-w / 2 + (w * i) / 5, -h * 0.18, -w / 2 + (w * i) / 5, h / 2, { stroke: STROKE_SOFT, sw: 0.7 }));
    return nodes;
  },
  piano(w, h) {
    return [
      box(-w / 2, -h / 2, w, h * 0.46, { rx: 2, fill: '#1e293b', stroke: '#0f172a' }),
      path(`M ${-w / 2} ${-h / 2 + h * 0.46} Q ${w * 0.1} ${h / 2} ${w / 2} ${h * 0.1} L ${w / 2} ${-h / 2 + h * 0.46} Z`, { fill: '#334155', stroke: '#0f172a' }),
    ];
  },
  'pool-table'(w, h) {
    const nodes = [rect(w, h, { rx: 4, fill: '#15803d', stroke: '#14532d' })];
    [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2], [0, -h / 2], [0, h / 2]].forEach(([cx, cy]) => nodes.push(circle(cx, cy, 2, { fill: '#0f172a', stroke: '#0f172a' })));
    return nodes;
  },
  grill(w, h) {
    const nodes = [svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 8, fill: '#334155', stroke: '#1e293b', 'stroke-width': 1.5 })];
    for (let i = 1; i < 4; i += 1) nodes.push(line(-w / 2 + 3, -h / 2 + (h * i) / 4, w / 2 - 3, -h / 2 + (h * i) / 4, { stroke: '#94a3b8' }));
    return nodes;
  },
  car(w, h) {
    return [
      svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: h * 0.28, fill: '#e2e8f0', stroke: STROKE, 'stroke-width': 1.5 }),
      rect(w * 0.5, h * 0.52, { rx: 4, fill: '#cbd5e1', stroke: STROKE_SOFT }),
    ];
  },
  column(w, h) {
    const r = Math.min(w, h) / 2;
    return [circle(0, 0, r * 0.9, { fill: '#cbd5e1', stroke: STROKE }), circle(0, 0, r * 0.5, { stroke: STROKE_SOFT })];
  },
  treadmill(w, h) {
    const nodes = [rect(w, h, { rx: 3, fill: '#f1f5f9' }), box(-w / 2, -h / 2, w, h * 0.3, { fill: '#cbd5e1', rx: 2 })];
    for (let i = 1; i < 6; i += 1) nodes.push(line(-w / 2 + 2, -h / 2 + h * 0.3 + (h * 0.7 * i) / 6, w / 2 - 2, -h / 2 + h * 0.3 + (h * 0.7 * i) / 6, { stroke: STROKE_SOFT, sw: 0.6 }));
    return nodes;
  },

  /* ---------- Electrical (green accent) ---------- */
  outlet(w, h) {
    const r = Math.min(w, h) * 0.46;
    return [circle(0, 0, r, { stroke: EL, fill: '#ffffff' }), line(-r * 0.35, -r * 0.4, -r * 0.35, r * 0.4, { stroke: EL }), line(r * 0.35, -r * 0.4, r * 0.35, r * 0.4, { stroke: EL }), line(0, r, 0, r + 4, { stroke: EL })];
  },
  'outlet-gfci'(w, h) {
    const r = Math.min(w, h) * 0.46;
    return [circle(0, 0, r, { stroke: EL, fill: '#ffffff' }), line(-r * 0.35, -r * 0.4, -r * 0.35, r * 0.4, { stroke: EL }), line(r * 0.35, -r * 0.4, r * 0.35, r * 0.4, { stroke: EL }), circle(0, 0, 1.4, { fill: EL, stroke: EL })];
  },
  'outlet-quad'(w, h) {
    const r = Math.min(w, h) * 0.3;
    return [circle(-w * 0.2, 0, r, { stroke: EL, fill: '#ffffff' }), circle(w * 0.2, 0, r, { stroke: EL, fill: '#ffffff' }), line(0, r, 0, r + 4, { stroke: EL })];
  },
  switch(w, h) {
    const r = Math.min(w, h) * 0.14;
    return [circle(-w * 0.22, h * 0.22, r, { fill: EL, stroke: EL }), line(-w * 0.22, h * 0.22, w * 0.26, -h * 0.26, { stroke: EL, sw: 1.6 })];
  },
  'switch-3way'(w, h) {
    const r = Math.min(w, h) * 0.14;
    return [circle(-w * 0.22, h * 0.22, r, { fill: EL, stroke: EL }), line(-w * 0.22, h * 0.22, w * 0.26, -h * 0.26, { stroke: EL, sw: 1.6 }), line(-w * 0.22, h * 0.22, w * 0.28, -h * 0.02, { stroke: EL })];
  },
  dimmer(w, h) {
    const r = Math.min(w, h) * 0.14;
    return [circle(-w * 0.22, h * 0.22, r, { fill: EL, stroke: EL }), line(-w * 0.22, h * 0.22, w * 0.26, -h * 0.26, { stroke: EL, sw: 1.6 }), line(w * 0.05, -h * 0.32, w * 0.3, -h * 0.08, { stroke: EL })];
  },
  'light-ceiling'(w, h) {
    const r = Math.min(w, h) * 0.44;
    return [circle(0, 0, r, { stroke: EL, fill: '#fffbeb' }), line(-r, 0, r, 0, { stroke: EL }), line(0, -r, 0, r, { stroke: EL })];
  },
  'light-recessed'(w, h) {
    const r = Math.min(w, h) * 0.44;
    return [circle(0, 0, r, { stroke: EL, fill: '#fffbeb' }), line(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7, { stroke: EL }), line(r * 0.7, -r * 0.7, -r * 0.7, r * 0.7, { stroke: EL })];
  },
  'pendant-light'(w, h) {
    const r = Math.min(w, h) * 0.3;
    return [line(0, -h * 0.5, 0, -r, { stroke: EL }), circle(0, r * 0.2, r, { stroke: EL, fill: '#fffbeb' })];
  },
  chandelier(w, h) {
    const nodes = [circle(0, 0, Math.min(w, h) * 0.14, { stroke: EL, fill: '#fffbeb' })];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const ex = Math.cos(a) * w * 0.4;
      const ey = Math.sin(a) * h * 0.4;
      nodes.push(line(0, 0, ex, ey, { stroke: EL }));
      nodes.push(circle(ex, ey, 1.6, { fill: EL, stroke: EL }));
    }
    return nodes;
  },
  'ceiling-fan'(w, h) {
    const nodes = [circle(0, 0, Math.min(w, h) * 0.12, { fill: EL, stroke: EL })];
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      nodes.push(ellipse(Math.cos(a) * w * 0.28, Math.sin(a) * h * 0.28, w * 0.16, h * 0.07, { stroke: EL, fill: '#ecfdf5' }));
    }
    return nodes;
  },
  'wall-sconce'(w, h) {
    return [line(-w * 0.4, h * 0.42, w * 0.4, h * 0.42, { stroke: EL, sw: 1.6 }), path(`M ${-w * 0.3} ${h * 0.42} A ${w * 0.3} ${h * 0.55} 0 0 1 ${w * 0.3} ${h * 0.42} Z`, { stroke: EL, fill: '#fffbeb' })];
  },
  'smoke-detector'(w, h) {
    const r = Math.min(w, h) * 0.44;
    return [circle(0, 0, r, { stroke: EL, fill: '#ffffff' }), circle(0, 0, r * 0.5, { stroke: EL }), circle(0, 0, 1.3, { fill: EL, stroke: EL })];
  },
  thermostat(w, h) {
    return [rect(w * 0.82, h * 0.82, { rx: 3, stroke: EL, fill: '#ffffff' }), circle(0, 0, Math.min(w, h) * 0.22, { stroke: EL })];
  },
  'electrical-panel'(w, h) {
    const nodes = [rect(w, h, { rx: 1, stroke: EL, fill: '#ecfdf5' })];
    for (let i = 1; i < 4; i += 1) nodes.push(line(-w / 2, -h / 2 + (h * i) / 4, w / 2, -h / 2 + (h * i) / 4, { stroke: EL, sw: 0.8 }));
    return nodes;
  },
  'tv-outlet'(w, h) {
    const r = Math.min(w, h) * 0.44;
    return [circle(0, 0, r, { stroke: EL, fill: '#ffffff' }), path(`M ${-r * 0.4} ${-r * 0.3} L 0 ${r * 0.4} L ${r * 0.4} ${-r * 0.3}`, { stroke: EL })];
  },
  'floor-outlet'(w, h) {
    return [rect(w * 0.9, h * 0.9, { stroke: EL, fill: '#ffffff' }), circle(0, 0, Math.min(w, h) * 0.3, { stroke: EL })];
  },

  /* ---------- Plumbing (blue accent) ---------- */
  'kitchen-sink'(w, h) {
    return [rect(w, h, { rx: 2, fill: '#eff6ff', stroke: PL }), box(-w * 0.44, -h * 0.34, w * 0.4, h * 0.68, { stroke: PL, rx: 3, fill: '#dbeafe' }), box(w * 0.04, -h * 0.34, w * 0.4, h * 0.68, { stroke: PL, rx: 3, fill: '#dbeafe' }), circle(0, -h * 0.4, 1.6, { stroke: PL })];
  },
  'double-sink'(w, h) {
    return [ellipse(-w * 0.22, 0, w * 0.2, h * 0.34, { stroke: PL, fill: '#dbeafe' }), ellipse(w * 0.22, 0, w * 0.2, h * 0.34, { stroke: PL, fill: '#dbeafe' }), circle(0, -h * 0.4, 1.6, { stroke: PL })];
  },
  bidet(w, h) {
    return [ellipse(0, 0, w * 0.4, h * 0.44, { stroke: PL, fill: '#eff6ff' }), ellipse(0, 0, w * 0.24, h * 0.28, { stroke: PL })];
  },
  'floor-drain'(w, h) {
    const r = Math.min(w, h) * 0.3;
    return [rect(w * 0.9, h * 0.9, { stroke: PL, fill: '#eff6ff' }), circle(0, 0, r, { stroke: PL }), line(-r, 0, r, 0, { stroke: PL }), line(0, -r, 0, r, { stroke: PL })];
  },
  'hose-bib'(w, h) {
    const r = Math.min(w, h) * 0.3;
    return [circle(0, 0, r, { stroke: PL, fill: '#eff6ff' }), line(0, r, 0, r + 5, { stroke: PL }), line(-3, r + 5, 3, r + 5, { stroke: PL })];
  },
  'washer-box'(w, h) {
    return [rect(w, h, { stroke: PL, fill: '#eff6ff', rx: 2 }), circle(-w * 0.2, 0, Math.min(w, h) * 0.16, { stroke: PL }), circle(w * 0.2, 0, Math.min(w, h) * 0.16, { stroke: PL })];
  },
  'water-meter'(w, h) {
    const r = Math.min(w, h) * 0.44;
    return [circle(0, 0, r, { stroke: PL, fill: '#eff6ff' }), line(0, -r, 0, -r * 0.4, { stroke: PL }), circle(0, 0, 1.4, { fill: PL, stroke: PL })];
  },
  'gas-valve'(w, h) {
    const r = Math.min(w, h) * 0.3;
    return [circle(0, 0, r, { stroke: '#b45309', fill: '#fffbeb' }), line(-r, 0, r, 0, { stroke: '#b45309', sw: 1.6 }), line(0, -r * 0.6, 0, r * 0.6, { stroke: '#b45309' })];
  },
};

/* ---------- Label → symbol-key inference ---------- */

const LABEL_ALIASES = [
  [/arm\s*chair|recliner/, 'armchair'],
  [/sectional/, 'sectional'],
  [/ottoman|foot\s*stool|pouf/, 'ottoman'],
  [/tv\s*stand|media\s*console|entertainment/, 'tv-stand'],
  [/sofa|couch|loveseat/, 'couch'],
  [/rect(angular)?\s*dining|dining\s*table\s*\(?rect|dining\s*table\s*rect/, 'dining-table-rect'],
  [/dining\s*table|kitchen\s*table/, 'dining-table'],
  [/coffee\s*table/, 'coffee-table'],
  [/console\s*table/, 'console'],
  [/night\s*stand/, 'nightstand'],
  [/dresser|armoire/, 'dresser'],
  [/wardrobe/, 'wardrobe'],
  [/book\s*shelf|bookcase|shelf/, 'bookshelf'],
  [/fire\s*place|hearth/, 'fireplace'],
  [/vanity/, 'vanity'],
  [/mirror/, 'mirror'],
  [/crib|bassinet/, 'crib'],
  [/piano/, 'piano'],
  [/pool\s*table|billiard/, 'pool-table'],
  [/grill|bbq|barbecue/, 'grill'],
  [/\bcar\b|vehicle|sedan/, 'car'],
  [/column|pillar|post/, 'column'],
  [/treadmill/, 'treadmill'],
  [/closet/, 'closet'],
  [/fridge|refrigerator/, 'fridge'],
  [/micro\s*wave/, 'microwave'],
  [/dish\s*washer/, 'dishwasher'],
  [/washer\s*box|laundry\s*box/, 'washer-box'],
  [/wash(er|ing)/, 'washer'],
  [/dry(er)?/, 'dryer'],
  [/kitchen\s*sink/, 'kitchen-sink'],
  [/double\s*sink/, 'double-sink'],
  [/toilet|wc|water\s*closet/, 'toilet'],
  [/bidet/, 'bidet'],
  [/bath\s*tub|tub/, 'bathtub'],
  [/floor\s*drain/, 'floor-drain'],
  [/hose\s*bib|spigot|faucet\s*outdoor/, 'hose-bib'],
  [/water\s*meter/, 'water-meter'],
  [/gas\s*valve|gas\s*line/, 'gas-valve'],
  [/kitchen\s*island|island/, 'island'],
  [/water\s*heater/, 'water-heater'],
  [/\bac\b|air\s*condition|hvac/, 'ac'],
  [/thermostat/, 'thermostat'],
  [/smoke\s*detector|smoke\s*alarm/, 'smoke-detector'],
  [/ceiling\s*fan/, 'ceiling-fan'],
  [/chandelier/, 'chandelier'],
  [/pendant/, 'pendant-light'],
  [/recessed|pot\s*light|can\s*light/, 'light-recessed'],
  [/sconce/, 'wall-sconce'],
  [/gfci/, 'outlet-gfci'],
  [/dimmer/, 'dimmer'],
  [/3[\s-]*way/, 'switch-3way'],
  [/switch/, 'switch'],
  [/outlet|receptacle|socket/, 'outlet'],
  [/panel|breaker/, 'electrical-panel'],
  [/ceiling\s*light|light\s*fixture|flush\s*mount/, 'light-ceiling'],
  [/\btv\b|television/, 'tv'],
  [/\bbed\b/, 'bed'],
  [/\bchair\b/, 'chair'],
  [/\bdesk\b/, 'desk'],
  [/\bstove|range\b/, 'stove'],
  [/\boven\b/, 'oven'],
  [/\bsink\b|basin/, 'sink'],
  [/\bshower\b/, 'shower'],
  [/\blamp\b/, 'lamp'],
  [/\bplant\b|fern/, 'plant'],
  [/\btrash\b|bin|waste/, 'trash'],
  [/\bcabinet\b|cupboard|pantry/, 'cabinet'],
  [/\brug\b|carpet/, 'rug'],
  [/\bstair/, 'stairs'],
  [/\bstove\b/, 'stove'],
];

/** Guess a symbol key from a fixture's label/type text.
 * @param {string} text — combined label + type
 * @returns {string|null} symbol key or null when nothing matches
 */
export function inferSymbolKey(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;
  for (const [pattern, key] of LABEL_ALIASES) {
    if (pattern.test(lower)) return key;
  }
  return null;
}

/** Whether a given key has a dedicated top-down drawing. */
export function hasSymbolDrawing(key) {
  return Boolean(SYMBOL_DRAWERS[key]);
}

/** Build a centered top-down symbol graphic.
 * @param {string} key — symbol key (e.g. 'couch')
 * @param {number} width — bounding width in units
 * @param {number} height — bounding height in units
 * @returns {SVGGElement|null} a <g> group centered on (0,0), or null
 */
export function buildSymbolGraphic(key, width, height) {
  const drawer = SYMBOL_DRAWERS[key];
  if (!drawer) return null;
  const w = Math.max(6, Number(width) || 16);
  const h = Math.max(6, Number(height) || 16);
  const group = svgEl('g', { className: 'floorplan-symbol-graphic' });
  for (const node of drawer(w, h)) {
    if (node) group.append(node);
  }
  return group;
}
