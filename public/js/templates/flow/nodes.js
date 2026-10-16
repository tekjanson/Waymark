/* ============================================================
   flow/nodes.js — SVG node/edge rendering & layout computation

   Layered hierarchical layout algorithm + SVG rendering.
   BFS layer assignment, crossing minimization, and centered
   positioning within each layer.  Cached drag positions
   override auto-layout per node.
   ============================================================ */

import {
  NODE_SHAPES, NODE_W, NODE_H,
  getNodePos, svg,
} from './helpers.js';

/* ---------- Layout ---------- */

const GAP_X = 60;
const GAP_Y = 80;
const LAYER_PADDING_X = 40;
const LAYER_PADDING_Y = 30;
const LABEL_CHAR_WIDTH = 7;
const LABEL_LINE_HEIGHT = 14;
const MAX_LABEL_LINES = 3;

/**
 * Wrap a node label into readable short lines.
 * @param {string} label
 * @param {number} maxChars
 * @returns {string[]}
 */
function wrapLabel(label, maxChars) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= MAX_LABEL_LINES) return lines;
  const kept = lines.slice(0, MAX_LABEL_LINES);
  const overflow = lines.slice(MAX_LABEL_LINES - 1).join(' ');
  kept[MAX_LABEL_LINES - 1] = overflow;
  return kept;
}

/**
 * Estimate node dimensions based on title length and shape.
 * @param {Object} step
 * @returns {{ w: number, h: number, labelLines: string[] }}
 */
function measureNode(step) {
  const maxChars = step.type === 'decision' ? 14 : 18;
  const labelLines = wrapLabel(step.step, maxChars);
  const longest = Math.max(...labelLines.map(line => line.length), 10);
  const width = Math.max(NODE_W, Math.min(280, longest * LABEL_CHAR_WIDTH + 62));
  const labelHeight = labelLines.length * LABEL_LINE_HEIGHT;
  const height = Math.max(
    step.type === 'decision' ? 88 : NODE_H,
    labelHeight + 34,
  );
  return {
    w: step.type === 'decision' ? Math.max(width, 210) : width,
    h: height,
    labelLines,
  };
}

/**
 * Assign BFS layers to steps.
 * Roots = nodes with no inbound edges.
 * Returns Map<stepKey, layerIndex>.
 */
function assignLayers(steps) {
  const inbound = new Map();
  const children = new Map();
  for (const s of steps) {
    const key = s.step.toLowerCase().trim();
    if (!inbound.has(key)) inbound.set(key, new Set());
    if (!children.has(key)) children.set(key, []);
    if (s.next) {
      for (const t of s.next.split(',').map(x => x.trim().toLowerCase())) {
        if (!t) continue;
        if (!inbound.has(t)) inbound.set(t, new Set());
        inbound.get(t).add(key);
        children.get(key).push(t);
      }
    }
  }

  /* Find roots (no inbound edges) — fall back to first node */
  const roots = [];
  for (const s of steps) {
    const key = s.step.toLowerCase().trim();
    if (!inbound.get(key)?.size) roots.push(key);
  }
  if (roots.length === 0 && steps.length) {
    roots.push(steps[0].step.toLowerCase().trim());
  }

  const layers = new Map();
  const queue = roots.map(r => ({ key: r, layer: 0 }));
  const visited = new Set();
  while (queue.length) {
    const { key, layer } = queue.shift();
    if (visited.has(key)) {
      /* Cycle: keep the deepest layer assignment */
      if ((layers.get(key) || 0) < layer) layers.set(key, layer);
      continue;
    }
    visited.add(key);
    layers.set(key, layer);
    for (const c of (children.get(key) || [])) {
      queue.push({ key: c, layer: layer + 1 });
    }
  }

  /* Assign unvisited nodes to layer after the max */
  let maxLayer = 0;
  for (const v of layers.values()) if (v > maxLayer) maxLayer = v;
  for (const s of steps) {
    const key = s.step.toLowerCase().trim();
    if (!layers.has(key)) {
      maxLayer++;
      layers.set(key, maxLayer);
    }
  }

  return layers;
}

