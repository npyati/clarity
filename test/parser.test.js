import { describe, it, expect, beforeEach } from 'vitest';
import {
  AttributeType, ComponentRole, COMPONENT_SCHEMAS, TRIGGER_SCHEMAS,
  SchemaUtils, initializeChordValues,
} from '../src/dsl/schemas.js';
import { InstanceStore } from '../src/dsl/instance-store.js';
import { Parser } from '../src/dsl/parser.js';

initializeChordValues();

let store;
let parser;
beforeEach(() => {
  store = new InstanceStore();
  parser = new Parser(
    { AttributeType, ComponentRole, COMPONENT_SCHEMAS, TRIGGER_SCHEMAS, SchemaUtils },
    store
  );
});

const parse = (lines) => parser.parse(lines.join('\n'));

describe('Parser element types', () => {
  it('parses components with attributes', () => {
    const result = parse(['oscillator lead', '  wave square', '  volume 70']);
    expect(result.success).toBe(true);
    const osc = store.getComponent('lead');
    expect(osc.type).toBe('oscillator');
    expect(osc.attributes.wave).toBeDefined();
  });

  it('parses variables with ranges', () => {
    const result = parse(['variable cutoff = 2000 [200, 8000]']);
    expect(result.success).toBe(true);
    expect(store.getVariableMetadata('cutoff')).toMatchObject({ value: 2000, min: 200, max: 8000 });
  });

  it('parses triggers and scopes their contents', () => {
    const result = parse([
      'variable depth = 10',
      'key a',
      '  variable depth = 99',
    ]);
    expect(result.success).toBe(true);
    expect(store.resolveVariable('depth', 'key_a')).toBe(99);
    expect(store.resolveVariable('depth')).toBe(10);
  });

  it('parses modulation nested under an attribute', () => {
    const result = parse([
      'oscillator lead',
      '  wave sine',
      '  pitch 0',
      '    modulation wobble',
      '',
      'lfo wobble',
      '  rate 5',
    ]);
    expect(result.success).toBe(true);
    const pitch = store.getComponent('lead').attributes.pitch;
    expect(pitch.modulation).toMatchObject({ type: 'component_ref', value: 'wobble' });
  });

  it('parses components nested inside trigger scopes', () => {
    // (note-level attributes like 'chord' are still a schema gap —
    // TRIGGER_SCHEMAS.note has no attributes; tracked for Level 4)
    const result = parse([
      'oscillator lead',
      '  wave sawtooth',
      '',
      'note c4',
      '  lowpass damp',
      '    frequency 300',
      '    resonance 1',
    ]);
    expect(result.success).toBe(true);
    const scoped = store.getTriggerScopedComponents('note_c4');
    expect(Object.keys(scoped.filters || {})).toEqual(['damp']);
    const damp = store.getComponent('damp');
    expect(damp.attributes.frequency).toBeDefined();
  });

  it('supports forward references', () => {
    const result = parse([
      'oscillator lead',
      '  pitch 0',
      '    modulation later',
      '',
      'lfo later',
      '  rate 1',
    ]);
    expect(result.success).toBe(true);
  });
});

describe('Parser errors', () => {
  it('reports unknown component types with line numbers', () => {
    const result = parse(['oscillatr lead', '  wave sine']);
    expect(result.success).toBe(false);
    expect(result.errors[0].line).toBe(1);
  });

  it('reports attributes outside any scope', () => {
    const result = parse(['volume 50']);
    expect(result.success).toBe(false);
    expect(result.errors[0].line).toBe(1);
    expect(result.errors[0].message).toMatch(/inside a component or trigger/);
  });

  it('reports duplicate names', () => {
    const result = parse(['oscillator lead', '', 'lfo lead']);
    expect(result.success).toBe(false);
    expect(result.errors[0].line).toBe(3);
  });
});

describe('Parser sourceMap', () => {
  const DOC = [
    'variable depth = 20',      // 1
    '',                         // 2
    'oscillator lead',          // 3
    '  wave sine',              // 4
    '  pitch 0',                // 5
    '    modulation wobble',    // 6
    '',                         // 7
    'lfo wobble',               // 8
    '  rate 5',                 // 9
    '',                         // 10
    'master',                   // 11
    '  volume 80',              // 12
  ];

  it('maps lines to nodes', () => {
    const { sourceMap } = parse(DOC);
    expect(sourceMap.lineToNode(1)).toMatchObject({ kind: 'variable', name: 'depth' });
    expect(sourceMap.lineToNode(2)).toBeNull();
    expect(sourceMap.lineToNode(3)).toMatchObject({ kind: 'component', type: 'oscillator', name: 'lead' });
    expect(sourceMap.lineToNode(4)).toMatchObject({
      kind: 'attribute', attribute: 'wave', owner: { kind: 'component', name: 'lead' },
    });
    expect(sourceMap.lineToNode(6)).toMatchObject({ kind: 'modulation', attribute: 'modulation' });
    expect(sourceMap.lineToNode(11)).toMatchObject({ kind: 'trigger', type: 'master', scopeKey: 'master' });
    expect(sourceMap.lineToNode(12)).toMatchObject({
      kind: 'attribute', attribute: 'volume', owner: { kind: 'trigger', scopeKey: 'master' },
    });
  });

  it('maps nodes back to lines (round trip)', () => {
    const { sourceMap } = parse(DOC);
    for (const line of [1, 3, 4, 8, 9, 11, 12]) {
      const node = sourceMap.lineToNode(line);
      expect(sourceMap.nodeToLine(node)).toBe(line);
    }
  });

  it('finds nodes from minimal queries', () => {
    const { sourceMap } = parse(DOC);
    expect(sourceMap.nodeToLine({ kind: 'component', name: 'wobble' })).toBe(8);
    expect(sourceMap.nodeToLine({
      kind: 'attribute', attribute: 'rate', owner: { kind: 'component', name: 'wobble' },
    })).toBe(9);
    expect(sourceMap.nodeToLine({ kind: 'component', name: 'ghost' })).toBeNull();
  });
});
