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

const definition = {
  name: 'Floor Plan',
  icon: '🏠',
  color: '#0f766e',
  priority: 22,

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

        return { index, type, label, layer, x, y, width, height, length, notes };
      })
      .filter(Boolean);

    const board = el('div', { className: 'floorplan-board' }, [
      el('div', { className: 'floorplan-toolbar' }, [
        el('div', { className: 'floorplan-title-wrap' }, [
          el('span', { className: 'floorplan-title-icon' }, ['🏠']),
          el('span', { className: 'floorplan-title' }, ['House Plan']),
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
        }, []),
      ]),
    ]);

    const svg = board.querySelector('.floorplan-svg');
    const background = el('rect', {
      x: 20,
      y: 20,
      width: 920,
      height: 560,
      rx: 16,
      fill: '#f8fafc',
      stroke: '#dbe2ec',
      'stroke-width': '1',
    });
    svg.append(background);

    for (let x = 40; x <= 920; x += 40) {
      svg.append(el('line', { x1: x, y1: 20, x2: x, y2: 580, className: 'floorplan-grid-line' }));
    }
    for (let y = 40; y <= 560; y += 40) {
      svg.append(el('line', { x1: 20, y1: y, x2: 920, y2: y, className: 'floorplan-grid-line' }));
    }

    const roomLayer = el('g', { className: 'floorplan-layer floorplan-layer-room' });
    const wallLayer = el('g', { className: 'floorplan-layer floorplan-layer-wall' });
    const electricalLayer = el('g', { className: 'floorplan-layer floorplan-layer-electrical' });
    const plumbingLayer = el('g', { className: 'floorplan-layer floorplan-layer-plumbing' });
    const fixtureLayer = el('g', { className: 'floorplan-layer floorplan-layer-fixture' });
    svg.append(roomLayer, wallLayer, electricalLayer, plumbingLayer, fixtureLayer);

    const label = (text, x, y, fill = '#0f172a', className = 'floorplan-label') => el('text', {
      x,
      y,
      className,
      fill,
      'font-size': '12',
      'font-weight': '600',
      'text-anchor': 'middle',
    }, [text]);

    items.forEach((item) => {
      const kind = classifyItem(item);

      if (kind === 'room') {
        const width = Math.max(60, item.width || 120);
        const height = Math.max(40, item.height || 80);
        roomLayer.append(
          el('rect', {
            x: item.x,
            y: item.y,
            width,
            height,
            rx: 10,
            fill: '#dbeafe',
            stroke: '#60a5fa',
            'stroke-width': '2',
            className: 'floorplan-room',
          }),
          label(item.label || 'Room', item.x + (width / 2), item.y + (height / 2) + 4, '#1d4ed8')
        );
      }

      if (kind === 'wall') {
        const targetX = item.length ? item.x + item.length : item.x + (item.width || 120);
        wallLayer.append(
          el('line', {
            x1: item.x,
            y1: item.y,
            x2: targetX,
            y2: item.y + (item.height || 0),
            stroke: '#334155',
            'stroke-width': '5',
            'stroke-linecap': 'round',
            className: 'floorplan-wall',
          }),
          label(item.label || 'Wall', (item.x + targetX) / 2, item.y - 6, '#334155', 'floorplan-wall-label')
        );
      }

      if (kind === 'electrical') {
        const x = item.x || 40;
        const y = item.y || 40;
        electricalLayer.append(
          el('circle', {
            cx: x,
            cy: y,
            r: 8,
            fill: '#4ade80',
            stroke: '#166534',
            'stroke-width': '2',
            className: 'floorplan-electrical',
          }),
          label(item.label || 'Electrical', x + 16, y - 10, '#166534', 'floorplan-device-label')
        );
      }

      if (kind === 'plumbing') {
        const x = item.x || 40;
        const y = item.y || 40;
        plumbingLayer.append(
          el('rect', {
            x: x - 9,
            y: y - 9,
            width: 18,
            height: 18,
            rx: 4,
            fill: '#93c5fd',
            stroke: '#1d4ed8',
            'stroke-width': '2',
            className: 'floorplan-plumbing',
          }),
          label(item.label || 'Plumbing', x + 18, y - 10, '#1d4ed8', 'floorplan-device-label')
        );
      }

      if (kind === 'fixture') {
        const x = item.x || 40;
        const y = item.y || 40;
        const size = Math.max(12, Math.min(18, item.width || item.height || 16));
        fixtureLayer.append(
          el('rect', {
            x: x - (size / 2),
            y: y - (size / 2),
            width: size,
            height: size,
            rx: 3,
            fill: '#fbbf24',
            stroke: '#78350f',
            'stroke-width': '2',
            className: 'floorplan-fixture',
          }),
          label(item.label || 'Fixture', x + 18, y - 10, '#78350f', 'floorplan-device-label')
        );
      }
    });

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
