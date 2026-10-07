/**
 * copy-mediapipe.mjs — Restore MediaPipe Hands runtime assets into public/.
 *
 * The G2 camera-fallback path serves MediaPipe Hands from /mediapipe/hands/.
 * Those ~24MB of WASM + model binaries are a verbatim copy of the npm package,
 * so we keep them OUT of git (public/mediapipe/ is gitignored) and restore them
 * from node_modules here. Runs automatically on `npm install` (postinstall).
 */
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src  = resolve(here, '../node_modules/@mediapipe/hands');
const dest = resolve(here, '../public/mediapipe/hands');

if (!existsSync(src)) {
  console.warn('[copy-mediapipe] node_modules/@mediapipe/hands not found — run npm install first');
  process.exit(0);
}

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log('[copy-mediapipe] MediaPipe Hands assets restored to public/mediapipe/hands');
