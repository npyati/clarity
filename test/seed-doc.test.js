import { describe, it, expect } from 'vitest';
import {
  AttributeType, ComponentRole, COMPONENT_SCHEMAS, TRIGGER_SCHEMAS,
  SchemaUtils, initializeChordValues,
} from '../src/dsl/schemas.js';
import { InstanceStore } from '../src/dsl/instance-store.js';
import { Parser } from '../src/dsl/parser.js';
import { SEED_DOCUMENT } from '../src/seed-document.js';

initializeChordValues();

describe('Seed document (ships with the app)', () => {
  const store = new InstanceStore();
  const parser = new Parser(
    { AttributeType, ComponentRole, COMPONENT_SCHEMAS, TRIGGER_SCHEMAS, SchemaUtils },
    store
  );
  const result = parser.parse(SEED_DOCUMENT);

  it('parses with zero errors and warnings', () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('produces the expected instrument', () => {
    expect(Object.keys(store.components.global.oscillators).sort()).toEqual(['bass', 'lead']);
    expect(Object.keys(store.components.global.lfos)).toEqual(['vibrato']);
    expect(Object.keys(store.variables.global).sort()).toEqual(
      ['bass_volume', 'lead_volume', 'vibrato_depth', 'vibrato_rate']
    );
    expect(store.getTriggerAttribute('master', 'volume')).toBe(80);
  });

  it('keeps the math expressions on the LFO', () => {
    const lfo = store.getComponent('vibrato');
    expect(lfo.attributes.rate.value).toMatchObject({ type: 'expression', value: 'vibrato_rate + 2' });
    expect(lfo.attributes.depth.value).toMatchObject({ type: 'expression', value: 'vibrato_depth * 0.5' });
  });

  it('routes the vibrato modulation onto lead pitch', () => {
    const pitch = store.getComponent('lead').attributes.pitch;
    expect(pitch.modulation).toMatchObject({ type: 'component_ref', value: 'vibrato' });
  });
});
