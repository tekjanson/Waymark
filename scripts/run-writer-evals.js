/* ============================================================
   run-writer-evals.js — LLM eval for the Content Workbench AI writer
   
   Generates posts via the writer panel, then scores each output
   with a judge LLM for voice match, platform fit, and quality.
   
   Usage:
     npm run test:writer:eval
     WAYMARK_AGENT_EVAL_CASES=twitter npm run test:writer:eval
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../tests/helpers/test-utils');

/* ---------- Load .env ---------- */
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

/* ---------- Config ---------- */
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.WAYMARK_AGENT_EVAL_BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(ROOT, 'generated', 'agent-evals');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'writer-latest.json');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const EVAL_MODEL = process.env.WAYMARK_AGENT_EVAL_MODEL || 'gemini-flash-latest';
const CASE_DELAY_MS = Number(process.env.WAYMARK_AGENT_EVAL_DELAY_MS || 10000);
const CASE_FILTER = String(process.env.WAYMARK_AGENT_EVAL_CASES || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* ---------- Eval cases ---------- */
const CASES = [
  {
    id: 'twitter-feature-announce',
    platform: 'twitter',
    idea: 'Announce that Waymark now has a recipe template that turns messy spreadsheet data into a beautiful cookbook view',
    checks: {
      maxChars: 280,
      mustNotInclude: ['here\'s a draft', 'option 1', 'option 2', 'here is'],
      platformFit: 'twitter',
    },
  },
  {
    id: 'twitter-personal-story',
    platform: 'twitter',
    idea: 'Share a personal story about why I built Waymark — I was drowning in Google Sheets and wanted something better',
    checks: {
      maxChars: 280,
      mustNotInclude: ['here\'s a draft', 'dear'],
      platformFit: 'twitter',
    },
  },
  {
    id: 'reddit-show-off',
    platform: 'reddit',
    idea: 'Post in r/SideProject showing off Waymark as an open source tool that makes Google Sheets actually useful',
    checks: {
      mustNotInclude: ['buy now', 'limited time', 'discount'],
      platformFit: 'reddit',
    },
  },
  {
    id: 'linkedin-thought-leadership',
    platform: 'linkedin',
    idea: 'Write about how most productivity tools add complexity instead of removing it, and how Waymark takes a different approach by working with data people already have',
    checks: {
      minChars: 200,
      mustNotInclude: ['here\'s a draft'],
      platformFit: 'linkedin',
    },
  },
  {
    id: 'hn-show-launch',
    platform: 'hn',
    idea: 'Show HN post for Waymark — an open source tool that turns Google Sheets into rich interactive views without any setup',
    checks: {
      mustNotInclude: ['buy', 'pricing', '💰'],
      platformFit: 'hn',
    },
  },
  {
    id: 'twitter-engagement-hook',
    platform: 'twitter',
    idea: 'Ask a question to start a conversation: what is the messiest spreadsheet you have right now and what would you want it to look like?',
    checks: {
      maxChars: 280,
      platformFit: 'twitter',
    },
  },
  {
    id: 'youtube-demo-walkthrough',
    platform: 'youtube',
    idea: 'Script a short video showing how to open a messy Google Sheet in Waymark and watch it transform into a clean interactive view in seconds',
    checks: {
      minChars: 300,
      mustNotInclude: ['here\'s a draft', 'option 1'],
      platformFit: 'youtube',
    },
  },
  {
    id: 'tiktok-before-after',
    platform: 'tiktok',
    idea: 'Quick before/after showing an ugly spreadsheet turning into a beautiful Waymark view — hook people with the transformation',
    checks: {
      minChars: 50,
      mustNotInclude: ['here\'s a draft', 'option 1'],
      platformFit: 'tiktok',
    },
  },
];

/* ---------- Helpers ---------- */

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- Judge LLM scoring ---------- */

const JUDGE_PROMPT = `You are an expert social media content evaluator. Score the following AI-generated post on these criteria:

1. VOICE_MATCH (1-5): Does it sound like a real person wrote it? Not corporate, not AI-slop. Natural, authentic.
2. PLATFORM_FIT (1-5): Does it follow the conventions and constraints of the target platform?
3. CLARITY (1-5): Is the message clear? Would someone understand what Waymark is/does?
4. ENGAGEMENT (1-5): Would this make someone want to click, reply, or share?
5. NO_SLOP (1-5): Is it free from AI clichés? ("In today's fast-paced world", "game-changer", "revolutionize", "leverage", "delve")

Respond ONLY with valid JSON in this exact format:
{"voice_match":N,"platform_fit":N,"clarity":N,"engagement":N,"no_slop":N,"overall":N,"feedback":"one sentence of constructive feedback"}

The "overall" score should be the average of the 5 scores, rounded to 1 decimal place.`;

async function judgePost(apiKey, platform, idea, generatedPost, allKeys) {
  const userMsg = [
    `Platform: ${platform}`,
    `User's idea: ${idea}`,
    `Generated post:`,
    generatedPost,
  ].join('\n');

  // Retry with key rotation on rate limits
  const keysToTry = allKeys ? [apiKey, ...allKeys.map(k => k.key).filter(k => k !== apiKey)] : [apiKey];
  let lastErr = null;

  for (const key of keysToTry) {
    const url = `${GEMINI_BASE}/${encodeURIComponent(EVAL_MODEL)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        systemInstruction: { parts: [{ text: JUDGE_PROMPT }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      lastErr = err?.error?.message || `Judge API error ${res.status}`;
      if (res.status === 429 || (lastErr && lastErr.includes('high demand'))) {
        await sleep(3000);
        continue; // try next key
      }
      throw new Error(lastErr);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Empty judge response');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Judge did not return JSON: ${text.slice(0, 200)}`);
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error(lastErr || 'All keys rate-limited');
}

/* ---------- Deterministic checks ---------- */

function runDeterministicChecks(post, checks) {
  const failures = [];

  if (checks.maxChars && post.length > checks.maxChars) {
    failures.push(`Exceeds ${checks.maxChars} char limit (got ${post.length})`);
  }
  if (checks.minChars && post.length < checks.minChars) {
    failures.push(`Too short — expected at least ${checks.minChars} chars (got ${post.length})`);
  }
  if (checks.mustNotInclude) {
    const lower = post.toLowerCase();
    for (const phrase of checks.mustNotInclude) {
      if (lower.includes(phrase.toLowerCase())) {
        failures.push(`Contains forbidden phrase: "${phrase}"`);
      }
    }
  }

  // Check for common AI slop patterns
  const slopPatterns = [
    /\bin today's (fast-paced|ever-changing|digital)\b/i,
    /\bgame.?changer\b/i,
    /\bleverage\b/i,
    /\bdelve\b/i,
    /\bunlock the (power|potential)\b/i,
    /\bseamlessly\b/i,
    /\btransformative\b/i,
    /\bsynerg/i,
    /\bdisrupt/i,
  ];
  for (const pattern of slopPatterns) {
    if (pattern.test(post)) {
      failures.push(`Contains AI slop pattern: ${pattern}`);
    }
  }

  // Multi-post detection (should be exactly one post)
  if (/^(option|version|alternative|draft)\s*[0-9#]/im.test(post)) {
    failures.push('Generated multiple options instead of a single post');
  }

  return failures;
}

/* ---------- Main ---------- */

async function runCase(browser, keys, testCase) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await page.addInitScript(({ seedKeys, model }) => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify(seedKeys));
    if (model) localStorage.setItem('waymark_agent_model', JSON.stringify(model));
  }, { seedKeys: keys, model: EVAL_MODEL });

  const startedAt = Date.now();
  let generatedPost = '';
  let runtimeError = null;

  try {
    await setupApp(page);
    await navigateToSheet(page, 'sheet-059');
    await page.waitForSelector('.marketing-writer', { timeout: 10000 });

    await page.selectOption('.marketing-writer-platform', testCase.platform);
    await page.fill('.marketing-writer-idea', testCase.idea);
    await page.click('.marketing-writer-gen-btn');

    // Wait for generation to complete: button re-enables when done
    await page.waitForFunction(() => {
      const btn = document.querySelector('.marketing-writer-gen-btn');
      const draft = document.querySelector('.marketing-writer-draft');
      const text = document.querySelector('.marketing-writer-draft-text');
      const errEl = document.querySelector('.marketing-writer-error');
      // Done when button is re-enabled AND (draft visible with text OR error shown)
      return btn && !btn.disabled && (
        (draft && !draft.classList.contains('hidden') && text && text.value.trim().length > 5) ||
        (errEl && errEl.textContent.trim().length > 0)
      );
    }, undefined, { timeout: 90000 });

    generatedPost = await page.locator('.marketing-writer-draft-text').inputValue();
  } catch (err) {
    runtimeError = err.message;
  } finally {
    await context.close();
  }

  const durationMs = Date.now() - startedAt;
  const deterministicFailures = generatedPost ? runDeterministicChecks(generatedPost, testCase.checks) : [];

  // Judge with LLM
  let judgeScores = null;
  let judgeError = null;
  if (generatedPost && !runtimeError) {
    try {
      const judgeKey = keys[Math.floor(Math.random() * keys.length)].key;
      judgeScores = await judgePost(judgeKey, testCase.platform, testCase.idea, generatedPost, keys);
    } catch (err) {
      judgeError = err.message;
    }
  }

  const passed = !runtimeError
    && deterministicFailures.length === 0
    && judgeScores
    && judgeScores.overall >= 3.0;

  return {
    id: testCase.id,
    platform: testCase.platform,
    idea: testCase.idea,
    generatedPost,
    charCount: generatedPost.length,
    durationMs,
    deterministicFailures,
    judgeScores,
    judgeError,
    runtimeError,
    passed,
  };
}

