/**
 * Unit tests for google-apps-script/lib/notification-config.js
 *
 * Because GAS files use global function scope (no ES module exports),
 * the pure functions are exercised inline via page.evaluate().
 *
 * Functions covered:
 *   parseNotifyRules  — parse notification rule rows from a config sheet
 *   matchesRule       — test whether an edit event fires a given rule
 *   splitRecipients   — split comma/semicolon recipient strings
 *   parseEnabledFlag  — parse yes/no/blank enabled cell
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   Shared: inject pure notification-config helpers into the page.
   These mirror google-apps-script/lib/notification-config.js exactly.
   ============================================================ */

async function injectNotifyHelpers(page) {
  await page.evaluate(() => {
    /* ---------- Private helpers ---------- */
    function _findCol(lowerHeaders, pattern) {
      for (var i = 0; i < lowerHeaders.length; i++) {
        if (pattern.test(lowerHeaders[i])) return i;
      }
      return -1;
    }

    function splitRecipients(raw) {
      return (raw || '').split(/[,;]/).map(function(s) { return s.trim(); }).filter(Boolean);
    }

    function parseEnabledFlag(val) {
      var v = (val || '').toLowerCase().trim();
      if (v === '') return true;
      return ['no', 'false', '0', 'disabled'].indexOf(v) < 0;
    }

    function cellValue(row, idx) {
      if (idx < 0 || idx >= row.length) return '';
      var v = row[idx];
      return v == null ? '' : String(v).trim();
    }

    /* ---------- parseNotifyRules ---------- */
    function parseNotifyRules(headers, rows) {
      var lower = headers.map(function(h) { return String(h || '').toLowerCase().trim(); });
      var cols = {
        name:         _findCol(lower, /^rule\s*name$/),
        watchCol:     _findCol(lower, /^watch\s*col(umn)?$/),
        trigger:      _findCol(lower, /^trigger$/),
        triggerValue: _findCol(lower, /^trigger\s*value$/),
        recipients:   _findCol(lower, /^recipients?$/),
        enabled:      _findCol(lower, /^enabled$/),
      };
      return rows.map(function(row) {
        return {
          name:         cellValue(row, cols.name),
          watchCol:     cellValue(row, cols.watchCol),
          trigger:      (cellValue(row, cols.trigger) || 'any').toLowerCase().trim(),
          triggerValue: cellValue(row, cols.triggerValue),
          recipients:   splitRecipients(cellValue(row, cols.recipients)),
          enabled:      parseEnabledFlag(cellValue(row, cols.enabled)),
        };
      }).filter(function(r) { return r.watchCol && r.enabled; });
    }

    /* ---------- matchesRule ---------- */
    function matchesRule(rule, editedColumnName, newValue, oldValue) {
      if (!rule.enabled) return false;
      if (rule.watchCol.toLowerCase() !== editedColumnName.toLowerCase()) return false;
      var trigger = rule.trigger;
      if (trigger === 'any') return true;
      if (trigger === 'equals') {
        return newValue.toLowerCase() === rule.triggerValue.toLowerCase();
      }
      if (trigger === 'changes-to') {
        var changed = oldValue !== undefined && oldValue !== newValue;
        return changed && newValue.toLowerCase() === rule.triggerValue.toLowerCase();
      }
      return false;
    }

    window.__notifyHelpers = {
      parseNotifyRules,
      matchesRule,
      splitRecipients,
      parseEnabledFlag,
    };
  });
}

/* ================================================================
   Section 1: parseNotifyRules — rule parsing from config sheet
   ================================================================ */

test('gas notify parseNotifyRules parses standard column format correctly', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [
      ['Status done', 'Status', 'equals', 'Done', 'team@example.com', 'yes'],
    ];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Status done');
  expect(result[0].watchCol).toBe('Status');
  expect(result[0].trigger).toBe('equals');
  expect(result[0].triggerValue).toBe('Done');
  expect(result[0].recipients).toEqual(['team@example.com']);
  expect(result[0].enabled).toBe(true);
});

test('gas notify parseNotifyRules filters out disabled rules', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [
      ['Active rule', 'Status', 'any', '', 'a@b.com', 'yes'],
      ['Disabled rule', 'Status', 'any', '', 'a@b.com', 'no'],
    ];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Active rule');
});

test('gas notify parseNotifyRules filters out rows with no Watch Column', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [
      ['No watch col rule', '', 'any', '', 'a@b.com', 'yes'],
      ['Valid rule', 'Status', 'any', '', 'a@b.com', 'yes'],
    ];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Valid rule');
});

test('gas notify parseNotifyRules defaults trigger to any when blank', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [['Rule A', 'Status', '', '', 'x@y.com', 'yes']];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result[0].trigger).toBe('any');
});

