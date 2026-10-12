/* ============================================================
   floorplan/index.js — Floor Plan template

   A lightweight CAD-style layout designer for home planning.
   The sheet stores rooms, walls, and utility elements as rows,
   then renders them in a plan view with a simple PDF/print export.
   ============================================================ */

import { cell, el, registerTemplate, showToast } from '../shared.js';
import { openFloorplanAiRenderModal } from './ai-render.js';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function isDebugEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__WAYMARK_LOCAL) return true;
  if (window.location && window.location.hostname === 'localhost') return true;
  try {
    return window.localStorage.getItem('waymark_floorplan_debug') === '1';
  } catch {
    return false;
  }
}

function debugLog(...args) {
  if (!isDebugEnabled()) return;
  console.log('[floorplan-debug]', ...args);
}

const TOOL_HINTS = {
  wall: 'Wall: drag or tap to draw with snap-to-grid and auto-connect anchors.',
  room: 'Room: drag or tap to draw bounds, snapped cleanly to nearby geometry.',
  electrical: 'Electrical: tap to place a point with clean snapping.',
  plumbing: 'Plumbing: tap to place a point with clean snapping.',
  door: 'Door: tap near a wall to snap and place an opening.',
  window: 'Window: tap near a wall to snap and place glazing.',
  stairs: 'Stairs: tap to place stair alignment between floors.',
  symbol: 'Symbol: pick an item and tap to place furniture/appliances.',
  select: 'Select: drag to move. Drag corner/end handles to resize geometry.',
  erase: 'Erase: tap any drawn item to remove it.',
};

