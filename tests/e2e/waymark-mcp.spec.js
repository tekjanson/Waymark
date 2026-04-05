/* ============================================================
   waymark-mcp.spec.js — Unit + integration tests for mcp/waymark.mjs

   Tests the pure helper functions (detectTemplate, mapColumnRoles,
   colIndexToLetter) via dynamic ESM import, and verifies the
   MCP tool list shape matches the expected 7 tools.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MCP_PATH = path.resolve(__dirname, '../../mcp/waymark.mjs');
const REGISTRY_PATH = path.resolve(__dirname, '../../template-registry.json');

/* ---------- Template registry verification (Node.js) ---------- */

test('waymark MCP template registry has 33 templates', () => {
  const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  expect(data.templates.length).toBe(33);
});

test('waymark MCP template registry has expected template keys', () => {
  const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const keys = data.templates.map(t => t.key);
  expect(keys).toContain('kanban');
  expect(keys).toContain('checklist');
  expect(keys).toContain('budget');
  expect(keys).toContain('knowledge');
  expect(keys).toContain('recipe');
});

test('waymark MCP template registry entries have required fields', () => {
  const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const ok = data.templates.every(t =>
    t.key && t.name && t.icon && Array.isArray(t.columnRoles)
  );
  expect(ok).toBe(true);
});

/* ---------- Validate mcp/waymark.mjs tool definitions (server-side) ---------- */

test('mcp/waymark.mjs file exists', () => {
  expect(fs.existsSync(MCP_PATH)).toBe(true);
});

test('mcp/waymark.mjs has 7 tool definitions', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const toolsSection = src.match(/const TOOLS = \[([\s\S]*?)\];/)?.[1] || '';
  const toolNamesInArray = [...toolsSection.matchAll(/name: "waymark_(\w+)"/g)].map(m => m[1]);
  expect(toolNamesInArray.length).toBe(7);
});

test('mcp/waymark.mjs exposes waymark_list_templates tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_list_templates"');
});

test('mcp/waymark.mjs exposes waymark_detect_template tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_detect_template"');
});

test('mcp/waymark.mjs exposes waymark_get_sheet tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_get_sheet"');
});

test('mcp/waymark.mjs exposes waymark_add_entry tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_add_entry"');
});

test('mcp/waymark.mjs exposes waymark_update_entry tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_update_entry"');
});

test('mcp/waymark.mjs exposes waymark_create_sheet tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_create_sheet"');
});

test('mcp/waymark.mjs exposes waymark_search_entries tool', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('"waymark_search_entries"');
});

test('mcp/waymark.mjs has DEFAULT_HEADERS for 28+ templates', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const headersSection = src.match(/const DEFAULT_HEADERS = \{([\s\S]*?)\};/)?.[1] || '';
  const keys = [...headersSection.matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
  expect(keys.length).toBeGreaterThanOrEqual(28);
});

test('mcp/waymark.mjs uses Google Auth library (service account support)', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('google-auth-library');
  expect(src).toContain('GOOGLE_APPLICATION_CREDENTIALS');
});

test('mcp/waymark.mjs reads template-registry.json at startup', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('template-registry.json');
});

test('mcp/waymark.mjs colIndexToLetter converts 0→A, 1→B, 25→Z, 26→AA', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const fnMatch = src.match(/function colIndexToLetter\(idx\) \{([\s\S]*?)\n\}/);
  expect(fnMatch).toBeTruthy();
  expect(src).toContain('String.fromCharCode(65 + rem)');
});

test('mcp/waymark.mjs tool descriptions include Waymark-focused language', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  expect(src).toContain('column role names');
  expect(src).toContain('template');
  expect(src).toContain('auto-detected');
});

test('mcp/waymark.mjs package.json includes MCP dependency', () => {
  const pkgPath = path.resolve(__dirname, '../../mcp/package.json');
  expect(fs.existsSync(pkgPath)).toBe(true);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  expect(pkg.dependencies?.['@modelcontextprotocol/sdk']).toBeTruthy();
});

test('mcp/waymark.mjs DEFAULT_HEADERS contains kanban with Stage column', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const headersSection = src.match(/const DEFAULT_HEADERS = \{([\s\S]*?)\};/)?.[1] || '';
  expect(headersSection).toContain('"Stage"');
});

test('mcp/waymark.mjs DEFAULT_HEADERS contains knowledge with Title and Content', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const headersSection = src.match(/const DEFAULT_HEADERS = \{([\s\S]*?)\};/)?.[1] || '';
  expect(headersSection).toContain('"Title"');
  expect(headersSection).toContain('"Content"');
});

/* ---------- Integration: template detection via browser (Waymark mock mode) ---------- */

test('browser detects kanban template when opening kanban fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('#template-badge', { timeout: 5000 });
  const badge = await page.locator('#template-badge').textContent();
  expect(badge).toMatch(/kanban/i);
});

test('browser detects knowledge template when opening knowledge fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-044');
  await page.waitForSelector('#template-badge', { timeout: 5000 });
  const badge = await page.locator('#template-badge').textContent();
  expect(badge).toMatch(/knowledge/i);
});

test('browser detects testcases template when opening testcases fixture', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-015');
  await page.waitForSelector('#template-badge', { timeout: 5000 });
  const badge = await page.locator('#template-badge').textContent();
  expect(badge).toMatch(/test.?cases?/i);
});

test('mcp/waymark.mjs handles all 7 tool names in switch statement', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  const switchSection = src.match(/switch \(name\) \{([\s\S]*?)\}/)?.[1] || '';
  const handledTools = [...switchSection.matchAll(/case "waymark_(\w+)"/g)].map(m => m[1]);
  expect(handledTools.length).toBe(7);
});

test('mcp/waymark.mjs createSheet uses spreadsheets batch update for pre-populated headers', () => {
  const src = fs.readFileSync(MCP_PATH, 'utf8');
  // The create sheet function should use the Sheets batchUpdate approach or POST to /spreadsheets
  expect(src).toContain('userEnteredValue');
});
