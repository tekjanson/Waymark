#!/usr/bin/env node
/**
 * Generates server/build-info.json with the current git hash and repo URL.
 * Run this BEFORE `docker build` so the values are baked into the image
 * (the .git directory is not copied into the container).
 *
 * Usage:  node scripts/build-info.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'server', 'build-info.json');

let hash = '';
let repo = '';

try {
  hash = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch { /* not a git repo */ }

try {
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  repo = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
} catch { /* no remote */ }

const info = { hash, repo, builtAt: new Date().toISOString() };

fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n');
console.log(`✅  build-info.json → ${hash || '(no hash)'} | ${repo || '(no repo)'}`);
