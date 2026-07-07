/**
 * ============================================================================
 * GENERIC AUDIO ENGINE
 * ============================================================================
 *
 * Creates and manages Web Audio nodes based on component instances.
 * Handles modulation routing, scope resolution, and variable resolution.
 */

/**
 * Hold an AudioParam at its current automation value and cancel what's
 * scheduled after `time`. Prevents the jump-then-ramp release click.
 */
function cancelAndHold(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time); // truncates any in-flight ramp at `time`
  } else {
    // Firefox lacks cancelAndHoldAtTime; cancelScheduledValues alone may
    // snap the param back to its pre-ramp value. Exact segment-based
    // fallback arrives with the Phase D engine rewrite.
    param.cancelScheduledValues(time);
  }
  // Anchor an explicit event at `time`. Without it, a following
  // linearRampToValueAtTime ramps from the PREVIOUS event — potentially a
  // long-finished attack ramp — so the param instantly jumps to a
  // mid-interpolated value (an audible click). Reading .value here is safe
  // because callers pass time === currentTime.
  param.setValueAtTime(param.value, time);
}

/**
 * One shared smooth-noise buffer per AudioContext. The buffer wiggles at
 * NOISE_BASE_RATE Hz so playbackRate maps 1:1 to the requested rate.
 * (Previously ~1.9 MB was allocated per note per noise modulation.)
 */
const NOISE_BASE_RATE = 1;
const _noiseBuffers = new WeakMap();

function getSharedNoiseBuffer(audioContext) {
  let buffer = _noiseBuffers.get(audioContext);
  if (buffer) return buffer;

  const duration = 10;
  const sampleRate = audioContext.sampleRate;
  const size = duration * sampleRate;
  buffer = audioContext.createBuffer(1, size, sampleRate);
  const data = buffer.getChannelData(0);

  // Smooth random walk: interpolated control points, 4 per base-rate cycle
  const interval = Math.floor(sampleRate / (NOISE_BASE_RATE * 4));
  let last = Math.random() * 2 - 1;
  let next = Math.random() * 2 - 1;
  let cp = 0;
  for (let i = 0; i < size; i++) {
    if (i >= (cp + 1) * interval) {
      cp++;
      last = next;
      next = Math.random() * 2 - 1;
    }
    const t = (i - cp * interval) / interval;
    const smoothT = t * t * (3 - 2 * t);
    data[i] = last + (next - last) * smoothT;
  }

  _noiseBuffers.set(audioContext, buffer);
  return buffer;
}

/**
 * Audio Engine class
 */
class AudioEngine {
  constructor(audioContext, store, schemas) {
    this.audioContext = audioContext;
    this.store = store;
    this.schemas = schemas;

    // Master nodes
    this.masterGain = null;
    this.masterFilter = null;
    this.masterCompressor = null;

    // Active notes (for cleanup)
    // Map<noteKey, NoteInstance>
    this.activeNotes = new Map();

    // Monotonic counter for voice keys (Date.now() collides for
    // chord tones created in the same millisecond)
    this._voiceSeq = 0;
  }

  /**
   * Initialize master chain
   */
  initializeMaster() {
    // Get current master settings
    const masterVolumeAttr = this.store.getTriggerAttribute('master', 'volume');
    const filterRef = this.store.getTriggerAttribute('master', 'filter');
    const compressorRef = this.store.getTriggerAttribute('master', 'compressor');

    // Check if structure has changed (filter/compressor references)
    const filterRefValue = (filterRef && filterRef.type === 'component_ref') ? filterRef.value : null;
    const compressorRefValue = (compressorRef && compressorRef.type === 'component_ref') ? compressorRef.value : null;

    const structureChanged = !this.masterGain ||
      this._lastFilterRef !== filterRefValue ||
      this._lastCompressorRef !== compressorRefValue;

    // If structure changed, recreate the chain
    if (structureChanged) {
      // Disconnect old nodes if they exist
      if (this.masterGain) {
        this.masterGain.disconnect();
        this.masterGain = null;
      }
      if (this.masterFilter) {
        this.masterFilter.disconnect();
        this.masterFilter = null;
      }
      if (this.masterCompressor) {
        this.masterCompressor.disconnect();
        this.masterCompressor = null;
      }

      // Create master gain
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);

      // Create and connect filter if referenced
      if (filterRefValue) {
        this.masterFilter = this._createFilterNode(filterRefValue);
        this.masterFilter.connect(this.masterGain);
      }

      // Create and connect compressor if referenced
      if (compressorRefValue) {
        this.masterCompressor = this._createCompressorNode(compressorRefValue);
        if (this.masterFilter) {
          this.masterCompressor.connect(this.masterFilter);
        } else {
          this.masterCompressor.connect(this.masterGain);
        }
      }

      // Store current refs for future comparison
      this._lastFilterRef = filterRefValue;
      this._lastCompressorRef = compressorRefValue;
    }

