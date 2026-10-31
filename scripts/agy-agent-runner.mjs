#!/usr/bin/env node
/* ============================================================
   agy-agent-runner.mjs — Headless AGY CLI execution bridge
   Targeted at Gemini 3.8 Flash (gemini-3.8-flash-high).

   Runs Waymark tasks through the `agy` CLI using progressive
   disclosure skills and MCP tools (waymark, google-sheets).
   ============================================================ */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_MODEL = process.env.AGY_MODEL || 'gemini-3.8-flash-high';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AGY_TIMEOUT_MS || '180000', 10);

/**
 * Resolve the `agy` CLI binary across Linux, macOS, and Windows.
 * Prefers native `agy` / `agy.exe` over `.cmd` wrappers so `execFile` runs with `shell: false`.
 * @param {string} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ bin: string, useShell: boolean }}
 */
export function resolveAgyBinary(platform = process.platform, env = process.env) {
  if (env.AGY_BIN) {
    const isCmd = /\.(cmd|bat)$/i.test(env.AGY_BIN);
    return { bin: env.AGY_BIN, useShell: platform === 'win32' && isCmd };
  }

  const isWin = platform === 'win32';
  const sep = isWin ? ';' : ':';
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const pathDirs = (env.PATH || env.Path || '').split(sep).filter(Boolean);

  if (isWin) {
    const winExtra = [
      path.win32.join(home, '.local', 'bin'),
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs', 'antigravity') : '',
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'antigravity', 'bin') : '',
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'antigravity') : '',
      env.APPDATA ? path.win32.join(env.APPDATA, 'npm') : '',
    ].filter(Boolean);
    const searchDirs = [...pathDirs, ...winExtra];
    for (const dir of searchDirs) {
      const exeCandidate = path.join(dir, 'agy.exe');
      if (existsSync(exeCandidate)) return { bin: exeCandidate, useShell: false };
    }
    for (const dir of searchDirs) {
      for (const ext of ['agy.cmd', 'agy.bat']) {
        const cmdCandidate = path.join(dir, ext);
        if (existsSync(cmdCandidate)) return { bin: cmdCandidate, useShell: true };
      }
    }
    return { bin: 'agy.exe', useShell: false };
  }

  const posixExtra = [
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  for (const dir of [...pathDirs, ...posixExtra]) {
    const candidate = path.join(dir, 'agy');
    if (existsSync(candidate)) return { bin: candidate, useShell: false };
  }
  return { bin: 'agy', useShell: false };
}

/**
 * Extract Google Spreadsheet IDs from text.
 * @param {string} text
 * @returns {string|null}
 */
export function extractSpreadsheetId(text) {
  if (!text) return null;
  // Match standard sheets/d/ID or #/sheet/ID
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{25,})/);
  if (urlMatch) return urlMatch[1];
  const hashMatch = text.match(/#\/(?:sheet|public)\/([a-zA-Z0-9_-]{25,})/);
  if (hashMatch) return hashMatch[1];
  // Match json property "spreadsheetId": "..."
  const jsonMatch = text.match(/"spreadsheetId":\s*"([a-zA-Z0-9_-]{25,})"/);
  if (jsonMatch) return jsonMatch[1];
  return null;
}

/**
 * Extract Google Doc IDs from text.
 * @param {string} text
 * @returns {string|null}
 */
export function extractDocId(text) {
  if (!text) return null;
  const docMatch = text.match(/\/document\/d\/([a-zA-Z0-9_-]{25,})/);
  if (docMatch) return docMatch[1];
  const jsonMatch = text.match(/"documentId":\s*"([a-zA-Z0-9_-]{25,})"/);
  if (jsonMatch) return jsonMatch[1];
  return null;
}

/**
 * Extract all created/modified file references and optional titles from text.
 * @param {string} text
 * @returns {{ sheetId: string|null, docId: string|null, sheetTitle: string|null, docTitle: string|null }}
 */
export function extractFileReferences(text) {
  const sheetId = extractSpreadsheetId(text);
  const docId = extractDocId(text);
  let sheetTitle = null;
  let docTitle = null;

  if (text) {
    const mdSheet = text.match(/\[([^\]]+)\]\((?:#\/(?:sheet|public)\/|https?:\/\/[^\s)]*\/spreadsheets\/d\/)[a-zA-Z0-9_-]{25,}/);
    if (mdSheet && mdSheet[1]) sheetTitle = mdSheet[1].trim();

    const mdDoc = text.match(/\[([^\]]+)\]\(https?:\/\/[^\s)]*\/document\/d\/[a-zA-Z0-9_-]{25,}/);
    if (mdDoc && mdDoc[1]) docTitle = mdDoc[1].trim();

    if (!sheetTitle && !docTitle) {
      const jsonTitle = text.match(/"title":\s*"([^"]+)"/);
      if (jsonTitle && jsonTitle[1]) {
        if (sheetId) sheetTitle = jsonTitle[1].trim();
        if (docId) docTitle = jsonTitle[1].trim();
      }
    }
  }

  return {
    sheetId,
    docId,
    sheetTitle,
    docTitle,
  };
}

/**
 * Build the prompt delivered to agy.
 */
