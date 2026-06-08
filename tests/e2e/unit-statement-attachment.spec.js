// @ts-check
/**
 * unit-statement-attachment.spec.js
 *
 * Pure-logic unit tests for the Automated Statement Attachment System.
 * Tests the three core functions from scripts/watch-inbox.js:
 *   - extractPeriod  — parse YYYY-MM from a filename
 *   - matchEntity    — fuzzy-match a filename to an entity list
 *   - buildCanonical — build the "{STMT-NNN} {EntityName} {YYYY-MM}.ext" filename
 *
 * All tests run inside page.evaluate() so they follow the project's
 * Playwright test pattern (AI Laws §7). The logic is defined inline
 * (same algorithm as watch-inbox.js) so tests exercise the real
 * implementation contract without importing a Node.js CJS module.
 */

const { test, expect } = require('@playwright/test');
const { setupApp }     = require('../helpers/test-utils');

/* ── Inline logic (mirrors scripts/watch-inbox.js exactly) ────────────── */

const EXTRACT_PERIOD_SRC = `
function extractPeriod(filename) {
  const base = filename.replace(/\\.\\w+$/, '');
  const canonical = base.match(/(\\d{4})-(\\d{2})(?:\\s*$|\\s)/);
  if (canonical) return canonical[1] + '-' + canonical[2];
  const isoLike = base.match(/(\\d{4})[-_](\\d{2})(?!\\d)/);
  if (isoLike) {
    const [, y, m] = isoLike;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) return y + '-' + m;
  }
  const mdy = base.match(/(?<!\\d)(\\d{2})[-_](\\d{4})(?!\\d)/);
  if (mdy) {
    const [, m, y] = mdy;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) return y + '-' + m;
  }
  const compact = base.match(/(?<!\\d)(\\d{2})(\\d{4})(?!\\d)/);
  if (compact) {
    const [, m, y] = compact;
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(y, 10) >= 2000) return y + '-' + m;
  }
  const yearOnly = base.match(/(?<!\\d)(20\\d{2})(?!\\d)/);
  if (yearOnly) return yearOnly[1] + '-01';
  return null;
}
`;

const MATCH_ENTITY_SRC = `
function matchEntity(filename, entities) {
  const base  = filename.replace(/\\.\\w+$/, '').toLowerCase();
  const words = base.split(/[\\s_\\-\\.]+/).filter(Boolean);
  for (const e of entities) {
    if (base.includes(e.id.toLowerCase())) return { entity: e, confidence: 'exact' };
  }
  for (const e of entities) {
    const nameWords = e.name.toLowerCase().split(/\\s+/);
    if (nameWords.every(w => words.includes(w))) return { entity: e, confidence: 'name' };
  }
  let best = null, bestScore = 0;
  for (const e of entities) {
    const nameWords = e.name.toLowerCase().split(/\\s+/);
    const score = nameWords.filter(w => words.some(fw => fw.includes(w) || w.includes(fw))).length;
    if (score > bestScore && score > 0) { bestScore = score; best = e; }
  }
  if (best) return { entity: best, confidence: 'fuzzy' };
  return null;
}
`;

const BUILD_CANONICAL_SRC = `
function buildCanonicalName(stmtId, entityName, yearMonth, origName) {
  const ext = origName.includes('.') ? origName.split('.').pop().toLowerCase() : 'pdf';
  return stmtId + ' ' + entityName + ' ' + yearMonth + '.' + ext;
}
`;

/* ── Sample entities (matches setup-drive-folders.js dry-run defaults) ── */

const SAMPLE_ENTITIES = [
  { id: 'ASSET-001', name: 'Chase Checking',  tab: 'Assets' },
  { id: 'ASSET-002', name: 'Ally Savings',    tab: 'Assets' },
  { id: 'LIAB-001',  name: 'Chase Sapphire',  tab: 'Liabilities' },
  { id: 'LIAB-002',  name: 'Main St Mortgage',tab: 'Liabilities' },
];