/**
 * Minimize edge crossings within each layer via barycenter heuristic.
 * Returns Map<layerIndex, stepKey[]> with optimized ordering.
 */
function minimizeCrossings(layerMap, steps) {
  /* Group keys by layer */
  const byLayer = new Map();
  for (const s of steps) {
    const key = s.step.toLowerCase().trim();
    const layer = layerMap.get(key) || 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(key);
  }

  /* Build adjacency: parent keys for each key */
  const parents = new Map();
  for (const s of steps) {
    const key = s.step.toLowerCase().trim();
    if (s.next) {
      for (const t of s.next.split(',').map(x => x.trim().toLowerCase())) {
        if (!t) continue;
        if (!parents.has(t)) parents.set(t, []);
        parents.get(t).push(key);
      }
    }
  }

  /* Barycenter sort: 2 sweeps */
  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < 2; pass++) {
    for (let li = 1; li < layerNums.length; li++) {
      const layer = layerNums[li];
      const prevLayer = byLayer.get(layerNums[li - 1]) || [];
      const prevIndex = new Map(prevLayer.map((k, i) => [k, i]));
      const keys = byLayer.get(layer);
      /* Compute barycenter for each key */
      const bary = new Map();
      for (const k of keys) {
        const ps = (parents.get(k) || []).filter(p => prevIndex.has(p));
        if (ps.length) {
          bary.set(k, ps.reduce((s, p) => s + prevIndex.get(p), 0) / ps.length);
        } else {
          bary.set(k, keys.indexOf(k));
        }
      }
      keys.sort((a, b) => (bary.get(a) || 0) - (bary.get(b) || 0));
    }
  }

  return byLayer;
}

/**
 * Compute layout positions for flow steps.
 * Uses BFS-layered hierarchical layout with crossing minimization.
 * Applies any cached positions from prior drag interactions.
 * @param {Array} steps
 * @param {string} groupKey — for position cache
 * @returns {{ nodes: Array, edges: Array, width: number, height: number }}
 */
export function computeLayout(steps, groupKey) {
  const nodes = [];
  const edges = [];
  const positioned = new Map();

  /* Layer assignment + crossing minimization */
  const layerMap = assignLayers(steps);
  const orderedLayers = minimizeCrossings(layerMap, steps);

  /* Position each layer */
  const layerNums = [...orderedLayers.keys()].sort((a, b) => a - b);
  const stepByKey = new Map(steps.map(s => [s.step.toLowerCase().trim(), s]));

  const layerHeights = new Map();
  for (const layerIdx of layerNums) {
    const keys = orderedLayers.get(layerIdx);
    const maxH = Math.max(...keys.map(k => measureNode(stepByKey.get(k)).h), NODE_H);
    layerHeights.set(layerIdx, maxH);
  }

  let yCursor = LAYER_PADDING_Y;
  for (const layerIdx of layerNums) {
    const keys = orderedLayers.get(layerIdx);
    const y = yCursor;
    const sizes = keys.map(k => measureNode(stepByKey.get(k)));
    const layerWidth = sizes.reduce((sum, size) => sum + size.w, 0) + (keys.length - 1) * GAP_X;
    const startX = LAYER_PADDING_X + Math.max(0, (600 - layerWidth) / 2);
    let xCursor = startX;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const s = stepByKey.get(key);
      if (!s || positioned.has(key)) continue;
      const size = sizes[i];

      const autoX = xCursor;
      const autoY = y;
      xCursor += size.w + GAP_X;

      /* Use cached position if user dragged this node */
      const cached = getNodePos(`${groupKey}:${key}`);
      const x = cached ? cached.x : autoX;
      const yFinal = cached ? cached.y : autoY;

      const node = { ...s, x, y: yFinal, w: size.w, h: size.h, labelLines: size.labelLines, index: steps.indexOf(s), key };
      nodes.push(node);
      positioned.set(key, node);
    }
    yCursor += (layerHeights.get(layerIdx) || NODE_H) + GAP_Y;
  }

  /* Catch any steps not in the layer map (shouldn't happen, but safety) */
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const key = s.step.toLowerCase().trim();
    if (positioned.has(key)) continue;
    const cached = getNodePos(`${groupKey}:${key}`);
    const size = measureNode(s);
    const node = {
      ...s,
      x: cached ? cached.x : LAYER_PADDING_X,
      y: cached ? cached.y : LAYER_PADDING_Y + nodes.length * (NODE_H + GAP_Y),
      w: size.w, h: size.h, labelLines: size.labelLines, index: i, key,
    };
    nodes.push(node);
    positioned.set(key, node);
  }

  /* Build edges from "next" references */
  for (const node of nodes) {
    if (!node.next) continue;
    const targets = node.next.split(',').map(t => t.trim().toLowerCase());
    const conditions = node.condition ? node.condition.split(',').map(c => c.trim()) : [];
    for (let t = 0; t < targets.length; t++) {
      const targetNode = positioned.get(targets[t]);
      if (!targetNode) continue;
      edges.push({ from: node, to: targetNode, label: conditions[t] || '' });
    }
  }

  const maxX = Math.max(...nodes.map(n => n.x + n.w), 600);
  const maxY = Math.max(...nodes.map(n => n.y + n.h), 200);
  return { nodes, edges, width: maxX + 80, height: maxY + 60 };
}

