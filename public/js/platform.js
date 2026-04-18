/* ============================================================
   platform.js — Runtime platform/bridge detection helpers.
   Keeps native bridge calls gated to trusted Android WebView only.
   ============================================================ */

/**
 * True only inside the official Android WebView shell.
 * Requires BOTH the Android bridge object and the Waymark UA marker.
 * @returns {boolean}
 */
export function isTrustedAndroidWebView() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (!/\bWaymarkAndroid\/\d+(?:\.\d+)*\b/i.test(ua)) return false;
  return !!window.Android && typeof window.Android === 'object';
}

/**
 * Return the Android bridge only when running inside trusted WebView and
 * all requested bridge methods are available.
 * @param {string[]} requiredMethods
 * @returns {any|null}
 */
export function getAndroidBridge(requiredMethods = []) {
  if (!isTrustedAndroidWebView()) return null;
  const bridge = window.Android;
  for (const methodName of requiredMethods) {
    if (typeof bridge?.[methodName] !== 'function') return null;
  }
  return bridge;
}