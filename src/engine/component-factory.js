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
    connect(param, unit, baseValue, when, amount = 1) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue) * amount;
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
    connect(param, unit, baseValue, when, amount = 1) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue) * amount;
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
    connect(param, unit, baseValue, when, amount = 1) {
      const depthGain = ctx.createGain();
      depthGain.gain.value = depthForUnit(unit, depth, baseValue) * amount;
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

/**
 * Wet/dry facade: one "param" that fans out to the wet and dry gains so
 * live mix updates stay a single bound attribute. Implements the subset
 * of the AudioParam interface that smoothSet/cancelAndHold use.
 */
function mixParam(wetGain, dryGain) {
  return {
    get value() { return wetGain.gain.value; },
    setValueAtTime(v, t) {
      wetGain.gain.setValueAtTime(v, t);
      dryGain.gain.setValueAtTime(1 - v, t);
    },
    setTargetAtTime(v, t, tc) {
      wetGain.gain.setTargetAtTime(v, t, tc);
      dryGain.gain.setTargetAtTime(1 - v, t, tc);
    },
    cancelScheduledValues(t) {
      wetGain.gain.cancelScheduledValues(t);
      dryGain.gain.cancelScheduledValues(t);
    },
  };
}

/** Shell for wet/dry effects: input -> dry -> output, input -> (chain) -> wet -> output */
function wetDryShell(ctx, mixPercent) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const mix = Math.max(0, Math.min(1, mixPercent / 100));
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return { input, output, dry, wet };
}

function buildDelay(ctx, store, component, scopeKey) {
  const time = resolveNumeric(store, component.attributes.time, scopeKey, 300) / 1000;
  const feedback = resolveNumeric(store, component.attributes.feedback, scopeKey, 35) / 100;
  const mixPct = resolveNumeric(store, component.attributes.mix, scopeKey, 40);

  const shell = wetDryShell(ctx, mixPct);
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = Math.min(2, Math.max(0.001, time));
  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = Math.min(0.95, feedback);

  shell.input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(shell.wet);

  return {
    node: shell.input,
    input: shell.input,
    output: shell.output,
    params: {
      time: delay.delayTime, // NOTE: bound value is in seconds; text is ms
      feedback: feedbackGain.gain,
      mix: mixParam(shell.wet, shell.dry),
    },
    // Live param refresh needs unit conversion for 'time'
    paramScale: { time: 1 / 1000, feedback: 1 / 100, mix: 1 / 100 },
  };
}

/** Exponentially decaying noise impulse response */
function makeImpulseResponse(ctx, decaySeconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * decaySeconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  return buffer;
}

function buildReverb(ctx, store, component, scopeKey) {
  const decay = resolveNumeric(store, component.attributes.decay, scopeKey, 1500) / 1000;
  const mixPct = resolveNumeric(store, component.attributes.mix, scopeKey, 30);

  const shell = wetDryShell(ctx, mixPct);
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx, decay);
  shell.input.connect(convolver);
  convolver.connect(shell.wet);

  return {
    node: shell.input,
    input: shell.input,
    output: shell.output,
    params: { mix: mixParam(shell.wet, shell.dry) },
    paramScale: { mix: 1 / 100 },
    // decay changes require a new impulse response -> structural rebuild
  };
}

function distortionCurve(amount) {
  const k = amount * 4;
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function buildDistortion(ctx, store, component, scopeKey) {
  const amount = resolveNumeric(store, component.attributes.amount, scopeKey, 25);
  const mixPct = resolveNumeric(store, component.attributes.mix, scopeKey, 100);

  const shell = wetDryShell(ctx, mixPct);
  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(amount);
  shaper.oversample = '2x';
  shell.input.connect(shaper);
  shaper.connect(shell.wet);

  return {
    node: shell.input,
    input: shell.input,
    output: shell.output,
    params: { mix: mixParam(shell.wet, shell.dry) },
    paramScale: { mix: 1 / 100 },
    // amount changes rebuild the curve -> structural rebuild
  };
}

function buildPan(ctx, store, component, scopeKey) {
  const position = resolveNumeric(store, component.attributes.position, scopeKey, 0);
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, position / 100));
  return {
    node: panner,
    input: panner,
    output: panner,
    params: { position: panner.pan },
    paramScale: { position: 1 / 100 },
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
  delay: buildDelay,
  reverb: buildReverb,
  distortion: buildDistortion,
  pan: buildPan,
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
