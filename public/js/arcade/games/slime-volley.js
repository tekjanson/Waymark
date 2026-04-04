/* ============================================================
   arcade/games/slime-volley.js — Slime Volleyball with rollback
   ============================================================

   All physics uses integer fixed-point (×100) for determinism.
   Virtual resolution: 640 × 360.
   ============================================================ */

import { registerGame } from '../engine.js';
import {
  VIRTUAL_W, VIRTUAL_H, clear, drawRect, drawCircle,
  drawText, drawLine, drawHalfCircle, drawRoundRect,
} from '../renderer.js';
import { INPUT } from '../input.js';
import { SCALE, toFixed, toFloat, clamp } from '../physics.js';

/* ---------- World Constants (fixed-point ×100) ---------- */

const W = toFixed(VIRTUAL_W);      // 64000
const H = toFixed(VIRTUAL_H);      // 36000

const FLOOR_Y = toFixed(320);      // ground level
const NET_X = W / 2;               // centre
const NET_W = toFixed(4);
const NET_H = toFixed(100);
const NET_TOP = FLOOR_Y - NET_H;

const SLIME_R = toFixed(35);
const SLIME_SPEED = toFixed(4);
const SLIME_JUMP_V = toFixed(-8);

const BALL_R = toFixed(12);
const BALL_START_Y = toFixed(100);

const GRAVITY = toFixed(0.35);
const BALL_GRAVITY = toFixed(0.25);
const RESTITUTION = 80;            // 0.80 in fixed-point (out of 100)
const SLIME_BOUNCE = 110;          // 1.10 — slimes add energy

const SCORE_TO_WIN = 7;

/* ---------- State ---------- */

function createState() {
  return {
    // Slime 1 (left, player 0)
    s1x: toFixed(160), s1y: FLOOR_Y, s1vx: 0, s1vy: 0,
    // Slime 2 (right, player 1)
    s2x: toFixed(480), s2y: FLOOR_Y, s2vx: 0, s2vy: 0,
    // Ball
    bx: toFixed(160), by: BALL_START_Y, bvx: 0, bvy: 0,
    // Scores
    score1: 0, score2: 0,
    // Game phase
    phase: 'serve',          // 'serve' | 'play' | 'point' | 'gameover'
    serving: 0,              // which player serves
    pointTimer: 0,           // frames until next serve after scoring
    winner: -1,
  };
}

/* ---------- Simulation ---------- */

function simulate(ctx, frame, localInput, remoteInput) {
  const st = ctx.state;
  if (st.phase === 'gameover') return;

  // Map inputs to player index
  const p0input = ctx.localPlayerId === 0 ? localInput : remoteInput;
  const p1input = ctx.localPlayerId === 1 ? localInput : remoteInput;

  if (st.phase === 'point') {
    st.pointTimer--;
    if (st.pointTimer <= 0) {
      resetForServe(st);
    }
    return;
  }

  if (st.phase === 'serve') {
    // Ball follows serving slime
    if (st.serving === 0) {
      st.bx = st.s1x;
      st.by = st.s1y - SLIME_R - BALL_R - toFixed(5);
    } else {
      st.bx = st.s2x;
      st.by = st.s2y - SLIME_R - BALL_R - toFixed(5);
    }
    // Any input from serving player starts play
    const serveInput = st.serving === 0 ? p0input : p1input;
    if (serveInput & (INPUT.UP | INPUT.ACTION1)) {
      st.phase = 'play';
      st.bvy = toFixed(-6);
      st.bvx = st.serving === 0 ? toFixed(2) : toFixed(-2);
    }
  }

  // Move slime 1
  moveSlime(st, 's1', p0input, 0);
  // Move slime 2
  moveSlime(st, 's2', p1input, 1);

  if (st.phase === 'play') {
    // Ball physics
    st.bvy += BALL_GRAVITY;
    st.bx += st.bvx;
    st.by += st.bvy;

    // Ball-wall collision
    if (st.bx - BALL_R < 0) { st.bx = BALL_R; st.bvx = Math.abs(st.bvx); }
    if (st.bx + BALL_R > W) { st.bx = W - BALL_R; st.bvx = -Math.abs(st.bvx); }
    if (st.by - BALL_R < 0) { st.by = BALL_R; st.bvy = Math.abs(st.bvy); }

    // Ball-net collision
    ballNetCollision(st);

    // Ball-slime collisions
    ballSlimeCollision(st, st.s1x, st.s1y, 0);
    ballSlimeCollision(st, st.s2x, st.s2y, 1);

    // Ball hits floor — point scored
    if (st.by + BALL_R >= FLOOR_Y) {
      st.by = FLOOR_Y - BALL_R;
      st.bvy = 0;
      st.bvx = 0;
      // Ball on left side = point for player 2, and vice versa
      if (st.bx < NET_X) {
        st.score2++;
        st.serving = 0;  // player who was scored on serves
      } else {
        st.score1++;
        st.serving = 1;
      }
      if (st.score1 >= SCORE_TO_WIN || st.score2 >= SCORE_TO_WIN) {
        st.phase = 'gameover';
        st.winner = st.score1 >= SCORE_TO_WIN ? 0 : 1;
      } else {
        st.phase = 'point';
        st.pointTimer = 60;  // 1 second pause
      }
    }
  }
}

