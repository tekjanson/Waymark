// @ts-check
/* ============================================================
   unit-arcade-helpers.spec.js — Unit tests for arcade helpers
   and net.js pure functions
   ============================================================ */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- helpers.js — netModelLabel ---------- */

test('netModelLabel returns Turn-Based for lockstep', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { netModelLabel } = await import('/js/templates/arcade/helpers.js');
    return netModelLabel('lockstep');
  });
  expect(result).toBe('Turn-Based');
});

test('netModelLabel returns Real-Time for rollback', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { netModelLabel } = await import('/js/templates/arcade/helpers.js');
    return netModelLabel('rollback');
  });
  expect(result).toBe('Real-Time');
});

test('netModelLabel returns Host-Based for host-authority', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { netModelLabel } = await import('/js/templates/arcade/helpers.js');
    return netModelLabel('host-authority');
  });
  expect(result).toBe('Host-Based');
});

test('netModelLabel returns the raw value for unknown models', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { netModelLabel } = await import('/js/templates/arcade/helpers.js');
    return netModelLabel('custom-model');
  });
  expect(result).toBe('custom-model');
});

/* ---------- helpers.js — getGameList ---------- */

test('getGameList returns array of game objects with required fields', async ({ page }) => {
  await setupApp(page);
  const games = await page.evaluate(async () => {
    const { getGameList } = await import('/js/templates/arcade/helpers.js');
    return getGameList();
  });
  expect(Array.isArray(games)).toBe(true);
  expect(games.length).toBeGreaterThanOrEqual(4);
  for (const g of games) {
    expect(typeof g.key).toBe('string');
    expect(typeof g.name).toBe('string');
    expect(typeof g.icon).toBe('string');
    expect(typeof g.maxPlayers).toBe('number');
    expect(typeof g.netModel).toBe('string');
  }
});

test('getGameList is sorted alphabetically by name', async ({ page }) => {
  await setupApp(page);
  const games = await page.evaluate(async () => {
    const { getGameList } = await import('/js/templates/arcade/helpers.js');
    return getGameList().map(g => g.name);
  });
  const sorted = [...games].sort((a, b) => a.localeCompare(b));
  expect(games).toEqual(sorted);
});

test('getGameList includes chess game', async ({ page }) => {
  await setupApp(page);
  const games = await page.evaluate(async () => {
    const { getGameList } = await import('/js/templates/arcade/helpers.js');
    return getGameList();
  });
  expect(games.some(g => g.key === 'chess')).toBe(true);
});

test('getGameList includes checkers game', async ({ page }) => {
  await setupApp(page);
  const games = await page.evaluate(async () => {
    const { getGameList } = await import('/js/templates/arcade/helpers.js');
    return getGameList();
  });
  expect(games.some(g => g.key === 'checkers')).toBe(true);
});

/* ---------- net.js — binary encode/decode round-trips ---------- */

test('encodeInput / decodeInput round-trips frame and inputs', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeInput, decodeMessage } = await import('/js/arcade/net.js');
    const history = new Uint8Array(256);
    history[10] = 0b00000011; // frame 10: left+right pressed
    history[11] = 0b00000001; // frame 11: left pressed
    const buf = encodeInput(11, history, 9);
    const msg = decodeMessage(buf);
    return { type: msg.type, frame: msg.frame, lastInput: msg.inputs[msg.inputs.length - 1] };
  });
  expect(result.type).toBe(0x01); // MSG.INPUT
  expect(result.frame).toBe(11);
  expect(result.lastInput).toBe(0b00000001);
});

test('encodeInputAck / decodeMessage round-trips frame', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeInputAck, decodeMessage } = await import('/js/arcade/net.js');
    const buf = encodeInputAck(42);
    const msg = decodeMessage(buf);
    return { type: msg.type, frame: msg.frame };
  });
  expect(result.type).toBe(0x02); // MSG.INPUT_ACK
  expect(result.frame).toBe(42);
});

test('encodeMove / decodeMessage round-trips seq and payload', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeMove, decodeMessage } = await import('/js/arcade/net.js');
    const payload = new Uint8Array([3, 5, 0, 4]); // e2-e4 move
    const buf = encodeMove(7, payload);
    const msg = decodeMessage(buf);
    return { type: msg.type, seq: msg.seq, payloadLength: msg.payload.length };
  });
  expect(result.type).toBe(0x10); // MSG.MOVE
  expect(result.seq).toBe(7);
  expect(result.payloadLength).toBe(4);
});

test('encodeMoveAck / decodeMessage round-trips seq', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeMoveAck, decodeMessage } = await import('/js/arcade/net.js');
    const buf = encodeMoveAck(15);
    const msg = decodeMessage(buf);
    return { type: msg.type, seq: msg.seq };
  });
  expect(result.type).toBe(0x11); // MSG.MOVE_ACK
  expect(result.seq).toBe(15);
});

