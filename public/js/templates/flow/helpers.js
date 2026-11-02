import { svg, getRaw, setRaw } from '../shared.js';
/* ============================================================
   flow/helpers.js — Constants & pure helper functions

   Node shape definitions, SVG primitives, coordinate math,
   data parsing, and position cache for the Flow Diagram template.
   ============================================================ */

import { cell } from '../shared.js';

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

/* ---------- Position Cache ---------- */

const STORAGE_KEY = 'waymark:flow-positions';

/** Load all saved positions from localStorage */
function _loadPositions() {
  try { return JSON.parse(getRaw(STORAGE_KEY)) || {}; } catch { return {}; }
}

/** Cached node positions across renders (key = "groupName:stepKey") */
const _nodePositions = new Map(Object.entries(_loadPositions()));

/** Persist current positions to localStorage (debounced externally) */
let _saveTimer = null;
function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const obj = {};
    for (const [k, v] of _nodePositions) obj[k] = v;
    try { setRaw(STORAGE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
  }, 300);
}

/**
 * Get a cached node position.
 * @param {string} key
 * @returns {{ x: number, y: number } | undefined}
 */
function getNodePos(key) {
  return _nodePositions.get(key);
}

/**
 * Cache a node position after drag.
 * @param {string} key
 * @param {{ x: number, y: number }} pos
 */
function setNodePos(key, pos) {
  _nodePositions.set(key, pos);
  _scheduleSave();
}

/**
 * Clear all cached positions for a given group (for re-align).
 * @param {string} groupKey
 */
function clearGroupPositions(groupKey) {
  const prefix = groupKey + ':';
  for (const k of [..._nodePositions.keys()]) {
    if (k.startsWith(prefix)) _nodePositions.delete(k);
  }
  _scheduleSave();
}

/* ---------- Pure Functions ---------- */

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

/* ---------- SVG Primitives ---------- */

// svg imported from ../shared.js

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

export {
  DEFAULT_TYPE,
  DRAG_THRESHOLD,
  NODE_H,
  NODE_SHAPES,
  NODE_W,
  buildStepLookup,
  clearGroupPositions,
  clientToSVG,
  getNodePos,
  isPointInNode,
  normaliseType,
  parseFlowGroups,
  setNodePos,
  svg,
};