function moveSlime(st, prefix, input, player) {
  const x = prefix + 'x', y = prefix + 'y', vx = prefix + 'vx', vy = prefix + 'vy';

  // Horizontal movement
  if (input & INPUT.LEFT)  st[vx] = -SLIME_SPEED;
  else if (input & INPUT.RIGHT) st[vx] = SLIME_SPEED;
  else st[vx] = 0;

  // Jump
  if ((input & INPUT.UP) && st[y] >= FLOOR_Y) {
    st[vy] = SLIME_JUMP_V;
  }

  // Gravity
  st[vy] += GRAVITY;

  // Integrate
  st[x] += st[vx];
  st[y] += st[vy];

  // Floor
  if (st[y] > FLOOR_Y) {
    st[y] = FLOOR_Y;
    st[vy] = 0;
  }

  // Boundary clamp — each slime stays on their side
  if (player === 0) {
    st[x] = clamp(st[x], SLIME_R, NET_X - NET_W / 2 - SLIME_R);
  } else {
    st[x] = clamp(st[x], NET_X + NET_W / 2 + SLIME_R, W - SLIME_R);
  }
}

function ballSlimeCollision(st, sx, sy, player) {
  // Slime is a half-circle: only collide if ball is above or at slime's Y
  const dx = st.bx - sx;
  const dy = st.by - sy;
  const d2 = dx * dx + dy * dy;
  const minDist = SLIME_R + BALL_R;
  const minDist2 = minDist * minDist;

  if (d2 >= minDist2) return;
  if (dy > SLIME_R / 2) return;  // ball is below slime base, ignore

  // Compute collision response
  const d = Math.trunc(Math.sqrt(d2));  // integer approx is fine here
  if (d === 0) {
    st.bvy = -Math.abs(st.bvy) - toFixed(3);
    return;
  }

  const nx = Math.trunc((dx * SCALE) / d);
  const ny = Math.trunc((dy * SCALE) / d);

  // Reflect ball velocity off normal
  const dot = Math.trunc((st.bvx * nx + st.bvy * ny) / SCALE);
  const factor = Math.trunc(((SCALE + SLIME_BOUNCE) * dot) / SCALE);
  st.bvx = st.bvx - Math.trunc((factor * nx) / SCALE);
  st.bvy = st.bvy - Math.trunc((factor * ny) / SCALE);

  // Separate ball from slime
  const overlap = minDist - d;
  st.bx += Math.trunc((nx * overlap) / SCALE);
  st.by += Math.trunc((ny * overlap) / SCALE);

  // Cap ball speed
  const maxSpeed = toFixed(12);
  st.bvx = clamp(st.bvx, -maxSpeed, maxSpeed);
  st.bvy = clamp(st.bvy, -maxSpeed, maxSpeed);
}

function ballNetCollision(st) {
  // Net is a thin vertical rectangle from NET_TOP to FLOOR_Y at NET_X
  const netLeft = NET_X - NET_W / 2;
  const netRight = NET_X + NET_W / 2;
  const netTop = NET_TOP;
  const netBottom = FLOOR_Y;

  // Closest point on net rect to ball centre
  const cx = clamp(st.bx, netLeft, netRight);
  const cy = clamp(st.by, netTop, netBottom);
  const dx = st.bx - cx;
  const dy = st.by - cy;
  const d2 = dx * dx + dy * dy;
  const r2 = BALL_R * BALL_R;

  if (d2 >= r2) return;

  const d = Math.trunc(Math.sqrt(d2));
  if (d === 0) {
    // Push ball above the net
    st.by = netTop - BALL_R;
    st.bvy = -Math.abs(st.bvy);
    return;
  }

  const nx = Math.trunc((dx * SCALE) / d);
  const ny = Math.trunc((dy * SCALE) / d);
  const overlap = BALL_R - d;

  st.bx += Math.trunc((nx * overlap) / SCALE);
  st.by += Math.trunc((ny * overlap) / SCALE);

  // Reflect
  const dot = Math.trunc((st.bvx * nx + st.bvy * ny) / SCALE);
  const factor = Math.trunc(((SCALE + RESTITUTION) * dot) / SCALE);
  st.bvx -= Math.trunc((factor * nx) / SCALE);
  st.bvy -= Math.trunc((factor * ny) / SCALE);
}