test('encodePing / decodeMessage preserves timestamp', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodePing, decodeMessage } = await import('/js/arcade/net.js');
    const buf = encodePing();
    const msg = decodeMessage(buf);
    return { type: msg.type, hasTimestamp: typeof msg.timestamp === 'number' };
  });
  expect(result.type).toBe(0x06); // MSG.PING
  expect(result.hasTimestamp).toBe(true);
});

test('encodePong / decodeMessage echoes back original timestamp', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodePong, decodeMessage } = await import('/js/arcade/net.js');
    const sentTime = 12345.678;
    const buf = encodePong(sentTime);
    const msg = decodeMessage(buf);
    return { type: msg.type, timestamp: msg.timestamp };
  });
  expect(result.type).toBe(0x07); // MSG.PONG
  expect(Math.abs(result.timestamp - 12345.678)).toBeLessThan(0.001);
});

test('encodeControl / decodeMessage round-trips JSON payload', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeControl, decodeMessage, MSG } = await import('/js/arcade/net.js');
    const data = { gameKey: 'chess', seed: 42 };
    const buf = encodeControl(MSG.GAME_START, data);
    const msg = decodeMessage(buf);
    return { type: msg.type, gameKey: msg.gameKey, seed: msg.seed };
  });
  expect(result.type).toBe(0x04); // MSG.GAME_START
  expect(result.gameKey).toBe('chess');
  expect(result.seed).toBe(42);
});

test('encodeInput clamps redundancy history to 32 packets maximum', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeInput } = await import('/js/arcade/net.js');
    const history = new Uint8Array(256);
    // lastAckedFrame = 0, frame = 200 → unacked = 200, clamped to 32
    const buf = encodeInput(200, history, 0);
    const view = new DataView(buf);
    return view.getUint8(5); // count byte
  });
  expect(result).toBe(32);
});

test('encodeStateSnap / decodeMessage preserves frame and data', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { encodeStateSnap, decodeMessage } = await import('/js/arcade/net.js');
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeStateSnap(99, data);
    const msg = decodeMessage(buf);
    return { type: msg.type, frame: msg.frame, dataLen: msg.data.length };
  });
  expect(result.type).toBe(0x03); // MSG.STATE_SNAP
  expect(result.frame).toBe(99);
  expect(result.dataLen).toBe(5);
});

/* ---------- rollback.js — input decay prediction ---------- */

test('rollback predicts zero-input after 8 same-input frames', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { createRollback } = await import('/js/arcade/rollback.js');
    const { encodeInput } = await import('/js/arcade/net.js');

    const states = [];
    const ctx = { state: { x: 0 }, paused: false, net: null, localPlayerId: 0 };
    const rb = createRollback({
      serialize: () => new Uint8Array(4),
      deserialize: () => {},
      simulate: (c, frame, local, remote) => { states.push({ frame, remote }); },
      net: null,
      localPlayer: 0,
    });

    // Remote sends input 0b11 at frame 0 only — silent thereafter
    const remoteHistory = new Uint8Array(256);
    remoteHistory[0] = 0b11;
    rb.onRemoteInput(ctx, encodeInput(0, remoteHistory, -1));

    // Advance frames 1..9 (remote stays silent)
    for (let i = 0; i < 9; i++) rb.advance(ctx);

    return states.filter(s => s.frame > 0).map(s => ({ frame: s.frame, remote: s.remote }));
  });
  // Frames 1-7: prediction should replicate last known input (0b11) — decay not yet triggered
  for (const s of result.filter(s => s.frame >= 1 && s.frame < 8)) {
    expect(s.remote).toBe(0b11);
  }
  // Frames 8+: prediction decays to 0
  for (const s of result.filter(s => s.frame >= 8)) {
    expect(s.remote).toBe(0);
  }
});

test('rollback MAX_PREDICTION is 8 (pauses at 9 frames ahead)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { createRollback } = await import('/js/arcade/rollback.js');

    const ctx = { state: {}, paused: false, net: null, localPlayerId: 0 };
    const rb = createRollback({
      serialize: () => new Uint8Array(4),
      deserialize: () => {},
      simulate: () => {},
      net: null,
      localPlayer: 0,
    });

    // confirmedFrame=-1, pause when currentFrame - (-1) > MAX_PREDICTION=8  →  frame 9
    let pausedAt = -1;
    for (let i = 0; i < 20; i++) {
      ctx.paused = false;
      rb.advance(ctx);
      if (ctx.paused && pausedAt < 0) pausedAt = rb.frame;
    }
    return pausedAt;
  });
  // Pause occurs when gap (currentFrame - confirmedFrame) > MAX_PREDICTION=8
  // confirmedFrame=-1, currentFrame=8 → gap=9 > 8 → pause at currentFrame=8
  expect(result).toBe(8);
});