    // Always update volume (whether structure changed or not)
    const volumePercent = this._resolveNumeric(masterVolumeAttr, 80);
    const gainTarget = Math.max(0, Math.min(1, volumePercent / 100));
    if (structureChanged) {
      this.masterGain.gain.value = gainTarget; // fresh node — set directly
    } else {
      this._smoothSet(this.masterGain.gain, gainTarget);
    }

    // Return the input node (last in chain)
    if (this.masterCompressor) return this.masterCompressor;
    if (this.masterFilter) return this.masterFilter;
    return this.masterGain;
  }

  /**
   * Create a Note instance
   * @param {string} noteName - Note name (e.g., 'c4')
   * @param {number} frequency - Base frequency
   * @param {string|null} keyScope - Active key scope if any (e.g., 'key_a')
   * @returns {NoteInstance} Note instance
   */
  createNote(noteName, frequency, keyScope = null) {
    console.log(`[AudioEngine] Creating note: ${noteName}, keyScope: ${keyScope}`);

    // Determine scope key for note
    const noteScope = `note_${noteName}`;

    // Get all components in scope (global + note + key)
    const components = this._getComponentsInScope(noteScope, keyScope);

    // Create note instance
    const note = new NoteInstance(
      this.audioContext,
      noteName,
      frequency,
      noteScope,
      keyScope,
      components,
      this.store,
      this.schemas
    );

    // Track active note
    const noteKey = `${noteName}_${this._voiceSeq++}`;
    this.activeNotes.set(noteKey, note);

    // Get master input
    const masterInput = this.masterCompressor || this.masterFilter || this.masterGain;

    // Start the note
    note.start(masterInput);

    return note;
  }

  /**
   * Get all components available in a scope (combines global, note, key)
   */
  _getComponentsInScope(noteScope, keyScope) {
    // Start with global
    let components = this.store.getAllComponentsInScope('global');

    // Merge note-specific
    const noteComponents = this.store.getAllComponentsInScope('trigger', noteScope);
    components = this._mergeComponents(components, noteComponents);

    // Merge key-specific if active
    if (keyScope) {
      const keyComponents = this.store.getAllComponentsInScope('trigger', keyScope);
      components = this._mergeComponents(components, keyComponents);
    }

    return components;
  }

  /**
   * Merge component sets (later overrides earlier)
   */
  _mergeComponents(base, override) {
    const result = { ...base };
    for (const [type, instances] of Object.entries(override)) {
      result[type] = { ...result[type], ...instances };
    }
    return result;
  }

  /**
   * Create a filter node from component instance
   */
  _createFilterNode(componentName) {
    const component = this.store.getComponent(componentName);
    if (!component) return null;

    const filter = this.audioContext.createBiquadFilter();

    // Set filter type based on component type
    // Component type is one of: lowpass, highpass, bandpass, notch
    filter.type = component.type;

    // Set frequency
    const freq = this._resolveAttributeValue(component.attributes.frequency, null);
    if (freq !== null) {
      filter.frequency.value = freq;
    }

    // Set resonance
    const res = this._resolveAttributeValue(component.attributes.resonance, null);
    if (res !== null) {
      filter.Q.value = res;
    }

    return filter;
  }

  /**
   * Create a compressor node from component instance
   */
  _createCompressorNode(componentName) {
    const component = this.store.getComponent(componentName);
    if (!component) return null;

    const compressor = this.audioContext.createDynamicsCompressor();

    // Set parameters
    const threshold = this._resolveAttributeValue(component.attributes.threshold, null);
    if (threshold !== null) compressor.threshold.value = threshold;

    const ratio = this._resolveAttributeValue(component.attributes.ratio, null);
    if (ratio !== null) compressor.ratio.value = ratio;

    const knee = this._resolveAttributeValue(component.attributes.knee, null);
    if (knee !== null) compressor.knee.value = knee;

    const attack = this._resolveAttributeValue(component.attributes.attack, null);
    if (attack !== null) compressor.attack.value = attack;

    const release = this._resolveAttributeValue(component.attributes.release, null);
    if (release !== null) compressor.release.value = release;

    return compressor;
  }

  /**
   * Resolve an attribute value (handles variables and references)
   */
  _resolveAttributeValue(attrValue, scopeKey) {
    if (attrValue === null || attrValue === undefined) return null;

    // Check if it's a variable reference
    if (typeof attrValue === 'object' && attrValue.type === 'variable_ref') {
      return this.store.resolveVariable(attrValue.value, scopeKey);
    }

    // Check if it's a component reference
    if (typeof attrValue === 'object' && attrValue.type === 'component_ref') {
      return attrValue; // Return the reference object
    }

    // Return literal value
    return attrValue;
  }

  /**
   * Smoothly move a live AudioParam to a new value (avoids zipper noise
   * from direct .value assignment while audio is running)
   */
  _smoothSet(param, value, timeConstant = 0.02) {
    const now = this.audioContext.currentTime;
    cancelAndHold(param, now);
    param.setTargetAtTime(value, now, timeConstant);
  }

  /**
   * Resolve an attribute value to a finite number, following variable
   * references and expressions; returns fallback if resolution fails.
   * Accepts raw values, { value, modulation } wrappers, variable_ref
   * and expression objects.
   */
  _resolveNumeric(value, fallback) {
    let v = value;
    if (v && typeof v === 'object' && !v.type && v.value !== undefined) {
      v = v.value; // { value, modulation } wrapper
    }
    if (v && typeof v === 'object' && v.type === 'variable_ref') {
      v = this.store.resolveVariable(v.value, null);
    } else if (v && typeof v === 'object' && v.type === 'expression') {
      v = ExpressionEvaluator.evaluate(v.value, (name) => {
        const resolved = this.store.resolveVariable(name, null);
        return (resolved && typeof resolved === 'object' && 'value' in resolved)
          ? resolved.value
          : resolved;
      });
    }
    if (v && typeof v === 'object' && 'value' in v) v = v.value;
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Convert percentage (0-100) to gain (0-1)
   */
  _percentageToGain(percentage) {
    if (typeof percentage === 'object' && percentage.type === 'variable_ref') {
      const resolved = this.store.resolveVariable(percentage.value, null);
      return resolved / 100;
    }
    return percentage / 100;
  }

  /**
   * Stop a note
   */
  stopNote(noteInstance) {
    noteInstance.stop();
    // Remove from active notes
    for (const [key, note] of this.activeNotes.entries()) {
      if (note === noteInstance) {
        this.activeNotes.delete(key);
        break;
      }
    }
  }

  /**
   * Stop all notes
   */
  stopAllNotes() {
    for (const note of this.activeNotes.values()) {
      note.stop();
    }
    this.activeNotes.clear();
  }
}

