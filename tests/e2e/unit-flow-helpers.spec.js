/**
 * Unit tests for public/js/templates/flow/helpers.js
 *
 * Tests pure functions: normaliseType, buildStepLookup, parseFlowGroups,
 * isPointInNode, and constants.
 */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ================================================================
   Section 1: Constants
   ================================================================ */

test('flow NODE_SHAPES has all 8 shape keys', async ({ page }) => {
  await setupApp(page);
  const shapes = await page.evaluate(async () => {
    const { NODE_SHAPES } = await import('/js/templates/flow/helpers.js');
    return Object.keys(NODE_SHAPES);
  });
  expect(shapes.sort()).toEqual(
    ['decision', 'delay', 'end', 'input', 'output', 'process', 'start', 'subprocess'].sort()
  );
});

test('flow NODE_SHAPES entries have label, color, icon', async ({ page }) => {
  await setupApp(page);
  const valid = await page.evaluate(async () => {
    const { NODE_SHAPES } = await import('/js/templates/flow/helpers.js');
    return Object.values(NODE_SHAPES).every(
      s => typeof s.label === 'string' && typeof s.color === 'string' && typeof s.icon === 'string'
    );
  });
  expect(valid).toBe(true);
});

test('flow constants have correct values', async ({ page }) => {
  await setupApp(page);
  const c = await page.evaluate(async () => {
    const { DEFAULT_TYPE, DRAG_THRESHOLD, NODE_W, NODE_H } = await import('/js/templates/flow/helpers.js');
    return { DEFAULT_TYPE, DRAG_THRESHOLD, NODE_W, NODE_H };
  });
  expect(c.DEFAULT_TYPE).toBe('process');
  expect(c.DRAG_THRESHOLD).toBe(5);
  expect(c.NODE_W).toBe(180);
  expect(c.NODE_H).toBe(56);
});

/* ================================================================
   Section 2: normaliseType
   ================================================================ */

test('normaliseType returns exact match for known types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseType } = await import('/js/templates/flow/helpers.js');
    return {
      start: normaliseType('start'),
      end: normaliseType('end'),
      process: normaliseType('process'),
      decision: normaliseType('decision'),
      input: normaliseType('input'),
      output: normaliseType('output'),
      delay: normaliseType('delay'),
      subprocess: normaliseType('subprocess'),
    };
  });
  expect(results.start).toBe('start');
  expect(results.end).toBe('end');
  expect(results.process).toBe('process');
  expect(results.decision).toBe('decision');
  expect(results.input).toBe('input');
  expect(results.output).toBe('output');
  expect(results.delay).toBe('delay');
  expect(results.subprocess).toBe('subprocess');
});

test('normaliseType fuzzy-matches aliases', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseType } = await import('/js/templates/flow/helpers.js');
    return {
      begin: normaliseType('begin'),
      trigger: normaliseType('trigger'),
      stop: normaliseType('stop'),
      finish: normaliseType('finish'),
      branch: normaliseType('branch'),
      condition: normaliseType('condition'),
      ifType: normaliseType('if'),
      gate: normaliseType('gate'),
      read: normaliseType('read'),
      receive: normaliseType('receive'),
      write: normaliseType('write'),
      display: normaliseType('display'),
      print: normaliseType('print'),
      wait: normaliseType('wait'),
      pause: normaliseType('pause'),
      timer: normaliseType('timer'),
      sub: normaliseType('sub'),
      call: normaliseType('call'),
      routine: normaliseType('routine'),
      action: normaliseType('action'),
      step: normaliseType('step'),
      task: normaliseType('task'),
      execute: normaliseType('execute'),
    };
  });
  expect(results.begin).toBe('start');
  expect(results.trigger).toBe('start');
  expect(results.stop).toBe('end');
  expect(results.finish).toBe('end');
  expect(results.branch).toBe('decision');
  expect(results.condition).toBe('decision');
  expect(results.ifType).toBe('decision');
  expect(results.gate).toBe('decision');
  expect(results.read).toBe('input');
  expect(results.receive).toBe('input');
  expect(results.write).toBe('output');
  expect(results.display).toBe('output');
  expect(results.print).toBe('output');
  expect(results.wait).toBe('delay');
  expect(results.pause).toBe('delay');
  expect(results.timer).toBe('delay');
  expect(results.sub).toBe('subprocess');
  expect(results.call).toBe('subprocess');
  expect(results.routine).toBe('subprocess');
  expect(results.action).toBe('process');
  expect(results.step).toBe('process');
  expect(results.task).toBe('process');
  expect(results.execute).toBe('process');
});

test('normaliseType defaults to process for unknown types', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseType } = await import('/js/templates/flow/helpers.js');
    return {
      unknown: normaliseType('whatever'),
      empty: normaliseType(''),
      nullVal: normaliseType(null),
      undef: normaliseType(undefined),
    };
  });
  expect(results.unknown).toBe('process');
  expect(results.empty).toBe('process');
  expect(results.nullVal).toBe('process');
  expect(results.undef).toBe('process');
});