const HOUSEHOLD_SYMBOLS = [
  { key: 'tv', label: 'TV', icon: '📺', width: 28, height: 16 },
  { key: 'fridge', label: 'Fridge', icon: '🧊', width: 18, height: 18 },
  { key: 'couch', label: 'Couch', icon: '🛋️', width: 26, height: 14 },
  { key: 'chair', label: 'Chair', icon: '🪑', width: 14, height: 14 },
  { key: 'dining-table', label: 'Dining Table', icon: '🍽️', width: 20, height: 20 },
  { key: 'coffee-table', label: 'Coffee Table', icon: '◼', width: 14, height: 14 },
  { key: 'bed', label: 'Bed', icon: '🛏️', width: 28, height: 16 },
  { key: 'nightstand', label: 'Nightstand', icon: '◻', width: 10, height: 10 },
  { key: 'dresser', label: 'Dresser', icon: '🧰', width: 18, height: 12 },
  { key: 'stove', label: 'Stove', icon: '🔥', width: 18, height: 12 },
  { key: 'oven', label: 'Oven', icon: '♨️', width: 18, height: 12 },
  { key: 'microwave', label: 'Microwave', icon: '📟', width: 14, height: 10 },
  { key: 'dishwasher', label: 'Dishwasher', icon: '🧼', width: 16, height: 12 },
  { key: 'sink', label: 'Sink', icon: '🚰', width: 14, height: 10 },
  { key: 'toilet', label: 'Toilet', icon: '🚽', width: 14, height: 14 },
  { key: 'shower', label: 'Shower', icon: '🚿', width: 16, height: 16 },
  { key: 'bathtub', label: 'Bathtub', icon: '🛁', width: 24, height: 12 },
  { key: 'washer', label: 'Washer', icon: '🌀', width: 16, height: 16 },
  { key: 'dryer', label: 'Dryer', icon: '🌬️', width: 16, height: 16 },
  { key: 'desk', label: 'Desk', icon: '🪵', width: 24, height: 12 },
  { key: 'bookshelf', label: 'Bookshelf', icon: '📚', width: 14, height: 20 },
  { key: 'lamp', label: 'Lamp', icon: '💡', width: 12, height: 12 },
  { key: 'plant', label: 'Plant', icon: '🪴', width: 12, height: 12 },
  { key: 'trash', label: 'Trash', icon: '🗑️', width: 12, height: 14 },
  { key: 'cabinet', label: 'Cabinet', icon: '🗄️', width: 16, height: 14 },
  { key: 'island', label: 'Kitchen Island', icon: '⬛', width: 28, height: 14 },
  { key: 'rug', label: 'Rug', icon: '🔳', width: 24, height: 14 },
  { key: 'ac', label: 'AC Unit', icon: '❄️', width: 16, height: 12 },
  { key: 'water-heater', label: 'Water Heater', icon: '♨', width: 14, height: 14 },
];

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
  const rect = svg.getBoundingClientRect();
  const touchPoint = event.touches && event.touches[0]
    ? event.touches[0]
    : event.changedTouches && event.changedTouches[0]
      ? event.changedTouches[0]
      : null;
  const source = touchPoint || event;
  const clientX = source.clientX ?? rect.left;
  const clientY = source.clientY ?? rect.top;
  const x = ((clientX - rect.left) / rect.width) * 960;
  const y = ((clientY - rect.top) / rect.height) * 620;
  return {
    x: clamp(x, 20, 940),
    y: clamp(y, 20, 600),
  };
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

  render(container, rows, cols) {
    container.innerHTML = '';

    const items = rows
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
        };
      })
      .filter(Boolean);

    const board = el('div', { className: 'floorplan-board floorplan-fullscreen' }, [
      el('div', { className: 'floorplan-toolbar' }, [
        el('div', { className: 'floorplan-title-wrap' }, [
          el('span', { className: 'floorplan-title-icon' }, ['🏠']),
          el('span', { className: 'floorplan-title' }, ['House Plan']),
        ]),
        el('div', { className: 'floorplan-toolset floorplan-toolset-menus' }, [
          el('details', { className: 'floorplan-menu' }, [
            el('summary', { className: 'floorplan-menu-summary' }, ['Draw']),
            el('div', { className: 'floorplan-menu-panel' }, [
              el('button', { className: 'floorplan-tool-button active', type: 'button', dataset: { tool: 'wall' }, on: { click: () => setTool('wall') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▭']), el('span', { className: 'floorplan-tool-label' }, ['Wall'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'room' }, on: { click: () => setTool('room') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▢']), el('span', { className: 'floorplan-tool-label' }, ['Room'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'door' }, on: { click: () => setTool('door') } }, [el('span', { className: 'floorplan-tool-icon' }, ['🚪']), el('span', { className: 'floorplan-tool-label' }, ['Door'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'window' }, on: { click: () => setTool('window') } }, [el('span', { className: 'floorplan-tool-icon' }, ['🪟']), el('span', { className: 'floorplan-tool-label' }, ['Window'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'stairs' }, on: { click: () => setTool('stairs') } }, [el('span', { className: 'floorplan-tool-icon' }, ['🪜']), el('span', { className: 'floorplan-tool-label' }, ['Stairs'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'symbol' }, on: { click: () => setTool('symbol') } }, [el('span', { className: 'floorplan-tool-icon' }, ['🧩']), el('span', { className: 'floorplan-tool-label' }, ['Symbol'])]),
            ]),
          ]),
          el('details', { className: 'floorplan-menu floorplan-symbol-menu' }, [
            el('summary', { className: 'floorplan-menu-summary' }, ['Symbols']),
            el('div', { className: 'floorplan-menu-panel floorplan-symbol-panel' }, HOUSEHOLD_SYMBOLS.map(symbol => el('button', {
              className: `floorplan-symbol-choice${symbol.key === HOUSEHOLD_SYMBOLS[0].key ? ' active' : ''}`,
              type: 'button',
              dataset: { symbolKey: symbol.key },
              on: { click: () => setSymbolPreset(symbol.key) },
            }, [
              el('span', { className: 'floorplan-symbol-choice-icon' }, [symbol.icon]),
              el('span', { className: 'floorplan-symbol-choice-label' }, [symbol.label]),
            ]))),
          ]),
          el('details', { className: 'floorplan-menu' }, [
            el('summary', { className: 'floorplan-menu-summary' }, ['Systems']),
            el('div', { className: 'floorplan-menu-panel' }, [
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'electrical' }, on: { click: () => setTool('electrical') } }, [el('span', { className: 'floorplan-tool-icon' }, ['◉']), el('span', { className: 'floorplan-tool-label' }, ['Electrical'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'plumbing' }, on: { click: () => setTool('plumbing') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▣']), el('span', { className: 'floorplan-tool-label' }, ['Plumbing'])]),
            ]),
          ]),
          el('details', { className: 'floorplan-menu' }, [
            el('summary', { className: 'floorplan-menu-summary' }, ['Edit']),
            el('div', { className: 'floorplan-menu-panel' }, [
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'select' }, on: { click: () => setTool('select') } }, [el('span', { className: 'floorplan-tool-icon' }, ['✦']), el('span', { className: 'floorplan-tool-label' }, ['Select'])]),
              el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'erase' }, on: { click: () => setTool('erase') } }, [el('span', { className: 'floorplan-tool-icon' }, ['⌫']), el('span', { className: 'floorplan-tool-label' }, ['Erase'])]),
            ]),
          ]),
          el('details', { className: 'floorplan-menu floorplan-layer-menu' }, [
            el('summary', { className: 'floorplan-menu-summary' }, ['Layers']),
            el('div', { className: 'floorplan-menu-panel floorplan-layer-panel' }, [
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', dataset: { layer: 'room' } }, ['Rooms']),
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', dataset: { layer: 'wall' } }, ['Walls']),
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', dataset: { layer: 'electrical' } }, ['Electrical']),
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', dataset: { layer: 'plumbing' } }, ['Plumbing']),
              el('button', { className: 'floorplan-layer-toggle active', type: 'button', dataset: { layer: 'fixture' } }, ['Fixtures']),
            ]),
          ]),
        ]),
        el('div', { className: 'floorplan-actions' }, [
          el('div', { className: 'floorplan-floor-controls' }, [
            el('button', { className: 'floorplan-floor-btn', type: 'button', on: { click: () => shiftFloor(-1) } }, ['− Floor']),
            el('span', { className: 'floorplan-floor-indicator' }, ['Floor 1']),
            el('button', { className: 'floorplan-floor-btn', type: 'button', on: { click: () => shiftFloor(1) } }, ['+ Floor']),
            el('button', { className: 'floorplan-floor-btn', type: 'button', on: { click: () => toggleAlignBelow() } }, ['Align Below: Off']),
          ]),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-auto-wall-btn',
            on: { click: () => autoGenerateWallsFromRooms() },
          }, ['Auto Walls']),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-floor-one-btn',
            on: { click: () => loadFloorOnePreset() },
          }, ['Load Floor 1']),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-ai-render-btn',
            on: {
              click: () => openFloorplanAiRenderModal({ items: state.items }),
            },
          }, ['Render Photo']),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-interior-toggle-btn',
            on: { click: () => toggleInteriorView() },
          }, ['3D Interior: Off']),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-focus-toggle-btn',
            on: { click: () => toggleFocusMode() },
          }, ['Exit Focus']),
          el('button', {
            className: 'floorplan-export-btn',
            on: { click: () => window.print() },
          }, ['Export PDF']),
        ]),
      ]),
      el('div', { className: 'floorplan-hint', 'aria-live': 'polite' }, [TOOL_HINTS.wall]),
      el('div', { className: 'floorplan-workspace' }, [
        el('div', { className: 'floorplan-stage' }, [
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
        ]),
        el('aside', { className: 'floorplan-interior-panel hidden' }, [
          el('div', { className: 'floorplan-interior-header' }, [
            el('strong', { className: 'floorplan-interior-title' }, ['Interior Box View']),
            el('span', { className: 'floorplan-interior-subtitle' }, ['Select a room, then place symbols inside walls/floor.']),
          ]),
          svgEl('svg', {
            className: 'floorplan-interior-svg',
            viewBox: '0 0 320 260',
            role: 'img',
            'aria-label': 'Interior box room view',
          }, []),
        ]),
      ]),
    ]);

    const svg = board.querySelector('.floorplan-svg');
    const hint = board.querySelector('.floorplan-hint');
    const interiorPanel = board.querySelector('.floorplan-interior-panel');
    const interiorSvg = board.querySelector('.floorplan-interior-svg');
    const scene = svgEl('g', { className: 'floorplan-scene' });
    const bg = svgEl('rect', {
      x: 20,
      y: 20,
      width: 920,
      height: 560,
      rx: 16,
      fill: '#f8fafc',
      stroke: '#dbe2ec',
      'stroke-width': '1',
    });
    svg.append(bg);

    for (let x = 40; x <= 920; x += 40) {
      svg.append(svgEl('line', { x1: x, y1: 20, x2: x, y2: 580, className: 'floorplan-grid-line' }));
    }
    for (let y = 40; y <= 560; y += 40) {
      svg.append(svgEl('line', { x1: 20, y1: y, x2: 920, y2: y, className: 'floorplan-grid-line' }));
    }
    svg.append(scene);

    const state = {
      tool: 'wall',
      items,
      symbolPreset: HOUSEHOLD_SYMBOLS[0],
      currentFloor: 1,
      alignBelow: false,
      interiorEnabled: false,
      layerVisibility: {
        room: true,
        wall: true,
        electrical: true,
        plumbing: true,
        fixture: true,
      },
      preview: null,
      dragStart: null,
      dragId: null,
      resizeDrag: null,
      selectedId: null,
      lastCreateAt: 0,
      lastStartAt: 0,
      lastStartPoint: null,
    };

    function snapToGrid(point, grid = 10) {
      return {
        x: clamp(Math.round(point.x / grid) * grid, 20, 940),
        y: clamp(Math.round(point.y / grid) * grid, 20, 600),
      };
    }

    function findItemById(itemId) {
      return state.items.find(entry => String(entry.id) === String(itemId)) || null;
    }

    function registerNewItem(item) {
      if (!item) return null;
      item.floor = state.currentFloor;
      if (!Array.isArray(item.interior)) item.interior = [];
      return item;
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
      if (tool === 'wall') {
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
        created.width = tool === 'door' ? 24 : 26;
        created.height = tool === 'door' ? 10 : 6;
        created.wallId = snap.wallId;
        created.angle = snap.angle;
        return created;
      }
      if (tool === 'symbol') {
        const preset = state.symbolPreset || HOUSEHOLD_SYMBOLS[0];
        return {
          id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          kind: 'fixture',
          type: preset.label,
          label: preset.label,
          layer: 'fixture',
          x: point.x,
          y: point.y,
          width: preset.width,
          height: preset.height,
          symbolKey: preset.key,
          symbol: preset.icon,
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
          height: 18,
          symbolKey: 'stairs',
          symbol: '🪜',
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
      showToast(added ? `Added ${added} wall segments around rooms.` : 'All room edges already have walls.', 'success');
    }

    function setTool(nextTool) {
      state.tool = nextTool;
      const tools = board.querySelectorAll('.floorplan-tool-button');
      tools.forEach((button) => {
        const active = button.dataset.tool === nextTool;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      board.querySelectorAll('.floorplan-menu').forEach((menu) => {
        if (menu.hasAttribute('open')) menu.removeAttribute('open');
      });
      svg.style.cursor = nextTool === 'erase' ? 'cell' : nextTool === 'select' ? 'grab' : 'crosshair';
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
      const alignButton = board.querySelector('.floorplan-floor-controls .floorplan-floor-btn:last-child');
      if (floorIndicator) floorIndicator.textContent = `Floor ${state.currentFloor}`;
      if (alignButton) alignButton.textContent = `Align Below: ${state.alignBelow ? 'On' : 'Off'}`;
    }

    function shiftFloor(delta) {
      const next = Math.max(1, state.currentFloor + delta);
      state.currentFloor = next;
      state.selectedId = null;
      refreshFloorUi();
      renderScene();
    }

    function toggleAlignBelow() {
      state.alignBelow = !state.alignBelow;
      refreshFloorUi();
      renderScene();
    }

    function toggleInteriorView() {
      state.interiorEnabled = !state.interiorEnabled;
      interiorPanel.classList.toggle('hidden', !state.interiorEnabled);
      const btn = board.querySelector('.floorplan-interior-toggle-btn');
      if (btn) btn.textContent = `3D Interior: ${state.interiorEnabled ? 'On' : 'Off'}`;
      renderScene();
    }

    function loadFloorOnePreset() {
      state.currentFloor = 1;
      state.alignBelow = false;
      state.selectedId = null;
      state.items = [];
      const draftRooms = [
        { label: 'Foyer', x: 520, y: 70, width: 120, height: 80 },
        { label: 'Kitchen', x: 520, y: 170, width: 170, height: 130 },
        { label: 'Long Living Room', x: 300, y: 170, width: 200, height: 310 },
        { label: 'Galley Kitchen', x: 140, y: 170, width: 140, height: 220 },
        { label: 'Hallway', x: 520, y: 320, width: 110, height: 180 },
        { label: 'Closet', x: 640, y: 320, width: 70, height: 70 },
        { label: 'Bath', x: 640, y: 400, width: 100, height: 90 },
        { label: 'Rear Bedroom', x: 500, y: 470, width: 230, height: 110 },
        { label: 'South Room', x: 740, y: 370, width: 180, height: 210 },
      ];

      draftRooms.forEach((room) => {
        const created = registerNewItem(createItem('room', { x: room.x, y: room.y }, { x: room.x + room.width, y: room.y + room.height }));
        created.label = room.label;
        state.items.push(created);
      });

      autoGenerateWallsFromRooms();
      const stairs = registerNewItem(createPointToolItem('stairs', { x: 620, y: 345 }));
      if (stairs) {
        stairs.label = 'Main Stairs';
        state.items.push(stairs);
      }
      const entryDoor = registerNewItem(createPointToolItem('door', { x: 580, y: 70 }));
      if (entryDoor) {
        entryDoor.label = 'Front Door';
        state.items.push(entryDoor);
      }
      const livingDoor = registerNewItem(createPointToolItem('door', { x: 500, y: 240 }));
      if (livingDoor) {
        livingDoor.label = 'Kitchen-Living Door';
        state.items.push(livingDoor);
      }
      const hallDoor = registerNewItem(createPointToolItem('door', { x: 575, y: 320 }));
      if (hallDoor) {
        hallDoor.label = 'Kitchen-Hall Door';
        state.items.push(hallDoor);
      }
      const bathDoor = registerNewItem(createPointToolItem('door', { x: 640, y: 445 }));
      if (bathDoor) {
        bathDoor.label = 'Hall-Bath Door';
        state.items.push(bathDoor);
      }
      const rearDoor = registerNewItem(createPointToolItem('door', { x: 560, y: 470 }));
      if (rearDoor) {
        rearDoor.label = 'Rear Bedroom Door';
        state.items.push(rearDoor);
      }
      const kitchenWin = registerNewItem(createPointToolItem('window', { x: 140, y: 230 }));
      if (kitchenWin) {
        kitchenWin.label = 'Galley Window';
        state.items.push(kitchenWin);
      }
      const livingWin = registerNewItem(createPointToolItem('window', { x: 300, y: 300 }));
      if (livingWin) {
        livingWin.label = 'Living Window';
        state.items.push(livingWin);
      }
      refreshFloorUi();
      renderScene();
      showToast('Loaded Floor 1 house diagram.', 'success');
    }

    function toggleFocusMode() {
      board.classList.toggle('floorplan-fullscreen');
      const focusButton = board.querySelector('.floorplan-focus-toggle-btn');
      if (focusButton) {
        focusButton.textContent = board.classList.contains('floorplan-fullscreen') ? 'Exit Focus' : 'Enter Focus';
      }
    }

    function setLayerVisibility(layer, visible) {
      state.layerVisibility[layer] = visible;
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

    interiorSvg.addEventListener('click', (event) => {
      const face = event.target && event.target.closest ? event.target.closest('[data-face]') : null;
      if (!face || state.tool !== 'symbol') return;
      const selected = state.selectedId ? findItemById(state.selectedId) : null;
      if (!selected || (selected.kind || classifyItem(selected)) !== 'room') {
        showToast('Select a room first to place interior symbols.', 'error');
        return;
      }
      if (!Array.isArray(selected.interior)) selected.interior = [];
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

    function renderScene() {
      scene.innerHTML = '';
      const layers = {
        room: svgEl('g', { className: 'floorplan-layer floorplan-layer-room' }),
        wall: svgEl('g', { className: 'floorplan-layer floorplan-layer-wall' }),
        electrical: svgEl('g', { className: 'floorplan-layer floorplan-layer-electrical' }),
        plumbing: svgEl('g', { className: 'floorplan-layer floorplan-layer-plumbing' }),
        fixture: svgEl('g', { className: 'floorplan-layer floorplan-layer-fixture' }),
      };
      scene.append(...Object.values(layers));

      const label = (text, x, y, fill = '#0f172a', className = 'floorplan-label') => svgEl('text', {
        x,
        y,
        className,
        fill,
        'font-size': '12',
        'font-weight': '600',
        'text-anchor': 'middle',
      }, [text]);

      state.items.forEach((item) => {
        const kind = item.kind || classifyItem(item);
        const itemFloor = getItemFloor(item);
        const isCurrentFloor = itemFloor === state.currentFloor;
        const isAlignedOverlay = state.alignBelow && itemFloor === (state.currentFloor - 1);
        if (!isCurrentFloor && !isAlignedOverlay) return;
        if (state.layerVisibility[kind] === false) return;
        const layer = layers[kind] || layers.fixture;
        const isSelected = isCurrentFloor && String(item.id) === String(state.selectedId);
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
            layer.append(label(item.label, item.x + (width / 2), item.y + (height / 2) + 4, '#1d4ed8'));
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

          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, (x1 + x2) / 2, Math.min(y1, y2) - 8, '#334155', 'floorplan-wall-label'));
          }
        }

        if (kind === 'electrical') {
          const x = item.x || 40;
          const y = item.y || 40;
          const node = svgEl('circle', {
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
          });
          layer.append(node);
          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 16, y - 10, '#166534', 'floorplan-device-label'));
          }
        }

        if (kind === 'plumbing') {
          const x = item.x || 40;
          const y = item.y || 40;
          const node = svgEl('rect', {
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
          });
          layer.append(node);
          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 18, y - 10, '#1d4ed8', 'floorplan-device-label'));
          }
        }

        if (kind === 'fixture') {
          const x = item.x || 40;
          const y = item.y || 40;
          const subtype = fixtureSubtype(item);
          const rotation = Number.isFinite(item.angle) ? Number(item.angle) : 0;
          const symbolGlyph = String(item.symbol || '').trim();
          const commonAttrs = {
            className: `floorplan-fixture floorplan-item floorplan-${subtype}${isSelected ? ' floorplan-selected' : ''}`,
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'fixture',
          };

          if (subtype === 'door') {
            const width = Math.max(16, item.width || 24);
            const height = Math.max(7, item.height || 10);
            layer.append(svgEl('rect', {
              ...commonAttrs,
              x: x - (width / 2),
              y: y - (height / 2),
              width,
              height,
              rx: 2,
              fill: '#f59e0b',
              stroke: '#7c2d12',
              'stroke-width': '2',
              transform: `rotate(${rotation} ${x} ${y})`,
              opacity: itemOpacity,
            }));
          } else if (subtype === 'window') {
            const width = Math.max(18, item.width || 26);
            layer.append(svgEl('line', {
              ...commonAttrs,
              x1: x - (width / 2),
              y1: y,
              x2: x + (width / 2),
              y2: y,
              stroke: '#0ea5e9',
              'stroke-width': '4',
              'stroke-linecap': 'round',
              transform: `rotate(${rotation} ${x} ${y})`,
              opacity: itemOpacity,
            }));
          } else if (subtype === 'stairs') {
            const width = Math.max(26, item.width || 30);
            const height = Math.max(16, item.height || 18);
            layer.append(svgEl('rect', {
              ...commonAttrs,
              x: x - (width / 2),
              y: y - (height / 2),
              width,
              height,
              rx: 4,
              fill: '#f1f5f9',
              stroke: '#475569',
              'stroke-width': '2',
              opacity: itemOpacity,
            }));
            layer.append(svgEl('text', {
              x,
              y: y + 4,
              className: 'floorplan-symbol-glyph',
              'text-anchor': 'middle',
              'font-size': '12',
              opacity: itemOpacity,
            }, ['🪜']));
          } else if (symbolGlyph) {
            const width = Math.max(14, item.width || 18);
            const height = Math.max(14, item.height || 18);
            layer.append(svgEl('rect', {
              ...commonAttrs,
              x: x - (width / 2),
              y: y - (height / 2),
              width,
              height,
              rx: 4,
              fill: '#f8fafc',
              stroke: '#64748b',
              'stroke-width': '1.5',
              opacity: itemOpacity,
            }));
            layer.append(svgEl('text', {
              x,
              y: y + 4,
              className: 'floorplan-symbol-glyph',
              'text-anchor': 'middle',
              'font-size': '12',
              opacity: itemOpacity,
            }, [symbolGlyph]));
          } else {
            const size = Math.max(12, Math.min(18, item.width || item.height || 16));
            layer.append(svgEl('rect', {
              ...commonAttrs,
              x: x - (size / 2),
              y: y - (size / 2),
              width: size,
              height: size,
              rx: 3,
              fill: '#fbbf24',
              stroke: '#78350f',
              'stroke-width': '2',
              opacity: itemOpacity,
            }));
          }

          if (isSelected && hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 18, y - 10, '#78350f', 'floorplan-device-label'));
          }
        }
      });

      if (state.selectedId) {
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
            handleLayer.append(label(`${Math.round(width)}w x ${Math.round(height)}h`, right - 8, top - 10, '#1e40af', 'floorplan-measure-label'));
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
            handleLayer.append(label(`${Math.round(length)}u`, (x1 + x2) / 2, ((y1 + y2) / 2) - 10, '#1e40af', 'floorplan-measure-label'));
          }

          if (selected.kind === 'electrical' || selected.kind === 'plumbing' || selected.kind === 'fixture') {
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
      renderInteriorView();
    }

    function beginDraft(event) {
      const isMouseInput = event.pointerType === 'mouse' || event.type === 'mousedown';
      if (isMouseInput && event.button !== 0) return;
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

      if (state.tool === 'erase') {
        if (targetItem && targetItemData && getItemFloor(targetItemData) === state.currentFloor) {
          const itemId = targetItem.dataset.floorplanItem;
          state.items = state.items.filter(item => String(item.id) !== itemId);
          debugLog('erase-item', { itemId, remaining: state.items.length });
          renderScene();
        }
        return;
      }

      if (state.tool === 'select') {
        const handleTarget = event.target && event.target.closest ? event.target.closest('[data-floorplan-handle]') : null;
        if (handleTarget) {
          const itemId = handleTarget.dataset.floorplanItem;
          const handle = handleTarget.dataset.floorplanHandle;
          const item = findItemById(itemId);
          if (item) {
            if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
            state.selectedId = itemId;
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
              },
            };
            state.dragStart = { x: point.x, y: point.y };
            debugLog('resize-start', { itemId, handle, kind: item.kind });
            renderScene();
          }
          return;
        }

        if (targetItem && targetItemData && getItemFloor(targetItemData) === state.currentFloor) {
          if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
          state.dragId = targetItem.dataset.floorplanItem;
          state.selectedId = state.dragId;
          const item = findItemById(state.dragId);
          if (item) {
            state.dragStart = { x: point.x, y: point.y };
            item.dragOrigin = {
              x: item.x,
              y: item.y,
              x2: getWallEndpoints(item).x2,
              y2: getWallEndpoints(item).y2,
            };
            debugLog('select-start', { itemId: state.dragId, kind: item.kind, x: point.x, y: point.y });
          }
          renderScene();
        } else {
          state.selectedId = null;
          renderScene();
        }
        return;
      }

      if (state.tool === 'electrical' || state.tool === 'plumbing' || state.tool === 'door' || state.tool === 'window' || state.tool === 'symbol' || state.tool === 'stairs') {
        const created = registerNewItem(createPointToolItem(state.tool, point));
        if (!created) return;
        state.items.push(created);
        state.lastCreateAt = Date.now();
        debugLog('create-point', { kind: created.kind, id: created.id, x: created.x, y: created.y, count: state.items.length });
        renderScene();
        return;
      }

      if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
      state.dragStart = point;
      state.preview = { kind: state.tool, start: point, end: point };
      renderScene();
    }

    function updateDraft(event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (state.tool === 'select') {
        const point = pointFromEvent(svg, event);
        if (state.resizeDrag) {
          const item = findItemById(state.resizeDrag.itemId);
          if (!item) return;
          const { handle, origin } = state.resizeDrag;
          const snapped = item.kind === 'wall'
            ? snapPointForTool(point, 'wall', { skipWallId: item.id })
            : snapPointForTool(point, 'room');
          const px = clamp(snapped.x, 20, 940);
          const py = clamp(snapped.y, 20, 600);

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

            left = clamp(left, 20, 900);
            top = clamp(top, 20, 560);
            right = clamp(right, left + 40, 940);
            bottom = clamp(bottom, top + 34, 600);

            item.x = left;
            item.y = top;
            item.width = right - left;
            item.height = bottom - top;
          }

          if (item.kind === 'wall') {
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
          }

          if (item.kind === 'electrical' || item.kind === 'plumbing' || item.kind === 'fixture') {
            if (handle === 'point-center') {
              item.x = px;
              item.y = py;
            }
          }

          debugLog('resize-move', { itemId: item.id, handle, x: item.x, y: item.y });
          renderScene();
          return;
        }

        if (state.dragId && state.dragStart) {
          const item = findItemById(state.dragId);
          if (!item || !item.dragOrigin) return;
          const dx = point.x - state.dragStart.x;
          const dy = point.y - state.dragStart.y;
          item.x = item.dragOrigin.x + dx;
          item.y = item.dragOrigin.y + dy;
          if (item.dragOrigin.x2 !== null) item.x2 = item.dragOrigin.x2 + dx;
          if (item.dragOrigin.y2 !== null) item.y2 = item.dragOrigin.y2 + dy;
          item.x = clamp(item.x, 20, 940);
          item.y = clamp(item.y, 20, 600);
          if (typeof item.x2 === 'number') item.x2 = clamp(item.x2, 20, 940);
          if (typeof item.y2 === 'number') item.y2 = clamp(item.y2, 20, 600);
          debugLog('select-move', { itemId: state.dragId, x: item.x, y: item.y });
          renderScene();
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
      if (event && event.pointerId !== undefined) {
        svg.releasePointerCapture?.(event.pointerId);
      }

      if (state.tool === 'select') {
        state.dragId = null;
        state.resizeDrag = null;
        state.dragStart = null;
        state.items.forEach(item => { delete item.dragOrigin; });
        debugLog('select-end');
        renderScene();
        return;
      }

      if (state.tool !== 'erase' && state.preview) {
        const { kind, start, end } = state.preview;
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        debugLog('input-end', { eventType: event?.type, kind, distance, start, end });
        if (distance > 18) {
          const created = registerNewItem(createItem(kind, start, end));
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-drag', { kind: created.kind, id: created.id, count: state.items.length });
        } else if (kind === 'wall') {
          const wallEndRaw = {
            x: clamp(start.x + 80, 20, 940),
            y: start.y,
          };
          const wallEnd = snapPointForTool(wallEndRaw, 'wall');
          const created = registerNewItem(createItem(kind, start, wallEnd));
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-click-wall', { id: created.id, from: start, to: wallEnd, count: state.items.length });
        } else if (kind === 'room') {
          const roomStart = {
            x: clamp(start.x - 60, 20, 880),
            y: clamp(start.y - 40, 20, 520),
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
    }

    function fallbackClickCreate(event) {
      if (state.tool === 'select' || state.tool === 'erase') return;
      if (state.preview || state.dragStart || state.dragId) return;
      if ((Date.now() - state.lastCreateAt) < 150) return;

      const point = snapPointForTool(pointFromEvent(svg, event), state.tool);
      let created = null;
      if (state.tool === 'wall') {
        const wallEnd = snapPointForTool({ x: clamp(point.x + 80, 20, 940), y: point.y }, 'wall');
        created = createItem('wall', point, wallEnd);
      } else if (state.tool === 'room') {
        const roomStart = {
          x: clamp(point.x - 60, 20, 880),
          y: clamp(point.y - 40, 20, 520),
        };
        const roomEnd = { x: roomStart.x + 120, y: roomStart.y + 80 };
        created = createItem('room', roomStart, roomEnd);
      } else if (state.tool === 'electrical' || state.tool === 'plumbing' || state.tool === 'door' || state.tool === 'window' || state.tool === 'symbol' || state.tool === 'stairs') {
        created = createPointToolItem(state.tool, point);
      }

      created = registerNewItem(created);
      if (!created) return;
      state.items.push(created);
      state.lastCreateAt = Date.now();
      debugLog('fallback-click-create', { tool: state.tool, id: created.id, x: point.x, y: point.y, count: state.items.length });
      renderScene();
    }

    const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    debugLog('input-mode', { supportsPointer });
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
    svg.style.cursor = 'crosshair';
    refreshFloorUi();
    setTool('wall');
    renderScene();

    const dims = svgEl('g', { className: 'floorplan-dimensions' });
    dims.append(
      svgEl('line', { x1: 20, y1: 600, x2: 920, y2: 600, stroke: '#64748b', 'stroke-width': '1.5', 'stroke-dasharray': '6 4' }),
      svgEl('text', { x: 470, y: 620, className: 'floorplan-dimension-text', 'text-anchor': 'middle' }, ['Scale: 1 unit = 1 ft'])
    );
    svg.append(dims);

    container.append(board);
  },
};

registerTemplate('floorplan', definition);
export default definition;