async function main() {
  const keys = parseKeys(process.env.WAYMARK_AGENT_EVAL_KEYS);
  if (keys.length === 0) {
    console.error('Missing WAYMARK_AGENT_EVAL_KEYS. Set it in your .env or shell.');
    process.exit(1);
  }

  let serverChild = null;
  let browser = null;

  try {
    serverChild = await ensureServer();
    browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });

    let selectedCases = CASES;
    if (CASE_FILTER.length) {
      selectedCases = selectedCases.filter(c =>
        CASE_FILTER.includes(c.id) || CASE_FILTER.includes(c.platform)
      );
    }

    console.log(`Running ${selectedCases.length} writer eval case(s) with ${CASE_DELAY_MS}ms pacing.`);
    console.log(`Model: ${EVAL_MODEL}`);
    console.log('');

    const results = [];
    for (let i = 0; i < selectedCases.length; i++) {
      const testCase = selectedCases[i];
      console.log(`[${i + 1}/${selectedCases.length}] ${testCase.id} (${testCase.platform})...`);

      const result = await runCase(browser, keys, testCase);
      results.push(result);

      const status = result.passed ? 'PASS' : 'FAIL';
      const score = result.judgeScores ? ` (${result.judgeScores.overall}/5)` : '';
      console.log(`  ${status}${score} — ${result.charCount} chars, ${result.durationMs}ms`);

      if (result.deterministicFailures.length > 0) {
        for (const f of result.deterministicFailures) console.log(`  ✗ ${f}`);
      }
      if (result.judgeScores?.feedback) {
        console.log(`  💡 ${result.judgeScores.feedback}`);
      }
      if (result.runtimeError) {
        console.log(`  ⚠️ Runtime: ${result.runtimeError}`);
      }
      if (result.judgeError) {
        console.log(`  ⚠️ Judge: ${result.judgeError}`);
      }

      // Save incrementally
      const summary = buildSummary(results, selectedCases);
      writeSummary(summary);

      if (i < selectedCases.length - 1 && CASE_DELAY_MS > 0) {
        await sleep(CASE_DELAY_MS);
      }
    }

    const summary = buildSummary(results, selectedCases);
    writeSummary(summary);

    console.log('');
    console.log('=== SUMMARY ===');
    console.log(`Passed: ${summary.passed}/${summary.total}`);
    console.log(`Avg score: ${summary.avgScore}/5`);
    console.log(`Saved to ${OUTPUT_FILE}`);

    if (summary.failed > 0) process.exitCode = 1;

  } finally {
    if (browser) await browser.close();
    if (serverChild) serverChild.kill('SIGTERM');
  }
}

function buildSummary(results, selectedCases) {
  const scores = results.filter(r => r.judgeScores).map(r => r.judgeScores.overall);
  const avgScore = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : '—';

  return {
    ranAt: new Date().toISOString(),
    model: EVAL_MODEL,
    baseUrl: BASE_URL,
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    avgScore,
    selectedCaseIds: selectedCases.map(c => c.id),
    cases: results,
  };
}

function writeSummary(summary) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