test('normaliseType is case-insensitive', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { normaliseType } = await import('/js/templates/flow/helpers.js');
    return {
      Start: normaliseType('Start'),
      DECISION: normaliseType('DECISION'),
      Delay: normaliseType('Delay'),
    };
  });
  expect(results.Start).toBe('start');
  expect(results.DECISION).toBe('decision');
  expect(results.Delay).toBe('delay');
});

/* ================================================================
   Section 3: buildStepLookup
   ================================================================ */

test('buildStepLookup creates map keyed by lowercase step names', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildStepLookup } = await import('/js/templates/flow/helpers.js');
    const steps = [
      { step: 'Start Here', type: 'start' },
      { step: 'Process Data', type: 'process' },
      { step: '', type: 'end' },
    ];
    const map = buildStepLookup(steps);
    return {
      size: map.size,
      hasStart: map.has('start here'),
      hasProcess: map.has('process data'),
      startType: map.get('start here')?.type,
    };
  });
  expect(result.size).toBe(2); // empty step is skipped
  expect(result.hasStart).toBe(true);
  expect(result.hasProcess).toBe(true);
  expect(result.startType).toBe('start');
});

/* ================================================================
   Section 4: parseFlowGroups
   ================================================================ */

test('parseFlowGroups groups rows by flow name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseFlowGroups } = await import('/js/templates/flow/helpers.js');
    const rows = [
      ['Login Flow', 'Enter email', 'input', 'Validate', ''],
      ['', 'Validate', 'decision', 'Success', 'Invalid → Enter email'],
      ['', 'Success', 'end', '', ''],
      ['Signup Flow', 'Create account', 'process', 'Verify', ''],
      ['', 'Verify', 'output', '', ''],
    ];
    const cols = { flow: 0, step: 1, type: 2, next: 3, condition: 4, notes: -1 };
    const groups = parseFlowGroups(rows, cols);
    return groups.map(g => ({
      name: g.name,
      stepCount: g.steps.length,
      stepNames: g.steps.map(s => s.step),
    }));
  });
  expect(result).toHaveLength(2);
  expect(result[0].name).toBe('Login Flow');
  expect(result[0].stepCount).toBe(3);
  expect(result[0].stepNames).toEqual(['Enter email', 'Validate', 'Success']);
  expect(result[1].name).toBe('Signup Flow');
  expect(result[1].stepCount).toBe(2);
});

test('parseFlowGroups creates default group when no flow name', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseFlowGroups } = await import('/js/templates/flow/helpers.js');
    const rows = [
      ['', 'Step A', 'process', '', ''],
      ['', 'Step B', 'end', '', ''],
    ];
    const cols = { flow: 0, step: 1, type: 2, next: 3, condition: 4, notes: -1 };
    const groups = parseFlowGroups(rows, cols);
    return { count: groups.length, name: groups[0].name };
  });
  expect(result.count).toBe(1);
  expect(result.name).toBe('Flow'); // default name
});

test('parseFlowGroups normalises step types', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseFlowGroups } = await import('/js/templates/flow/helpers.js');
    const rows = [
      ['Flow', 'Begin', 'trigger', '', ''],
      ['', 'Check', 'condition', '', ''],
    ];
    const cols = { flow: 0, step: 1, type: 2, next: 3, condition: 4, notes: -1 };
    return parseFlowGroups(rows, cols)[0].steps.map(s => s.type);
  });
  expect(result).toEqual(['start', 'decision']);
});

/* ================================================================
   Section 5: isPointInNode
   ================================================================ */

test('isPointInNode detects point inside node bounds', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isPointInNode } = await import('/js/templates/flow/helpers.js');
    const node = { x: 100, y: 100, w: 180, h: 56 };
    return {
      inside: isPointInNode({ x: 150, y: 120 }, node),
      outsideLeft: isPointInNode({ x: 50, y: 120 }, node),
      outsideRight: isPointInNode({ x: 300, y: 120 }, node),
      outsideAbove: isPointInNode({ x: 150, y: 50 }, node),
      outsideBelow: isPointInNode({ x: 150, y: 200 }, node),
      onEdge: isPointInNode({ x: 100, y: 100 }, node),
    };
  });
  expect(results.inside).toBe(true);
  expect(results.outsideLeft).toBe(false);
  expect(results.outsideRight).toBe(false);
  expect(results.outsideAbove).toBe(false);
  expect(results.outsideBelow).toBe(false);
  expect(results.onEdge).toBe(true);
});

test('isPointInNode accounts for 12px vertical padding', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isPointInNode } = await import('/js/templates/flow/helpers.js');
    const node = { x: 0, y: 100, w: 100, h: 50 };
    return {
      // y range is [100-12, 100+50+12] = [88, 162]
      abovePadding: isPointInNode({ x: 50, y: 87 }, node),
      inPadding: isPointInNode({ x: 50, y: 88 }, node),
      belowNode: isPointInNode({ x: 50, y: 162 }, node),
      pastPadding: isPointInNode({ x: 50, y: 163 }, node),
    };
  });
  expect(results.abovePadding).toBe(false);
  expect(results.inPadding).toBe(true);
  expect(results.belowNode).toBe(true);
  expect(results.pastPadding).toBe(false);
});
