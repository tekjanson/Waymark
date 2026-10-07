/**
 * scripts/visual-qc.mjs — Visual quality-check harness for the G2 drawing pipeline.
 *
 * Why this exists
 * ───────────────
 * The EvenHub simulator's glasses framebuffer does not composite under headless
 * Xvfb, and the phone app has no dev console, so drawing bugs (like strokes
 * being deleted when they cross a quadrant boundary) were invisible to tests.
 *
 * What it does
 * ────────────
 *   1. Starts the Vite dev server on a fixed port.
 *   2. Launches headless Chrome and loads the real app.
 *   3. Injects a MOCK bridge into the app's G2Bridge singleton. The mock does
 *      exactly what the glasses do: it takes each tile PNG the app sends and
 *      draws it at that tile's on-screen position into a 576×288 framebuffer.
 *      This reconstructs *pixel-for-pixel what the glasses would display*.
 *   4. Runs a series of drawing scenarios, snapshots the framebuffer to PNG
 *      files under test-output/visual-qc/, and asserts on pixel content
 *      (e.g. "a stroke that crosses all four quadrants leaves ink in each").
 *
 * Run:  npm run qc:visual
 * Snapshots: test-output/visual-qc/*.png  (open them to eyeball the render)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output', 'visual-qc');

const PORT = 5178;
const CDP_PORT = 9224;
const APP_URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
];

// ── small helpers ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome/Chromium found in ' + CHROME_CANDIDATES.join(', '));
}

function getJSON(pathname) {
  return new Promise((res, rej) => {
    http.get(`http://localhost:${CDP_PORT}${pathname}`, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((res) => {
      http.get(url, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false));
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

// ── CDP client ────────────────────────────────────────────────────────────────

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = {}; this.logs = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const cdp = new CDP(ws);
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id && cdp.pending[msg.id]) { cdp.pending[msg.id](msg); delete cdp.pending[msg.id]; }
      if (msg.method === 'Runtime.consoleAPICalled') {
        cdp.logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    await new Promise((res) => ws.on('open', res));
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending[id] = (msg) => res(msg.result);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r && r.exceptionDetails) {
      throw new Error('Page eval error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  }
}

// ── the in-page test program (runs inside the app) ────────────────────────────
//
// Injects a mock bridge that reconstructs the glasses framebuffer, runs the
// drawing scenarios, and returns results + base64 PNG snapshots.
const PAGE_PROGRAM = `
(async () => {
  const W = 576, H = 288, TW = 288, TH = 144;
  const mod = await import('/src/g2Bridge.js');
  const g2 = mod.getG2Bridge();

  // Framebuffer that mimics the glasses screen
  const fb = document.createElement('canvas'); fb.width = W; fb.height = H;
  const fbx = fb.getContext('2d', { willReadFrequently: true });
  fbx.fillStyle = '#000'; fbx.fillRect(0, 0, W, H);

  const tilePos = {}; // containerID -> {x,y,w,h}
  const counters = { total: 0, perTile: {} };

  const mockBridge = {
    createStartUpPageContainer: async (page) => {
      const imgs = page.imageObject || [];
      for (const im of imgs) {
        tilePos[im.containerID] = { x: im.xPosition, y: im.yPosition, w: im.width, h: im.height };
      }
      return 0;
    },
    textContainerUpgrade: async () => true,
    updateImageRawData: async (u) => {
      const bytes = u.imageData instanceof Uint8Array ? u.imageData : new Uint8Array(u.imageData);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const p = tilePos[u.containerID];
      if (p) fbx.drawImage(bmp, p.x, p.y);
      counters.total++;
      counters.perTile[u.containerID] = (counters.perTile[u.containerID] || 0) + 1;
      return 'success';
    },
  };

  await g2.init(mockBridge);

  // ── helpers ────────────────────────────────────────────────────────────────
  const tiles = {
    TL: { x: 0,   y: 0,   id: 3 },
    TR: { x: TW,  y: 0,   id: 4 },
    BL: { x: 0,   y: TH,  id: 5 },
    BR: { x: TW,  y: TH,  id: 6 },
  };
  function ink(qx, qy) {
    // count bright pixels in the quadrant at (qx,qy) size TWxTH
    const d = fbx.getImageData(qx, qy, TW, TH).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 100) n++;
    return n;
  }
  const quadInk = () => ({
    TL: ink(tiles.TL.x, tiles.TL.y),
    TR: ink(tiles.TR.x, tiles.TR.y),
    BL: ink(tiles.BL.x, tiles.BL.y),
    BR: ink(tiles.BR.x, tiles.BR.y),
  });
  const snap = () => fb.toDataURL('image/png');

  const results = [];

  // ── Scenario 1: diagonal stroke crosses all 4 quadrants → ink in each ───────
  await g2.clearDrawing();
  {
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      g2.strokeTo(10 + t * (W - 20), 10 + t * (H - 20));
    }
    g2.endStroke();
    await g2.flushNow();
    const q = quadInk();
    const pass = q.TL > 0 && q.TR > 0 && q.BL > 0 && q.BR > 0;
    results.push({ name: 'diagonal-all-quadrants', pass, detail: q, snapshot: snap() });
  }

  // ── Scenario 2: two separate strokes persist (the reported delete bug) ──────
  await g2.clearDrawing();
  {
    // Stroke A entirely in TL
    g2.strokeTo(40, 40); g2.strokeTo(120, 110); g2.endStroke();
    await g2.flushNow();
    const afterA = quadInk();
    // Stroke B entirely in BR — must NOT delete A
    g2.strokeTo(400, 200); g2.strokeTo(540, 270); g2.endStroke();
    await g2.flushNow();
    const afterB = quadInk();
    const pass = afterB.TL > 0 && afterB.BR > 0 && afterB.TL >= afterA.TL * 0.9;
    results.push({
      name: 'two-strokes-persist', pass,
      detail: { afterA, afterB }, snapshot: snap(),
    });
  }

  // ── Scenario 3: send efficiency — a single-quadrant stroke sends only 1 tile ─
  await g2.clearDrawing();
  {
    counters.total = 0; counters.perTile = {};
    for (let i = 0; i <= 10; i++) g2.strokeTo(30 + i * 5, 40); // all within TL
    g2.endStroke();
    await g2.flushNow();
    const tilesSent = Object.keys(counters.perTile).map(Number);
    const onlyTL = tilesSent.length === 1 && tilesSent[0] === tiles.TL.id;
    results.push({
      name: 'single-quadrant-efficiency', pass: onlyTL,
      detail: { tilesSent, totalSends: counters.total }, snapshot: snap(),
    });
  }

  // ── Scenario 4: persistence within a quadrant (old ink stays) ───────────────
  await g2.clearDrawing();
  {
    g2.strokeTo(100, 70); g2.endStroke(); await g2.flushNow();
    const ink1 = ink(tiles.TL.x, tiles.TL.y);
    g2.strokeTo(180, 70); g2.endStroke(); await g2.flushNow();
    const ink2 = ink(tiles.TL.x, tiles.TL.y);
    const pass = ink2 > ink1; // both dots present → accumulation
    results.push({ name: 'accumulates-within-quadrant', pass, detail: { ink1, ink2 }, snapshot: snap() });
  }

  // ── Bridge payload scenarios — the REAL data-push path to the glasses ───────
  // Drives the same renderBridgePayload() the live polling loop uses, with the
  // exact payload shape the Waymark Android app publishes on localhost:8787.
  const bridge = await import('/src/bridgeRender.js');
  async function renderPayload(name, payload) {
    g2.resetHud();                         // defeat the smoothing dedup for the test
    await bridge.renderBridgePayload(g2, payload);
    const q = quadInk();
    const total = q.TL + q.TR + q.BL + q.BR;
    results.push({ name, pass: total > 40, detail: { total, ...q }, snapshot: snap() });
  }

  await renderPayload('bridge-identified-center', { state: 'identified', text: 'Keyboard', x: 0.5, y: 0.5 });
  await renderPayload('bridge-identified-corner', { state: 'identified', text: 'Coffee mug', x: 0.82, y: 0.30 });
  await renderPayload('bridge-identified-no-pos', { state: 'identified', text: 'Laptop' });
  await renderPayload('bridge-calibrate-center', { state: 'calibrate', text: 'Point at the center dot and hold', cx: 0.50, cy: 0.50, step: 1, steps: 5 });
  await renderPayload('bridge-calibrate-topleft', { state: 'calibrate', text: 'Point at the top-left dot and hold', cx: 0.22, cy: 0.28, step: 2, steps: 5 });
  await renderPayload('bridge-idle', { state: 'idle', text: 'Waiting for target' });
  await renderPayload('bridge-no-hand', { state: 'no-hand', text: 'No hand detected' });

  // ── Performance: BLE send efficiency (the smoothness guarantees) ────────────
  // counters.total counts real updateImageRawData (BLE) calls, now gated by
  // per-tile pixel diffing. These assert the pipeline never floods the link.
  async function sends(action) {
    const before = counters.total;
    await action();
    return counters.total - before;
  }

  // A stable scene costs ZERO sends even when we bypass the signature dedup —
  // this exercises the per-tile pixel diffing directly.
  g2.resetHud();
  await bridge.renderBridgePayload(g2, { state: 'identified', text: 'Keyboard', x: 0.5, y: 0.5 });
  const stable = await sends(async () => {
    g2.resetHud();
    await bridge.renderBridgePayload(g2, { state: 'identified', text: 'Keyboard', x: 0.5, y: 0.5 });
  });
  results.push({ name: 'perf-stable-zero-resend', pass: stable === 0, detail: { sends: stable }, snapshot: snap() });

  // Clearing is idempotent: the first clear sends the inked tiles, the second
  // sends nothing.
  g2.resetHud();
  await bridge.renderBridgePayload(g2, { state: 'identified', text: 'Mug', x: 0.80, y: 0.30 });
  const clear1 = await sends(() => g2.clearGlasses());
  const clear2 = await sends(() => g2.clearGlasses());
  results.push({ name: 'perf-clear-idempotent', pass: clear1 > 0 && clear2 === 0, detail: { clear1, clear2 }, snapshot: snap() });

  // Partial updates: changing only a centered label touches at most the tiles
  // the text covers — never floods all four every frame.
  await g2.clearGlasses();
  const idleSends = await sends(async () => { g2.resetHud(); await bridge.renderBridgePayload(g2, { state: 'idle', text: 'Waiting for target' }); });
  const labelSends = await sends(async () => { g2.resetHud(); await bridge.renderBridgePayload(g2, { state: 'idle', text: 'Totally different label' }); });
  results.push({ name: 'perf-partial-updates', pass: idleSends <= 2 && labelSends <= 2, detail: { idleSends, labelSends }, snapshot: snap() });

  return JSON.stringify({ results });
})()
`;

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromePath = findChrome();

  // 1) dev server — spawn the local vite binary directly (not via npx) and put
  //    it in its own process group so we can reliably kill the whole tree.
  const viteBin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  const vite = spawn(viteBin, ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  const serverUp = await waitForServer(APP_URL);
  if (!serverUp) { killTree(vite); throw new Error('dev server did not start'); }

  // 2) headless chrome (own process group too)
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`, APP_URL,
  ], { stdio: 'ignore', detached: true });

  let exitCode = 0;
  try {
    // 3) find page target
    let target = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await getJSON('/json');
        target = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'));
        if (target) break;
      } catch (_) {}
      await sleep(300);
    }
    if (!target) throw new Error('no Chrome page target');

    const cdp = await CDP.attach(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(1500); // let app boot

    // 4) run the in-page program
    const raw = await cdp.eval(PAGE_PROGRAM);
    const { results } = JSON.parse(raw);

    // 5) save snapshots + print report
    console.log('\n=== Visual QC ===\n');
    let allPass = true;
    for (const r of results) {
      const file = path.join(OUT_DIR, `${r.name}.png`);
      const b64 = r.snapshot.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      const mark = r.pass ? '✅ PASS' : '❌ FAIL';
      if (!r.pass) allPass = false;
      console.log(`${mark}  ${r.name}`);
      console.log(`        ${JSON.stringify(r.detail)}`);
      console.log(`        snapshot: ${path.relative(ROOT, file)}\n`);
    }

    // Surface relevant app console lines on failure
    if (!allPass) {
      const relevant = cdp.logs.filter((l) => /G2Bridge|error|Error|warn/i.test(l)).slice(0, 20);
      if (relevant.length) {
        console.log('--- app console ---');
        relevant.forEach((l) => console.log('  ', l));
      }
    }

    console.log(allPass ? '\nAll visual QC scenarios passed.\n' : '\nSome visual QC scenarios FAILED.\n');
    exitCode = allPass ? 0 : 1;
    cdp.ws.close();
  } finally {
    killTree(chrome);
    killTree(vite);
  }
  process.exit(exitCode);
}

/**
 * Kill a detached child and its whole process group (negative PID). This is
 * necessary because vite/chrome fork child processes that would otherwise be
 * orphaned if we only killed the direct child.
 */
function killTree(child) {
  if (!child || child.killed) return;
  try { process.kill(-child.pid, 'SIGKILL'); }   // negative pid = process group
  catch { try { child.kill('SIGKILL'); } catch (_) {} }
}

main().catch((err) => {
  console.error('visual-qc harness error:', err.message);
  process.exit(2);
});
