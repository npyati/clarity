/**
 * Cmd/Ctrl+Up/Down value nudging, schema-aware.
 *
 * On an attribute line, step/min/max come from the attribute's schema and
 * ENUM attributes cycle their allowed values (generalizes the old
 * hard-coded wave cycling to every enum). Anywhere else, the number under
 * the cursor steps by 1 (Shift = coarse x10).
 */
import { AttributeType, SchemaUtils } from '../dsl/schemas.js';

function findNumberAt(text, pos) {
  let start = pos;
  let end = pos;
  while (start > 0 && /[\d.\-]/.test(text[start - 1])) start--;
  while (end < text.length && /[\d.\-]/.test(text[end])) end++;
  const value = parseFloat(text.slice(start, end));
  return Number.isNaN(value) ? null : { start, end, value };
}

function findWordAt(text, pos) {
  let start = pos;
  let end = pos;
  while (start > 0 && /[\w]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w]/.test(text[end])) end++;
  return start === end ? null : { start, end, value: text.slice(start, end) };
}

function attributeSchemaFor(node) {
  if (!node || (node.kind !== 'attribute' && node.kind !== 'modulation') || !node.owner) return null;
  return node.owner.kind === 'component'
    ? SchemaUtils.getAttributeSchema(node.owner.type, node.attribute)
    : SchemaUtils.getTriggerAttributeSchema(node.owner.type, node.attribute);
}

/**
 * @param {function} getSourceMap - returns the latest parse sourceMap (or null)
 */
export function makeIncrementCommand(getSourceMap, direction) {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const text = line.text;
    const posInLine = head - line.from;

    const sourceMap = getSourceMap ? getSourceMap() : null;
    const node = sourceMap ? sourceMap.lineToNode(line.number) : null;
    const schema = attributeSchemaFor(node);

    // ENUM attributes cycle their values when the cursor is on one
    if (schema && schema.type === AttributeType.ENUM && Array.isArray(schema.values)) {
      const word = findWordAt(text, posInLine);
      const idx = word ? schema.values.indexOf(word.value) : -1;
      if (idx >= 0) {
        const next = schema.values[(idx + direction + schema.values.length) % schema.values.length];
        view.dispatch({
          changes: { from: line.from + word.start, to: line.from + word.end, insert: next },
          selection: { anchor: line.from + word.start + next.length },
        });
        return true;
      }
    }

    const num = findNumberAt(text, posInLine);
    if (!num) return false;

    const coarse = 10;
    let step = 1;
    if (schema && Number.isFinite(schema.step)) step = schema.step;

    return applyStep(view, line, num, direction * step, schema, coarse);
  };
}

function applyStep(view, line, num, delta, schema, coarseFactor) {
  let next = Math.round((num.value + delta) * 1000) / 1000;
  if (schema) {
    if (Number.isFinite(schema.min)) next = Math.max(schema.min, next);
    if (Number.isFinite(schema.max)) next = Math.min(schema.max, next);
  }
  const insert = String(next);
  view.dispatch({
    changes: { from: line.from + num.start, to: line.from + num.end, insert },
    selection: { anchor: line.from + num.start + insert.length },
  });
  return true;
}

export function makeIncrementKeymap(getSourceMap) {
  const up = makeIncrementCommand(getSourceMap, 1);
  const down = makeIncrementCommand(getSourceMap, -1);
  const upBig = wrapCoarse(getSourceMap, 1);
  const downBig = wrapCoarse(getSourceMap, -1);
  return [
    { key: 'Mod-ArrowUp', run: up },
    { key: 'Mod-ArrowDown', run: down },
    { key: 'Shift-Mod-ArrowUp', run: upBig },
    { key: 'Shift-Mod-ArrowDown', run: downBig },
  ];
}

function wrapCoarse(getSourceMap, direction) {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const posInLine = head - line.from;

    const sourceMap = getSourceMap ? getSourceMap() : null;
    const node = sourceMap ? sourceMap.lineToNode(line.number) : null;
    const schema = attributeSchemaFor(node);

    // Shift on an enum still cycles one at a time
    if (schema && schema.type === AttributeType.ENUM) {
      return makeIncrementCommand(getSourceMap, direction)(view);
    }

    const num = findNumberAt(line.text, posInLine);
    if (!num) return false;
    const step = (schema && Number.isFinite(schema.step) ? schema.step : 1) * 10;
    return applyStep(view, line, num, direction * step, schema, 10);
  };
}