function resetForServe(st) {
  st.phase = 'serve';
  st.s1x = toFixed(160); st.s1y = FLOOR_Y; st.s1vx = 0; st.s1vy = 0;
  st.s2x = toFixed(480); st.s2y = FLOOR_Y; st.s2vx = 0; st.s2vy = 0;
  st.bvx = 0; st.bvy = 0;
  st.pointTimer = 0;
}

/* ---------- Rendering ---------- */

const SKY = '#1a1a3e';
const GROUND_COLOR = '#2d5a27';
const NET_COLOR = '#ccc';
const P1_COLOR = '#4a90d9';
const P2_COLOR = '#d94a4a';
const BALL_COLOR = '#f0e68c';
const P1_EYE = '#fff';
const P2_EYE = '#fff';

function renderGame(ctx, prev, curr, alpha) {
  const st = curr || ctx.state;

  clear(SKY);

  // Ground
  drawRect(0, toFloat(FLOOR_Y), VIRTUAL_W, VIRTUAL_H - toFloat(FLOOR_Y), GROUND_COLOR);

  // Net
  const netX = toFloat(NET_X) - toFloat(NET_W) / 2;
  const netY = toFloat(NET_TOP);
  const netH = toFloat(NET_H);
  drawRect(netX, netY, toFloat(NET_W), netH, NET_COLOR);

  // -- Helper: read a fixed-point value from the serialized prev buffer at byteOffset --
  function prevFloat(byteOffset) {
    if (!prev || alpha == null) return null;
    const v = new DataView(prev.buffer, prev.byteOffset, prev.byteLength);
    return toFloat(v.getInt32(byteOffset, true));
  }

  // Local vs remote rendering:
  // Local player: alpha-interpolation for sub-frame smoothness.
  // Remote player (networked): exponential visual smoothing to hide rollback corrections.
  const isP1Local = ctx.localPlayerId === 0;
  const hasNet = Boolean(ctx.net);
  const sr = toFloat(SLIME_R);

  // Slime 1 positions (bytes 0/4 in serialized buffer)
  const s1xCurr = toFloat(st.s1x);
  const s1yCurr = toFloat(st.s1y);
  let s1x, s1y;
  if (isP1Local) {
    const px0 = prevFloat(0) ?? s1xCurr;
    const py0 = prevFloat(4) ?? s1yCurr;
    s1x = px0 + (s1xCurr - px0) * (alpha ?? 1);
    s1y = py0 + (s1yCurr - py0) * (alpha ?? 1);
  } else if (hasNet) {
    if (!ctx._vs) ctx._vs = { s1x: s1xCurr, s1y: s1yCurr };
    if (ctx._vs.s1x == null) { ctx._vs.s1x = s1xCurr; ctx._vs.s1y = s1yCurr; }
    ctx._vs.s1x += (s1xCurr - ctx._vs.s1x) * 0.5;
    ctx._vs.s1y += (s1yCurr - ctx._vs.s1y) * 0.5;
    s1x = ctx._vs.s1x;
    s1y = ctx._vs.s1y;
  } else {
    s1x = s1xCurr; s1y = s1yCurr;
  }

  // Slime 2 positions (bytes 16/20)
  const s2xCurr = toFloat(st.s2x);
  const s2yCurr = toFloat(st.s2y);
  let s2x, s2y;
  if (!isP1Local) {
    const px16 = prevFloat(16) ?? s2xCurr;
    const py20 = prevFloat(20) ?? s2yCurr;
    s2x = px16 + (s2xCurr - px16) * (alpha ?? 1);
    s2y = py20 + (s2yCurr - py20) * (alpha ?? 1);
  } else if (hasNet) {
    if (!ctx._vs) ctx._vs = {};
    if (ctx._vs.s2x == null) { ctx._vs.s2x = s2xCurr; ctx._vs.s2y = s2yCurr; }
    ctx._vs.s2x += (s2xCurr - ctx._vs.s2x) * 0.5;
    ctx._vs.s2y += (s2yCurr - ctx._vs.s2y) * 0.5;
    s2x = ctx._vs.s2x;
    s2y = ctx._vs.s2y;
  } else {
    s2x = s2xCurr; s2y = s2yCurr;
  }

  // Slime 1 (left)
  drawHalfCircle(s1x, s1y, sr, P1_COLOR);
  // Eye
  drawCircle(s1x + sr * 0.3, s1y - sr * 0.3, 4, P1_EYE);
  drawCircle(s1x + sr * 0.35, s1y - sr * 0.35, 2, '#111');

  // Slime 2 (right)
  drawHalfCircle(s2x, s2y, sr, P2_COLOR);
  // Eye (facing left)
  drawCircle(s2x - sr * 0.3, s2y - sr * 0.3, 4, P2_EYE);
  drawCircle(s2x - sr * 0.35, s2y - sr * 0.35, 2, '#111');

  // Ball — alpha-lerp between prev and curr for smooth arc
  const bxCurr = toFloat(st.bx);
  const byCurr = toFloat(st.by);
  const bxPrev = prevFloat(32) ?? bxCurr;
  const byPrev = prevFloat(36) ?? byCurr;
  const bx = bxPrev + (bxCurr - bxPrev) * (alpha ?? 1);
  const by = byPrev + (byCurr - byPrev) * (alpha ?? 1);
  const br = toFloat(BALL_R);
  drawCircle(bx, by, br, BALL_COLOR);

  // Score
  drawText(String(st.score1), VIRTUAL_W / 4, 30, {
    size: 28, align: 'center', color: P1_COLOR, bold: true,
  });
  drawText(String(st.score2), VIRTUAL_W * 3 / 4, 30, {
    size: 28, align: 'center', color: P2_COLOR, bold: true,
  });

  // Status messages
  if (st.phase === 'serve') {
    const servingStr = st.serving === ctx.localPlayerId ? 'Press UP to serve' : 'Opponent serving...';
    drawText(servingStr, VIRTUAL_W / 2, 60, {
      size: 12, align: 'center', color: '#aaa',
    });
  } else if (st.phase === 'point') {
    drawText('Point!', VIRTUAL_W / 2, VIRTUAL_H / 2, {
      size: 24, align: 'center', color: '#ff6', bold: true, baseline: 'middle',
    });
  } else if (st.phase === 'gameover') {
    const winStr = st.winner === ctx.localPlayerId ? 'You Win!' : 'You Lose!';
    const winColor = st.winner === ctx.localPlayerId ? '#4f4' : '#f44';
    drawText(winStr, VIRTUAL_W / 2, VIRTUAL_H / 2 - 20, {
      size: 28, align: 'center', color: winColor, bold: true, baseline: 'middle',
    });
    drawText(`${st.score1} - ${st.score2}`, VIRTUAL_W / 2, VIRTUAL_H / 2 + 15, {
      size: 18, align: 'center', color: '#ccc', baseline: 'middle',
    });
  }

  // Controls hint
  drawText('← → = move   ↑ = jump', VIRTUAL_W / 2, VIRTUAL_H - 8, {
    size: 9, align: 'center', color: '#555',
  });
}

