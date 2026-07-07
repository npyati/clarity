import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '../src/dsl/expression.js';

const noVars = () => null;
const vars = (values) => (name) => (name in values ? values[name] : null);

describe('ExpressionEvaluator.evaluate', () => {
  it('applies operator precedence', () => {
    expect(ExpressionEvaluator.evaluate('5 + 2 * 3', noVars)).toBe(11);
    expect(ExpressionEvaluator.evaluate('10 / 4 + 1', noVars)).toBe(3.5);
  });

  it('handles parentheses', () => {
    expect(ExpressionEvaluator.evaluate('(2 + 3) * 2', noVars)).toBe(10);
    expect(ExpressionEvaluator.evaluate('((1 + 1)) * (2 + 2)', noVars)).toBe(8);
  });

  it('handles unary minus', () => {
    expect(ExpressionEvaluator.evaluate('-4 + 2', noVars)).toBe(-2);
    expect(ExpressionEvaluator.evaluate('2 * -3', noVars)).toBe(-6);
  });

  it('handles decimals and surrounding whitespace', () => {
    expect(ExpressionEvaluator.evaluate('  12.5  ', noVars)).toBe(12.5);
    expect(ExpressionEvaluator.evaluate('0.1 + 0.2', noVars)).toBeCloseTo(0.3);
  });

  it('resolves variables through the resolver', () => {
    expect(ExpressionEvaluator.evaluate('vibrato_rate + 2', vars({ vibrato_rate: 5 }))).toBe(7);
    expect(ExpressionEvaluator.evaluate('depth * 0.5', vars({ depth: 20 }))).toBe(10);
  });

  it('returns null for unknown variables', () => {
    expect(ExpressionEvaluator.evaluate('missing + 1', noVars)).toBeNull();
  });

  it('returns null on division by zero', () => {
    expect(ExpressionEvaluator.evaluate('5 / 0', noVars)).toBeNull();
    expect(ExpressionEvaluator.evaluate('1 / (2 - 2)', noVars)).toBeNull();
  });

  it('returns null on trailing operators', () => {
    expect(ExpressionEvaluator.evaluate('5 +', noVars)).toBeNull();
    expect(ExpressionEvaluator.evaluate('* 5', noVars)).toBeNull();
  });

  it('returns null on unknown characters instead of mutating the expression', () => {
    // 'x % 2' must NOT silently become 'x2'
    expect(ExpressionEvaluator.evaluate('x % 2', vars({ x: 3, x2: 99 }))).toBeNull();
  });

  it('returns null on unclosed parentheses', () => {
    expect(ExpressionEvaluator.evaluate('(1 + 2', noVars)).toBeNull();
  });

  it('returns null on adjacent values ("5 5" must not merge to 55)', () => {
    expect(ExpressionEvaluator.evaluate('5 5', noVars)).toBeNull();
  });
});

describe('ExpressionEvaluator.isExpression', () => {
  it('detects expressions', () => {
    expect(ExpressionEvaluator.isExpression('a + b')).toBe(true);
    expect(ExpressionEvaluator.isExpression('rate * 0.5')).toBe(true);
  });

  it('rejects plain numbers including negatives', () => {
    expect(ExpressionEvaluator.isExpression('42')).toBe(false);
    expect(ExpressionEvaluator.isExpression('-42')).toBe(false);
    expect(ExpressionEvaluator.isExpression(7)).toBe(false);
  });
});
