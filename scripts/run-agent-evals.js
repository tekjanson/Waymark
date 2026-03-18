const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../tests/helpers/test-utils');

try {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {}

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.WAYMARK_AGENT_EVAL_BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(ROOT, 'generated', 'agent-evals');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest.json');
const RESPONSE_TIMEOUT_MS = Number(process.env.WAYMARK_AGENT_EVAL_TIMEOUT_MS || 90000);
const CASE_DELAY_MS = Number(process.env.WAYMARK_AGENT_EVAL_DELAY_MS || 15000);
const STEP_DELAY_MS = Number(process.env.WAYMARK_AGENT_EVAL_STEP_DELAY_MS || 5000);
const RESUME_PREVIOUS = process.env.WAYMARK_AGENT_EVAL_RESUME !== 'false';
const STOP_ON_FAILURE = process.env.WAYMARK_AGENT_EVAL_STOP_ON_FAILURE === 'true';
const EVAL_MODEL = String(process.env.WAYMARK_AGENT_EVAL_MODEL || '').trim();
const CASE_FILTER = String(process.env.WAYMARK_AGENT_EVAL_CASES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MAX_CASES = Number(process.env.WAYMARK_AGENT_EVAL_MAX_CASES || 0);

const CASES = [{
  id: 'vacation-budget-roadtrip',
  tags: ['planning', 'multi-sheet', 'budget', 'travel'],
  steps: [{
    prompt: 'Can you plan a family vacation for me on a 5000 budget road tripping from Wrentham Ma to the Grand Canyon?',
  }],
  checks: {
    minCreatedSheets: 2,
    requireWaymarkLink: true,
    forbidExternalGoogleLink: true,
    titleIncludesGroups: [['travel', 'trip', 'itinerary'], ['budget']],
  },
}, {
  id: 'packing-checklist',
  tags: ['creation', 'checklist'],
  steps: [{
    prompt: 'Create a packing checklist for a weekend camping trip for two adults and two kids.',
  }],
  checks: {
    minCreatedSheets: 1,
    requireWaymarkLink: true,
    forbidExternalGoogleLink: true,
    titleIncludesAny: ['packing', 'checklist', 'camp'],
  },
}, {
  id: 'find-existing-budget-sheet',
  tags: ['search', 'analysis'],
  steps: [{
    prompt: 'Find my monthly budget sheet and tell me what kind of sheet it is.',
  }],
  checks: {
    minCreatedSheets: 0,
    requireWaymarkLink: false,
    forbidExternalGoogleLink: true,
    responseIncludesAny: ['budget', 'sheet', 'monthly'],
  },
}, {
  id: 'create-then-update-checklist',
  tags: ['multi-turn', 'update', 'checklist'],
  steps: [{
    prompt: 'Create a grocery checklist for a family of four for this week.',
  }, {
    prompt: 'Now add apples and yogurt to that checklist and keep the answer short.',
  }],
  checks: {
    minCreatedSheets: 1,
    requireWaymarkLink: true,
    forbidExternalGoogleLink: true,
    titleIncludesAny: ['grocery', 'checklist'],
    responseIncludesAny: ['apples', 'yogurt', 'added', 'checklist'],
  },
}];

function parseKeys(raw) {
  return String(raw || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map((key, idx) => ({
      key,
      nickname: `Eval ${idx + 1}`,
      addedAt: new Date().toISOString(),
      requestsToday: 0,
      lastUsed: null,
      lastError: null,
      isBilled: false,
    }));
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  const healthy = await waitForServer(BASE_URL, 2000);
  if (healthy) return null;

  const child = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, WAYMARK_LOCAL: 'true' },
    stdio: 'ignore',
  });

  const ready = await waitForServer(BASE_URL, 15000);
  if (!ready) {
    child.kill('SIGTERM');
    throw new Error(`Local server did not start at ${BASE_URL}`);
  }
  return child;
}

