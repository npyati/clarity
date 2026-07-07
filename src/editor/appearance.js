/**
 * Editor appearance (font size / line spacing) behind a reconfigurable
 * compartment, persisted to localStorage.
 */
import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const STORAGE_KEY = 'clarity.appearance';
const compartment = new Compartment();

const state = {
  fontSize: 14,
  lineHeight: 1.6,
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Number.isFinite(saved.fontSize)) state.fontSize = saved.fontSize;
    if (Number.isFinite(saved.lineHeight)) state.lineHeight = saved.lineHeight;
  } catch (e) {
    // Corrupt appearance settings — use defaults
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Best-effort
  }
}

function themeFor({ fontSize, lineHeight }) {
  return EditorView.theme({
    '&': { fontSize: `${fontSize}px` },
    '.cm-content': { lineHeight: String(lineHeight) },
  });
}

load();

export const appearanceExtension = compartment.of(themeFor(state));

function apply(view) {
  view.dispatch({ effects: compartment.reconfigure(themeFor(state)) });
  save();
}

export function changeFontSize(view, delta) {
  state.fontSize = Math.max(8, Math.min(32, state.fontSize + delta));
  apply(view);
}

export function changeLineHeight(view, delta) {
  state.lineHeight = Math.max(1.0, Math.min(3.0, +(state.lineHeight + delta).toFixed(1)));
  apply(view);
}
