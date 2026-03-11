#!/usr/bin/env node
/**
 * design-audit.js — AI-powered design & UX validation agent.
 *
 * Reads screenshots captured by the design-audit Playwright spec and
 * sends them to an AI vision model for professional design review.
 *
 * Supported providers (set via DESIGN_AUDIT_PROVIDER env var):
 *   - anthropic  (default) — uses Claude with vision
 *   - openai               — uses GPT-4o with vision
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   or   OPENAI_API_KEY
 *
 * Optional env vars:
 *   DESIGN_AUDIT_PROVIDER  — 'anthropic' (default) or 'openai'
 *   DESIGN_AUDIT_MODEL     — override model name
 *   DESIGN_AUDIT_OUT       — output file (default: design-audit-report.md)
 *
 * Usage:
 *   npm run design-audit
 *   node scripts/design-audit.js
 *   DESIGN_AUDIT_PROVIDER=openai node scripts/design-audit.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

/* ────────── Configuration ────────── */

const PROVIDER = (process.env.DESIGN_AUDIT_PROVIDER || 'anthropic').toLowerCase();
const MODEL = process.env.DESIGN_AUDIT_MODEL || (
  PROVIDER === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514'
);
const API_KEY = PROVIDER === 'openai'
  ? process.env.OPENAI_API_KEY
  : process.env.ANTHROPIC_API_KEY;

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'design-audit-screenshots');
const OUTPUT_FILE = process.env.DESIGN_AUDIT_OUT
  || path.resolve(__dirname, '..', 'design-audit-report.md');

/* ────────── System prompt ────────── */

const SYSTEM_PROMPT = `You are an expert UI/UX designer and frontend engineer performing a professional design audit of a web application called WayMark. WayMark turns Google Sheets into interactive visual views (checklists, kanban boards, budgets, recipes, etc.).

Your role is to evaluate screenshots and provide actionable, specific feedback on:

1. **Color & Contrast** — Are colors harmonious? Is there sufficient contrast for readability (WCAG AA minimum)? Do accent colors clash with backgrounds? In dark mode, are surfaces warm/cool appropriately? Are status colors (green/red/amber) distinguishable?

2. **Typography & Hierarchy** — Is there clear visual hierarchy? Are headings, labels, and body text sized and weighted appropriately? Is line-height comfortable? Are truncation/overflow patterns handled well?

3. **Spacing & Alignment** — Is padding/margin consistent? Are elements properly aligned on a grid? Is there enough whitespace? Are touch targets large enough?

4. **Component Design** — Do cards, buttons, badges, modals, and form elements look polished and consistent? Are hover/active states implied by the design? Are borders, shadows, and border-radius consistent?

5. **Dark Mode Quality** — Does the dark mode feel intentional or like an afterthought? Are backgrounds appropriately dark without being pure black? Do colored elements maintain their identity in dark mode? Are there any "temperature clashes" (e.g., cold blue-gray cards with warm orange accents)?

6. **Overall UX** — Is the layout intuitive? Is information density appropriate? Are interactive elements obviously interactive? Is the visual flow logical?

For each issue found, provide:
- **Severity**: Critical / Major / Minor / Suggestion
- **Location**: Which view/template and which element
- **Issue**: What's wrong
- **Recommendation**: Specific CSS or design fix

Be thorough but prioritize actionable feedback. Focus on issues that would be noticeable to users, not nitpicks.`;

/* ────────── Helpers ────────── */

function readImageAsBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ────────── Screenshot grouping ────────── */

/**
 * Scan the screenshots directory and group light/dark pairs.
 * Returns: [{ name, label, lightPath, darkPath }]
 */
function discoverScreenshots() {
  const lightDir = path.join(SCREENSHOTS_DIR, 'light');
  const darkDir  = path.join(SCREENSHOTS_DIR, 'dark');

  if (!fs.existsSync(lightDir)) {
    console.error('✗ No screenshots found. Run: npm run screenshots');
    process.exit(1);
  }

  const lightFiles = fs.readdirSync(lightDir).filter(f => f.endsWith('.png')).sort();
  const groups = [];

  for (const file of lightFiles) {
    const name = file.replace('.png', '');
    const lightPath = path.join(lightDir, file);
    const darkPath  = path.join(darkDir, file);

    // Derive a human-readable label from the filename
    const label = name
      .replace(/^\d+-/, '')                 // strip leading number prefix
      .replace(/^template-/, 'Template: ') // "template-budget" -> "Template: budget"
      .replace(/^dir-/, 'Directory: ')     // "dir-budget-dir" -> "Directory: budget-dir"
      .replace(/-/g, ' ')                   // kebab -> spaces
      .replace(/\b\w/g, c => c.toUpperCase()); // title case

    groups.push({
      name,
      label,
      lightPath,
      darkPath: fs.existsSync(darkPath) ? darkPath : null,
    });
  }

  return groups;
}

/* ────────── Batch screenshots into analysis groups ────────── */

/**
 * Group screenshots into batches for analysis.
 * Each batch contains 2-4 screenshot pairs to stay within token limits.
 */
function batchGroups(groups, batchSize = 3) {
  const batches = [];
  for (let i = 0; i < groups.length; i += batchSize) {
    batches.push(groups.slice(i, i + batchSize));
  }
  return batches;
}