test('gas notify parseNotifyRules handles multiple recipients split by comma', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [['Rule A', 'Status', 'any', '', 'a@b.com, c@d.com, e@f.com', 'yes']];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result[0].recipients).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
});

test('gas notify parseNotifyRules handles multiple recipients split by semicolon', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'];
    var rows = [['Rule A', 'Status', 'any', '', 'a@b.com;c@d.com', 'yes']];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result[0].recipients).toEqual(['a@b.com', 'c@d.com']);
});

test('gas notify parseNotifyRules matches Watch Col header case-insensitively', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var headers = ['Rule Name', 'Watch Col', 'Trigger', 'Trigger Value', 'Recipient', 'Enabled'];
    var rows = [['Rule', 'Status', 'any', '', 'x@y.com', 'yes']];
    return window.__notifyHelpers.parseNotifyRules(headers, rows);
  });
  expect(result).toHaveLength(1);
  expect(result[0].watchCol).toBe('Status');
});

test('gas notify parseNotifyRules returns empty array for empty rows', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    return window.__notifyHelpers.parseNotifyRules(
      ['Rule Name', 'Watch Column', 'Trigger', 'Trigger Value', 'Recipients', 'Enabled'],
      []
    );
  });
  expect(result).toHaveLength(0);
});

/* ================================================================
   Section 2: matchesRule — trigger matching
   ================================================================ */

test('gas notify matchesRule returns true for trigger=any on matching column', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'Status', trigger: 'any', triggerValue: '' };
    return window.__notifyHelpers.matchesRule(rule, 'Status', 'Done', 'Open');
  });
  expect(result).toBe(true);
});

test('gas notify matchesRule returns false when edited column does not match watchCol', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'Status', trigger: 'any', triggerValue: '' };
    return window.__notifyHelpers.matchesRule(rule, 'Priority', 'High', '');
  });
  expect(result).toBe(false);
});

test('gas notify matchesRule trigger=equals fires when newValue matches triggerValue', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'Status', trigger: 'equals', triggerValue: 'Done' };
    return window.__notifyHelpers.matchesRule(rule, 'Status', 'done', 'Open');
  });
  expect(result).toBe(true);
});

test('gas notify matchesRule trigger=equals does not fire when newValue differs', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'Status', trigger: 'equals', triggerValue: 'Done' };
    return window.__notifyHelpers.matchesRule(rule, 'Status', 'Open', 'Done');
  });
  expect(result).toBe(false);
});

test('gas notify matchesRule trigger=changes-to fires only when value changes', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'Status', trigger: 'changes-to', triggerValue: 'Done' };
    var fires = window.__notifyHelpers.matchesRule(rule, 'Status', 'Done', 'Open');
    var doesNotFire = window.__notifyHelpers.matchesRule(rule, 'Status', 'Done', 'Done');
    return { fires, doesNotFire };
  });
  expect(result.fires).toBe(true);
  expect(result.doesNotFire).toBe(false);
});

test('gas notify matchesRule column matching is case-insensitive', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    var rule = { enabled: true, watchCol: 'status', trigger: 'any', triggerValue: '' };
    return window.__notifyHelpers.matchesRule(rule, 'STATUS', 'Done', '');
  });
  expect(result).toBe(true);
});

/* ================================================================
   Section 3: splitRecipients and parseEnabledFlag — utility parsing
   ================================================================ */

test('gas notify splitRecipients splits on comma and trims whitespace', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => {
    return window.__notifyHelpers.splitRecipients('a@b.com , c@d.com');
  });
  expect(result).toEqual(['a@b.com', 'c@d.com']);
});

test('gas notify splitRecipients handles empty string', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => window.__notifyHelpers.splitRecipients(''));
  expect(result).toEqual([]);
});

test('gas notify parseEnabledFlag returns true for blank (default enabled)', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(() => window.__notifyHelpers.parseEnabledFlag(''));
  expect(result).toBe(true);
});

test('gas notify parseEnabledFlag returns false for no/false/0', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(async () => {
    var fn = window.__notifyHelpers.parseEnabledFlag;
    return {
      no:    fn('no'),
      NO:    fn('NO'),
      false: fn('false'),
      zero:  fn('0'),
    };
  });
  expect(result.no).toBe(false);
  expect(result.NO).toBe(false);
  expect(result.false).toBe(false);
  expect(result.zero).toBe(false);
});

test('gas notify parseEnabledFlag returns true for yes/true/1', async ({ page }) => {
  await setupApp(page);
  await injectNotifyHelpers(page);
  const result = await page.evaluate(async () => {
    var fn = window.__notifyHelpers.parseEnabledFlag;
    return {
      yes:  fn('yes'),
      YES:  fn('YES'),
      true: fn('true'),
      one:  fn('1'),
    };
  });
  expect(result.yes).toBe(true);
  expect(result.YES).toBe(true);
  expect(result.true).toBe(true);
  expect(result.one).toBe(true);
});
