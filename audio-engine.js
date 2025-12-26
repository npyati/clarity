/**
 * ============================================================================
 * GENERIC AUDIO ENGINE
 * ============================================================================
 *
 * Creates and manages Web Audio nodes based on component instances.
 * Handles modulation routing, scope resolution, and variable resolution.
 */

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
    if (masterVolumeAttr !== null) {
      // Handle new { value, modulation } structure
      const volumeValue = (masterVolumeAttr && typeof masterVolumeAttr === 'object' && masterVolumeAttr.value !== undefined)
        ? masterVolumeAttr.value
        : masterVolumeAttr;
      this.masterGain.gain.value = this._percentageToGain(volumeValue);
    } else {
      this.masterGain.gain.value = 0.8; // Default
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
    const noteKey = `${noteName}_${Date.now()}`;
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
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(volumeGain, now + attackTime);
    envGain.gain.setValueAtTime(sustainLevel, now + attackTime);

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

    // Create smooth random noise buffer
    // Buffer length determines the base period before looping
    // We want smooth interpolation, so use longer buffer
    const bufferDuration = 10; // 10 seconds of noise
    const sampleRate = this.audioContext.sampleRate;
    const bufferSize = bufferDuration * sampleRate;
    const buffer = this.audioContext.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    // Generate smooth random values using interpolation
    // Create random control points and interpolate between them
    const controlPointInterval = Math.floor(sampleRate / (rateValue * 4)); // 4 control points per rate cycle
    let lastValue = (Math.random() * 2 - 1); // Start with random value between -1 and 1
    let nextValue = (Math.random() * 2 - 1);
    let controlPointIndex = 0;

    for (let i = 0; i < bufferSize; i++) {
      // Check if we need a new control point
      if (i >= (controlPointIndex + 1) * controlPointInterval) {
        controlPointIndex++;
        lastValue = nextValue;
        nextValue = (Math.random() * 2 - 1);
      }

      // Linear interpolation between control points
      const localIndex = i - controlPointIndex * controlPointInterval;
      const t = localIndex / controlPointInterval;
      // Use smoothstep for smoother interpolation
      const smoothT = t * t * (3 - 2 * t);
      data[i] = lastValue + (nextValue - lastValue) * smoothT;
    }

    // Create buffer source
    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    // Playback rate affects how fast we move through the buffer
    // Higher rate = faster value changes
    noiseSource.playbackRate.value = rateValue / bufferDuration;

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
   * Apply pitch modulation from LFO (DEPRECATED - use _applyModulation instead)
   */
  _applyPitchModulation(oscillator, lfoName) {
    const lfoComponent = this.store.getComponent(lfoName);
    console.log(`_applyPitchModulation: Looking for LFO "${lfoName}":`, lfoComponent);
    if (!lfoComponent) {
      console.warn(`LFO component "${lfoName}" not found!`);
      return;
    }

    // Create LFO
    const lfo = this.audioContext.createOscillator();

    const wave = this._resolveValue(lfoComponent.attributes.wave) || 'sine';
    const rate = this._resolveValue(lfoComponent.attributes.rate) || 5;
    const depth = this._resolveValue(lfoComponent.attributes.depth) || 10;

    console.log(`Creating LFO: wave=${wave}, rate=${rate}Hz, depth=${depth}cents`);

    lfo.type = wave;
    lfo.frequency.value = rate;

    // Create depth gain (convert cents to Hz)
    const depthGain = this.audioContext.createGain();
    const depthInHz = oscillator.frequency.value * (depth / 1200);
    depthGain.gain.value = depthInHz;

    console.log(`LFO depth: ${depth} cents = ${depthInHz.toFixed(2)} Hz at base freq ${oscillator.frequency.value}Hz`);

    // Connect: LFO -> depthGain -> oscillator.frequency
    lfo.connect(depthGain);
    depthGain.connect(oscillator.frequency);

    lfo.start();
    console.log(`✓ LFO started and connected to oscillator frequency`);

    // Track LFO
    this.lfos.push(lfo);
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
    const now = this.audioContext.currentTime;

    // Get master release time
    const masterAttrs = this.store.getTriggerAttributes('master');
    const masterRelease = this._resolveValue(masterAttrs.release);
    const masterReleaseTime = (masterRelease.value || 500) / 1000;

    // Apply release to master envelope
    this.noteGain.gain.cancelScheduledValues(now);
    this.noteGain.gain.setValueAtTime(this.noteGain.gain.value, now);
    this.noteGain.gain.linearRampToValueAtTime(0, now + masterReleaseTime);

    // Apply release to each oscillator envelope
    for (const { envGain, releaseTime } of this.oscillators) {
      envGain.gain.cancelScheduledValues(now);
      envGain.gain.setValueAtTime(envGain.gain.value, now);
      envGain.gain.linearRampToValueAtTime(0, now + releaseTime / 1000);
    }

    // Stop oscillators and LFOs after release
    const maxRelease = Math.max(masterReleaseTime, ...this.oscillators.map(o => o.releaseTime / 1000));
    setTimeout(() => {
      for (const { osc } of this.oscillators) {
        osc.stop();
      }
      for (const lfo of this.lfos) {
        lfo.stop();
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
