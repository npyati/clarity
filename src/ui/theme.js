/**
 * Design tokens live in style.css as CSS custom properties (including the
 * light-theme overrides). This module is the ONE way JS consumers (canvas
 * visualizer, anything that can't use var()) read them, so the palette has
 * a single source of truth and follows theme changes.
 */

export function token(name, fallback = '') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function visualizerPalette() {
  return {
    background: token('--bg-surface', '#282a2e'),
    grid: token('--border', '#33363a'),
    centerLine: token('--border-strong', '#44484d'),
    waveform: token('--accent', '#5fd3bc'),
    spectrum: token('--syntax-name', '#81a2be'),
    label: token('--text-faint', '#969896'),
  };
}

/** Re-read tokens when the OS theme flips. */
export function onThemeChange(handler) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', handler);
}