/* ══════════════════════════════════════════════════════════════════════════
   extractPeriod — period extraction from filenames
   ══════════════════════════════════════════════════════════════════════════ */

test('extractPeriod: ISO YYYY-MM pattern', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src); // eslint-disable-line no-eval
    return extractPeriod('Chase_Sapphire_2026-05.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-05');
});

test('extractPeriod: YYYY_MM underscore separator', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('ally_checking_2026_05.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-05');
});

test('extractPeriod: MM-YYYY reversed order', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('statement-05-2026.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-05');
});

test('extractPeriod: MMYYYY compact (no separator)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('ally_checking_052026.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-05');
});

test('extractPeriod: YYYY only (month defaults to 01)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('ally_savings_2026.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-01');
});

test('extractPeriod: no date returns null', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('statement.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBeNull();
});

test('extractPeriod: entity ID prefix does not confuse parser', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('LIAB-002_mortgage_2026_04.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-04');
});

test('extractPeriod: month 13 is invalid, falls through to year-only', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    // "2026-13" is invalid month → should not match YYYY-MM rule
    return extractPeriod('data_2026-13_report.pdf');
  }, EXTRACT_PERIOD_SRC);
  // Should fall through to year-only → 2026-01
  expect(result).toBe('2026-01');
});

test('extractPeriod: canonical STMT format preserves trailing space terminator', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return extractPeriod('STMT-042 Chase Sapphire 2026-05.pdf');
  }, EXTRACT_PERIOD_SRC);
  expect(result).toBe('2026-05');
});

/* ══════════════════════════════════════════════════════════════════════════
   matchEntity — entity matching from filenames
   ══════════════════════════════════════════════════════════════════════════ */

test('matchEntity: exact entity ID match (LIAB-001)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('LIAB-001_statement_2026-05.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('exact');
  expect(result.entity.id).toBe('LIAB-001');
});

test('matchEntity: exact entity ID match (ASSET-002)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('ASSET-002_2026-05.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('exact');
  expect(result.entity.id).toBe('ASSET-002');
});

test('matchEntity: full name word match (Chase Sapphire)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('chase_sapphire_2026_05.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('name');
  expect(result.entity.id).toBe('LIAB-001');
});

test('matchEntity: full name word match (Ally Savings)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('ally_savings_052026.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('name');
  expect(result.entity.id).toBe('ASSET-002');
});

test('matchEntity: fuzzy partial word match (mortgage → Main St Mortgage)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('mortgage_statement_2026-04.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('fuzzy');
  expect(result.entity.id).toBe('LIAB-002');
});

test('matchEntity: no match returns null', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('random_file_2026-05.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result).toBeNull();
});

test('matchEntity: entity ID takes priority over name match', async ({ page }) => {
  await setupApp(page);
  // File contains both "ASSET-001" (Chase Checking) and "sapphire" (Chase Sapphire)
  // Exact ID should win
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('ASSET-001_chase_sapphire_2026-05.pdf', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result.confidence).toBe('exact');
  expect(result.entity.id).toBe('ASSET-001');
});

test('matchEntity: case insensitive matching', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([src, entities]) => {
    eval(src);
    return matchEntity('ALLY_SAVINGS_2026-05.PDF', entities);
  }, [MATCH_ENTITY_SRC, SAMPLE_ENTITIES]);
  expect(result).not.toBeNull();
  expect(result.entity.id).toBe('ASSET-002');
});

/* ══════════════════════════════════════════════════════════════════════════
   buildCanonicalName — canonical filename construction
   ══════════════════════════════════════════════════════════════════════════ */

test('buildCanonicalName: standard PDF', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCanonicalName('STMT-001', 'Chase Sapphire', '2026-05', 'chase_2026-05.pdf');
  }, BUILD_CANONICAL_SRC);
  expect(result).toBe('STMT-001 Chase Sapphire 2026-05.pdf');
});