/**
 * Note Instance class
 * Represents a single note with all its oscillators and modulation
 */
class NoteInstance {
  constructor(audioContext, noteName, frequency, noteScope, keyScope, components, store, schemas) {
    this.audioContext = audioContext;
    this.noteName = noteName;
    this.frequency = frequency;
    this.noteScope = noteScope;
    this.keyScope = keyScope;
    this.components = components;
    this.store = store;
    this.schemas = schemas;

    // Audio nodes created for this note
    this.oscillators = [];
    this.envelopeGains = [];
    this.lfos = [];
    this.noteGain = null;

    // Start time
    this.startTime = 0;

    // Collect actions from key scope (if active)
    this.actions = [];
    if (this.keyScope) {
      this.actions = this.store.collectActions(this.keyScope);
      if (this.actions.length > 0) {
        console.log(`[NoteInstance] Collected ${this.actions.length} actions from ${this.keyScope}:`, this.actions);
      }
    }
  }

  /**
   * Start the note
   */
  start(destination) {
    this.startTime = this.audioContext.currentTime;

    // Create note gain (master envelope will control this)
    this.noteGain = this.audioContext.createGain();
    this.noteGain.connect(destination);

    // Create oscillators
    this._createOscillators();

    // Apply master envelope
    this._applyMasterEnvelope();
  }

