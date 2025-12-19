/**
 * ============================================================================
 * COMPONENT AND ATTRIBUTE SCHEMAS
 * ============================================================================
 *
 * This file defines the schema for all component types, triggers, and their
 * attributes. These schemas drive:
 * - Document parsing and validation
 * - UI generation
 * - Audio engine instantiation
 * - Modulation routing
 *
 * The schema system enables adding new component types and attributes without
 * modifying parser, UI, or audio engine code.
 */

/**
 * Attribute types define how values are stored, validated, and rendered
 */
const AttributeType = {
  // Numeric value with range
  NUMBER: 'number',
  // Integer value with range
  INTEGER: 'integer',
  // Percentage (0-100, stored as 0-1 internally)
  PERCENTAGE: 'percentage',
  // Time value in milliseconds
  TIME_MS: 'time_ms',
  // Time value in seconds
  TIME_SEC: 'time_sec',
  // Frequency in Hz
  FREQUENCY: 'frequency',
  // Enum (predefined set of values)
  ENUM: 'enum',
  // Reference to a variable
  VARIABLE_REF: 'variable_ref',
  // Reference to a component (for modulation)
  COMPONENT_REF: 'component_ref'
};

/**
 * Component roles define how components are used in the audio graph
 */
const ComponentRole = {
  // Generates audio signal (oscillator)
  SOURCE: 'source',
  // Modulates other parameters (lfo, envelope)
  MODULATOR: 'modulator',
  // Processes audio signal (filter, compressor)
  PROCESSOR: 'processor'
};

/**
 * Define all component type schemas
 */
