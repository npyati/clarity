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
    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);

    // Apply master volume
    const masterVolume = this.store.getTriggerAttribute('master', 'volume');
    if (masterVolume !== null) {
      this.masterGain.gain.value = this._percentageToGain(masterVolume);
    } else {
      this.masterGain.gain.value = 0.8; // Default
    }

    // Create and connect filter if referenced
    const filterRef = this.store.getTriggerAttribute('master', 'filter');
    if (filterRef && filterRef.type === 'component_ref') {
      this.masterFilter = this._createFilterNode(filterRef.value);
      this.masterFilter.connect(this.masterGain);
    }

    // Create and connect compressor if referenced
    const compressorRef = this.store.getTriggerAttribute('master', 'compressor');
    if (compressorRef && compressorRef.type === 'component_ref') {
      this.masterCompressor = this._createCompressorNode(compressorRef.value);
      if (this.masterFilter) {
        this.masterCompressor.connect(this.masterFilter);
      } else {
        this.masterCompressor.connect(this.masterGain);
      }
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
    filter.type = 'lowpass';

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
    osc.type = wave || 'sine';

    // Set frequency (base frequency + octave + detune)
    const octave = this._resolveValue(oscComponent.attributes.octave) || 0;
    const detune = this._resolveValue(oscComponent.attributes.detune) || 0;
    const baseFreq = this.frequency * Math.pow(2, octave);
    osc.frequency.value = baseFreq;
    osc.detune.value = detune;

    // Create envelope gain for this oscillator
    const envGain = this.audioContext.createGain();
    osc.connect(envGain);
    envGain.connect(this.noteGain);

    // Get volume
    const volume = this._resolveValue(oscComponent.attributes.volume) || 50;
    const volumeGain = volume / 100;

    // Apply oscillator envelope (attack, sustain, release)
    const attack = this._resolveValue(oscComponent.attributes.attack) || 100;
    const sustain = this._resolveValue(oscComponent.attributes.sustain) || 50;
    const release = this._resolveValue(oscComponent.attributes.release) || 500;

    const attackTime = attack / 1000;
    const sustainLevel = (sustain / 100) * volumeGain;
    const releaseTime = release / 1000;

    const now = this.audioContext.currentTime;
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(volumeGain, now + attackTime);
    envGain.gain.setValueAtTime(sustainLevel, now + attackTime);

    // Apply pitch modulation (LFO)
    const pitchRef = oscComponent.attributes.pitch;
    console.log(`Oscillator ${oscComponent.name} pitch attribute:`, pitchRef);
    if (pitchRef && pitchRef.type === 'component_ref') {
      console.log(`Applying pitch modulation from ${pitchRef.value} to ${oscComponent.name}`);
      this._applyPitchModulation(osc, pitchRef.value);
    }

    // Start oscillator
    osc.start();

    // Track nodes
    this.oscillators.push({ osc, envGain, releaseTime });
  }

  /**
   * Apply pitch modulation from LFO
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

    const attack = this._resolveValue(masterAttrs.attack) || 100;
    const decay = this._resolveValue(masterAttrs.decay) || 100;
    const sustain = this._resolveValue(masterAttrs.sustain) || 100;
    const release = this._resolveValue(masterAttrs.release) || 500;

    const attackTime = attack / 1000;
    const decayTime = decay / 1000;
    const sustainLevel = sustain / 100;

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
    const masterRelease = this._resolveValue(masterAttrs.release) || 500;
    const masterReleaseTime = masterRelease / 1000;

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
   * Resolve attribute value (handles variables and expressions)
   */
  _resolveValue(value) {
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

  console.log('Audio engine initialized');
}
