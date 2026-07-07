import { describe, it, expect, beforeEach } from 'vitest';
import { InstanceStore, ScopeType } from '../src/dsl/instance-store.js';

let store;
beforeEach(() => {
  store = new InstanceStore();
});

describe('InstanceStore variables', () => {
  it('stores and resolves global variables', () => {
    expect(store.addVariable('cutoff', 2000)).toBe(true);
    expect(store.resolveVariable('cutoff')).toBe(2000);
  });

  it('keeps range metadata', () => {
    store.addVariable('cutoff', 2000, ScopeType.GLOBAL, null, 200, 8000);
    expect(store.getVariableMetadata('cutoff')).toMatchObject({ value: 2000, min: 200, max: 8000 });
  });

  it('resolves scope overrides before globals', () => {
    store.addVariable('depth', 20);
    store.setVariableOverride('depth', 100, 'key_a');
    expect(store.resolveVariable('depth', 'key_a')).toBe(100);
    expect(store.resolveVariable('depth', 'key_b')).toBe(20);
    expect(store.resolveVariable('depth')).toBe(20);
  });

  it('returns null for unknown variables', () => {
    expect(store.resolveVariable('nope')).toBeNull();
  });

  it('rejects duplicate names across kinds', () => {
    expect(store.addComponent('oscillator', 'lead', 'global', null, {})).toBe(true);
    expect(store.addVariable('lead', 5)).toBe(false);
  });
});

describe('InstanceStore components', () => {
  it('stores global components by pluralized type', () => {
    store.addComponent('oscillator', 'lead', 'global', null, {});
    store.addComponent('lfo', 'wob', 'global', null, {});
    expect(Object.keys(store.components.global.oscillators)).toEqual(['lead']);
    expect(Object.keys(store.components.global.lfos)).toEqual(['wob']);
  });

  it('rejects duplicate component names', () => {
    expect(store.addComponent('oscillator', 'lead', 'global', null, {})).toBe(true);
    expect(store.addComponent('lfo', 'lead', 'global', null, {})).toBe(false);
  });

  it('reset clears state and registry', () => {
    store.addComponent('oscillator', 'lead', 'global', null, {});
    store.addVariable('x', 1);
    store.reset();
    expect(Object.keys(store.components.global.oscillators)).toEqual([]);
    expect(store.resolveVariable('x')).toBeNull();
    // Name is reusable after reset
    expect(store.addVariable('lead', 2)).toBe(true);
  });
});
