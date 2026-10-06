#!/usr/bin/env node
/* ============================================================
   analyze-vision-debug.mjs — Summarize captured vision failures
   ============================================================ */

import fs from 'fs';
import path from 'path';

const rootArg = process.argv[2] || 'generated/vision-debug';
const root = path.resolve(rootArg);

if (!fs.existsSync(root)) {
  console.error(`No debug directory found: ${root}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(root);
const jsonFiles = allFiles.filter((f) => f.endsWith('.json')).sort();

if (!jsonFiles.length) {
  console.error(`No JSON snapshots found under ${root}`);
  process.exit(1);
}

const stats = {
  total: 0,
  byReason: new Map(),
  byGesture: new Map(),
  noLandmarks: 0,
  shapeUnknown: 0,
  noLock: 0,
  locked: 0,
  avgConfidence: 0,
  confidenceCount: 0,
  noLockWithCandidates: 0,
  noLockCandidateCounts: [],
};

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

for (const file of jsonFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);

  stats.total += 1;

  const reason = data.reason || 'unknown';
  inc(stats.byReason, reason);

  const gesture = data.gesture || 'none';
  inc(stats.byGesture, gesture);

  if (reason === 'no_landmarks') stats.noLandmarks += 1;
  if (reason === 'shape_unknown') stats.shapeUnknown += 1;
  if (reason === 'no_lock') {
    stats.noLock += 1;
    const candidateCount = Number(data.candidateCount || 0);
    if (candidateCount > 0) stats.noLockWithCandidates += 1;
    stats.noLockCandidateCounts.push(candidateCount);
  }
  if (reason === 'locked') stats.locked += 1;

  if (typeof data.confidence === 'number') {
    stats.avgConfidence += data.confidence;
    stats.confidenceCount += 1;
  }
}

const avgConfidence = stats.confidenceCount ? (stats.avgConfidence / stats.confidenceCount) : 0;

function mapToLines(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

console.log('=== Vision Debug Analysis ===');
console.log(`Snapshots: ${stats.total}`);
console.log(`Avg confidence (where present): ${avgConfidence.toFixed(3)}`);
console.log('');
console.log('By reason:');
console.log(mapToLines(stats.byReason));
console.log('');
console.log('By gesture:');
console.log(mapToLines(stats.byGesture));
console.log('');
console.log(`No landmarks: ${stats.noLandmarks}`);
console.log(`Shape unknown: ${stats.shapeUnknown}`);
console.log(`No lock: ${stats.noLock}`);
console.log(`Locked: ${stats.locked}`);
console.log(`No-lock frames with object candidates present: ${stats.noLockWithCandidates}`);
console.log(`Avg candidate count on no-lock frames: ${avg(stats.noLockCandidateCounts).toFixed(2)}`);

const lockRate = stats.total ? (stats.locked / stats.total) * 100 : 0;
console.log(`Lock rate across captured frames: ${lockRate.toFixed(2)}%`);
