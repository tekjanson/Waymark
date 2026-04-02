/* ============================================================
   arcade/physics.js — Deterministic integer physics engine
   ============================================================

   All values are fixed-point: multiply real-world values by SCALE.
   Example: position 320.50 → stored as 32050.
   This avoids floating-point non-determinism across browsers.
   ============================================================ */

/* ---------- Constants ---------- */

/** Fixed-point scale factor. Multiply "real" values by this. */
export const SCALE = 100;

/** Convert a float to fixed-point integer. */
export function toFixed(f) {
  return Math.round(f * SCALE);
}

/** Convert a fixed-point integer to float for rendering. */
export function toFloat(i) {
  return i / SCALE;
}

/* ---------- Vector Helpers (integer) ---------- */

/**
 * Fixed-point integer vector math.
 * All functions take and return integer values (×SCALE).
 */

/**
 * Add two vectors.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {{ x: number, y: number }}
 */
export function vecAdd(ax, ay, bx, by) {
  return { x: ax + bx, y: ay + by };
}

/**
 * Subtract two vectors (a - b).
 * @returns {{ x: number, y: number }}
 */
export function vecSub(ax, ay, bx, by) {
  return { x: ax - bx, y: ay - by };
}

/**
 * Scale a vector by a fixed-point factor.
 * Since both value and factor are ×SCALE, divide by SCALE after multiply.
 * @param {number} x
 * @param {number} y
 * @param {number} s — fixed-point scale factor
 * @returns {{ x: number, y: number }}
 */
export function vecScale(x, y, s) {
  return {
    x: Math.trunc((x * s) / SCALE),
    y: Math.trunc((y * s) / SCALE),
  };
}

/**
 * Squared distance between two points (avoids sqrt).
 * @returns {number} — distance² in fixed-point² units
 */
export function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Integer square root (Newton's method).
 * @param {number} n — non-negative integer
 * @returns {number} — floor(sqrt(n))
 */
export function isqrt(n) {
  if (n < 0) return 0;
  if (n < 2) return n;
  let x = n;
  let y = Math.trunc((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}

/**
 * Distance between two points in fixed-point.
 * @returns {number} — distance in SCALE units
 */
export function dist(ax, ay, bx, by) {
  return isqrt(distSq(ax, ay, bx, by));
}

/**
 * Normalise a vector to unit length (in fixed-point).
 * Returns { x, y } where length ≈ SCALE.
 * @param {number} x
 * @param {number} y
 * @returns {{ x: number, y: number }}
 */
export function vecNorm(x, y) {
  const len = isqrt(x * x + y * y);
  if (len === 0) return { x: 0, y: 0 };
  return {
    x: Math.trunc((x * SCALE) / len),
    y: Math.trunc((y * SCALE) / len),
  };
}

/**
 * Dot product of two vectors (result is SCALE² units, divide by SCALE for SCALE units).
 * @returns {number}
 */
export function vecDot(ax, ay, bx, by) {
  return Math.trunc((ax * bx + ay * by) / SCALE);
}

/* ---------- Collision Detection ---------- */

/**
 * Circle-circle collision test.
 * @param {number} ax — centre A x (fixed-point)
 * @param {number} ay — centre A y (fixed-point)
 * @param {number} ar — radius A (fixed-point)
 * @param {number} bx — centre B x (fixed-point)
 * @param {number} by — centre B y (fixed-point)
 * @param {number} br — radius B (fixed-point)
 * @returns {{ hit: boolean, nx: number, ny: number, overlap: number }}
 */
export function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const d2 = dx * dx + dy * dy;
  const minDist = ar + br;
  const minDist2 = minDist * minDist;

  if (d2 >= minDist2) return { hit: false, nx: 0, ny: 0, overlap: 0 };

  const d = isqrt(d2);
  const overlap = minDist - d;

  if (d === 0) {
    // Circles at same position — push right
    return { hit: true, nx: SCALE, ny: 0, overlap };
  }

  return {
    hit: true,
    nx: Math.trunc((dx * SCALE) / d),
    ny: Math.trunc((dy * SCALE) / d),
    overlap,
  };
}

/**
 * Circle-AABB (axis-aligned bounding box) collision test.
 * @param {number} cx — circle centre x (fixed-point)
 * @param {number} cy — circle centre y (fixed-point)
 * @param {number} cr — circle radius (fixed-point)
 * @param {number} rx — rect left x (fixed-point)
 * @param {number} ry — rect top y (fixed-point)
 * @param {number} rw — rect width (fixed-point)
 * @param {number} rh — rect height (fixed-point)
 * @returns {{ hit: boolean, nx: number, ny: number, overlap: number }}
 */
export function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  // Find closest point on rect to circle centre
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));

  const dx = cx - closestX;
  const dy = cy - closestY;
  const d2 = dx * dx + dy * dy;
  const cr2 = cr * cr;

  if (d2 >= cr2) return { hit: false, nx: 0, ny: 0, overlap: 0 };

  const d = isqrt(d2);
  const overlap = cr - d;

  if (d === 0) {
    // Circle centre is inside rect
    return { hit: true, nx: 0, ny: -SCALE, overlap: cr };
  }

  return {
    hit: true,
    nx: Math.trunc((dx * SCALE) / d),
    ny: Math.trunc((dy * SCALE) / d),
    overlap,
  };
}

