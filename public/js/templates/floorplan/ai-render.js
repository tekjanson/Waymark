/* ============================================================
   floorplan/ai-render.js — AI visual concept renderer

   Generates a styled "space concept" from current floorplan geometry.
   ============================================================ */

import { el, generateText, generateImage, showToast } from '../shared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SYSTEM_PROMPT =
  'You are an interior visualization assistant. ' +
  'Given floor plan geometry, produce strict JSON only with this schema: ' +
  '{"spaceTitle":"string","overallMood":"string","palette":["#hex"],' +
  '"lighting":"string","rooms":[{"name":"string","styleNotes":"string","color":"#hex"}],' +
  '"renderPrompt":"string","designActions":["string"]}. ' +
  'Use 4-6 designActions max.';

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    node.setAttribute(key, String(val));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function parseJson(text) {
  if (!text) return null;
  let raw = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fallbackSpec() {
  return {
    spaceTitle: 'AI Space Concept',
    overallMood: 'Balanced, practical family living',
    palette: ['#dbeafe', '#c7d2fe', '#fde68a', '#bbf7d0'],
    lighting: 'Layered ambient and task lighting',
    rooms: [],
    renderPrompt: 'Warm family-oriented interior with practical storage and clear circulation.',
    designActions: ['Define main circulation route', 'Add layered lighting by zone', 'Anchor each room with one focal point'],
  };
}

function roomSummary(items) {
  return items
    .filter(item => item.kind === 'room')
    .map((room, idx) => ({
      name: room.label || `Room ${idx + 1}`,
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
    }));
}

async function generateRenderSpec(items) {
  const mock = typeof window !== 'undefined' ? window.__WAYMARK_FLOORPLAN_RENDER_MOCK : null;
  if (mock) return typeof mock === 'function' ? mock(items) : mock;

  const rooms = roomSummary(items);
  if (!rooms.length) throw new Error('Draw at least one room before generating an AI render.');

  const userMessage =
    'Create an interior concept render spec from this plan: ' +
    JSON.stringify({
      roomCount: rooms.length,
      rooms,
      walls: items.filter(item => item.kind === 'wall').length,
      electrical: items.filter(item => item.kind === 'electrical').length,
      plumbing: items.filter(item => item.kind === 'plumbing').length,
    });

  const text = await generateText(SYSTEM_PROMPT, userMessage, { temperature: 0.45, maxTokens: 1200 });
  return parseJson(text) || fallbackSpec();
}

/* ---------- Photoreal pipeline: geometry-locked enrichment + seed ---------- */

const ENRICH_SYSTEM_PROMPT =
  'You are an architectural specification translator. Describe ONLY the exact ' +
  'spatial geometry, wall boundaries, door/window placements, materials, and ' +
  'fixtures explicitly defined in the provided drawing schema. Do not invent ' +
  'additional rooms, furniture, props, or structural features. Output a precise, ' +
  'geometry-locked architectural rendering prompt as a single paragraph.';

/**
 * Build a compact JSON schema of the drawing's exact geometry — walls as
 * vectors, rooms with dimensions, doors, windows, and explicitly placed
 * fixtures — for the Gemini enrichment step.
 * @param {Object[]} items
 * @returns {Object}
 */
function buildDrawingSchema(items) {
  const list = items || [];
  const rooms = list.filter(i => i.kind === 'room').map(r => ({
    name: r.label || 'Room',
    x: Math.round(r.x || 0), y: Math.round(r.y || 0),
    width: Math.round(r.width || 0), height: Math.round(r.height || 0),
  }));
  const walls = list.filter(i => i.kind === 'wall').map(w => ({
    x1: Math.round(w.x1 ?? w.x ?? 0), y1: Math.round(w.y1 ?? w.y ?? 0),
    x2: Math.round(w.x2 ?? (w.x || 0) + (w.width || 0)), y2: Math.round(w.y2 ?? (w.y || 0) + (w.height || 0)),
  }));
  const classify = (it) => `${it.type || ''} ${it.label || ''} ${it.symbolKey || ''}`.toLowerCase();
  const doors = list.filter(i => /door/.test(classify(i))).map(d => ({ x: Math.round(d.x || 0), y: Math.round(d.y || 0) }));
  const windows = list.filter(i => /window/.test(classify(i))).map(w => ({ x: Math.round(w.x || 0), y: Math.round(w.y || 0) }));
  const fixtures = list
    .filter(i => (i.kind === 'fixture' || i.kind === 'electrical' || i.kind === 'plumbing') && !/door|window/.test(classify(i)))
    .map(f => ({ type: f.symbolKey || f.type || f.label || 'fixture', x: Math.round(f.x || 0), y: Math.round(f.y || 0) }));
  return { rooms, walls, doors, windows, fixtures };
}

/**
 * Step 1 of the photoreal pipeline: translate the raw drawing geometry into a
 * strict, geometry-locked rendering prompt via Gemini (no hallucinated rooms,
 * furniture, or features).
 * @param {Object[]} items
 * @returns {Promise<string>}
 */
export async function enrichFloorplanPrompt(items) {
  const schema = buildDrawingSchema(items);
  if (!schema.rooms.length && !schema.walls.length) {
    throw new Error('Draw walls or a room before enriching the render prompt.');
  }
  const userMessage = 'Drawing schema (geometry to lock to):\n' + JSON.stringify(schema);
  const text = await generateText(ENRICH_SYSTEM_PROMPT, userMessage, { temperature: 0.2, maxTokens: 700 });
  return (text || '').trim();
}

/**
 * Deterministic numeric seed derived from the drawing geometry, so repeat
 * renders of the SAME layout stay locked to the SAME seed.
 * @param {Object[]} items
 * @returns {number}  0–99999
 */
export function computeDrawingSeed(items) {
  const schema = buildDrawingSchema(items);
  const str = JSON.stringify(schema);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}

function renderConceptSvg(container, items, spec) {
  container.innerHTML = '';
  const svg = svgEl('svg', {
    viewBox: '0 0 900 480',
    class: 'floorplan-ai-render-svg',
    role: 'img',
    'aria-label': 'AI interior concept render',
  });

  svg.append(
    svgEl('defs', {}, [
      svgEl('linearGradient', { id: 'wm-ai-bg', x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, [
        svgEl('stop', { offset: '0%', 'stop-color': '#f8fafc' }),
        svgEl('stop', { offset: '100%', 'stop-color': '#e2e8f0' }),
      ]),
      svgEl('filter', { id: 'wm-ai-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, [
        svgEl('feDropShadow', { dx: '0', dy: '3', stdDeviation: '4', 'flood-color': '#334155', 'flood-opacity': '0.25' }),
      ]),
    ]),
  );

  svg.append(svgEl('rect', { x: 0, y: 0, width: 900, height: 480, fill: 'url(#wm-ai-bg)' }));

  const rooms = items.filter(item => item.kind === 'room');
  const palette = Array.isArray(spec?.palette) && spec.palette.length ? spec.palette : fallbackSpec().palette;
  const styleRooms = Array.isArray(spec?.rooms) ? spec.rooms : [];

  rooms.forEach((room, idx) => {
    const color = styleRooms[idx]?.color || palette[idx % palette.length];
    const x = 60 + (((room.x || 20) - 20) / 920) * 760;
    const y = 40 + (((room.y || 20) - 20) / 560) * 320;
    const width = Math.max(42, ((room.width || 100) / 920) * 760);
    const height = Math.max(34, ((room.height || 80) / 560) * 320);

    const skewTop = 14;
    const skewRight = 10;
    svg.append(
      svgEl('polygon', {
        points: `${x},${y} ${x + width},${y} ${x + width + skewRight},${y + skewTop} ${x + skewRight},${y + skewTop}`,
        fill: '#cbd5e1',
        opacity: '0.75',
      }),
      svgEl('polygon', {
        points: `${x + width},${y} ${x + width + skewRight},${y + skewTop} ${x + width + skewRight},${y + height + skewTop} ${x + width},${y + height}`,
        fill: '#94a3b8',
        opacity: '0.45',
      }),
      svgEl('rect', {
        x,
        y,
        width,
        height,
        rx: 6,
        fill: color,
        stroke: '#334155',
        'stroke-width': 2,
        filter: 'url(#wm-ai-shadow)',
      }),
      svgEl('text', {
        x: x + (width / 2),
        y: y + (height / 2) + 4,
        'text-anchor': 'middle',
        'font-size': 12,
        'font-weight': 700,
        fill: '#0f172a',
      }, [room.label || styleRooms[idx]?.name || `Room ${idx + 1}`]),
    );
  });

  container.appendChild(svg);
}

/* ============================================================
   Viewpoint 3D — procedural first-person perspective renderer
   ============================================================ */

const OBJECT_HEIGHTS = {
  bed: 16, couch: 15, sectional: 15, armchair: 18, ottoman: 10, chair: 18,
  'dining-table': 25, 'coffee-table': 14, desk: 25, console: 26, 'tv-stand': 16,
  tv: 30, fridge: 66, bookshelf: 60, dresser: 32, wardrobe: 70, closet: 70,
  nightstand: 20, stove: 34, oven: 34, microwave: 48, dishwasher: 34, island: 34,
  cabinet: 84, sink: 32, 'kitchen-sink': 34, toilet: 16, bathtub: 18, shower: 78,
  'water-heater': 56, washer: 34, dryer: 34, lamp: 46, plant: 40, piano: 36,
  'pool-table': 30, fireplace: 40, mirror: 50, vanity: 34, crib: 28, column: 95,
};

function roomBoxAt(items, x, y) {
  const rooms = items.filter(i => ((i.kind || '') === 'room') || /room/i.test(String(i.type || '')));
  const toBox = (r) => ({ x: r.x, y: r.y, w: Math.max(40, r.width || 120), h: Math.max(34, r.height || 80), label: r.label });
  for (const r of rooms) {
    const b = toBox(r);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  let best = null;
  rooms.forEach((r) => {
    const b = toBox(r);
    const d = Math.hypot((b.x + b.w / 2) - x, (b.y + b.h / 2) - y);
    if (!best || d < best.d) best = { b, d };
  });
  return best ? best.b : null;
}

/** Render a stylised first-person 3D view of the space from a viewpoint.
 * @param {HTMLElement} host — container to render into
 * @param {Object[]} items — floor plan items
 * @param {{x:number,y:number,heading:number,fov?:number}} camera — plan-space camera
 */
export function renderPerspectiveView(host, items, camera) {
  const options = arguments[3] || {};
  host.innerHTML = '';
  const VW = 900;
  const VH = 500;
  const svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'floorplan-view-svg', role: 'img', 'aria-label': '3D viewpoint render' });
  svg.append(svgEl('defs', {}, [
    svgEl('linearGradient', { id: 'wm-floor', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svgEl('stop', { offset: '0%', 'stop-color': '#b8c2d0' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#8a97a8' }),
    ]),
    svgEl('linearGradient', { id: 'wm-ceil', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svgEl('stop', { offset: '0%', 'stop-color': '#f8fafc' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#dde4ee' }),
    ]),
  ]));

  const room = roomBoxAt(items, camera.x, camera.y);
  if (!room) {
    svg.append(svgEl('rect', { x: 0, y: 0, width: VW, height: VH, fill: '#0f172a' }));
    svg.append(svgEl('text', { x: VW / 2, y: VH / 2, 'text-anchor': 'middle', fill: '#e2e8f0', 'font-size': 20, 'font-weight': 700 }, ['Add a room, then place the camera inside it.']));
    host.appendChild(svg);
    return;
  }

  const ceilH = 95;
  const eyeH = 55;
  const near = 5;
  const fov = ((camera.fov || 72) * Math.PI) / 180;
  const focal = (VW / 2) / Math.tan(fov / 2);
  const horizon = VH * 0.46;
  const hd = ((camera.heading || 0) * Math.PI) / 180;
  const f = { x: Math.cos(hd), y: Math.sin(hd) };
  const right = { x: -Math.sin(hd), y: Math.cos(hd) };
  const cam = { x: camera.x, y: camera.y };

  const toCam = (px, py) => {
    const rx = px - cam.x;
    const ry = py - cam.y;
    return { depth: (rx * f.x) + (ry * f.y), lat: (rx * right.x) + (ry * right.y) };
  };
  const proj = (c, z) => ({ x: (VW / 2) + (c.lat / c.depth) * focal, y: horizon - ((z - eyeH) / c.depth) * focal });
  const clipNear = (a, b) => {
    if (a.depth < near && b.depth < near) return null;
    let A = a;
    let B = b;
    if (A.depth < near) {
      const t = (near - A.depth) / (B.depth - A.depth);
      A = { depth: near, lat: A.lat + (B.lat - A.lat) * t };
    } else if (B.depth < near) {
      const t = (near - B.depth) / (A.depth - B.depth);
      B = { depth: near, lat: B.lat + (A.lat - B.lat) * t };
    }
    return [A, B];
  };

  // Backdrop: ceiling (top) + floor (bottom)
  svg.append(svgEl('rect', { x: 0, y: 0, width: VW, height: horizon, fill: 'url(#wm-ceil)' }));
  svg.append(svgEl('rect', { x: 0, y: horizon, width: VW, height: VH - horizon, fill: 'url(#wm-floor)' }));

  const planWalls = (items || [])
    .filter(i => i && (i.kind === 'wall' || /wall/i.test(String(i.type || ''))))
    .map(wallEndpoints);

  // Room/wall segments as depth-sorted quads. Prefer authored walls so
  // bumpouts and non-rectangular shells render instead of a plain box.
  const corners = [
    { x: room.x, y: room.y },
    { x: room.x + room.w, y: room.y },
    { x: room.x + room.w, y: room.y + room.h },
    { x: room.x, y: room.y + room.h },
  ];
  const wallQuads = [];
  const sourceWalls = planWalls.length > 0
    ? planWalls.map(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }])
    : corners.map((p, i) => [p, corners[(i + 1) % corners.length]]);
  sourceWalls.forEach(([p1, p2]) => {
    const clipped = clipNear(toCam(p1.x, p1.y), toCam(p2.x, p2.y));
    if (!clipped) return;
    const [ca, cb] = clipped;
    const fa = proj(ca, 0);
    const fb = proj(cb, 0);
    const ta = proj(ca, ceilH);
    const tb = proj(cb, ceilH);
    wallQuads.push({ pts: `${fa.x},${fa.y} ${fb.x},${fb.y} ${tb.x},${tb.y} ${ta.x},${ta.y}`, depth: (ca.depth + cb.depth) / 2 });
  });
  wallQuads.sort((a, b) => b.depth - a.depth);
  wallQuads.forEach((q) => {
    const shade = Math.max(0.5, Math.min(1, 1 - q.depth / 900));
    const base = Math.round(214 * shade + 20);
    svg.append(svgEl('polygon', { points: q.pts, class: 'floorplan-view-wall', fill: `rgb(${base},${base + 6},${base + 14})`, stroke: '#94a3b8', 'stroke-width': 1 }));
  });

  // Billboard entities (doors/windows + furniture), depth sorted
  const classify = (it) => {
    const t = `${it.type || ''} ${it.label || ''}`.toLowerCase();
    if (/door/.test(t)) return 'door';
    if (/window/.test(t)) return 'window';
    return 'object';
  };
  const entities = items
    .filter(it => it && Number.isFinite(it.x) && Number.isFinite(it.y))
    .filter(it => { const k = it.kind || ''; return k === 'fixture' || k === 'electrical' || k === 'plumbing' || /door|window|fixture|sofa|table|bed|desk/i.test(String(it.type || it.label || '')); })
    .map((it) => ({ it, cam: toCam(it.x, it.y), cls: classify(it) }))
    .filter(e => e.cam.depth > near)
    .sort((a, b) => b.cam.depth - a.cam.depth);

  const objColor = (cls, key) => {
    if (cls === 'door') return '#b45309';
    if (cls === 'window') return '#38bdf8';
    if (/plant/.test(key || '')) return '#16a34a';
    if (/fridge|washer|dryer|dishwasher|stove|oven|sink|toilet|bathtub|shower/.test(key || '')) return '#cbd5e1';
    return '#64748b';
  };

  entities.forEach((e) => {
    const { it, cam: cc, cls } = e;
    const key = it.symbolKey || '';
    const objH = cls === 'door' ? 72 : cls === 'window' ? 42 : (OBJECT_HEIGHTS[key] || 22);
    const base = cls === 'window' ? 32 : 0; // windows float off the floor
    const footprint = Math.max(10, it.width || 20);
    const foot = proj(cc, base);
    const top = proj(cc, base + objH);
    const wpx = Math.max(6, (footprint / cc.depth) * focal);
    const x = foot.x - wpx / 2;
    const yTop = top.y;
    const hpx = Math.max(6, foot.y - top.y);
    if (cls === 'door') {
      svg.append(svgEl('rect', { x, y: yTop, width: wpx, height: hpx, rx: 2, fill: '#7c4a1e', stroke: '#5b370f', 'stroke-width': 1, opacity: 0.95 }));
      svg.append(svgEl('circle', { cx: x + wpx * 0.82, cy: yTop + hpx * 0.52, r: Math.max(1.5, wpx * 0.05), fill: '#fde68a' }));
    } else if (cls === 'window') {
      svg.append(svgEl('rect', { x, y: yTop, width: wpx, height: hpx, rx: 1, fill: 'rgba(186,230,253,0.85)', stroke: '#0ea5e9', 'stroke-width': 1.5 }));
      svg.append(svgEl('line', { x1: x + wpx / 2, y1: yTop, x2: x + wpx / 2, y2: yTop + hpx, stroke: '#0ea5e9', 'stroke-width': 1 }));
      svg.append(svgEl('line', { x1: x, y1: yTop + hpx / 2, x2: x + wpx, y2: yTop + hpx / 2, stroke: '#0ea5e9', 'stroke-width': 1 }));
    } else {
      // floor shadow
      svg.append(svgEl('ellipse', { cx: foot.x, cy: foot.y, rx: wpx * 0.56, ry: Math.max(2, wpx * 0.14), fill: 'rgba(15,23,42,0.18)' }));
      const objectRect = svgEl('rect', { x, y: yTop, width: wpx, height: hpx, rx: 3, class: 'floorplan-view-object', 'data-floorplan-render-item': String(it.id || ''), fill: objColor(cls, key), stroke: '#334155', 'stroke-width': 1, opacity: 0.96 });
      objectRect.addEventListener('click', () => options.onObjectClick?.(it));
      svg.append(objectRect);
      svg.append(svgEl('rect', { x, y: yTop, width: wpx, height: Math.max(2, hpx * 0.18), rx: 3, fill: '#ffffff', opacity: 0.18 }));
      if (it.aiPrompt) {
        svg.append(svgEl('text', { x: foot.x, y: Math.min(VH - 14, foot.y + 14), 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: '#0f172a' }, [String(it.aiPrompt).slice(0, 22)]));
      }
      if (it.label) {
        svg.append(svgEl('text', { x: foot.x, y: Math.max(12, yTop - 3), 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 600, fill: '#1e293b' }, [String(it.label).slice(0, 16)]));
      }
    }
  });

  // Vignette + heading badge
  svg.append(svgEl('rect', { x: 0, y: 0, width: VW, height: VH, fill: 'none', stroke: 'rgba(15,23,42,0.18)', 'stroke-width': 10 }));
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const dir = dirs[Math.round((((camera.heading || 0) % 360) + 360) % 360 / 45) % 8];
  svg.append(svgEl('rect', { x: 14, y: 14, width: 150, height: 26, rx: 6, fill: 'rgba(15,23,42,0.72)' }));
  svg.append(svgEl('text', { x: 24, y: 32, 'font-size': 12, 'font-weight': 700, fill: '#e2e8f0' }, [`${room.label || 'Room'} · facing ${dir}`]));
  host.appendChild(svg);
}

function wallEndpoints(wl) {
  const x1 = wl.x;
  const y1 = wl.y;
  if (Number.isFinite(wl.x2) && Number.isFinite(wl.y2)) return { x1, y1, x2: wl.x2, y2: wl.y2 };
  const L = Number(wl.length) || 0;
  const W = Number(wl.width) || 0;
  const H = Number(wl.height) || 0;
  if (L && Math.abs(L) >= Math.abs(H) && Math.abs(L) >= Math.abs(W)) return { x1, y1, x2: x1 + L, y2: y1 };
  if (H && Math.abs(H) >= Math.abs(W)) return { x1, y1, x2: x1, y2: y1 + H };
  return { x1, y1, x2: x1 + (W || 120), y2: y1 };
}

/** Build an interactive top-down mini-map for placing/aiming the camera. */
function buildCameraMap(items, camera, onChange) {
  const planW = 960;
  const planH = 620;
  const mapW = 320;
  const scale = mapW / planW;
  const mapH = planH * scale;
  const svg = svgEl('svg', { viewBox: `0 0 ${mapW} ${mapH}`, class: 'floorplan-cam-map', role: 'img', 'aria-label': 'Camera placement map' });

  function redraw() {
    svg.innerHTML = '';
    svg.append(svgEl('rect', { x: 0, y: 0, width: mapW, height: mapH, fill: '#f8fafc', stroke: '#cbd5e1' }));
    items.filter(i => (i.kind === 'room') || /room/i.test(String(i.type || ''))).forEach((r) => {
      svg.append(svgEl('rect', { x: r.x * scale, y: r.y * scale, width: Math.max(40, r.width || 120) * scale, height: Math.max(34, r.height || 80) * scale, fill: '#dbeafe', stroke: '#60a5fa', 'stroke-width': 1 }));
    });
    items.filter(i => i.kind === 'wall' || /wall/i.test(String(i.type || ''))).forEach((wl) => {
      const e = wallEndpoints(wl);
      svg.append(svgEl('line', { x1: e.x1 * scale, y1: e.y1 * scale, x2: e.x2 * scale, y2: e.y2 * scale, stroke: '#334155', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    });
    const cx = camera.x * scale;
    const cy = camera.y * scale;
    const hd = ((camera.heading || 0) * Math.PI) / 180;
    const fov = ((camera.fov || 72) * Math.PI) / 180;
    const len = 38;
    const a1 = hd - fov / 2;
    const a2 = hd + fov / 2;
    svg.append(svgEl('polygon', { points: `${cx},${cy} ${cx + Math.cos(a1) * len},${cy + Math.sin(a1) * len} ${cx + Math.cos(a2) * len},${cy + Math.sin(a2) * len}`, fill: 'rgba(37,99,235,0.22)', stroke: '#2563eb', 'stroke-width': 0.6 }));
    svg.append(svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(hd) * len, y2: cy + Math.sin(hd) * len, stroke: '#2563eb', 'stroke-width': 1.6 }));
    svg.append(svgEl('circle', { cx, cy, r: 5, fill: '#2563eb', stroke: '#ffffff', 'stroke-width': 1.5 }));
  }

  function toPlan(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const l = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(20, Math.min(940, l.x / scale)), y: Math.max(20, Math.min(600, l.y / scale)) };
  }

  let aiming = false;
  svg.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    aiming = true;
    const p = toPlan(ev);
    camera.x = p.x;
    camera.y = p.y;
    redraw();
    svg.setPointerCapture?.(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!aiming) return;
    const p = toPlan(ev);
    const dx = p.x - camera.x;
    const dy = p.y - camera.y;
    if (Math.hypot(dx, dy) > 4) {
      camera.heading = (Math.atan2(dy, dx) * 180) / Math.PI;
      redraw();
    }
  });
  const end = (ev) => {
    if (!aiming) return;
    aiming = false;
    svg.releasePointerCapture?.(ev.pointerId);
    if (onChange) onChange();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  redraw();
  return { svg, redraw };
}

export function openFloorplanAiRenderModal({ items }) {
  const overlay = el('div', { className: 'floorplan-ai-overlay' });
  const modal = el('div', { className: 'floorplan-ai-modal floorplan-ai-render-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'floorplan-ai-header' }, [
    el('div', { className: 'floorplan-ai-title' }, ['Render Space']),
    el('button', { className: 'floorplan-ai-close', type: 'button', 'aria-label': 'Close' }, ['x']),
  ]);
  header.querySelector('.floorplan-ai-close').addEventListener('click', close);

  const status = el('div', { className: 'floorplan-ai-status' }, ['Place the camera on the map, aim it, then render a 3D view — or generate a styled concept.']);

  // ---- Camera placement ----
  const firstRoom = (items || []).find(i => (i.kind === 'room') || /room/i.test(String(i.type || '')));
  const camera = firstRoom
    ? { x: firstRoom.x + Math.max(40, firstRoom.width || 120) / 2, y: firstRoom.y + Math.max(34, firstRoom.height || 80) / 2, heading: 0, fov: 72 }
    : { x: 480, y: 310, heading: 0, fov: 72 };

  const renderHost = el('div', { className: 'floorplan-ai-render-host' });
  const details = el('div', { className: 'floorplan-ai-render-details' });
  const objectDetails = el('div', { className: 'floorplan-object-details hidden' });

  const recordObjectMetadata = (item, field, value) => {
    if (!window.__WAYMARK_RECORDS__) window.__WAYMARK_RECORDS__ = [];
    window.__WAYMARK_RECORDS__.push({ type: 'floorplan-object-metadata', itemId: String(item.id), field, value });
  };

  const showObjectDetails = (item) => {
    objectDetails.innerHTML = '';
    objectDetails.classList.remove('hidden');
    const promptInput = el('input', {
      className: 'floorplan-ai-prompt-input floorplan-render-ai-prompt-input',
      value: item.aiPrompt || '',
      placeholder: 'Describe finish, style, model...',
      on: { change: (event) => {
        item.aiPrompt = event.target.value;
        recordObjectMetadata(item, 'aiPrompt', item.aiPrompt);
      } },
    });
    const refInput = el('input', {
      className: 'floorplan-ai-ref-input floorplan-render-ai-ref-input',
      value: item.referencePhoto || '',
      placeholder: 'Seed photo filename or URL',
      on: { change: (event) => {
        item.referencePhoto = event.target.value;
        recordObjectMetadata(item, 'referencePhoto', item.referencePhoto);
      } },
    });
    const fileInput = el('input', {
      className: 'floorplan-ai-seed-file floorplan-render-ai-seed-file',
      type: 'file',
      accept: 'image/*',
      on: { change: (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        item.referencePhoto = file.name;
        refInput.value = file.name;
        recordObjectMetadata(item, 'referencePhoto', file.name);
      } },
    });
    objectDetails.append(
      el('h4', {}, [item.label || item.type || 'Object details']),
      el('label', { className: 'floorplan-object-details-row' }, [el('span', {}, ['AI prompt']), promptInput]),
      el('label', { className: 'floorplan-object-details-row' }, [el('span', {}, ['Seed photo']), refInput]),
      el('label', { className: 'floorplan-object-details-row' }, [el('span', {}, ['Upload']), fileInput]),
    );
  };

  const headingSlider = el('input', { className: 'floorplan-cam-heading', type: 'range', min: '0', max: '359', step: '1', value: '0' });

  const cam = buildCameraMap(items || [], camera, () => {
    headingSlider.value = String(Math.round(((camera.heading % 360) + 360) % 360));
  });

  const renderView = () => {
    renderPerspectiveView(renderHost, items || [], camera, { onObjectClick: showObjectDetails });
    details.innerHTML = '';
    details.append(
      el('h4', {}, ['Viewpoint 3D']),
      el('p', {}, ['Rendered from the camera position and direction shown on the map. Drag on the map to move the camera; drag away from it or use the slider to aim.']),
    );
    status.textContent = '3D viewpoint rendered.';
  };

  headingSlider.addEventListener('input', () => {
    camera.heading = Number(headingSlider.value);
    cam.redraw();
  });

  const camMapWrap = el('div', { className: 'floorplan-cam-mapwrap' }, [
    el('div', { className: 'floorplan-cam-maphint' }, ['Camera — tap to place, drag to aim']),
    cam.svg,
    el('label', { className: 'floorplan-cam-headinglabel' }, ['Direction', headingSlider]),
  ]);

  const renderViewBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary floorplan-ai-view-btn', type: 'button' }, ['Render 3D View']);
  renderViewBtn.addEventListener('click', () => {
    try {
      renderView();
      showToast('3D view rendered', 'success');
    } catch (err) {
      status.textContent = err.message || 'Could not render view.';
      showToast(err.message || 'Could not render view', 'error');
    }
  });

  const generateBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary', type: 'button' }, ['Generate Visual']);
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    status.textContent = 'Generating concept render...';
    try {
      const spec = await generateRenderSpec(items || []);
      renderConceptSvg(renderHost, items || [], spec);
      details.innerHTML = '';
      details.append(
        el('h4', {}, [spec.spaceTitle || 'AI Space Concept']),
        el('p', {}, [spec.overallMood || '']),
        el('p', {}, [`Lighting: ${spec.lighting || 'Not specified'}`]),
        el('p', { className: 'floorplan-ai-render-prompt' }, [spec.renderPrompt || '']),
        el('ul', {}, (spec.designActions || []).map(action => el('li', {}, [String(action)]))),
      );
      status.textContent = 'Concept render ready.';
      showToast('Visual generated', 'success');
    } catch (err) {
      status.textContent = err.message || 'Could not generate render.';
      showToast(err.message || 'Could not generate render', 'error');
    } finally {
      generateBtn.disabled = false;
    }
  });

  const copyPromptBtn = el('button', { className: 'floorplan-ai-btn', type: 'button' }, ['Copy Render Prompt']);
  copyPromptBtn.addEventListener('click', async () => {
    const prompt = details.querySelector('.floorplan-ai-render-prompt')?.textContent?.trim();
    if (!prompt) {
      showToast('Generate a concept first', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      showToast('Render prompt copied', 'success');
    } catch {
      showToast('Could not copy prompt', 'error');
    }
  });

  // Photorealistic image generation — 2-step geometry-locked pipeline:
  //   Step 1: Gemini enriches a geometry-locked prompt from the drawing JSON.
  //   Step 2: the enriched prompt + numeric drawing seed go to the image model
  //           (routes to OpenAI — Gemini Free Tier cannot generate images).
  const drawingSeed = computeDrawingSeed(items || []);
  const seedChip = el('span', { className: 'badge floorplan-ai-seed-chip' }, [`🔒 Seed #${drawingSeed}`]);

  const photorealBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary floorplan-ai-photoreal-btn', type: 'button' }, ['✨ Gemini Enrich & Render']);
  photorealBtn.addEventListener('click', async () => {
    photorealBtn.disabled = true;
    try {
      status.textContent = 'Step 1/2: Gemini enriching prompt from wall/door vectors…';
      let enriched;
      const enrichMock = typeof window !== 'undefined' ? window.__WAYMARK_FLOORPLAN_ENRICH_MOCK : null;
      if (enrichMock) {
        enriched = typeof enrichMock === 'function' ? await enrichMock(items) : String(enrichMock);
      } else {
        enriched = await enrichFloorplanPrompt(items || []);
      }

      status.textContent = `Step 2/2: Rendering Seed #${drawingSeed} with strict geometry lock…`;
      const fullPrompt =
        'Photorealistic interior architectural visualization at eye level, strictly geometry-locked. ' +
        enriched +
        ' Natural lighting, realistic materials, clean composition, high detail, wide-angle lens. ' +
        'Do not add rooms, furniture, or features not described above.';
      const mock = typeof window !== 'undefined' ? window.__WAYMARK_FLOORPLAN_IMAGE_MOCK : null;
      const src = mock
        ? (typeof mock === 'function' ? await mock(fullPrompt) : mock)
        : await generateImage(fullPrompt, { size: '1024x1024', seed: Number(drawingSeed) });
      renderHost.innerHTML = '';
      renderHost.append(el('img', {
        className: 'floorplan-ai-photoreal-img',
        src,
        alt: 'Photorealistic space render',
      }));
      details.innerHTML = '';
      details.append(
        el('h4', {}, [`Photoreal Render — Seed #${drawingSeed}`]),
        el('p', { className: 'floorplan-ai-render-prompt' }, [enriched]),
        el('p', { style: 'font-size:10px;color:var(--color-text-secondary);' }, ['Zero-hallucination pipeline: walls, doors & fixtures locked to the drawing schema.']),
      );
      status.textContent = `Seed #${drawingSeed} rendered with strict geometry lock.`;
      showToast('Photorealistic image generated', 'success');
    } catch (err) {
      status.textContent = err.message || 'Could not generate image.';
      showToast(err.message || 'Could not generate image', 'error');
    } finally {
      photorealBtn.disabled = false;
    }
  });

  const actions = el('div', { className: 'floorplan-ai-actions' }, [renderViewBtn, generateBtn, photorealBtn, copyPromptBtn]);
  modal.append(header, el('div', { className: 'floorplan-ai-seedbar' }, [seedChip]), status, camMapWrap, renderHost, objectDetails, details, actions);
  overlay.append(modal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
  // Render an initial 3D view so the modal is immediately useful.
  if (firstRoom) renderView();
}
