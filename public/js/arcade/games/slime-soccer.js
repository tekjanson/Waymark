/* ============================================================
   arcade/games/slime-soccer.js — Slime Soccer with rollback
   ============================================================

   Full-width field, goals at each end, kick mechanic.
   Integer fixed-point physics (×100) for determinism.
   ============================================================ */

import { registerGame } from '../engine.js';
import {
  VIRTUAL_W, VIRTUAL_H, clear, drawRect, drawCircle,
  drawText, drawLine, drawHalfCircle, drawRoundRect,
} from '../renderer.js';
import { INPUT } from '../input.js';
import { SCALE, toFixed, toFloat, clamp } from '../physics.js';

/* ---------- World Constants (fixed-point ×100) ---------- */

const W = toFixed(VIRTUAL_W);
const H = toFixed(VIRTUAL_H);

const FLOOR_Y = toFixed(310);
const CEILING_Y = toFixed(10);

// Goals
const GOAL_W = toFixed(10);
const GOAL_H = toFixed(80);
const GOAL_TOP = FLOOR_Y - GOAL_H;
const GOAL1_X = 0;                    // left goal
const GOAL2_X = W - GOAL_W;           // right goal

// Slimes
const SLIME_R = toFixed(30);
const SLIME_SPEED = toFixed(3.5);
const SLIME_JUMP_V = toFixed(-7.5);

// Ball
const BALL_R = toFixed(10);
const BALL_START_Y = toFixed(100);

const GRAVITY = toFixed(0.30);
const BALL_GRAVITY = toFixed(0.22);
const RESTITUTION = 75;
const SLIME_BOUNCE = 105;
const KICK_IMPULSE = toFixed(8);
const KICK_RANGE = SLIME_R + BALL_R + toFixed(10);

const SCORE_TO_WIN = 5;

/* ---------- State ---------- */

function createState() {
  return {
    s1x: toFixed(160), s1y: FLOOR_Y, s1vx: 0, s1vy: 0,
    s2x: toFixed(480), s2y: FLOOR_Y, s2vx: 0, s2vy: 0,
    bx: W / 2, by: BALL_START_Y, bvx: 0, bvy: 0,
    score1: 0, score2: 0,
    phase: 'serve',     // 'serve' | 'play' | 'goal' | 'gameover'
    serving: 0,
    goalTimer: 0,
    winner: -1,
  };
}

/* ---------- Simulation ---------- */

function simulate(ctx, frame, localInput, remoteInput) {
  const st = ctx.state;
  if (st.phase === 'gameover') return;

  const p0input = ctx.localPlayerId === 0 ? localInput : remoteInput;
  const p1input = ctx.localPlayerId === 1 ? localInput : remoteInput;

  if (st.phase === 'goal') {
    st.goalTimer--;
    if (st.goalTimer <= 0) resetForServe(st);
    return;
  }

  if (st.phase === 'serve') {
    if (st.serving === 0) {
      st.bx = st.s1x + toFixed(20);
      st.by = st.s1y - SLIME_R - BALL_R - toFixed(5);
    } else {
      st.bx = st.s2x - toFixed(20);
      st.by = st.s2y - SLIME_R - BALL_R - toFixed(5);
    }
    const serveInput = st.serving === 0 ? p0input : p1input;
    if (serveInput & (INPUT.UP | INPUT.ACTION1)) {
      st.phase = 'play';
      st.bvy = toFixed(-5);
      st.bvx = st.serving === 0 ? toFixed(3) : toFixed(-3);
    }
  }

  // Move slimes — no side restriction in soccer
  moveSlime(st, 's1', p0input, 0);
  moveSlime(st, 's2', p1input, 1);

  // Kick mechanic
  if (st.phase === 'play') {
    if (p0input & INPUT.ACTION1) tryKick(st, st.s1x, st.s1y, 0);
    if (p1input & INPUT.ACTION1) tryKick(st, st.s2x, st.s2y, 1);
  }

  if (st.phase === 'play') {
    // Ball physics
    st.bvy += BALL_GRAVITY;
    st.bx += st.bvx;
    st.by += st.bvy;

    // Ceiling bounce
    if (st.by - BALL_R < CEILING_Y) {
      st.by = CEILING_Y + BALL_R;
      st.bvy = Math.abs(st.bvy);
    }

    // Wall bounces (skip goal areas)
    if (st.bx - BALL_R < 0) {
      if (st.by + BALL_R > GOAL_TOP && st.by - BALL_R < FLOOR_Y) {
        // Entered left goal
        st.score2++;
        scoreGoal(st);
        return;
      }
      st.bx = BALL_R;
      st.bvx = Math.abs(st.bvx);
    }
    if (st.bx + BALL_R > W) {
      if (st.by + BALL_R > GOAL_TOP && st.by - BALL_R < FLOOR_Y) {
        // Entered right goal
        st.score1++;
        scoreGoal(st);
        return;
      }
      st.bx = W - BALL_R;
      st.bvx = -Math.abs(st.bvx);
    }

    // Goal post collisions (top edge of each goal)
    ballGoalPostCollision(st, GOAL1_X + GOAL_W, GOAL_TOP);
    ballGoalPostCollision(st, GOAL2_X, GOAL_TOP);

    // Ball-slime collisions
    ballSlimeCollision(st, st.s1x, st.s1y);
    ballSlimeCollision(st, st.s2x, st.s2y);

    // Floor
    if (st.by + BALL_R >= FLOOR_Y) {
      st.by = FLOOR_Y - BALL_R;
      st.bvy = -Math.trunc((Math.abs(st.bvy) * RESTITUTION) / SCALE);
      if (Math.abs(st.bvy) < toFixed(0.5)) st.bvy = 0;
    }
  }
}

