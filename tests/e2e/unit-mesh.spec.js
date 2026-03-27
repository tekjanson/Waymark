const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   unit-mesh.spec.js — Unit tests for mesh.js pure functions
   ============================================================ */

test('createCommand returns valid command shape', async ({ page }) => {
  await setupApp(page);
  const cmd = await page.evaluate(async () => {
    const { createCommand } = await import('/js/mesh.js');
    return createCommand('peer-abc', 'cellUpdate', { row: 3, col: 'B', value: 'test' });
  });
  expect(cmd.id).toBeTruthy();
  expect(cmd.action).toBe('cellUpdate');
  expect(cmd.from).toBe('peer-abc');
  expect(cmd.timestamp).toBeGreaterThan(0);
  expect(cmd.payload.row).toBe(3);
  expect(cmd.payload.col).toBe('B');
  expect(cmd.payload.value).toBe('test');
});

test('createCommand generates unique IDs', async ({ page }) => {
  await setupApp(page);
  const ids = await page.evaluate(async () => {
    const { createCommand } = await import('/js/mesh.js');
    const cmds = Array.from({ length: 10 }, () => createCommand('p1', 'test', {}));
    return cmds.map(c => c.id);
  });
  const unique = new Set(ids);
  expect(unique.size).toBe(10);
});

test('isValidCommand accepts well-formed commands', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { isValidCommand } = await import('/js/mesh.js');
    return isValidCommand({
      id: 'abc-123',
      action: 'cellUpdate',
      timestamp: Date.now(),
      from: 'peer1',
      payload: {},
    });
  });
  expect(result).toBe(true);
});

test('isValidCommand rejects missing fields', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isValidCommand } = await import('/js/mesh.js');
    return {
      noId: isValidCommand({ action: 'x', timestamp: 1, from: 'p' }),
      noAction: isValidCommand({ id: 'x', timestamp: 1, from: 'p' }),
      noTimestamp: isValidCommand({ id: 'x', action: 'x', from: 'p' }),
      noFrom: isValidCommand({ id: 'x', action: 'x', timestamp: 1 }),
      nullInput: isValidCommand(null),
      undefinedInput: isValidCommand(undefined),
      emptyObj: isValidCommand({}),
    };
  });
  expect(results.noId).toBe(false);
  expect(results.noAction).toBe(false);
  expect(results.noTimestamp).toBe(false);
  expect(results.noFrom).toBe(false);
  expect(results.nullInput).toBe(false);
  expect(results.undefinedInput).toBe(false);
  expect(results.emptyObj).toBe(false);
});

test('isDuplicate detects existing command IDs', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { isDuplicate } = await import('/js/mesh.js');
    const log = new Map();
    log.set('cmd-1', { action: 'test', timestamp: 1, from: 'p1' });
    log.set('cmd-2', { action: 'test', timestamp: 2, from: 'p1' });
    return {
      existing: isDuplicate(log, 'cmd-1'),
      missing: isDuplicate(log, 'cmd-99'),
    };
  });
  expect(results.existing).toBe(true);
  expect(results.missing).toBe(false);
});

test('trimCommandLog trims to max size', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { trimCommandLog } = await import('/js/mesh.js');
    const log = new Map();
    for (let i = 0; i < 20; i++) {
      log.set(`cmd-${i}`, { action: 'test', timestamp: i, from: 'p1' });
    }
    trimCommandLog(log, 5);
    return {
      size: log.size,
      hasFirst: log.has('cmd-0'),
      hasLast: log.has('cmd-19'),
      has15: log.has('cmd-15'),
    };
  });
  expect(result.size).toBe(5);
  expect(result.hasFirst).toBe(false);
  expect(result.hasLast).toBe(true);
  expect(result.has15).toBe(true);
});

test('trimCommandLog does nothing when under max', async ({ page }) => {
  await setupApp(page);
  const size = await page.evaluate(async () => {
    const { trimCommandLog } = await import('/js/mesh.js');
    const log = new Map();
    log.set('a', {});
    log.set('b', {});
    trimCommandLog(log, 10);
    return log.size;
  });
  expect(size).toBe(2);
});

/* ---------- Storage helpers (mesh settings) ---------- */

test('getMeshEnabled defaults to false', async ({ page }) => {
  await setupApp(page);
  const val = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return s.getMeshEnabled();
  });
  expect(val).toBe(false);
});

test('setMeshEnabled persists and reads correctly', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    s.setMeshEnabled(true);
    const after = s.getMeshEnabled();
    s.setMeshEnabled(false);
    const afterOff = s.getMeshEnabled();
    return { after, afterOff };
  });
  expect(results.after).toBe(true);
  expect(results.afterOff).toBe(false);
});

test('getMeshPeerId generates and persists a peer ID', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    const id1 = s.getMeshPeerId();
    const id2 = s.getMeshPeerId();
    return { id1, id2, match: id1 === id2 };
  });
  expect(results.id1).toBeTruthy();
  expect(results.id1.length).toBe(12);
  expect(results.match).toBe(true);
});

test('getMeshMaxPeers defaults to 10', async ({ page }) => {
  await setupApp(page);
  const val = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return s.getMeshMaxPeers();
  });
  expect(val).toBe(10);
});

test('setMeshMaxPeers clamps to valid range', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    s.setMeshMaxPeers(0);
    const low = s.getMeshMaxPeers();
    s.setMeshMaxPeers(100);
    const high = s.getMeshMaxPeers();
    s.setMeshMaxPeers(5);
    const normal = s.getMeshMaxPeers();
    return { low, high, normal };
  });
  expect(results.low).toBe(1);
  expect(results.high).toBe(50);
  expect(results.normal).toBe(5);
});

test('getMeshTimeout defaults to 30000', async ({ page }) => {
  await setupApp(page);
  const val = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return s.getMeshTimeout();
  });
  expect(val).toBe(30000);
});

test('getMeshHeartbeat defaults to 15000', async ({ page }) => {
  await setupApp(page);
  const val = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return s.getMeshHeartbeat();
  });
  expect(val).toBe(15000);
});

test('getMeshWorkerConcurrency defaults to 3', async ({ page }) => {
  await setupApp(page);
  const val = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return s.getMeshWorkerConcurrency();
  });
  expect(val).toBe(3);
});

test('all mesh sub-feature toggles default to false', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    return {
      taskQueue: s.getMeshTaskQueueEnabled(),
      crdt: s.getMeshCrdtEnabled(),
      evalFarm: s.getMeshEvalFarmEnabled(),
      swarm: s.getMeshSwarmEnabled(),
    };
  });
  expect(results.taskQueue).toBe(false);
  expect(results.crdt).toBe(false);
  expect(results.evalFarm).toBe(false);
  expect(results.swarm).toBe(false);
});
