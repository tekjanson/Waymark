/* ============================================================
   templates/flow.js — Interactive Flow Diagram Template

   Features: draggable SVG nodes, click-to-edit inspector,
   edge reconnection via port dragging, type badges,
   conditional branches, collapsible step table.
   Each row represents a step; the Flow column groups steps
   into separate diagrams (§4.7 row-per-item grouping).
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, buildAddRowForm } from './shared.js';

/* ---------- Constants ---------- */

const NODE_SHAPES = {
  start:      { label: 'Start',       color: '#16a34a', icon: '▶' },
  end:        { label: 'End',         color: '#dc2626', icon: '⏹' },
  process:    { label: 'Process',     color: '#2563eb', icon: '⬜' },
  decision:   { label: 'Decision',    color: '#d97706', icon: '◆' },
  input:      { label: 'Input',       color: '#7c3aed', icon: '▱' },
  output:     { label: 'Output',      color: '#0891b2', icon: '▱' },
  delay:      { label: 'Delay',       color: '#94a3b8', icon: '⏳' },
  subprocess: { label: 'Sub-process', color: '#4f46e5', icon: '⊞' },
};

const DEFAULT_TYPE = 'process';
const DRAG_THRESHOLD = 5;
const NODE_W = 180;
const NODE_H = 56;

/* ---------- Module state ---------- */

/** Cached node positions across renders (key = "groupName:stepKey") */
let _nodePositions = new Map();

/* ---------- Helpers ---------- */

/**
 * Normalise a type string to a known node shape key.
 * @param {string} raw
 * @returns {string}
 */
function normaliseType(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (NODE_SHAPES[v]) return v;
  if (/^(begin|trigger|entry)/.test(v)) return 'start';
  if (/^(stop|finish|exit|terminal)/.test(v)) return 'end';
  if (/^(decision|branch|condition|if|switch|gate)/.test(v)) return 'decision';
  if (/^(input|read|receive|data.?in)/.test(v)) return 'input';
  if (/^(output|write|send|display|print|data.?out)/.test(v)) return 'output';
  if (/^(wait|delay|pause|sleep|timer)/.test(v)) return 'delay';
  if (/^(sub|call|routine|module)/.test(v)) return 'subprocess';
  if (/^(action|step|task|process|do|execute|run)/.test(v)) return 'process';
  return DEFAULT_TYPE;
}

/**
 * Build a lookup map from step labels to their parsed data.
 * @param {Array} steps
 * @returns {Map<string, Object>}
 */
function buildStepLookup(steps) {
  const map = new Map();
  for (const s of steps) {
    if (s.step) map.set(s.step.toLowerCase().trim(), s);
  }
  return map;
}

/**
 * Parse flat rows into flow groups using §4.7 contiguous grouping.
 * @param {string[][]} rows
 * @param {Object} cols
 * @returns {Array<{name: string, steps: Array}>}
 */
function parseFlowGroups(rows, cols) {
  const groups = [];
  let current = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const flowName = cell(row, cols.flow);
    const stepName = cell(row, cols.step);

    if (flowName) {
      current = { name: flowName, steps: [] };
      groups.push(current);
    }

    if (!current) {
      current = { name: 'Flow', steps: [] };
      groups.push(current);
    }

    if (stepName || flowName) {
      current.steps.push({
        row,
        idx: i,
        step: stepName || flowName,
        type: normaliseType(cell(row, cols.type)),
        next: cell(row, cols.next),
        condition: cell(row, cols.condition),
        notes: cell(row, cols.notes),
      });
    }
  }

  return groups;
}

/* ---------- SVG Rendering Helpers ---------- */

/**
 * Create an SVG element with the given tag and attributes.
 * @param {string} tag
 * @param {Object} attrs
 * @returns {SVGElement}
 */
function svg(tag, attrs = {}) {
  const elem = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    elem.setAttribute(k, String(v));
  }
  return elem;
}

/**
 * Convert client (screen) coordinates to SVG user-space coordinates.
 * @param {SVGSVGElement} svgEl
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ x: number, y: number }}
 */
