#!/usr/bin/env node
/* ============================================================
   interaction-audit.js — Drift guard for equivalent UI behaviors

   WayMark implements the same user-facing behavior (e.g. "voice
   input") in more than one template, each with its own code path and
   DOM. Static style/lint gates do not catch when those equivalent
   surfaces drift apart — e.g. one surface degrades gracefully while
   another dead-ends on a toast.

   This audit encodes behavioral-parity rules so that class of bug is
   caught before merge. It is the in-repo reference for the external
   "drift-be-gone" (SpamApply1) harness.

   Rule: VOICE_GRACEFUL_DEGRADATION
   -------------------------------------------------------------------
   Any template UI module that gates a feature on a voice / media
   capture capability (isAudioRecordingSupported, SpeechRecognition,
   getUserMedia, startAIRecording) MUST also provide a non-capture
   fallback input (a typed text field or a known fallback function) so
   the feature never dead-ends when the capability is unavailable
   (insecure http context, denied permission, unsupported browser).

   Usage:
     node scripts/interaction-audit.js        # report + exit 1 on drift
     npm run audit:interactions
     make audit
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'public', 'js', 'templates');
const PUBLIC_JS_DIR = path.join(ROOT, 'public', 'js');

/* ---------- File discovery ---------- */

/** Recursively collect .js files under a directory. */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/* ---------- Rule: voice graceful degradation ---------- */

