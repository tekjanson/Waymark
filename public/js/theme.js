/* ============================================================
   theme.js — Platform-wide theming: presets + custom theme builder.

   The whole app is themed through CSS custom properties. css/palettes.css maps
   the raw --wm-* tokens onto the app's --color-* design tokens via
   html[data-wm-palette]. This module decides what html[data-wm-palette] and the
   raw --wm-* values are:

   - Preset mode   → data-wm-palette="1".."12" (values live in palettes.css).
   - Custom theme  → data-wm-palette="custom" + inline --wm-* on <html>, driven
                     by the Appearance theme builder in Settings.

   The 12 presets double as one-click starting points for the builder.
   ============================================================ */

import * as storage from './storage.js';
import * as userData from './user-data.js';

/* ---------- Fonts ---------- */
export const FONTS = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace",
  rounded: "'Nunito', 'Segoe UI', system-ui, sans-serif",
};

/* ---------- 12 curated palettes (mirror css/home-modes.css + palettes.css) ----------
   Each is a complete theme the builder can load and then tweak. */
export const PALETTES = {
  1:  { name: 'Command Center', base: 'dark',  bg: '#0d1117', surface: '#21262d', accent: '#3b82f6', text: '#f0f6fc', muted: '#8b949e', border: '#30363d', success: '#10b981', radius: 12, font: 'system' },
  2:  { name: 'Bento',         base: 'light', bg: '#f5f6fb', surface: '#ffffff', accent: '#6366f1', text: '#1d2433', muted: '#64708a', border: '#e5e8f2', success: '#10b981', radius: 18, font: 'system' },
  3:  { name: 'Focus',         base: 'light', bg: '#f7f6f3', surface: '#ffffff', accent: '#0d9488', text: '#1f2a28', muted: '#6c7b77', border: '#e7e3da', success: '#10b981', radius: 14, font: 'system' },
  4:  { name: 'Social Hub',    base: 'dark',  bg: '#1a1016', surface: '#2d1d28', accent: '#ec4899', text: '#fdf2f8', muted: '#c69bb3', border: '#3f2a38', success: '#34d399', radius: 12, font: 'system' },
  5:  { name: 'Split Rail',    base: 'dark',  bg: '#0b0f14', surface: '#1a222d', accent: '#38bdf8', text: '#f0f6fc', muted: '#8b949e', border: '#2a3545', success: '#10b981', radius: 12, font: 'system' },
  6:  { name: 'Stream',        base: 'dark',  bg: '#0c0d15', surface: '#191b29', accent: '#818cf8', text: '#f0f6fc', muted: '#8b949e', border: '#282a3d', success: '#10b981', radius: 12, font: 'system' },
  7:  { name: 'Pinboard',      base: 'light', bg: '#efe9dd', surface: '#fffdf8', accent: '#c2410c', text: '#2b2418', muted: '#7a6f59', border: '#e0d6c4', success: '#10b981', radius: 10, font: 'system' },
  8:  { name: 'HUD',           base: 'dark',  bg: '#05080a', surface: '#0e171c', accent: '#22d3ee', text: '#dbf5fb', muted: '#5f93a0', border: '#163038', success: '#22d3ee', radius: 4,  font: 'mono' },
  9:  { name: 'Gallery',       base: 'dark',  bg: '#0d0b12', surface: '#1c1827', accent: '#a855f7', text: '#f0f6fc', muted: '#8b949e', border: '#2d2740', success: '#10b981', radius: 16, font: 'system' },
  10: { name: 'Canvas',        base: 'dark',  bg: '#0b1020', surface: '#16203f', accent: '#60a5fa', text: '#f0f6fc', muted: '#8b949e', border: '#243357', success: '#10b981', radius: 14, font: 'system' },
  11: { name: 'Editorial',     base: 'light', bg: '#faf7f0', surface: '#fffdf8', accent: '#b45309', text: '#211c13', muted: '#6f6552', border: '#e6ddc9', success: '#10b981', radius: 6,  font: 'serif' },
  12: { name: 'Matrix',        base: 'dark',  bg: '#060708', surface: '#111417', accent: '#f59e0b', text: '#e8edf2', muted: '#7a8894', border: '#20262c', success: '#22c55e', radius: 3,  font: 'mono' },
};