function moveSlime(st, prefix, input, player) {
  const x = prefix + 'x', y = prefix + 'y', vx = prefix + 'vx', vy = prefix + 'vy';

  if (input & INPUT.LEFT) st[vx] = -SLIME_SPEED;
  else if (input & INPUT.RIGHT) st[vx] = SLIME_SPEED;
  else st[vx] = 0;

  if ((input & INPUT.UP) && st[y] >= FLOOR_Y) {
    st[vy] = SLIME_JUMP_V;
  }

  st[vy] += GRAVITY;
  st[x] += st[vx];
  st[y] += st[vy];

  if (st[y] > FLOOR_Y) { st[y] = FLOOR_Y; st[vy] = 0; }
  st[x] = clamp(st[x], SLIME_R, W - SLIME_R);
}

function tryKick(st, sx, sy, player) {
  const dx = st.bx - sx;
  const dy = st.by - sy;
  const d2 = dx * dx + dy * dy;
  if (d2 > KICK_RANGE * KICK_RANGE) return;

  const d = Math.trunc(Math.sqrt(d2));
  if (d === 0) return;

  const nx = Math.trunc((dx * SCALE) / d);
  const ny = Math.trunc((dy * SCALE) / d);
  st.bvx += Math.trunc((nx * KICK_IMPULSE) / SCALE);
  st.bvy += Math.trunc((ny * KICK_IMPULSE) / SCALE);

  // Cap speed
  const maxSpeed = toFixed(14);
  st.bvx = clamp(st.bvx, -maxSpeed, maxSpeed);
  st.bvy = clamp(st.bvy, -maxSpeed, maxSpeed);
}

function ballSlimeCollision(st, sx, sy) {
  const dx = st.bx - sx;
  const dy = st.by - sy;
  const d2 = dx * dx + dy * dy;
  const minDist = SLIME_R + BALL_R;
  if (d2 >= minDist * minDist) return;
  if (dy > SLIME_R / 2) return;

  const d = Math.trunc(Math.sqrt(d2));
  if (d === 0) { st.bvy = -Math.abs(st.bvy) - toFixed(3); return; }

  const nx = Math.trunc((dx * SCALE) / d);
  const ny = Math.trunc((dy * SCALE) / d);

  const dot = Math.trunc((st.bvx * nx + st.bvy * ny) / SCALE);
  const factor = Math.trunc(((SCALE + SLIME_BOUNCE) * dot) / SCALE);
  st.bvx -= Math.trunc((factor * nx) / SCALE);
  st.bvy -= Math.trunc((factor * ny) / SCALE);

  const overlap = minDist - d;
  st.bx += Math.trunc((nx * overlap) / SCALE);
  st.by += Math.trunc((ny * overlap) / SCALE);

  const maxSpeed = toFixed(12);
  st.bvx = clamp(st.bvx, -maxSpeed, maxSpeed);
  st.bvy = clamp(st.bvy, -maxSpeed, maxSpeed);
}

function ballGoalPostCollision(st, postX, postY) {
  const dx = st.bx - postX;
  const dy = st.by - postY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= BALL_R * BALL_R) return;

  const d = Math.trunc(Math.sqrt(d2));
  if (d === 0) { st.bvy = -toFixed(3); return; }

  const nx = Math.trunc((dx * SCALE) / d);
  const ny = Math.trunc((dy * SCALE) / d);
  const overlap = BALL_R - d;
  st.bx += Math.trunc((nx * overlap) / SCALE);
  st.by += Math.trunc((ny * overlap) / SCALE);

  const dot = Math.trunc((st.bvx * nx + st.bvy * ny) / SCALE);
  const factor = Math.trunc(((SCALE + RESTITUTION) * dot) / SCALE);
  st.bvx -= Math.trunc((factor * nx) / SCALE);
  st.bvy -= Math.trunc((factor * ny) / SCALE);
}

function scoreGoal(st) {
  if (st.score1 >= SCORE_TO_WIN || st.score2 >= SCORE_TO_WIN) {
    st.phase = 'gameover';
    st.winner = st.score1 >= SCORE_TO_WIN ? 0 : 1;
  } else {
    st.phase = 'goal';
    st.goalTimer = 90;
    st.serving = st.score1 > st.score2 ? 1 : 0;  // losing team serves
  }
}

function resetForServe(st) {
  st.phase = 'serve';
  st.s1x = toFixed(160); st.s1y = FLOOR_Y; st.s1vx = 0; st.s1vy = 0;
  st.s2x = toFixed(480); st.s2y = FLOOR_Y; st.s2vx = 0; st.s2vy = 0;
  st.bvx = 0; st.bvy = 0;
  st.goalTimer = 0;
}

