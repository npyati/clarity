/**
 * Attribute value resolution for the engine: follows { value, modulation }
 * wrappers, variable references (with scope chain), and math expressions.
 */
import { ExpressionEvaluator } from '../dsl/expression.js';

function resolveSingle(store, value, scopeKey) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'object' && value.type === 'variable_ref') {
    return store.resolveVariable(value.value, scopeKey);
  }

  if (typeof value === 'object' && value.type === 'expression') {
    const resolver = (varName) => {
      const resolved = store.resolveVariable(varName, scopeKey);
      if (resolved === null || resolved === undefined) return null;
      return (typeof resolved === 'object' && 'value' in resolved) ? resolved.value : resolved;
    };
    return ExpressionEvaluator.evaluate(value.value, resolver);
  }

  return value;
}

/**
 * @returns {{ value: any, modulation: object|null }}
 */
export function resolveAttr(store, attrValue, scopeKey = null) {
  if (attrValue && typeof attrValue === 'object' &&
      (Object.prototype.hasOwnProperty.call(attrValue, 'value') ||
       Object.prototype.hasOwnProperty.call(attrValue, 'modulation')) &&
      !attrValue.type) {
    return {
      value: resolveSingle(store, attrValue.value, scopeKey),
      modulation: attrValue.modulation || null,
    };
  }
  return { value: resolveSingle(store, attrValue, scopeKey), modulation: null };
}

/**
 * Resolve to a finite number or the fallback. null/undefined/NaN/'' all
 * fall back (Number(null) === 0 must NOT count as a value).
 */
export function resolveNumeric(store, attrValue, scopeKey, fallback) {
  let v = resolveAttr(store, attrValue, scopeKey).value;
  if (v && typeof v === 'object' && 'value' in v) v = v.value;
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
