/**
 * CodeMirror 6 editor for the Clarity document.
 *
 * Replaces the hand-rolled block/contenteditable editor: undo/redo, IME,
 * multi-line selection, paste, and caret behavior are native here.
 */
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, indentUnit } from '@codemirror/language';
import { clarityLanguage, clarityHighlightStyle } from './language.js';
import { appearanceExtension } from './appearance.js';

// Marks transactions that originate from the instrument panel, so the sync
// pipeline can skip panel regeneration (replaces the isUpdatingFromText flag)
export const uiEditAnnotation = Annotation.define();

const clarityTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '20px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text-faint)',
  },
}, { dark: true });

// Tab indents the current line(s) by two spaces; Shift-Tab outdents.
// (Line-based like the old editor, not insert-at-cursor.)
function indentLines(view) {
  const { state } = view;
  const lines = new Set();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; ; ) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  const changes = [...lines].map(n => ({ from: state.doc.line(n).from, insert: '  ' }));
  view.dispatch({ changes, userEvent: 'input.indent' });
  return true;
}

function outdentLines(view) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; ; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = /^ {1,2}/.exec(line.text);
        if (m) changes.push({ from: line.from, to: line.from + m[0].length });
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.dedent' });
  return true;
}

/**
 * @param {object} opts
 * @param {Element} opts.parent - Mount point
 * @param {string} opts.doc - Initial document text
 * @param {Array} opts.extraKeymap - App keybindings (take precedence)
 * @param {Array} opts.extensions - Additional extensions (e.g. linter)
 * @param {function} opts.onDocChanged - (update) after any doc change
 * @param {function} opts.onCursorLine - (lineNumber, update) on selection moves
 */
export function createEditor({ parent, doc, extraKeymap = [], extensions = [], onDocChanged, onCursorLine }) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onDocChanged) {
      onDocChanged(update);
    }
    if ((update.selectionSet || update.docChanged) && onCursorLine) {
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      onCursorLine(line, update);
    }
  });

  const state = EditorState.create({
    doc,
    extensions: [
      clarityLanguage,
      syntaxHighlighting(clarityHighlightStyle),
      history(),
      drawSelection(),
      indentUnit.of('  '),
      clarityTheme,
      appearanceExtension,
      keymap.of([
        ...extraKeymap,
        { key: 'Tab', run: indentLines, shift: outdentLines },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      updateListener,
      ...extensions,
    ],
  });

  return new EditorView({ state, parent });
}