/* ────────── AI API calls ────────── */

async function analyzeWithAnthropic(images, prompt) {
  const content = [];

  // Add images
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: getMediaType(img.path),
        data: readImageAsBase64(img.path),
      },
    });
    content.push({ type: 'text', text: `↑ ${img.label}` });
  }

  // Add analysis prompt
  content.push({ type: 'text', text: prompt });

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const res = await httpsRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
    },
  }, body);

  if (res.status !== 200) {
    throw new Error(`Anthropic API error ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data.content.map(c => c.text).join('');
}

async function analyzeWithOpenAI(images, prompt) {
  const content = [];

  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${getMediaType(img.path)};base64,${readImageAsBase64(img.path)}`,
        detail: 'high',
      },
    });
    content.push({ type: 'text', text: `↑ ${img.label}` });
  }

  content.push({ type: 'text', text: prompt });

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  });

  const res = await httpsRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
  }, body);

  if (res.status !== 200) {
    throw new Error(`OpenAI API error ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data.choices[0].message.content;
}

async function analyze(images, prompt) {
  if (PROVIDER === 'openai') return analyzeWithOpenAI(images, prompt);
  return analyzeWithAnthropic(images, prompt);
}

/* ────────── Main workflow ────────── */

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   WayMark Design Audit Agent                     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log();

  /* ── Validate prerequisites ── */
  if (!API_KEY) {
    console.error(`✗ Missing API key. Set ${PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} env var.`);
    process.exit(1);
  }

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.error('✗ Screenshots directory not found.');
    console.error('  Run: npm run screenshots');
    process.exit(1);
  }

  /* ── Discover screenshots ── */
  const groups = discoverScreenshots();
  console.log(`Found ${groups.length} screenshot sets.\n`);
  console.log(`Provider: ${PROVIDER} | Model: ${MODEL}\n`);

  /* ── Batch and analyze ── */
  const batches = batchGroups(groups, 3);
  const results = [];
  let batchNum = 0;

  for (const batch of batches) {
    batchNum++;
    const batchLabels = batch.map(g => g.label).join(', ');
    console.log(`[${batchNum}/${batches.length}] Analyzing: ${batchLabels}`);

    // Prepare images (light + dark for each group in batch)
    const images = [];
    for (const group of batch) {
      images.push({ path: group.lightPath, label: `${group.label} (Light Mode)` });
      if (group.darkPath) {
        images.push({ path: group.darkPath, label: `${group.label} (Dark Mode)` });
      }
    }

    const prompt = `Analyze these screenshots from WayMark. For each view shown (${batchLabels}), evaluate both the light and dark mode versions side by side. Identify every design, color, spacing, typography, and UX issue you can find. Be specific about CSS selectors or element descriptions so developers can locate and fix issues. Format your response as markdown with h3 headers for each view.`;

    try {
      const result = await analyze(images, prompt);
      results.push({ batch: batchLabels, analysis: result });
      console.log(`  ✓ Done\n`);
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}\n`);
      results.push({ batch: batchLabels, analysis: `*Error analyzing this batch: ${err.message}*` });
    }
  }

  /* ── Final summary analysis ── */
  console.log('Generating summary and priority rankings...');

  const summaryPrompt = `Based on all the individual analyses below, create a prioritized executive summary of the most impactful design issues across the entire WayMark application. Group issues by severity (Critical, Major, Minor, Suggestion). For each issue include the specific view/template affected and a concrete fix.

Individual analyses:
${results.map(r => `### ${r.batch}\n${r.analysis}`).join('\n\n---\n\n')}`;

  let summary;
  try {
    summary = await analyze([], summaryPrompt);
  } catch {
    summary = '*Summary generation skipped — see individual analyses above.*';
  }

  /* ── Generate report ── */
  const timestamp = new Date().toISOString().replace(/[T:]/g, '-').split('.')[0];
  const report = [
    `# WayMark Design Audit Report`,
    ``,
    `**Generated:** ${new Date().toLocaleString()}  `,
    `**Provider:** ${PROVIDER} | **Model:** ${MODEL}  `,
    `**Screenshots:** ${groups.length} views (light + dark)  `,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    summary,
    ``,
    `---`,
    ``,
    `## Detailed Analysis`,
    ``,
    ...results.map(r => [
      `### ${r.batch}`,
      ``,
      r.analysis,
      ``,
      `---`,
      ``,
    ].join('\n')),
    ``,
    `## Screenshot Index`,
    ``,
    `| # | View | Light | Dark |`,
    `|---|------|-------|------|`,
    ...groups.map((g, i) => {
      const lightRel = path.relative(path.dirname(OUTPUT_FILE), g.lightPath);
      const darkRel  = g.darkPath ? path.relative(path.dirname(OUTPUT_FILE), g.darkPath) : '—';
      return `| ${i + 1} | ${g.label} | ![](${lightRel}) | ${g.darkPath ? `![](${darkRel})` : '—'} |`;
    }),
    ``,
    `---`,
    `*Report generated by WayMark Design Audit Agent*`,
  ].join('\n');

  fs.writeFileSync(OUTPUT_FILE, report);
  console.log(`\n✓ Report saved to: ${OUTPUT_FILE}`);
  console.log(`  ${groups.length} views analyzed across ${batches.length} batches.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