function clientToSVG(svgEl, clientX, clientY) {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

/**
 * Check whether an SVG-space point is inside a node bounding box.
 * @param {{ x: number, y: number }} pt
 * @param {Object} node
 * @returns {boolean}
 */
function isPointInNode(pt, node) {
  return pt.x >= node.x && pt.x <= node.x + node.w &&
         pt.y >= node.y - 12 && pt.y <= node.y + node.h + 12;
}

/* ---------- Layout ---------- */

/**
 * Compute layout positions for flow steps.
 * Arranges nodes top-to-bottom; decisions branch left/right.
 * Applies any cached positions from prior drag interactions.
 * @param {Array} steps
 * @param {string} groupKey — for position cache
 * @returns {{ nodes: Array, edges: Array, width: number, height: number }}
 */
function computeLayout(steps, groupKey) {
  const GAP_X = 60;
  const GAP_Y = 70;
  const DECISION_BRANCH_OFFSET = NODE_W + GAP_X;

  const nodes = [];
  const edges = [];
  const lookup = buildStepLookup(steps);
  const positioned = new Map();

  let nextY = 30;
  const centerX = 300;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const key = s.step.toLowerCase().trim();
    if (positioned.has(key)) continue;

    /* Use cached position if available */
    const cached = _nodePositions.get(`${groupKey}:${key}`);
    const x = cached ? cached.x : (centerX - NODE_W / 2);
    const y = cached ? cached.y : nextY;
    nextY = Math.max(nextY, y) + NODE_H + GAP_Y;

    const node = { ...s, x, y, w: NODE_W, h: NODE_H, index: i, key };
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

  /* Reposition decision branches for better layout (only auto-positioned) */
  for (const node of nodes) {
    if (node.type !== 'decision') continue;
    if (_nodePositions.has(`${groupKey}:${node.key}`)) continue;
    const outEdges = edges.filter(e => e.from === node);
    if (outEdges.length >= 2) {
      const second = outEdges[1].to;
      if (!_nodePositions.has(`${groupKey}:${second.key}`) && Math.abs(second.x - node.x) < 10) {
        second.x = node.x + DECISION_BRANCH_OFFSET;
      }
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
function renderNodeGroup(node) {
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
function renderEdge(edge, markerId) {
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

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Flow Diagram',
  icon: '🔀',
  color: '#6366f1',
  priority: 20,
  itemNoun: 'Step',

  detect(lower) {
    const hasFlow = lower.some(h => /^(flow|diagram|process|workflow|pipeline|flowchart)/.test(h));
    const hasStep = lower.some(h => /^(step|node|block|stage|action|task|activity)/.test(h));
    const hasType = lower.some(h => /^(type|shape|kind|node.?type)/.test(h));
    const hasNext = lower.some(h => /^(next|to|target|connects?.?to|goto|arrow|transition|leads?.?to)/.test(h));
    return hasFlow && hasStep && (hasType || hasNext);
  },

  columns(lower) {
    const cols = { flow: -1, step: -1, type: -1, next: -1, condition: -1, notes: -1 };
    const used = () => Object.values(cols).filter(v => v >= 0);
    cols.flow = lower.findIndex(h => /^(flow|diagram|process|workflow|pipeline|flowchart)/.test(h));
    cols.step = lower.findIndex((h, i) => i !== cols.flow && /^(step|node|block|stage|action|task|activity)/.test(h));
    cols.type = lower.findIndex((h, i) => !used().includes(i) && /^(type|shape|kind|node.?type)/.test(h));
    cols.next = lower.findIndex((h, i) => !used().includes(i) && /^(next|to|target|connects?.?to|goto|arrow|transition|leads?.?to)/.test(h));
    cols.condition = lower.findIndex((h, i) => !used().includes(i) && /^(condition|label|branch|when|if|edge.?label)/.test(h));
    cols.notes = lower.findIndex((h, i) => !used().includes(i) && /^(notes?|comment|detail|description|info)/.test(h));
    if (cols.step === -1 && cols.flow >= 0) cols.step = cols.flow;
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'step',      label: 'Step',      colIndex: cols.step,      type: 'text',   placeholder: 'Step label',  required: true },
      { role: 'type',      label: 'Type',      colIndex: cols.type,      type: 'select', options: Object.keys(NODE_SHAPES) },
      { role: 'next',      label: 'Next',      colIndex: cols.next,      type: 'text',   placeholder: 'Next step(s), comma-separated' },
      { role: 'condition', label: 'Condition',  colIndex: cols.condition, type: 'text',   placeholder: 'Edge label (e.g. Yes, No)' },
      { role: 'notes',     label: 'Notes',      colIndex: cols.notes,     type: 'text',   placeholder: 'Additional notes' },
    ];
  },

  /* --------------------------------------------------------
     render() — Interactive flow diagram canvas
     -------------------------------------------------------- */
  render(container, rows, cols) {
    container.innerHTML = '';
    const groups = parseFlowGroups(rows, cols);

    if (groups.length === 0) {
      container.append(el('div', { className: 'flow-empty' }, [
        'No flow steps found. Add steps with Step, Type, and Next columns.',
      ]));
      return;
    }

    for (const group of groups) {
      const groupKey = group.name;
      const section = el('div', { className: 'flow-group' });

      /* ---------- Group header ---------- */
      section.append(el('div', { className: 'flow-group-header' }, [
        el('span', { className: 'flow-group-icon' }, ['🔀']),
        el('h3', { className: 'flow-group-title' }, [group.name]),
        el('span', { className: 'flow-group-count' }, [`${group.steps.length} steps`]),
      ]));

      /* ---------- Layout ---------- */
      const layout = computeLayout(group.steps, groupKey);

      /* ---------- Build interactive SVG ---------- */
      const markerId = `flow-arrow-${Math.random().toString(36).slice(2, 8)}`;
      const diagramWrap = el('div', { className: 'flow-diagram-wrap flow-canvas' });

      const svgEl = svg('svg', {
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        class: 'flow-svg',
        width: '100%',
        height: layout.height,
      });

      /* Defs — arrowhead markers */
      const defs = svg('defs');
      const marker = svg('marker', {
        id: markerId, viewBox: '0 0 10 10',
        refX: 9, refY: 5, markerWidth: 6, markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' }));
      defs.append(marker);

      const markerDash = svg('marker', {
        id: markerId + '-dash', viewBox: '0 0 10 10',
        refX: 9, refY: 5, markerWidth: 6, markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      markerDash.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#6366f1' }));
      defs.append(markerDash);

      /* Grid background */
      const gridId = markerId + '-grid';
      const gridPat = svg('pattern', { id: gridId, width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
      gridPat.append(svg('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: '#e5e7eb', 'stroke-width': 0.5 }));
      defs.append(gridPat);

      svgEl.append(defs);
      svgEl.append(svg('rect', { width: '100%', height: '100%', fill: `url(#${gridId})`, class: 'flow-grid-bg' }));

      /* Edges container */
      const edgesGroup = svg('g', { class: 'flow-edges-group' });
      svgEl.append(edgesGroup);

      function rerenderEdges() {
        while (edgesGroup.firstChild) edgesGroup.removeChild(edgesGroup.firstChild);
        for (const edge of layout.edges) {
          edgesGroup.append(renderEdge(edge, markerId));
        }
      }
      rerenderEdges();

      /* Nodes container */
      const nodesGroup = svg('g', { class: 'flow-nodes-group' });
      const nodeElMap = new Map();

      for (const node of layout.nodes) {
        const nodeG = renderNodeGroup(node);
        nodeElMap.set(node.key, nodeG);
        nodesGroup.append(nodeG);
      }
      svgEl.append(nodesGroup);

      /* Temporary edge (shown during port drag) */
      const tempEdge = svg('line', {
        class: 'flow-temp-edge',
        visibility: 'hidden',
        stroke: '#6366f1', 'stroke-width': 2,
        'stroke-dasharray': '6,4',
        'marker-end': `url(#${markerId}-dash)`,
      });
      svgEl.append(tempEdge);

      diagramWrap.append(svgEl);

      /* Canvas hint */
      diagramWrap.append(el('div', { className: 'flow-canvas-hint' }, [
        'Drag nodes to reposition \u2022 Click to inspect \u2022 Drag from \u25CF port to connect',
      ]));

      section.append(diagramWrap);

      /* ---------- Inspector panel ---------- */
      const inspector = el('div', { className: 'flow-inspector hidden' });
      section.append(inspector);

      /* ---------- Interaction state ---------- */
      let selectedNode = null;
      let dragState = null;
      let connectState = null;

      /* ---------- Node selection ---------- */

      function selectNode(node) {
        if (selectedNode) {
          nodeElMap.get(selectedNode.key)?.classList.remove('flow-node-selected');
        }
        selectedNode = node;
        nodeElMap.get(node.key)?.classList.add('flow-node-selected');
        showInspector(node);
      }

      function deselectNode() {
        if (selectedNode) {
          nodeElMap.get(selectedNode.key)?.classList.remove('flow-node-selected');
          selectedNode = null;
        }
        inspector.classList.add('hidden');
        inspector.innerHTML = '';
      }

      /* ---------- Inspector rendering ---------- */

      function showInspector(node) {
        inspector.classList.remove('hidden');
        inspector.innerHTML = '';

        const rowIdx = node.idx + 1;
        const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;

        /* Header */
        inspector.append(el('div', { className: 'flow-inspector-header' }, [
          el('span', {
            className: `flow-type-badge flow-type-${node.type}`,
            style: `--flow-type-color: ${shape.color}`,
          }, [`${shape.icon} ${shape.label}`]),
          el('h4', { className: 'flow-inspector-title' }, [node.step]),
          el('button', {
            className: 'flow-inspector-close',
            on: { click: deselectNode },
          }, ['\u2715']),
        ]));

        /* Fields grid */
        const fields = el('div', { className: 'flow-inspector-fields' });

        fields.append(makeField('Step Name', node.step, rowIdx, cols.step));

        /* Type dropdown */
        const typeField = el('div', { className: 'flow-inspector-field' });
        typeField.append(el('label', { className: 'flow-inspector-label' }, ['Type']));
        const typeSelect = document.createElement('select');
        typeSelect.className = 'flow-inspector-select';
        for (const [key, info] of Object.entries(NODE_SHAPES)) {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = `${info.icon} ${info.label}`;
          if (key === node.type) opt.selected = true;
          typeSelect.append(opt);
        }
        typeSelect.addEventListener('change', () => {
          emitEdit(rowIdx, cols.type, typeSelect.value);
        });
        typeField.append(typeSelect);
        fields.append(typeField);

        const otherSteps = group.steps.filter(s => s.step !== node.step).map(s => s.step);
        fields.append(makeField('Next', node.next, rowIdx, cols.next, otherSteps));
        fields.append(makeField('Condition', node.condition, rowIdx, cols.condition));
        fields.append(makeField('Notes', node.notes, rowIdx, cols.notes));
        inspector.append(fields);

        /* Disconnect button */
        if (node.next) {
          inspector.append(el('button', {
            className: 'flow-inspector-action',
            on: { click() {
              emitEdit(rowIdx, cols.next, '');
              node.next = '';
              layout.edges = layout.edges.filter(e => e.from !== node);
              rerenderEdges();
              showInspector(node);
            }},
          }, ['\u2298 Remove all connections']));
        }
      }

      /** Build a labelled inspector text field. */
      function makeField(label, value, rowIdx, colIdx, suggestions) {
        const field = el('div', { className: 'flow-inspector-field' });
        field.append(el('label', { className: 'flow-inspector-label' }, [label]));
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'flow-inspector-input';
        input.value = value || '';
        input.placeholder = `Enter ${label.toLowerCase()}\u2026`;

        let dropdown = null;
        let comboOptions = [];

        if (suggestions && suggestions.length) {
          /* Custom combo dropdown instead of native datalist */
          const seen = new Set();
          for (const s of suggestions) {
            if (!s || seen.has(s)) continue;
            seen.add(s);
            comboOptions.push(s);
          }

          field.classList.add('flow-inspector-combo');
          input.classList.add('flow-inspector-combo-input');

          const arrow = el('button', {
            type: 'button',
            className: 'flow-inspector-combo-arrow',
            tabindex: '-1',
          }, ['\u25BE']);

          dropdown = el('div', { className: 'flow-inspector-combo-dropdown hidden' });

          function buildList(filter) {
            dropdown.innerHTML = '';
            const lower = (filter || '').toLowerCase();
            let count = 0;
            for (const opt of comboOptions) {
              if (lower && !opt.toLowerCase().includes(lower)) continue;
              const item = el('div', { className: 'flow-inspector-combo-option' }, [opt]);
              item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = opt;
                commit();
              });
              dropdown.append(item);
              count++;
            }
            if (count === 0 && filter) {
              dropdown.append(el('div', { className: 'flow-inspector-combo-empty' }, [
                `"${filter}" (new)`,
              ]));
            }
          }

          function openDropdown() {
            buildList(input.value);
            dropdown.classList.remove('hidden');
          }

          function closeDropdown() {
            dropdown.classList.add('hidden');
          }

          input.addEventListener('focus', openDropdown);
          input.addEventListener('input', () => buildList(input.value));

          arrow.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (dropdown.classList.contains('hidden')) {
              openDropdown();
              input.focus();
            } else {
              closeDropdown();
            }
          });

          const wrap = el('div', { className: 'flow-inspector-combo-wrap' });
          wrap.append(input, arrow, dropdown);
          field.append(wrap);
        } else {
          field.append(input);
        }

        let done = false;
        function commit() {
          if (done) return;
          done = true;
          if (dropdown) dropdown.classList.add('hidden');
          const v = input.value.trim();
          if (v !== (value || '')) emitEdit(rowIdx, colIdx, v);
        }
        if (dropdown) {
          /* Combo field — delay so mousedown on option fires first */
          input.addEventListener('blur', () => setTimeout(commit, 150));
        } else {
          /* Plain field — commit immediately */
          input.addEventListener('blur', commit);
        }
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') {
            e.preventDefault();
            input.value = value || '';
            done = true;
            if (dropdown) dropdown.classList.add('hidden');
            input.blur();
          }
        });
        return field;
      }

      /* ---------- Node drag ---------- */

      function onNodeMouseDown(e, node) {
        if (e.button !== 0) return;
        if (e.target.closest('.flow-port')) return;
        const pt = clientToSVG(svgEl, e.clientX, e.clientY);
        dragState = { node, startX: pt.x, startY: pt.y, origX: node.x, origY: node.y, moved: false };
        e.preventDefault();
      }

      /* ---------- Port drag (edge reconnection) ---------- */

      function onPortMouseDown(e, node) {
        e.stopPropagation();
        e.preventDefault();
        connectState = { sourceNode: node };
        const portX = node.x + node.w / 2;
        const portY = node.y + node.h + 8;
        tempEdge.setAttribute('x1', portX);
        tempEdge.setAttribute('y1', portY);
        tempEdge.setAttribute('x2', portX);
        tempEdge.setAttribute('y2', portY);
        tempEdge.setAttribute('visibility', 'visible');
      }

      /* ---------- SVG-level mouse handling ---------- */

      function onSVGMouseMove(e) {
        const pt = clientToSVG(svgEl, e.clientX, e.clientY);

        if (dragState) {
          const ddx = pt.x - dragState.startX;
          const ddy = pt.y - dragState.startY;
          if (!dragState.moved && Math.hypot(ddx, ddy) > DRAG_THRESHOLD) {
            dragState.moved = true;
            nodeElMap.get(dragState.node.key)?.classList.add('flow-node-dragging');
            svgEl.classList.add('flow-svg-dragging');
          }
          if (dragState.moved) {
            const n = dragState.node;
            n.x = dragState.origX + ddx;
            n.y = dragState.origY + ddy;
            nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
            rerenderEdges();
          }
        }

        if (connectState) {
          tempEdge.setAttribute('x2', pt.x);
          tempEdge.setAttribute('y2', pt.y);
          for (const n of layout.nodes) {
            const nEl = nodeElMap.get(n.key);
            if (n !== connectState.sourceNode && isPointInNode(pt, n)) {
              nEl?.classList.add('flow-node-drop-target');
            } else {
              nEl?.classList.remove('flow-node-drop-target');
            }
          }
        }
      }

      function onSVGMouseUp(e) {
        if (dragState) {
          const n = dragState.node;
          nodeElMap.get(n.key)?.classList.remove('flow-node-dragging');
          svgEl.classList.remove('flow-svg-dragging');
          if (!dragState.moved) {
            selectNode(n);
          } else {
            _nodePositions.set(`${groupKey}:${n.key}`, { x: n.x, y: n.y });
          }
          dragState = null;
        }

        if (connectState) {
          tempEdge.setAttribute('visibility', 'hidden');
          const pt = clientToSVG(svgEl, e.clientX, e.clientY);
          let target = null;
          for (const n of layout.nodes) {
            nodeElMap.get(n.key)?.classList.remove('flow-node-drop-target');
            if (n !== connectState.sourceNode && isPointInNode(pt, n)) target = n;
          }
          if (target) {
            const src = connectState.sourceNode;
            const rowIdx = src.idx + 1;
            const existing = src.next;
            const newNext = (src.type === 'decision' && existing)
              ? existing + ',' + target.step
              : target.step;
            emitEdit(rowIdx, cols.next, newNext);
            src.next = newNext;
            layout.edges.push({ from: src, to: target, label: '' });
            rerenderEdges();
            if (selectedNode === src) showInspector(src);
          }
          connectState = null;
        }
      }

      /* Touch support */
      function onTouchStart(e) {
        const touch = e.touches[0];
        const pt = clientToSVG(svgEl, touch.clientX, touch.clientY);
        for (const node of layout.nodes) {
          if (isPointInNode(pt, node)) {
            dragState = { node, startX: pt.x, startY: pt.y, origX: node.x, origY: node.y, moved: false };
            e.preventDefault();
            return;
          }
        }
      }

      function onTouchMove(e) {
        if (!dragState) return;
        e.preventDefault();
        const touch = e.touches[0];
        const pt = clientToSVG(svgEl, touch.clientX, touch.clientY);
        const ddx = pt.x - dragState.startX;
        const ddy = pt.y - dragState.startY;
        if (!dragState.moved && Math.hypot(ddx, ddy) > DRAG_THRESHOLD) {
          dragState.moved = true;
          nodeElMap.get(dragState.node.key)?.classList.add('flow-node-dragging');
        }
        if (dragState.moved) {
          const n = dragState.node;
          n.x = dragState.origX + ddx;
          n.y = dragState.origY + ddy;
          nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
          rerenderEdges();
        }
      }

      function onTouchEnd() {
        if (!dragState) return;
        const n = dragState.node;
        nodeElMap.get(n.key)?.classList.remove('flow-node-dragging');
        if (!dragState.moved) {
          selectNode(n);
        } else {
          _nodePositions.set(`${groupKey}:${n.key}`, { x: n.x, y: n.y });
        }
        dragState = null;
      }

      /* Wire SVG events */
      svgEl.addEventListener('mousemove', onSVGMouseMove);
      svgEl.addEventListener('mouseup', onSVGMouseUp);
      svgEl.addEventListener('mouseleave', onSVGMouseUp);
      svgEl.addEventListener('touchstart', onTouchStart, { passive: false });
      svgEl.addEventListener('touchmove', onTouchMove, { passive: false });
      svgEl.addEventListener('touchend', onTouchEnd);

      /* Click canvas background to deselect */
      svgEl.addEventListener('mousedown', (e) => {
        if (e.target === svgEl || (e.target.tagName === 'rect' && !e.target.closest('.flow-node'))) {
          deselectNode();
        }
      });

      /* Wire node + port events */
      for (const node of layout.nodes) {
        const nodeEl = nodeElMap.get(node.key);
        nodeEl.addEventListener('mousedown', (e) => onNodeMouseDown(e, node));
        const port = nodeEl.querySelector('.flow-port-out');
        if (port) {
          port.addEventListener('mousedown', (e) => onPortMouseDown(e, node));
        }
      }

      /* ---------- Collapsible step table ---------- */
      const tableSection = el('div', { className: 'flow-table-section' });
      const tableToggle = el('button', { className: 'flow-table-toggle' }, ['\u25B8 Show Step Table']);
      const table = el('div', { className: 'flow-step-table hidden' });

      const tableHeader = el('div', { className: 'flow-step-row flow-step-header-row' }, [
        el('span', { className: 'flow-step-cell flow-step-cell-drag' }),
        el('span', { className: 'flow-step-cell flow-step-cell-step' }, ['Step']),
        el('span', { className: 'flow-step-cell flow-step-cell-type' }, ['Type']),
        el('span', { className: 'flow-step-cell flow-step-cell-next' }, ['Next']),
        el('span', { className: 'flow-step-cell flow-step-cell-cond' }, ['Condition']),
        el('span', { className: 'flow-step-cell flow-step-cell-notes' }, ['Notes']),
      ]);
      table.append(tableHeader);

      let _tblDragEl = null;

      for (const s of group.steps) {
        const rowIdx = s.idx + 1;
        const shape = NODE_SHAPES[s.type] || NODE_SHAPES.process;

        const typeEl = el('span', {
          className: `flow-type-badge flow-type-${s.type}`,
          style: `--flow-type-color: ${shape.color}`,
        }, [`${shape.icon} ${shape.label}`]);

        const dragHandle = el('span', { className: 'flow-drag-handle', title: 'Drag to reorder' }, ['\u283F']);

        const stepRow = el('div', { className: 'flow-step-row', draggable: 'true' }, [
          el('span', { className: 'flow-step-cell flow-step-cell-drag' }, [dragHandle]),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-step' }, s.step, rowIdx, cols.step),
          el('span', { className: 'flow-step-cell flow-step-cell-type' }, [typeEl]),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-next' }, s.next, rowIdx, cols.next),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-cond' }, s.condition, rowIdx, cols.condition),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-notes' }, s.notes, rowIdx, cols.notes),
        ]);

        stepRow.addEventListener('dragstart', (e) => {
          _tblDragEl = stepRow;
          stepRow.classList.add('flow-step-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(rowIdx));
        });
        stepRow.addEventListener('dragend', () => {
          stepRow.classList.remove('flow-step-dragging');
          document.querySelectorAll('.flow-step-dragover').forEach(r => r.classList.remove('flow-step-dragover'));
          _tblDragEl = null;
        });
        stepRow.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (_tblDragEl && _tblDragEl !== stepRow) stepRow.classList.add('flow-step-dragover');
        });
        stepRow.addEventListener('dragleave', () => stepRow.classList.remove('flow-step-dragover'));
        stepRow.addEventListener('drop', (e) => {
          e.preventDefault();
          stepRow.classList.remove('flow-step-dragover');
          if (_tblDragEl && _tblDragEl !== stepRow) {
            const rect = stepRow.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
              stepRow.parentNode.insertBefore(_tblDragEl, stepRow);
            } else {
              stepRow.parentNode.insertBefore(_tblDragEl, stepRow.nextSibling);
            }
          }
          _tblDragEl = null;
        });

        table.append(stepRow);
      }

      tableToggle.addEventListener('click', () => {
        const nowHidden = table.classList.toggle('hidden');
        tableToggle.textContent = nowHidden ? '\u25B8 Show Step Table' : '\u25BE Hide Step Table';
      });

      tableSection.append(tableToggle, table);
      section.append(tableSection);

      container.append(section);
    }
  },
};

registerTemplate('flow', definition);
export default definition;
