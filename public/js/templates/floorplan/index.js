/* ============================================================
   floorplan/index.js — Floor Plan template

   A lightweight CAD-style layout designer for home planning.
   The sheet stores rooms, walls, and utility elements as rows,
   then renders them in a plan view with a simple PDF/print export.
   ============================================================ */

import { cell, el, registerTemplate } from '../shared.js';

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

function pointFromEvent(svg, event) {
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 960;
  const y = ((event.clientY - rect.top) / rect.height) * 620;
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
      label: 'Room',
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
      label: 'Wall',
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
    label: kind === 'electrical' ? 'Electrical' : 'Plumbing',
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
        el('button', {
          className: 'floorplan-export-btn',
          on: { click: () => window.print() },
        }, ['Export PDF']),
      ]),
      el('div', { className: 'floorplan-legend' }, [
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-room' }, []), 'Rooms']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-wall' }, []), 'Walls']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-electrical' }, []), 'Electrical']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-plumbing' }, []), 'Plumbing']),
        el('span', { className: 'floorplan-legend-item' }, [el('span', { className: 'floorplan-swatch floorplan-swatch-fixture' }, []), 'Fixtures']),
      ]),
      el('div', { className: 'floorplan-stage' }, [
        el('svg', {
          className: 'floorplan-svg',
          viewBox: '0 0 960 620',
          role: 'img',
          'aria-label': 'House floor plan',
          'data-floorplan-svg': 'true',
          style: { touchAction: 'none' },
        }, []),
      ]),
    ]);

    const svg = board.querySelector('.floorplan-svg');
    const scene = el('g', { className: 'floorplan-scene' });
    const bg = el('rect', {
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
      svg.append(el('line', { x1: x, y1: 20, x2: x, y2: 580, className: 'floorplan-grid-line' }));
    }
    for (let y = 40; y <= 560; y += 40) {
      svg.append(el('line', { x1: 20, y1: y, x2: 920, y2: y, className: 'floorplan-grid-line' }));
    }
    svg.append(scene);

    const state = {
      tool: 'wall',
      items,
      preview: null,
      dragStart: null,
      dragId: null,
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
    }

    function renderScene() {
      scene.innerHTML = '';
      const layers = {
        room: el('g', { className: 'floorplan-layer floorplan-layer-room' }),
        wall: el('g', { className: 'floorplan-layer floorplan-layer-wall' }),
        electrical: el('g', { className: 'floorplan-layer floorplan-layer-electrical' }),
        plumbing: el('g', { className: 'floorplan-layer floorplan-layer-plumbing' }),
        fixture: el('g', { className: 'floorplan-layer floorplan-layer-fixture' }),
      };
      scene.append(...Object.values(layers));

      const label = (text, x, y, fill = '#0f172a', className = 'floorplan-label') => el('text', {
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
          const rect = el('rect', {
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
          layer.append(rect, label(item.label || 'Room', item.x + (width / 2), item.y + (height / 2) + 4, '#1d4ed8'));
        }

        if (kind === 'wall') {
          const x1 = item.x;
          const y1 = item.y;
          const x2 = typeof item.x2 === 'number' ? item.x2 : item.x + (item.length || item.width || 120);
          const y2 = typeof item.y2 === 'number' ? item.y2 : item.y + (item.height || 0);
          const line = el('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: '#334155',
            'stroke-width': '5',
            'stroke-linecap': 'round',
            className: 'floorplan-wall floorplan-item',
            'data-floorplan-item': String(item.id),
            'data-floorplan-kind': 'wall',
          });
          layer.append(line, label(item.label || 'Wall', (x1 + x2) / 2, Math.min(y1, y2) - 6, '#334155', 'floorplan-wall-label'));
        }

        if (kind === 'electrical') {
          const x = item.x || 40;
          const y = item.y || 40;
          layer.append(
            el('circle', {
              cx: x,
              cy: y,
              r: 8,
              fill: '#4ade80',
              stroke: '#166534',
              'stroke-width': '2',
              className: 'floorplan-electrical floorplan-item',
              'data-floorplan-item': String(item.id),
              'data-floorplan-kind': 'electrical',
            }),
            label(item.label || 'Electrical', x + 16, y - 10, '#166534', 'floorplan-device-label')
          );
        }

        if (kind === 'plumbing') {
          const x = item.x || 40;
          const y = item.y || 40;
          layer.append(
            el('rect', {
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
            }),
            label(item.label || 'Plumbing', x + 18, y - 10, '#1d4ed8', 'floorplan-device-label')
          );
        }

        if (kind === 'fixture') {
          const x = item.x || 40;
          const y = item.y || 40;
          const size = Math.max(12, Math.min(18, item.width || item.height || 16));
          layer.append(
            el('rect', {
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
            }),
            label(item.label || 'Fixture', x + 18, y - 10, '#78350f', 'floorplan-device-label')
          );
        }
      });

      if (state.preview) {
        const previewLayer = el('g', { className: 'floorplan-preview-layer' });
        const preview = state.preview;
        if (preview.kind === 'room') {
          const dims = createFence({}, preview.start, preview.end);
          previewLayer.append(el('rect', {
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
          previewLayer.append(el('line', {
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
          previewLayer.append(el('circle', {
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
          previewLayer.append(el('rect', {
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
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const point = pointFromEvent(svg, event);
      const targetItem = event.target && event.target.closest ? event.target.closest('[data-floorplan-item]') : null;

      if (state.tool === 'erase') {
        if (targetItem) {
          const itemId = targetItem.dataset.floorplanItem;
          state.items = state.items.filter(item => String(item.id) !== itemId);
          renderScene();
        }
        return;
      }

      if (state.tool === 'select') {
        if (targetItem) {
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
          }
        }
        return;
      }

      state.dragStart = point;
      state.preview = { kind: state.tool, start: point, end: point };
      renderScene();
    }

    function updateDraft(event) {
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
          renderScene();
        }
        return;
      }

      if (!state.preview) return;
      state.preview.end = pointFromEvent(svg, event);
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
        renderScene();
        return;
      }

      if (state.tool !== 'erase' && state.preview) {
        const { kind, start, end } = state.preview;
        if (Math.hypot(end.x - start.x, end.y - start.y) > 10) {
          state.items.push(createItem(kind, start, end));
        }
      }
      state.preview = null;
      state.dragStart = null;
      renderScene();
    }

    svg.addEventListener('pointerdown', beginDraft);
    svg.addEventListener('pointermove', updateDraft);
    svg.addEventListener('pointerup', endDraft);
    svg.addEventListener('pointerleave', endDraft);
    svg.addEventListener('pointercancel', endDraft);
    svg.style.cursor = 'crosshair';
    setTool('wall');
    renderScene();

    const dims = el('g', { className: 'floorplan-dimensions' });
    dims.append(
      el('line', { x1: 20, y1: 600, x2: 920, y2: 600, stroke: '#64748b', 'stroke-width': '1.5', 'stroke-dasharray': '6 4' }),
      el('text', { x: 470, y: 620, className: 'floorplan-dimension-text', 'text-anchor': 'middle' }, ['Scale: 1 unit = 1 ft'])
    );
    svg.append(dims);

    container.append(board);
  },
};

registerTemplate('floorplan', definition);
export default definition;