/* ---------- Node SVG Rendering ---------- */

/**
 * Render an SVG node group using relative coordinates.
 * Positioned with transform; children at (0,0)–(w,h).
 * Includes an output port for edge reconnection.
 * @param {Object} node
 * @returns {SVGElement}
 */
export function renderNodeGroup(node) {
  const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;
  const g = svg('g', {
    class: `flow-node flow-node-${node.type}`,
    'data-key': node.key,
    transform: `translate(${node.x}, ${node.y})`,
  });

  /* Background shape */
  if (node.type === 'decision') {
    const cx = node.w / 2, cy = node.h / 2;
    const hw = node.w / 2, hh = node.h / 2;
    g.append(svg('polygon', {
      points: `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
  } else if (node.type === 'start' || node.type === 'end') {
    g.append(svg('rect', {
      x: 0, y: 0, width: node.w, height: node.h,
      rx: node.h / 2, ry: node.h / 2,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
  } else if (node.type === 'input' || node.type === 'output') {
    const skew = 15;
    g.append(svg('polygon', {
      points: `${skew},0 ${node.w},0 ${node.w - skew},${node.h} 0,${node.h}`,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
  } else if (node.type === 'subprocess') {
    g.append(svg('rect', {
      x: 0, y: 0, width: node.w, height: node.h, rx: 4, ry: 4,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
    g.append(svg('line', { x1: 10, y1: 0, x2: 10, y2: node.h, stroke: shape.color, 'stroke-width': 1.5 }));
    g.append(svg('line', { x1: node.w - 10, y1: 0, x2: node.w - 10, y2: node.h, stroke: shape.color, 'stroke-width': 1.5 }));
  } else if (node.type === 'delay') {
    const r = node.h / 2;
    g.append(svg('rect', {
      x: 0, y: 0, width: node.w - r, height: node.h,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
    g.append(svg('ellipse', {
      cx: node.w - r, cy: r, rx: r, ry: r,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
    }));
  } else {
    g.append(svg('rect', {
      x: 0, y: 0, width: node.w, height: node.h, rx: 6, ry: 6,
      fill: shape.color + '18', stroke: shape.color, 'stroke-width': 2,
      class: 'flow-node-shape',
    }));
  }

  /* Invisible hit area */
  g.append(svg('rect', {
    x: -6, y: -10, width: node.w + 12, height: node.h + 28,
    fill: 'transparent', class: 'flow-node-hit',
  }));

  /* Inline type badge */
  const badgeWidth = Math.max(54, shape.label.length * 6 + 24);
  const badgeGroup = svg('g', { class: 'flow-node-type-badge' });
  badgeGroup.append(svg('rect', {
    x: node.w / 2 - badgeWidth / 2, y: 8,
    width: badgeWidth, height: 18,
    rx: 9, ry: 9,
    class: 'flow-node-type-pill',
    fill: shape.color + '22',
    stroke: shape.color,
    'stroke-width': 1,
  }));
  const badgeText = svg('text', {
    x: node.w / 2, y: 21,
    'text-anchor': 'middle',
    class: 'flow-node-type-text',
    fill: shape.color,
  });
  badgeText.textContent = shape.label;
  badgeGroup.append(badgeText);
  g.append(badgeGroup);

  /* Wrapped label */
  const text = svg('text', {
    x: node.w / 2, y: node.h / 2 + (node.labelLines.length > 1 ? -3 : 4),
    'text-anchor': 'middle',
    class: 'flow-node-label',
  });
  const lines = node.labelLines?.length ? node.labelLines : wrapLabel(node.step, 18);
  const startDy = -((lines.length - 1) * LABEL_LINE_HEIGHT) / 2;
  lines.forEach((line, index) => {
    const tspan = svg('tspan', {
      x: node.w / 2,
      dy: index === 0 ? startDy : LABEL_LINE_HEIGHT,
      class: 'flow-node-label-line',
    });
    tspan.textContent = line;
    text.append(tspan);
  });
  g.append(text);

  /* Output port — bottom center */
  g.append(svg('circle', {
    cx: node.w / 2, cy: node.h + 8, r: 6,
    class: 'flow-port flow-port-out',
    fill: '#6366f1', stroke: '#fff', 'stroke-width': 2,
  }));

  const quick = svg('g', { class: 'flow-quick-add', transform: `translate(${node.w + 16}, ${node.h / 2})` });
  quick.append(svg('circle', { r: 10, class: 'flow-quick-add-circle' }));
  quick.append(svg('text', { y: 4, 'text-anchor': 'middle', class: 'flow-quick-add-text' }));
  quick.lastChild.textContent = '+';
  g.append(quick);

  return g;
}

/* ---------- Edge SVG Rendering ---------- */

/**
 * Render an SVG edge (arrow) between two nodes.
 * Uses absolute coordinates (nodes carry x/y in global space).
 * @param {Object} edge
 * @param {string} markerId
 * @returns {SVGElement}
 */
export function renderEdge(edge, markerId) {
  const g = svg('g', { class: 'flow-edge', 'data-from': edge.from.key, 'data-to': edge.to.key });

  const fromCX = edge.from.x + edge.from.w / 2;
  const fromCY = edge.from.y + edge.from.h / 2;
  const toCX = edge.to.x + edge.to.w / 2;
  const toCY = edge.to.y + edge.to.h / 2;

  let x1, y1, x2, y2;
  const dx = toCX - fromCX;
  const dy = toCY - fromCY;

  if (Math.abs(dy) > Math.abs(dx)) {
    x1 = fromCX; y1 = dy > 0 ? edge.from.y + edge.from.h : edge.from.y;
    x2 = toCX;   y2 = dy > 0 ? edge.to.y : edge.to.y + edge.to.h;
  } else {
    x1 = dx > 0 ? edge.from.x + edge.from.w : edge.from.x; y1 = fromCY;
    x2 = dx > 0 ? edge.to.x : edge.to.x + edge.to.w;       y2 = toCY;
  }

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const bend = Math.max(28, Math.min(90, Math.abs(y2 - y1) / 2));
  const c1y = y1 + (y2 >= y1 ? bend : -bend);
  const c2y = y2 - (y2 >= y1 ? bend : -bend);
  const d = `M${x1},${y1} C${x1},${c1y} ${x2},${c2y} ${x2},${y2}`;
  const path = svg('path', {
    d, fill: 'none', class: 'flow-edge-path', 'stroke-width': 2,
    'marker-end': `url(#${markerId})`,
  });
  g.append(path);

  if (edge.label) {
    const lx = midX;
    const ly = midY;
    const labelWidth = Math.max(44, edge.label.length * 7 + 18);
    g.append(svg('rect', {
      x: lx - labelWidth / 2, y: ly - 11, width: labelWidth, height: 22,
      rx: 11, ry: 11, class: 'flow-edge-label-bg',
    }));
    const label = svg('text', {
      x: lx, y: ly + 4, class: 'flow-edge-label',
      'text-anchor': 'middle',
    });
    label.textContent = edge.label;
    g.append(label);
  }

  return g;
}