  /**
   * Execute actions on audio parameters
   * This is the core of the action-based modulation system
   *
   * @param {AudioParam} detuneParam - The detune parameter to apply pitch actions to
   * @param {AudioParam} gainParam - The gain parameter to apply volume actions to
   * @param {number} baseFreq - Base frequency for modulation calculations
   * @returns {object} { pitchOffset, volumeMultiplier } - The accumulated offsets to apply
   */
  _executeActions(detuneParam, gainParam, baseFreq) {
    let pitchOffset = 0;
    let volumeMultiplier = 1.0;

    for (const action of this.actions) {
      switch (action.type) {
        case 'set_pitch':
          // Add to pitch offset (in cents)
          pitchOffset += action.value;
          console.log(`[Action] Set pitch: +${action.value} cents (total: ${pitchOffset})`);
          break;

        case 'set_volume':
          // Multiply volume (convert percentage to 0-1 range)
          volumeMultiplier *= action.value / 100;
          console.log(`[Action] Set volume: ${action.value}% (multiplier: ${volumeMultiplier})`);
          break;

        case 'apply_modulation':
          if (action.target === 'pitch' && detuneParam) {
            // Apply modulation to detune parameter
            console.log(`[Action] Apply pitch modulation:`, action.modulator);
            this._applyModulation(detuneParam, action.modulator, 'cents', baseFreq);
          } else if (action.target === 'volume' && gainParam) {
            // Apply modulation to gain parameter
            console.log(`[Action] Apply volume modulation:`, action.modulator);
            this._applyModulation(gainParam, action.modulator, 'percentage', 1.0);
          }
          break;

        default:
          console.warn(`[Action] Unknown action type: ${action.type}`);
      }
    }

    return { pitchOffset, volumeMultiplier };
  }

  /**
   * Create all oscillators for this note
   */
  _createOscillators() {
    const oscillators = this.components.oscillators || {};

    for (const [name, oscComponent] of Object.entries(oscillators)) {
      this._createOscillator(oscComponent);
    }
  }

