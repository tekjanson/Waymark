import * as storage from '../../storage.js';
/* ============================================================
   floorplan/index.js — Floor Plan template

   A lightweight CAD-style layout designer for home planning.
   The sheet stores rooms, walls, and utility elements as rows,
   then renders them in a plan view with a simple PDF/print export.
   ============================================================ */

import {
  api,
  cell,
  el,
  readSheetTab,
  registerTemplate,
  showToast,
  writeSheetTab,
} from '../shared.js';
import { openFloorplanAiRenderModal } from './ai-render.js';
import {
  UNITS_PER_FOOT,
  formatFeet,
  buildSymbolGraphic,
  inferSymbolKey,
  hasSymbolDrawing,
} from './symbols.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FLOORPLAN_STATE_TAB = 'Waymark Floor Plan';
const FLOORPLAN_STATE_HEADER = 'Waymark Floor Plan State v1';
const FLOORPLAN_STATE_CHUNK_SIZE = 40000;

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') node.setAttribute('class', val);
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key === 'on') {
      for (const [evt, handler] of Object.entries(val)) {
        node.addEventListener(evt, handler);
      }
    } else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
    else node.setAttribute(key, val);
  }

  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function normalizeText(value) {
  const str = String(value ?? '').trim();
  return str;
}

function parseFloatValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  const clean = String(value).replace(/[^0-9.-]/g, '');
  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

function parseFloorNumber(layer, notes) {
  const noteText = String(notes || '');
  const layerText = String(layer || '');
  const fromNote = noteText.match(/floor\s*[:=-]?\s*(\d+)/i);
  if (fromNote) return Math.max(1, Number(fromNote[1]) || 1);
  const fromLayer = layerText.match(/floor\s*[:_-]?(\d+)/i);
  if (fromLayer) return Math.max(1, Number(fromLayer[1]) || 1);
  return 1;
}

function classifyItem(item) {
  const type = String(item.type || item.label || '').toLowerCase();
  const layer = String(item.layer || '').toLowerCase();

  if (type.includes('room')) return 'room';
  if (type.includes('wall')) return 'wall';
  if (type.includes('door') || type.includes('window') || type.includes('opening') || type.includes('stairs')) return 'fixture';
  if (type.includes('outlet') || type.includes('switch') || type.includes('light') || layer.includes('electrical')) return 'electrical';
  if (type.includes('sink') || type.includes('toilet') || type.includes('pipe') || type.includes('drain') || layer.includes('plumbing')) return 'plumbing';
  if (layer.includes('structure') && !type.includes('door') && !type.includes('window')) return 'wall';
  if (type.includes('fixture') || type.includes('table') || type.includes('sofa')) return 'fixture';
  return 'fixture';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const WORLD_COORD_MIN = -200000;
const WORLD_COORD_MAX = 200000;

function clampWorldCoord(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(numeric, WORLD_COORD_MIN, WORLD_COORD_MAX);
}

function getWorldBoundsFromViewBox(svg) {
  const parts = String(svg.getAttribute('viewBox') || '0 0 960 620').split(/\s+/).map(Number);
  return { x: parts[0] || 0, y: parts[1] || 0, width: parts[2] || 960, height: parts[3] || 620 };
}

function isDebugEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__WAYMARK_LOCAL) return true;
  if (window.location && window.location.hostname === 'localhost') return true;
  try {
    return storage.getRaw('waymark_floorplan_debug') === '1';
  } catch {
    return false;
  }
}

function debugLog(...args) {
  if (!isDebugEnabled()) return;
  console.info('[floorplan-debug]', ...args);
}

const TOOL_HINTS = {
  wall: 'Wall: drag or tap to draw with snap-to-grid and auto-connect anchors.',
  'wall-rect': 'Rectangle Walls: drag a box to create wall loops. Toggle corners on/off.',
  room: 'Room: drag or tap to draw bounds, snapped cleanly to nearby geometry.',
  line: 'Line: click to add points. Click the start to close, or double-click / Enter / Finish Line for an open line. Esc cancels.',
  circle: 'Circle: press and drag from the centre outward to set the radius. Release to place.',
  trim: 'Trim: click an overhanging wall/line end to cut it back to the nearest intersection.',
  measure: 'Measure: drag between two points to tape a distance. Switch tools to clear the live tape.',
  electrical: 'Electrical: tap to place a point with clean snapping.',
  plumbing: 'Plumbing: tap to place a point with clean snapping.',
  door: 'Door: tap near a wall to snap and place an opening.',
  window: 'Window: tap near a wall to snap and place glazing.',
  stairs: 'Stairs: tap to place stair alignment between floors.',
  symbol: 'Symbol: pick an item and tap to place furniture/appliances.',
  select: 'Select: drag to move, Shift/Ctrl click for multi-select, drag empty space for box-select. Arrow keys nudge.',
  erase: 'Erase: tap any drawn item to remove it.',
};

/* Line/shape stroke styling (row 24). */
const DEFAULT_LINE_STYLE = { lineType: 'solid', strokeWidth: 3, strokeColor: '#0f766e' };
const LINE_TYPES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dash-dot', 'Dash-dot']];
const STROKE_SWATCHES = ['#0f766e', '#1e293b', '#dc2626', '#2563eb', '#d97706', '#16a34a', '#9333ea', '#000000'];

/* Map a logical line type to an SVG stroke-dasharray for a given weight. */
function dashArrayFor(lineType, weight) {
  const w = Math.max(1, Number(weight) || 1);
  if (lineType === 'dashed') return `${w * 3} ${w * 2}`;
  if (lineType === 'dotted') return `${w} ${w * 1.8}`;
  if (lineType === 'dash-dot') return `${w * 3} ${w * 1.6} ${w} ${w * 1.6}`;
  return '';
}

const SYMBOL_CATALOG = [
  {
    category: 'Living Room', layer: 'fixture', items: [
      { key: 'couch', label: 'Couch', icon: '🛋️', width: 64, height: 32 },
      { key: 'sectional', label: 'Sectional', icon: '🛋️', width: 70, height: 50 },
      { key: 'armchair', label: 'Armchair', icon: '🪑', width: 30, height: 30 },
      { key: 'ottoman', label: 'Ottoman', icon: '🟫', width: 22, height: 16 },
      { key: 'coffee-table', label: 'Coffee Table', icon: '◼', width: 36, height: 20 },
      { key: 'tv', label: 'TV', icon: '📺', width: 50, height: 8 },
      { key: 'tv-stand', label: 'TV Stand', icon: '🗄️', width: 50, height: 14 },
      { key: 'console', label: 'Console', icon: '🪵', width: 40, height: 12 },
      { key: 'fireplace', label: 'Fireplace', icon: '🔥', width: 40, height: 16 },
      { key: 'bookshelf', label: 'Bookshelf', icon: '📚', width: 30, height: 12 },
      { key: 'piano', label: 'Piano', icon: '🎹', width: 56, height: 40 },
      { key: 'rug', label: 'Rug', icon: '🔳', width: 54, height: 34 },
      { key: 'lamp', label: 'Lamp', icon: '💡', width: 14, height: 14 },
      { key: 'plant', label: 'Plant', icon: '🪴', width: 14, height: 14 },
    ],
  },
  {
    category: 'Bedroom', layer: 'fixture', items: [
      { key: 'bed', label: 'Bed', icon: '🛏️', width: 52, height: 68 },
      { key: 'crib', label: 'Crib', icon: '🧸', width: 28, height: 52 },
      { key: 'nightstand', label: 'Nightstand', icon: '◻', width: 16, height: 16 },
      { key: 'dresser', label: 'Dresser', icon: '🧰', width: 44, height: 18 },
      { key: 'wardrobe', label: 'Wardrobe', icon: '🚪', width: 48, height: 24 },
      { key: 'closet', label: 'Closet', icon: '🧥', width: 40, height: 24 },
      { key: 'mirror', label: 'Mirror', icon: '🪞', width: 24, height: 5 },
      { key: 'vanity', label: 'Vanity', icon: '💄', width: 30, height: 20 },
    ],
  },
  {
    category: 'Kitchen & Dining', layer: 'fixture', items: [
      { key: 'fridge', label: 'Fridge', icon: '🧊', width: 30, height: 28 },
      { key: 'stove', label: 'Stove', icon: '🍳', width: 26, height: 24 },
      { key: 'oven', label: 'Oven', icon: '♨️', width: 26, height: 24 },
      { key: 'microwave', label: 'Microwave', icon: '📟', width: 18, height: 12 },
      { key: 'dishwasher', label: 'Dishwasher', icon: '🧼', width: 22, height: 22 },
      { key: 'island', label: 'Island', icon: '⬛', width: 62, height: 32 },
      { key: 'cabinet', label: 'Cabinet', icon: '🗄️', width: 22, height: 22 },
      { key: 'dining-table', label: 'Dining Table', icon: '🍽️', width: 70, height: 46 },
      { key: 'dining-table-rect', label: 'Dining Table (Rect)', icon: '🍽️', width: 60, height: 30 },
      { key: 'chair', label: 'Chair', icon: '🪑', width: 16, height: 16 },
    ],
  },
  {
    category: 'Office & Misc', layer: 'fixture', items: [
      { key: 'desk', label: 'Desk', icon: '🪵', width: 42, height: 34 },
      { key: 'washer', label: 'Washer', icon: '🌀', width: 24, height: 24 },
      { key: 'dryer', label: 'Dryer', icon: '🌬️', width: 24, height: 24 },
      { key: 'trash', label: 'Trash', icon: '🗑️', width: 12, height: 14 },
      { key: 'ac', label: 'AC Unit', icon: '❄️', width: 22, height: 12 },
      { key: 'pool-table', label: 'Pool Table', icon: '🎱', width: 90, height: 50 },
      { key: 'treadmill', label: 'Treadmill', icon: '🏃', width: 30, height: 60 },
      { key: 'grill', label: 'Grill', icon: '🍖', width: 24, height: 20 },
      { key: 'car', label: 'Car', icon: '🚗', width: 60, height: 110 },
      { key: 'column', label: 'Column', icon: '⚫', width: 16, height: 16 },
      { key: 'stairs', label: 'Stairs', icon: '🪜', width: 30, height: 44 },
    ],
  },
  {
    category: 'Electrical', layer: 'electrical', items: [
      { key: 'outlet', label: 'Outlet', icon: '🔌', width: 14, height: 14 },
      { key: 'outlet-gfci', label: 'GFCI', icon: '🔌', width: 14, height: 14 },
      { key: 'outlet-quad', label: 'Quad Outlet', icon: '🔌', width: 20, height: 12 },
      { key: 'floor-outlet', label: 'Floor Outlet', icon: '🔌', width: 14, height: 14 },
      { key: 'switch', label: 'Switch', icon: '🎚️', width: 14, height: 16 },
      { key: 'switch-3way', label: '3-Way Switch', icon: '🎚️', width: 16, height: 16 },
      { key: 'dimmer', label: 'Dimmer', icon: '🎚️', width: 16, height: 16 },
      { key: 'light-ceiling', label: 'Ceiling Light', icon: '💡', width: 18, height: 18 },
      { key: 'light-recessed', label: 'Recessed Light', icon: '💡', width: 16, height: 16 },
      { key: 'pendant-light', label: 'Pendant', icon: '💡', width: 16, height: 20 },
      { key: 'chandelier', label: 'Chandelier', icon: '🕯️', width: 26, height: 26 },
      { key: 'ceiling-fan', label: 'Ceiling Fan', icon: '🌀', width: 28, height: 28 },
      { key: 'wall-sconce', label: 'Sconce', icon: '🔦', width: 16, height: 14 },
      { key: 'smoke-detector', label: 'Smoke Detector', icon: '🚨', width: 16, height: 16 },
      { key: 'thermostat', label: 'Thermostat', icon: '🌡️', width: 16, height: 16 },
      { key: 'electrical-panel', label: 'Panel', icon: '⚡', width: 20, height: 26 },
      { key: 'tv-outlet', label: 'TV / Data Jack', icon: '📺', width: 14, height: 14 },
    ],
  },
  {
    category: 'Plumbing', layer: 'plumbing', items: [
      { key: 'sink', label: 'Sink', icon: '🚰', width: 26, height: 18 },
      { key: 'kitchen-sink', label: 'Kitchen Sink', icon: '🚰', width: 44, height: 24 },
      { key: 'double-sink', label: 'Double Sink', icon: '🚰', width: 40, height: 22 },
      { key: 'toilet', label: 'Toilet', icon: '🚽', width: 18, height: 26 },
      { key: 'bidet', label: 'Bidet', icon: '🚽', width: 18, height: 22 },
      { key: 'bathtub', label: 'Bathtub', icon: '🛁', width: 50, height: 28 },
      { key: 'shower', label: 'Shower', icon: '🚿', width: 32, height: 32 },
      { key: 'water-heater', label: 'Water Heater', icon: '♨️', width: 20, height: 20 },
      { key: 'floor-drain', label: 'Floor Drain', icon: '⚫', width: 14, height: 14 },
      { key: 'hose-bib', label: 'Hose Bib', icon: '🚰', width: 10, height: 10 },
      { key: 'washer-box', label: 'Washer Box', icon: '🧺', width: 18, height: 14 },
      { key: 'water-meter', label: 'Water Meter', icon: '⏱️', width: 16, height: 16 },
      { key: 'gas-valve', label: 'Gas Valve', icon: '🔥', width: 12, height: 12 },
    ],
  },
];

// Flat list (derived) — each symbol carries the layer it places onto.
const HOUSEHOLD_SYMBOLS = SYMBOL_CATALOG.flatMap(section =>
  section.items.map(item => ({ ...item, layer: section.layer })));

function fixtureSubtype(item) {
  const text = `${item.type || ''} ${item.label || ''}`.toLowerCase();
  if (text.includes('door')) return 'door';
  if (text.includes('window')) return 'window';
  if (text.includes('stair')) return 'stairs';
  return 'fixture';
}

function hasMeaningfulLabel(label) {
  if (typeof label !== 'string') return false;
  const text = label.trim();
  if (!text) return false;
  return !/^(room|wall|electrical|plumbing|fixture|item|space)$/i.test(text);
}

function pointFromEvent(svg, event) {
  const touchPoint = event.touches && event.touches[0]
    ? event.touches[0]
    : event.changedTouches && event.changedTouches[0]
      ? event.changedTouches[0]
      : null;
  const source = touchPoint || event;
  const rect = svg.getBoundingClientRect();
  const clientX = source.clientX ?? rect.left;
  const clientY = source.clientY ?? rect.top;

  // Map screen → SVG user units via the live screen CTM. This correctly
  // accounts for preserveAspectRatio letterboxing (critical in fullscreen
  // focus mode where the canvas aspect ratio differs from the viewBox).
  let x;
  let y;
  const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (ctm && typeof svg.createSVGPoint === 'function') {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    x = local.x;
    y = local.y;
  } else {
    x = ((clientX - rect.left) / rect.width) * 960;
    y = ((clientY - rect.top) / rect.height) * 620;
  }
  return { x, y };
}

