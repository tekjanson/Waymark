/* ============================================================
   arcade/engine.js — Core game engine: loop, scenes, registration
   ============================================================ */

/* ---------- Game Registry ---------- */

/** @type {Map<string, Object>} */
const GAMES = new Map();

/**
 * Register a game module.
 * @param {Object} def — game definition
 * @param {string} def.key — unique game identifier
 * @param {string} def.name — display name
 * @param {string} def.description — short tagline
 * @param {string} def.icon — emoji icon
 * @param {number} def.maxPlayers — max simultaneous players
 * @param {number} def.tickRate — simulation Hz (usually 60)
 * @param {string} def.netModel — 'lockstep' | 'rollback' | 'host-authority'
 * @param {string[]} def.inputSchema — named buttons
 * @param {function} def.init — (ctx) => void
 * @param {function} def.update — (ctx, frame, inputs) => void
 * @param {function} def.render — (ctx, prev, curr, alpha) => void
 * @param {function} def.serialize — (ctx) => ArrayBuffer
 * @param {function} def.deserialize — (ctx, ArrayBuffer) => void
 * @param {function} [def.cleanup] — (ctx) => void
 * @param {function} [def.onInput] — (ctx, type, data) => void  (mouse/click input)
 */
export function registerGame(def) {
  if (!def.key) throw new Error('Game definition must have a key');
  GAMES.set(def.key, def);
}

/**
 * Get a registered game by key.
 * @param {string} key
 * @returns {Object|undefined}
 */
export function getGame(key) {
  return GAMES.get(key);
}

/**
 * Get all registered games.
 * @returns {Map<string, Object>}
 */
export function getGames() {
  return GAMES;
}

/* ---------- Scene Management ---------- */

const _scenes = new Map();
let _activeScene = null;
let _activeSceneName = '';

/**
 * Register a scene.
 * @param {string} name
 * @param {{ init?: function, update?: function, render?: function, cleanup?: function }} scene
 */
export function registerScene(name, scene) {
  _scenes.set(name, scene);
}

/**
 * Switch to a named scene.
 * @param {string} name
 * @param {*} [data] — passed to scene.init()
 */
export function switchScene(name, data) {
  if (_activeScene && _activeScene.cleanup) _activeScene.cleanup(data);
  _activeScene = _scenes.get(name) || null;
  _activeSceneName = name;
  if (_activeScene && _activeScene.init) _activeScene.init(data);
}

/**
 * Get current scene name.
 * @returns {string}
 */
export function currentScene() {
  return _activeSceneName;
}

/* ---------- Engine Context ---------- */

/**
 * Create a fresh engine context that holds all runtime state.
 * @returns {Object}
 */
export function createContext() {
  return {
    canvas: null,
    running: false,
    game: null,
    gameKey: '',
    localPlayerId: 0,      // 0 = player 1, 1 = player 2
    remotePeerId: '',
    net: null,              // ArcadeNet instance
    renderer: null,         // renderer module ref
    input: null,            // input module ref
    rollback: null,         // rollback state (if applicable)
    frame: 0,
    simTime: 0,
    state: null,            // current game state (game-specific)
    prevState: null,        // previous game state (for interpolation)
    rtt: 100,               // current RTT estimate (ms)
    ended: false,
    paused: false,
    _rafId: 0,
    _lastTimestamp: 0,
    _accumulator: 0,
  };
}

/* ---------- Fixed-Timestep Game Loop ---------- */

const MAX_FRAME_TIME = 250;   // cap to prevent spiral of death

/**
 * Start the fixed-timestep game loop.
 * @param {Object} ctx — engine context
 */
export function startLoop(ctx) {
  if (ctx.running) return;
  ctx.running = true;
  ctx._lastTimestamp = performance.now();
  ctx._accumulator = 0;

  const dt = 1000 / ctx.game.tickRate;

  function tick(timestamp) {
    if (!ctx.running) return;
    ctx._rafId = requestAnimationFrame(tick);

    let frameTime = timestamp - ctx._lastTimestamp;
    ctx._lastTimestamp = timestamp;
    if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

    ctx._accumulator += frameTime;

    // Fixed-step simulation
    while (ctx._accumulator >= dt) {
      ctx.prevState = ctx.game.serialize(ctx);

      // Process network messages
      if (ctx.net && ctx.net.processIncoming) {
        ctx.net.processIncoming(ctx);
      }

      // Tick the active scene or game
      if (_activeScene && _activeScene.update) {
        _activeScene.update(ctx);
      }

      ctx.frame++;
      ctx.simTime += dt;
      ctx._accumulator -= dt;
    }

    // Render with interpolation alpha
    const alpha = ctx._accumulator / dt;
    if (_activeScene && _activeScene.render) {
      _activeScene.render(ctx, alpha);
    }
  }

  ctx._rafId = requestAnimationFrame(tick);
}

/**
 * Stop the game loop.
 * @param {Object} ctx — engine context
 */
export function stopLoop(ctx) {
  ctx.running = false;
  if (ctx._rafId) {
    cancelAnimationFrame(ctx._rafId);
    ctx._rafId = 0;
  }
}

/* ---------- Seeded PRNG (xoshiro128**) ---------- */

/**
 * Create a seeded PRNG for deterministic randomness.
 * @param {number} seed — 32-bit integer seed
 * @returns {{ next: () => number, nextInt: (min, max) => number }}
 */
export function createRNG(seed) {
  // Splitmix32 to expand seed into 4 state words
  let s0, s1, s2, s3;
  function splitmix32(a) {
    a |= 0;
    a = a + 0x9e3779b9 | 0;
    let t = a ^ a >>> 16;
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t = t ^ t >>> 15;
    return t >>> 0;
  }
  s0 = splitmix32(seed);
  s1 = splitmix32(s0);
  s2 = splitmix32(s1);
  s3 = splitmix32(s2);

  function rotl(x, k) {
    return (x << k) | (x >>> (32 - k));
  }

  /**
   * Next random 32-bit unsigned integer.
   * @returns {number}
   */
  function nextU32() {
    const result = rotl(Math.imul(s1, 5), 7) * 9;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result >>> 0;
  }

  return {
    /** @returns {number} float in [0, 1) */
    next() {
      return nextU32() / 4294967296;
    },
    /**
     * Random integer in [min, max] inclusive.
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    nextInt(min, max) {
      return min + (nextU32() % (max - min + 1));
    },
  };
}