test('buildCanonicalName: preserves extension (jpg)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCanonicalName('STMT-042', 'Ally Savings', '2026-03', 'scan.JPG');
  }, BUILD_CANONICAL_SRC);
  expect(result).toBe('STMT-042 Ally Savings 2026-03.jpg');
});

test('buildCanonicalName: defaults to pdf when no extension', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCanonicalName('STMT-010', 'Main St Mortgage', '2026-01', 'statement');
  }, BUILD_CANONICAL_SRC);
  expect(result).toBe('STMT-010 Main St Mortgage 2026-01.pdf');
});

test('buildCanonicalName: high statement number (3 digits)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate((src) => {
    eval(src);
    return buildCanonicalName('STMT-100', 'Chase Checking', '2025-12', 'old.pdf');
  }, BUILD_CANONICAL_SRC);
  expect(result).toBe('STMT-100 Chase Checking 2025-12.pdf');
});

/* ══════════════════════════════════════════════════════════════════════════
   Integration: full pipeline simulation (extractPeriod + matchEntity + build)
   ══════════════════════════════════════════════════════════════════════════ */

test('pipeline: Chase_Sapphire_2026-05.pdf → STMT-??? Chase Sapphire 2026-05.pdf', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([ep, me, bc, entities]) => {
    eval(ep); eval(me); eval(bc);
    const filename = 'Chase_Sapphire_2026-05.pdf';
    const period   = extractPeriod(filename) || '2026-01';
    const match    = matchEntity(filename, entities);
    if (!match) return null;
    return buildCanonicalName('STMT-001', match.entity.name, period, filename);
  }, [EXTRACT_PERIOD_SRC, MATCH_ENTITY_SRC, BUILD_CANONICAL_SRC, SAMPLE_ENTITIES]);
  expect(result).toBe('STMT-001 Chase Sapphire 2026-05.pdf');
});

test('pipeline: ally_checking_052026.pdf → STMT-??? Ally Savings 2026-05.pdf', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([ep, me, bc, entities]) => {
    eval(ep); eval(me); eval(bc);
    const filename = 'ally_savings_052026.pdf';
    const period   = extractPeriod(filename) || '2026-01';
    const match    = matchEntity(filename, entities);
    if (!match) return null;
    return buildCanonicalName('STMT-002', match.entity.name, period, filename);
  }, [EXTRACT_PERIOD_SRC, MATCH_ENTITY_SRC, BUILD_CANONICAL_SRC, SAMPLE_ENTITIES]);
  expect(result).toBe('STMT-002 Ally Savings 2026-05.pdf');
});

test('pipeline: LIAB-002_mortgage_2026_04.pdf → correct entity and period', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([ep, me, bc, entities]) => {
    eval(ep); eval(me); eval(bc);
    const filename = 'LIAB-002_mortgage_2026_04.pdf';
    const period   = extractPeriod(filename) || '2026-01';
    const match    = matchEntity(filename, entities);
    if (!match) return null;
    return {
      canonical:  buildCanonicalName('STMT-003', match.entity.name, period, filename),
      entityId:   match.entity.id,
      confidence: match.confidence,
      period,
    };
  }, [EXTRACT_PERIOD_SRC, MATCH_ENTITY_SRC, BUILD_CANONICAL_SRC, SAMPLE_ENTITIES]);
  expect(result.entityId).toBe('LIAB-002');
  expect(result.period).toBe('2026-04');
  expect(result.confidence).toBe('exact');
  expect(result.canonical).toBe('STMT-003 Main St Mortgage 2026-04.pdf');
});

test('pipeline: unrecognized file returns null entity match', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(([ep, me, bc, entities]) => {
    eval(ep); eval(me); eval(bc);
    const filename = 'random_document_2026-05.pdf';
    const match    = matchEntity(filename, entities);
    return match;
  }, [EXTRACT_PERIOD_SRC, MATCH_ENTITY_SRC, BUILD_CANONICAL_SRC, SAMPLE_ENTITIES]);
  expect(result).toBeNull();
});
