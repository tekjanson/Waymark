/* ============================================================
   floorplan/index.js — Floor Plan template

   A lightweight CAD-style layout designer for home planning.
   The sheet stores rooms, walls, and utility elements as rows,
   then renders them in a plan view with a simple PDF/print export.
   ============================================================ */

import { cell, el, registerTemplate, showToast } from '../shared.js';
import { openFloorplanAiModal } from './ai-vision.js';
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

function classifyItem(item) {
  const type = String(item.type || item.label || '').toLowerCase();
  const layer = String(item.layer || '').toLowerCase();

  if (type.includes('room')) return 'room';
  if (type.includes('wall')) return 'wall';
  if (type.includes('door') || type.includes('window') || type.includes('opening')) return 'fixture';
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
  wall: 'Wall: drag to draw, or tap once to drop a short wall segment.',
  room: 'Room: drag to draw room bounds, or tap once to drop a default room.',
  electrical: 'Electrical: tap to place a point, drag to preview before release.',
  plumbing: 'Plumbing: tap to place a point, drag to preview before release.',
  select: 'Select: drag an existing room/wall/device to reposition it.',
  erase: 'Erase: tap any drawn item to remove it.',
};

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

  function makeFixture(point, label = '') {
    return {
      id: `floorplan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind: 'fixture',
      type: 'Fixture',
      label: String(label || '').trim(),
      layer: 'fixture',
      x: point.x,
      y: point.y,
      width: 16,
      height: 16,
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
        return { id: `sheet-${index + 1}`, index, kind, type, label, layer, x, y, width, height, length, notes };
      })
      .filter(Boolean);

    const board = el('div', { className: 'floorplan-board' }, [
      el('div', { className: 'floorplan-toolbar' }, [
        el('div', { className: 'floorplan-title-wrap' }, [
          el('span', { className: 'floorplan-title-icon' }, ['🏠']),
          el('span', { className: 'floorplan-title' }, ['House Plan']),
        ]),
        el('div', { className: 'floorplan-toolset' }, [
          el('button', { className: 'floorplan-tool-button active', type: 'button', dataset: { tool: 'wall' }, on: { click: () => setTool('wall') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▭']), el('span', { className: 'floorplan-tool-label' }, ['Wall'])]),
          el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'room' }, on: { click: () => setTool('room') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▢']), el('span', { className: 'floorplan-tool-label' }, ['Room'])]),
          el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'electrical' }, on: { click: () => setTool('electrical') } }, [el('span', { className: 'floorplan-tool-icon' }, ['◉']), el('span', { className: 'floorplan-tool-label' }, ['Electrical'])]),
          el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'plumbing' }, on: { click: () => setTool('plumbing') } }, [el('span', { className: 'floorplan-tool-icon' }, ['▣']), el('span', { className: 'floorplan-tool-label' }, ['Plumbing'])]),
          el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'select' }, on: { click: () => setTool('select') } }, [el('span', { className: 'floorplan-tool-icon' }, ['✦']), el('span', { className: 'floorplan-tool-label' }, ['Select'])]),
          el('button', { className: 'floorplan-tool-button', type: 'button', dataset: { tool: 'erase' }, on: { click: () => setTool('erase') } }, [el('span', { className: 'floorplan-tool-icon' }, ['⌫']), el('span', { className: 'floorplan-tool-label' }, ['Erase'])]),
        ]),
        el('div', { className: 'floorplan-actions' }, [
          el('button', {
            className: 'floorplan-secondary-btn floorplan-ai-launch-btn',
            on: {
              click: () => openFloorplanAiModal({ onApply: applyAiPlanToCanvas }),
            },
          }, ['AI From Photos']),
          el('button', {
            className: 'floorplan-secondary-btn floorplan-ai-render-btn',
            on: {
              click: () => openFloorplanAiRenderModal({ items: state.items }),
            },
          }, ['AI Space Render']),
          el('button', {
            className: 'floorplan-secondary-btn',
            on: { click: () => board.classList.toggle('floorplan-fullscreen') },
          }, ['Full Screen']),
          el('button', {
            className: 'floorplan-export-btn',
            on: { click: () => window.print() },
          }, ['Export PDF']),
        ]),
      ]),
      el('div', { className: 'floorplan-legend' }, [
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-room' }, []), 'Rooms']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-wall' }, []), 'Walls']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-electrical' }, []), 'Electrical']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-plumbing' }, []), 'Plumbing']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-fixture' }, []), 'Fixtures']),
      ]),
      el('div', { className: 'floorplan-hint', 'aria-live': 'polite' }, [TOOL_HINTS.wall]),
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
    ]);

    const svg = board.querySelector('.floorplan-svg');
    const hint = board.querySelector('.floorplan-hint');
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
      preview: null,
      dragStart: null,
      dragId: null,
      lastCreateAt: 0,
      lastStartAt: 0,
      lastStartPoint: null,
    };

    function setTool(nextTool) {
      state.tool = nextTool;
      const tools = board.querySelectorAll('.floorplan-tool-button');
      tools.forEach((button) => {
        const active = button.dataset.tool === nextTool;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      svg.style.cursor = nextTool === 'erase' ? 'cell' : nextTool === 'select' ? 'grab' : 'crosshair';
      if (hint) hint.textContent = TOOL_HINTS[nextTool] || '';
      debugLog('tool-change', { tool: nextTool });
    }

    function applyAiPlanToCanvas(plan) {
      if (!plan || typeof plan !== 'object') {
        showToast('AI did not return a usable floor plan.', 'error');
        return 0;
      }

      const toX = (pct) => clamp(20 + ((Number(pct) || 0) / 100) * 920, 20, 940);
      const toY = (pct) => clamp(20 + ((Number(pct) || 0) / 100) * 560, 20, 600);
      const generated = [];

      for (const room of (plan.rooms || [])) {
        const start = { x: toX(room.x), y: toY(room.y) };
        const end = {
          x: toX((Number(room.x) || 0) + (Number(room.width) || 0)),
          y: toY((Number(room.y) || 0) + (Number(room.height) || 0)),
        };
        const item = createItem('room', start, end);
        item.label = String(room.label || '').trim();
        generated.push(item);
      }

      for (const wall of (plan.walls || [])) {
        const start = { x: toX(wall.x1), y: toY(wall.y1) };
        const end = { x: toX(wall.x2), y: toY(wall.y2) };
        const item = createItem('wall', start, end);
        item.label = String(wall.label || '').trim();
        generated.push(item);
      }

      for (const point of (plan.electrical || [])) {
        const at = { x: toX(point.x), y: toY(point.y) };
        const item = createItem('electrical', at, at);
        item.label = String(point.label || '').trim();
        generated.push(item);
      }

      for (const point of (plan.plumbing || [])) {
        const at = { x: toX(point.x), y: toY(point.y) };
        const item = createItem('plumbing', at, at);
        item.label = String(point.label || '').trim();
        generated.push(item);
      }

      for (const point of (plan.fixtures || [])) {
        const at = { x: toX(point.x), y: toY(point.y) };
        generated.push(makeFixture(at, point.label || ''));
      }

      if (!generated.length) {
        showToast('AI draft had no drawable geometry. Try clearer photos.', 'error');
        return 0;
      }

      state.items.push(...generated);
      renderScene();
      showToast(`AI draft applied: ${generated.length} items`, 'success');
      return generated.length;
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
        const layer = layers[kind] || layers.fixture;

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
            className: 'floorplan-room floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'room',
          });
          layer.append(rect);
          if (hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, item.x + (width / 2), item.y + (height / 2) + 4, '#1d4ed8'));
          }
        }

        if (kind === 'wall') {
          const x1 = item.x;
          const y1 = item.y;
          const x2 = typeof item.x2 === 'number' ? item.x2 : item.x + (item.length || item.width || 120);
          const y2 = typeof item.y2 === 'number' ? item.y2 : item.y + (item.height || 0);
          const line = svgEl('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: '#334155',
            'stroke-width': '6',
            'stroke-linecap': 'round',
            className: 'floorplan-wall floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'wall',
          });
          layer.append(line);

          if (hasMeaningfulLabel(item.label)) {
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
            className: 'floorplan-electrical floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'electrical',
          });
          layer.append(node);
          if (hasMeaningfulLabel(item.label)) {
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
            className: 'floorplan-plumbing floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'plumbing',
          });
          layer.append(node);
          if (hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 18, y - 10, '#1d4ed8', 'floorplan-device-label'));
          }
        }

        if (kind === 'fixture') {
          const x = item.x || 40;
          const y = item.y || 40;
          const size = Math.max(12, Math.min(18, item.width || item.height || 16));
          const node = svgEl('rect', {
            x: x - (size / 2),
            y: y - (size / 2),
            width: size,
            height: size,
            rx: 3,
            fill: '#fbbf24',
            stroke: '#78350f',
            'stroke-width': '2',
            className: 'floorplan-fixture floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'fixture',
          });
          layer.append(node);
          if (hasMeaningfulLabel(item.label)) {
            layer.append(label(item.label, x + 18, y - 10, '#78350f', 'floorplan-device-label'));
          }
        }
      });

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
        scene.append(previewLayer);
      }
    }

    function beginDraft(event) {
      const isMouseInput = event.pointerType === 'mouse' || event.type === 'mousedown';
      if (isMouseInput && event.button !== 0) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const point = pointFromEvent(svg, event);
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

      if (state.tool === 'erase') {
        if (targetItem) {
          const itemId = targetItem.dataset.floorplanItem;
          state.items = state.items.filter(item => String(item.id) !== itemId);
          debugLog('erase-item', { itemId, remaining: state.items.length });
          renderScene();
        }
        return;
      }

      if (state.tool === 'select') {
        if (targetItem) {
          if (event.pointerId !== undefined) svg.setPointerCapture?.(event.pointerId);
          state.dragId = targetItem.dataset.floorplanItem;
          const item = state.items.find(entry => String(entry.id) === state.dragId);
          if (item) {
            state.dragStart = { x: point.x, y: point.y };
            item.dragOrigin = {
              x: item.x,
              y: item.y,
              x2: typeof item.x2 === 'number' ? item.x2 : null,
              y2: typeof item.y2 === 'number' ? item.y2 : null,
            };
            debugLog('select-start', { itemId: state.dragId, kind: item.kind, x: point.x, y: point.y });
          }
        }
        return;
      }

      if (state.tool === 'electrical' || state.tool === 'plumbing') {
        const created = createItem(state.tool, point, point);
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
      if (!state.dragStart || state.tool === 'erase' || state.tool === 'select') {
        if (state.dragId) {
          const item = state.items.find(entry => String(entry.id) === state.dragId);
          if (!item || !item.dragOrigin) return;
          const point = pointFromEvent(svg, event);
          const dx = point.x - state.dragStart.x;
          const dy = point.y - state.dragStart.y;
          item.x = item.dragOrigin.x + dx;
          item.y = item.dragOrigin.y + dy;
          if (item.dragOrigin.x2 !== null) item.x2 = item.dragOrigin.x2 + dx;
          if (item.dragOrigin.y2 !== null) item.y2 = item.dragOrigin.y2 + dy;
          debugLog('select-move', { itemId: state.dragId, x: item.x, y: item.y });
          renderScene();
        }
        return;
      }

      if (!state.preview) return;
      const point = pointFromEvent(svg, event);
      state.preview.end = point;
      renderScene();
    }

    function endDraft(event) {
      if (event && event.pointerId !== undefined) {
        svg.releasePointerCapture?.(event.pointerId);
      }

      if (state.tool === 'select') {
        state.dragId = null;
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
          const created = createItem(kind, start, end);
          state.items.push(created);
          state.lastCreateAt = Date.now();
          debugLog('create-drag', { kind: created.kind, id: created.id, count: state.items.length });
        } else if (kind === 'wall') {
          const wallEnd = {
            x: clamp(start.x + 80, 20, 940),
            y: start.y,
          };
          const created = createItem(kind, start, wallEnd);
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
          const created = createItem(kind, roomStart, roomEnd);
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

      const point = pointFromEvent(svg, event);
      let created = null;
      if (state.tool === 'wall') {
        const wallEnd = { x: clamp(point.x + 80, 20, 940), y: point.y };
        created = createItem('wall', point, wallEnd);
      } else if (state.tool === 'room') {
        const roomStart = {
          x: clamp(point.x - 60, 20, 880),
          y: clamp(point.y - 40, 20, 520),
        };
        const roomEnd = { x: roomStart.x + 120, y: roomStart.y + 80 };
        created = createItem('room', roomStart, roomEnd);
      } else if (state.tool === 'electrical' || state.tool === 'plumbing') {
        created = createItem(state.tool, point, point);
      }

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