const COMPONENT_SCHEMAS = {
  oscillator: {
    role: ComponentRole.SOURCE,
    description: 'Audio oscillator that generates waveforms',
    attributes: {
      wave: {
        type: AttributeType.ENUM,
        values: ['sine', 'square', 'sawtooth', 'triangle'],
        default: 'sine',
        description: 'Waveform type',
        ui: { control: 'select' }
      },
      octave: {
        type: AttributeType.INTEGER,
        min: -2,
        max: 2,
        step: 1,
        default: 0,
        description: 'Octave offset',
        ui: { control: 'slider' }
      },
      detune: {
        type: AttributeType.INTEGER,
        min: -100,
        max: 100,
        step: 1,
        default: 0,
        unit: 'cents',
        description: 'Fine pitch adjustment',
        ui: { control: 'slider' }
      },
      volume: {
        type: AttributeType.PERCENTAGE,
        min: 0,
        max: 100,
        step: 1,
        default: 50,
        description: 'Oscillator volume',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF, AttributeType.COMPONENT_REF],
        acceptsModulation: ['lfo', 'envelope']
      },
      pitch: {
        type: AttributeType.COMPONENT_REF,
        acceptsComponents: ['lfo'],
        description: 'Pitch modulation source',
        modulationMode: 'additive',
        unit: 'cents'
      },
      attack: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 100,
        default: 100,
        description: 'Attack time',
        ui: { control: 'slider', label: 'attack time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      sustain: {
        type: AttributeType.PERCENTAGE,
        min: 0,
        max: 100,
        step: 1,
        default: 50,
        description: 'Sustain level',
        ui: { control: 'slider', label: 'sustain level' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      release: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 100,
        default: 500,
        description: 'Release time',
        ui: { control: 'slider', label: 'release time' },
        canReference: [AttributeType.VARIABLE_REF]
      }
    }
  },

  lfo: {
    role: ComponentRole.MODULATOR,
    description: 'Low frequency oscillator for modulation',
    attributes: {
      rate: {
        type: AttributeType.NUMBER,
        min: 0,
        max: 20,
        step: 0.1,
        default: 5,
        unit: 'Hz',
        description: 'LFO rate',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      depth: {
        type: AttributeType.NUMBER,
        min: 0,
        max: 50,
        step: 1,
        default: 10,
        unit: 'cents',
        description: 'Modulation depth',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      wave: {
        type: AttributeType.ENUM,
        values: ['sine', 'triangle', 'square', 'sawtooth'],
        default: 'sine',
        description: 'LFO waveform',
        ui: { control: 'select' }
      }
    }
  },

  envelope: {
    role: ComponentRole.MODULATOR,
    description: 'ADSR envelope for modulation',
    attributes: {
      attack: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 10,
        default: 100,
        description: 'Attack time',
        ui: { control: 'slider', label: 'attack time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      decay: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 10,
        default: 100,
        description: 'Decay time',
        ui: { control: 'slider', label: 'decay time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      sustain: {
        type: AttributeType.PERCENTAGE,
        min: 0,
        max: 100,
        step: 1,
        default: 100,
        description: 'Sustain level',
        ui: { control: 'slider', label: 'sustain level' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      release: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 5000,
        step: 50,
        default: 500,
        description: 'Release time',
        ui: { control: 'slider', label: 'release time' },
        canReference: [AttributeType.VARIABLE_REF]
      }
    }
  },

  filter: {
    role: ComponentRole.PROCESSOR,
    description: 'Audio filter',
    attributes: {
      frequency: {
        type: AttributeType.FREQUENCY,
        min: 20,
        max: 20000,
        step: 1,
        default: 20000,
        unit: 'Hz',
        description: 'Filter cutoff frequency',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF, AttributeType.COMPONENT_REF],
        acceptsModulation: ['lfo', 'envelope']
      },
      resonance: {
        type: AttributeType.NUMBER,
        min: 0.0001,
        max: 20,
        step: 0.1,
        default: 1,
        description: 'Filter resonance (Q factor)',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF, AttributeType.COMPONENT_REF],
        acceptsModulation: ['lfo', 'envelope']
      }
    }
  },

  compressor: {
    role: ComponentRole.PROCESSOR,
    description: 'Dynamic range compressor',
    attributes: {
      threshold: {
        type: AttributeType.NUMBER,
        min: -100,
        max: 0,
        step: 1,
        default: -20,
        unit: 'dB',
        description: 'Compression threshold',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      ratio: {
        type: AttributeType.NUMBER,
        min: 1,
        max: 20,
        step: 0.1,
        default: 12,
        description: 'Compression ratio',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      knee: {
        type: AttributeType.NUMBER,
        min: 0,
        max: 40,
        step: 1,
        default: 30,
        unit: 'dB',
        description: 'Knee width',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      attack: {
        type: AttributeType.TIME_SEC,
        min: 0,
        max: 1,
        step: 0.001,
        default: 0.003,
        description: 'Attack time',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      release: {
        type: AttributeType.TIME_SEC,
        min: 0,
        max: 3,
        step: 0.01,
        default: 0.25,
        description: 'Release time',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      }
    }
  }
};

/**
 * Define trigger schemas
 * Triggers create scopes and can contain components, attributes, and variable overrides
 */
const TRIGGER_SCHEMAS = {
  master: {
    description: 'Master output stage',
    canHaveAttributes: true,
    canContainComponents: true,
    canOverrideVariables: true,
    attributes: {
      volume: {
        type: AttributeType.PERCENTAGE,
        min: 0,
        max: 100,
        step: 1,
        default: 80,
        description: 'Master volume',
        ui: { control: 'slider' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      attack: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 10,
        default: 100,
        description: 'Master attack time',
        ui: { control: 'slider', label: 'attack time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      decay: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 10,
        default: 100,
        description: 'Master decay time',
        ui: { control: 'slider', label: 'decay time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      sustain: {
        type: AttributeType.PERCENTAGE,
        min: 0,
        max: 100,
        step: 1,
        default: 100,
        description: 'Master sustain level',
        ui: { control: 'slider', label: 'sustain level' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      release: {
        type: AttributeType.TIME_MS,
        min: 0,
        max: 2000,
        step: 10,
        default: 500,
        description: 'Master release time',
        ui: { control: 'slider', label: 'release time' },
        canReference: [AttributeType.VARIABLE_REF]
      },
      filter: {
        type: AttributeType.COMPONENT_REF,
        acceptsComponents: ['filter'],
        description: 'Master filter'
      },
      compressor: {
        type: AttributeType.COMPONENT_REF,
        acceptsComponents: ['compressor'],
        description: 'Master compressor'
      },
      envelope: {
        type: AttributeType.COMPONENT_REF,
        acceptsComponents: ['envelope'],
        description: 'Master envelope'
      },
      chord: {
        type: AttributeType.ENUM,
        values: ['none'], // Will be populated from chords.js via initializeChordValues()
        default: 'none',
        description: 'Global chord',
        ui: { control: 'select' },
        allowCustom: true // Allows custom numeric chord definitions
      }
    }
  },

  note: {
    description: 'Note-specific scope',
    requiresName: true,
    canHaveAttributes: false,
    canContainComponents: true,
    canOverrideVariables: true
  },

  key: {
    description: 'Key-triggered scope',
    requiresName: true,
    canHaveAttributes: false,
    canContainComponents: true,
    canOverrideVariables: true
  }
};

/**
 * Helper functions for schema access
 */
const SchemaUtils = {
  /**
   * Get component schema by type name
   */
  getComponentSchema(typeName) {
    return COMPONENT_SCHEMAS[typeName] || null;
  },

  /**
   * Get trigger schema by type name
   */
  getTriggerSchema(typeName) {
    return TRIGGER_SCHEMAS[typeName] || null;
  },

  /**
   * Get attribute schema for a component type
   */
  getAttributeSchema(componentType, attributeName) {
    const schema = this.getComponentSchema(componentType);
    return schema?.attributes[attributeName] || null;
  },

  /**
   * Get attribute schema for a trigger type
   */
  getTriggerAttributeSchema(triggerType, attributeName) {
    const schema = this.getTriggerSchema(triggerType);
    return schema?.attributes?.[attributeName] || null;
  },

  /**
   * Check if a component type exists
   */
  isValidComponentType(typeName) {
    return COMPONENT_SCHEMAS.hasOwnProperty(typeName);
  },

  /**
   * Check if a trigger type exists
   */
  isValidTriggerType(typeName) {
    return TRIGGER_SCHEMAS.hasOwnProperty(typeName);
  },

  /**
   * Get all component type names
   */
  getAllComponentTypes() {
    return Object.keys(COMPONENT_SCHEMAS);
  },

  /**
   * Get all trigger type names
   */
  getAllTriggerTypes() {
    return Object.keys(TRIGGER_SCHEMAS);
  },

  /**
   * Check if an attribute can accept a component reference
   */
  canAttributeAcceptComponent(componentType, attributeName, modulatorType) {
    const attrSchema = this.getAttributeSchema(componentType, attributeName);
    if (!attrSchema) return false;

    if (attrSchema.type === AttributeType.COMPONENT_REF) {
      return attrSchema.acceptsComponents?.includes(modulatorType) || false;
    }

    if (attrSchema.acceptsModulation) {
      return attrSchema.acceptsModulation.includes(modulatorType);
    }

    return false;
  },

  /**
   * Check if an attribute can reference a variable
   */
  canAttributeReferenceVariable(componentType, attributeName) {
    const attrSchema = this.getAttributeSchema(componentType, attributeName);
    if (!attrSchema) return false;
    return attrSchema.canReference?.includes(AttributeType.VARIABLE_REF) || false;
  }
};

/**
 * Initialize chord values from chords.js
 * Call this after chords.js is loaded
 */
function initializeChordValues() {
  if (typeof CHORD_DEFINITIONS === 'undefined') {
    console.error('Cannot initialize chord values: CHORD_DEFINITIONS not loaded');
    return;
  }

  const chordNames = ['none', ...CHORD_DEFINITIONS.map(c => c.name)];
  TRIGGER_SCHEMAS.master.attributes.chord.values = chordNames;

  console.log('Chord values initialized:', chordNames.length, 'chords');
}
