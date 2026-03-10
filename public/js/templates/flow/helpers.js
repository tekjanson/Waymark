/* ============================================================
   flow/helpers.js — Constants & pure helper functions

   Node shape definitions, SVG primitives, coordinate math,
   data parsing, and position cache for the Flow Diagram template.
   ============================================================ */

import { cell } from '../shared.js';

/* ---------- Constants ---------- */

export const NODE_SHAPES = {
  start:      { label: 'Start',       color: '#16a34a', icon: '▶' },
  end:        { label: 'End',         color: '#dc2626', icon: '⏹' },
  process:    { label: 'Process',     color: '#2563eb', icon: '⬜' },
  decision:   { label: 'Decision',    color: '#d97706', icon: '◆' },
  input:      { label: 'Input',       color: '#7c3aed', icon: '▱' },
  output:     { label: 'Output',      color: '#0891b2', icon: '▱' },
  delay:      { label: 'Delay',       color: '#94a3b8', icon: '⏳' },
  subprocess: { label: 'Sub-process', color: '#4f46e5', icon: '⊞' },
};

export const DEFAULT_TYPE = 'process';
export const DRAG_THRESHOLD = 5;
export const NODE_W = 180;
export const NODE_H = 56;

/* ---------- Position Cache ---------- */

const STORAGE_KEY = 'waymark:flow-positions';

/** Load all saved positions from localStorage */
function _loadPositions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
  }, 300);
}

/**
 * Get a cached node position.
 * @param {string} key
 * @returns {{ x: number, y: number } | undefined}
 */
export function getNodePos(key) {
  return _nodePositions.get(key);
}

/**
 * Cache a node position after drag.
 * @param {string} key
 * @param {{ x: number, y: number }} pos
 */
export function setNodePos(key, pos) {
  _nodePositions.set(key, pos);
  _scheduleSave();
}

/**
 * Clear all cached positions for a given group (for re-align).
 * @param {string} groupKey
 */
export function clearGroupPositions(groupKey) {
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
export function normaliseType(raw) {
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
export function buildStepLookup(steps) {
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
export function parseFlowGroups(rows, cols) {
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

/**
 * Create an SVG element with the given tag and attributes.
 * @param {string} tag
 * @param {Object} attrs
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}) {
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
export function clientToSVG(svgEl, clientX, clientY) {
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
export function isPointInNode(pt, node) {
  return pt.x >= node.x && pt.x <= node.x + node.w &&
         pt.y >= node.y - 12 && pt.y <= node.y + node.h + 12;
}