  /**
   * Create a single oscillator
   */
  _createOscillator(oscComponent) {
    const osc = this.audioContext.createOscillator();

    // Set waveform
    const wave = this._resolveValue(oscComponent.attributes.wave);
    osc.type = wave.value || 'sine';

    // Set frequency (base frequency + octave)
    const octave = this._resolveValue(oscComponent.attributes.octave);
    const baseFreq = this.frequency * Math.pow(2, octave.value || 0);
    osc.frequency.value = baseFreq;

    // Apply detune and pitch (both in cents)
    const detune = this._resolveValue(oscComponent.attributes.detune);
    const pitch = this._resolveValue(oscComponent.attributes.pitch);

    let totalDetune = (detune.value || 0) + (pitch.value || 0);

    // Create envelope gain for this oscillator (needed before action execution)
    const envGain = this.audioContext.createGain();
    osc.connect(envGain);
    envGain.connect(this.noteGain);

    // Get volume
    const volume = this._resolveValue(oscComponent.attributes.volume);
    let volumeGain = (volume.value || 50) / 100;

    // Execute actions from key scope (action-based modulation system)
    // This replaces the old bespoke key trigger code
    if (this.actions.length > 0) {
      const actionResults = this._executeActions(osc.detune, envGain.gain, baseFreq);
      totalDetune += actionResults.pitchOffset;
      volumeGain *= actionResults.volumeMultiplier;
    }

    // Apply total detune
    osc.detune.value = totalDetune;

    // Apply pitch modulation if present
    if (pitch.modulation) {
      console.log(`Applying pitch modulation to ${oscComponent.name}:`, pitch.modulation);
      this._applyModulation(osc.detune, pitch.modulation, 'cents', baseFreq);
    }

    // Apply detune modulation if present
    if (detune.modulation) {
      console.log(`Applying detune modulation to ${oscComponent.name}:`, detune.modulation);
      this._applyModulation(osc.detune, detune.modulation, 'cents', baseFreq);
    }

    // Apply oscillator envelope (attack, sustain, release)
    const attack = this._resolveValue(oscComponent.attributes.attack);
    const sustain = this._resolveValue(oscComponent.attributes.sustain);
    const release = this._resolveValue(oscComponent.attributes.release);

    const attackTime = (attack.value || 100) / 1000;
    const sustainLevel = ((sustain.value || 50) / 100) * volumeGain;
    const releaseTime = (release.value || 500) / 1000;

    const now = this.audioContext.currentTime;
    // Gain staging: this per-oscillator stage owns absolute LEVEL
    // (volume x attack/sustain/release; the schema has no per-osc decay,
    // so peak == sustain). The master noteGain stage owns SHAPE
    // (normalized A/D/S envelope in _applyMasterEnvelope). Ramping to
    // full volume and jumping down to sustain here was an audible click
    // on every note attack.
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime);

    // Apply volume modulation if present
    if (volume.modulation) {
      console.log(`Applying volume modulation to ${oscComponent.name}:`, volume.modulation);
      this._applyModulation(envGain.gain, volume.modulation, 'percentage', volumeGain);
    }

    // Start oscillator
    osc.start();