export function buildAgyPrompt({ task, templateKey, sheetId, context = '' }) {
  const parts = [];

  parts.push(`You are Waymark AI, an autonomous data assistant.`);
  if (templateKey) {
    parts.push(`You are operating in the domain of the '${templateKey}' template. Use the 'waymark-${templateKey}' skill if needed.`);
  } else {
    parts.push(`Use the 'waymark-orchestrator' skill to select the appropriate Waymark template and actions.`);
  }

  if (sheetId) {
    parts.push(`Target Spreadsheet ID: ${sheetId}`);
  }

  if (context) {
    parts.push(`Conversation context:\n${context}`);
  }

  parts.push(`\nUser Request: ${task}`);
  parts.push(`\nInstructions:
1. Use the Waymark MCP tools:
   - Discovering files: call waymark_list_files({ query?, type? }) to find existing sheets or docs.
   - Creating new sheets: call waymark_create_sheet({ templateKey, title, seedRows? })
   - Reading sheets: call waymark_get_sheet({ spreadsheetId, sheetTitle? })
   - Modifying rows: call waymark_update_entry({ spreadsheetId, rowIndex, updates })
   - Appending rows: call waymark_add_entry({ spreadsheetId, entry })
   - Searching rows: call waymark_search_entries({ spreadsheetId, query })
   - Document operations: call waymark_create_doc, waymark_get_doc, waymark_append_doc
2. When creating a new sheet, output the viewer link: [Sheet Title](#/sheet/<spreadsheetId>)
3. When creating or linking a doc, output the doc link: [Doc Title](https://docs.google.com/document/d/<documentId>/edit)
4. Provide a friendly, concise summary of what you did.`);

  return parts.join('\n\n');
}

/**
 * Run a prompt through agy.
 * @param {object} opts
 * @param {string} opts.task
 * @param {string} [opts.templateKey]
 * @param {string} [opts.sheetId]
 * @param {string} [opts.context]
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cwd]
 * @returns {Promise<{ ok: boolean, output: string, sheetId?: string, durationMs: number, error?: string }>}
 */
export async function runAgyTask({
  task,
  templateKey = null,
  sheetId = null,
  context = '',
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd = ROOT,
}) {
  const prompt = buildAgyPrompt({ task, templateKey, sheetId, context });
  const start = Date.now();
  const { bin: agyBin, useShell } = resolveAgyBinary();
  const effectivePrompt = useShell ? prompt.replace(/\r?\n+/g, ' ') : prompt;

  const agyArgs = [
    '--model', model,
    '--dangerously-skip-permissions',
    '-p', effectivePrompt,
  ];

  const homeDir = os.homedir();
  const defaultSa = path.join(homeDir, '.config', 'gcloud', 'waymark-service-account-key.json');
  const defaultOAuth = path.join(homeDir, '.config', 'gcloud', 'waymark-oauth-token.json');
  const childEnv = { ...process.env };
  if (!childEnv.GOOGLE_APPLICATION_CREDENTIALS && existsSync(defaultSa)) {
    childEnv.GOOGLE_APPLICATION_CREDENTIALS = defaultSa;
  }
  if (!childEnv.WAYMARK_OAUTH_TOKEN_PATH && existsSync(defaultOAuth)) {
    childEnv.WAYMARK_OAUTH_TOKEN_PATH = defaultOAuth;
  }

  try {
    const { stdout } = await execFileAsync(agyBin, agyArgs, {
      cwd,
      timeout: timeoutMs,
      shell: useShell,
      windowsHide: true,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (stdout || '').trim();
    const refs = extractFileReferences(output);
    const detectedSheetId = sheetId || refs.sheetId;
    const detectedDocId = refs.docId;
    const durationMs = Date.now() - start;

    return {
      ok: true,
      output,
      sheetId: detectedSheetId,
      sheetTitle: refs.sheetTitle,
      docId: detectedDocId,
      docTitle: refs.docTitle,
      templateKey,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err.killed
      ? `Timed out after ${timeoutMs}ms`
      : (err.stderr || err.message || 'Unknown agy execution error');

    return {
      ok: false,
      output: '',
      error: errorMsg,
      durationMs,
    };
  }
}

// ── CLI Execution ──────────────────────────────────────────────────────
function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(fileURLToPath(metaUrl));
    const b = realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  let task = '';
  let templateKey = null;
  let sheetId = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--task' || args[i] === '-m' || args[i] === '--message' || args[i] === '-p' || args[i] === '--prompt') && args[i + 1]) {
      task = args[++i];
    } else if (args[i] === '--template' && args[i + 1]) {
      templateKey = args[++i];
    } else if (args[i] === '--sheet' && args[i + 1]) {
      sheetId = args[++i];
    } else if (!task && !args[i].startsWith('-')) {
      task = args[i];
    }
  }

  if (!task) {
    console.log('Usage: node scripts/agy-agent-runner.mjs [--template <key>] [--sheet <id>] --task "<prompt>"');
    process.exit(1);
  }

  console.log(`Running AGY Task (model: ${DEFAULT_MODEL})...`);
  runAgyTask({ task, templateKey, sheetId }).then(res => {
    if (res.ok) {
      console.log(`\n--- AGY Response (${res.durationMs}ms) ---\n`);
      console.log(res.output);
      if (res.sheetId) console.log(`\nDetected Sheet ID: ${res.sheetId}`);
    } else {
      console.error(`\n--- AGY Failed (${res.durationMs}ms) ---\n`, res.error);
      process.exit(1);
    }
  });
}