/* The editable fields a custom theme carries (besides `enabled`). */
export const THEME_FIELDS = ['base', 'bg', 'surface', 'accent', 'text', 'muted', 'border', 'success', 'radius', 'font'];

/** Default custom theme = the Command Center preset, disabled until the user opts in. */
export function defaultTheme() {
  return { enabled: false, preset: 1, ...PALETTES[1] };
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Merge a partial/untrusted theme onto the defaults, clamping each field.
 * @param {Object} partial
 * @returns {Object} a complete, safe theme object
 */
export function normalizeTheme(partial) {
  const d = defaultTheme();
  const t = { ...d, ...(partial && typeof partial === 'object' ? partial : {}) };
  t.enabled = Boolean(t.enabled);
  t.base = t.base === 'light' ? 'light' : 'dark';
  for (const key of ['bg', 'surface', 'accent', 'text', 'muted', 'border', 'success']) {
    if (!HEX_RE.test(String(t[key] || ''))) t[key] = d[key];
  }
  t.radius = Math.max(0, Math.min(28, parseInt(t.radius, 10) || 0));
  if (!FONTS[t.font]) t.font = 'system';
  return t;
}

/**
 * Read the active custom theme (Drive-backed, with a localStorage fallback).
 * @returns {Object}
 */
export function getActiveTheme() {
  let saved = null;
  try { saved = userData.getCustomTheme?.(); } catch { /* not hydrated */ }
  if (!saved) {
    try { saved = storage.getCustomTheme?.(); } catch { /* ignore */ }
  }
  return normalizeTheme(saved);
}

/* ---------- Application ---------- */

/**
 * Apply a custom theme app-wide by stamping data-wm-palette="custom" and the
 * raw --wm-* tokens inline on <html>. palettes.css maps those onto every
 * --color-* token, so menus, modals, and all template views adopt it.
 * @param {Object} theme
 */
export function applyCustomTheme(theme) {
  const t = normalizeTheme(theme);
  const root = document.documentElement;
  const vars = {
    '--wm-bg': t.bg,
    '--wm-panel': t.bg,
    '--wm-card': t.surface,
    '--wm-border': t.border,
    '--wm-accent': t.accent,
    '--wm-text': t.text,
    '--wm-muted': t.muted,
    '--wm-green': t.success,
    '--wm-radius': `${t.radius}px`,
    '--wm-font': FONTS[t.font] || FONTS.system,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute('data-wm-base', t.base);
  root.setAttribute('data-wm-palette', 'custom');
}

/** Remove any inline custom-theme tokens (used when switching back to a preset). */
export function clearCustomTheme() {
  const root = document.documentElement;
  for (const k of ['--wm-bg', '--wm-panel', '--wm-card', '--wm-border', '--wm-accent', '--wm-text', '--wm-muted', '--wm-green', '--wm-radius', '--wm-font']) {
    root.style.removeProperty(k);
  }
  root.removeAttribute('data-wm-base');
  // Clear the custom marker so a preset palette can take over (the caller
  // re-applies the preset immediately, so there is no unstyled frame).
  if (root.getAttribute('data-wm-palette') === 'custom') {
    root.removeAttribute('data-wm-palette');
  }
}

/**
 * Apply whichever theme is active: a custom theme if enabled, otherwise the
 * selected layout preset. Safe to call at boot and whenever settings change.
 * @param {Function} [applyPreset] — fallback preset applier (wayboard.applyHomeMode)
 */
export function applyActiveTheme(applyPreset) {
  const theme = getActiveTheme();
  if (theme.enabled) {
    applyCustomTheme(theme);
    return theme;
  }
  clearCustomTheme();
  if (typeof applyPreset === 'function') {
    try { applyPreset(storage.getHomeTemplateMode?.() ?? 1); } catch { /* non-fatal */ }
  }
  return theme;
}

/**
 * Persist a custom theme to Drive + localStorage mirror and apply it live.
 * @param {Object} theme
 */
export async function saveCustomTheme(theme) {
  const t = normalizeTheme(theme);
  try { storage.setCustomTheme?.(t); } catch { /* best-effort mirror */ }
  applyCustomTheme(t);
  try { await userData.setCustomTheme?.(t); } catch { /* Drive best-effort */ }
  return t;
}