// Markers that mean "this module gates behavior on a capture capability".
const CAPABILITY_MARKERS = [
  /isAudioRecordingSupported\s*\(/,
  /\bSpeechRecognition\b/,
  /\bwebkitSpeechRecognition\b/,
  /getUserMedia\s*\(/,
  /startAIRecording\s*\(/,
  /startAudioRecording\s*\(/,
];

// Markers that mean "this module also offers voice-INTAKE UI" (as opposed to
// a real-time call surface, which is a different feature audited elsewhere).
const VOICE_UI_MARKERS = [
  /voice/i,
  /\bmic\b/i,
  /\uD83C\uDF99/,        // 🎙 studio microphone
  /Record/i,
];

// Markers that prove a non-capture fallback input exists.
const FALLBACK_MARKERS = [
  /type:\s*['"]text['"]/,        // an el('input', { type: 'text' }) fallback
  /showVoiceTranscriptInput/,    // kanban's typed fallback
  /analyzeVoiceText/,            // calorie's typed fallback analysis
  /voice-text/,                  // calorie-voice-text fallback field
  /voice-input/,                 // kanban-voice-input fallback field
];

// Helper/library modules that DEFINE capabilities for templates but render no
// voice UI of their own — excluded from the UI parity rule. Paths are relative
// to the templates dir so folder-layout templates ({key}/index.js) are NOT
// excluded (their logic lives in index.js and must still be audited).
const LIBRARY_RELPATHS = new Set(['shared.js', 'index.js']);

/** True for the top-level templates barrel + shared helpers, not {key}/index.js. */
function isLibraryFile(file) {
  const rel = path.relative(TEMPLATES_DIR, file);
  return LIBRARY_RELPATHS.has(rel);
}

// The dead-end anti-pattern: a capability guard whose only failure action is a
// toast followed by a return, with no fallback UI built in between.
const DEAD_END_GUARD =
  /if\s*\(\s*!\s*isAudioRecordingSupported\s*\(\)\s*\)\s*\{[^}]*showToast\([^}]*return;[^}]*\}/;

/**
 * Audit a single file against the voice-degradation rule.
 * @param {string} file absolute path
 * @returns {{file:string, violations:string[]}|null}
 */
function auditVoiceDegradation(file) {
  if (isLibraryFile(file)) return null;

  const src = fs.readFileSync(file, 'utf8');
  const usesCapability = CAPABILITY_MARKERS.some(re => re.test(src));
  if (!usesCapability) return null;

  const isVoiceUi = VOICE_UI_MARKERS.some(re => re.test(src));
  if (!isVoiceUi) return null; // e.g. a non-voice media surface

  const violations = [];
  const hasFallback = FALLBACK_MARKERS.some(re => re.test(src));
  if (!hasFallback) {
    violations.push(
      'voice/capture affordance has no typed fallback input — it will dead-end '
      + 'when the capability is unavailable (insecure context / denied mic / '
      + 'unsupported browser). Add a text fallback like kanban\'s '
      + 'showVoiceTranscriptInput or calorie\'s analyzeVoiceText.',
    );
  }
  if (DEAD_END_GUARD.test(src)) {
    violations.push(
      'capability guard dead-ends on showToast()+return with no fallback UI. '
      + 'Open the affordance anyway and offer a typed fallback.',
    );
  }
  return violations.length ? { file: path.relative(ROOT, file), violations } : null;
}

/* ---------- Rule: clipboard graceful degradation ---------- */

// Direct async-Clipboard calls throw a synchronous TypeError when
// navigator.clipboard is undefined (insecure http context) — a bare
// `.writeText(...).catch()` does NOT catch it. Templates must route through the
// shared copyToClipboard() helper, which falls back to execCommand('copy').
const DIRECT_CLIPBOARD = /navigator\s*\.\s*clipboard\s*\.\s*writeText\s*\(/;

/**
 * Audit a single file against the clipboard-degradation rule.
 * @param {string} file absolute path
 * @returns {{file:string, violations:string[]}|null}
 */
function auditClipboardDegradation(file) {
  if (isLibraryFile(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  if (!DIRECT_CLIPBOARD.test(src)) return null;
  return {
    file: path.relative(ROOT, file),
    violations: [
      'calls navigator.clipboard.writeText directly — this throws on insecure '
      + 'contexts and silently fails. Use the shared copyToClipboard() helper '
      + '(execCommand fallback) instead.',
    ],
  };
}

/* ---------- Rule: Google-API import boundary (AI_LAWS §1.4 / §1.5) ---------- */

// api-client.js is the SOLE gateway to Google APIs (§1.4); templates import only
// from shared.js (§1.5). A template that imports api-client.js / drive.js /
// sheets.js directly bypasses the gateway, which breaks the mock-mode + test
// isolation the whole suite depends on. shared.js is the one legitimate importer
// (it re-exports the `api` object + sheet helpers) and is exempt via isLibraryFile.
//
// storage.js is also re-exported by shared.js (getRaw/setRaw/removeRaw + prefs);
// templates must use those re-exports, not import storage.js directly (§1.5).
// camera-capture.js and encryption.js are likewise re-exported by shared.js.
const GATEWAY_IMPORT =
  /import\s+[^;'"]*?from\s+['"][^'"]*\/(api-client|drive|sheets|storage|camera-capture|encryption|social-widget)\.js['"]/;

// Documented, intentional exceptions where routing through shared.js is not
// possible. Each entry is a [templateRelPath, moduleName] pair.
//   - social/chat.js → social-widget.js: SocialChatWidget is a cross-cutting UI
//     widget whose module imports templates/social/helpers.js, which imports
//     shared.js — re-exporting it via shared.js would create a circular import.
// The arcade template's imports of its public/js/arcade/** game engine are a
// separate architectural subsystem (not a canonical shared.js gateway) and are
// intentionally NOT matched by GATEWAY_IMPORT.
const IMPORT_BOUNDARY_ALLOW = [
  ['public/js/templates/social/chat.js', 'social-widget.js'],
];

/**
 * Audit a single template file against the Google-API import boundary.
 * @param {string} file absolute path
 * @returns {{file:string, violations:string[]}|null}
 */
function auditImportBoundary(file) {
  if (isLibraryFile(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const match = src.match(GATEWAY_IMPORT);
  if (!match) return null;
  const moduleName = `${match[1]}.js`;
  const rel = path.relative(ROOT, file);
  if (IMPORT_BOUNDARY_ALLOW.some(([f, m]) => f === rel && m === moduleName)) {
    return null; // documented exception
  }
  return {
    file: rel,
    violations: [
      `imports ${moduleName} directly — templates must route canonical access `
      + 'through shared.js (which re-exports the `api` object, sheet helpers, '
      + 'storage getRaw/setRaw/removeRaw, camera + encryption helpers), never '
      + 'import these modules directly. This preserves mock mode and test '
      + 'isolation (AI_LAWS §1.4, §1.5). If a module genuinely cannot route '
      + 'through shared.js (e.g. a circular import), add it to '
      + 'IMPORT_BOUNDARY_ALLOW with a comment explaining why.',
    ],
  };
}

/* ---------- Rule: no dynamic innerHTML (AI_LAWS §3.4 / §12 — XSS) ---------- */

// Assigning a template literal that interpolates runtime values into innerHTML
// is an XSS vector (e.g. `innerHTML = `…${err.message}`` injects unescaped
// content). Static strings and `innerHTML = ''` clearing are fine; dynamic
// content must be built with el() + textContent. Scans all of public/js.
const DYNAMIC_INNERHTML = /\.innerHTML\s*=\s*`[^`]*\$\{/;

/** Collect .js files under public/js, skipping the third-party vendor tree. */
function collectPublicJsFiles() {
  return collectJsFiles(PUBLIC_JS_DIR).filter(
    f => !path.relative(PUBLIC_JS_DIR, f).split(path.sep).includes('vendor'),
  );
}

/**
 * Audit a file for dynamic innerHTML interpolation.
 * @param {string} file absolute path
 * @returns {{file:string, violations:string[]}|null}
 */
function auditDynamicInnerHtml(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!DYNAMIC_INNERHTML.test(src)) return null;
  return {
    file: path.relative(ROOT, file),
    violations: [
      'assigns a template literal with ${…} interpolation to innerHTML — an XSS '
      + 'vector for any runtime/user value. Build the node with el() and set '
      + 'text via textContent instead (AI_LAWS §3.4, §12).',
    ],
  };
}

/* ---------- Rule: Wayboard layout parity (no dead layout CSS) ---------- */

// The Wayboard ships a fixed, curated set of home layouts (mode-1 … mode-N,
// where N = LAYOUT_COUNT in wayboard.js). home-modes.css must style exactly
// those layouts — it must not carry CSS for retired layout numbers (which are
// remapped by resolveLayout) nor style reference-shell selectors that never
// render in the live Wayboard DOM. This guard was added after the Wayboard was
// rebuilt from 50 near-identical, desktop-only, dead-selector modes down to a
// curated, mobile-first set, to stop that cruft from creeping back.
const WAYBOARD_JS = path.join(PUBLIC_JS_DIR, 'wayboard.js');
const HOME_MODES_CSS = path.join(ROOT, 'public', 'css', 'home-modes.css');
// Selectors from the old "UX Studio" reference shell with no node in the live
// Wayboard DOM (see index.html #wayboard-root): styling them is dead CSS.
const DEAD_WAYBOARD_SELECTORS = ['aside.left-nav', 'header.app-header', '.viewport-box', '.search-bar', '.nav-item'];

/**
 * Audit home-modes.css against the curated layout catalogue in wayboard.js.
 * @returns {{file:string, violations:string[]}|null}
 */
function auditWayboardLayouts() {
  if (!fs.existsSync(WAYBOARD_JS) || !fs.existsSync(HOME_MODES_CSS)) return null;
  const js = fs.readFileSync(WAYBOARD_JS, 'utf8');
  const css = fs.readFileSync(HOME_MODES_CSS, 'utf8');
  const rel = path.relative(ROOT, HOME_MODES_CSS);
  const violations = [];

  const countMatch = js.match(/const\s+LAYOUT_COUNT\s*=\s*(\d+)/);
  const layoutCount = countMatch ? parseInt(countMatch[1], 10) : null;
  if (!layoutCount) {
    return { file: rel, violations: ['wayboard.js does not declare a numeric LAYOUT_COUNT — the layout catalogue is the source of truth for home-modes.css.'] };
  }

  // 1. No CSS for retired layout numbers (> LAYOUT_COUNT).
  const modeNums = new Set();
  for (const m of css.matchAll(/\.mode-(\d+)\b/g)) modeNums.add(parseInt(m[1], 10));
  const stale = [...modeNums].filter(n => n > layoutCount).sort((a, b) => a - b);
  if (stale.length) {
    violations.push(`references retired layout classes .mode-${stale.join(', .mode-')} beyond LAYOUT_COUNT (${layoutCount}). Retired layouts are remapped by resolveLayout() and must not carry their own CSS.`);
  }

  // 2. Every curated layout 2..N has a style block (mode-1 is the base shell).
  const missing = [];
  for (let n = 2; n <= layoutCount; n++) if (!modeNums.has(n)) missing.push(n);
  if (missing.length) {
    violations.push(`declares ${layoutCount} layouts but has no CSS for .mode-${missing.join(', .mode-')} — each curated layout must be visually distinct.`);
  }

  // 3. No dead reference-shell selectors (non-existent DOM, AI_LAWS §13).
  const dead = DEAD_WAYBOARD_SELECTORS.filter(sel => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(css));
  if (dead.length) {
    violations.push(`styles dead reference-shell selectors (${dead.join(', ')}) that never render in the live Wayboard DOM. Remove them (AI_LAWS §13 — dead CSS).`);
  }

  return violations.length ? { file: rel, violations } : null;
}

/* ---------- Rule: test hygiene (AI_LAWS §7.2) ---------- */

// Playwright specs must be flat: no describe() blocks, no beforeEach/afterEach/
// beforeAll/afterAll hooks (every test is independently isolated), no
// data-testid selectors, and no page.waitForTimeout() (use waitForSelector).
const E2E_DIR = path.join(ROOT, 'tests', 'e2e');
const TEST_HYGIENE_RULES = [
  { re: /\btest\s*\.\s*describe\s*\(/, msg: 'uses test.describe() — specs must be flat test() calls (no describe blocks).' },
  { re: /\btest\s*\.\s*(beforeEach|afterEach|beforeAll|afterAll)\s*\(/, msg: 'uses a test lifecycle hook — every test must be self-contained (no beforeEach/afterEach/beforeAll/afterAll); extract shared setup into a helper called inside each test.' },
  { re: /['"`]data-testid['"`]|\[data-testid/, msg: 'uses a data-testid selector — select by semantic CSS classes / element IDs instead.' },
  { re: /\.waitForTimeout\s*\(/, msg: 'uses page.waitForTimeout() — use waitForSelector() with an explicit timeout instead.' },
];

/**
 * Audit a single e2e spec against the test-hygiene rules.
 * @param {string} file absolute path
 * @returns {{file:string, violations:string[]}|null}
 */
function auditTestHygiene(file) {
  const src = fs.readFileSync(file, 'utf8');
  const violations = [];
  for (const { re, msg } of TEST_HYGIENE_RULES) {
    if (re.test(src)) violations.push(msg);
  }
  return violations.length ? { file: path.relative(ROOT, file), violations } : null;
}

// Grandfathered §7.2 violators present when the rule was introduced. The rule
// blocks any NEW violation; these are burned down in later loop iterations and
// removed from this list as each spec is cleaned. DO NOT add new entries — fix
// the spec instead. (rfi.spec.js was fully fixed and is intentionally absent.)
const TEST_HYGIENE_BASELINE = new Set([
  'tests/e2e/agent.spec.js',
  'tests/e2e/blog.spec.js',
  'tests/e2e/contacts.spec.js',
  'tests/e2e/design-audit.spec.js',
  'tests/e2e/kanban.spec.js',
  'tests/e2e/public.spec.js',
  'tests/e2e/tutorial.spec.js',
]);

/* ---------- Runner ---------- */

function main() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error(`interaction-audit: templates dir not found: ${TEMPLATES_DIR}`);
    process.exit(2);
  }

  const files = collectJsFiles(TEMPLATES_DIR);
  const findings = [];
  let voiceSurfaces = 0;
  let clipboardSurfaces = 0;
  let importSurfaces = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (CAPABILITY_MARKERS.some(re => re.test(src)) && VOICE_UI_MARKERS.some(re => re.test(src))
        && !isLibraryFile(file)) {
      voiceSurfaces++;
    }
    if (/navigator\s*\.\s*clipboard/.test(src) && !isLibraryFile(file)) clipboardSurfaces++;
    if (!isLibraryFile(file)) importSurfaces++;
    const voice = auditVoiceDegradation(file);
    if (voice) findings.push(voice);
    const clip = auditClipboardDegradation(file);
    if (clip) findings.push(clip);
    const imp = auditImportBoundary(file);
    if (imp) findings.push(imp);
  }

  console.log('interaction-audit — behavioral parity drift guard');
  console.log(`  rules: VOICE_GRACEFUL_DEGRADATION, CLIPBOARD_GRACEFUL_DEGRADATION, GOOGLE_API_IMPORT_BOUNDARY, DYNAMIC_INNERHTML, WAYBOARD_LAYOUT_PARITY`);
  console.log(`  voice-intake surfaces scanned: ${voiceSurfaces}`);
  console.log(`  clipboard surfaces scanned: ${clipboardSurfaces}`);
  console.log(`  template modules scanned for import boundary: ${importSurfaces}`);

  // Dynamic-innerHTML XSS scan spans all of public/js, not just templates.
  const publicFiles = collectPublicJsFiles();
  for (const file of publicFiles) {
    const xss = auditDynamicInnerHtml(file);
    if (xss) findings.push(xss);
  }
  console.log(`  public/js modules scanned for dynamic innerHTML: ${publicFiles.length}`);

  // Wayboard layout parity: home-modes.css must match the curated catalogue.
  const wayboardLayouts = auditWayboardLayouts();
  if (wayboardLayouts) findings.push(wayboardLayouts);
  console.log(`  Wayboard layout catalogue checked for parity: public/css/home-modes.css`);

  // Test-hygiene scan over the e2e specs (AI_LAWS §7.2). Grandfathered specs in
  // TEST_HYGIENE_BASELINE are reported as backlog but don't fail the gate; any
  // NEW violation (a spec not in the baseline) fails.
  let e2eSpecs = [];
  let grandfathered = 0;
  if (fs.existsSync(E2E_DIR)) {
    e2eSpecs = collectJsFiles(E2E_DIR).filter(f => f.endsWith('.spec.js'));
    for (const file of e2eSpecs) {
      const hyg = auditTestHygiene(file);
      if (!hyg) continue;
      if (TEST_HYGIENE_BASELINE.has(hyg.file)) grandfathered++;
      else findings.push(hyg);
    }
  }
  console.log(`  e2e specs scanned for test hygiene: ${e2eSpecs.length} (grandfathered backlog: ${grandfathered})`);

  if (!findings.length) {
    console.log('  ✓ no drift — voice/clipboard degrade gracefully, no direct Google-API imports, no dynamic innerHTML, flat/isolated e2e specs, Wayboard layouts in parity');
    process.exit(0);
  }

  console.log(`\n  ✗ ${findings.length} surface(s) with drift:\n`);
  for (const { file, violations } of findings) {
    console.log(`  • ${file}`);
    for (const v of violations) console.log(`      - ${v}`);
  }
  console.log('');
  process.exit(1);
}

main();
