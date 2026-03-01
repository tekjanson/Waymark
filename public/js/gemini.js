/* ============================================================
   gemini.js — DEPRECATED stubs

   AI features have been removed from WayMark.  All search is
   keyword-based and all import analysis is code-based with
   manual column mapping.  These stubs exist only so that any
   remaining `import('./gemini.js')` calls don't break.
   ============================================================ */

/** Always returns false — AI is not used. */
export async function isAvailable() { return false; }

/** No-op stub. */
export async function query() { return { matches: [], summary: '' }; }

/** No-op stub. */
export async function analyzeForImport() { return {}; }

/** Kept for test compatibility. */
export function buildPrompt() { return ''; }