    // Track nodes
    this.oscillators.push({ osc, envGain, releaseTime });
  }

  /**
   * Apply modulation to an AudioParam (generic)
   * @param {AudioParam} audioParam - The parameter to modulate (e.g., oscillator.detune, gain.gain)
   * @param {object} modulationRef - The modulation reference { type: 'component_ref', value: 'lfoname', componentType: 'lfo' }
   * @param {string} unit - The unit type ('cents', 'percentage', 'frequency', etc.)
   * @param {number} baseValue - Base value for calculating modulation depth
   */
  _applyModulation(audioParam, modulationRef, unit, baseValue) {
    if (!modulationRef || modulationRef.type !== 'component_ref') {
      return;
    }

    const modulatorName = modulationRef.value;
    const modulatorType = modulationRef.componentType;

    if (modulatorType === 'lfo') {
      this._applyLFOModulation(audioParam, modulatorName, unit, baseValue);
    } else if (modulatorType === 'envelope') {
      // TODO: Implement envelope modulation
      console.warn(`Envelope modulation not yet implemented for ${modulatorName}`);
    } else if (modulatorType === 'noise') {
      this._applyNoiseModulation(audioParam, modulatorName, unit, baseValue);
    }
  }

  /**
   * Apply LFO modulation to an AudioParam
   */
  _applyLFOModulation(audioParam, lfoName, unit, baseValue) {
    const lfoComponent = this.store.getComponent(lfoName);
    if (!lfoComponent) {
      console.warn(`LFO component "${lfoName}" not found!`);
      return;
    }

    // Create LFO oscillator
    const lfo = this.audioContext.createOscillator();

    const wave = this._resolveValue(lfoComponent.attributes.wave);
    const rate = this._resolveValue(lfoComponent.attributes.rate);
    const depth = this._resolveValue(lfoComponent.attributes.depth);

    lfo.type = wave.value || 'sine';
    lfo.frequency.value = rate.value || 5;

    // Create depth gain - scale based on unit type
    const depthGain = this.audioContext.createGain();
    let depthValue = depth.value || 10;

    // Convert depth to appropriate scale based on unit
    if (unit === 'cents') {
      // For detune parameter, cents are used directly (no conversion needed)
      // The AudioParam.detune already accepts cents
      depthValue = depthValue;
    } else if (unit === 'percentage') {
      // Convert percentage to 0-1 range
      depthValue = depthValue / 100;
    } else if (unit === 'frequency') {
      // Use depth as Hz directly
      depthValue = depthValue;
    }

    depthGain.gain.value = depthValue;

    // Connect: LFO -> depthGain -> audioParam
    lfo.connect(depthGain);
    depthGain.connect(audioParam);

    lfo.start();
    console.log(`✓ LFO "${lfoName}" connected to parameter (depth=${depthValue})`);

    // Track LFO
    this.lfos.push(lfo);
  }

  /**
   * Apply Noise modulation to an AudioParam
   * Generates smooth, continuous random drift using interpolated noise
   */
  _applyNoiseModulation(audioParam, noiseName, unit, baseValue) {
    const noiseComponent = this.store.getComponent(noiseName);
    if (!noiseComponent) {
      console.warn(`Noise component "${noiseName}" not found!`);
      return;
    }

    const rate = this._resolveValue(noiseComponent.attributes.rate);
    const depth = this._resolveValue(noiseComponent.attributes.depth);

    const rateValue = rate.value || 0.5;
    let depthValue = depth.value || 2;

    // Convert depth to appropriate scale based on unit
    if (unit === 'cents') {
      // For detune parameter, cents are used directly (no conversion needed)
      depthValue = depthValue;
    } else if (unit === 'percentage') {
      depthValue = depthValue / 100;
    } else if (unit === 'frequency') {
      // Use depth as Hz directly
      depthValue = depthValue;
    }

    // Shared buffer wiggles at NOISE_BASE_RATE Hz, so playbackRate maps
    // 1:1 to the requested rate (the old per-note buffer baked the rate
    // into its content AND divided playbackRate by the buffer duration,
    // making the effective rate ~10x slower than configured)
    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = getSharedNoiseBuffer(this.audioContext);
    noiseSource.loop = true;
    noiseSource.playbackRate.value = Math.max(0.01, rateValue) / NOISE_BASE_RATE;

    // Create depth gain
    const depthGain = this.audioContext.createGain();
    depthGain.gain.value = depthValue;

    // Connect: noiseSource -> depthGain -> audioParam
    noiseSource.connect(depthGain);
    depthGain.connect(audioParam);

    noiseSource.start();
    console.log(`✓ Noise "${noiseName}" connected to parameter (rate=${rateValue}Hz, depth=${depthValue})`);

    // Track noise source (store in lfos array for cleanup)
    this.lfos.push(noiseSource);
  }

  /**
   * Apply master envelope
   */
  _applyMasterEnvelope() {
    // Get master envelope attributes (from master trigger or use defaults)
    const masterAttrs = this.store.getTriggerAttributes('master');

    const attack = this._resolveValue(masterAttrs.attack);
    const decay = this._resolveValue(masterAttrs.decay);
    const sustain = this._resolveValue(masterAttrs.sustain);
    const release = this._resolveValue(masterAttrs.release);

    const attackTime = (attack.value || 100) / 1000;
    const decayTime = (decay.value || 100) / 1000;
    const sustainLevel = (sustain.value || 100) / 100;

    const now = this.audioContext.currentTime;
    this.noteGain.gain.setValueAtTime(0, now);
    this.noteGain.gain.linearRampToValueAtTime(1, now + attackTime);
    this.noteGain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
  }

  /**
   * Stop the note
   */
  stop() {
    if (this._stopped) return;
    this._stopped = true;

    const now = this.audioContext.currentTime;

    // Get master release time
    const masterAttrs = this.store.getTriggerAttributes('master');
    const masterRelease = this._resolveValue(masterAttrs.release);
    const masterReleaseTime = (masterRelease.value || 500) / 1000;

    // Apply release to master envelope (hold the in-flight automation
    // value, then ramp — reading .gain.value after cancelScheduledValues
    // caused a jump-then-ramp click)
    cancelAndHold(this.noteGain.gain, now);
    this.noteGain.gain.linearRampToValueAtTime(0, now + masterReleaseTime);

    // Apply release to each oscillator envelope (releaseTime is already
    // in seconds — dividing by 1000 again collapsed the release to ~0.5ms,
    // an audible click)
    for (const { envGain, releaseTime } of this.oscillators) {
      cancelAndHold(envGain.gain, now);
      envGain.gain.linearRampToValueAtTime(0, now + releaseTime);
    }

    // Stop oscillators and LFOs after release
    const maxRelease = Math.max(masterReleaseTime, ...this.oscillators.map(o => o.releaseTime));
    setTimeout(() => {
      for (const { osc } of this.oscillators) {
        try { osc.stop(); } catch (e) { /* already stopped */ }
      }
      for (const lfo of this.lfos) {
        try { lfo.stop(); } catch (e) { /* already stopped */ }
      }
    }, maxRelease * 1000 + 100);
  }

  /**
   * Resolve attribute value (handles variables, expressions, and new modulation structure)
   * @param {*} attrValue - Raw attribute value from component
   * @returns {{ value: number|string, modulation: object|null }} - Resolved value and modulation
   */
  _resolveValue(attrValue) {
    // Handle new structure: { value, modulation }
    if (attrValue && typeof attrValue === 'object' &&
        (attrValue.hasOwnProperty('value') || attrValue.hasOwnProperty('modulation'))) {
      const resolvedValue = this._resolveSingleValue(attrValue.value);
      return {
        value: resolvedValue,
        modulation: attrValue.modulation || null
      };
    }

    // Handle old structure: plain value
    const resolvedValue = this._resolveSingleValue(attrValue);
    return { value: resolvedValue, modulation: null };
  }

  /**
   * Resolve a single value (variable ref, expression, or literal)
   */
  _resolveSingleValue(value) {
    if (value === null || value === undefined) return null;

    // Handle variable references
    if (typeof value === 'object' && value.type === 'variable_ref') {
      return this.store.resolveVariable(value.value, this.keyScope || this.noteScope);
    }

    // Handle mathematical expressions
    if (typeof value === 'object' && value.type === 'expression') {
      console.log(`Evaluating expression: ${value.value}`);

      // Create a variable resolver for the current scope
      const variableResolver = (varName) => {
        const resolved = this.store.resolveVariable(varName, this.keyScope || this.noteScope);
        if (resolved === null || resolved === undefined) {
          return null;
        }
        // If the variable itself is an object (e.g., metadata), extract the value
        if (typeof resolved === 'object' && 'value' in resolved) {
          return resolved.value;
        }
        return resolved;
      };

      // Evaluate the expression
      const result = ExpressionEvaluator.evaluate(value.value, variableResolver);
      if (result === null) {
        console.error(`Failed to evaluate expression: ${value.value}`);
        return null;
      }
      console.log(`Expression "${value.value}" evaluated to: ${result}`);
      return result;
    }

    return value;
  }
}

// Global audio engine instance (will be initialized after audio context is created)
let audioEngine = null;

function initializeAudioEngine(audioContext) {
  if (typeof instanceStore === 'undefined' || typeof COMPONENT_SCHEMAS === 'undefined') {
    console.error('Cannot initialize audio engine: instanceStore or schemas not loaded');
    return;
  }

  audioEngine = new AudioEngine(audioContext, instanceStore, {
    AttributeType,
    COMPONENT_SCHEMAS,
    TRIGGER_SCHEMAS,
    SchemaUtils
  });

  audioEngine.initializeMaster();

  // Make audio engine globally available for visualizer
  window.audioEngine = audioEngine;

  console.log('Audio engine initialized and assigned to window.audioEngine');
}
