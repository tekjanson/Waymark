/* ============================================================
   web-js-cli.js — Waymark × web-js-cli integration
   Exposes window.WaymarkCLI so AI agents can drive the Waymark
   UI via a compact CLI manifest (scan → command → result loop).

   Depends on /js/vendor/web-js-cli.umd.js being loaded first
   (added as a <script> tag in index.html before app.js).
   ============================================================ */

/* ---------- Init ---------- */

/**
 * Initialise the WebJSCLI facade and expose it globally.
 * Called once the app is authenticated and the DOM is stable.
 * Safe to call multiple times — idempotent after first call.
 */
export function initWebJSCLI() {
  if (window.WaymarkCLI) return; // already initialised

  if (typeof window.WebJSCLI !== 'function') {
    console.warn('[web-js-cli] WebJSCLI not found — UMD bundle may not have loaded');
    return;
  }

  const cli = new window.WebJSCLI({ document });
  window.WaymarkCLI = cli;

  // Announce readiness so test harnesses and external agents can hook in
  window.dispatchEvent(new CustomEvent('waymark:cli-ready', { detail: { cli } }));
  console.info('[web-js-cli] WaymarkCLI ready — call window.WaymarkCLI.getManifest() to inspect the page');
}