/**
 * Point-in-rectangle test.
 * @param {number} px — point x (fixed-point)
 * @param {number} py — point y (fixed-point)
 * @param {number} rx — rect left (fixed-point)
 * @param {number} ry — rect top (fixed-point)
 * @param {number} rw — rect width (fixed-point)
 * @param {number} rh — rect height (fixed-point)
 * @returns {boolean}
 */
export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/* ---------- Physics Body Helpers ---------- */

/**
 * Apply gravity to a velocity.
 * @param {number} vy — current y velocity (fixed-point)
 * @param {number} gravity — gravity per tick (fixed-point, positive = downward)
 * @returns {number} — new vy
 */
export function applyGravity(vy, gravity) {
  return vy + gravity;
}

/**
 * Integrate position by velocity.
 * @param {number} pos — current position (fixed-point)
 * @param {number} vel — velocity (fixed-point, per tick)
 * @returns {number} — new position
 */
export function integrate(pos, vel) {
  return pos + vel;
}

/**
 * Clamp a value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * Reflect a velocity off a collision normal.
 * @param {number} vx — velocity x (fixed-point)
 * @param {number} vy — velocity y (fixed-point)
 * @param {number} nx — normal x (fixed-point, length ≈ SCALE)
 * @param {number} ny — normal y (fixed-point, length ≈ SCALE)
 * @param {number} restitution — bounce factor (fixed-point, 100 = perfect bounce)
 * @returns {{ vx: number, vy: number }}
 */
export function reflect(vx, vy, nx, ny, restitution) {
  // v' = v - (1 + e) * (v · n) * n
  const dot = Math.trunc((vx * nx + vy * ny) / SCALE);
  const factor = Math.trunc(((SCALE + restitution) * dot) / SCALE);
  return {
    vx: vx - Math.trunc((factor * nx) / SCALE),
    vy: vy - Math.trunc((factor * ny) / SCALE),
  };
}

/**
 * Separate two circles after collision (push them apart).
 * Modifies positions in-place on the objects.
 * @param {{ x: number, y: number }} a — object A position
 * @param {{ x: number, y: number }} b — object B position
 * @param {number} nx — collision normal x
 * @param {number} ny — collision normal y
 * @param {number} overlap — penetration depth
 * @param {number} [splitRatio=50] — how much A moves (fixed-point %, 50 = half each)
 */
export function separate(a, b, nx, ny, overlap, splitRatio = 50) {
  const aShare = Math.trunc((overlap * splitRatio) / SCALE);
  const bShare = overlap - aShare;
  a.x -= Math.trunc((nx * aShare) / SCALE);
  a.y -= Math.trunc((ny * aShare) / SCALE);
  b.x += Math.trunc((nx * bShare) / SCALE);
  b.y += Math.trunc((ny * bShare) / SCALE);
}
