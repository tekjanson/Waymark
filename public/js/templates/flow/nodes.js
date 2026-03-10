/* ============================================================
   flow/nodes.js — SVG node/edge rendering & layout computation

   Layered hierarchical layout algorithm + SVG rendering.
   BFS layer assignment, crossing minimization, and centered
   positioning within each layer.  Cached drag positions
   override auto-layout per node.
   ============================================================ */

import {
  NODE_SHAPES, NODE_W, NODE_H,
  buildStepLookup, getNodePos, svg,
} from './helpers.js';

/* ---------- Layout ---------- */

const GAP_X = 60;
const GAP_Y = 80;
const LAYER_PADDING_X = 40;
const LAYER_PADDING_Y = 30;

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

  for (const layerIdx of layerNums) {
    const keys = orderedLayers.get(layerIdx);
    const y = LAYER_PADDING_Y + layerIdx * (NODE_H + GAP_Y);
    const layerWidth = keys.length * NODE_W + (keys.length - 1) * GAP_X;
    const startX = LAYER_PADDING_X + Math.max(0, (600 - layerWidth) / 2);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const s = stepByKey.get(key);
      if (!s || positioned.has(key)) continue;

      const autoX = startX + i * (NODE_W + GAP_X);
      const autoY = y;

      /* Use cached position if user dragged this node */
      const cached = getNodePos(`${groupKey}:${key}`);
      const x = cached ? cached.x : autoX;
      const yFinal = cached ? cached.y : autoY;

      const node = { ...s, x, y: yFinal, w: NODE_W, h: NODE_H, index: steps.indexOf(s), key };
      nodes.push(node);
      positioned.set(key, node);
    }
  }

  /* Catch any steps not in the layer map (shouldn't happen, but safety) */
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const key = s.step.toLowerCase().trim();
    if (positioned.has(key)) continue;
    const cached = getNodePos(`${groupKey}:${key}`);
    const node = {
      ...s,
      x: cached ? cached.x : LAYER_PADDING_X,
      y: cached ? cached.y : LAYER_PADDING_Y + nodes.length * (NODE_H + GAP_Y),
      w: NODE_W, h: NODE_H, index: i, key,
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

  /* Label */
  const displayLabel = node.step.length > 22 ? node.step.slice(0, 20) + '\u2026' : node.step;
  const text = svg('text', {
    x: node.w / 2, y: node.h / 2 + 1,
    'text-anchor': 'middle', 'dominant-baseline': 'central',
    class: 'flow-node-label', fill: '#1e293b',
  });
  text.textContent = displayLabel;
  g.append(text);

  /* Type badge above */
  const badge = svg('text', {
    x: node.w / 2, y: -6,
    'text-anchor': 'middle', class: 'flow-node-type-badge', fill: shape.color,
  });
  badge.textContent = shape.label;
  g.append(badge);

  /* Output port — bottom center */
  g.append(svg('circle', {
    cx: node.w / 2, cy: node.h + 8, r: 6,
    class: 'flow-port flow-port-out',
    fill: '#6366f1', stroke: '#fff', 'stroke-width': 2,
  }));

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
  const g = svg('g', { class: 'flow-edge' });

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

  let path;
  if (Math.abs(x1 - x2) < 5) {
    path = svg('line', {
      x1, y1, x2, y2,
      stroke: '#94a3b8', 'stroke-width': 2,
      'marker-end': `url(#${markerId})`,
    });
  } else {
    const d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    path = svg('path', {
      d, fill: 'none', stroke: '#94a3b8', 'stroke-width': 2,
      'marker-end': `url(#${markerId})`,
    });
  }
  g.append(path);

  if (edge.label) {
    const lx = midX + 8;
    const ly = midY - 4;
    g.append(svg('rect', {
      x: lx - 2, y: ly - 10, width: edge.label.length * 7 + 8, height: 16,
      rx: 3, ry: 3, fill: '#fff', stroke: '#e2e8f0', 'stroke-width': 1,
    }));
    const label = svg('text', {
      x: lx + 2, y: ly + 2, class: 'flow-edge-label', fill: '#64748b',
    });
    label.textContent = edge.label;
    g.append(label);
  }

  return g;
}