/* ---------- Rendering ---------- */

const FIELD_COLOR = '#1e6b2e';
const FIELD_DARK = '#165a24';
const SKY_COLOR = '#87ceeb';
const GOAL_COLOR = '#fff';
const P1_COLOR = '#3388dd';
const P2_COLOR = '#dd3333';
const BALL_COLOR = '#f5f5f5';
const LINE_COLOR = 'rgba(255,255,255,0.3)';

function renderGame(ctx, alpha) {
  const st = ctx.state;

  // Sky
  clear(SKY_COLOR);

  // Field
  const fy = toFloat(FLOOR_Y);
  drawRect(0, fy, VIRTUAL_W, VIRTUAL_H - fy, FIELD_COLOR);

  // Field stripes (decorative)
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) {
      drawRect(i * 80, fy, 80, VIRTUAL_H - fy, FIELD_DARK);
    }
  }

  // Centre line
  drawLine(VIRTUAL_W / 2, fy - toFloat(GOAL_H), VIRTUAL_W / 2, fy, LINE_COLOR, 1);
  // Centre circle (cosmetic)
  const ccr = 30;
  drawRect(VIRTUAL_W / 2 - 1, fy - ccr, 2, ccr, LINE_COLOR);

  // Goals
  drawRect(toFloat(GOAL1_X), toFloat(GOAL_TOP), toFloat(GOAL_W), toFloat(GOAL_H), GOAL_COLOR);
  drawRect(toFloat(GOAL2_X), toFloat(GOAL_TOP), toFloat(GOAL_W), toFloat(GOAL_H), GOAL_COLOR);

  // Slime 1
  const s1x = toFloat(st.s1x);
  const s1y = toFloat(st.s1y);
  const sr = toFloat(SLIME_R);
  drawHalfCircle(s1x, s1y, sr, P1_COLOR);
  drawCircle(s1x + sr * 0.3, s1y - sr * 0.3, 3, '#fff');
  drawCircle(s1x + sr * 0.35, s1y - sr * 0.35, 1.5, '#111');

  // Slime 2
  const s2x = toFloat(st.s2x);
  const s2y = toFloat(st.s2y);
  drawHalfCircle(s2x, s2y, sr, P2_COLOR);
  drawCircle(s2x - sr * 0.3, s2y - sr * 0.3, 3, '#fff');
  drawCircle(s2x - sr * 0.35, s2y - sr * 0.35, 1.5, '#111');

  // Ball
  drawCircle(toFloat(st.bx), toFloat(st.by), toFloat(BALL_R), BALL_COLOR);

  // Score
  drawText(String(st.score1), VIRTUAL_W / 4, 28, {
    size: 26, align: 'center', color: P1_COLOR, bold: true,
  });
  drawText(String(st.score2), VIRTUAL_W * 3 / 4, 28, {
    size: 26, align: 'center', color: P2_COLOR, bold: true,
  });

  // Status
  if (st.phase === 'serve') {
    const s = st.serving === ctx.localPlayerId ? 'Press UP to kick off' : 'Opponent kicking off...';
    drawText(s, VIRTUAL_W / 2, 55, { size: 11, align: 'center', color: '#333' });
  } else if (st.phase === 'goal') {
    drawText('GOAL!', VIRTUAL_W / 2, VIRTUAL_H / 2, {
      size: 32, align: 'center', color: '#ff0', bold: true, baseline: 'middle',
    });
  } else if (st.phase === 'gameover') {
    const winStr = st.winner === ctx.localPlayerId ? 'You Win!' : 'You Lose!';
    const winColor = st.winner === ctx.localPlayerId ? '#0a0' : '#a00';
    drawText(winStr, VIRTUAL_W / 2, VIRTUAL_H / 2 - 20, {
      size: 28, align: 'center', color: winColor, bold: true, baseline: 'middle',
    });
    drawText(`${st.score1} - ${st.score2}`, VIRTUAL_W / 2, VIRTUAL_H / 2 + 15, {
      size: 18, align: 'center', color: '#333', baseline: 'middle',
    });
  }

  // Controls hint
  drawText('← → = move   ↑ = jump   Z = kick', VIRTUAL_W / 2, VIRTUAL_H - 6, {
    size: 9, align: 'center', color: '#2a5a2a',
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
  key: 'slime-soccer',
  name: 'Slime Soccer',
  description: '1v1 slime soccer — first to 5!',
  icon: '⚽',
  maxPlayers: 2,
  tickRate: 60,
  netModel: 'rollback',
  inputSchema: ['left', 'right', 'up', 'action1'],

  init(ctx) {
    ctx.state = createState();
  },

  update(ctx, frame, localInput, remoteInput) {
    simulate(ctx, frame, localInput, remoteInput);
  },

  render(ctx, prev, curr, alpha) {
    renderGame(ctx, alpha);
  },

  serialize: serializeState,
  deserialize: deserializeState,

  cleanup(ctx) {
    ctx.state = null;
  },
});

export default 'slime-soccer';