/* ---------- Serialization ---------- */

function serializeState(ctx) {
  const st = ctx.state;
  const buf = new ArrayBuffer(48);
  const v = new DataView(buf);
  let o = 0;
  v.setInt32(o, st.s1x, true); o += 4;
  v.setInt32(o, st.s1y, true); o += 4;
  v.setInt32(o, st.s1vx, true); o += 4;
  v.setInt32(o, st.s1vy, true); o += 4;
  v.setInt32(o, st.s2x, true); o += 4;
  v.setInt32(o, st.s2y, true); o += 4;
  v.setInt32(o, st.s2vx, true); o += 4;
  v.setInt32(o, st.s2vy, true); o += 4;
  v.setInt32(o, st.bx, true); o += 4;
  v.setInt32(o, st.by, true); o += 4;
  v.setInt32(o, st.bvx, true); o += 4;
  v.setInt32(o, st.bvy, true); o += 4;
  return new Uint8Array(buf);
}

function deserializeState(ctx, data) {
  const st = ctx.state;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  st.s1x = v.getInt32(o, true); o += 4;
  st.s1y = v.getInt32(o, true); o += 4;
  st.s1vx = v.getInt32(o, true); o += 4;
  st.s1vy = v.getInt32(o, true); o += 4;
  st.s2x = v.getInt32(o, true); o += 4;
  st.s2y = v.getInt32(o, true); o += 4;
  st.s2vx = v.getInt32(o, true); o += 4;
  st.s2vy = v.getInt32(o, true); o += 4;
  st.bx = v.getInt32(o, true); o += 4;
  st.by = v.getInt32(o, true); o += 4;
  st.bvx = v.getInt32(o, true); o += 4;
  st.bvy = v.getInt32(o, true); o += 4;
}

/* ---------- Registration ---------- */

registerGame({
  key: 'slime-volley',
  name: 'Slime Volleyball',
  description: '1v1 slime volleyball — first to 7!',
  icon: '🏐',
  maxPlayers: 2,
  tickRate: 60,
  netModel: 'rollback',
  inputSchema: ['left', 'right', 'up'],

  init(ctx) {
    ctx.state = createState();
  },

  update(ctx, frame, localInput, remoteInput) {
    simulate(ctx, frame, localInput, remoteInput);
  },

  render(ctx, prev, curr, alpha) {
    renderGame(ctx, prev, curr, alpha);
  },

  serialize: serializeState,
  deserialize: deserializeState,

  cleanup(ctx) {
    ctx.state = null;
  },
});

export default 'slime-volley';