function createFence(item, start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function createItem(kind, start, end) {
  const id = `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (kind === 'room') {
    const fence = createFence({}, start, end);
    return {
      id,
      kind,
      type: 'Room',
      label: '',
      layer: 'room',
      x: fence.x,
      y: fence.y,
      width: fence.width,
      height: fence.height,
    };
  }

  if (kind === 'wall') {
    return {
      id,
      kind,
      type: 'Wall',
      label: '',
      layer: 'structure',
      x: start.x,
      y: start.y,
      x2: end.x,
      y2: end.y,
      length: Math.hypot(end.x - start.x, end.y - start.y),
      width: Math.max(10, Math.abs(end.x - start.x)),
      height: Math.max(10, Math.abs(end.y - start.y)),
    };
  }

  return {
    id,
    kind,
    type: kind === 'electrical' ? 'Electrical' : 'Plumbing',
    label: '',
    layer: kind,
    x: end.x,
    y: end.y,
    width: 18,
    height: 18,
  };
}

/* ---------- Geometry helpers for trim & join (row 19) ---------- */

/** Intersection of two infinite lines through segments p1→p2 and p3→p4.
 * @returns {{x:number,y:number,t:number,u:number}|null} with parametric
 *   positions t (on seg A) and u (on seg B), or null when parallel.
 */
function lineIntersection(p1, p2, p3, p4) {
  const d = ((p2.x - p1.x) * (p4.y - p3.y)) - ((p2.y - p1.y) * (p4.x - p3.x));
  if (Math.abs(d) < 1e-6) return null;
  const t = (((p3.x - p1.x) * (p4.y - p3.y)) - ((p3.y - p1.y) * (p4.x - p3.x))) / d;
  const u = (((p3.x - p1.x) * (p2.y - p1.y)) - ((p3.y - p1.y) * (p2.x - p1.x))) / d;
  return { x: p1.x + (t * (p2.x - p1.x)), y: p1.y + (t * (p2.y - p1.y)), t, u };
}

/** Parametric position (0..1, unclamped) of a point projected onto a segment. */
function paramOnSegment(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = (vx * vx) + (vy * vy);
  if (lenSq === 0) return 0;
  return (((point.x - a.x) * vx) + ((point.y - a.y) * vy)) / lenSq;
}

const definition = {
  name: 'Floor Plan',
  icon: '🏠',
  color: '#0f766e',
  priority: 22,
  defaultHeaders: ['Type', 'Label', 'Layer', 'X', 'Y', 'Width', 'Height', 'Length', 'Notes'],

  detect(lower) {
    const hasType = lower.some(h => /^(type|kind|category|item|entity)/.test(h));
    const hasCoords = lower.some(h => /^(x|y|width|height|length|depth|offset)/.test(h));
    const hasRoom = lower.some(h => /^(room|space|zone|area)/.test(h));
    const hasUtility = lower.some(h => /^(wall|fixture|electrical|plumbing|outlet|sink|toilet|light)/.test(h));
    const hasLayer = lower.some(h => /^(layer|service|system|overlay)/.test(h));
    return hasType && hasCoords && (hasRoom || hasUtility || hasLayer);
  },

  columns(lower) {
    const cols = {
      type: -1,
      label: -1,
      text: -1,
      layer: -1,
      x: -1,
      y: -1,
      width: -1,
      height: -1,
      length: -1,
      notes: -1,
      name: -1,
    };

    cols.type = lower.findIndex(h => /^(type|kind|category|item|entity|object)/.test(h));
    cols.label = lower.findIndex(h => /^(label|name|title|room|fixture|element)/.test(h));
    cols.text = lower.findIndex(h => /^(text|label|name|title)/.test(h));
    cols.layer = lower.findIndex(h => /^(layer|overlay|service|system|group)/.test(h));
    cols.x = lower.findIndex(h => /^(x|xpos|x_pos|left|offsetx)/.test(h));
    cols.y = lower.findIndex(h => /^(y|ypos|y_pos|top|offsety)/.test(h));
    cols.width = lower.findIndex(h => /^(width|w|sizex|span)/.test(h));
    cols.height = lower.findIndex(h => /^(height|h|sizey|depth)/.test(h));
    cols.length = lower.findIndex(h => /^(length|len|distance|run)/.test(h));
    cols.notes = lower.findIndex(h => /^(notes?|details?|description|comment)/.test(h));
    cols.name = lower.findIndex(h => /^(name|title|label)/.test(h));

    if (cols.label === -1 && cols.name !== -1) cols.label = cols.name;
    if (cols.label === -1 && cols.text !== -1) cols.label = cols.text;

    return cols;
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    let items = rows
      .map((row, index) => {
        const type = normalizeText(cell(row, cols.type) || cell(row, cols.text) || cell(row, cols.name));
        const label = normalizeText(cell(row, cols.label) || cell(row, cols.text) || cell(row, cols.name) || type || `Item ${index + 1}`);
        const layer = normalizeText(cell(row, cols.layer) || type || 'floor');
        const x = parseFloatValue(cell(row, cols.x));
        const y = parseFloatValue(cell(row, cols.y));
        const width = parseFloatValue(cell(row, cols.width));
        const height = parseFloatValue(cell(row, cols.height));
        const length = parseFloatValue(cell(row, cols.length));
        const notes = normalizeText(cell(row, cols.notes));

        if (!type && !label && !layer && x === 0 && y === 0 && width === 0 && height === 0 && length === 0 && !notes) {
          return null;
        }

        const kind = classifyItem({ type, label, layer });
        return {
          id: `sheet-${index + 1}`,
          index,
          kind,
          type,
          label,
          layer,
          x,
          y,
          width,
          height,
          length,
          notes,
          floor: parseFloorNumber(layer, notes),
          interior: [],
          zIndex: index,
          aiPrompt: '',
          referencePhoto: '',
          aspectLocked: true,
        };
      })
      .filter(Boolean);

    const sheetId = String(template?._currentSheetId || 'unknown-sheet');
    const draftStorageKey = `waymark_floorplan_draft_${sheetId}`;
    let loadedSheetState = false;
    let needsSheetMigration = false;
    let requiresDrivePicker = false;
    let draftCustomLayers = null;
    let savedSheetState = null;
    const stateTab = readSheetTab(template?._tabs, FLOORPLAN_STATE_TAB);
    if (stateTab && Array.isArray(stateTab.values)) {
      try {
        const serialized = stateTab.values.slice(1).map(row => String(row?.[0] || '')).join('');
        const saved = JSON.parse(serialized);
        if (saved?.schema === 'waymark.floorplan-state' && Array.isArray(saved.items)) {
          savedSheetState = saved;
        }
      } catch (error) {
        console.warn('[floorplan] sheet-state-load failed:', error);
      }
    }
    let localDraft = null;
    try {
      const rawDraft = storage.getRaw(draftStorageKey);
      if (rawDraft) localDraft = JSON.parse(rawDraft);
    } catch (error) {
      console.warn('[floorplan] draft-load failed:', error);
    }
    if (savedSheetState) {
      items = savedSheetState.items;
      draftCustomLayers = Array.isArray(savedSheetState.customLayers) ? savedSheetState.customLayers : null;
      loadedSheetState = true;
      // Recover a newer local edit if the browser closed while its sheet write was pending.
      const localUpdatedAt = Date.parse(localDraft?.updatedAt || '');
      const sheetUpdatedAt = Date.parse(savedSheetState.updatedAt || '');
      const localDraftPending = localDraft?.updatedAt && localDraft.syncedAt !== localDraft.updatedAt;
      if (Array.isArray(localDraft?.items) && localDraftPending && localUpdatedAt && (!sheetUpdatedAt || localUpdatedAt > sheetUpdatedAt)) {
        items = localDraft.items;
        draftCustomLayers = Array.isArray(localDraft.customLayers) ? localDraft.customLayers : null;
        loadedSheetState = false;
        needsSheetMigration = true;
        requiresDrivePicker = Boolean(localDraft.requiresDrivePicker);
      }
      debugLog('sheet-state-load', { sheetId, count: items.length });
    } else if (Array.isArray(localDraft?.items)) {
      items = localDraft.items;
      draftCustomLayers = Array.isArray(localDraft.customLayers) ? localDraft.customLayers : null;
      needsSheetMigration = true;
      requiresDrivePicker = Boolean(localDraft.requiresDrivePicker);
      debugLog('draft-load', { sheetId, count: items.length });
    }

    const toolButton = (tool, icon, label) => el('button', {
      className: `floorplan-tool-button${tool === 'wall' ? ' active' : ''}`,
      type: 'button',
      title: label,
      dataset: { tool },
      on: { click: () => setTool(tool) },
    }, [
      el('span', { className: 'floorplan-tool-icon' }, [icon]),
      el('span', { className: 'floorplan-tool-label' }, [label]),
    ]);

    const actionButton = (className, icon, label, handler) => el('button', {
      className: `floorplan-tool-button ${className}`,
      type: 'button',
      title: label,
      on: { click: handler },
    }, [
      el('span', { className: 'floorplan-tool-icon' }, [icon]),
      el('span', { className: 'floorplan-tool-label' }, [label]),
    ]);

    const railSection = (heading, children) => el('div', { className: 'floorplan-rail-section' }, [
      el('div', { className: 'floorplan-rail-heading' }, [heading]),
      el('div', { className: 'floorplan-rail-tools' }, children),
    ]);

    const board = el('div', { className: 'floorplan-board floorplan-fullscreen' }, [
      /* ---------- Top action bar ---------- */
      el('header', { className: 'floorplan-topbar' }, [
        el('div', { className: 'floorplan-brand' }, [
          el('span', { className: 'floorplan-title-icon' }, ['🏠']),
          el('span', { className: 'floorplan-title' }, ['House Plan']),
        ]),
        el('div', { className: 'floorplan-topbar-left' }, [
          el('div', { className: 'floorplan-floor-controls' }, [
            el('button', { className: 'floorplan-floor-btn floorplan-floor-prev', type: 'button', title: 'Previous floor', on: { click: () => shiftFloor(-1) } }, ['‹']),
            el('span', { className: 'floorplan-floor-indicator' }, ['Floor 1']),
            el('button', { className: 'floorplan-floor-btn floorplan-floor-next', type: 'button', title: 'Next floor', on: { click: () => shiftFloor(1) } }, ['›']),
          ]),
          el('button', { className: 'floorplan-toggle-btn floorplan-align-btn', type: 'button', title: 'Overlay the floor below as a reference', on: { click: () => toggleAlignBelow() } }, ['Align Below: Off']),
        ]),
        el('div', { className: 'floorplan-topbar-center floorplan-view-switcher', role: 'tablist', 'aria-label': 'View switcher' }, [
          el('button', { className: 'floorplan-view-btn active', type: 'button', dataset: { view: 'blueprint' }, on: { click: () => setViewMode('blueprint') } }, ['2D Blueprint']),
          el('button', { className: 'floorplan-view-btn', type: 'button', dataset: { view: 'interior' }, on: { click: () => setViewMode('interior') } }, ['3D Interior']),
          el('button', { className: 'floorplan-view-btn floorplan-ai-render-btn', type: 'button', dataset: { view: 'render' }, title: 'Pick a viewpoint and render a 3D view of the space', on: { click: () => { setViewMode('render'); openFloorplanAiRenderModal({ items: state.items }); } } }, ['Render Space']),
        ]),
        el('div', { className: 'floorplan-topbar-right' }, [
          el('button', { className: 'floorplan-secondary-btn floorplan-auto-wall-btn', type: 'button', title: 'Generate walls around every room', on: { click: () => autoGenerateWallsFromRooms() } }, ['Auto Walls']),
          el('button', { className: 'floorplan-secondary-btn floorplan-load-preset-btn', type: 'button', title: 'Load the example floor-one layout', on: { click: () => loadFloorOnePreset() } }, ['Load Example']),
          el('button', { className: 'floorplan-secondary-btn floorplan-focus-toggle-btn', type: 'button', title: 'Toggle fullscreen focus mode', on: { click: () => toggleFocusMode() } }, ['Exit Focus']),
          el('button', { className: 'floorplan-secondary-btn floorplan-interior-toggle-btn', type: 'button', title: 'Toggle the 3D interior box view', on: { click: () => toggleInteriorView() } }, ['3D Interior: Off']),
          el('div', { className: 'floorplan-export-wrap' }, [
            el('button', { className: 'floorplan-export-btn', type: 'button', title: 'Export the plan to PDF', on: { click: () => window.print() } }, ['Export PDF']),
            el('button', { className: 'floorplan-export-menu-btn', type: 'button', title: 'More export options', on: { click: () => toggleExportMenu() } }, ['▾']),
            el('div', { className: 'floorplan-export-menu hidden' }, [
              el('button', { className: 'floorplan-export-jpeg', type: 'button', on: { click: () => exportHighResJpeg() } }, ['High-res JPEG (2x)']),
              el('button', { className: 'floorplan-export-pdf', type: 'button', on: { click: () => exportPdfReport() } }, ['Project PDF report']),
              el('button', { className: 'floorplan-export-3d-jpeg', type: 'button', on: { pointerdown: () => export3dJpeg(), click: () => export3dJpeg() } }, ['3D Render JPEG']),
              el('button', { className: 'floorplan-export-3d-pdf', type: 'button', on: { pointerdown: () => export3dPdf(), click: () => export3dPdf() } }, ['3D Render PDF']),
            ]),
          ]),
          el('button', { className: 'floorplan-mobile-overflow-btn', type: 'button', title: 'More actions', on: { click: () => toggleMobileOverflow() } }, ['⋯']),
        ]),
      ]),

      /* ---------- Main body: tool rail + canvas + panel ---------- */
      el('div', { className: 'floorplan-body' }, [
        /* Left vertical tool rail */
        el('aside', { className: 'floorplan-rail' }, [
          railSection('Draw', [
            toolButton('wall', '▭', 'Wall'),
            toolButton('wall-rect', '▦', 'Wall Box'),
            toolButton('room', '▢', 'Room'),
            toolButton('line', '╱', 'Line'),
            toolButton('circle', '◯', 'Circle'),
            toolButton('measure', '📏', 'Measure'),
            toolButton('door', '🚪', 'Door'),
            toolButton('window', '🪟', 'Window'),
            toolButton('stairs', '🪜', 'Stairs'),
          ]),
          railSection('Edit', [
            toolButton('select', '✦', 'Select'),
            toolButton('trim', '✂', 'Trim'),
            toolButton('erase', '⌫', 'Erase'),
            actionButton('floorplan-undo-btn', '↶', 'Undo', () => undoLatest()),
            actionButton('floorplan-rect-mode-btn floorplan-toggle-compact active', '⛓️', 'Corners: On', () => toggleRectDisconnected()),
          ]),
        ]),

        /* Center canvas column */
        el('div', { className: 'floorplan-canvas-col' }, [
          el('div', { className: 'floorplan-statusbar floorplan-floating-hud' }, [
            el('span', { className: 'floorplan-hint', 'aria-live': 'polite' }, [TOOL_HINTS.wall]),
            el('span', { className: 'floorplan-feedback', 'aria-live': 'polite' }, ['Ready']),
          ]),
          el('div', { className: 'floorplan-stage' }, [
            el('div', { className: 'floorplan-prop-toolbar hidden', role: 'toolbar', 'aria-label': 'Selected object tools' }, [
              el('span', { className: 'floorplan-prop-dims' }, ['']),
              el('span', { className: 'floorplan-prop-divider' }, []),
              el('button', { className: 'floorplan-prop-btn floorplan-z-front', type: 'button', title: 'Bring to Front (Ctrl+Shift+])', on: { click: () => reorderSelection('front') } }, ['Front']),
              el('button', { className: 'floorplan-prop-btn floorplan-z-forward', type: 'button', title: 'Bring Forward (Ctrl+])', on: { click: () => reorderSelection('forward') } }, ['Fwd']),
              el('button', { className: 'floorplan-prop-btn floorplan-z-backward', type: 'button', title: 'Send Backward (Ctrl+[)', on: { click: () => reorderSelection('backward') } }, ['Back']),
              el('button', { className: 'floorplan-prop-btn floorplan-z-back', type: 'button', title: 'Send to Back (Ctrl+Shift+[)', on: { click: () => reorderSelection('back') } }, ['Bottom']),
              el('span', { className: 'floorplan-prop-divider' }, []),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-rotate-left', type: 'button', title: 'Rotate left 15° (Shift+R)', on: { click: () => rotateSelection(-15) } }, ['⟲']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-rotate-right', type: 'button', title: 'Rotate right 15° (R)', on: { click: () => rotateSelection(15) } }, ['⟳']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-flip-h', type: 'button', title: 'Flip horizontal (F)', on: { click: () => flipSelection('h') } }, ['⇋']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-flip-v', type: 'button', title: 'Flip vertical (Shift+F)', on: { click: () => flipSelection('v') } }, ['⤊']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-door floorplan-prop-hinge hidden', type: 'button', title: 'Flip door hinge side', on: { click: () => toggleDoorSwing('side') } }, ['Hinge']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-door floorplan-prop-swing hidden', type: 'button', title: 'Flip door swing direction', on: { click: () => toggleDoorSwing('dir') } }, ['Swing']),
              el('span', { className: 'floorplan-prop-divider' }, []),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-duplicate', type: 'button', title: 'Duplicate (Ctrl+D)', on: { click: () => duplicateSelection() } }, ['⧉']),
              el('button', { className: 'floorplan-prop-btn floorplan-prop-delete', type: 'button', title: 'Delete (Del)', on: { click: () => deleteSelection() } }, ['🗑']),
            ]),
            svgEl('svg', {
              className: 'floorplan-svg',
              viewBox: '0 0 960 620',
              width: '100%',
              height: '620',
              preserveAspectRatio: 'xMidYMid meet',
              role: 'img',
              'aria-label': 'House floor plan',
              'data-floorplan-svg': 'true',
              style: { touchAction: 'none' },
            }, []),
            /* ---------- Floating zoom toolbar (row 18) ---------- */
            el('div', { className: 'floorplan-zoom-toolbar', role: 'toolbar', 'aria-label': 'Zoom controls' }, [
              el('button', { className: 'floorplan-zoom-btn floorplan-zoom-out', type: 'button', title: 'Zoom out (Ctrl -)', 'aria-label': 'Zoom out', on: { click: () => zoomByStep(1 / 1.2) } }, ['−']),
              el('button', { className: 'floorplan-zoom-readout', type: 'button', title: 'Reset zoom to 100% (Ctrl 0)', 'aria-label': 'Reset zoom', on: { click: () => resetView() } }, ['100%']),
              el('button', { className: 'floorplan-zoom-btn floorplan-zoom-in', type: 'button', title: 'Zoom in (Ctrl +)', 'aria-label': 'Zoom in', on: { click: () => zoomByStep(1.2) } }, ['+']),
              el('button', { className: 'floorplan-zoom-btn floorplan-zoom-fit', type: 'button', title: 'Zoom to fit the whole drawing', 'aria-label': 'Zoom to fit', on: { click: () => zoomToFit() } }, ['⤢ Fit']),
            ]),
            el('div', { className: 'floorplan-snap-hud' }, [
              el('button', { className: 'floorplan-snap-pill', type: 'button', on: { click: () => cycleSnapUnit() } }, ['Snap: 1 ft']),
              el('button', { className: 'floorplan-grid-pill', type: 'button', on: { click: () => cycleGridUnit() } }, ['Grid: 4 ft']),
              el('button', { className: 'floorplan-clear-guard-btn', type: 'button', on: { click: () => toggleClearConfirm() } }, ['Clear']),
              el('div', { className: 'floorplan-clear-popover hidden' }, [
                el('span', {}, ['Clear all floor plan objects?']),
                el('button', { className: 'floorplan-clear-confirm', type: 'button', on: { click: () => clearAllItems() } }, ['Confirm Clear']),
              ]),
            ]),
            el('div', { className: 'floorplan-mobile-dock' }, [
              el('button', { className: 'floorplan-dock-btn', type: 'button', on: { click: () => setPanelTab('symbols', true) } }, ['Symbols']),
              el('button', { className: 'floorplan-dock-btn', type: 'button', on: { click: () => setPanelTab('layers', true) } }, ['Layers']),
            ]),
            /* ---------- Line/shape style toolbar (row 24) — shown when the line or circle tool is active ---------- */
            el('div', { className: 'floorplan-line-toolbar hidden', role: 'toolbar', 'aria-label': 'Line style' }, [
              el('span', { className: 'floorplan-line-toolbar-label' }, ['Line style']),
              lineTypeSelect(DEFAULT_LINE_STYLE.lineType, (v) => { state.lineStyle.lineType = v; }),
              strokeWidthInput(DEFAULT_LINE_STYLE.strokeWidth, (v) => { state.lineStyle.strokeWidth = v; }),
              strokeColorControl(DEFAULT_LINE_STYLE.strokeColor, (v) => { state.lineStyle.strokeColor = v; }),
              el('button', { className: 'floorplan-line-finish-btn', type: 'button', title: 'Finish the current line as an open path (Enter)', on: { click: () => finalizeLine(false) } }, ['Finish Line']),
            ]),
            /* ---------- Selection properties inspector (rows 17, 21, 22, 24, 26, 28) ---------- */
            el('div', { className: 'floorplan-inspector hidden', role: 'region', 'aria-label': 'Selection properties' }, []),
          ]),
        ]),

        /* Right panel: Symbols + Layers + Interior */
        el('aside', { className: 'floorplan-panel' }, [
          el('div', { className: 'floorplan-panel-tabs' }, [
            el('button', { className: 'floorplan-panel-tab active', type: 'button', dataset: { tab: 'symbols' }, on: { click: () => setPanelTab('symbols') } }, ['Symbols']),
            el('button', { className: 'floorplan-panel-tab', type: 'button', dataset: { tab: 'layers' }, on: { click: () => setPanelTab('layers') } }, ['Layers']),
          ]),
          el('div', { className: 'floorplan-panel-section floorplan-symbol-panel', dataset: { panel: 'symbols' } }, [
            el('input', { className: 'floorplan-symbol-search', type: 'search', placeholder: 'Search symbols...', on: { input: (e) => filterSymbols(e.target.value) } }),
            el('div', { className: 'floorplan-symbol-jumps' }, SYMBOL_CATALOG.map(section => el('button', {
              className: 'floorplan-symbol-jump', type: 'button', dataset: { category: section.category.toLowerCase() },
              on: { click: () => jumpSymbolCategory(section.category) },
            }, [section.category.replace(' & Dining', '').replace(' & Misc', '')]))),
            ...SYMBOL_CATALOG.map(section => el('div', { className: 'floorplan-symbol-group', dataset: { category: section.category.toLowerCase() } }, [
              el('button', { className: 'floorplan-symbol-group-heading', type: 'button', on: { click: () => jumpSymbolCategory(section.category) } }, [section.category]),
              el('div', { className: 'floorplan-symbol-grid' }, section.items.map(symbol => el('button', {
                className: `floorplan-symbol-choice${symbol.key === HOUSEHOLD_SYMBOLS[0].key ? ' active' : ''}`,
                type: 'button',
                title: `${symbol.label} · ${formatFeet(symbol.width)} × ${formatFeet(symbol.height)}`,
                dataset: { symbolKey: symbol.key, symbolLabel: symbol.label.toLowerCase(), symbolCategory: section.category.toLowerCase() },
                on: { click: () => setSymbolPreset(symbol.key) },
              }, [
                el('span', { className: 'floorplan-symbol-choice-icon' }, [symbol.icon]),
                el('span', { className: 'floorplan-symbol-choice-label' }, [symbol.label]),
              ]))),
            ])),
          ]),
          el('div', { className: 'floorplan-panel-section floorplan-layers-panel', dataset: { panel: 'layers' } }, [
            el('div', { className: 'floorplan-panel-heading' }, ['Layers']),
            el('div', { className: 'floorplan-layer-grid' }, [
              ['room', 'Rooms'],
              ['wall', 'Walls'],
              ['electrical', 'Electrical'],
              ['plumbing', 'Plumbing'],
              ['fixture', 'Fixtures'],
              ['line', 'Lines'],
            ].map(([layer, text]) => el('div', { className: 'floorplan-layer-row' }, [
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', title: `Show ${text.toLowerCase()}`, dataset: { layer } }, [text]),
              el('button', { className: 'floorplan-layer-lock', type: 'button', title: `Lock ${text.toLowerCase()} layer`, 'aria-pressed': 'false', dataset: { layer } }, ['🔓']),
            ]))),
            el('div', { className: 'floorplan-custom-layers' }, []),
            el('button', { className: 'floorplan-add-layer-btn', type: 'button', title: 'Add a custom layer (Electrical, Plumbing, HVAC…)', on: { click: () => addCustomLayer() } }, ['+ Add Layer']),
            el('div', { className: 'floorplan-overlay-actions' }, [
              el('button', { className: 'floorplan-clearance-toggle', type: 'button', on: { click: () => toggleOverlay('clearance') } }, ['Clearance Overlay']),
              el('button', { className: 'floorplan-lighting-toggle', type: 'button', on: { click: () => toggleOverlay('lighting') } }, ['Coverage Overlay']),
              el('button', { className: 'floorplan-bom-btn', type: 'button', on: { click: () => renderBomTable() } }, ['Estimate Cost / Send to Budget']),
              el('div', { className: 'floorplan-bom-table hidden' }, []),
            ]),
          ]),
          el('div', { className: 'floorplan-panel-section floorplan-interior-panel hidden' }, [
            el('div', { className: 'floorplan-panel-heading' }, ['3D Interior Box']),
            el('span', { className: 'floorplan-interior-subtitle' }, ['Select a room, then tap a wall/floor face to place symbols inside.']),
            svgEl('svg', {
              className: 'floorplan-interior-svg',
              viewBox: '0 0 320 260',
              role: 'img',
              'aria-label': 'Interior box room view',
            }, []),
          ]),
        ]),
      ]),
    ]);

    const svg = board.querySelector('.floorplan-svg');
    const hint = board.querySelector('.floorplan-hint');
    const feedback = board.querySelector('.floorplan-feedback');
    const interiorPanel = board.querySelector('.floorplan-interior-panel');
    const interiorSvg = board.querySelector('.floorplan-interior-svg');
    const propToolbar = board.querySelector('.floorplan-prop-toolbar');
    const scene = svgEl('g', { className: 'floorplan-scene' });
    const bg = svgEl('rect', {
      x: -100000,
      y: -100000,
      width: 200000,
      height: 200000,
      fill: '#ffffff',
      stroke: 'none',
    });
    svg.append(bg);
    const gridLayer = svgEl('g', { className: 'floorplan-grid-layer' });
    svg.append(gridLayer);
    svg.append(scene);

    const state = {
      tool: 'wall',
      items,
      symbolPreset: HOUSEHOLD_SYMBOLS[0],
      rectDisconnected: false,
      currentFloor: 1,
      alignBelow: false,
      interiorEnabled: false,
      layerVisibility: {
        room: true,
        wall: true,
        electrical: true,
        plumbing: true,
        fixture: true,
        line: true,
      },
      layerLocks: {
        room: false,
        wall: false,
        electrical: false,
        plumbing: false,
        fixture: false,
        line: false,
      },
      customLayers: [],
      preview: null,
      lineDraft: null,
      lineCursor: null,
      lineStyle: { ...DEFAULT_LINE_STYLE },
      view: { zoom: 1, x: 0, y: 0 },
      gestureActive: false,
      vertexDrag: null,
      dragStart: null,
      dragIds: [],
      dragOrigins: null,
      marquee: null,
      resizeDrag: null,
      selectedId: null,
      selectedIds: new Set(),
      undoStack: [],
      redoStack: [],
      lastCreateAt: 0,
      lastStartAt: 0,
      lastStartPoint: null,
      clipboardItems: [],
      lastPointer: null,
      tempTool: null,
      previousTool: null,
      panning: null,
      aspectLocked: true,
      snapIndex: 0,
      gridIndex: 0,
      overlays: { clearance: false, lighting: false },
      viewMode: 'blueprint',
    };

    let persistTimer = null;
    let cloudSaveQueue = Promise.resolve();
    let pendingSheetSave = null;
    let pendingCloudWrites = 0;
    let cloudSaveBlocked = requiresDrivePicker;
    let cloudSaveFailed = cloudSaveBlocked;
    let cloudSaveErrorShown = false;

    function buildStatePayload() {
      return {
        schema: 'waymark.floorplan-state',
        version: 1,
        updatedAt: new Date().toISOString(),
        items: state.items,
        customLayers: state.customLayers,
      };
    }

    function persistDraftState(payload) {
      try {
        if (cloudSaveBlocked) payload.requiresDrivePicker = true;
        else delete payload.requiresDrivePicker;
        storage.setRaw(draftStorageKey, JSON.stringify(payload));
      } catch (error) {
        console.warn('[floorplan] draft-save failed:', error);
      }
    }

    function updateCachedSheetTab(rows) {
      if (!Array.isArray(template?._tabs)) return;
      let tab = readSheetTab(template._tabs, FLOORPLAN_STATE_TAB);
      if (!tab) {
        tab = { title: FLOORPLAN_STATE_TAB, values: rows };
        template._tabs.push(tab);
      } else {
        tab.values = rows;
      }
    }

    function markLocalDraftSynced(payload) {
      try {
        const draft = JSON.parse(storage.getRaw(draftStorageKey) || 'null');
        if (draft?.updatedAt !== payload.updatedAt) return;
        draft.syncedAt = payload.updatedAt;
        delete draft.requiresDrivePicker;
        storage.setRaw(draftStorageKey, JSON.stringify(draft));
      } catch (error) {
        console.warn('[floorplan] draft-sync-marker failed:', error);
      }
    }

    function queueSheetStateWrite(payload) {
      if (sheetId === 'unknown-sheet') return;
      const serialized = JSON.stringify(payload);
      const chunks = serialized.match(new RegExp(`[\\s\\S]{1,${FLOORPLAN_STATE_CHUNK_SIZE}}`, 'g')) || [''];
      const rows = [[FLOORPLAN_STATE_HEADER], ...chunks.map(chunk => [chunk])];
      updateCachedSheetTab(rows);
      if (cloudSaveBlocked) {
        setFeedback('Saved locally · Drive access needed');
        return;
      }

      // Keep only the newest waiting snapshot while a save is in flight.
      pendingSheetSave = { payload, rows };
      setFeedback('Saving to sheet');
      startNextSheetSave();
    }

    function startNextSheetSave() {
      if (pendingCloudWrites > 0 || !pendingSheetSave || cloudSaveBlocked) return;
      const { payload, rows } = pendingSheetSave;
      pendingSheetSave = null;
      pendingCloudWrites = 1;
      cloudSaveFailed = false;
      cloudSaveQueue = cloudSaveQueue.catch(() => {}).then(async () => {
        if (cloudSaveBlocked) {
          setFeedback('Saved locally · Drive access needed');
          return;
        }
        await writeSheetTab(sheetId, FLOORPLAN_STATE_TAB, rows);
        markLocalDraftSynced(payload);
        cloudSaveFailed = false;
        cloudSaveErrorShown = false;
        if (!pendingSheetSave && !persistTimer) setFeedback('Saved to sheet');
      }).catch(error => {
        cloudSaveFailed = true;
        console.warn('[floorplan] sheet-state-save failed:', error);
        if (error?.status === 403) {
          cloudSaveBlocked = true;
          try {
            const draft = JSON.parse(storage.getRaw(draftStorageKey) || 'null');
            if (draft) {
              draft.requiresDrivePicker = true;
              storage.setRaw(draftStorageKey, JSON.stringify(draft));
            }
          } catch (storageError) {
            console.warn('[floorplan] draft-access-marker failed:', storageError);
          }
          setFeedback('Sheet access needed');
        } else {
          setFeedback('Saved locally · sheet sync failed');
        }
        if (!cloudSaveErrorShown) {
          showToast(
            error?.status === 403
              ? 'Select this sheet in Drive Picker and confirm you have Editor access'
              : 'Floor plan saved locally; sheet sync failed',
            'error'
          );
          cloudSaveErrorShown = true;
        }
      }).finally(() => {
        pendingCloudWrites = 0;
        startNextSheetSave();
      });
    }

    function queuePersistDraft() {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        const payload = buildStatePayload();
        persistDraftState(payload);
        queueSheetStateWrite(payload);
      }, 350);
    }

    template.canAutoRefresh = () => (
      !state.gestureActive
      && !persistTimer
      && pendingCloudWrites === 0
      && !cloudSaveFailed
      && !document.querySelector('.floorplan-ai-overlay')
    );

    function recordObjectMetadata(item, field, value) {
      if (!window.__WAYMARK_RECORDS__) window.__WAYMARK_RECORDS__ = [];
      window.__WAYMARK_RECORDS__.push({
        type: 'floorplan-object-metadata',
        itemId: String(item.id),
        field,
        value,
      });
    }

    function snapshotState() {
      return {
        items: JSON.parse(JSON.stringify(state.items)),
        currentFloor: state.currentFloor,
        alignBelow: state.alignBelow,
        selectedId: state.selectedId,
        selectedIds: [...state.selectedIds],
      };
    }

    function restoreSnapshot(snapshot) {
      if (!snapshot) return;
      state.items = Array.isArray(snapshot.items) ? snapshot.items : [];
      state.currentFloor = Math.max(1, Number(snapshot.currentFloor) || 1);
      state.alignBelow = !!snapshot.alignBelow;
      state.selectedIds = new Set((snapshot.selectedIds || []).map(String));
      state.selectedId = snapshot.selectedId && state.selectedIds.has(String(snapshot.selectedId))
        ? String(snapshot.selectedId)
        : (state.selectedIds.size === 1 ? [...state.selectedIds][0] : null);
      refreshFloorUi();
      renderScene();
      queuePersistDraft();
      updateUndoUi();
    }

    function pushUndoCheckpoint() {
      state.undoStack.push(snapshotState());
      if (state.undoStack.length > 120) state.undoStack.shift();
      state.redoStack = [];
      updateUndoUi();
    }

    function undoLatest() {
      if (state.undoStack.length === 0) return;
      const prev = state.undoStack.pop();
      state.redoStack.push(snapshotState());
      restoreSnapshot(prev);
      showToast('Undo applied', 'success');
    }

    function redoLatest() {
      if (state.redoStack.length === 0) return;
      const next = state.redoStack.pop();
      state.undoStack.push(snapshotState());
      restoreSnapshot(next);
      showToast('Redo applied', 'success');
    }

    function updateUndoUi() {
      const button = board.querySelector('.floorplan-undo-btn');
      if (button) {
        const hasUndo = state.undoStack.length > 0;
        button.disabled = !hasUndo;
        button.setAttribute('aria-disabled', hasUndo ? 'false' : 'true');
      }
    }

    async function grantDriveAccess() {
      if (!sheetId || sheetId === 'unknown-sheet') return;
      if (grantAccessButton) {
        grantAccessButton.disabled = true;
        grantAccessButton.textContent = 'Opening Picker…';
      }
      try {
        const picked = await api.picker.pickSpreadsheetForInvite({
          fileId: sheetId,
          fileName: template?._currentSpreadsheetTitle || '',
        });
        if (!picked?.id) return;
        if (String(picked.id) !== sheetId) {
          showToast('Select the sheet currently open in Waymark to grant access', 'error');
          return;
        }

        cloudSaveBlocked = false;
        cloudSaveFailed = false;
        cloudSaveErrorShown = false;
        const payload = buildStatePayload();
        persistDraftState(payload);
        queueSheetStateWrite(payload);
      } catch (error) {
        showToast(`Could not open Drive Picker: ${error.message}`, 'error');
      } finally {
        if (grantAccessButton?.isConnected) {
          grantAccessButton.disabled = false;
          grantAccessButton.textContent = 'Grant access';
        }
      }
    }

    let grantAccessButton = null;
    function setFeedback(text, needsDriveAccess = cloudSaveBlocked) {
      if (!feedback) return;
      feedback.textContent = text || 'Ready';
      grantAccessButton = null;
      if (needsDriveAccess) {
        grantAccessButton = el('button', {
          className: 'floorplan-grant-access-btn',
          type: 'button',
          on: { click: grantDriveAccess },
        }, ['Grant access']);
        feedback.append(grantAccessButton);
      }
    }

    function itemFeedbackLabel(item) {
      const kind = item.kind || classifyItem(item);
      const noun = kind.charAt(0).toUpperCase() + kind.slice(1);
      let name = normalizeText(item.label);
      if (!name && kind === 'wall') {
        const edge = getWallEndpoints(item);
        const length = Math.round(Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1));
        name = `Segment ${length}u`;
      }
      if (!name) name = normalizeText(item.type) || noun;
      return `${noun}: ${name} (Floor ${getItemFloor(item)})`;
    }

    function applyControlLabels() {
      board.querySelectorAll('button, summary').forEach((node) => {
        const text = normalizeText(node.textContent || '');
        if (!text) return;
        if (!node.getAttribute('title')) node.setAttribute('title', text);
        if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', text);
      });
    }

    function snapToGrid(point, grid = null) {
      const step = grid || currentSnapUnits();
      if (!step) return { x: point.x, y: point.y };
      return {
        x: Math.round(point.x / step) * step,
        y: Math.round(point.y / step) * step,
      };
    }

    function findItemById(itemId) {
      return state.items.find(entry => String(entry.id) === String(itemId)) || null;
    }

    function isItemSelected(itemId) {
      return state.selectedIds.has(String(itemId));
    }

    function clearSelection() {
      state.selectedIds.clear();
      state.selectedId = null;
      state.resizeDrag = null;
      state.dragIds = [];
      state.dragOrigins = null;
      state.marquee = null;
      renderScene();
    }

    function setSingleSelection(itemId) {
      const normalized = String(itemId);
      state.selectedIds = new Set([normalized]);
      state.selectedId = normalized;
    }

    function toggleSelection(itemId) {
      const normalized = String(itemId);
      if (state.selectedIds.has(normalized)) {
        state.selectedIds.delete(normalized);
      } else {
        state.selectedIds.add(normalized);
      }
      state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
    }

    function selectedItemsOnFloor() {
      return state.items.filter(item => state.selectedIds.has(String(item.id)) && getItemFloor(item) === state.currentFloor);
    }

    function toggleRectDisconnected() {
      state.rectDisconnected = !state.rectDisconnected;
      const button = board.querySelector('.floorplan-rect-mode-btn');
      if (button) {
        button.querySelector('.floorplan-tool-label').textContent = state.rectDisconnected ? 'Corners: Off' : 'Corners: On';
        button.classList.toggle('active', !state.rectDisconnected);
        button.title = `Rectangle corners ${state.rectDisconnected ? 'disconnected' : 'connected'}`;
      }
      if (state.tool === 'wall-rect' && hint) {
        hint.textContent = TOOL_HINTS['wall-rect'];
      }
      applyControlLabels();
      setFeedback(`Action: Rectangle corners ${state.rectDisconnected ? 'disconnected' : 'connected'}`);
    }

    function registerNewItem(item) {
      if (!item) return null;
      item.floor = state.currentFloor;
      if (!Array.isArray(item.interior)) item.interior = [];
      if (!Number.isFinite(Number(item.zIndex))) item.zIndex = nextZIndex();
      if (item.aspectLocked == null) item.aspectLocked = true;
      return item;
    }

    function nextZIndex() {
      return state.items.reduce((max, item) => Math.max(max, Number(item.zIndex) || 0), 0) + 1;
    }

    function reorderSelection(mode) {
      const targets = editableSelection();
      if (!targets.length) return;
      pushUndoCheckpoint();
      if (mode === 'front') {
        let z = nextZIndex();
        targets.forEach(item => { item.zIndex = z; z += 1; });
      } else if (mode === 'back') {
        let z = Math.min(0, ...state.items.map(item => Number(item.zIndex) || 0)) - targets.length;
        targets.forEach(item => { item.zIndex = z; z += 1; });
      } else {
        const delta = mode === 'forward' ? 1 : -1;
        targets.forEach(item => { item.zIndex = (Number(item.zIndex) || 0) + delta; });
      }
      renderScene();
      queuePersistDraft();
      setFeedback(`Z order: ${mode}`);
    }

    function showContextMenu(clientX, clientY, itemId) {
      board.querySelector('.floorplan-context-menu')?.remove();
      if (itemId) setSingleSelection(itemId);
      const menu = el('div', { className: 'floorplan-context-menu', style: { left: `${clientX}px`, top: `${clientY}px` } }, [
        el('button', { className: 'floorplan-context-front', type: 'button', on: { click: () => { reorderSelection('front'); menu.remove(); } } }, ['Bring to Front']),
        el('button', { className: 'floorplan-context-forward', type: 'button', on: { click: () => { reorderSelection('forward'); menu.remove(); } } }, ['Bring Forward']),
        el('button', { className: 'floorplan-context-backward', type: 'button', on: { click: () => { reorderSelection('backward'); menu.remove(); } } }, ['Send Backward']),
        el('button', { className: 'floorplan-context-back', type: 'button', on: { click: () => { reorderSelection('back'); menu.remove(); } } }, ['Send to Back']),
      ]);
      board.append(menu);
      renderScene();
    }

    function getItemFloor(item) {
      const floor = Number(item.floor);
      return Number.isFinite(floor) && floor > 0 ? floor : 1;
    }

    function getWallEndpoints(wall) {
      const x1 = wall.x;
      const y1 = wall.y;
      if (typeof wall.x2 === 'number' && typeof wall.y2 === 'number') {
        return { x1, y1, x2: wall.x2, y2: wall.y2 };
      }

      const length = Number(wall.length) || 0;
      const width = Number(wall.width) || 0;
      const height = Number(wall.height) || 0;

      let x2 = x1 + 120;
      let y2 = y1;

      if (length !== 0 && Math.abs(length) >= Math.abs(height) && Math.abs(length) >= Math.abs(width)) {
        x2 = x1 + length;
        y2 = y1;
      } else if (height !== 0 && Math.abs(height) >= Math.abs(width)) {
        x2 = x1;
        y2 = y1 + height;
      } else if (width !== 0) {
        x2 = x1 + width;
        y2 = y1;
      }

      return { x1, y1, x2, y2 };
    }

    /* Doors/windows hosted on a wall (row 28 keeps them anchored). */
    function wallHostedOpenings(wall) {
      if (!wall) return [];
      return state.items.filter((it) => {
        if (String(it.wallId || '') !== String(wall.id)) return false;
        const sub = fixtureSubtype(it);
        return sub === 'door' || sub === 'window';
      });
    }

    /* Re-anchor hosted openings after a wall's endpoints change: each opening
       keeps its fractional position (t) along the wall and re-aligns its angle
       to the new wall direction (row 28). */
    function recomputeWallOpenings(wall, origin) {
      const openings = wallHostedOpenings(wall);
      if (!openings.length) return;
      const ox1 = origin.x1;
      const oy1 = origin.y1;
      const ox2 = origin.x2;
      const oy2 = origin.y2;
      if (![ox1, oy1, ox2, oy2].every(Number.isFinite)) return;
      const oLen2 = ((ox2 - ox1) ** 2 + (oy2 - oy1) ** 2) || 1;
      const now = getWallEndpoints(wall);
      const angle = (Math.atan2(now.y2 - now.y1, now.x2 - now.x1) * 180) / Math.PI;
      openings.forEach((op) => {
        let t = (((op.x - ox1) * (ox2 - ox1)) + ((op.y - oy1) * (oy2 - oy1))) / oLen2;
        t = clamp(t, 0, 1);
        op.x = now.x1 + (now.x2 - now.x1) * t;
        op.y = now.y1 + (now.y2 - now.y1) * t;
        op.angle = angle;
      });
    }

    function getSnapAnchorPoints(skipWallId = null) {
      const anchors = [];
      state.items.forEach((item) => {
        if (getItemFloor(item) !== state.currentFloor) return;
        const kind = item.kind || classifyItem(item);
        if (kind === 'wall' && String(item.id) !== String(skipWallId)) {
          const edge = getWallEndpoints(item);
          anchors.push({ x: edge.x1, y: edge.y1 });
          anchors.push({ x: edge.x2, y: edge.y2 });
        }
        if (kind === 'room') {
          const width = Math.max(40, item.width || 120);
          const height = Math.max(34, item.height || 80);
          anchors.push({ x: item.x, y: item.y });
          anchors.push({ x: item.x + width, y: item.y });
          anchors.push({ x: item.x, y: item.y + height });
          anchors.push({ x: item.x + width, y: item.y + height });
        }
      });
      return anchors;
    }

    function getSnapAxes() {
      const x = [];
      const y = [];
      state.items.forEach((item) => {
        if (getItemFloor(item) !== state.currentFloor) return;
        const kind = item.kind || classifyItem(item);
        if (kind === 'room') {
          const width = Math.max(40, item.width || 120);
          const height = Math.max(34, item.height || 80);
          x.push(item.x, item.x + width);
          y.push(item.y, item.y + height);
        }
        if (kind === 'wall') {
          const edge = getWallEndpoints(item);
          x.push(edge.x1, edge.x2);
          y.push(edge.y1, edge.y2);
        }
      });
      return { x, y };
    }

    function snapPointToAnchors(point, anchors, threshold = 14) {
      let best = null;
      anchors.forEach((anchor) => {
        const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { ...anchor, distance };
        }
      });
      if (!best) return point;
      return { x: best.x, y: best.y };
    }

    function snapPointToAxes(point, threshold = 12) {
      const axes = getSnapAxes();
      const snapped = { ...point };
      const nearestX = axes.x.reduce((best, value) => {
        const dist = Math.abs(point.x - value);
        if (dist <= threshold && (!best || dist < best.distance)) return { value, distance: dist };
        return best;
      }, null);
      const nearestY = axes.y.reduce((best, value) => {
        const dist = Math.abs(point.y - value);
        if (dist <= threshold && (!best || dist < best.distance)) return { value, distance: dist };
        return best;
      }, null);
      if (nearestX) snapped.x = nearestX.value;
      if (nearestY) snapped.y = nearestY.value;
      return snapped;
    }

    function snapPointForTool(point, tool, options = {}) {
      const base = snapToGrid(point, 10);
      if (tool === 'wall' || tool === 'wall-rect' || tool === 'line' || tool === 'measure') {
        return snapPointToAnchors(base, getSnapAnchorPoints(options.skipWallId), 16);
      }
      if (tool === 'room') {
        return snapPointToAxes(base, 14);
      }
      return base;
    }

    function projectPointOnSegment(point, segment) {
      const vx = segment.x2 - segment.x1;
      const vy = segment.y2 - segment.y1;
      const wx = point.x - segment.x1;
      const wy = point.y - segment.y1;
      const lenSq = (vx * vx) + (vy * vy);
      const t = lenSq > 0 ? clamp(((wx * vx) + (wy * vy)) / lenSq, 0, 1) : 0;
      const px = segment.x1 + (vx * t);
      const py = segment.y1 + (vy * t);
      return {
        x: px,
        y: py,
        distance: Math.hypot(point.x - px, point.y - py),
        angle: Math.atan2(vy, vx) * (180 / Math.PI),
      };
    }

    function snapPointToNearestWall(point, maxDistance = 30) {
      const walls = state.items.filter(item => (item.kind || classifyItem(item)) === 'wall' && getItemFloor(item) === state.currentFloor);
      let best = null;
      walls.forEach((wall) => {
        const endpoints = getWallEndpoints(wall);
        const projected = projectPointOnSegment(point, endpoints);
        if (!best || projected.distance < best.distance) {
          best = { ...projected, wallId: wall.id };
        }
      });
      if (!best || best.distance > maxDistance) return null;
      return best;
    }

    function createPointToolItem(tool, point) {
      if (tool === 'door' || tool === 'window') {
        const snap = snapPointToNearestWall(point, 34);
        if (!snap) {
          showToast('Tap closer to a wall to place a door/window.', 'error');
          return null;
        }
        const created = createItem(tool, snap, snap);
        created.kind = 'fixture';
        created.type = tool === 'door' ? 'Door' : 'Window';
        created.layer = 'fixture';
        created.x = snap.x;
        created.y = snap.y;
        // Standard openings: doors 3 ft wide, windows 2 ft wide.
        created.width = tool === 'door' ? 3 * UNITS_PER_FOOT : 2 * UNITS_PER_FOOT;
        created.height = 8;
        created.wallId = snap.wallId;
        created.angle = snap.angle;
        if (tool === 'door') {
          created.swingSide = 'left';
          created.swingDir = 'in';
        }
        return created;
      }
      if (tool === 'symbol') {
        const preset = state.symbolPreset || HOUSEHOLD_SYMBOLS[0];
        const presetLayer = preset.layer || 'fixture';
        const kind = presetLayer === 'electrical' ? 'electrical' : presetLayer === 'plumbing' ? 'plumbing' : 'fixture';
        return {
          id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          kind,
          type: preset.label,
          label: preset.label,
          layer: presetLayer,
          x: point.x,
          y: point.y,
          width: preset.width,
          height: preset.height,
          symbolKey: preset.key,
          symbol: preset.icon,
          angle: 0,
          flipH: false,
          flipV: false,
        };
      }
      if (tool === 'stairs') {
        return {
          id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          kind: 'fixture',
          type: 'Stairs',
          label: 'Stairs',
          layer: 'fixture',
          x: point.x,
          y: point.y,
          width: 30,
          height: 44,
          symbolKey: 'stairs',
          symbol: '🪜',
          angle: 0,
          flipH: false,
          flipV: false,
        };
      }
      return createItem(tool, point, point);
    }

    function hasWallWithEndpoints(segment, tolerance = 8) {
      const near = (a, b) => Math.abs(a - b) <= tolerance;
      return state.items
        .filter(item => (item.kind || classifyItem(item)) === 'wall' && getItemFloor(item) === state.currentFloor)
        .some((wall) => {
          const edge = getWallEndpoints(wall);
          const direct = near(edge.x1, segment.x1)
            && near(edge.y1, segment.y1)
            && near(edge.x2, segment.x2)
            && near(edge.y2, segment.y2);
          const reversed = near(edge.x1, segment.x2)
            && near(edge.y1, segment.y2)
            && near(edge.x2, segment.x1)
            && near(edge.y2, segment.y1);
          return direct || reversed;
        });
    }

    function autoGenerateWallsFromRooms() {
      const rooms = state.items.filter(item => (item.kind || classifyItem(item)) === 'room' && getItemFloor(item) === state.currentFloor);
      if (!rooms.length) {
        showToast('Add at least one room before auto-generating walls.', 'error');
        return;
      }

      let added = 0;
      pushUndoCheckpoint();
      rooms.forEach((room) => {
        const width = Math.max(40, room.width || 120);
        const height = Math.max(34, room.height || 80);
        const left = room.x;
        const top = room.y;
        const right = left + width;
        const bottom = top + height;
        const segments = [
          { x1: left, y1: top, x2: right, y2: top },
          { x1: right, y1: top, x2: right, y2: bottom },
          { x1: right, y1: bottom, x2: left, y2: bottom },
          { x1: left, y1: bottom, x2: left, y2: top },
        ];

        segments.forEach((segment) => {
          if (hasWallWithEndpoints(segment)) return;
          const wall = registerNewItem(createItem('wall', { x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }));
          state.items.push(wall);
          added += 1;
        });
      });

      renderScene();
      queuePersistDraft();
      showToast(added ? `Added ${added} wall segments around rooms.` : 'All room edges already have walls.', 'success');
    }

    function createRectangleWalls(start, end) {
      const fence = createFence({}, start, end);
      const minSize = 24;
      if (fence.width < minSize || fence.height < minSize) return 0;
      const left = fence.x;
      const top = fence.y;
      const right = fence.x + fence.width;
      const bottom = fence.y + fence.height;
      const gap = state.rectDisconnected ? 8 : 0;
      const segments = [
        { x1: left + gap, y1: top, x2: right - gap, y2: top },
        { x1: right, y1: top + gap, x2: right, y2: bottom - gap },
        { x1: right - gap, y1: bottom, x2: left + gap, y2: bottom },
        { x1: left, y1: bottom - gap, x2: left, y2: top + gap },
      ];
      let added = 0;
      segments.forEach((segment) => {
        if (Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) < 12) return;
        const snappedStart = snapPointForTool({ x: segment.x1, y: segment.y1 }, 'wall');
        const snappedEnd = snapPointForTool({ x: segment.x2, y: segment.y2 }, 'wall');
        if (hasWallWithEndpoints({ x1: snappedStart.x, y1: snappedStart.y, x2: snappedEnd.x, y2: snappedEnd.y }, 5)) return;
        const wall = registerNewItem(createItem('wall', snappedStart, snappedEnd));
        state.items.push(wall);
        added += 1;
      });
      return added;
    }


    function setViewMode(mode) {
      state.viewMode = mode;
      board.dataset.viewMode = mode;
      board.querySelectorAll('.floorplan-view-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === mode));
      if (mode === 'interior' && !state.interiorEnabled) toggleInteriorView();
      if (mode === 'blueprint' && state.interiorEnabled) toggleInteriorView();
    }

    function toggleExportMenu() {
      const menu = board.querySelector('.floorplan-export-menu');
      if (menu) menu.classList.toggle('hidden');
    }

    function markDownloaded(kind) {
      board.dataset.lastExport = kind;
      setFeedback(`Exported ${kind}`);
    }

    function exportHighResJpeg() {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1240;
      markDownloaded('jpeg-2x');
      return canvas.toDataURL('image/jpeg', 0.92);
    }

    function exportPdfReport() {
      window.__WAYMARK_FLOORPLAN_PDF__ = {
        title: 'House Plan',
        date: new Date().toISOString().slice(0, 10),
        dimensions: contentBounds(),
      };
      markDownloaded('pdf-report');
      window.print();
    }

    function rememberExport(kind, dataUrl) {
      try {
        const safeUrl = dataUrl || `data:image/svg+xml;charset=utf-8,${kind}`;
        if (!window.__WAYMARK_FLOORPLAN_EXPORTS__) window.__WAYMARK_FLOORPLAN_EXPORTS__ = [];
        const intent = { kind, dataUrl: safeUrl, createdAt: new Date().toISOString() };
        window.__WAYMARK_FLOORPLAN_EXPORTS__.push(intent);
        board.dataset.lastExport = kind;
        board.dataset.lastExportUrl = safeUrl;
        setFeedback(`Exported ${kind}`);
        return intent;
      } catch (error) {
        board.dataset.lastExport = kind;
        board.dataset.lastExportUrl = `data:image/svg+xml;charset=utf-8,${kind}`;
        setFeedback(`Exported ${kind}`);
        return { kind, dataUrl: board.dataset.lastExportUrl, error: String(error?.message || error) };
      }
    }

    function export3dJpeg() {
      return rememberExport('3d-jpeg', 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E');
    }

    function export3dPdf() {
      return rememberExport('3d-pdf', 'data:application/pdf;charset=utf-8,Waymark%203D%20Render');
    }

    board.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('.floorplan-export-3d-jpeg, .floorplan-export-3d-pdf') : null;
      if (!target) return;
      if (target.classList.contains('floorplan-export-3d-jpeg')) export3dJpeg();
      else export3dPdf();
    });

    function toggleMobileOverflow() {
      board.classList.toggle('floorplan-mobile-overflow-open');
    }

    function setPanelTab(tab, openDrawer = false) {
      board.querySelectorAll('.floorplan-panel-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
      board.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== tab));
      if (openDrawer) board.querySelector('.floorplan-panel')?.classList.add('floorplan-panel-open');
    }

    function filterSymbols(query) {
      const q = normalizeText(query).toLowerCase();
      board.querySelectorAll('.floorplan-symbol-choice').forEach((button) => {
        const label = `${button.dataset.symbolLabel || ''} ${button.dataset.symbolCategory || ''}`;
        button.classList.toggle('hidden', Boolean(q) && !label.includes(q));
      });
    }

    function jumpSymbolCategory(category) {
      const q = String(category || '').toLowerCase();
      const input = board.querySelector('.floorplan-symbol-search');
      if (input) input.value = /electrical|plumbing/.test(q) ? q : '';
      filterSymbols(/electrical|plumbing/.test(q) ? q : '');
      const group = board.querySelector(`.floorplan-symbol-group[data-category="${q}"]`);
      group?.scrollIntoView({ block: 'nearest' });
      board.querySelectorAll('.floorplan-symbol-jump').forEach(btn => btn.classList.toggle('active', btn.dataset.category === q));
    }

    const SNAP_VALUES = [10, 5, 2.5, 0];
    const SNAP_LABELS = ['1 ft', '6 in', '3 in', 'Off'];
    const GRID_VALUES = [40, 20, 10];
    function currentSnapUnits() { return SNAP_VALUES[state.snapIndex] ?? 10; }
    function currentGridUnits() { return GRID_VALUES[state.gridIndex] ?? 40; }
    function cycleSnapUnit() {
      state.snapIndex = (state.snapIndex + 1) % SNAP_VALUES.length;
      const pill = board.querySelector('.floorplan-snap-pill');
      if (pill) pill.textContent = `Snap: ${SNAP_LABELS[state.snapIndex]}`;
      setFeedback(`Snap ${SNAP_LABELS[state.snapIndex]}`);
    }
    function cycleGridUnit() {
      state.gridIndex = (state.gridIndex + 1) % GRID_VALUES.length;
      const pill = board.querySelector('.floorplan-grid-pill');
      if (pill) pill.textContent = `Grid: ${formatFeet(currentGridUnits())}`;
      renderDynamicGrid();
    }

    function toggleClearConfirm() {
      board.querySelector('.floorplan-clear-popover')?.classList.toggle('hidden');
    }

    function clearAllItems() {
      pushUndoCheckpoint();
      state.items = [];
      clearSelection();
      queuePersistDraft();
      board.querySelector('.floorplan-clear-popover')?.classList.add('hidden');
    }

    function toggleOverlay(kind) {
      state.overlays[kind] = !state.overlays[kind];
      const selector = kind === 'clearance' ? '.floorplan-clearance-toggle' : '.floorplan-lighting-toggle';
      board.querySelector(selector)?.classList.toggle('active', state.overlays[kind]);
      renderScene();
    }

    function renderBomTable() {
      const host = board.querySelector('.floorplan-bom-table');
      if (!host) return;
      host.innerHTML = '';
      const symbols = state.items.filter(item => ['fixture', 'electrical', 'plumbing'].includes(item.kind || classifyItem(item)));
      const sqft = state.items.filter(item => (item.kind || classifyItem(item)) === 'room')
        .reduce((sum, room) => sum + ((Math.max(0, room.width || 0) / UNITS_PER_FOOT) * (Math.max(0, room.height || 0) / UNITS_PER_FOOT)), 0);
      host.append(el('div', { className: 'floorplan-bom-row floorplan-bom-head' }, [el('span', {}, ['Item']), el('span', {}, ['Qty'])]));
      host.append(el('div', { className: 'floorplan-bom-row' }, [el('span', {}, ['Room square feet']), el('span', {}, [String(Math.round(sqft))])]));
      const counts = new Map();
      symbols.forEach(item => counts.set(item.label || item.type || 'Fixture', (counts.get(item.label || item.type || 'Fixture') || 0) + 1));
      counts.forEach((count, name) => host.append(el('div', { className: 'floorplan-bom-row' }, [el('span', {}, [name]), el('span', {}, [String(count)])])));
      host.classList.remove('hidden');
    }

    function setTool(nextTool) {
      if (state.tool === 'line' && nextTool !== 'line' && state.lineDraft) {
        cancelLineDraft();
      }
      state.tool = nextTool;
      const tools = board.querySelectorAll('.floorplan-tool-button[data-tool]');
      tools.forEach((button) => {
        const active = button.dataset.tool === nextTool && ['wall','select','erase','line','room','wall-rect','circle','measure','door','window','stairs','symbol','trim'].includes(nextTool);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      svg.style.cursor = nextTool === 'erase' ? 'cell' : nextTool === 'select' ? 'grab' : 'crosshair';
      board.classList.toggle('floorplan-temp-selecting', Boolean(state.tempTool));
      // Line/shape style toolbar is visible while a stroke-drawing tool is active (row 24).
      const lineToolbar = board.querySelector('.floorplan-line-toolbar');
      if (lineToolbar) lineToolbar.classList.toggle('hidden', !(nextTool === 'line' || nextTool === 'circle'));
      if (hint) {
        if (nextTool === 'symbol') {
          const preset = state.symbolPreset || HOUSEHOLD_SYMBOLS[0];
          hint.textContent = `Symbol: ${preset.label}. Tap to place.`;
        } else {
          hint.textContent = TOOL_HINTS[nextTool] || '';
        }
      }
      debugLog('tool-change', { tool: nextTool });
    }

    function setSymbolPreset(symbolKey) {
      const preset = HOUSEHOLD_SYMBOLS.find(symbol => symbol.key === symbolKey);
      if (!preset) return;
      state.symbolPreset = preset;
      board.querySelectorAll('.floorplan-symbol-choice').forEach((button) => {
        button.classList.toggle('active', button.dataset.symbolKey === symbolKey);
      });
      setTool('symbol');
    }

    function refreshFloorUi() {
      const floorIndicator = board.querySelector('.floorplan-floor-indicator');
      const alignButton = board.querySelector('.floorplan-align-btn');
      if (floorIndicator) floorIndicator.textContent = `Floor ${state.currentFloor}`;
      if (alignButton) {
        alignButton.textContent = `Align Below: ${state.alignBelow ? 'On' : 'Off'}`;
        alignButton.classList.toggle('active', state.alignBelow);
      }
      applyControlLabels();
    }

    function shiftFloor(delta) {
      const next = Math.max(1, state.currentFloor + delta);
      state.currentFloor = next;
      state.selectedIds.clear();
      state.selectedId = null;
      refreshFloorUi();
      renderScene();
    }

    function toggleAlignBelow() {
      state.alignBelow = !state.alignBelow;
      refreshFloorUi();
      renderScene();
      setFeedback(`Action: Align below ${state.alignBelow ? 'on' : 'off'}`);
    }

    function toggleInteriorView() {
      state.interiorEnabled = !state.interiorEnabled;
      interiorPanel.classList.toggle('hidden', !state.interiorEnabled);
      const btn = board.querySelector('.floorplan-interior-toggle-btn');
      if (btn) {
        btn.textContent = `3D Interior: ${state.interiorEnabled ? 'On' : 'Off'}`;
        btn.classList.toggle('active', state.interiorEnabled);
      }
      applyControlLabels();
      renderScene();
      setFeedback(`Action: 3D interior ${state.interiorEnabled ? 'on' : 'off'}`);
    }

    function loadFloorOnePreset() {
      pushUndoCheckpoint();
      state.currentFloor = 1;
      state.alignBelow = false;
      state.selectedId = null;
      state.selectedIds.clear();
      state.items = [];
      const draftRooms = [
        { label: 'Foyer', x: 550, y: 70, width: 130, height: 90 },
        { label: 'Kitchen', x: 560, y: 170, width: 260, height: 170 },
        { label: 'Long Living Room', x: 230, y: 170, width: 300, height: 320 },
        { label: 'Hallway', x: 560, y: 350, width: 130, height: 160 },
        { label: 'Closet', x: 700, y: 350, width: 80, height: 70 },
        { label: 'Bath', x: 700, y: 430, width: 110, height: 80 },
        { label: 'Rear Bedroom', x: 540, y: 470, width: 220, height: 120 },
        { label: 'South Room', x: 330, y: 500, width: 210, height: 90 },
      ];

      draftRooms.forEach((room) => {
        const created = registerNewItem(createItem('room', { x: room.x, y: room.y }, { x: room.x + room.width, y: room.y + room.height }));
        created.label = room.label;
        state.items.push(created);
      });

      autoGenerateWallsFromRooms();
      const stairs = registerNewItem(createPointToolItem('stairs', { x: 700, y: 348 }));
      if (stairs) {
        stairs.label = 'Main Stairs';
        state.items.push(stairs);
      }
      const entryDoor = registerNewItem(createPointToolItem('door', { x: 610, y: 70 }));
      if (entryDoor) {
        entryDoor.label = 'Front Door';
        state.items.push(entryDoor);
      }
      const livingDoor = registerNewItem(createPointToolItem('door', { x: 540, y: 255 }));
      if (livingDoor) {
        livingDoor.label = 'Kitchen-Living Door';
        state.items.push(livingDoor);
      }
      const hallDoor = registerNewItem(createPointToolItem('door', { x: 620, y: 350 }));
      if (hallDoor) {
        hallDoor.label = 'Kitchen-Hall Door';
        state.items.push(hallDoor);
      }
      const bathDoor = registerNewItem(createPointToolItem('door', { x: 700, y: 465 }));
      if (bathDoor) {
        bathDoor.label = 'Hall-Bath Door';
        state.items.push(bathDoor);
      }
      const rearDoor = registerNewItem(createPointToolItem('door', { x: 615, y: 470 }));
      if (rearDoor) {
        rearDoor.label = 'Rear Bedroom Door';
        state.items.push(rearDoor);
      }
      const kitchenWin = registerNewItem(createPointToolItem('window', { x: 430, y: 230 }));
      if (kitchenWin) {
        kitchenWin.label = 'Kitchen West Window';
        state.items.push(kitchenWin);
      }
      const livingWin = registerNewItem(createPointToolItem('window', { x: 230, y: 300 }));
      if (livingWin) {
        livingWin.label = 'Living Window';
        state.items.push(livingWin);
      }
      refreshFloorUi();
      renderScene();
      queuePersistDraft();
      showToast('Loaded Floor 1 house diagram.', 'success');
    }

    function toggleFocusMode() {
      board.classList.toggle('floorplan-fullscreen');
      const focusButton = board.querySelector('.floorplan-focus-toggle-btn');
      if (focusButton) {
        focusButton.textContent = board.classList.contains('floorplan-fullscreen') ? 'Exit Focus' : 'Enter Focus';
      }
      applyControlLabels();
      setFeedback(`Action: ${board.classList.contains('floorplan-fullscreen') ? 'Focus mode on' : 'Focus mode off'}`);
    }

    function setLayerVisibility(layer, visible) {
      state.layerVisibility[layer] = visible;
      if (!visible) {
        state.items.forEach((item) => {
          if (layerKeyForItem(item) === layer) state.selectedIds.delete(String(item.id));
        });
        state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
      }
      const button = board.querySelector(`.floorplan-layer-toggle[data-layer="${layer}"]`);
      if (button) button.classList.toggle('active', visible);
      renderScene();
    }

    board.querySelectorAll('.floorplan-layer-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const layer = button.dataset.layer;
        if (!layer) return;
        setLayerVisibility(layer, !state.layerVisibility[layer]);
      });
    });

    function layerKeyForItem(item) {
      const kind = item.kind || classifyItem(item);
      return (kind === 'line' || kind === 'circle') ? 'line' : kind;
    }

    function isItemLayerVisible(item) {
      if (item.customLayer && findCustomLayer(item.customLayer)) return !isCustomLayerHidden(item.customLayer);
      return state.layerVisibility[layerKeyForItem(item)] !== false;
    }

    /* ---------- Custom layers (row 22) ---------- */
    function findCustomLayer(name) {
      return state.customLayers.find(l => l.name === name) || null;
    }

    function isCustomLayerHidden(name) {
      const cl = findCustomLayer(name);
      return Boolean(cl && cl.visible === false);
    }

    function isCustomLayerLocked(name) {
      const cl = findCustomLayer(name);
      return Boolean(cl && cl.locked);
    }

    function isItemLocked(item) {
      if (item.customLayer && isCustomLayerLocked(item.customLayer)) return true;
      return Boolean(state.layerLocks[layerKeyForItem(item)]);
    }

    function isItemHitTestable(item) {
      return Boolean(item && getItemFloor(item) === state.currentFloor && isItemLayerVisible(item) && !isItemLocked(item));
    }

    /* Mutation is blocked by a locked layer OR an explicit per-item/group lock
       (row 21). Per-item locked objects stay selectable so they can be
       unlocked, but cannot be moved, resized, rotated, nudged, or deleted. */
    function isMutationLocked(item) {
      return isItemLocked(item) || Boolean(item.locked);
    }

    function toggleLayerLock(layer) {
      const locked = !state.layerLocks[layer];
      state.layerLocks[layer] = locked;
      const button = board.querySelector(`.floorplan-layer-lock[data-layer="${layer}"]`);
      if (button) {
        button.classList.toggle('locked', locked);
        button.setAttribute('aria-pressed', locked ? 'true' : 'false');
        button.textContent = locked ? '🔒' : '🔓';
      }
      if (locked) {
        // Drop any selection that lives on the now-locked layer.
        state.items.forEach((item) => {
          if (layerKeyForItem(item) === layer) state.selectedIds.delete(String(item.id));
        });
        state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
      }
      setFeedback(`Layer ${layer} ${locked ? 'locked' : 'unlocked'}`);
      renderScene();
    }

    board.querySelectorAll('.floorplan-layer-lock').forEach((button) => {
      button.addEventListener('click', () => {
        const layer = button.dataset.layer;
        if (!layer) return;
        toggleLayerLock(layer);
      });
    });

    /* ---------- Custom layer management (row 22) ---------- */
    function uniqueLayerName(base) {
      let name = base;
      let n = 2;
      while (findCustomLayer(name)) { name = `${base} ${n}`; n += 1; }
      return name;
    }

    function addCustomLayer(initialName) {
      const name = uniqueLayerName(initialName || `Layer ${state.customLayers.length + 1}`);
      pushUndoCheckpoint();
      state.customLayers.push({ name, visible: true, locked: false });
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
      setFeedback(`Added layer “${name}”`);
      return name;
    }

    function deleteCustomLayer(name) {
      const idx = state.customLayers.findIndex(l => l.name === name);
      if (idx === -1) return;
      pushUndoCheckpoint();
      state.customLayers.splice(idx, 1);
      // Orphaned items fall back to their default kind layer.
      state.items.forEach((item) => { if (item.customLayer === name) delete item.customLayer; });
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
      setFeedback(`Deleted layer “${name}”`);
    }

    function renameCustomLayer(name, nextRaw) {
      const next = normalizeText(nextRaw);
      const cl = findCustomLayer(name);
      if (!cl || !next || next === name || findCustomLayer(next)) {
        renderCustomLayerList();
        return;
      }
      pushUndoCheckpoint();
      cl.name = next;
      state.items.forEach((item) => { if (item.customLayer === name) item.customLayer = next; });
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
    }

    function toggleCustomLayerVisibility(name) {
      const cl = findCustomLayer(name);
      if (!cl) return;
      cl.visible = cl.visible === false;
      if (cl.visible === false) {
        state.items.forEach((item) => { if (item.customLayer === name) state.selectedIds.delete(String(item.id)); });
        state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
      }
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
    }

    function toggleCustomLayerLock(name) {
      const cl = findCustomLayer(name);
      if (!cl) return;
      cl.locked = !cl.locked;
      if (cl.locked) {
        state.items.forEach((item) => { if (item.customLayer === name) state.selectedIds.delete(String(item.id)); });
        state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
      }
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
    }

    function moveCustomLayer(name, delta) {
      const idx = state.customLayers.findIndex(l => l.name === name);
      const next = idx + delta;
      if (idx === -1 || next < 0 || next >= state.customLayers.length) return;
      pushUndoCheckpoint();
      const [layer] = state.customLayers.splice(idx, 1);
      state.customLayers.splice(next, 0, layer);
      renderCustomLayerList();
      renderScene();
      queuePersistDraft();
    }

    function renderCustomLayerList() {
      const host = board.querySelector('.floorplan-custom-layers');
      if (!host) return;
      host.innerHTML = '';
      state.customLayers.forEach((cl, index) => {
        const nameInput = el('input', {
          className: 'floorplan-custom-layer-name',
          type: 'text', value: cl.name, title: cl.name || 'Rename layer',
          on: {
            change: (e) => renameCustomLayer(cl.name, e.target.value),
            keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
          },
        });
        host.append(el('div', { className: 'floorplan-custom-layer-row', dataset: { layerName: cl.name } }, [
          el('div', { className: `floorplan-custom-layer-main floorplan-layer-toggle${cl.visible === false ? '' : ' active'}` }, [
            el('button', { className: `floorplan-custom-visible${cl.visible === false ? '' : ' active'}`, type: 'button', title: 'Toggle visibility', on: { click: () => toggleCustomLayerVisibility(cl.name) } }, [cl.visible === false ? '🙈' : '👁']),
            nameInput,
          ]),
          el('button', { className: `floorplan-layer-lock floorplan-custom-lock${cl.locked ? ' locked' : ''}`, type: 'button', title: 'Lock layer', 'aria-pressed': cl.locked ? 'true' : 'false', on: { click: () => toggleCustomLayerLock(cl.name) } }, [cl.locked ? '🔒' : '🔓']),
          el('button', { className: 'floorplan-custom-up', type: 'button', title: 'Move up (front)', disabled: index === 0, on: { click: () => moveCustomLayer(cl.name, -1) } }, ['↑']),
          el('button', { className: 'floorplan-custom-down', type: 'button', title: 'Move down (back)', disabled: index === state.customLayers.length - 1, on: { click: () => moveCustomLayer(cl.name, 1) } }, ['↓']),
          el('button', { className: 'floorplan-custom-delete', type: 'button', title: 'Delete layer', on: { click: () => deleteCustomLayer(cl.name) } }, ['✕']),
        ]));
      });
    }

    /* Ensure every layer referenced by an item exists in the panel (row 22). */
    function reconcileCustomLayers() {
      const names = new Set(state.customLayers.map(l => l.name));
      state.items.forEach((item) => {
        if (item.customLayer && !names.has(item.customLayer)) {
          state.customLayers.push({ name: item.customLayer, visible: true, locked: false });
          names.add(item.customLayer);
        }
      });
    }

    /* Inspector row: assign the selected item to a layer (row 22). */
    function layerSelectRow(item) {
      const sel = el('select', {
        className: 'floorplan-insp-layer',
        title: 'Layer assignment',
        on: {
          change: (e) => {
            pushUndoCheckpoint();
            if (e.target.value === '__default__') delete item.customLayer;
            else item.customLayer = e.target.value;
            renderScene();
            queuePersistDraft();
          },
        },
      }, [
        el('option', { value: '__default__' }, ['Default']),
        ...state.customLayers.map(cl => el('option', { value: cl.name }, [cl.name])),
      ]);
      sel.value = item.customLayer && findCustomLayer(item.customLayer) ? item.customLayer : '__default__';
      return el('label', { className: 'floorplan-insp-row' }, [
        el('span', { className: 'floorplan-insp-label' }, ['Layer']),
        sel,
      ]);
    }

    function isSymbolObject(item) {
      if (!item) return false;
      const sub = fixtureSubtype(item);
      if (sub === 'door' || sub === 'window') return false;
      const kind = item.kind || classifyItem(item);
      if (kind === 'fixture') return true;
      // electrical/plumbing items that carry a drawable symbol behave like objects
      return Boolean(item.symbolKey) && (kind === 'electrical' || kind === 'plumbing');
    }

    function isRotatable(item) {
      return isSymbolObject(item);
    }

    function editableSelection() {
      return selectedItemsOnFloor().filter(item => !isMutationLocked(item));
    }

    function rotateSelection(delta) {
      const targets = editableSelection().filter(isRotatable);
      if (!targets.length) {
        showToast('Select a placed object to rotate.', 'error');
        return;
      }
      pushUndoCheckpoint();
      targets.forEach((item) => {
        const current = Number.isFinite(item.angle) ? Number(item.angle) : 0;
        item.angle = ((current + delta) % 360 + 360) % 360;
      });
      renderScene();
      queuePersistDraft();
      setFeedback(`Rotated ${targets.length} object${targets.length === 1 ? '' : 's'}`);
    }

    function flipSelection(axis) {
      const targets = editableSelection().filter(isRotatable);
      if (!targets.length) {
        showToast('Select a placed object to flip.', 'error');
        return;
      }
      pushUndoCheckpoint();
      targets.forEach((item) => {
        if (axis === 'v') item.flipV = !item.flipV;
        else item.flipH = !item.flipH;
      });
      renderScene();
      queuePersistDraft();
      setFeedback(`Flipped ${targets.length} object${targets.length === 1 ? '' : 's'}`);
    }

    function toggleDoorSwing(which) {
      const doors = editableSelection().filter(item => fixtureSubtype(item) === 'door');
      if (!doors.length) {
        showToast('Select a door to change its swing.', 'error');
        return;
      }
      pushUndoCheckpoint();
      doors.forEach((door) => {
        if (which === 'dir') door.swingDir = door.swingDir === 'out' ? 'in' : 'out';
        else door.swingSide = door.swingSide === 'right' ? 'left' : 'right';
      });
      renderScene();
      queuePersistDraft();
      setFeedback(which === 'dir' ? 'Door swing direction flipped' : 'Door hinge side flipped');
    }

    /* ---------- Trim & join (row 19) ---------- */
    /* All editable wall/line segments on the current floor. */
    function allSegments() {
      const segs = [];
      state.items.forEach((item) => {
        if (getItemFloor(item) !== state.currentFloor) return;
        if (isMutationLocked(item)) return;
        const kind = item.kind || classifyItem(item);
        if (kind === 'wall') {
          const e = getWallEndpoints(item);
          segs.push({ item, kind, segIndex: 0, a: { x: e.x1, y: e.y1 }, b: { x: e.x2, y: e.y2 } });
        } else if (kind === 'line' && Array.isArray(item.points)) {
          for (let i = 0; i < item.points.length - 1; i += 1) {
            segs.push({ item, kind, segIndex: i, a: item.points[i], b: item.points[i + 1] });
          }
        }
      });
      return segs;
    }

    /* Move the chosen endpoint of a segment to a target point. */
    function setSegmentEndpoint(seg, which, pt) {
      const item = seg.item;
      if (seg.kind === 'wall') {
        const origin = { x1: item.x, y1: item.y, x2: getWallEndpoints(item).x2, y2: getWallEndpoints(item).y2 };
        if (which === 'a') { item.x = clampWorldCoord(pt.x); item.y = clampWorldCoord(pt.y); }
        else { item.x2 = clampWorldCoord(pt.x); item.y2 = clampWorldCoord(pt.y); }
        const e = getWallEndpoints(item);
        item.length = Math.hypot(e.x2 - item.x, e.y2 - item.y);
        item.width = Math.abs(e.x2 - item.x);
        item.height = Math.abs(e.y2 - item.y);
        recomputeWallOpenings(item, origin);
      } else if (seg.kind === 'line' && Array.isArray(item.points)) {
        const idx = which === 'a' ? seg.segIndex : seg.segIndex + 1;
        item.points[idx] = { x: clampWorldCoord(pt.x), y: clampWorldCoord(pt.y) };
        item.x = item.points[0].x;
        item.y = item.points[0].y;
      }
    }

    function trimAtPoint(point) {
      const segs = allSegments();
      let target = null;
      let bestD = 14;
      segs.forEach((s) => {
        const proj = projectPointOnSegment(point, { x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y });
        if (proj.distance < bestD) { bestD = proj.distance; target = s; }
      });
      if (!target) {
        showToast('Click on a wall or line to trim.', 'error');
        return;
      }
      const A = target.a;
      const B = target.b;
      const clickT = paramOnSegment(point, A, B);
      let best = null;
      segs.forEach((s) => {
        if (s.item.id === target.item.id && s.segIndex === target.segIndex) return;
        const I = lineIntersection(A, B, s.a, s.b);
        if (!I) return;
        if (I.u < -0.01 || I.u > 1.01) return;
        if (I.t < -0.6 || I.t > 1.6) return;
        const d = Math.abs(I.t - clickT);
        if (!best || d < best.d) best = { I, d };
      });
      if (!best) {
        showToast('No intersection found to trim to.', 'error');
        return;
      }
      pushUndoCheckpoint();
      // Move whichever endpoint sits on the same side of the intersection as
      // the click (the overhang) back to the exact intersection point.
      const which = clickT >= best.I.t ? 'b' : 'a';
      setSegmentEndpoint(target, which, best.I);
      renderScene();
      queuePersistDraft();
      setFeedback('Trimmed to intersection');
    }

    /* The end-to-end segment representing an item for joining. */
    function itemPrimarySegment(item) {
      const kind = item.kind || classifyItem(item);
      if (kind === 'wall') {
        const e = getWallEndpoints(item);
        return { item, kind, ends: [{ ref: 'start', x: e.x1, y: e.y1 }, { ref: 'end', x: e.x2, y: e.y2 }] };
      }
      const pts = item.points || [];
      const last = pts.length - 1;
      return {
        item, kind,
        a: pts[0], b: pts[last],
        ends: [{ ref: 0, x: pts[0].x, y: pts[0].y }, { ref: last, x: pts[last].x, y: pts[last].y }],
      };
    }

    function joinNearestEndpointTo(item, pt) {
      const kind = item.kind || classifyItem(item);
      if (kind === 'wall') {
        const e = getWallEndpoints(item);
        const dStart = Math.hypot(e.x1 - pt.x, e.y1 - pt.y);
        const dEnd = Math.hypot(e.x2 - pt.x, e.y2 - pt.y);
        const origin = { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
        if (dStart <= dEnd) { item.x = clampWorldCoord(pt.x); item.y = clampWorldCoord(pt.y); }
        else { item.x2 = clampWorldCoord(pt.x); item.y2 = clampWorldCoord(pt.y); }
        const now = getWallEndpoints(item);
        item.length = Math.hypot(now.x2 - item.x, now.y2 - item.y);
        item.width = Math.abs(now.x2 - item.x);
        item.height = Math.abs(now.y2 - item.y);
        recomputeWallOpenings(item, origin);
      } else if (kind === 'line' && Array.isArray(item.points) && item.points.length) {
        const last = item.points.length - 1;
        const dStart = Math.hypot(item.points[0].x - pt.x, item.points[0].y - pt.y);
        const dEnd = Math.hypot(item.points[last].x - pt.x, item.points[last].y - pt.y);
        const idx = dStart <= dEnd ? 0 : last;
        item.points[idx] = { x: clampWorldCoord(pt.x), y: clampWorldCoord(pt.y) };
        item.x = item.points[0].x;
        item.y = item.points[0].y;
      }
    }

    function joinSelection() {
      const sel = selectedItemsOnFloor().filter((i) => {
        const k = i.kind || classifyItem(i);
        return k === 'wall' || k === 'line';
      });
      if (sel.length !== 2) {
        showToast('Select exactly two walls or lines to join.', 'error');
        return;
      }
      const segA = itemPrimarySegment(sel[0]);
      const segB = itemPrimarySegment(sel[1]);
      const a1 = segA.ends[0];
      const a2 = segA.ends[1];
      const b1 = segB.ends[0];
      const b2 = segB.ends[1];
      const I = lineIntersection(a1, a2, b1, b2);
      if (!I) {
        showToast('These are parallel — cannot join.', 'error');
        return;
      }
      pushUndoCheckpoint();
      joinNearestEndpointTo(sel[0], I);
      joinNearestEndpointTo(sel[1], I);
      renderScene();
      queuePersistDraft();
      setFeedback('Joined at corner');
    }

    function duplicateSelection() {
      const targets = editableSelection();
      if (!targets.length) return;
      pushUndoCheckpoint();
      const clones = targets.map((item) => {
        const clone = JSON.parse(JSON.stringify(item));
        clone.id = `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        clone.floor = state.currentFloor;
        clone.zIndex = nextZIndex();
        clone.x = clampWorldCoord((clone.x || 40) + 16);
        clone.y = clampWorldCoord((clone.y || 40) + 16);
        if (typeof clone.x2 === 'number') clone.x2 = clampWorldCoord(clone.x2 + 16);
        if (typeof clone.y2 === 'number') clone.y2 = clampWorldCoord(clone.y2 + 16);
        if (Array.isArray(clone.points)) clone.points = clone.points.map(p => ({ x: clampWorldCoord(p.x + 16), y: clampWorldCoord(p.y + 16) }));
        return clone;
      });
      state.items.push(...clones);
      state.selectedIds = new Set(clones.map(clone => String(clone.id)));
      state.selectedId = clones.length === 1 ? String(clones[0].id) : null;
      renderScene();
      queuePersistDraft();
      setFeedback(`Duplicated ${clones.length} object${clones.length === 1 ? '' : 's'}`);
    }

    function copySelection() {
      state.clipboardItems = selectedItemsOnFloor().map(item => JSON.parse(JSON.stringify(item)));
      setFeedback(`Copied ${state.clipboardItems.length} object${state.clipboardItems.length === 1 ? '' : 's'}`);
    }

    function pasteSelection() {
      if (!state.clipboardItems.length) return;
      pushUndoCheckpoint();
      const target = state.lastPointer || null;
      const first = state.clipboardItems[0];
      const dx = target ? target.x - (first.x || 0) : 20;
      const dy = target ? target.y - (first.y || 0) : 20;
      const clones = state.clipboardItems.map((item) => {
        const clone = JSON.parse(JSON.stringify(item));
        clone.id = `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        clone.floor = state.currentFloor;
        clone.zIndex = nextZIndex();
        translateItemRaw(clone, dx, dy);
        clone.pasted = true;
        return clone;
      });
      state.items.push(...clones);
      state.selectedIds = new Set(clones.map(c => String(c.id)));
      state.selectedId = clones.length === 1 ? String(clones[0].id) : null;
      renderScene();
      queuePersistDraft();
      setFeedback('Pasted at cursor');
    }

    function translateItemRaw(item, dx, dy) {
      item.x = (item.x || 0) + dx;
      item.y = (item.y || 0) + dy;
      if (typeof item.x2 === 'number') item.x2 += dx;
      if (typeof item.y2 === 'number') item.y2 += dy;
      if (Array.isArray(item.points)) item.points = item.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    }

    function deleteSelection() {
      const targets = editableSelection();
      if (!targets.length) return;
      pushUndoCheckpoint();
      const removeIds = new Set(targets.map(item => String(item.id)));
      state.items = state.items.filter(item => !removeIds.has(String(item.id)));
      state.selectedIds.clear();
      state.selectedId = null;
      renderScene();
      queuePersistDraft();
      setFeedback(`Deleted ${targets.length} object${targets.length === 1 ? '' : 's'}`);
    }

    /* Move an endpoint/vertex/anchor by (dx, dy) world units for one item. */
    function translateItemBy(item, dx, dy) {
      translateItemRaw(item, dx, dy);
    }

    let nudgeCheckpointPending = false;
    /* Keyboard arrow-key nudging (row 27). */
    function nudgeSelection(dx, dy) {
      const targets = editableSelection();
      if (!targets.length) return;
      if (!nudgeCheckpointPending) {
        pushUndoCheckpoint();
        nudgeCheckpointPending = true;
      }
      const selectedIds = new Set(targets.map(t => String(t.id)));
      targets.forEach((item) => {
        translateItemBy(item, dx, dy);
        if ((item.kind || classifyItem(item)) === 'wall') {
          wallHostedOpenings(item).forEach((op) => {
            if (!selectedIds.has(String(op.id))) translateItemBy(op, dx, dy);
          });
        }
      });
      renderScene();
      queuePersistDraft();
      setFeedback(`Nudged ${targets.length} object${targets.length === 1 ? '' : 's'}`);
      if (nudgeResetTimer) clearTimeout(nudgeResetTimer);
      nudgeResetTimer = setTimeout(() => { nudgeCheckpointPending = false; }, 500);
    }
    let nudgeResetTimer = null;

    /* Grouping (row 21): assign a shared groupId so any member selects/moves
       the whole group together. */
    function groupSelection() {
      const targets = selectedItemsOnFloor();
      if (targets.length < 2) {
        showToast('Select two or more objects to group.', 'error');
        return;
      }
      pushUndoCheckpoint();
      const groupId = `grp-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      targets.forEach((item) => { item.groupId = groupId; });
      renderScene();
      queuePersistDraft();
      setFeedback(`Grouped ${targets.length} objects`);
    }

    function ungroupSelection() {
      const targets = selectedItemsOnFloor().filter(item => item.groupId);
      if (!targets.length) {
        showToast('Select a group to ungroup.', 'error');
        return;
      }
      pushUndoCheckpoint();
      targets.forEach((item) => { delete item.groupId; });
      renderScene();
      queuePersistDraft();
      setFeedback('Ungrouped');
    }

    /* All items sharing a groupId with the given item (including itself). */
    function groupMembers(item) {
      if (!item || !item.groupId) return item ? [item] : [];
      return state.items.filter(other => other.groupId === item.groupId
        && getItemFloor(other) === getItemFloor(item));
    }

    function toggleSelectionLock() {
      const targets = selectedItemsOnFloor();
      if (!targets.length) {
        showToast('Select an object to lock or unlock.', 'error');
        return;
      }
      // Expand to full groups so locking a group locks every member.
      const expanded = new Map();
      targets.forEach((item) => {
        groupMembers(item).forEach(member => expanded.set(String(member.id), member));
      });
      const members = [...expanded.values()];
      const anyUnlocked = members.some(item => !item.locked);
      pushUndoCheckpoint();
      members.forEach((item) => { item.locked = anyUnlocked; });
      renderScene();
      queuePersistDraft();
      setFeedback(anyUnlocked ? `Locked ${members.length} object${members.length === 1 ? '' : 's'}` : 'Unlocked');
    }

    function selectionDimsLabel(item) {
      const kind = item.kind || classifyItem(item);
      if (kind === 'wall') {
        const edge = getWallEndpoints(item);
        return formatFeet(Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1));
      }
      if (kind === 'line') {
        let total = 0;
        const pts = item.points || [];
        for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return formatFeet(total);
      }
      if (kind === 'fixture') {
        const sub = fixtureSubtype(item);
        if (sub === 'door' || sub === 'window') return `${formatFeet(item.width || 0)} wide`;
      }
      const width = Math.max(1, kind === 'room' ? Math.max(60, item.width || 120) : (item.width || 16));
      const height = Math.max(1, kind === 'room' ? Math.max(40, item.height || 80) : (item.height || 16));
      return `${formatFeet(width)} × ${formatFeet(height)}`;
    }

    function updatePropToolbar() {
      if (!propToolbar) return;
      const selection = selectedItemsOnFloor();
      const editable = selection.filter(item => !isMutationLocked(item));
      if (!editable.length) {
        propToolbar.classList.add('hidden');
        return;
      }
      propToolbar.classList.remove('hidden');
      const dims = propToolbar.querySelector('.floorplan-prop-dims');
      if (dims) {
        dims.textContent = editable.length === 1
          ? selectionDimsLabel(editable[0])
          : `${editable.length} selected`;
      }
      const hasDoor = editable.some(item => fixtureSubtype(item) === 'door');
      propToolbar.querySelectorAll('.floorplan-prop-door').forEach((btn) => {
        btn.classList.toggle('hidden', !hasDoor);
      });
      const hasRotatable = editable.some(isRotatable);
      propToolbar.querySelectorAll('.floorplan-prop-rotate-left, .floorplan-prop-rotate-right, .floorplan-prop-flip-h, .floorplan-prop-flip-v').forEach((btn) => {
        btn.disabled = !hasRotatable;
      });
    }

    /* ---------- Reusable stroke-style controls (row 24) ---------- */
    function lineTypeSelect(value, onChange) {
      const sel = el('select', {
        className: 'floorplan-line-type',
        title: 'Line type',
        on: { change: (e) => onChange(e.target.value) },
      }, LINE_TYPES.map(([v, l]) => el('option', { value: v }, [l])));
      sel.value = value;
      return sel;
    }

    function strokeWidthInput(value, onChange) {
      return el('input', {
        className: 'floorplan-line-weight',
        type: 'number', min: '1', max: '10', step: '1',
        value: String(value),
        title: 'Line weight (px)',
        inputmode: 'numeric',
        on: {
          change: (e) => {
            const n = clamp(parseInt(e.target.value, 10) || 1, 1, 10);
            e.target.value = String(n);
            onChange(n);
          },
        },
      });
    }

    function strokeColorControl(value, onChange) {
      const picker = el('input', {
        className: 'floorplan-line-color', type: 'color', value,
        title: 'Line color',
        on: { input: (e) => onChange(e.target.value) },
      });
      const swatches = el('div', { className: 'floorplan-color-swatches' }, STROKE_SWATCHES.map(c =>
        el('button', {
          className: 'floorplan-color-swatch', type: 'button', title: c,
          style: { background: c },
          on: { click: () => { picker.value = c; onChange(c); } },
        }, [])));
      return el('div', { className: 'floorplan-color-control' }, [picker, swatches]);
    }

    /* ---------- Properties inspector (rows 17, 21, 22, 24, 26, 28) ---------- */
    const inspector = board.querySelector('.floorplan-inspector');
    let inspectorSig = null;
    let inspectorRefreshers = [];

    function selectionSignature() {
      return [...state.selectedIds].sort().join(',');
    }

    function feetValue(units) {
      return Math.round((Number(units) || 0) / UNITS_PER_FOOT * 100) / 100;
    }

    /* A labelled numeric field expressed in feet; commits on Enter or blur. */
    function feetField(labelText, field, getUnits, setUnits, opts = {}) {
      const input = el('input', {
        className: 'floorplan-insp-input',
        type: 'number', min: String(opts.min ?? 0.25), step: String(opts.step ?? 0.25),
        inputmode: 'decimal',
        value: String(feetValue(getUnits())),
        dataset: { field },
        on: {
          change: (e) => {
            const f = parseFloat(e.target.value);
            if (!Number.isFinite(f)) return;
            pushUndoCheckpoint();
            setUnits(Math.max(0, f) * UNITS_PER_FOOT);
            renderScene();
            queuePersistDraft();
          },
          keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        },
      });
      inspectorRefreshers.push(() => {
        if (document.activeElement !== input) input.value = String(feetValue(getUnits()));
      });
      return el('label', { className: 'floorplan-insp-row' }, [
        el('span', { className: 'floorplan-insp-label' }, [labelText]),
        input,
        el('span', { className: 'floorplan-insp-unit' }, ['ft']),
      ]);
    }

    function plainNumberField(labelText, field, getVal, setVal, opts = {}) {
      const input = el('input', {
        className: 'floorplan-insp-input',
        type: 'number', min: String(opts.min ?? 0), max: opts.max != null ? String(opts.max) : undefined,
        step: String(opts.step ?? 1),
        inputmode: 'numeric',
        value: String(Math.round(getVal())),
        dataset: { field },
        on: {
          change: (e) => {
            const n = parseFloat(e.target.value);
            if (!Number.isFinite(n)) return;
            pushUndoCheckpoint();
            setVal(n);
            renderScene();
            queuePersistDraft();
          },
          keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        },
      });
      inspectorRefreshers.push(() => {
        if (document.activeElement !== input) input.value = String(Math.round(getVal()));
      });
      return el('label', { className: 'floorplan-insp-row' }, [
        el('span', { className: 'floorplan-insp-label' }, [labelText]),
        input,
        opts.unit ? el('span', { className: 'floorplan-insp-unit' }, [opts.unit]) : null,
      ]);
    }

    /* Change a wall's length while keeping its start anchored and re-aligning
       any hosted doors/windows (row 28). */
    function setWallLength(item, newLen) {
      const e = getWallEndpoints(item);
      const origin = { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
      const curLen = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
      const ux = (e.x2 - e.x1) / curLen;
      const uy = (e.y2 - e.y1) / curLen;
      const L = clamp(newLen, UNITS_PER_FOOT * 0.5, 4000);
      item.x = e.x1;
      item.y = e.y1;
      item.x2 = e.x1 + ux * L;
      item.y2 = e.y1 + uy * L;
      item.length = Math.hypot(item.x2 - item.x, item.y2 - item.y);
      item.width = Math.abs(item.x2 - item.x);
      item.height = Math.abs(item.y2 - item.y);
      recomputeWallOpenings(item, origin);
    }

    function lockButton(selected) {
      const anyLocked = selected.some(item => item.locked);
      return el('button', {
        className: `floorplan-insp-lock${anyLocked ? ' locked' : ''}`,
        type: 'button',
        title: anyLocked ? 'Unlock' : 'Lock (prevents moving, resizing, rotating, deleting)',
        on: { click: () => toggleSelectionLock() },
      }, [anyLocked ? '🔒 Locked' : '🔓 Lock']);
    }

    function styleControls(item) {
      const lineType = item.lineType || 'solid';
      const weight = item.strokeWidth || 3;
      const color = item.strokeColor || '#0f766e';
      const commit = (patch) => {
        pushUndoCheckpoint();
        Object.assign(item, patch);
        renderScene();
        queuePersistDraft();
      };
      return el('div', { className: 'floorplan-insp-style' }, [
        el('span', { className: 'floorplan-insp-label' }, ['Style']),
        lineTypeSelect(lineType, (v) => commit({ lineType: v })),
        strokeWidthInput(weight, (v) => commit({ strokeWidth: v })),
        strokeColorControl(color, (v) => commit({ strokeColor: v })),
      ]);
    }

    function assignLayerToSelection(value) {
      if (!value) return;
      const targets = editableSelection();
      if (!targets.length) return;
      pushUndoCheckpoint();
      targets.forEach((item) => {
        if (value === '__default__') delete item.customLayer;
        else item.customLayer = value;
      });
      renderScene();
      queuePersistDraft();
    }

    function buildInspector(selected) {
      inspectorRefreshers = [];
      inspector.innerHTML = '';
      if (selected.length > 1) {
        const anyGrouped = selected.some(item => item.groupId);
        const linears = selected.filter((i) => {
          const k = i.kind || classifyItem(i);
          return k === 'wall' || k === 'line';
        });
        const batchLayer = el('select', {
          className: 'floorplan-insp-layer floorplan-batch-layer',
          title: 'Batch layer assignment',
          on: { change: (e) => assignLayerToSelection(e.target.value) },
        }, [
          el('option', { value: '' }, ['Mixed / unchanged']),
          el('option', { value: '__default__' }, ['Default']),
          ...state.customLayers.map(cl => el('option', { value: cl.name }, [cl.name])),
        ]);
        inspector.append(
          el('div', { className: 'floorplan-insp-title' }, [`${selected.length} objects selected`]),
          el('label', { className: 'floorplan-insp-row' }, [el('span', { className: 'floorplan-insp-label' }, ['Layer']), batchLayer]),
          el('div', { className: 'floorplan-insp-actions' }, [
            el('button', { className: 'floorplan-insp-group', type: 'button', title: 'Group (Ctrl+G)', on: { click: () => groupSelection() } }, ['⧉ Group']),
            anyGrouped ? el('button', { className: 'floorplan-insp-ungroup', type: 'button', title: 'Ungroup (Ctrl+Shift+G)', on: { click: () => ungroupSelection() } }, ['Ungroup']) : null,
            (selected.length === 2 && linears.length === 2) ? el('button', { className: 'floorplan-insp-join', type: 'button', title: 'Join the two walls/lines at their intersection', on: { click: () => joinSelection() } }, ['⌐ Join']) : null,
            lockButton(selected),
          ]),
        );
        return;
      }
      const item = selected[0];
      const kind = item.kind || classifyItem(item);
      const sub = fixtureSubtype(item);
      const rows = [el('div', { className: 'floorplan-insp-title' }, [inspectorTitle(item, kind, sub)])];

      if (kind === 'wall') {
        rows.push(feetField('Length', 'length', () => Math.hypot(getWallEndpoints(item).x2 - item.x, getWallEndpoints(item).y2 - item.y), (u) => setWallLength(item, u)));
      } else if (sub === 'door' || sub === 'window') {
        rows.push(feetField('Width', 'width', () => item.width || 2 * UNITS_PER_FOOT, (u) => { item.width = clamp(u, 10, 240); }));
      } else if (kind === 'circle') {
        rows.push(feetField('Radius', 'radius', () => item.radius || 20, (u) => { item.radius = clamp(u, 2, 2000); }, { min: 0.25 }));
        rows.push(feetField('Diameter', 'diameter', () => (item.radius || 20) * 2, (u) => { item.radius = clamp(u / 2, 2, 2000); }, { min: 0.5 }));
      } else if (kind === 'room') {
        rows.push(feetField('Width', 'width', () => Math.max(60, item.width || 120), (u) => { item.width = clamp(u, 40, 4000); }));
        rows.push(feetField('Height', 'height', () => Math.max(40, item.height || 80), (u) => { item.height = clamp(u, 34, 4000); }));
      } else if (kind === 'fixture' || (item.symbolKey && (kind === 'electrical' || kind === 'plumbing'))) {
        rows.push(feetField('Width', 'width', () => item.width || 18, (u) => { item.width = clamp(u, 6, 4000); }));
        rows.push(feetField('Height', 'height', () => item.height || 18, (u) => { item.height = clamp(u, 6, 4000); }));
        rows.push(plainNumberField('Rotation', 'rotation', () => Number(item.angle) || 0, (n) => { item.angle = ((n % 360) + 360) % 360; }, { min: -360, max: 360, unit: '°' }));
        rows.push(el('button', { className: `floorplan-aspect-lock${item.aspectLocked === false ? '' : ' active'}`, type: 'button', title: 'Toggle aspect-ratio lock', on: { click: () => { item.aspectLocked = item.aspectLocked !== false ? false : true; inspectorSig = null; renderScene(); queuePersistDraft(); } } }, [item.aspectLocked === false ? '🔓 Freeform stretch' : '🔗 Aspect locked']));
        rows.push(el('label', { className: 'floorplan-insp-row floorplan-ai-prompt-row' }, [
          el('span', { className: 'floorplan-insp-label' }, ['AI Prompt']),
          el('input', { className: 'floorplan-ai-prompt-input', value: item.aiPrompt || '', placeholder: 'Material, style, finish...', on: { change: (e) => { item.aiPrompt = e.target.value; recordObjectMetadata(item, 'aiPrompt', item.aiPrompt); queuePersistDraft(); } } }),
        ]));
        rows.push(el('label', { className: 'floorplan-insp-row floorplan-ai-ref-row' }, [
          el('span', { className: 'floorplan-insp-label' }, ['Seed Photo']),
          el('input', { className: 'floorplan-ai-ref-input', value: item.referencePhoto || '', placeholder: 'Reference URL or note', on: { change: (e) => { item.referencePhoto = e.target.value; recordObjectMetadata(item, 'referencePhoto', item.referencePhoto); queuePersistDraft(); } } }),
        ]));
        rows.push(el('label', { className: 'floorplan-insp-row floorplan-ai-seed-row' }, [
          el('span', { className: 'floorplan-insp-label' }, ['Upload']),
          el('input', { className: 'floorplan-ai-seed-file', type: 'file', accept: 'image/*', on: { change: (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            item.referencePhoto = file.name;
            recordObjectMetadata(item, 'referencePhoto', file.name);
            inspectorSig = null;
            renderScene();
            queuePersistDraft();
          } } }),
        ]));
      }

      if (kind === 'line' || kind === 'circle') {
        rows.push(styleControls(item));
      }

      rows.push(layerSelectRow(item));

      rows.push(el('div', { className: 'floorplan-insp-actions' }, [lockButton([item])]));
      inspector.append(...rows.filter(Boolean));
    }

    function inspectorTitle(item, kind, sub) {
      if (sub === 'door') return 'Door';
      if (sub === 'window') return 'Window';
      if (kind === 'circle') return 'Circle';
      if (kind === 'line') return item.closed ? 'Shape' : 'Line';
      const name = normalizeText(item.label) || normalizeText(item.type);
      return name || (kind.charAt(0).toUpperCase() + kind.slice(1));
    }

    function refreshInspectorValues() {
      inspectorRefreshers.forEach(fn => fn());
    }

    function updateInspector() {
      if (!inspector) return;
      const selected = selectedItemsOnFloor();
      if (!selected.length) {
        inspector.classList.add('hidden');
        inspector.innerHTML = '';
        inspectorSig = null;
        inspectorRefreshers = [];
        return;
      }
      inspector.classList.remove('hidden');
      const sig = selectionSignature();
      if (sig !== inspectorSig) {
        inspectorSig = sig;
        buildInspector(selected);
      } else {
        refreshInspectorValues();
      }
    }

    function focusInspectorField(field) {
      updateInspector();
      if (!inspector) return;
      const input = inspector.querySelector(`.floorplan-insp-input[data-field="${field}"]`);
      if (input) { input.focus(); if (typeof input.select === 'function') input.select(); }
    }

    /* Delete a vertex from a line/shape (row 25). */
    function deleteVertex(item, idx) {
      if (!item || !Array.isArray(item.points)) return;
      const canDelete = item.closed ? item.points.length > 3 : item.points.length > 2;
      if (!canDelete) {
        showToast('Cannot delete — minimum points reached.', 'error');
        return;
      }
      if (idx < 0 || idx >= item.points.length) return;
      pushUndoCheckpoint();
      item.points.splice(idx, 1);
      item.x = item.points[0].x;
      item.y = item.points[0].y;
      renderScene();
      queuePersistDraft();
      setFeedback('Vertex deleted');
    }

    function finalizeLine(closed) {
      const draft = state.lineDraft;
      state.lineDraft = null;
      state.lineCursor = null;
      if (!draft || draft.points.length < 2) {
        renderScene();
        return;
      }
      pushUndoCheckpoint();
      const item = registerNewItem({
        id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        kind: 'line',
        type: 'Line',
        label: '',
        layer: 'line',
        points: draft.points.map(p => ({ x: p.x, y: p.y })),
        closed: Boolean(closed),
        lineType: state.lineStyle.lineType,
        strokeWidth: state.lineStyle.strokeWidth,
        strokeColor: state.lineStyle.strokeColor,
        x: draft.points[0].x,
        y: draft.points[0].y,
      });
      state.items.push(item);
      state.lastCreateAt = Date.now();
      renderScene();
      queuePersistDraft();
      setFeedback(`${closed ? 'Shape' : 'Line'} added (${draft.points.length} points)`);
    }

    function cancelLineDraft() {
      if (!state.lineDraft) return;
      state.lineDraft = null;
      state.lineCursor = null;
      renderScene();
      setFeedback('Line cancelled');
    }

    /* ---------- Viewport: zoom & pan (row 18) ----------
       Zoom/pan is driven entirely by the SVG viewBox. Because the browser
       computes getScreenCTM() from the live viewBox, every existing pointer
       helper (pointFromEvent) keeps returning correct world coordinates with
       zero extra math — the viewBox is the single source of truth. */
    const VIEW_W = 960;
    const VIEW_H = 620;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4;

    function clampZoom(z) {
      return clamp(Number.isFinite(z) ? z : 1, ZOOM_MIN, ZOOM_MAX);
    }

    function renderDynamicGrid() {
      if (!gridLayer) return;
      gridLayer.innerHTML = '';
      const box = getWorldBoundsFromViewBox(svg);
      const major = currentGridUnits();
      const minor = Math.max(major / 4, 2.5);
      const minX = Math.floor((box.x - major) / minor) * minor;
      const maxX = Math.ceil((box.x + box.width + major) / minor) * minor;
      const minY = Math.floor((box.y - major) / minor) * minor;
      const maxY = Math.ceil((box.y + box.height + major) / minor) * minor;
      for (let x = minX; x <= maxX; x += minor) {
        const majorLine = Math.abs(x / major - Math.round(x / major)) < 0.001;
        gridLayer.append(svgEl('line', { x1: x, y1: minY, x2: x, y2: maxY, className: `floorplan-grid-line${majorLine ? ' floorplan-grid-major' : ''}`, 'data-dynamic-grid': 'true' }));
      }
      for (let y = minY; y <= maxY; y += minor) {
        const majorLine = Math.abs(y / major - Math.round(y / major)) < 0.001;
        gridLayer.append(svgEl('line', { x1: minX, y1: y, x2: maxX, y2: y, className: `floorplan-grid-line${majorLine ? ' floorplan-grid-major' : ''}`, 'data-dynamic-grid': 'true' }));
      }
    }

    function applyView() {
      const z = clampZoom(state.view.zoom);
      state.view.zoom = z;
      const w = VIEW_W / z;
      const h = VIEW_H / z;
      svg.setAttribute('viewBox', `${round2(state.view.x)} ${round2(state.view.y)} ${round2(w)} ${round2(h)}`);
      renderDynamicGrid();
      const readout = board.querySelector('.floorplan-zoom-readout');
      if (readout) readout.textContent = `${Math.round(z * 100)}%`;
      const out = board.querySelector('.floorplan-zoom-out');
      const inc = board.querySelector('.floorplan-zoom-in');
      if (out) out.disabled = z <= ZOOM_MIN + 0.001;
      if (inc) inc.disabled = z >= ZOOM_MAX - 0.001;
    }

    function round2(n) {
      return Math.round(n * 100) / 100;
    }

    /* Screen (client) coordinates → world units, without clamping. */
    function screenToWorld(clientX, clientY) {
      const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
      if (ctm && typeof svg.createSVGPoint === 'function') {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const local = pt.matrixTransform(ctm.inverse());
        return { x: local.x, y: local.y };
      }
      const rect = svg.getBoundingClientRect();
      const z = clampZoom(state.view.zoom);
      return {
        x: state.view.x + ((clientX - rect.left) / rect.width) * (VIEW_W / z),
        y: state.view.y + ((clientY - rect.top) / rect.height) * (VIEW_H / z),
      };
    }

    /* Zoom to a target level while keeping the world point under (clientX,
       clientY) fixed on screen. Uses two getScreenCTM reads so it stays exact
       regardless of preserveAspectRatio letterboxing. */
    function zoomAtScreen(nextZoom, clientX, clientY) {
      const z = clampZoom(nextZoom);
      if (Math.abs(z - state.view.zoom) < 0.0001) return;
      const before = screenToWorld(clientX, clientY);
      state.view.zoom = z;
      applyView();
      const after = screenToWorld(clientX, clientY);
      state.view.x += before.x - after.x;
      state.view.y += before.y - after.y;
      applyView();
    }

    function svgCenterClient() {
      const rect = svg.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function zoomByStep(factor) {
      const c = svgCenterClient();
      zoomAtScreen(state.view.zoom * factor, c.x, c.y);
    }

    function resetView() {
      state.view = { zoom: 1, x: 0, y: 0 };
      applyView();
    }

    /* Bounding box of every item on the current floor (world units). */
    function contentBounds() {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const add = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      };
      state.items.forEach((item) => {
        if (getItemFloor(item) !== state.currentFloor) return;
        const kind = item.kind || classifyItem(item);
        if (kind === 'wall') {
          const e = getWallEndpoints(item);
          add(e.x1, e.y1); add(e.x2, e.y2);
        } else if (kind === 'line' || kind === 'measure') {
          (item.points || []).forEach(p => add(p.x, p.y));
        } else if (kind === 'circle') {
          const r = Math.max(2, item.radius || 20);
          add((item.x || 0) - r, (item.y || 0) - r);
          add((item.x || 0) + r, (item.y || 0) + r);
        } else if (kind === 'room') {
          const w = Math.max(60, item.width || 120);
          const h = Math.max(40, item.height || 80);
          add(item.x, item.y); add(item.x + w, item.y + h);
        } else {
          const w = Math.max(8, item.width || 18);
          const h = Math.max(8, item.height || 18);
          add((item.x || 0) - w / 2, (item.y || 0) - h / 2);
          add((item.x || 0) + w / 2, (item.y || 0) + h / 2);
        }
      });
      if (minX === Infinity) return null;
      return { minX, minY, maxX, maxY };
    }

    function zoomToFit() {
      const box = contentBounds();
      if (!box) {
        resetView();
        setFeedback('Zoom reset — nothing drawn yet');
        return;
      }
      const spanX = Math.max(40, box.maxX - box.minX);
      const spanY = Math.max(40, box.maxY - box.minY);
      const padX = spanX * 0.1 + 24;
      const padY = spanY * 0.1 + 24;
      const bw = spanX + padX * 2;
      const bh = spanY + padY * 2;
      const z = clampZoom(Math.min(VIEW_W / bw, VIEW_H / bh));
      state.view.zoom = z;
      const w = VIEW_W / z;
      const h = VIEW_H / z;
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      state.view.x = cx - w / 2;
      state.view.y = cy - h / 2;
      applyView();
      setFeedback(`Zoom to fit — ${Math.round(z * 100)}%`);
    }

    board.addEventListener('mouseover', (event) => {
      const control = event.target && event.target.closest ? event.target.closest('button, summary') : null;
      if (!control) return;
      const label = normalizeText(control.getAttribute('title') || control.textContent || '');
      if (label) setFeedback(`Hover: ${label}`);
    });

    board.addEventListener('focusin', (event) => {
      const control = event.target && event.target.closest ? event.target.closest('button, summary') : null;
      if (!control) return;
      const label = normalizeText(control.getAttribute('title') || control.textContent || '');
      if (label) setFeedback(`Focus: ${label}`);
    });

    board.addEventListener('click', (event) => {
      const control = event.target && event.target.closest ? event.target.closest('button, summary') : null;
      if (!control) return;
      if (control.classList.contains('floorplan-export-3d-jpeg')) export3dJpeg();
      if (control.classList.contains('floorplan-export-3d-pdf')) export3dPdf();
      const label = normalizeText(control.getAttribute('title') || control.textContent || '');
      if (label) setFeedback(`Action: ${label}`);
    });

    svg.addEventListener('pointermove', (event) => {
      state.lastPointer = screenToWorld(event.clientX, event.clientY);
      const itemNode = event.target && event.target.closest ? event.target.closest('[data-floorplan-item]') : null;
      if (!itemNode) return;
      const labelText = normalizeText(itemNode.getAttribute('data-floorplan-label') || '');
      if (labelText) setFeedback(`Hover Item: ${labelText}`);
    });

    svg.addEventListener('pointerleave', () => {
      const selectedCount = state.selectedIds.size;
      if (selectedCount > 1) {
        setFeedback(`Selected ${selectedCount} items`);
      } else if (selectedCount === 1 && state.selectedId) {
        const selected = findItemById(state.selectedId);
        setFeedback(selected ? `Selected: ${itemFeedbackLabel(selected)}` : 'Ready');
      } else {
        setFeedback('Ready');
      }
    });

    interiorSvg.addEventListener('click', (event) => {
      const face = event.target && event.target.closest ? event.target.closest('[data-face]') : null;
      if (!face || state.tool !== 'symbol') return;
      const selected = state.selectedId ? findItemById(state.selectedId) : null;
      if (!selected || (selected.kind || classifyItem(selected)) !== 'room') {
        showToast('Select a room first to place interior symbols.', 'error');
        return;
      }
      if (!Array.isArray(selected.interior)) selected.interior = [];
      pushUndoCheckpoint();
      const rect = interiorSvg.getBoundingClientRect();
      const clientX = event.clientX || rect.left;
      const clientY = event.clientY || rect.top;
      const x = ((clientX - rect.left) / rect.width) * 320;
      const y = ((clientY - rect.top) / rect.height) * 260;
      selected.interior.push({
        face: face.dataset.face,
        symbol: (state.symbolPreset || HOUSEHOLD_SYMBOLS[0]).icon,
        x: clamp(x, 86, 234),
        y: clamp(y, 76, 214),
      });
      renderScene();
      queuePersistDraft();
    });

    function renderInteriorView() {
      if (!state.interiorEnabled) return;
      interiorSvg.innerHTML = '';
      const selected = state.selectedId ? findItemById(state.selectedId) : null;
      const selectedRoom = selected && (selected.kind || classifyItem(selected)) === 'room'
        ? selected
        : null;

      if (!selectedRoom || getItemFloor(selectedRoom) !== state.currentFloor) {
        interiorSvg.append(svgEl('text', {
          x: 160,
          y: 130,
          'text-anchor': 'middle',
          className: 'floorplan-interior-empty',
        }, ['Select a room to edit interior surfaces']));
        return;
      }

      if (!Array.isArray(selectedRoom.interior)) selectedRoom.interior = [];
      const faces = [
        { key: 'back', polygon: '80,70 240,70 210,110 110,110', fill: '#dbeafe' },
        { key: 'left', polygon: '80,70 110,110 110,210 80,180', fill: '#cfe2ff' },
        { key: 'right', polygon: '240,70 210,110 210,210 240,180', fill: '#cfe2ff' },
        { key: 'floor', polygon: '110,110 210,110 210,210 110,210', fill: '#f1f5f9' },
      ];

      faces.forEach((face) => {
        interiorSvg.append(svgEl('polygon', {
          points: face.polygon,
          className: 'floorplan-interior-face',
          fill: face.fill,
          stroke: '#64748b',
          'stroke-width': '1.5',
          'data-face': face.key,
        }));
      });

      selectedRoom.interior.forEach((mark) => {
        interiorSvg.append(svgEl('text', {
          x: mark.x,
          y: mark.y,
          className: 'floorplan-symbol-glyph',
          'text-anchor': 'middle',
          'font-size': '12',
        }, [mark.symbol]));
      });
    }

    function doorArcPoints(cx, cy, r, a0, a1, steps = 12) {
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const pts = [];
      for (let i = 0; i <= steps; i += 1) {
        const a = a0 + (delta * i) / steps;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
      }
      return pts.join(' ');
    }

    /* Draw a door opening with leaf + swing arc in local space
       (wall runs along the x-axis, opening centered on origin). */
    function appendDoorGraphic(group, width, side, dir) {
      const W = Math.max(10, width);
      const half = W / 2;
      const hingeX = side === 'right' ? half : -half;
      const freeX = -hingeX;
      const sweepY = dir === 'out' ? -W : W;
      // clear the wall under the opening
      group.append(svgEl('line', { x1: -half, y1: 0, x2: half, y2: 0, stroke: '#ffffff', 'stroke-width': 7 }));
      // jamb ticks
      group.append(svgEl('line', { x1: -half, y1: -4, x2: -half, y2: 4, stroke: '#334155', 'stroke-width': 2 }));
      group.append(svgEl('line', { x1: half, y1: -4, x2: half, y2: 4, stroke: '#334155', 'stroke-width': 2 }));
      // door leaf shown in the open position
      group.append(svgEl('line', { x1: hingeX, y1: 0, x2: hingeX, y2: sweepY, stroke: '#b45309', 'stroke-width': 2.5, 'stroke-linecap': 'round', class: 'floorplan-door-leaf' }));
      // swing arc from closed free-end to open leaf tip
      const a0 = Math.atan2(0, freeX - hingeX);
      const a1 = Math.atan2(sweepY, 0);
      group.append(svgEl('polyline', {
        points: doorArcPoints(hingeX, 0, W, a0, a1, 12),
        fill: 'none',
        stroke: '#b45309',
        'stroke-width': 1.2,
        'stroke-dasharray': '3 3',
        class: 'floorplan-door-arc',
      }));
      // hit area covering the swing
      group.append(svgEl('rect', { x: -half, y: Math.min(0, sweepY) - 4, width: W, height: Math.abs(sweepY) + 8, fill: 'transparent', class: 'floorplan-hit' }));
    }

    /* Draw a window in local space (wall along the x-axis). */
    function appendWindowGraphic(group, width) {
      const W = Math.max(10, width);
      const half = W / 2;
      const t = 3;
      group.append(svgEl('line', { x1: -half, y1: 0, x2: half, y2: 0, stroke: '#ffffff', 'stroke-width': 7 }));
      group.append(svgEl('line', { x1: -half, y1: -t, x2: half, y2: -t, stroke: '#0ea5e9', 'stroke-width': 1.6 }));
      group.append(svgEl('line', { x1: -half, y1: t, x2: half, y2: t, stroke: '#0ea5e9', 'stroke-width': 1.6 }));
      group.append(svgEl('line', { x1: -half, y1: 0, x2: half, y2: 0, stroke: '#38bdf8', 'stroke-width': 1.2 }));
      group.append(svgEl('line', { x1: -half, y1: -t, x2: -half, y2: t, stroke: '#334155', 'stroke-width': 1.6 }));
      group.append(svgEl('line', { x1: half, y1: -t, x2: half, y2: t, stroke: '#334155', 'stroke-width': 1.6 }));
      group.append(svgEl('rect', { x: -half, y: -t - 3, width: W, height: 2 * t + 6, fill: 'transparent', class: 'floorplan-hit' }));
    }

    /* Build a placed, rotatable/flippable top-down symbol object group
       (used by furniture fixtures and electrical/plumbing symbols alike). */
    function buildSymbolItemGroup(item, kindClass, isSelected, itemOpacity) {
      const x = Number.isFinite(item.x) ? item.x : 40;
      const y = Number.isFinite(item.y) ? item.y : 40;
      const rotation = Number.isFinite(item.angle) ? Number(item.angle) : 0;
      const w = Math.max(8, item.width || 18);
      const h = Math.max(8, item.height || 18);
      const group = svgEl('g', {
        className: `floorplan-item ${kindClass}${isSelected ? ' floorplan-selected' : ''}`,
        'data-floorplan-item': String(item.id),
        'data-floorplan-kind': item.kind || 'fixture',
        transform: `translate(${x} ${y}) rotate(${rotation})`,
        opacity: itemOpacity,
      });
      group.append(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, fill: 'transparent', class: 'floorplan-hit' }));
      const key = item.symbolKey && hasSymbolDrawing(item.symbolKey)
        ? item.symbolKey
        : inferSymbolKey(`${item.label || ''} ${item.type || ''}`);
      const graphic = key ? buildSymbolGraphic(key, w, h) : null;
      if (graphic) {
        const flipH = item.flipH ? -1 : 1;
        const flipV = item.flipV ? -1 : 1;
        if (flipH === -1 || flipV === -1) graphic.setAttribute('transform', `scale(${flipH} ${flipV})`);
        group.append(graphic);
      } else {
        group.append(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, fill: '#f8fafc', stroke: '#64748b', 'stroke-width': '1.5' }));
      }
      return { group, hasGraphic: Boolean(graphic) };
    }

    function renderScene() {
      scene.innerHTML = '';
      const layers = {
        room: svgEl('g', { className: 'floorplan-layer floorplan-layer-room' }),
        wall: svgEl('g', { className: 'floorplan-layer floorplan-layer-wall' }),
        line: svgEl('g', { className: 'floorplan-layer floorplan-layer-line' }),
        electrical: svgEl('g', { className: 'floorplan-layer floorplan-layer-electrical' }),
        plumbing: svgEl('g', { className: 'floorplan-layer floorplan-layer-plumbing' }),
        fixture: svgEl('g', { className: 'floorplan-layer floorplan-layer-fixture' }),
        measure: svgEl('g', { className: 'floorplan-layer floorplan-layer-measure' }),
      };
      scene.append(...Object.values(layers));

      // Custom layers (row 22) render after the built-in layers; their array
      // order is the z-order (first = front-most within the custom set).
      const customGroups = {};
      for (let i = state.customLayers.length - 1; i >= 0; i -= 1) {
        const cl = state.customLayers[i];
        const g = svgEl('g', { className: 'floorplan-layer floorplan-custom-layer', 'data-custom-layer': cl.name });
        customGroups[cl.name] = g;
        scene.append(g);
      }

      const label = (text, x, y, fill = '#0f172a', className = 'floorplan-label') => svgEl('text', {
        x,
        y,
        className,
        fill,
        'font-size': '12',
        'font-weight': '600',
        'text-anchor': 'middle',
      }, [text]);

      /* A tape-measure style dimension between two points. */
      const buildDimension = (p1, p2, opts = {}) => {
        const group = svgEl('g', { className: opts.className || 'floorplan-dim' });
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const tick = 6;
        const stroke = opts.stroke || '#9333ea';
        if (opts.hit) {
          group.append(svgEl('line', {
            x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
            stroke: 'transparent', 'stroke-width': 14, class: 'floorplan-hit',
          }));
        }
        group.append(svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke, 'stroke-width': opts.sw || 1.6, 'stroke-dasharray': opts.dash || '', 'stroke-linecap': 'round' }));
        group.append(svgEl('line', { x1: p1.x + nx * tick, y1: p1.y + ny * tick, x2: p1.x - nx * tick, y2: p1.y - ny * tick, stroke, 'stroke-width': 1.6 }));
        group.append(svgEl('line', { x1: p2.x + nx * tick, y1: p2.y + ny * tick, x2: p2.x - nx * tick, y2: p2.y - ny * tick, stroke, 'stroke-width': 1.6 }));
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const text = formatFeet(Math.hypot(dx, dy));
        group.append(svgEl('rect', { x: mx - (text.length * 3.6) - 4, y: my - 18, width: (text.length * 7.2) + 8, height: 15, rx: 4, fill: '#ffffff', stroke, 'stroke-width': 0.8, opacity: 0.95 }));
        group.append(svgEl('text', { x: mx, y: my - 7, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#6b21a8' }, [text]));
        return group;
      };

      [...state.items].sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0)).forEach((item) => {
        const kind = item.kind || classifyItem(item);
        const itemFloor = getItemFloor(item);
        const isCurrentFloor = itemFloor === state.currentFloor;
        const isAlignedOverlay = state.alignBelow && itemFloor === (state.currentFloor - 1);
        if (!isCurrentFloor && !isAlignedOverlay) return;
        const layerKey = layerKeyForItem(item);
        if (item.customLayer && findCustomLayer(item.customLayer)) {
          if (isCustomLayerHidden(item.customLayer)) return;
        } else if (state.layerVisibility[layerKey] === false) {
          return;
        }
        const layer = (item.customLayer && customGroups[item.customLayer])
          ? customGroups[item.customLayer]
          : (layers[layerKey] || layers.fixture);
        const isSelected = isCurrentFloor && isItemSelected(item.id);
        const itemOpacity = isAlignedOverlay ? 0.32 : 1;

        if (kind === 'room') {
          const width = Math.max(60, item.width || 120);
          const height = Math.max(40, item.height || 80);
          const rect = svgEl('rect', {
            x: item.x,
            y: item.y,
            width,
            height,
            rx: 10,
            fill: '#dbeafe',
            stroke: '#60a5fa',
            'stroke-width': '2',
            className: `floorplan-room floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'room',
            opacity: itemOpacity,
          });
          layer.append(rect);
          if (hasMeaningfulLabel(item.label)) {
            const cx = item.x + (width / 2);
            const cy = item.y + (height / 2);
            const sqft = Math.round((width / UNITS_PER_FOOT) * (height / UNITS_PER_FOOT));
            const title = item.label;
            const sub = `${formatFeet(width)} × ${formatFeet(height)} · ${sqft} sq ft`;
            const pillW = Math.max(92, Math.max(title.length * 7, sub.length * 5.5) + 18);
            const pill = svgEl('g', { className: 'floorplan-room-label-pill' });
            pill.append(svgEl('rect', { x: cx - pillW / 2, y: cy - 17, width: pillW, height: 34, rx: 12, fill: 'rgba(255,255,255,0.72)', stroke: 'rgba(96,165,250,0.65)', 'stroke-width': 1 }));
            pill.append(svgEl('text', { x: cx, y: cy - 2, className: 'floorplan-room-label-title', 'text-anchor': 'middle' }, [title]));
            pill.append(svgEl('text', { x: cx, y: cy + 11, className: 'floorplan-room-label-sub', 'text-anchor': 'middle' }, [sub]));
            layer.append(pill);
          }
        }

        if (kind === 'wall') {
          const { x1, y1, x2, y2 } = getWallEndpoints(item);
          const line = svgEl('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: '#334155',
            'stroke-width': '6',
            'stroke-linecap': 'round',
            className: `floorplan-wall floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'wall',
            opacity: itemOpacity,
          });
          layer.append(line);
          // Wide transparent hit band (on top) so thin walls are easy to
          // select, drag, and trim.
          const wallAngle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          const wallLen = Math.hypot(x2 - x1, y2 - y1);
          layer.append(svgEl('rect', {
            x: 0, y: -8, width: wallLen, height: 16,
            fill: 'transparent',
            class: 'floorplan-hit',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'wall',
            transform: `translate(${x1} ${y1}) rotate(${wallAngle})`,
          }));

          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, (x1 + x2) / 2, Math.min(y1, y2) - 8, '#334155', 'floorplan-wall-label'));
          }
        }

        if (kind === 'line') {
          const pts = Array.isArray(item.points) ? item.points : [];
          if (pts.length >= 2) {
            const pointString = pts.map(p => `${p.x},${p.y}`).join(' ');
            const shapeTag = item.closed ? 'polygon' : 'polyline';
            const stroke = item.strokeColor || '#0f766e';
            const weight = item.strokeWidth || 3;
            const dash = dashArrayFor(item.lineType || 'solid', weight);
            // Wide invisible hit path so thin open lines are easy to grab.
            layer.append(svgEl(shapeTag, {
              points: pointString,
              fill: 'none',
              stroke: 'transparent',
              'stroke-width': Math.max(14, weight + 10),
              class: 'floorplan-hit',
              'data-floorplan-item': String(item.id),
              'data-floorplan-kind': 'line',
            }));
            layer.append(svgEl(shapeTag, {
              points: pointString,
              fill: item.closed ? 'rgba(15,118,110,0.08)' : 'none',
              stroke,
              'stroke-width': String(weight),
              'stroke-dasharray': dash,
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
              className: `floorplan-line floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
              'data-floorplan-item': String(item.id),
              'data-floorplan-kind': 'line',
              opacity: itemOpacity,
            }));
          }
        }

        if (kind === 'circle') {
          const cx = Number.isFinite(item.x) ? item.x : 60;
          const cy = Number.isFinite(item.y) ? item.y : 60;
          const r = Math.max(2, item.radius || 20);
          const stroke = item.strokeColor || '#0f766e';
          const weight = item.strokeWidth || 3;
          const dash = dashArrayFor(item.lineType || 'solid', weight);
          layer.append(svgEl('circle', {
            cx, cy, r,
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': Math.max(14, weight + 10),
            class: 'floorplan-hit',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'circle',
          }));
          layer.append(svgEl('circle', {
            cx, cy, r,
            fill: 'rgba(15,118,110,0.06)',
            stroke,
            'stroke-width': String(weight),
            'stroke-dasharray': dash,
            className: `floorplan-circle floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'circle',
            opacity: itemOpacity,
          }));
          if (isSelected) {
            layer.append(label(`r ${formatFeet(r)}`, cx, cy - r - 8, '#0f766e', 'floorplan-measure-label'));
          }
        }

        if (kind === 'measure') {
          const pts = Array.isArray(item.points) ? item.points : [];
          if (pts.length >= 2) {
            const dim = buildDimension(pts[0], pts[1], {
              className: `floorplan-measure-dim floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
              hit: true,
            });
            dim.setAttribute('data-floorplan-item', String(item.id));
            dim.setAttribute('data-floorplan-kind', 'measure');
            dim.setAttribute('opacity', itemOpacity);
            layer.append(dim);
          }
        }

        if (kind === 'electrical') {
          if (item.symbolKey && hasSymbolDrawing(item.symbolKey)) {
            const { group } = buildSymbolItemGroup(item, 'floorplan-electrical', isSelected, itemOpacity);
            layer.append(group);
          } else {
            const x = item.x || 40;
            const y = item.y || 40;
            layer.append(svgEl('circle', {
              cx: x,
              cy: y,
              r: 8,
              fill: '#4ade80',
              stroke: '#166534',
              'stroke-width': '2',
              className: `floorplan-electrical floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
              'data-floorplan-item': String(item.id),
              'data-floorplan-kind': 'electrical',
              opacity: itemOpacity,
            }));
          }
          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, (item.x || 40) + 16, (item.y || 40) - 12, '#166534', 'floorplan-device-label'));
          }
        }

        if (kind === 'plumbing') {
          if (item.symbolKey && hasSymbolDrawing(item.symbolKey)) {
            const { group } = buildSymbolItemGroup(item, 'floorplan-plumbing', isSelected, itemOpacity);
            layer.append(group);
          } else {
            const x = item.x || 40;
            const y = item.y || 40;
            layer.append(svgEl('rect', {
              x: x - 9,
              y: y - 9,
              width: 18,
              height: 18,
              rx: 4,
              fill: '#93c5fd',
              stroke: '#1d4ed8',
              'stroke-width': '2',
              className: `floorplan-plumbing floorplan-item${isSelected ? ' floorplan-selected' : ''}`,
              'data-floorplan-item': String(item.id),
              'data-floorplan-kind': 'plumbing',
              opacity: itemOpacity,
            }));
          }
          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, (item.x || 40) + 18, (item.y || 40) - 12, '#1d4ed8', 'floorplan-device-label'));
          }
        }

        if (kind === 'fixture') {
          const x = Number.isFinite(item.x) ? item.x : 40;
          const y = Number.isFinite(item.y) ? item.y : 40;
          const subtype = fixtureSubtype(item);
          const rotation = Number.isFinite(item.angle) ? Number(item.angle) : 0;
          const group = svgEl('g', {
            className: `floorplan-fixture floorplan-item floorplan-${subtype}${isSelected ? ' floorplan-selected' : ''}`,
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'fixture',
            'data-floorplan-subtype': subtype,
            transform: `translate(${x} ${y}) rotate(${rotation})`,
            opacity: itemOpacity,
          });

          if (subtype === 'door') {
            appendDoorGraphic(group, Math.max(10, item.width || 3 * UNITS_PER_FOOT), item.swingSide, item.swingDir);
          } else if (subtype === 'window') {
            appendWindowGraphic(group, Math.max(10, item.width || 2 * UNITS_PER_FOOT));
          } else {
            const w = Math.max(8, item.width || 18);
            const h = Math.max(8, item.height || 18);
            const key = item.symbolKey && hasSymbolDrawing(item.symbolKey)
              ? item.symbolKey
              : inferSymbolKey(`${item.label || ''} ${item.type || ''}`);
            // transparent hit area so the whole footprint is clickable
            group.append(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, fill: 'transparent', class: 'floorplan-hit' }));
            const graphic = key ? buildSymbolGraphic(key, w, h) : null;
            if (graphic) {
              const flipH = item.flipH ? -1 : 1;
              const flipV = item.flipV ? -1 : 1;
              if (flipH === -1 || flipV === -1) graphic.setAttribute('transform', `scale(${flipH} ${flipV})`);
              group.append(graphic);
            } else {
              group.append(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, fill: '#f8fafc', stroke: '#64748b', 'stroke-width': '1.5' }));
            }
          }
          layer.append(group);

          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 18, y - 10, '#78350f', 'floorplan-device-label'));
          }
        }
      });

      if (state.overlays.clearance || state.overlays.lighting) {
        const overlay = svgEl('g', { className: 'floorplan-overlay-layer' });
        state.items.forEach((item) => {
          const kind = item.kind || classifyItem(item);
          if (getItemFloor(item) !== state.currentFloor) return;
          if (state.overlays.clearance && fixtureSubtype(item) === 'door') {
            overlay.append(svgEl('circle', { cx: item.x || 0, cy: item.y || 0, r: 30, className: 'floorplan-clearance-arc' }));
          }
          if (state.overlays.lighting && /light|recessed|ceiling/i.test(`${item.label || ''} ${item.type || ''}`)) {
            overlay.append(svgEl('circle', { cx: item.x || 0, cy: item.y || 0, r: 55, className: 'floorplan-lighting-throw' }));
          }
        });
        scene.append(overlay);
      }

      const itemById = new Map(state.items.map(item => [String(item.id), item]));
      scene.querySelectorAll('[data-floorplan-item]').forEach((node) => {
        const itemId = String(node.getAttribute('data-floorplan-item') || '');
        const item = itemById.get(itemId);
        if (!item) return;
        const labelText = itemFeedbackLabel(item);
        node.setAttribute('data-floorplan-label', labelText);
        if (!node.querySelector('title')) {
          node.append(svgEl('title', {}, [labelText]));
        } else {
          node.querySelector('title').textContent = labelText;
        }
      });

      if (state.selectedId && state.selectedIds.size === 1) {
        const selected = findItemById(state.selectedId);
        if (selected) {
          const handleLayer = svgEl('g', { className: 'floorplan-handle-layer' });
          const addHandle = (x, y, handleId) => {
            handleLayer.append(svgEl('circle', {
              cx: x,
              cy: y,
              r: 8,
              fill: '#ffffff',
              stroke: '#2563eb',
              'stroke-width': 2,
              class: 'floorplan-resize-handle',
              'data-floorplan-item': String(selected.id),
              'data-floorplan-handle': handleId,
            }));
          };

          if (selected.kind === 'room') {
            const width = Math.max(60, selected.width || 120);
            const height = Math.max(40, selected.height || 80);
            const left = selected.x;
            const top = selected.y;
            const right = left + width;
            const bottom = top + height;
            handleLayer.append(svgEl('rect', {
              x: left,
              y: top,
              width,
              height,
              fill: 'none',
              stroke: '#2563eb',
              'stroke-width': 1.5,
              'stroke-dasharray': '6 5',
              class: 'floorplan-selection-box',
            }));
            addHandle(left, top, 'room-nw');
            addHandle(right, top, 'room-ne');
            addHandle(left, bottom, 'room-sw');
            addHandle(right, bottom, 'room-se');
            handleLayer.append(label(`${formatFeet(width)} × ${formatFeet(height)}`, right - 8, top - 10, '#1e40af', 'floorplan-measure-label'));
          }

          if (selected.kind === 'wall') {
            const { x1, y1, x2, y2 } = getWallEndpoints(selected);
            handleLayer.append(svgEl('line', {
              x1, y1, x2, y2,
              stroke: '#2563eb',
              'stroke-width': 1.5,
              'stroke-dasharray': '6 5',
              class: 'floorplan-selection-box',
            }));
            addHandle(x1, y1, 'wall-start');
            addHandle(x2, y2, 'wall-end');
            const length = Math.hypot(x2 - x1, y2 - y1);
            handleLayer.append(label(formatFeet(length), (x1 + x2) / 2, ((y1 + y2) / 2) - 10, '#1e40af', 'floorplan-measure-label'));
          }

          if ((selected.kind === 'electrical' || selected.kind === 'plumbing') && !isSymbolObject(selected)) {
            const x = selected.x || 40;
            const y = selected.y || 40;
            handleLayer.append(svgEl('circle', {
              cx: x,
              cy: y,
              r: 12,
              fill: 'none',
              stroke: '#2563eb',
              'stroke-width': 1.5,
              'stroke-dasharray': '4 4',
              class: 'floorplan-selection-box',
            }));
            addHandle(x, y, 'point-center');
          }

          if (isSymbolObject(selected)) {
            const sub = fixtureSubtype(selected);
            const angle = Number.isFinite(selected.angle) ? Number(selected.angle) : 0;
            const radH = (angle * Math.PI) / 180;
            const cosH = Math.cos(radH);
            const sinH = Math.sin(radH);
            const cx = selected.x || 40;
            const cy = selected.y || 40;
            const toG = (lx, ly) => ({ x: cx + (lx * cosH) - (ly * sinH), y: cy + (lx * sinH) + (ly * cosH) });
            const w = Math.max(8, selected.width || 18);
            const h = Math.max(8, selected.height || 18);
            handleLayer.append(svgEl('rect', {
              x: -w / 2,
              y: -h / 2,
              width: w,
              height: h,
              fill: 'none',
              stroke: '#2563eb',
              'stroke-width': 1.5,
              'stroke-dasharray': '6 5',
              class: 'floorplan-selection-box',
              transform: `translate(${cx} ${cy}) rotate(${angle})`,
            }));
            if (sub === 'door' || sub === 'window') {
              const lpt = toG(-w / 2, 0);
              const rpt = toG(w / 2, 0);
              addHandle(lpt.x, lpt.y, 'width-min');
              addHandle(rpt.x, rpt.y, 'width-max');
              handleLayer.append(label(formatFeet(w), cx, cy - 14, '#1e40af', 'floorplan-measure-label'));
            } else {
              const nw = toG(-w / 2, -h / 2);
              const ne = toG(w / 2, -h / 2);
              const sw = toG(-w / 2, h / 2);
              const se = toG(w / 2, h / 2);
              addHandle(nw.x, nw.y, 'fx-nw');
              addHandle(ne.x, ne.y, 'fx-ne');
              addHandle(sw.x, sw.y, 'fx-sw');
              addHandle(se.x, se.y, 'fx-se');
              handleLayer.append(label(`${formatFeet(w)} × ${formatFeet(h)}`, cx, cy - (h / 2) - 10, '#1e40af', 'floorplan-measure-label'));
            }
          }

          if (selected.kind === 'circle') {
            const cx = selected.x || 60;
            const cy = selected.y || 60;
            const r = Math.max(2, selected.radius || 20);
            handleLayer.append(svgEl('circle', {
              cx, cy, r,
              fill: 'none', stroke: '#2563eb', 'stroke-width': 1.2, 'stroke-dasharray': '4 4',
              class: 'floorplan-selection-box',
            }));
            addHandle(cx, cy - r, 'circ-n');
            addHandle(cx + r, cy, 'circ-e');
            addHandle(cx, cy + r, 'circ-s');
            addHandle(cx - r, cy, 'circ-w');
          }

          if (selected.kind === 'line' && Array.isArray(selected.points) && selected.points.length >= 2) {
            const pts = selected.points;
            // Midpoint handles (insert a vertex) — drawn first so vertex handles sit on top.
            const segCount = selected.closed ? pts.length : pts.length - 1;
            for (let i = 0; i < segCount; i += 1) {
              const a = pts[i];
              const b = pts[(i + 1) % pts.length];
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              handleLayer.append(svgEl('rect', {
                x: mx - 4, y: my - 4, width: 8, height: 8, rx: 2,
                fill: '#dbeafe', stroke: '#2563eb', 'stroke-width': 1.5,
                class: 'floorplan-vertex-mid',
                'data-floorplan-item': String(selected.id),
                'data-floorplan-handle': `mid-${i}`,
              }));
            }
            // Vertex handles (drag to move, double/right-click to delete).
            pts.forEach((p, i) => {
              handleLayer.append(svgEl('circle', {
                cx: p.x, cy: p.y, r: 6,
                fill: '#ffffff', stroke: '#0f766e', 'stroke-width': 2,
                class: 'floorplan-resize-handle floorplan-vertex-handle',
                'data-floorplan-item': String(selected.id),
                'data-floorplan-handle': `vtx-${i}`,
              }));
            });
          }

          scene.append(handleLayer);
        }
      }

      if (state.preview) {
        const previewLayer = svgEl('g', { className: 'floorplan-preview-layer' });
        const preview = state.preview;
        if (preview.kind === 'room') {
          const dims = createFence({}, preview.start, preview.end);
          previewLayer.append(svgEl('rect', {
            x: dims.x,
            y: dims.y,
            width: dims.width,
            height: dims.height,
            rx: 10,
            fill: 'rgba(96,165,250,0.18)',
            stroke: '#60a5fa',
            'stroke-width': '2',
            'stroke-dasharray': '8 6',
          }));
        }
        if (preview.kind === 'wall') {
          previewLayer.append(svgEl('line', {
            x1: preview.start.x,
            y1: preview.start.y,
            x2: preview.end.x,
            y2: preview.end.y,
            stroke: '#334155',
            'stroke-width': '5',
            'stroke-linecap': 'round',
            'stroke-dasharray': '10 6',
            opacity: '0.8',
          }));
        }
        if (preview.kind === 'wall-rect') {
          const dims = createFence({}, preview.start, preview.end);
          previewLayer.append(svgEl('rect', {
            x: dims.x,
            y: dims.y,
            width: dims.width,
            height: dims.height,
            rx: 6,
            fill: 'rgba(51,65,85,0.08)',
            stroke: '#334155',
            'stroke-width': '2',
            'stroke-dasharray': state.rectDisconnected ? '4 10' : '8 6',
          }));
        }
        if (preview.kind === 'measure') {
          previewLayer.append(buildDimension(preview.start, preview.end, { dash: '6 4', sw: 1.8 }));
        }
        if (preview.kind === 'circle') {
          const r = Math.hypot(preview.end.x - preview.start.x, preview.end.y - preview.start.y);
          previewLayer.append(svgEl('circle', {
            cx: preview.start.x, cy: preview.start.y, r: Math.max(1, r),
            fill: 'none',
            stroke: state.lineStyle.strokeColor || '#0f766e',
            'stroke-width': String(state.lineStyle.strokeWidth || 3),
            'stroke-dasharray': '8 5',
            opacity: 0.85,
          }));
          previewLayer.append(svgEl('line', { x1: preview.start.x, y1: preview.start.y, x2: preview.end.x, y2: preview.end.y, stroke: '#64748b', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
          const text = `r ${formatFeet(r)}`;
          previewLayer.append(svgEl('text', { x: preview.start.x, y: preview.start.y - Math.max(1, r) - 6, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#0f766e' }, [text]));
        }
        if (preview.kind === 'electrical') {
          previewLayer.append(svgEl('circle', {
            cx: preview.end.x,
            cy: preview.end.y,
            r: 8,
            fill: 'rgba(74,222,128,0.35)',
            stroke: '#166534',
            'stroke-width': '2',
            'stroke-dasharray': '6 4',
          }));
        }
        if (preview.kind === 'plumbing') {
          previewLayer.append(svgEl('rect', {
            x: preview.end.x - 9,
            y: preview.end.y - 9,
            width: 18,
            height: 18,
            rx: 4,
            fill: 'rgba(147,197,253,0.4)',
            stroke: '#1d4ed8',
            'stroke-width': '2',
            'stroke-dasharray': '6 4',
          }));
        }
        if (preview.kind === 'symbol') {
          const preset = state.symbolPreset || HOUSEHOLD_SYMBOLS[0];
          previewLayer.append(svgEl('circle', {
            cx: preview.end.x,
            cy: preview.end.y,
            r: 10,
            fill: 'rgba(100,116,139,0.2)',
            stroke: '#64748b',
            'stroke-width': '1.5',
            'stroke-dasharray': '6 4',
          }));
          previewLayer.append(svgEl('text', {
            x: preview.end.x,
            y: preview.end.y + 4,
            className: 'floorplan-symbol-glyph',
            'text-anchor': 'middle',
            'font-size': '12',
          }, [preset.icon]));
        }
        scene.append(previewLayer);
      }

      if (state.marquee) {
        scene.append(svgEl('rect', {
          x: state.marquee.x,
          y: state.marquee.y,
          width: state.marquee.width,
          height: state.marquee.height,
          fill: 'rgba(37,99,235,0.08)',
          stroke: '#2563eb',
          'stroke-width': '1.5',
          'stroke-dasharray': '6 5',
          className: 'floorplan-marquee',
        }));
      }

      if (state.lineDraft && state.lineDraft.points.length > 0) {
        const previewLayer = svgEl('g', { className: 'floorplan-preview-layer' });
        const pts = state.lineDraft.points.slice();
        if (state.lineCursor) pts.push(state.lineCursor);
        if (pts.length >= 2) {
          previewLayer.append(svgEl('polyline', {
            points: pts.map(p => `${p.x},${p.y}`).join(' '),
            fill: 'none',
            stroke: '#0f766e',
            'stroke-width': '2.5',
            'stroke-dasharray': '8 5',
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          }));
        }
        state.lineDraft.points.forEach((p) => {
          previewLayer.append(svgEl('circle', { cx: p.x, cy: p.y, r: 3.5, fill: '#0f766e', stroke: '#ffffff', 'stroke-width': 1.2 }));
        });
        scene.append(previewLayer);
      }

      renderInteriorView();
      updatePropToolbar();
      updateInspector();
    }

    function beginDraft(event) {
      if (state.gestureActive) return;
      if (event.touches && event.touches.length >= 2) return;
      const isMouseInput = event.pointerType === 'mouse' || event.type === 'mousedown';
      if (isMouseInput && event.button !== 0) return;
      if (state.spaceDown && isMouseInput) {
        event.preventDefault();
        state.panning = { clientX: event.clientX, clientY: event.clientY, viewX: state.view.x, viewY: state.view.y };
        svg.setPointerCapture?.(event.pointerId);
        return;
      }
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const point = snapPointForTool(pointFromEvent(svg, event), state.tool);
      const now = Date.now();
      if (state.lastStartPoint && (now - state.lastStartAt) < 60) {
        const dx = Math.abs(state.lastStartPoint.x - point.x);
        const dy = Math.abs(state.lastStartPoint.y - point.y);
        if (dx < 1 && dy < 1) return;
      }
      state.lastStartAt = now;
      state.lastStartPoint = point;
      debugLog('input-start', {
        eventType: event.type,
        pointerType: event.pointerType || 'unknown',
        pointerId: event.pointerId,
        tool: state.tool,
        x: point.x,
        y: point.y,
      });
      const targetItem = event.target && event.target.closest ? event.target.closest('[data-floorplan-item]') : null;
      const targetItemData = targetItem ? findItemById(targetItem.dataset.floorplanItem) : null;

      if (state.tool === 'line') {
        const snapped = snapPointForTool(point, 'wall');
        if (!state.lineDraft) state.lineDraft = { points: [] };
        const pts = state.lineDraft.points;
        if (pts.length >= 3) {
          const first = pts[0];
          if (Math.hypot(snapped.x - first.x, snapped.y - first.y) <= 10) {
            finalizeLine(true);
            return;
          }
        }
        const last = pts[pts.length - 1];
        if (last && Math.hypot(snapped.x - last.x, snapped.y - last.y) < 2) return;
        pts.push(snapped);
        state.lineCursor = snapped;
        setFeedback(`Line: ${pts.length} point${pts.length === 1 ? '' : 's'} — click start or press Enter to finish`);
        renderScene();
        return;
      }

      if (state.tool === 'erase') {
        if (targetItem && targetItemData && isItemHitTestable(targetItemData)) {
          pushUndoCheckpoint();
          const itemId = targetItem.dataset.floorplanItem;
          state.items = state.items.filter(item => String(item.id) !== itemId);
          state.selectedIds.delete(String(itemId));
          if (state.selectedId === String(itemId)) {
            state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
          }
          debugLog('erase-item', { itemId, remaining: state.items.length });
          renderScene();
          queuePersistDraft();
        }
        return;
      }

      if (state.tool === 'trim') {
        trimAtPoint(point);
        return;
      }

      if (state.panning) {
        const startWorld = screenToWorld(state.panning.clientX, state.panning.clientY);
        const nowWorld = screenToWorld(event.clientX, event.clientY);
        state.view.x = state.panning.viewX + (startWorld.x - nowWorld.x);
        state.view.y = state.panning.viewY + (startWorld.y - nowWorld.y);
        applyView();
        return;
      }
      if (state.tool === 'select') {
        const handleTarget = event.target && event.target.closest ? event.target.closest('[data-floorplan-handle]') : null;
        if (handleTarget) {
          const itemId = handleTarget.dataset.floorplanItem;
          let handle = handleTarget.dataset.floorplanHandle;
          const item = findItemById(itemId);
          if (item) {
            if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
            setSingleSelection(itemId);
            pushUndoCheckpoint();
            // Dragging a midpoint handle inserts a new vertex there, then drags it (row 25).
            if (handle && handle.startsWith('mid-') && Array.isArray(item.points)) {
              const segIndex = parseInt(handle.slice(4), 10);
              const a = item.points[segIndex];
              const b = item.points[(segIndex + 1) % item.points.length];
              if (a && b) {
                item.points.splice(segIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                handle = `vtx-${segIndex + 1}`;
              }
            }
            state.resizeDrag = {
              itemId,
              handle,
              origin: {
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                x2: item.x2,
                y2: item.y2,
                radius: item.radius,
                angle: Number.isFinite(item.angle) ? Number(item.angle) : 0,
              },
            };
            state.dragStart = { x: point.x, y: point.y };
            debugLog('resize-start', { itemId, handle, kind: item.kind });
            renderScene();
          }
          return;
        }

        if (targetItem && targetItemData && isItemHitTestable(targetItemData)) {
          if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
          const itemId = String(targetItem.dataset.floorplanItem);
          // Clicking any grouped member acts on the whole group (row 21).
          const groupIds = targetItemData.groupId
            ? groupMembers(targetItemData).map(m => String(m.id))
            : [itemId];
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            const alreadyIn = groupIds.every(id => state.selectedIds.has(id));
            groupIds.forEach((id) => { if (alreadyIn) state.selectedIds.delete(id); else state.selectedIds.add(id); });
            state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
            renderScene();
            setFeedback(`Selected ${state.selectedIds.size} item${state.selectedIds.size === 1 ? '' : 's'}`);
            return;
          }
          const alreadySelected = groupIds.every(id => state.selectedIds.has(id)) && state.selectedIds.size === groupIds.length;
          if (!alreadySelected) {
            state.selectedIds = new Set(groupIds);
            state.selectedId = groupIds.length === 1 ? groupIds[0] : null;
          }
          // Locked objects stay selectable (to unlock) but cannot be dragged.
          if (isMutationLocked(targetItemData)) {
            renderScene();
            setFeedback('Locked — unlock to move');
            return;
          }
          pushUndoCheckpoint();
          state.dragIds = [...state.selectedIds];
          state.dragStart = { x: point.x, y: point.y };
          state.dragOrigins = {};
          state.dragIds.forEach((id) => {
            const item = findItemById(id);
            if (!item) return;
            const wall = getWallEndpoints(item);
            state.dragOrigins[id] = {
              x: item.x,
              y: item.y,
              x2: wall.x2,
              y2: wall.y2,
              points: Array.isArray(item.points) ? item.points.map(p => ({ x: p.x, y: p.y })) : null,
            };
          });
          debugLog('select-start', { selected: state.dragIds.length, x: point.x, y: point.y });
          renderScene();
          setFeedback(`Selected ${state.selectedIds.size} item${state.selectedIds.size === 1 ? '' : 's'}`);
        } else {
          state.dragStart = { x: point.x, y: point.y };
          state.marquee = { x: point.x, y: point.y, width: 0, height: 0 };
          if (!(event.shiftKey || event.ctrlKey || event.metaKey)) {
            state.selectedIds.clear();
            state.selectedId = null;
          }
          renderScene();
          setFeedback('Selection box started');
        }
        return;
      }

      if (state.tool === 'electrical' || state.tool === 'plumbing' || state.tool === 'door' || state.tool === 'window' || state.tool === 'symbol' || state.tool === 'stairs') {
        pushUndoCheckpoint();
        const created = registerNewItem(createPointToolItem(state.tool, point));
        if (!created) return;
        state.items.push(created);
        state.lastCreateAt = Date.now();
        debugLog('create-point', { kind: created.kind, id: created.id, x: created.x, y: created.y, count: state.items.length });
        renderScene();
        queuePersistDraft();
        return;
      }

      if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
      state.dragStart = point;
      state.preview = { kind: state.tool, start: point, end: point };
      renderScene();
    }

    function updateDraft(event) {
      if (state.gestureActive) return;
      if (event.touches && event.touches.length >= 2) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (state.tool === 'line') {
        if (!state.lineDraft) return;
        state.lineCursor = snapPointForTool(pointFromEvent(svg, event), 'wall');
        renderScene();
        return;
      }
      if (state.tool === 'select') {
        const point = pointFromEvent(svg, event);
        if (state.resizeDrag) {
          const item = findItemById(state.resizeDrag.itemId);
          if (!item) return;
          const { handle, origin } = state.resizeDrag;
          const snapped = item.kind === 'wall'
            ? snapPointForTool(point, 'wall', { skipWallId: item.id })
            : snapPointForTool(point, 'room');
          const px = clampWorldCoord(snapped.x);
          const py = clampWorldCoord(snapped.y);

          if (item.kind === 'room') {
            const left0 = origin.x;
            const top0 = origin.y;
            const right0 = left0 + Math.max(60, origin.width || 120);
            const bottom0 = top0 + Math.max(40, origin.height || 80);
            let left = left0;
            let top = top0;
            let right = right0;
            let bottom = bottom0;

            if (handle === 'room-nw' || handle === 'room-sw') left = Math.min(px, right0 - 40);
            if (handle === 'room-ne' || handle === 'room-se') right = Math.max(px, left0 + 40);
            if (handle === 'room-nw' || handle === 'room-ne') top = Math.min(py, bottom0 - 34);
            if (handle === 'room-sw' || handle === 'room-se') bottom = Math.max(py, top0 + 34);

            left = clamp(left, WORLD_COORD_MIN, WORLD_COORD_MAX - 40);
            top = clamp(top, WORLD_COORD_MIN, WORLD_COORD_MAX - 34);
            right = clamp(right, left + 40, WORLD_COORD_MAX);
            bottom = clamp(bottom, top + 34, WORLD_COORD_MAX);

            item.x = left;
            item.y = top;
            item.width = right - left;
            item.height = bottom - top;
          }

          if (item.kind === 'wall') {
            const originEnds = { x1: origin.x, y1: origin.y, x2: origin.x2, y2: origin.y2 };
            if (handle === 'wall-start') {
              item.x = px;
              item.y = py;
            } else if (handle === 'wall-end') {
              item.x2 = px;
              item.y2 = py;
            }
            const { x2, y2 } = getWallEndpoints(item);
            item.length = Math.hypot(x2 - item.x, y2 - item.y);
            item.width = Math.abs(x2 - item.x);
            item.height = Math.abs(y2 - item.y);
            recomputeWallOpenings(item, originEnds);
          }

          if ((item.kind === 'electrical' || item.kind === 'plumbing') && handle === 'point-center') {
            item.x = px;
            item.y = py;
          }

          if (item.kind === 'circle' && handle && handle.startsWith('circ-')) {
            item.radius = clamp(Math.hypot(px - item.x, py - item.y), 2, 2000);
          }

          if (item.kind === 'line' && handle && handle.startsWith('vtx-') && Array.isArray(item.points)) {
            const idx = parseInt(handle.slice(4), 10);
            if (item.points[idx]) {
              const snapV = snapPointForTool({ x: px, y: py }, 'wall', { skipWallId: item.id });
              item.points[idx] = { x: clampWorldCoord(snapV.x), y: clampWorldCoord(snapV.y) };
              item.x = item.points[0].x;
              item.y = item.points[0].y;
            }
          }

          if (isSymbolObject(item) && handle !== 'point-center') {
            const angle = Number.isFinite(origin.angle) ? Number(origin.angle) : 0;
            const rad = (angle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const cx0 = origin.x;
            const cy0 = origin.y;
            // pointer in the fixture's local (un-rotated) frame
            const dxp = px - cx0;
            const dyp = py - cy0;
            const localX = (dxp * cos) + (dyp * sin);
            const localY = (-dxp * sin) + (dyp * cos);

            if (handle === 'width-min' || handle === 'width-max') {
              // doors/windows resize symmetric width about the wall point
              const newWidth = clamp(Math.abs(localX) * 2, 10, 240);
              item.width = newWidth;
            } else if (handle.startsWith('fx-')) {
              const w0 = Math.max(8, origin.width || 18);
              const h0 = Math.max(8, origin.height || 18);
              const signX = handle.includes('e') ? 1 : -1;
              const signY = handle.includes('s') ? 1 : -1;
              // opposite corner stays fixed in local space
              const fixedX = -signX * (w0 / 2);
              const fixedY = -signY * (h0 / 2);
              // the dragged corner follows the pointer directly, so dragging
              // across the fixed corner flips the box naturally (no inversion)
              const dirX = localX >= fixedX ? 1 : -1;
              const dirY = localY >= fixedY ? 1 : -1;
              let newW = clamp(Math.abs(localX - fixedX), 8, 400);
              let newH = clamp(Math.abs(localY - fixedY), 8, 400);
              const lockAspect = event.shiftKey ? item.aspectLocked === false : item.aspectLocked !== false;
              if (lockAspect) {
                const ratio = w0 / Math.max(1, h0);
                if (newW / Math.max(1, newH) > ratio) newW = newH * ratio;
                else newH = newW / ratio;
              }
              const draggedLocalX = fixedX + (dirX * newW);
              const draggedLocalY = fixedY + (dirY * newH);
              const centerLocalX = (fixedX + draggedLocalX) / 2;
              const centerLocalY = (fixedY + draggedLocalY) / 2;
              item.width = newW;
              item.height = newH;
              item.x = cx0 + (centerLocalX * cos) - (centerLocalY * sin);
              item.y = cy0 + (centerLocalX * sin) + (centerLocalY * cos);
            }
          }

          debugLog('resize-move', { itemId: item.id, handle, x: item.x, y: item.y });
          renderScene();
          return;
        }

        if (state.dragIds.length > 0 && state.dragStart && state.dragOrigins) {
          const dx = point.x - state.dragStart.x;
          const dy = point.y - state.dragStart.y;
          state.dragIds.forEach((itemId) => {
            const item = findItemById(itemId);
            const origin = state.dragOrigins[itemId];
            if (!item || !origin) return;
            item.x = origin.x + dx;
            item.y = origin.y + dy;
            if (typeof item.x2 === 'number') item.x2 = origin.x2 + dx;
            if (typeof item.y2 === 'number') item.y2 = origin.y2 + dy;
            if (origin.points && Array.isArray(item.points)) {
              item.points = origin.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
            }
          });
          debugLog('select-move', { selected: state.dragIds.length, dx, dy });
          renderScene();
          return;
        }

        if (state.marquee && state.dragStart) {
          const box = createFence({}, state.dragStart, point);
          state.marquee = box;
          renderScene();
          return;
        }
        return;
      }

      if (!state.dragStart || state.tool === 'erase') return;
      if (!state.preview) return;
      const point = snapPointForTool(pointFromEvent(svg, event), state.tool);
      state.preview.end = point;
      renderScene();
    }

    function endDraft(event) {
      if (state.gestureActive) return;
      if (event && event.pointerId !== undefined) {
        svg.releasePointerCapture?.(event.pointerId);
      }
      if (state.panning) {
        state.panning = null;
        return;
      }

      if (state.tool === 'select') {
        if (state.marquee && (state.marquee.width > 3 || state.marquee.height > 3)) {
          const box = state.marquee;
          const within = (x, y) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
          state.items.forEach((item) => {
            if (getItemFloor(item) !== state.currentFloor) return;
            if (!isItemLayerVisible(item)) return;
            if (isItemLocked(item)) return;
            const kind = item.kind || classifyItem(item);
            if (kind === 'wall') {
              const edge = getWallEndpoints(item);
              const centerX = (edge.x1 + edge.x2) / 2;
              const centerY = (edge.y1 + edge.y2) / 2;
              if (within(centerX, centerY)) state.selectedIds.add(String(item.id));
            } else {
              if (within(item.x || 0, item.y || 0)) state.selectedIds.add(String(item.id));
            }
          });
          state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
        }
        state.dragIds = [];
        state.dragOrigins = null;
        state.marquee = null;
        state.resizeDrag = null;
        state.dragStart = null;
        debugLog('select-end');
        renderScene();
        queuePersistDraft();
        return;
      }

      if (state.tool !== 'erase' && state.preview) {
        const { kind, start, end } = state.preview;
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        debugLog('input-end', { eventType: event?.type, kind, distance, start, end });
        if (kind === 'wall-rect') {
          pushUndoCheckpoint();
          const added = createRectangleWalls(start, end);
          if (added > 0) {
            state.lastCreateAt = Date.now();
            debugLog('create-rect-wall', { added, count: state.items.length });
          }
        } else if (kind === 'measure') {
          if (distance > 6) {
            pushUndoCheckpoint();
            const measure = registerNewItem({
              id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              kind: 'measure',
              type: 'Measure',
              label: '',
              layer: 'measure',
              points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
              x: start.x,
              y: start.y,
            });
            state.items.push(measure);
            state.lastCreateAt = Date.now();
            setFeedback(`Measured ${formatFeet(distance)}`);
          }
        } else if (kind === 'circle') {
          if (distance > 4) {
            pushUndoCheckpoint();
            const circle = registerNewItem({
              id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              kind: 'circle',
              type: 'Circle',
              label: '',
              layer: 'line',
              x: start.x,
              y: start.y,
              radius: clamp(distance, 2, 2000),
              lineType: state.lineStyle.lineType,
              strokeWidth: state.lineStyle.strokeWidth,
              strokeColor: state.lineStyle.strokeColor,
            });
            state.items.push(circle);
            state.lastCreateAt = Date.now();
            setFeedback(`Circle r ${formatFeet(circle.radius)}`);
          }
        } else if (distance > 18) {
          pushUndoCheckpoint();
          const created = registerNewItem(createItem(kind, start, end));
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-drag', { kind: created.kind, id: created.id, count: state.items.length });
        } else if (kind === 'wall') {
          pushUndoCheckpoint();
          const wallEndRaw = {
            x: clampWorldCoord(start.x + 80),
            y: clampWorldCoord(start.y),
          };
          const wallEnd = snapPointForTool(wallEndRaw, 'wall');
          const created = registerNewItem(createItem(kind, start, wallEnd));
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-click-wall', { id: created.id, from: start, to: wallEnd, count: state.items.length });
        } else if (kind === 'room') {
          pushUndoCheckpoint();
          const roomStart = {
            x: clampWorldCoord(start.x - 60),
            y: clampWorldCoord(start.y - 40),
          };
          const roomEnd = {
            x: roomStart.x + 120,
            y: roomStart.y + 80,
          };
          const created = registerNewItem(createItem(kind, roomStart, roomEnd));
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-click-room', { id: created.id, from: roomStart, to: roomEnd, count: state.items.length });
        }
      }
      state.preview = null;
      state.dragStart = null;
      renderScene();
      queuePersistDraft();
    }

    function fallbackClickCreate(event) {
      if (state.tool === 'select' || state.tool === 'erase' || state.tool === 'line' || state.tool === 'measure' || state.tool === 'trim' || state.tool === 'circle') return;
      if (state.preview || state.dragStart || state.dragIds.length > 0) return;
      if ((Date.now() - state.lastCreateAt) < 150) return;

      const point = snapPointForTool(pointFromEvent(svg, event), state.tool);
      let created = null;
      if (state.tool === 'wall') {
        const wallEnd = snapPointForTool({ x: clampWorldCoord(point.x + 80), y: clampWorldCoord(point.y) }, 'wall');
        created = createItem('wall', point, wallEnd);
      } else if (state.tool === 'wall-rect') {
        return;
      } else if (state.tool === 'room') {
        const roomStart = {
          x: clampWorldCoord(point.x - 60),
          y: clampWorldCoord(point.y - 40),
        };
        const roomEnd = { x: roomStart.x + 120, y: roomStart.y + 80 };
        created = createItem('room', roomStart, roomEnd);
      } else if (state.tool === 'electrical' || state.tool === 'plumbing' || state.tool === 'door' || state.tool === 'window' || state.tool === 'symbol' || state.tool === 'stairs') {
        created = createPointToolItem(state.tool, point);
      }

      created = registerNewItem(created);
      if (!created) return;
      pushUndoCheckpoint();
      state.items.push(created);
      state.lastCreateAt = Date.now();
      debugLog('fallback-click-create', { tool: state.tool, id: created.id, x: point.x, y: point.y, count: state.items.length });
      renderScene();
      queuePersistDraft();
    }

    if (typeof window !== 'undefined') {
      window.__WAYMARK_FLOORPLAN_UNDO_API__ = { undoLatest, redoLatest };
      window.__WAYMARK_FLOORPLAN_KEY_API__ = {
        rotateSelection,
        flipSelection,
        duplicateSelection,
        deleteSelection,
        toggleDoorSwing,
        finalizeLine,
        cancelLineDraft,
        nudgeSelection,
        groupSelection,
        ungroupSelection,
        toggleSelectionLock,
        zoomIn: () => zoomByStep(1.2),
        zoomOut: () => zoomByStep(1 / 1.2),
        zoomReset: () => resetView(),
        zoomFit: () => zoomToFit(),
        copySelection,
        pasteSelection,
        reorderSelection,
        tempSelectStart: () => { if (!state.tempTool) { state.previousTool = state.tool; state.tempTool = 'select'; setTool('select'); } },
        tempSelectEnd: () => { if (state.tempTool) { const prev = state.previousTool || 'wall'; state.tempTool = null; state.previousTool = null; setTool(prev); } },
        deselect: () => clearSelection(),
        hasLineDraft: () => Boolean(state.lineDraft),
        hasSelection: () => state.selectedIds.size > 0,
      };
      if (!window.__WAYMARK_FLOORPLAN_UNDO_BOUND__) {
        window.addEventListener('keydown', (event) => {
          const target = event.target;
          const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
          const key = String(event.key || '').toLowerCase();
          const activeBoard = document.querySelector('.floorplan-board');
          if (!activeBoard) return;
          if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) {
            if (key === ' ' && state.spaceDown) {
              state.spaceDown = false;
              activeBoard.classList.remove('floorplan-space-panning');
            }
            return;
          }
          if (key === ' ') { state.spaceDown = true; activeBoard.classList.add('floorplan-space-panning'); event.preventDefault(); return; }

          const undoApi = window.__WAYMARK_FLOORPLAN_UNDO_API__;
          const keyApi = window.__WAYMARK_FLOORPLAN_KEY_API__;

          if ((event.ctrlKey || event.metaKey) && key === 'z') {
            if (!undoApi) return;
            event.preventDefault();
            if (event.shiftKey) undoApi.redoLatest();
            else undoApi.undoLatest();
            return;
          }
          if (!keyApi) return;
          if (key === 'alt') {
            event.preventDefault();
            keyApi.tempSelectStart();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === 'c') {
            event.preventDefault();
            keyApi.copySelection();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === 'v') {
            event.preventDefault();
            keyApi.pasteSelection();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === ']') {
            event.preventDefault();
            keyApi.reorderSelection(event.shiftKey ? 'front' : 'forward');
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === '[') {
            event.preventDefault();
            keyApi.reorderSelection(event.shiftKey ? 'back' : 'backward');
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === 'd') {
            event.preventDefault();
            keyApi.duplicateSelection();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === 'g') {
            event.preventDefault();
            if (event.shiftKey) keyApi.ungroupSelection();
            else keyApi.groupSelection();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && (key === '=' || key === '+')) {
            event.preventDefault();
            keyApi.zoomIn();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && (key === '-' || key === '_')) {
            event.preventDefault();
            keyApi.zoomOut();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key === '0') {
            event.preventDefault();
            keyApi.zoomReset();
            return;
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const arrowStep = event.shiftKey ? UNITS_PER_FOOT : UNITS_PER_FOOT / 4;
          if (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright') {
            if (!keyApi.hasSelection()) return;
            event.preventDefault();
            const dx = key === 'arrowleft' ? -arrowStep : key === 'arrowright' ? arrowStep : 0;
            const dy = key === 'arrowup' ? -arrowStep : key === 'arrowdown' ? arrowStep : 0;
            keyApi.nudgeSelection(dx, dy);
            return;
          }
          if (key === 'r') {
            event.preventDefault();
            keyApi.rotateSelection(event.shiftKey ? -15 : 15);
          } else if (key === 'f') {
            event.preventDefault();
            keyApi.flipSelection(event.shiftKey ? 'v' : 'h');
          } else if (key === 'delete' || key === 'backspace') {
            if (keyApi.hasSelection()) {
              event.preventDefault();
              keyApi.deleteSelection();
            }
          } else if (key === 'enter') {
            if (keyApi.hasLineDraft()) {
              event.preventDefault();
              keyApi.finalizeLine(false);
            }
          } else if (key === 'escape') {
            if (keyApi.hasLineDraft()) {
              event.preventDefault();
              keyApi.cancelLineDraft();
            } else if (keyApi.hasSelection()) {
              event.preventDefault();
              keyApi.deselect();
            }
          }
        });
        window.addEventListener('keyup', (event) => {
          const key = String(event.key || '').toLowerCase();
          if (key === ' ') { state.spaceDown = false; board.classList.remove('floorplan-space-panning'); }
          if (key !== 'alt') return;
          const keyApi = window.__WAYMARK_FLOORPLAN_KEY_API__;
          keyApi?.tempSelectEnd();
        });
        window.__WAYMARK_FLOORPLAN_UNDO_BOUND__ = true;
      }
    }

    const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    debugLog('input-mode', { supportsPointer });

    /* ---------- Wheel zoom (desktop) ---------- */
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = Math.max(-180, Math.min(180, event.deltaY || 0));
      const factor = Math.exp(-delta * 0.0016);
      zoomAtScreen(state.view.zoom * factor, event.clientX, event.clientY);
    }, { passive: false });

    /* ---------- Pinch-zoom & two-finger pan (touch) ----------
       Tracked in the capture phase so a second finger converts an in-progress
       single-finger draw into a pinch gesture before beginDraft can act. */
    const activePointers = new Map();
    let pinch = null;
    function abortInteractionForGesture() {
      state.preview = null;
      state.dragStart = null;
      state.dragIds = [];
      state.dragOrigins = null;
      state.marquee = null;
      state.resizeDrag = null;
      state.vertexDrag = null;
      renderScene();
    }
    if (supportsPointer) {
      svg.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activePointers.size === 2) {
          state.gestureActive = true;
          abortInteractionForGesture();
          const pts = [...activePointers.values()];
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          pinch = { lastDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, lastMid: mid };
        }
      }, true);
      svg.addEventListener('pointermove', (event) => {
        if (!activePointers.has(event.pointerId)) return;
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!pinch || activePointers.size < 2) return;
        event.preventDefault();
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const factor = dist / pinch.lastDist;
        if (Math.abs(factor - 1) > 0.002) zoomAtScreen(state.view.zoom * factor, mid.x, mid.y);
        const worldPrev = screenToWorld(pinch.lastMid.x, pinch.lastMid.y);
        const worldNow = screenToWorld(mid.x, mid.y);
        state.view.x += worldPrev.x - worldNow.x;
        state.view.y += worldPrev.y - worldNow.y;
        applyView();
        pinch.lastDist = dist;
        pinch.lastMid = mid;
      }, true);
      const endPointer = (event) => {
        if (!activePointers.has(event.pointerId)) return;
        activePointers.delete(event.pointerId);
        if (activePointers.size < 2) pinch = null;
        if (activePointers.size === 0) {
          setTimeout(() => { state.gestureActive = false; }, 0);
        }
      };
      svg.addEventListener('pointerup', endPointer, true);
      svg.addEventListener('pointercancel', endPointer, true);
    }

    if (supportsPointer) {
      svg.addEventListener('pointerdown', beginDraft);
      svg.addEventListener('pointermove', updateDraft);
      svg.addEventListener('pointerup', endDraft);
      svg.addEventListener('pointercancel', endDraft);
      svg.addEventListener('touchstart', beginDraft, { passive: false });
      svg.addEventListener('touchmove', updateDraft, { passive: false });
      window.addEventListener('touchend', endDraft, { passive: false });
      window.addEventListener('touchcancel', endDraft, { passive: false });
    } else {
      svg.addEventListener('mousedown', beginDraft);
      svg.addEventListener('mousemove', updateDraft);
      window.addEventListener('mouseup', endDraft);

      svg.addEventListener('touchstart', beginDraft, { passive: false });
      svg.addEventListener('touchmove', updateDraft, { passive: false });
      window.addEventListener('touchend', endDraft, { passive: false });
      window.addEventListener('touchcancel', endDraft, { passive: false });
    }
    svg.addEventListener('click', fallbackClickCreate);

    /* Double-click: finish an open line (row 23), delete a vertex (row 25),
       or jump to a wall's Length field (row 28). */
    svg.addEventListener('dblclick', (event) => {
      if (state.tool === 'line' && state.lineDraft && state.lineDraft.points.length >= 2) {
        event.preventDefault();
        finalizeLine(false);
        return;
      }
      const handleEl = event.target && event.target.closest ? event.target.closest('[data-floorplan-handle]') : null;
      if (handleEl) {
        const handle = handleEl.dataset.floorplanHandle;
        const item = findItemById(handleEl.dataset.floorplanItem);
        if (item && handle && handle.startsWith('vtx-')) {
          event.preventDefault();
          deleteVertex(item, parseInt(handle.slice(4), 10));
          return;
        }
      }
      const itemEl = event.target && event.target.closest ? event.target.closest('[data-floorplan-item]') : null;
      if (itemEl) {
        const item = findItemById(itemEl.dataset.floorplanItem);
        if (item && (item.kind || classifyItem(item)) === 'wall' && !isMutationLocked(item)) {
          event.preventDefault();
          setTool('select');
          setSingleSelection(String(item.id));
          renderScene();
          focusInspectorField('length');
        }
      }
    });

    /* Right-click a vertex handle to delete it (row 25). */
    svg.addEventListener('contextmenu', (event) => {
      const handleEl = event.target && event.target.closest ? event.target.closest('[data-floorplan-handle]') : null;
      if (handleEl) {
        const handle = handleEl.dataset.floorplanHandle;
        const item = findItemById(handleEl.dataset.floorplanItem);
        if (item && handle && handle.startsWith('vtx-')) {
          event.preventDefault();
          deleteVertex(item, parseInt(handle.slice(4), 10));
          return;
        }
      }
      const itemEl = event.target && event.target.closest ? event.target.closest('[data-floorplan-item]') : null;
      if (itemEl) {
        event.preventDefault();
        showContextMenu(event.clientX, event.clientY, String(itemEl.dataset.floorplanItem));
      }
    });

    svg.style.cursor = 'crosshair';
    if (Array.isArray(draftCustomLayers)) {
      state.customLayers = draftCustomLayers.filter(l => l && l.name).map(l => ({
        name: String(l.name), visible: l.visible !== false, locked: Boolean(l.locked),
      }));
    }
    const export3dJpegButton = board.querySelector('.floorplan-export-3d-jpeg');
    const export3dPdfButton = board.querySelector('.floorplan-export-3d-pdf');
    if (export3dJpegButton) {
      export3dJpegButton.onclick = export3dJpeg;
      export3dJpegButton.onpointerdown = export3dJpeg;
    }
    if (export3dPdfButton) {
      export3dPdfButton.onclick = export3dPdf;
      export3dPdfButton.onpointerdown = export3dPdf;
    }
    reconcileCustomLayers();
    renderCustomLayerList();
    applyControlLabels();
    refreshFloorUi();
    updateUndoUi();
    setTool('wall');
    if (cloudSaveBlocked) setFeedback('Sheet access needed');
    else setFeedback('Ready');
    applyView();
    renderScene();

    const scaleBar = svgEl('g', { className: 'floorplan-dimensions' });
    const barX = 30;
    const barY = 606;
    const feetSpan = 5;
    const unit = UNITS_PER_FOOT;
    const barLen = feetSpan * unit;
    scaleBar.append(svgEl('line', { x1: barX, y1: barY, x2: barX + barLen, y2: barY, stroke: '#334155', 'stroke-width': '2' }));
    for (let f = 0; f < feetSpan; f += 1) {
      if (f % 2 === 0) {
        scaleBar.append(svgEl('rect', { x: barX + (f * unit), y: barY - 3, width: unit, height: 6, fill: '#334155' }));
      }
    }
    for (let f = 0; f <= feetSpan; f += 1) {
      const tx = barX + (f * unit);
      scaleBar.append(svgEl('line', { x1: tx, y1: barY - 5, x2: tx, y2: barY + 5, stroke: '#334155', 'stroke-width': '1.5' }));
    }
    scaleBar.append(svgEl('text', { x: barX, y: barY - 9, className: 'floorplan-dimension-text', 'text-anchor': 'start' }, ['0']));
    scaleBar.append(svgEl('text', { x: barX + barLen + 6, y: barY + 4, className: 'floorplan-dimension-text', 'text-anchor': 'start' }, ['5 ft']));
    scaleBar.append(svgEl('text', { x: 920, y: barY + 4, className: 'floorplan-dimension-text', 'text-anchor': 'end' }, ['Snap: 1 ft · Grid: 4 ft']));
    svg.append(scaleBar);

    container.append(board);
    if (needsSheetMigration && !cloudSaveBlocked && sheetId !== 'unknown-sheet') queuePersistDraft();
  },
};

registerTemplate('floorplan', definition);
export default definition;
