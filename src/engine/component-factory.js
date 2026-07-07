/**
 * Schema-role-keyed component factory.
 *
 * A new component type needs only a schema entry (role + attributes) and,
 * if it introduces genuinely new node behavior, one factory entry here.
 *
 * Envelope-modulation depth semantics (envelope `depth` attribute):
 *  - unit 'cents'      -> envelope shape (0..1) x depth, in cents
 *  - unit 'percentage' -> shape x (depth/100) x base gain
 *  - unit 'frequency'  -> shape x (depth/100) x base frequency
 */
import { COMPONENT_SCHEMAS } from '../dsl/schemas.js';
import { resolveAttr, resolveNumeric } from './resolve.js';
import { EnvelopeTracker, scheduleAttackSustain, scheduleADS } from './envelopes.js';
import { getSharedNoiseBuffer, NOISE_BASE_RATE } from './noise.js';

function depthForUnit(unit, depth, baseValue) {
  if (unit === 'cents') return depth;
  if (unit === 'percentage') return (depth / 100) * Math.abs(baseValue || 1);
  if (unit === 'frequency') return (depth / 100) * Math.abs(baseValue || 440);
  return depth;
}

// ---------------------------------------------------------------------------
// MODULATORS (lfo, noise, envelope) — connect to a target AudioParam
// ---------------------------------------------------------------------------

function buildLfo(ctx, store, component, scopeKey) {
  const rate = resolveNumeric(store, component.attributes.rate, scopeKey, 5);
  const wave = resolveAttr(store, component.attributes.wave, scopeKey).value || 'sine';
  const depth = resolveNumeric(store, component.attributes.depth, scopeKey, 10);

  const lfo = ctx.createOscillator();
  lfo.type = wave;
  lfo.frequency.value = Math.max(0.01, rate);

  return {
    connect(param, unit, baseValue, when) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue);
      lfo.connect(depthGain);
      depthGain.connect(param);
      lfo.start(when);
    },
    release() {},
    stop(at) {
      try { lfo.stop(at); } catch (e) { /* already stopped */ }
    },
  };
}

function buildNoise(ctx, store, component, scopeKey) {
  const rate = resolveNumeric(store, component.attributes.rate, scopeKey, 0.5);
  const depth = resolveNumeric(store, component.attributes.depth, scopeKey, 2);

  const source = ctx.createBufferSource();
  source.buffer = getSharedNoiseBuffer(ctx);
  source.loop = true;
  source.playbackRate.value = Math.max(0.01, rate) / NOISE_BASE_RATE;

  return {
    connect(param, unit, baseValue, when) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue);
      source.connect(depthGain);
      depthGain.connect(param);
      source.start(when);
    },
    release() {},
    stop(at) {
      try { source.stop(at); } catch (e) { /* already stopped */ }
    },
  };
}

function buildEnvelopeModulator(ctx, store, component, scopeKey) {
  const attack = resolveNumeric(store, component.attributes.attack, scopeKey, 100) / 1000;
  const decay = resolveNumeric(store, component.attributes.decay, scopeKey, 100) / 1000;
  const sustain = resolveNumeric(store, component.attributes.sustain, scopeKey, 100) / 100;
  const releaseTime = resolveNumeric(store, component.attributes.release, scopeKey, 500) / 1000;
  const depth = resolveNumeric(store, component.attributes.depth, scopeKey, 100);

  // ConstantSource carries the 0..1 envelope shape; a gain node scales it
  // to the target unit
  const shape = ctx.createConstantSource();
  shape.offset.value = 0;
  const tracker = new EnvelopeTracker(shape.offset);

  return {
    connect(param, unit, baseValue, when) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue);
      shape.connect(depthGain);
      depthGain.connect(param);
      shape.start(when);
      scheduleADS(tracker, { attack, decay, sustain }, when);
    },
    release(when) {
      return tracker.release(when, releaseTime);
    },
    stop(at) {
      try { shape.stop(at); } catch (e) { /* already stopped */ }
    },
  };
}

// ---------------------------------------------------------------------------
// PROCESSORS (filters, compressor) — audio in, audio out
// ---------------------------------------------------------------------------

function buildFilter(ctx, store, component, scopeKey) {
  const filter = ctx.createBiquadFilter();
  filter.type = component.type; // lowpass | highpass | bandpass | notch
  filter.frequency.value = resolveNumeric(store, component.attributes.frequency, scopeKey, 20000);
  filter.Q.value = resolveNumeric(store, component.attributes.resonance, scopeKey, 1);
  return {
    node: filter,
    input: filter,
    output: filter,
    params: { frequency: filter.frequency, resonance: filter.Q },
  };
}

function buildCompressor(ctx, store, component, scopeKey) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = resolveNumeric(store, component.attributes.threshold, scopeKey, -20);
  comp.ratio.value = resolveNumeric(store, component.attributes.ratio, scopeKey, 12);
  comp.knee.value = resolveNumeric(store, component.attributes.knee, scopeKey, 30);
  comp.attack.value = resolveNumeric(store, component.attributes.attack, scopeKey, 0.003);
  comp.release.value = resolveNumeric(store, component.attributes.release, scopeKey, 0.25);
  return {
    node: comp,
    input: comp,
    output: comp,
    params: {
      threshold: comp.threshold,
      ratio: comp.ratio,
      knee: comp.knee,
      attack: comp.attack,
      release: comp.release,
    },
  };
}

const MODULATOR_BUILDERS = {
  lfo: buildLfo,
  noise: buildNoise,
  envelope: buildEnvelopeModulator,
};

const PROCESSOR_BUILDERS = {
  lowpass: buildFilter,
  highpass: buildFilter,
  bandpass: buildFilter,
  notch: buildFilter,
  compressor: buildCompressor,
};

export function createModulator(ctx, store, component, scopeKey) {
  const build = MODULATOR_BUILDERS[component.type];
  if (!build) {
    console.warn(`No modulator builder for component type "${component.type}"`);
    return null;
  }
  return build(ctx, store, component, scopeKey);
}

export function createProcessor(ctx, store, component, scopeKey) {
  const build = PROCESSOR_BUILDERS[component.type];
  if (!build) {
    console.warn(`No processor builder for component type "${component.type}"`);
    return null;
  }
  return build(ctx, store, component, scopeKey);
}

export function roleOf(componentType) {
  return COMPONENT_SCHEMAS[componentType]?.role || null;
}