async function waitForAgentResponse(page) {
  await page.waitForFunction(() => {
    const btn = document.querySelector('.agent-send-btn');
    const hasToolIndicator = !!document.querySelector('.agent-tool-indicator');
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return btn && btn.textContent !== '⏹' && !hasToolIndicator && last && last.textContent.trim().length > 0;
  }, { timeout: RESPONSE_TIMEOUT_MS });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadPreviousSummary() {
  try {
    if (!fs.existsSync(OUTPUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function selectCases() {
  let selected = CASES;
  if (CASE_FILTER.length) {
    selected = selected.filter(testCase =>
      CASE_FILTER.includes(testCase.id) || testCase.tags?.some(tag => CASE_FILTER.includes(tag))
    );
  }

  if (RESUME_PREVIOUS) {
    const previous = loadPreviousSummary();
    const passedIds = new Set((previous?.cases || []).filter(c => c.passed).map(c => c.id));
    selected = selected.filter(testCase => !passedIds.has(testCase.id));
  }

  if (MAX_CASES > 0) {
    selected = selected.slice(0, MAX_CASES);
  }

  return selected;
}

async function getLastAssistantText(page) {
  return page.evaluate(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last ? last.textContent.trim() : '';
  });
}

function scoreCase(responseText, createdRecords, checks) {
  const failures = [];
  const lowerText = responseText.toLowerCase();
  const createdTitles = createdRecords.map(r => String(r.title || ''));
  const sheetLinks = (responseText.match(/#\/sheet\/[^)\s]+/g) || []);

  if (responseText.includes('⚠️ Error:')) {
    failures.push('response contains an agent error');
  }
  if (checks.requireWaymarkLink && sheetLinks.length === 0) {
    failures.push('response did not include a Waymark sheet link');
  }
  if (checks.forbidExternalGoogleLink && /docs\.google\.com/i.test(responseText)) {
    failures.push('response linked to docs.google.com instead of Waymark');
  }
  if (createdRecords.length < checks.minCreatedSheets) {
    failures.push(`expected at least ${checks.minCreatedSheets} created sheet(s), got ${createdRecords.length}`);
  }
  if (checks.titleIncludesAny?.length) {
    for (const needle of checks.titleIncludesAny) {
      const hit = createdTitles.some(title => title.toLowerCase().includes(needle));
      if (!hit) failures.push(`missing created sheet title containing "${needle}"`);
    }
  }
  if (checks.titleIncludesGroups?.length) {
    for (const group of checks.titleIncludesGroups) {
      const hit = createdTitles.some(title => group.some(needle => title.toLowerCase().includes(needle)));
      if (!hit) failures.push(`missing created sheet title containing one of: ${group.join(', ')}`);
    }
  }
  if (checks.responseIncludesAny?.length) {
    const hit = checks.responseIncludesAny.some(needle => lowerText.includes(needle));
    if (!hit) failures.push(`response did not include any of: ${checks.responseIncludesAny.join(', ')}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    createdSheetCount: createdRecords.length,
    createdSheetTitles: createdTitles,
    sheetLinks,
  };
}

function writeSummary(summary) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
}

async function sendPrompt(page, prompt) {
  await page.fill('.agent-input', prompt);
  await page.click('.agent-send-btn');
  await waitForAgentResponse(page);
  return getLastAssistantText(page);
}

async function runCase(browser, keys, testCase) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.addInitScript(({ seedKeys, model }) => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify(seedKeys));
    if (model) localStorage.setItem('waymark_agent_model', JSON.stringify(model));
  }, { seedKeys: keys, model: EVAL_MODEL });

  const startedAt = Date.now();
  let responseText = '';
  let createdRecords = [];
  let runtimeError = null;
  const turnResults = [];

  try {
    await setupApp(page, { hash: '#/agent' });
    await page.waitForSelector('.agent-input', { timeout: 10000 });

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      responseText = await sendPrompt(page, step.prompt);
      turnResults.push({
        step: i + 1,
        prompt: step.prompt,
        responseText,
      });
      if (i < testCase.steps.length - 1 && STEP_DELAY_MS > 0) {
        await sleep(STEP_DELAY_MS);
      }
    }

    createdRecords = await getCreatedRecords(page);
  } catch (err) {
    runtimeError = err.message;
  } finally {
    await context.close();
  }

  const durationMs = Date.now() - startedAt;
  const result = scoreCase(responseText, createdRecords, testCase.checks);
  if (runtimeError) {
    result.passed = false;
    result.failures.unshift(runtimeError);
  }

  return {
    id: testCase.id,
    tags: testCase.tags || [],
    prompts: testCase.steps.map(step => step.prompt),
    durationMs,
    responseText,
    turns: turnResults,
    ...result,
  };
}

async function main() {
  const keys = parseKeys(process.env.WAYMARK_AGENT_EVAL_KEYS);
  if (keys.length === 0) {
    console.error('Missing WAYMARK_AGENT_EVAL_KEYS. Set it in your local .env or shell before running the live eval.');
    process.exit(1);
  }

  let serverChild = null;
  let browser = null;
  try {
    serverChild = await ensureServer();
    browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });

    const selectedCases = selectCases();
    const previous = loadPreviousSummary();
    const results = previous?.cases?.filter(c => c.passed && selectedCases.every(testCase => testCase.id !== c.id)) || [];

    console.log(`Running ${selectedCases.length} live eval case(s) with ${CASE_DELAY_MS}ms pacing between cases.`);

    for (let i = 0; i < selectedCases.length; i++) {
      const testCase = selectedCases[i];
      const result = await runCase(browser, keys, testCase);
      results.push(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} (${result.durationMs}ms)`);
      if (result.failures.length) {
        for (const failure of result.failures) console.log(`  - ${failure}`);
      }

      const summary = {
        ranAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        model: EVAL_MODEL || 'default',
        pacing: {
          caseDelayMs: CASE_DELAY_MS,
          stepDelayMs: STEP_DELAY_MS,
        },
        selectedCaseIds: selectedCases.map(c => c.id),
        cases: results,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
      };
      writeSummary(summary);

      if (!result.passed && STOP_ON_FAILURE) {
        process.exitCode = 1;
        break;
      }

      if (i < selectedCases.length - 1 && CASE_DELAY_MS > 0) {
        console.log(`Cooling down for ${CASE_DELAY_MS}ms before the next live eval case...`);
        await sleep(CASE_DELAY_MS);
      }
    }

    const summary = {
      ranAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      model: EVAL_MODEL || 'default',
      pacing: {
        caseDelayMs: CASE_DELAY_MS,
        stepDelayMs: STEP_DELAY_MS,
      },
      selectedCaseIds: selectedCases.map(c => c.id),
      cases: results,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    };

    writeSummary(summary);
    console.log(`Saved eval report to ${OUTPUT_FILE}`);

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    if (serverChild) serverChild.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});