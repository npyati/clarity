/**
 * Voice — one sounding tone.
 *
 * Gain staging (two intentional stages):
 *   osc -> oscGain (per-osc envelope, absolute level: volume x A/S/R,
 *                   peak == sustain since the schema has no per-osc decay)
 *   sum -> [per-voice processors from note/key scope] ->
 *   voiceGain (master A/D/S envelope, normalized 0..1, x velocity) -> bus
 */
import { resolveAttr, resolveNumeric } from './resolve.js';
import { EnvelopeTracker, scheduleAttackSustain, scheduleADS } from './envelopes.js';
import { createModulator, createProcessor } from './component-factory.js';

const STEAL_FADE = 0.008;

export class Voice {
  constructor(ctx, store, opts) {
    this.ctx = ctx;
    this.store = store;
    this.id = opts.id;
    this.noteName = opts.noteName;
    this.frequency = opts.frequency;
    this.velocity = opts.velocity ?? 127;
    this.noteScope = opts.noteScope;
    this.keyScope = opts.keyScope || null;
    this.components = opts.components; // merged global+note+key, keyed by plural type
    this.scopedProcessors = opts.scopedProcessors || []; // note/key-scope processors only
    this.isSynthetic = !!opts.isSynthetic;
    this.onEnded = opts.onEnded || (() => {});

    this.startTime = 0;
    this.oscillators = []; // { osc, tracker, releaseTime }
    this.modulators = [];  // factory modulator instances
    this.voiceGain = null;
    this.voiceTracker = null;
    this._released = false;
    this._stopped = false;
    this._nodes = []; // everything to disconnect at reap
  }

  get scopeKey() {
    return this.keyScope || this.noteScope;
  }

  start(destination, when) {
    const ctx = this.ctx;
    this.startTime = when;

    // Voice stage: normalized master envelope x velocity
    this.voiceGain = ctx.createGain();
    this.voiceGain.connect(destination);
    this._nodes.push(this.voiceGain);
    this.voiceTracker = new EnvelopeTracker(this.voiceGain.gain);

    const masterAttrs = this.store.getTriggerAttributes('master');
    const attack = resolveNumeric(this.store, masterAttrs.attack, this.scopeKey, 100) / 1000;
    const decay = resolveNumeric(this.store, masterAttrs.decay, this.scopeKey, 100) / 1000;
    const sustain = resolveNumeric(this.store, masterAttrs.sustain, this.scopeKey, 100) / 100;
    this.masterRelease = resolveNumeric(this.store, masterAttrs.release, this.scopeKey, 500) / 1000;

    const peak = this.velocity / 127;
    scheduleADS(this.voiceTracker, { attack, decay, sustain: sustain * peak, peak }, when);

    // Per-voice processors (declared inside note/key triggers) chain
    // between the oscillator sum and the voice gain
    let sumTarget = this.voiceGain;
    for (const component of this.scopedProcessors) {
      const proc = createProcessor(ctx, this.store, component, this.scopeKey);
      if (!proc) continue;
      proc.output.connect(sumTarget);
      sumTarget = proc.input;
      this._nodes.push(proc.node);
    }
    this._sumTarget = sumTarget;

    // Key-scope actions (held modifier keys)
    this.actions = this.keyScope ? this.store.collectActions(this.keyScope) : [];

    for (const oscComponent of Object.values(this.components.oscillators || {})) {
      this._buildOscillator(oscComponent, when);
    }
  }

