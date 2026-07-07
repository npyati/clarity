/**
 * CodeMirror language support for the Clarity DSL.
 *
 * The grammar is strictly line-shaped (indentation defines scope), so a
 * StreamLanguage is enough: the first word of a line decides its role,
 * everything after is values/references. Keyword sets derive from the
 * schemas, so new component/trigger types highlight without grammar work.
 */
import { StreamLanguage, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { SchemaUtils } from '../dsl/schemas.js';

const ENUM_VALUES = new Set(['sine', 'square', 'sawtooth', 'triangle']);

function matchWord(stream, word) {
  return stream.match(new RegExp(`^${word}(?=\\s|$)`));
}

export const clarityLanguage = StreamLanguage.define({
  startState: () => ({ role: null }),
  token(stream, state) {
    if (stream.sol()) state.role = null;
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return 'comment';

    if (state.role === null) {
      // First word on the line decides its role
      if (matchWord(stream, 'variable')) {
        state.role = 'decl';
        return 'keyword';
      }
      for (const w of SchemaUtils.getAllTriggerTypes()) {
        if (matchWord(stream, w)) {
          state.role = 'decl';
          return 'keyword';
        }
      }
      for (const w of SchemaUtils.getAllComponentTypes()) {
        if (matchWord(stream, w)) {
          state.role = 'decl';
          return 'keyword';
        }
      }
      if (matchWord(stream, 'modulation')) {
        state.role = 'value';
        return 'keyword';
      }
      state.role = 'value';
      if (stream.match(/^[a-zA-Z_][\w]*/)) return 'propertyName';
    }

    if (stream.match(/^-?\d+\.?\d*/)) return 'number';
    if (stream.match(/^[+\-*/()=\[\],]/)) return 'operator';
    if (stream.match(/^[a-zA-Z_][\w]*/)) {
      if (state.role === 'decl') return 'variableName';
      return ENUM_VALUES.has(stream.current()) ? 'string' : 'variableName';
    }
    stream.next();
    return null;
  },
});

// Tomorrow-Night palette carried over from the block editor
export const clarityHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#f0c674' },
  { tag: t.propertyName, color: '#f0c674' },
  { tag: t.number, color: '#ffa07a' },
  { tag: t.string, color: '#5fd3bc' },
  { tag: t.variableName, color: '#81a2be' },
  { tag: t.comment, color: '#969896' },
  { tag: t.operator, color: '#c5c8c6' },
]);