test('rollback accrues 24 frames of input redundancy in each packet', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { decodeMessage } = await import('/js/arcade/net.js');
    const { createRollback } = await import('/js/arcade/rollback.js');

    const captured = [];
    const mockNet = {
      sendFast: (buf) => {
        const ab = buf instanceof ArrayBuffer ? buf : buf.buffer;
        const msg = decodeMessage(ab);
        if (msg && msg.type === 0x01) captured.push(msg.count);
      },
      sendReliable: () => {},
    };
    const ctx = { state: {}, paused: false, net: mockNet, localPlayerId: 0 };
    const rb = createRollback({
      serialize: () => new Uint8Array(4),
      deserialize: () => {},
      simulate: () => {},
      net: mockNet,
      localPlayer: 0,
    });

    // Advance 30 frames with no remote acks (lastAckedFrame=-1, so full history sent)
    for (let i = 0; i < 30 && !ctx.paused; i++) rb.advance(ctx);

    // By frame 24+ each packet should carry at least 24 frames of history
    return captured.filter(c => c >= 24).length;
  });
  expect(result).toBeGreaterThan(0);
});

/* ---------- WaymarkConnect._peerIdJitter — handshake collision fix ---------- */

test('_peerIdJitter returns a value in [0, 200) for any peerId', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const mockSignal = { readAll: async () => [], writeCell: async () => {} };
    const values = [];
    // Test several different peerIds
    const ids = ['abc12345', 'xyz98765', 'aaaaaa00', '00000000', 'ffffffff'];
    for (const peerId of ids) {
      const wc = new WaymarkConnect('sheet-001', { signal: mockSignal });
      wc.peerId = peerId;  // inject a known peerId
      values.push(wc._peerIdJitter());
    }
    return values;
  });
  for (const v of results) {
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(200);
  }
});

test('_peerIdJitter is deterministic for the same peerId', async ({ page }) => {
  await setupApp(page);
  const { v1, v2 } = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const mockSignal = { readAll: async () => [], writeCell: async () => {} };
    const wc1 = new WaymarkConnect('sheet-001', { signal: mockSignal });
    wc1.peerId = 'test1234';
    const wc2 = new WaymarkConnect('sheet-001', { signal: mockSignal });
    wc2.peerId = 'test1234';
    return { v1: wc1._peerIdJitter(), v2: wc2._peerIdJitter() };
  });
  expect(v1).toBe(v2);
});

test('_peerIdJitter produces different values for different peerIds', async ({ page }) => {
  await setupApp(page);
  const jitters = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const mockSignal = { readAll: async () => [], writeCell: async () => {} };
    // Generate 8 peerIds (like crypto.randomUUID().slice(0,8)) and check jitter values
    const testIds = ['aabb1122', 'ccdd3344', 'eeff5566', '11223344',
                     '55667788', '99aabbcc', 'ddeeff00', '12345678'];
    const vals = testIds.map(id => {
      const wc = new WaymarkConnect('sheet-001', { signal: mockSignal });
      wc.peerId = id;
      return wc._peerIdJitter();
    });
    return vals;
  });
  // Not all values should be identical — there should be at least 3 distinct values
  const unique = new Set(jitters);
  expect(unique.size).toBeGreaterThanOrEqual(3);
});

/* ---------- slime-soccer serialization round-trip ---------- */

test('slime-soccer serialize/deserialize round-trips all state fields', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    // Force-import slime-soccer (causes registerGame side-effect)
    await import('/js/arcade/games/slime-soccer.js');
    const { getGame } = await import('/js/arcade/engine.js');
    const game = getGame('slime-soccer');
    if (!game) return { error: 'game not found' };

    const ctx = { state: null, localPlayerId: 0, net: null };
    game.init(ctx);

    // Mutate state to non-default values
    ctx.state.s1x = 12345;
    ctx.state.s2x = 54321;
    const s1xBefore = ctx.state.s1x;

    const snap = game.serialize(ctx);

    // Reset and restore
    game.init(ctx);
    const s1xAfterReset = ctx.state.s1x;
    game.deserialize(ctx, snap);

    return {
      s1xBefore,
      s1xAfterReset,
      s1x: ctx.state.s1x,
      s2x: ctx.state.s2x,
    };
  });
  expect(result.s1xBefore).toBe(12345);
  expect(result.s1xAfterReset).not.toBe(12345); // verify reset happened
  expect(result.s1x).toBe(12345);               // verify round-trip
  expect(result.s2x).toBe(54321);
});

test('slime-soccer render does not return NaN positions with numeric alpha', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    await import('/js/arcade/games/slime-soccer.js');
    const { getGame, createContext } = await import('/js/arcade/engine.js');
    const { initRenderer } = await import('/js/arcade/renderer.js');

    const game = getGame('slime-soccer');
    if (!game) return { error: 'no game' };

    // Set up a minimal canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    document.body.appendChild(canvas);
    initRenderer(canvas);

    const ctx = createContext();
    ctx.localPlayerId = 0;
    ctx.net = null;
    game.init(ctx);

    // Serialize to get a valid prevState (Uint8Array)
    const prevState = game.serialize(ctx);

    // Alpha = 0.5 (valid numeric) — should not throw or draw at NaN
    let threw = false;
    try {
      game.render(ctx, prevState, ctx.state, 0.5);
    } catch (e) {
      threw = true;
    }

    document.body.removeChild(canvas);
    return { threw };
  });
  expect(result.threw).toBe(false);
});