  _buildOscillator(component, when) {
    const ctx = this.ctx;
    const attrs = component.attributes;

    const osc = ctx.createOscillator();
    osc.type = resolveAttr(this.store, attrs.wave, this.scopeKey).value || 'sine';

    const octave = resolveNumeric(this.store, attrs.octave, this.scopeKey, 0);
    const baseFreq = this.frequency * Math.pow(2, octave);
    osc.frequency.value = baseFreq;

    const detune = resolveAttr(this.store, attrs.detune, this.scopeKey);
    const pitch = resolveAttr(this.store, attrs.pitch, this.scopeKey);
    const volume = resolveAttr(this.store, attrs.volume, this.scopeKey);

    let totalDetune = (Number(detune.value) || 0) + (Number(pitch.value) || 0);
    let volumeGain = resolveNumeric(this.store, attrs.volume, this.scopeKey, 50) / 100;

    const oscGain = ctx.createGain();
    osc.connect(oscGain);
    oscGain.connect(this._sumTarget);
    this._nodes.push(osc, oscGain);

    // Held-key actions: pitch offsets, volume scaling, extra modulation
    for (const action of this.actions) {
      if (action.type === 'set_pitch') {
        totalDetune += action.value;
      } else if (action.type === 'set_volume') {
        volumeGain *= action.value / 100;
      } else if (action.type === 'apply_modulation') {
        if (action.target === 'pitch') {
          this._modulate(osc.detune, action.modulator, 'cents', baseFreq, when);
        } else if (action.target === 'volume') {
          this._modulate(oscGain.gain, action.modulator, 'percentage', volumeGain, when);
        }
      }
    }

    osc.detune.value = totalDetune;

    if (pitch.modulation) this._modulate(osc.detune, pitch.modulation, 'cents', baseFreq, when);
    if (detune.modulation) this._modulate(osc.detune, detune.modulation, 'cents', baseFreq, when);
    if (volume.modulation) this._modulate(oscGain.gain, volume.modulation, 'percentage', volumeGain, when);

    // Per-osc envelope: level shape (peak == sustain)
    const attack = resolveNumeric(this.store, attrs.attack, this.scopeKey, 100) / 1000;
    const sustainPct = resolveNumeric(this.store, attrs.sustain, this.scopeKey, 50) / 100;
    const releaseTime = resolveNumeric(this.store, attrs.release, this.scopeKey, 500) / 1000;

    const tracker = new EnvelopeTracker(oscGain.gain);
    scheduleAttackSustain(tracker, { attack, sustain: sustainPct * volumeGain }, when);

    osc.start(when);
    this.oscillators.push({ osc, tracker, releaseTime });
  }

  _modulate(param, modulatorRef, unit, baseValue, when) {
    if (!modulatorRef || modulatorRef.type !== 'component_ref') return;
    const component = this.store.getComponent(modulatorRef.value);
    if (!component) {
      console.warn(`Modulator "${modulatorRef.value}" not found`);
      return;
    }
    const modulator = createModulator(this.ctx, this.store, component, this.scopeKey);
    if (modulator) {
      modulator.connect(param, unit, baseValue, when);
      this.modulators.push(modulator);
    }
  }

  /**
   * Release the voice at `when`; returns the time it reaches silence.
   */
  release(when) {
    if (this._released) return this.endTime;
    this._released = true;

    let endTime = this.voiceTracker.release(when, this.masterRelease);
    for (const { tracker, releaseTime } of this.oscillators) {
      endTime = Math.max(endTime, tracker.release(when, releaseTime));
    }
    for (const modulator of this.modulators) {
      if (modulator.release) modulator.release(when);
    }

    this.endTime = endTime + 0.05;
    this._scheduleStop(this.endTime);
    return this.endTime;
  }

  /**
   * Hard-stop (voice stealing): short fade, then stop.
   */
  stop(when) {
    if (this._stopped) return;
    this._released = true;
    this.voiceTracker.holdAt(when);
    this.voiceTracker.rampTo(0, when + STEAL_FADE);
    this.endTime = when + STEAL_FADE + 0.002;
    this._scheduleStop(this.endTime);
  }

  _scheduleStop(at) {
    if (this._stopped) return;
    this._stopped = true;

    const first = this.oscillators[0];
    if (first) {
      first.osc.onended = () => this._reap();
    }
    for (const { osc } of this.oscillators) {
      try { osc.stop(at); } catch (e) { /* already stopped */ }
    }
    for (const modulator of this.modulators) {
      modulator.stop(at);
    }
    if (!first) this._reap();
  }

  _reap() {
    for (const node of this._nodes) {
      try { node.disconnect(); } catch (e) { /* already disconnected */ }
    }
    this._nodes = [];
    this.onEnded(this);
  }
}
