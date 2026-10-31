/* ============================================================
   arcade/games/common.js — Shared game utilities
   ============================================================ */

export function pieceColor(p, emptyVal = 0) {
  return p === emptyVal ? -1 : (p > 0 && p < 0x80 ? 0 : 1);
}
