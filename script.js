/*
 * ============================================================================
 * DESIGN PRINCIPLES - INSTRUCTIONS FOR CLAUDE
 * ============================================================================
 *
 * These principles define how this application works. Read them carefully
 * when resuming a session to understand the system architecture.
 *
 * PRINCIPLE 1: THE DOCUMENT IS THE SOURCE OF TRUTH
 * ------------------------------------------------
 * The document is the ONLY source of truth. The instrument panel and the
 * instrument itself are ALWAYS generated dynamically from the document.
 *
 * - Nothing in the UI panel is hardcoded
 * - The instrument panel can change values in the document (as a UI convenience)
 * - The instrument panel CANNOT change document structure
 * - If a parameter is deleted from the document, it disappears from the UI
 *
 * Flow:
 * 1. User edits text freely like a document, without interference
 * 2. At the end of each keystroke, the current line is evaluated for syntax
 * 3. If it matches a known pattern, it is formatted with syntax highlighting
 * 4. The entire document is parsed for structure
 * 5. The instrument panel is regenerated to match the document structure
 * 6. The audio engine configuration is updated from the parsed document
 *
 * PRINCIPLE 2: DEFAULTS ARE FALLBACKS, NOT TRUTH
 * ----------------------------------------------
 * When parameters are not specified in the document, hardcoded defaults are used
 * so the instrument works even when the document is silent.
 *
 * Defaults should be:
 * - Clearly marked in the instrument panel (visually distinct)
 * - Immediately overridden when the document specifies a value
 * - Used by the audio engine only when no document value exists
 *
 * Oscillator defaults:
 * - wave: 'sine', octave: 0, volume: 50 (0.5 for audio)
 * - attack time: 100, sustain level: 50 (0.5 for audio), release time: 500
 *
 * Global defaults:
 * - master volume: 80 (0.8 for audio)
 * - compressor: threshold -20, ratio 12, knee 30, attack 0.003, release 0.25
 *
 * ============================================================================
 */

// Oscillator configuration - dynamically updated from text box
let oscillatorConfigs = [
  { wave: 'sine', octave: 0, volume: 0.5, attack: 100, sustain: 0.5, release: 500 },
  { wave: 'sine', octave: 1, volume: 0.3, attack: 100, sustain: 0.5, release: 500 },
  { wave: 'sine', octave: -1, volume: 0.2, attack: 100, sustain: 0.5, release: 500 }
];

// Store oscillator names in order (used when updating text from sliders)
// Pick 3 random names for default oscillators
let oscillatorNames = [];
function initializeDefaultOscillatorNames() {
  const shuffled = [...variable_names].sort(() => Math.random() - 0.5);
  oscillatorNames = shuffled.slice(0, 3);
}
// Initialize will be called after variable_names is loaded

// Variables - user-defined named values
// Format: { name: { value, min, max } }
let variables = {};

// LFO configurations - dynamically updated from text box
// Format: { name: { rate, depth, wave } }
let lfoConfigs = {};

// Note-specific configurations - dynamically updated from text box
// Format: { noteName: { pitch: lfoName } }
let noteConfigs = {};

// Key-specific configurations - dynamically updated from text box
// Format: { key: { pitch: lfoName } }
let keyConfigs = {};

// Global configuration - dynamically updated from text box
let globalConfig = {
  masterVolume: { value: 0.8, isDefault: true },
  masterEnvelope: {
    attack: { value: 100, isDefault: true },
    sustain: { value: 1.0, isDefault: true },
    release: { value: 500, isDefault: true }
  },
  compressor: {
    threshold: { value: -20, isDefault: true },
    ratio: { value: 12, isDefault: true },
    knee: { value: 30, isDefault: true },
    attack: { value: 0.003, isDefault: true },
    release: { value: 0.25, isDefault: true }
  },
  chord: { value: 'none', isDefault: true }
};

// Chord interval definitions (built from CHORD_DEFINITIONS in chords.js)
let CHORD_INTERVALS = {};

// Build CHORD_INTERVALS from CHORD_DEFINITIONS
function buildChordIntervals() {
  CHORD_INTERVALS = { 'none': [] };

  CHORD_DEFINITIONS.forEach(chord => {
    // Extract intervals (excluding root note at 0)
    const intervals = chord.semitones.filter(st => st !== 0);
    CHORD_INTERVALS[chord.name] = intervals;
  });

  console.log('Built CHORD_INTERVALS:', Object.keys(CHORD_INTERVALS));
}

// Flag to prevent slider updates from triggering text regeneration
let isUpdatingFromText = false;

// Registry of known parameter keys
const PARAMETER_KEYS = [
  'wave',
  'octave',
  'volume',
  'pitch',
  'attack time',
  'sustain level',
  'release time',
  'master volume',
  'compressor threshold',
  'compressor ratio',
  'compressor knee',
  'compressor attack',
  'compressor release',
  'variable',
  'chord',
  'rate',
  'depth'
];

// Helper function to resolve a value (either numeric or variable reference)
function resolveValue(value) {
  // Check if it's a variable reference
  if (variables.hasOwnProperty(value)) {
    return variables[value];
  }
  // Otherwise parse as number
  return parseFloat(value);
}

// Helper function to get the raw parameter value from document (before variable resolution)
function getRawParameterValue(oscIndex, parameterName) {
  const blocks = Array.from(parametersTextbox.querySelectorAll('.block'));
  let currentOscIndex = -1;

  for (const block of blocks) {
    const content = block.querySelector('.block-content');
    if (!content) continue;

    const text = content.textContent;
    const oscMatch = text.match(/^oscillator\s+(.+)$/i);
    if (oscMatch) {
      currentOscIndex++;
    } else if (text.startsWith('  ') && currentOscIndex === oscIndex) {
      const trimmed = text.trim();
      if (trimmed.startsWith(parameterName + ' ')) {
        return trimmed.substring(parameterName.length + 1);
      }
    }
  }
  return null;
}

// Create a dynamic oscillator section with controls
function createOscillatorSection(name, index, config) {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.dataset.oscillatorIndex = index;

  const header = document.createElement('h2');
  header.textContent = `oscillator ${name}`;
  section.appendChild(header);

  // Wave selector
  const waveContainer = document.createElement('div');
  waveContainer.className = 'slider-container';
  const waveLabel = document.createElement('label');
  waveLabel.textContent = 'wave';
  const waveSelect = document.createElement('select');
  ['sine', 'square', 'sawtooth', 'triangle'].forEach(waveType => {
    const option = document.createElement('option');
    option.value = waveType;
    option.textContent = waveType;
    if (config.wave === waveType) option.selected = true;
    waveSelect.appendChild(option);
  });
  waveSelect.addEventListener('change', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('wave', waveSelect.value, index);
    }
  });
  waveContainer.appendChild(waveLabel);
  waveContainer.appendChild(waveSelect);
  section.appendChild(waveContainer);

  // Octave slider
  const octaveContainer = document.createElement('div');
  octaveContainer.className = 'slider-container';
  const octaveLabel = document.createElement('label');
  octaveLabel.textContent = 'octave';
  const octaveSlider = document.createElement('input');
  octaveSlider.type = 'range';
  octaveSlider.min = '-2';
  octaveSlider.max = '2';
  octaveSlider.step = '1';
  octaveSlider.value = config.octave;
  octaveSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('octave', octaveSlider.value, index);
    }
  });
  octaveContainer.appendChild(octaveLabel);
  octaveContainer.appendChild(octaveSlider);
  section.appendChild(octaveContainer);

  // Volume slider
  const volumeContainer = document.createElement('div');
  volumeContainer.className = 'slider-container';
  const volumeLabel = document.createElement('label');
  volumeLabel.textContent = 'volume';
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.step = '1';
  volumeSlider.value = config.volume * 100;
  // Check if this parameter uses a variable
  const volumeRaw = getRawParameterValue(index, 'volume');
  const volumeUsesVariable = volumeRaw && variables.hasOwnProperty(volumeRaw);
  if (volumeUsesVariable) {
    volumeSlider.disabled = true;
    volumeSlider.style.opacity = '0.5';
    volumeLabel.textContent = `volume (${volumeRaw})`;
  }
  volumeSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('volume', volumeSlider.value, index);
    }
  });
  volumeContainer.appendChild(volumeLabel);
  volumeContainer.appendChild(volumeSlider);
  section.appendChild(volumeContainer);

  // Attack slider
  const attackContainer = document.createElement('div');
  attackContainer.className = 'slider-container';
  const attackLabel = document.createElement('label');
  attackLabel.textContent = 'attack time';
  const attackSlider = document.createElement('input');
  attackSlider.type = 'range';
  attackSlider.min = '0';
  attackSlider.max = '2000';
  attackSlider.step = '100';
  attackSlider.value = config.attack;
  const attackRaw = getRawParameterValue(index, 'attack time');
  const attackUsesVariable = attackRaw && variables.hasOwnProperty(attackRaw);
  if (attackUsesVariable) {
    attackSlider.disabled = true;
    attackSlider.style.opacity = '0.5';
    attackLabel.textContent = `attack time (${attackRaw})`;
  }
  attackSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('attack time', attackSlider.value, index);
    }
  });
  attackContainer.appendChild(attackLabel);
  attackContainer.appendChild(attackSlider);
  section.appendChild(attackContainer);

  // Sustain slider
  const sustainContainer = document.createElement('div');
  sustainContainer.className = 'slider-container';
  const sustainLabel = document.createElement('label');
  sustainLabel.textContent = 'sustain level';
  const sustainSlider = document.createElement('input');
  sustainSlider.type = 'range';
  sustainSlider.min = '0';
  sustainSlider.max = '100';
  sustainSlider.step = '1';
  sustainSlider.value = config.sustain * 100;
  const sustainRaw = getRawParameterValue(index, 'sustain level');
  const sustainUsesVariable = sustainRaw && variables.hasOwnProperty(sustainRaw);
  if (sustainUsesVariable) {
    sustainSlider.disabled = true;
    sustainSlider.style.opacity = '0.5';
    sustainLabel.textContent = `sustain level (${sustainRaw})`;
  }
  sustainSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('sustain level', sustainSlider.value, index);
    }
  });
  sustainContainer.appendChild(sustainLabel);
  sustainContainer.appendChild(sustainSlider);
  section.appendChild(sustainContainer);

  // Release slider
  const releaseContainer = document.createElement('div');
  releaseContainer.className = 'slider-container';
  const releaseLabel = document.createElement('label');
  releaseLabel.textContent = 'release time';
  const releaseSlider = document.createElement('input');
  releaseSlider.type = 'range';
  releaseSlider.min = '0';
  releaseSlider.max = '2000';
  releaseSlider.step = '100';
  releaseSlider.value = config.release;
  const releaseRaw = getRawParameterValue(index, 'release time');
  const releaseUsesVariable = releaseRaw && variables.hasOwnProperty(releaseRaw);
  if (releaseUsesVariable) {
    releaseSlider.disabled = true;
    releaseSlider.style.opacity = '0.5';
    releaseLabel.textContent = `release time (${releaseRaw})`;
  }
  releaseSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('release time', releaseSlider.value, index);
    }
  });
  releaseContainer.appendChild(releaseLabel);
  releaseContainer.appendChild(releaseSlider);
  section.appendChild(releaseContainer);

  return section;
}

// Create a master volume section with controls
function createMasterVolumeSection() {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.id = 'master-volume-section';

  const header = document.createElement('h2');
  header.textContent = 'master volume';
  if (globalConfig.masterVolume.isDefault) {
    header.classList.add('default-param');
    header.title = 'Using default value (not in document)';
  }
  section.appendChild(header);

  const container = document.createElement('div');
  container.className = 'slider-container';
  const label = document.createElement('label');
  label.textContent = 'master volume';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = globalConfig.masterVolume.value * 100;
  slider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('master volume', slider.value);
    }
    masterGain.gain.value = parseFloat(slider.value) / 100;
  });
  container.appendChild(label);
  container.appendChild(slider);
  section.appendChild(container);

  return section;
}

// Create a master envelope section with controls
function createMasterEnvelopeSection() {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.id = 'master-envelope-section';

  const header = document.createElement('h2');
  header.textContent = 'master envelope';
  // Mark as default if ALL master envelope params are default
  const allDefault = globalConfig.masterEnvelope.attack.isDefault &&
                      globalConfig.masterEnvelope.sustain.isDefault &&
                      globalConfig.masterEnvelope.release.isDefault;
  if (allDefault) {
    header.classList.add('default-param');
    header.title = 'Using default values (not in document)';
  }
  section.appendChild(header);

  // Attack
  const attackContainer = document.createElement('div');
  attackContainer.className = 'slider-container';
  const attackLabel = document.createElement('label');
  attackLabel.textContent = 'attack time (ms)';
  const attackSlider = document.createElement('input');
  attackSlider.type = 'range';
  attackSlider.min = '0';
  attackSlider.max = '2000';
  attackSlider.step = '10';
  attackSlider.value = globalConfig.masterEnvelope.attack.value;
  attackSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('envelope attack time', attackSlider.value);
    }
  });
  attackContainer.appendChild(attackLabel);
  attackContainer.appendChild(attackSlider);
  section.appendChild(attackContainer);

  // Sustain
  const sustainContainer = document.createElement('div');
  sustainContainer.className = 'slider-container';
  const sustainLabel = document.createElement('label');
  sustainLabel.textContent = 'sustain level';
  const sustainSlider = document.createElement('input');
  sustainSlider.type = 'range';
  sustainSlider.min = '0';
  sustainSlider.max = '100';
  sustainSlider.step = '1';
  sustainSlider.value = globalConfig.masterEnvelope.sustain.value * 100;
  sustainSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('envelope sustain level', sustainSlider.value);
    }
  });
  sustainContainer.appendChild(sustainLabel);
  sustainContainer.appendChild(sustainSlider);
  section.appendChild(sustainContainer);

  // Release
  const releaseContainer = document.createElement('div');
  releaseContainer.className = 'slider-container';
  const releaseLabel = document.createElement('label');
  releaseLabel.textContent = 'release time (ms)';
  const releaseSlider = document.createElement('input');
  releaseSlider.type = 'range';
  releaseSlider.min = '0';
  releaseSlider.max = '2000';
  releaseSlider.step = '10';
  releaseSlider.value = globalConfig.masterEnvelope.release.value;
  releaseSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('envelope release time', releaseSlider.value);
    }
  });
  releaseContainer.appendChild(releaseLabel);
  releaseContainer.appendChild(releaseSlider);
  section.appendChild(releaseContainer);

  return section;
}

// Create a variables section with controls
function createVariablesSection() {
  if (Object.keys(variables).length === 0) return null;

  const section = document.createElement('div');
  section.className = 'controls-section';
  section.id = 'variables-section';

  const header = document.createElement('h2');
  header.textContent = 'variables';
  section.appendChild(header);

  // Create a slider for each variable
  Object.entries(variables).forEach(([name, value]) => {
    const container = document.createElement('div');
    container.className = 'slider-container';
    const label = document.createElement('label');
    label.textContent = name;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = value;
    slider.addEventListener('input', () => {
      if (!isUpdatingFromText) {
        // Update the variable value in the document
        updateParameterInBlocks('variable', `${name} ${slider.value}`);
        // Update the variable in memory
        variables[name] = parseFloat(slider.value);
        // Stop active notes so they restart with new variable values
        polyphonyManager.stopAllNotes();
      }
    });
    container.appendChild(label);
    container.appendChild(slider);
    section.appendChild(container);
  });

  return section;
}

// Create a compressor section with controls
function createCompressorSection() {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.id = 'compressor-section';

  const header = document.createElement('h2');
  header.textContent = 'compressor';
  // Mark as default if ALL compressor params are default
  const allDefault = globalConfig.compressor.threshold.isDefault &&
                      globalConfig.compressor.ratio.isDefault &&
                      globalConfig.compressor.knee.isDefault &&
                      globalConfig.compressor.attack.isDefault &&
                      globalConfig.compressor.release.isDefault;
  if (allDefault) {
    header.classList.add('default-param');
    header.title = 'Using default values (not in document)';
  }
  section.appendChild(header);

  // Threshold
  const thresholdContainer = document.createElement('div');
  thresholdContainer.className = 'slider-container';
  const thresholdLabel = document.createElement('label');
  thresholdLabel.textContent = 'threshold';
  const thresholdSlider = document.createElement('input');
  thresholdSlider.type = 'range';
  thresholdSlider.min = '-100';
  thresholdSlider.max = '0';
  thresholdSlider.step = '1';
  thresholdSlider.value = globalConfig.compressor.threshold.value;
  thresholdSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('compressor threshold', thresholdSlider.value);
    }
    compressor.threshold.value = parseFloat(thresholdSlider.value);
  });
  thresholdContainer.appendChild(thresholdLabel);
  thresholdContainer.appendChild(thresholdSlider);
  section.appendChild(thresholdContainer);

  // Ratio
  const ratioContainer = document.createElement('div');
  ratioContainer.className = 'slider-container';
  const ratioLabel = document.createElement('label');
  ratioLabel.textContent = 'ratio';
  const ratioSlider = document.createElement('input');
  ratioSlider.type = 'range';
  ratioSlider.min = '1';
  ratioSlider.max = '20';
  ratioSlider.step = '0.1';
  ratioSlider.value = globalConfig.compressor.ratio.value;
  ratioSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('compressor ratio', ratioSlider.value);
    }
    compressor.ratio.value = parseFloat(ratioSlider.value);
  });
  ratioContainer.appendChild(ratioLabel);
  ratioContainer.appendChild(ratioSlider);
  section.appendChild(ratioContainer);

  // Knee
  const kneeContainer = document.createElement('div');
  kneeContainer.className = 'slider-container';
  const kneeLabel = document.createElement('label');
  kneeLabel.textContent = 'knee';
  const kneeSlider = document.createElement('input');
  kneeSlider.type = 'range';
  kneeSlider.min = '0';
  kneeSlider.max = '40';
  kneeSlider.step = '1';
  kneeSlider.value = globalConfig.compressor.knee.value;
  kneeSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('compressor knee', kneeSlider.value);
    }
    compressor.knee.value = parseFloat(kneeSlider.value);
  });
  kneeContainer.appendChild(kneeLabel);
  kneeContainer.appendChild(kneeSlider);
  section.appendChild(kneeContainer);

  // Attack
  const attackContainer = document.createElement('div');
  attackContainer.className = 'slider-container';
  const attackLabel = document.createElement('label');
  attackLabel.textContent = 'attack';
  const attackSlider = document.createElement('input');
  attackSlider.type = 'range';
  attackSlider.min = '0';
  attackSlider.max = '1';
  attackSlider.step = '0.001';
  attackSlider.value = globalConfig.compressor.attack.value;
  attackSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('compressor attack', attackSlider.value);
    }
    compressor.attack.value = parseFloat(attackSlider.value);
  });
  attackContainer.appendChild(attackLabel);
  attackContainer.appendChild(attackSlider);
  section.appendChild(attackContainer);

  // Release
  const releaseContainer = document.createElement('div');
  releaseContainer.className = 'slider-container';
  const releaseLabel = document.createElement('label');
  releaseLabel.textContent = 'release';
  const releaseSlider = document.createElement('input');
  releaseSlider.type = 'range';
  releaseSlider.min = '0';
  releaseSlider.max = '3';
  releaseSlider.step = '0.01';
  releaseSlider.value = globalConfig.compressor.release.value;
  releaseSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateParameterInBlocks('compressor release', releaseSlider.value);
    }
    compressor.release.value = parseFloat(releaseSlider.value);
  });
  releaseContainer.appendChild(releaseLabel);
  releaseContainer.appendChild(releaseSlider);
  section.appendChild(releaseContainer);

  return section;
}

// Create a chord section with controls
function createChordSection() {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.id = 'chord-section';

  const header = document.createElement('h2');
  header.textContent = 'chord';
  if (globalConfig.chord.isDefault) {
    header.classList.add('default-param');
    header.title = 'Using default value (not in document)';
  }
  section.appendChild(header);

  // Dropdown for chord type
  const container = document.createElement('div');
  container.className = 'slider-container';

  const label = document.createElement('label');
  label.textContent = 'type';
  container.appendChild(label);

  const select = document.createElement('select');

  // Check if current chord is a custom numeric definition
  const isCustomChord = /^[\d\s\-]+$/.test(globalConfig.chord.value);

  // Dynamically populate from loaded chord definitions
  const options = Object.keys(CHORD_INTERVALS);
  options.forEach(optValue => {
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optValue;
    if (optValue === globalConfig.chord.value) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  // Add "custom" option only if current chord is custom
  if (isCustomChord) {
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'custom';
    customOption.selected = true;
    select.appendChild(customOption);
  }

  // Event listener to update text and config
  select.addEventListener('change', (e) => {
    if (!isUpdatingFromText) {
      // Don't update document if "custom" is selected - user must type numeric values directly
      if (e.target.value !== 'custom') {
        updateParameterInBlocks('chord', e.target.value);
        // Update config directly (following the pattern of other global parameters)
        globalConfig.chord.value = e.target.value;
        globalConfig.chord.isDefault = false;
      }
    }
  });

  container.appendChild(select);
  section.appendChild(container);

  return section;
}

// Create LFO section
function createLFOSection(name, config) {
  const section = document.createElement('div');
  section.className = 'controls-section';
  section.dataset.lfoName = name;

  const header = document.createElement('h2');
  header.textContent = `lfo ${name}`;
  section.appendChild(header);

  // Rate slider (0-20 Hz)
  const rateContainer = document.createElement('div');
  rateContainer.className = 'slider-container';
  const rateLabel = document.createElement('label');
  rateLabel.textContent = 'rate';
  const rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.min = '0';
  rateSlider.max = '20';
  rateSlider.step = '0.1';
  rateSlider.value = config.rate;
  rateSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateLFOParameterInBlocks(name, 'rate', rateSlider.value);
    }
  });
  rateContainer.appendChild(rateLabel);
  rateContainer.appendChild(rateSlider);
  section.appendChild(rateContainer);

  // Depth slider (0-50 cents)
  const depthContainer = document.createElement('div');
  depthContainer.className = 'slider-container';
  const depthLabel = document.createElement('label');
  depthLabel.textContent = 'depth';
  const depthSlider = document.createElement('input');
  depthSlider.type = 'range';
  depthSlider.min = '0';
  depthSlider.max = '50';
  depthSlider.step = '1';
  depthSlider.value = config.depth;
  depthSlider.addEventListener('input', () => {
    if (!isUpdatingFromText) {
      updateLFOParameterInBlocks(name, 'depth', depthSlider.value);
    }
  });
  depthContainer.appendChild(depthLabel);
  depthContainer.appendChild(depthSlider);
  section.appendChild(depthContainer);

  // Wave selector
  const waveContainer = document.createElement('div');
  waveContainer.className = 'slider-container';
  const waveLabel = document.createElement('label');
  waveLabel.textContent = 'wave';
  const waveSelect = document.createElement('select');
  ['sine', 'triangle', 'square', 'sawtooth'].forEach(waveType => {
    const option = document.createElement('option');
    option.value = waveType;
    option.textContent = waveType;
    if (config.wave === waveType) option.selected = true;
    waveSelect.appendChild(option);
  });
  waveSelect.addEventListener('change', () => {
    if (!isUpdatingFromText) {
      updateLFOParameterInBlocks(name, 'wave', waveSelect.value);
    }
  });
  waveContainer.appendChild(waveLabel);
  waveContainer.appendChild(waveSelect);
  section.appendChild(waveContainer);

  return section;
}

// Update LFO parameter in text blocks
function updateLFOParameterInBlocks(lfoName, parameterName, value) {
  const blocks = Array.from(parametersTextbox.querySelectorAll('.block'));
  let inLFO = false;
  let lfoBlock = null;

  for (const block of blocks) {
    const content = block.querySelector('.block-content');
    if (!content) continue;

    const text = content.textContent;

    // Check if this is the LFO header we're looking for
    const lfoMatch = text.match(/^lfo\s+(.+)$/i);
    if (lfoMatch && lfoMatch[1].trim() === lfoName) {
      inLFO = true;
      lfoBlock = block;
      continue;
    }

    // If we hit another non-indented line, we've left the LFO block
    if (!text.startsWith('  ')) {
      inLFO = false;
    }

    // If we're in the right LFO block and this is the parameter line
    if (inLFO && text.trim().startsWith(parameterName + ' ')) {
      content.textContent = `  ${parameterName} ${value}`;
      formatBlock(block);
      scrollToAndPulse(block, true);
      syncUIFromText();
      return;
    }
  }

  // If we didn't find the parameter, add it after the LFO header
  if (lfoBlock) {
    const newBlock = createBlock(`  ${parameterName} ${value}`);
    lfoBlock.insertAdjacentElement('afterend', newBlock);
    formatBlock(newBlock);
    scrollToAndPulse(newBlock, true);
    syncUIFromText();
  }
}

// Parse text box and update UI visibility and oscillator configs
function syncUIFromText() {
  const text = getAllBlocksText();
  const lines = text.split('\n');

  // Track oscillators by name in order of appearance
  const oscillatorsByName = new Map();
  let currentOscillatorName = null;

  // Track LFOs by name in order of appearance
  const lfosByName = new Map();
  let currentLFOName = null;

  // Track notes by name
  const notesByName = new Map();
  let currentNoteName = null;

  // Track keys by key character
  const keysByChar = new Map();
  let currentKeyChar = null;

  // Reset variables
  variables = {};

  // Reset LFO configs
  lfoConfigs = {};

  // Reset note configs
  noteConfigs = {};

  // Reset key configs
  keyConfigs = {};

  // Reset global config to defaults
  globalConfig = {
    masterVolume: { value: 0.8, isDefault: true },
    masterEnvelope: {
      attack: { value: 100, isDefault: true },
      sustain: { value: 1.0, isDefault: true },
      release: { value: 500, isDefault: true }
    },
    compressor: {
      threshold: { value: -20, isDefault: true },
      ratio: { value: 12, isDefault: true },
      knee: { value: 30, isDefault: true },
      attack: { value: 0.003, isDefault: true },
      release: { value: 0.25, isDefault: true }
    },
    chord: { value: 'none', isDefault: true }
  };

  lines.forEach(line => {
    // Check if this is an oscillator heading (not indented, starts with "oscillator ")
    const oscMatch = line.match(/^oscillator\s+(.+)$/i);
    if (oscMatch) {
      currentOscillatorName = oscMatch[1].trim();
      currentLFOName = null;
      if (!oscillatorsByName.has(currentOscillatorName)) {
        oscillatorsByName.set(currentOscillatorName, {
          wave: null,
          octave: null,
          volume: null,
          pitch: null,
          attack: null,
          sustain: null,
          release: null
        });
      }
      return;
    }

    // Check if this is an LFO heading (not indented, starts with "lfo ")
    const lfoMatch = line.match(/^lfo\s+(.+)$/i);
    if (lfoMatch) {
      currentLFOName = lfoMatch[1].trim();
      currentOscillatorName = null;
      currentNoteName = null;
      if (!lfosByName.has(currentLFOName)) {
        lfosByName.set(currentLFOName, {
          rate: null,
          depth: null,
          wave: null
        });
      }
      return;
    }

    // Check if this is a note heading (not indented, starts with "note ")
    const noteMatch = line.match(/^note\s+(.+)$/i);
    if (noteMatch) {
      // Parse multiple note names separated by spaces
      const noteNames = noteMatch[1].trim().toLowerCase().split(/\s+/);
      currentNoteName = noteNames; // Store as array for multi-note support
      currentOscillatorName = null;
      currentLFOName = null;

      // Create an entry for each note name
      noteNames.forEach(noteName => {
        if (!notesByName.has(noteName)) {
          notesByName.set(noteName, {
            pitch: null,
            chord: null
          });
        }
      });
      return;
    }

    // Check if this is a key heading (not indented, starts with "key ")
    const keyMatch = line.match(/^key\s+(.+)$/i);
    if (keyMatch) {
      const keyChar = keyMatch[1].trim().toLowerCase();
      currentKeyChar = keyChar;
      currentOscillatorName = null;
      currentLFOName = null;
      currentNoteName = null;

      if (!keysByChar.has(keyChar)) {
        keysByChar.set(keyChar, {
          pitch: null
        });
      }
      return;
    }

    // Handle indented lines
    if (line.startsWith('  ')) {
      const trimmedLine = line.trim();

      // Try to match against known parameter keys
      let matchedKey = null;
      let value = null;
      for (const key of PARAMETER_KEYS) {
        if (trimmedLine.startsWith(key + ' ')) {
          matchedKey = key;
          value = trimmedLine.substring(key.length + 1);
          break;
        }
      }

      if (!matchedKey) return;

      // If we're in an oscillator block
      if (currentOscillatorName) {
        const osc = oscillatorsByName.get(currentOscillatorName);

        if (matchedKey === 'wave') osc.wave = value;
        if (matchedKey === 'octave') osc.octave = parseInt(resolveValue(value));
        if (matchedKey === 'volume') osc.volume = resolveValue(value) / 100;
        if (matchedKey === 'pitch') osc.pitch = value;
        if (matchedKey === 'attack time') osc.attack = resolveValue(value);
        if (matchedKey === 'sustain level') osc.sustain = resolveValue(value) / 100;
        if (matchedKey === 'release time') osc.release = resolveValue(value);
      }

      // If we're in an LFO block
      if (currentLFOName) {
        const lfo = lfosByName.get(currentLFOName);

        if (matchedKey === 'rate') lfo.rate = parseFloat(value);
        if (matchedKey === 'depth') lfo.depth = parseFloat(value);
        if (matchedKey === 'wave') lfo.wave = value;
      }

      // If we're in a note block (currentNoteName is an array of note names)
      if (currentNoteName) {
        currentNoteName.forEach(noteName => {
          const note = notesByName.get(noteName);
          if (note) {
            if (matchedKey === 'pitch') {
              note.pitch = value;
            }
            if (matchedKey === 'chord') {
              note.chord = value;
            }
          }
        });
      }

      // If we're in a key block
      if (currentKeyChar) {
        const key = keysByChar.get(currentKeyChar);
        if (key) {
          if (matchedKey === 'pitch') {
            key.pitch = value;
          }
        }
      }

      return;
    }

    // Non-indented line - could be global parameter
    if (!line.startsWith('  ')) {
      currentOscillatorName = null;
      currentLFOName = null;
      currentNoteName = null;
      currentKeyChar = null;

      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('variable ')) {
        // Parse variable definition: "variable name value"
        const parts = trimmedLine.substring('variable '.length).split(' ');
        if (parts.length >= 2) {
          const varName = parts[0];
          const varValue = parseFloat(parts[1]);
          if (!isNaN(varValue)) {
            variables[varName] = varValue;
          }
        }
      } else if (trimmedLine.startsWith('master volume ')) {
        globalConfig.masterVolume = {
          value: parseFloat(trimmedLine.substring('master volume '.length)) / 100,
          isDefault: false
        };
      } else if (trimmedLine.startsWith('envelope attack time ')) {
        globalConfig.masterEnvelope.attack = {
          value: parseFloat(trimmedLine.substring('envelope attack time '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('envelope sustain level ')) {
        globalConfig.masterEnvelope.sustain = {
          value: parseFloat(trimmedLine.substring('envelope sustain level '.length)) / 100,
          isDefault: false
        };
      } else if (trimmedLine.startsWith('envelope release time ')) {
        globalConfig.masterEnvelope.release = {
          value: parseFloat(trimmedLine.substring('envelope release time '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('compressor threshold ')) {
        globalConfig.compressor.threshold = {
          value: parseFloat(trimmedLine.substring('compressor threshold '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('compressor ratio ')) {
        globalConfig.compressor.ratio = {
          value: parseFloat(trimmedLine.substring('compressor ratio '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('compressor knee ')) {
        globalConfig.compressor.knee = {
          value: parseFloat(trimmedLine.substring('compressor knee '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('compressor attack ')) {
        globalConfig.compressor.attack = {
          value: parseFloat(trimmedLine.substring('compressor attack '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('compressor release ')) {
        globalConfig.compressor.release = {
          value: parseFloat(trimmedLine.substring('compressor release '.length)),
          isDefault: false
        };
      } else if (trimmedLine.startsWith('chord ')) {
        const chordType = trimmedLine.substring('chord '.length).trim();
        globalConfig.chord = {
          value: chordType,
          isDefault: false
        };
      }
    }
  });

  // Save old config to detect changes
  const oldConfigJSON = JSON.stringify(oscillatorConfigs);

  // Update oscillatorConfigs array to include ALL fully defined oscillators
  oscillatorConfigs = [];

  // Convert map to array of [name, config] pairs
  const oscillatorArray = Array.from(oscillatorsByName.entries());

  // Update global oscillator names array
  oscillatorNames = oscillatorArray.map(([name]) => name);

  // Add all oscillators to configs with defaults for missing parameters
  oscillatorArray.forEach(([name, osc]) => {
    // Use defaults for any missing parameters (volume and sustain stored as 0-1 for audio)
    const config = {
      wave: osc.wave !== null ? osc.wave : 'sine',
      octave: osc.octave !== null ? osc.octave : 0,
      volume: osc.volume !== null ? osc.volume : 0.5,
      pitch: osc.pitch !== null ? osc.pitch : null,
      attack: osc.attack !== null ? osc.attack : 100,
      sustain: osc.sustain !== null ? osc.sustain : 0.5,
      release: osc.release !== null ? osc.release : 500
    };
    oscillatorConfigs.push(config);
  });

  // Populate lfoConfigs from parsed LFOs
  lfosByName.forEach((lfo, name) => {
    lfoConfigs[name] = {
      rate: lfo.rate !== null ? lfo.rate : 5,
      depth: lfo.depth !== null ? lfo.depth : 10,
      wave: lfo.wave !== null ? lfo.wave : 'sine'
    };
  });

  // Populate noteConfigs from parsed notes
  notesByName.forEach((note, name) => {
    noteConfigs[name] = {
      pitch: note.pitch,
      chord: note.chord
    };
  });

  // Populate keyConfigs from parsed keys
  keysByChar.forEach((key, keyChar) => {
    keyConfigs[keyChar] = {
      pitch: key.pitch
    };
  });

  // Update visual keyboard to highlight keys with definitions
  updateKeyboardHighlights();

  // Dynamically generate UI sections for ALL oscillators AND global parameters
  const oscillatorsContainer = document.getElementById('oscillators-container');
  if (oscillatorsContainer) {
    // Clear ALL existing sections
    oscillatorsContainer.innerHTML = '';

    // Create a section for each oscillator (with defaults applied)
    oscillatorConfigs.forEach((config, index) => {
      const name = oscillatorNames[index];
      const section = createOscillatorSection(name, index, config);
      oscillatorsContainer.appendChild(section);
    });

    // Create a section for each LFO
    Object.entries(lfoConfigs).forEach(([name, config]) => {
      const section = createLFOSection(name, config);
      oscillatorsContainer.appendChild(section);
    });

    // Create master volume section
    const masterVolumeSection = createMasterVolumeSection();
    oscillatorsContainer.appendChild(masterVolumeSection);

    // Create master envelope section
    const masterEnvelopeSection = createMasterEnvelopeSection();
    oscillatorsContainer.appendChild(masterEnvelopeSection);

    // Create compressor section
    const compressorSection = createCompressorSection();
    oscillatorsContainer.appendChild(compressorSection);

    // Create chord section
    const chordSection = createChordSection();
    oscillatorsContainer.appendChild(chordSection);

    // Create variables section (if there are any variables)
    const variablesSection = createVariablesSection();
    if (variablesSection) {
      oscillatorsContainer.appendChild(variablesSection);
    }

    // Virtual keyboard is now defined in HTML, no need to create it dynamically
  }

  // Apply global config to audio engine
  masterGain.gain.value = globalConfig.masterVolume.value;
  compressor.threshold.value = globalConfig.compressor.threshold.value;
  compressor.ratio.value = globalConfig.compressor.ratio.value;
  compressor.knee.value = globalConfig.compressor.knee.value;
  compressor.attack.value = globalConfig.compressor.attack.value;
  compressor.release.value = globalConfig.compressor.release.value;

  // If oscillator configuration changed, stop all active notes so they restart with new config
  const newConfigJSON = JSON.stringify(oscillatorConfigs);
  if (oldConfigJSON !== newConfigJSON) {
    polyphonyManager.stopAllNotes();
  }
}

// Polyphony Manager to track active notes
class PolyphonyManager {
  constructor() {
    this.activeNotes = new Map();
  }

  startNote(frequency, noteId, velocity = 127, isSynthetic = false, midiNote = null, keyChar = null) {
    if (this.activeNotes.has(noteId)) {
      this.stopNote(noteId);
    }
    const note = new Note(frequency, noteId, this, isSynthetic, midiNote, keyChar);
    this.activeNotes.set(noteId, note);
    note.start(velocity);
    updateNoteDisplay();
  }

  stopNote(noteId) {
    const note = this.activeNotes.get(noteId);
    if (note) {
      note.stop();
      this.activeNotes.delete(noteId);
      updateNoteDisplay();
    }
  }

  stopAllNotes() {
    this.activeNotes.forEach((note) => note.stop());
    this.activeNotes.clear();
    updateNoteDisplay();
  }
}

// Encapsulated Note class with multiple oscillators, each with independent envelope
class Note {
  constructor(frequency, noteId, manager, isSynthetic = false, midiNote = null, keyChar = null) {
    this.frequency = frequency;
    this.noteId = noteId;
    this.manager = manager;
    this.isSynthetic = isSynthetic;
    this.midiNote = midiNote;
    this.keyChar = keyChar;

    // Convert MIDI note to note name for note-specific config lookup
    let noteSpecificConfig = null;
    if (midiNote !== null) {
      const noteName = midiNoteToNoteName(midiNote); // e.g., "c4"

      // First check for exact match
      noteSpecificConfig = noteConfigs[noteName];

      // If not found, check for wildcard match (note name without octave)
      if (!noteSpecificConfig) {
        const noteNameWithoutOctave = noteName.replace(/\d+$/, ''); // e.g., "c4" -> "c"
        noteSpecificConfig = noteConfigs[noteNameWithoutOctave];
      }
    }

    // Get key-specific config from any active defined keys being held
    // If multiple defined keys are held, use the first one's config
    let keySpecificConfig = null;
    if (activeDefinedKeys.size > 0) {
      const firstDefinedKey = activeDefinedKeys.values().next().value;
      keySpecificConfig = keyConfigs[firstDefinedKey];
    }

    // Create master envelope gain node (applies to all oscillators)
    this.masterEnvelopeGain = audioContext.createGain();
    this.masterEnvelopeGain.gain.setValueAtTime(0, audioContext.currentTime);
    this.masterEnvelopeGain.connect(masterGain);

    // Create multiple oscillators based on configuration
    // Each oscillator gets its own envelope gain node
    this.oscillators = [];
    this.oscillatorEnvelopes = []; // Each oscillator's envelope gain node
    this.configs = []; // Store config for each oscillator for stop()
    this.lfos = []; // Store LFO oscillators for cleanup
    this.keyLfos = []; // Store dynamically added LFOs from key presses
    this.baseFrequencies = []; // Store base frequencies for dynamic LFO application

    oscillatorConfigs.forEach((config) => {
      if (config.volume > 0) { // Only create if volume > 0
        const osc = audioContext.createOscillator();
        const envelopeGain = audioContext.createGain();

        // Set waveform
        osc.type = config.wave;

        // Calculate frequency with octave offset
        const octaveMultiplier = Math.pow(2, config.octave);
        const baseFrequency = frequency * octaveMultiplier;
        osc.frequency.value = baseFrequency;

        // Store base frequency for dynamic LFO application
        this.baseFrequencies.push(baseFrequency);

        // Determine which pitch LFO to use (key-specific > note-specific > oscillator config)
        const pitchLFO = (keySpecificConfig && keySpecificConfig.pitch) ||
                        (noteSpecificConfig && noteSpecificConfig.pitch) ||
                        config.pitch;

        // Check if this oscillator has pitch modulation (LFO)
        if (pitchLFO && lfoConfigs[pitchLFO]) {
          const lfoConfig = lfoConfigs[pitchLFO];

          // Create LFO oscillator
          const lfo = audioContext.createOscillator();
          lfo.type = lfoConfig.wave;
          lfo.frequency.value = lfoConfig.rate;

          // Create gain node to scale LFO output (controls modulation depth)
          // Convert depth from cents to Hz: depth_hz ≈ frequency * (depth_cents / 1200)
          const depthGain = audioContext.createGain();
          const depthInHz = baseFrequency * (lfoConfig.depth / 1200);
          depthGain.gain.value = depthInHz;

          // Connect: LFO → depth gain → oscillator frequency
          lfo.connect(depthGain);
          depthGain.connect(osc.frequency);

          // Start LFO immediately
          lfo.start();

          // Store LFO for cleanup
          this.lfos.push({ lfo, depthGain });
        }

        // Set envelope gain to 0 initially (will be ramped in start())
        envelopeGain.gain.setValueAtTime(0, audioContext.currentTime);

        // Connect: oscillator → individual envelope → master envelope → master gain
        osc.connect(envelopeGain);
        envelopeGain.connect(this.masterEnvelopeGain);

        this.oscillators.push(osc);
        this.oscillatorEnvelopes.push(envelopeGain);
        this.configs.push(config);
      }
    });
  }

  start(velocity = 127) {
    const normalizedVelocity = velocity / 127;

    // Apply master envelope
    const masterAttackTime = globalConfig.masterEnvelope.attack.value / 1000;
    const masterSustainLevel = globalConfig.masterEnvelope.sustain.value;
    const masterMaxAmplitude = normalizedVelocity * masterSustainLevel;

    this.masterEnvelopeGain.gain.setValueAtTime(0, audioContext.currentTime);
    this.masterEnvelopeGain.gain.linearRampToValueAtTime(masterMaxAmplitude, audioContext.currentTime + masterAttackTime);

    // Start each oscillator with its own envelope
    this.oscillators.forEach((osc, index) => {
      const config = this.configs[index];
      const envelopeGain = this.oscillatorEnvelopes[index];

      const attackTime = config.attack / 1000;
      const sustainLevel = config.sustain;
      // Individual oscillator envelope (volume already factored in)
      const maxAmplitude = sustainLevel * config.volume;

      envelopeGain.gain.setValueAtTime(0, audioContext.currentTime);
      envelopeGain.gain.linearRampToValueAtTime(maxAmplitude, audioContext.currentTime + attackTime);

      osc.start();
    });
  }

  stop() {
    // Apply master envelope release
    const masterReleaseTime = globalConfig.masterEnvelope.release.value / 1000;

    this.masterEnvelopeGain.gain.cancelScheduledValues(audioContext.currentTime);
    this.masterEnvelopeGain.gain.setValueAtTime(this.masterEnvelopeGain.gain.value, audioContext.currentTime);
    this.masterEnvelopeGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + masterReleaseTime);

    // Find the longest individual oscillator release time
    let maxIndividualReleaseTime = 0;

    // Apply release envelope to each oscillator
    this.oscillatorEnvelopes.forEach((envelopeGain, index) => {
      const config = this.configs[index];
      const releaseTime = config.release / 1000;
      maxIndividualReleaseTime = Math.max(maxIndividualReleaseTime, releaseTime);

      envelopeGain.gain.cancelScheduledValues(audioContext.currentTime);
      envelopeGain.gain.setValueAtTime(envelopeGain.gain.value, audioContext.currentTime);
      envelopeGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + releaseTime);
    });

    // Wait for the longest release time (master or individual) before cleanup
    const totalReleaseTime = Math.max(masterReleaseTime, maxIndividualReleaseTime);

    setTimeout(() => {
      // Stop and disconnect all oscillators
      this.oscillators.forEach(osc => {
        if (osc) {
          osc.stop();
          osc.disconnect();
        }
      });

      // Stop and disconnect all LFOs
      this.lfos.forEach(({ lfo, depthGain }) => {
        if (lfo) {
          lfo.stop();
          lfo.disconnect();
        }
        if (depthGain) {
          depthGain.disconnect();
        }
      });

      // Stop and disconnect all key LFOs
      this.keyLfos.forEach(({ lfo, depthGain }) => {
        if (lfo) {
          lfo.stop();
          lfo.disconnect();
        }
        if (depthGain) {
          depthGain.disconnect();
        }
      });

      // Disconnect all envelope gains
      this.oscillatorEnvelopes.forEach(gain => {
        if (gain) {
          gain.disconnect();
        }
      });

      // Disconnect master envelope
      if (this.masterEnvelopeGain) {
        this.masterEnvelopeGain.disconnect();
      }
    }, totalReleaseTime * 1000);
  }

  // Add a key-specific LFO to all oscillators dynamically
  addKeyLFO(lfoName) {
    if (!lfoConfigs[lfoName]) return;

    // Clear any existing key LFOs first
    this.removeKeyLFO();

    const lfoConfig = lfoConfigs[lfoName];

    // Apply LFO to each oscillator
    this.oscillators.forEach((osc, index) => {
      const baseFrequency = this.baseFrequencies[index];

      // Create LFO oscillator
      const lfo = audioContext.createOscillator();
      lfo.type = lfoConfig.wave;
      lfo.frequency.value = lfoConfig.rate;

      // Create gain node to scale LFO output
      const depthGain = audioContext.createGain();
      const depthInHz = baseFrequency * (lfoConfig.depth / 1200);
      depthGain.gain.value = depthInHz;

      // Connect: LFO → depth gain → oscillator frequency
      lfo.connect(depthGain);
      depthGain.connect(osc.frequency);

      // Start LFO immediately
      lfo.start();

      // Store for cleanup
      this.keyLfos.push({ lfo, depthGain });
    });
  }

  // Remove all key-specific LFOs
  removeKeyLFO() {
    this.keyLfos.forEach(({ lfo, depthGain }) => {
      if (lfo) {
        lfo.stop();
        lfo.disconnect();
      }
      if (depthGain) {
        depthGain.disconnect();
      }
    });
    this.keyLfos = [];
  }
}

// Initialize Audio Context
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioContext.createGain();
masterGain.gain.value = 0.8;

// Add compressor to prevent clipping
const compressor = audioContext.createDynamicsCompressor();
compressor.threshold.value = -20;  // Start compressing at -20dB
compressor.knee.value = 30;        // Smooth compression curve
compressor.ratio.value = 12;       // Heavy compression ratio
compressor.attack.value = 0.003;   // Fast attack (3ms)
compressor.release.value = 0.25;   // Quick release (250ms)

// Connect: masterGain → compressor → destination
masterGain.connect(compressor);
compressor.connect(audioContext.destination);

// DOM Elements
const parametersTextbox = document.getElementById("parameters");

// Polyphony Manager
const polyphonyManager = new PolyphonyManager();

// ===== Chord Generation Functions =====

// Calculate all frequencies for a chord based on root frequency
function getChordFrequencies(rootFrequency, midiNote = null) {
  let chordType = globalConfig.chord.value;

  // Check for note-specific chord config (overrides global)
  if (midiNote !== null) {
    const noteName = midiNoteToNoteName(midiNote); // e.g., "c4"

    // First check for exact match
    let noteSpecificConfig = noteConfigs[noteName];

    // If not found, check for wildcard match (note name without octave)
    if (!noteSpecificConfig) {
      const noteNameWithoutOctave = noteName.replace(/\d+$/, ''); // e.g., "c4" -> "c"
      noteSpecificConfig = noteConfigs[noteNameWithoutOctave];
    }

    // If note-specific chord is defined, use it
    if (noteSpecificConfig && noteSpecificConfig.chord) {
      chordType = noteSpecificConfig.chord;
    }
  }

  let intervals = [];

  // Check if it's a custom numeric definition (e.g., "-2 0 1 4 7")
  if (/^[\d\s\-]+$/.test(chordType)) {
    // Parse custom chord: split by spaces and convert to numbers
    intervals = chordType.split(/\s+/).map(s => parseInt(s)).filter(n => !isNaN(n));
  } else {
    // Predefined chord from CHORD_INTERVALS
    intervals = CHORD_INTERVALS[chordType] || [];
    // For predefined chords, always include root (0)
    if (!intervals.includes(0)) {
      intervals = [0, ...intervals];
    }
  }

  // Convert intervals to frequencies
  const frequencies = intervals.map(semitones => {
    // frequency = rootFrequency * 2^(semitones/12)
    return rootFrequency * Math.pow(2, semitones / 12);
  });

  return frequencies;
}

// ===== Note Display Functions =====

// Convert frequency to note name (e.g., 440Hz -> A4)
function frequencyToNoteName(frequency) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midiNote = Math.round(12 * Math.log2(frequency / 440) + 69);
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}

// Convert MIDI note number to note name (e.g., 60 -> C4)
function midiNoteToNoteName(midiNote) {
  const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}

// Update the note display to show currently playing notes
function updateNoteDisplay() {
  const noteDisplayText = document.getElementById('note-display-text');

  if (polyphonyManager.activeNotes.size === 0) {
    noteDisplayText.textContent = '--';
    return;
  }

  // Display all currently active notes (for polyphony), sorted by frequency
  const notes = Array.from(polyphonyManager.activeNotes.values())
    .sort((a, b) => a.frequency - b.frequency); // Sort lowest to highest

  // Build HTML with different colors for root vs synthetic notes
  const noteHTML = notes.map(note => {
    const noteName = frequencyToNoteName(note.frequency);
    if (note.isSynthetic) {
      // Synthetic notes in muted gray color
      return `<span style="color: #969896;">${noteName}</span>`;
    } else {
      // Root notes in default cyan color
      return `<span style="color: #5fd3bc;">${noteName}</span>`;
    }
  }).join(' <span style="color: #969896;">+</span> ');

  noteDisplayText.innerHTML = noteHTML;
}

// ===== Block-Based Editor Functions =====

// Create a new block element
function createBlock(text = '') {
  const block = document.createElement('div');
  block.className = 'block';

  const content = document.createElement('div');
  content.className = 'block-content';
  content.contentEditable = 'true';

  // Empty blocks need <br> for cursor placement
  if (!text || text.trim().length === 0) {
    content.innerHTML = '<br>';
  } else {
    content.textContent = text;
  }

  block.appendChild(content);
  return block;
}

// Format a single block's content
function formatBlock(block) {
  const content = block.querySelector('.block-content');
  if (!content) return;

  // Save cursor position before formatting
  const cursorPos = getCursorPositionInBlock(content);
  const text = content.textContent;

  // If empty, just leave it
  if (!text) {
    content.innerHTML = '<br>';
    return;
  }

  // Check for parameter format: "Key value" using registry
  const trimmed = text.trim();

  // Get leading spaces for indentation
  const leadingSpaces = text.match(/^\s*/)[0];

  // Check if this is an oscillator header line (e.g., "oscillator prime")
  const oscMatch = trimmed.match(/^oscillator\s+(.+)$/i);
  if (oscMatch) {
    const oscName = oscMatch[1];
    content.innerHTML = `${leadingSpaces}<span class="syntax-key">oscillator</span> <span class="syntax-oscillator">${oscName}</span>`;
    setCursorPositionInBlock(content, cursorPos);
    return;
  }

  // Check if this is an LFO header line (e.g., "lfo slow")
  const lfoMatch = trimmed.match(/^lfo\s+(.+)$/i);
  if (lfoMatch) {
    const lfoName = lfoMatch[1];
    content.innerHTML = `${leadingSpaces}<span class="syntax-key">lfo</span> <span class="syntax-oscillator">${lfoName}</span>`;
    setCursorPositionInBlock(content, cursorPos);
    return;
  }

  // Check if this is a note header line (e.g., "note c3")
  const noteMatch = trimmed.match(/^note\s+(.+)$/i);
  if (noteMatch) {
    const noteName = noteMatch[1];
    content.innerHTML = `${leadingSpaces}<span class="syntax-key">note</span> <span class="syntax-oscillator">${noteName}</span>`;

    // Preserve any trailing space after the note name
    if (text.endsWith(' ') && !trimmed.endsWith(' ')) {
      content.appendChild(document.createTextNode(' '));
    }

    setCursorPositionInBlock(content, cursorPos);
    return;
  }

  // Check if this is a key header line (e.g., "key f")
  const keyMatch = trimmed.match(/^key\s+(.+)$/i);
  if (keyMatch) {
    const keyName = keyMatch[1];
    content.innerHTML = `${leadingSpaces}<span class="syntax-key">key</span> <span class="syntax-oscillator">${keyName}</span>`;

    // Preserve any trailing space after the key name
    if (text.endsWith(' ') && !trimmed.endsWith(' ')) {
      content.appendChild(document.createTextNode(' '));
    }

    setCursorPositionInBlock(content, cursorPos);
    return;
  }

  // Check if this is a variable line (definition or incomplete)
  if (trimmed.startsWith('variable ')) {
    const afterVariable = trimmed.substring('variable '.length);
    const parts = afterVariable.split(/\s+/);

    if (parts.length >= 2 && parts[1]) {
      // Complete variable definition: "variable name value"
      const varName = parts[0];
      const varValue = parts.slice(1).join(' ');
      content.innerHTML = `${leadingSpaces}<span class="syntax-key">variable</span> <span class="syntax-oscillator">${varName}</span> <span class="syntax-number">${varValue}</span>`;
      setCursorPositionInBlock(content, cursorPos);
      return;
    } else if (parts.length === 1 && parts[0]) {
      // Incomplete: "variable name" (no value yet) or "variable name "
      const varName = parts[0];
      content.innerHTML = `${leadingSpaces}<span class="syntax-key">variable</span> <span class="syntax-oscillator">${varName}</span>`;
      // Preserve any trailing space
      if (text.endsWith(' ') && !trimmed.endsWith(' ')) {
        content.appendChild(document.createTextNode(' '));
      }
      setCursorPositionInBlock(content, cursorPos);
      return;
    }
    // If we get here, it's just "variable" with no name - don't format
  }

  // Try to match against known parameter keys (excluding 'variable' which we handled above)
  let matchedKey = null;
  for (const key of PARAMETER_KEYS) {
    if (key !== 'variable' && trimmed.startsWith(key + ' ')) {
      matchedKey = key;
      break;
    }
  }

  if (!matchedKey) {
    // No known parameter key - just regular text (white), don't format
    // Only update if it's not already plain text
    if (content.children.length > 0) {
      content.textContent = text;
      setCursorPositionInBlock(content, cursorPos);
    }
    return;
  }

  // Extract value after the matched key
  const value = trimmed.substring(matchedKey.length + 1);

  if (!value) {
    // Just key with trailing whitespace - don't format, keep as plain text
    // This prevents cursor jumping when editing values
    if (content.children.length > 0) {
      content.textContent = text;
      setCursorPositionInBlock(content, cursorPos);
    }
    return;
  }

  // Full parameter line with value - format it
  // Check if value is a variable reference
  const isVariable = variables.hasOwnProperty(value);
  const isNumber = !isVariable && !isNaN(parseFloat(value)) && isFinite(value);
  const valueClass = isVariable ? 'syntax-oscillator' : (isNumber ? 'syntax-number' : 'syntax-string');

  content.innerHTML = `${leadingSpaces}<span class="syntax-key">${matchedKey}</span> <span class="${valueClass}">${value}</span>`;

  // Preserve any trailing space after the value
  if (text.endsWith(' ') && !trimmed.endsWith(' ')) {
    content.appendChild(document.createTextNode(' '));
  }

  // Restore cursor position after formatting
  setCursorPositionInBlock(content, cursorPos);
}

// Get all blocks as text
function getAllBlocksText() {
  const blocks = Array.from(parametersTextbox.querySelectorAll('.block'));
  return blocks.map(block => {
    const content = block.querySelector('.block-content');
    return content ? content.textContent : '';
  }).join('\n');
}

// Focus a block's content
function focusBlock(blockElement, atEnd = false) {
  if (!blockElement) return;

  // Clear selection first to prevent flashing
  const selection = window.getSelection();
  selection.removeAllRanges();

  // Small delay to let DOM settle
  requestAnimationFrame(() => {
    const contentEl = blockElement.querySelector('.block-content');
    if (!contentEl) return;

    const range = document.createRange();

    if (atEnd) {
      // Place cursor at the absolute end of all content
      try {
        range.selectNodeContents(contentEl);
        range.collapse(false); // false = collapse to end
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        console.error('Focus error:', e);
      }
    } else {
      // Place cursor at the beginning
      // Ensure there's a text node to focus
      let textNode;
      if (contentEl.childNodes.length === 0) {
        // No children - add empty text node
        textNode = document.createTextNode('');
        contentEl.appendChild(textNode);
      } else if (contentEl.childNodes.length === 1 && contentEl.firstChild.nodeName === 'BR') {
        // Only a BR tag - add text node before it
        textNode = document.createTextNode('');
        contentEl.insertBefore(textNode, contentEl.firstChild);
      } else {
        // Find first text node or create one
        textNode = Array.from(contentEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (!textNode) {
          textNode = document.createTextNode('');
          contentEl.insertBefore(textNode, contentEl.firstChild);
        }
      }

      try {
        range.setStart(textNode, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        console.error('Focus error:', e);
      }
    }
  });
}

// Initialize blocks with default content
function initializeBlocks() {
  const initialLines = [];

  // Add oscillator lines from initial config
  oscillatorNames.forEach((name, index) => {
    if (index < oscillatorConfigs.length) {
      const config = oscillatorConfigs[index];
      initialLines.push(`oscillator ${name}`);
      initialLines.push(`  wave ${config.wave}`);
      initialLines.push(`  octave ${config.octave}`);
      initialLines.push(`  volume ${config.volume * 100}`);
      initialLines.push(`  attack time ${config.attack}`);
      initialLines.push(`  sustain level ${config.sustain * 100}`);
      initialLines.push(`  release time ${config.release}`);
      initialLines.push(''); // Empty line between oscillators
    }
  });

  // Add global parameters from config
  initialLines.push(`master volume ${globalConfig.masterVolume.value * 100}`);
  initialLines.push(`envelope attack time ${globalConfig.masterEnvelope.attack.value}`);
  initialLines.push(`envelope sustain level ${globalConfig.masterEnvelope.sustain.value * 100}`);
  initialLines.push(`envelope release time ${globalConfig.masterEnvelope.release.value}`);
  initialLines.push(`compressor threshold ${globalConfig.compressor.threshold.value}`);
  initialLines.push(`compressor ratio ${globalConfig.compressor.ratio.value}`);
  initialLines.push(`compressor knee ${globalConfig.compressor.knee.value}`);
  initialLines.push(`compressor attack ${globalConfig.compressor.attack.value}`);
  initialLines.push(`compressor release ${globalConfig.compressor.release.value}`);

  parametersTextbox.contentEditable = 'true';
  parametersTextbox.innerHTML = '';
  initialLines.forEach(line => {
    const block = createBlock(line);
    parametersTextbox.appendChild(block);
    formatBlock(block);
  });
}

// Update a specific parameter by finding and updating its block
// Track currently highlighted element for sliders
let currentlyHighlightedElement = null;

// Helper to scroll to and pulse a block/element
function scrollToAndPulse(element, persist = false) {
  // Scroll into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (persist) {
    // Keep highlight on - for sliders being dragged
    element.classList.add('persistent-highlight');
    currentlyHighlightedElement = element;
  } else {
    // Add pulse animation for one-time pulses
    element.classList.add('pulse-highlight');
    setTimeout(() => {
      element.classList.remove('pulse-highlight');
    }, 600);
  }
}

// Remove highlight from currently highlighted element
function clearHighlight() {
  if (currentlyHighlightedElement) {
    currentlyHighlightedElement.classList.remove('persistent-highlight');
    currentlyHighlightedElement = null;
  }
}

function updateParameterInBlocks(parameterName, newValue, oscIndex = -1) {
  const blocks = Array.from(parametersTextbox.querySelectorAll('.block'));
  let currentOscIndex = -1;

  for (const block of blocks) {
    const content = block.querySelector('.block-content');
    if (!content) continue;

    const text = content.textContent;

    if (oscIndex >= 0) {
      // Looking for oscillator parameter
      const oscMatch = text.match(/^oscillator\s+(.+)$/i);
      if (oscMatch) {
        currentOscIndex++;
      } else if (text.startsWith('  ') && currentOscIndex === oscIndex) {
        const trimmed = text.trim();
        if (trimmed.startsWith(parameterName + ' ')) {
          content.textContent = `  ${parameterName} ${newValue}`;
          formatBlock(block);

          // Update oscillator config directly without rebuilding UI
          if (oscIndex < oscillatorConfigs.length) {
            const config = oscillatorConfigs[oscIndex];
            if (parameterName === 'wave') config.wave = newValue;
            else if (parameterName === 'octave') config.octave = parseInt(newValue);
            else if (parameterName === 'volume') config.volume = parseFloat(newValue) / 100;
            else if (parameterName === 'attack time') config.attack = parseFloat(newValue);
            else if (parameterName === 'sustain level') config.sustain = parseFloat(newValue) / 100;
            else if (parameterName === 'release time') config.release = parseFloat(newValue);

            // Stop active notes so they restart with new config
            polyphonyManager.stopAllNotes();
          }

          // Scroll to and persist highlight while dragging
          scrollToAndPulse(block, true);
          return;
        }
      }
    } else {
      // Looking for global parameter (non-indented)
      if (!text.startsWith(' ') && text.startsWith(parameterName + ' ')) {
        content.textContent = `${parameterName} ${newValue}`;
        formatBlock(block);

        // Scroll to and persist highlight while dragging
        scrollToAndPulse(block, true);
        return;
      }
    }
  }
}

// Get the current block based on selection
function getCurrentBlock() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  let node = range.startContainer;

  // If it's a text node, get its parent
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  // If node is the parametersTextbox itself, try to find the first block
  if (node === parametersTextbox) {
    const firstBlock = parametersTextbox.querySelector('.block');
    return firstBlock;
  }

  // Find the closest .block-content
  const blockContent = node?.closest('.block-content');
  if (!blockContent) {
    // Fallback: try to find .block directly
    const block = node?.closest('.block');
    return block;
  }

  // Get the .block parent
  return blockContent.closest('.block');
}

// Get cursor position within a block-content element
function getCursorPositionInBlock(contentEl) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return { offset: 0, atEnd: false };

  const range = selection.getRangeAt(0);

  // Check if the selection is actually within this contentEl
  if (!contentEl.contains(range.startContainer)) {
    return { offset: 0, atEnd: false };
  }

  const preRange = range.cloneRange();
  preRange.selectNodeContents(contentEl);
  preRange.setEnd(range.endContainer, range.endOffset);
  const offset = preRange.toString().length;

  // Also check if we're at the end
  const postRange = range.cloneRange();
  postRange.selectNodeContents(contentEl);
  postRange.setStart(range.endContainer, range.endOffset);
  const atEnd = postRange.toString().length === 0;

  return { offset, atEnd };
}

// Set cursor position within a block-content element
function setCursorPositionInBlock(contentEl, posInfo) {
  const range = document.createRange();
  const selection = window.getSelection();

  // Handle both old number format and new object format for backwards compatibility
  const offset = typeof posInfo === 'number' ? posInfo : posInfo.offset;
  const atEnd = typeof posInfo === 'object' && posInfo.atEnd;

  // If we were at the end, just place cursor at end
  if (atEnd) {
    try {
      range.selectNodeContents(contentEl);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    } catch (e) {
      console.error('Error placing cursor at end:', e);
      return;
    }
  }

  let currentOffset = 0;
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLength = node.textContent.length;

    // Use > instead of >= to handle boundary cases correctly
    // When offset equals currentOffset + nodeLength, we're at the boundary
    // and should continue to the next node (start of next) rather than
    // stopping here (end of current)
    if (currentOffset + nodeLength > offset) {
      try {
        const nodeOffset = Math.min(offset - currentOffset, nodeLength);
        range.setStart(node, nodeOffset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      } catch (e) {
        console.error('Error setting cursor position:', e);
        return;
      }
    }
    currentOffset += nodeLength;
  }

  // Place at end if offset is beyond content
  try {
    if (contentEl.lastChild) {
      range.selectNodeContents(contentEl);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (e) {
    console.error('Error placing cursor at fallback position:', e);
  }
}

// Set cursor to the end of a block-content element
function setCursorToEnd(contentEl) {
  const range = document.createRange();
  const selection = window.getSelection();

  range.selectNodeContents(contentEl);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Find number at cursor position
function findNumberAtPosition(text, position) {
  let start = position;
  let end = position;

  // Look backwards to find start of number
  while (start > 0 && /[\d.\-]/.test(text[start - 1])) {
    start--;
  }

  // Look forwards to find end of number
  while (end < text.length && /[\d.\-]/.test(text[end])) {
    end++;
  }

  const value = text.substring(start, end);
  const parsed = parseFloat(value);

  if (!value || isNaN(parsed)) return null;

  return { start, end, value: parsed };
}

// Find wave type at cursor position
function findWaveTypeAtPosition(text, position) {
  // Find the word at cursor position
  let start = position;
  let end = position;

  // Look backwards to find start of word
  while (start > 0 && /[a-z]/.test(text[start - 1])) {
    start--;
  }

  // Look forwards to find end of word
  while (end < text.length && /[a-z]/.test(text[end])) {
    end++;
  }

  const value = text.substring(start, end);
  const waveTypes = ['sine', 'square', 'sawtooth', 'triangle'];

  if (waveTypes.includes(value)) {
    return { start, end, value };
  }

  return null;
}

// Handle increment/decrement within a block
function performIncrementInBlock(contentEl, direction, shiftKey) {
  const text = contentEl.textContent;
  const cursorOffset = getCursorPositionInBlock(contentEl);
  const block = contentEl.closest('.block');
  if (!block) return;

  // Check if cursor is on a wave type first
  const waveInfo = findWaveTypeAtPosition(text, cursorOffset);

  if (waveInfo) {
    // Cycle through wave types
    const waveTypes = ['sine', 'square', 'sawtooth', 'triangle'];
    const currentIndex = waveTypes.indexOf(waveInfo.value);
    const newIndex = (currentIndex + direction + waveTypes.length) % waveTypes.length;
    const newValue = waveTypes[newIndex];

    // Replace in text
    const newText = text.substring(0, waveInfo.start) +
                    newValue +
                    text.substring(waveInfo.end);

    // Update the block content
    contentEl.textContent = newText;

    // Sync UI from all blocks
    syncUIFromText();

    // Format this block
    formatBlock(block);

    // Restore cursor position in block
    setCursorPositionInBlock(contentEl, waveInfo.start + newValue.length);
    return;
  }

  // Check if the line contains a parameter with a number value
  // Look for pattern: "key number" where key is from PARAMETER_KEYS
  const trimmed = text.trim();
  let matchedKey = null;
  let valueStr = null;

  for (const key of PARAMETER_KEYS) {
    if (trimmed.startsWith(key + ' ')) {
      matchedKey = key;
      valueStr = trimmed.substring(key.length + 1);
      break;
    }
  }

  // If no parameter key found, try to find number at cursor position (fallback)
  if (!matchedKey) {
    const numberInfo = findNumberAtPosition(text, cursorOffset);
    if (!numberInfo) return;

    // Use the fallback logic with default increment
    let increment = shiftKey ? 10 : 1;
    const delta = direction * increment;
    let newValue = numberInfo.value + delta;
    newValue = Math.round(newValue * 1000) / 1000;

    const newText = text.substring(0, numberInfo.start) +
                    newValue +
                    text.substring(numberInfo.end);

    contentEl.textContent = newText;
    syncUIFromText();
    formatBlock(block);
    setCursorPositionInBlock(contentEl, numberInfo.start + String(newValue).length);
    return;
  }

  // Parse the value as a number
  const currentValue = parseFloat(valueStr);
  if (isNaN(currentValue)) return;

  // Use the current line to determine parameter type (block contains single line)
  const line = text.toLowerCase();

  // Determine increment based on parameter type
  let increment;
  if (line.includes('volume') || line.includes('sustain')) {
    increment = shiftKey ? 10 : 1;
  } else if (line.includes('compressor attack') || line.includes('compressor release')) {
    increment = shiftKey ? 0.01 : 0.001;
  } else if (line.includes('envelope attack') || line.includes('envelope release') || line.includes('attack time') || line.includes('release time')) {
    increment = shiftKey ? 100 : 10;
  } else {
    increment = shiftKey ? 10 : 1;
  }

  const delta = direction * increment;
  let newValue = currentValue + delta;

  // Round to avoid floating point issues
  newValue = Math.round(newValue * 1000) / 1000;

  // Apply appropriate bounds
  if (line.includes('volume') || line.includes('sustain')) {
    newValue = Math.max(0, Math.min(100, newValue));
  } else if (line.includes('attack') || line.includes('release')) {
    newValue = Math.max(0, newValue);
  } else if (line.includes('octave')) {
    newValue = Math.max(-2, Math.min(2, newValue));
  } else if (line.includes('threshold')) {
    newValue = Math.max(-100, Math.min(0, newValue));
  } else if (line.includes('ratio')) {
    newValue = Math.max(1, Math.min(20, newValue));
  } else if (line.includes('knee')) {
    newValue = Math.max(0, Math.min(40, newValue));
  }

  // Get leading spaces for indentation
  const leadingSpaces = text.match(/^\s*/)[0];

  // Replace entire line with updated value
  const newText = leadingSpaces + matchedKey + ' ' + newValue;

  // Update the block content
  contentEl.textContent = newText;

  // Sync UI from all blocks
  syncUIFromText();

  // Format this block
  formatBlock(block);

  // Restore cursor position in block
  setCursorPositionInBlock(contentEl, numberInfo.start + String(newValue).length);
}


// Handle Arrow keys for navigation and Cmd/Ctrl + Arrow for incrementing/decrementing
parametersTextbox.addEventListener("keydown", (e) => {
  const modifier = e.metaKey || e.ctrlKey;
  const isUp = e.key === "ArrowUp";
  const isDown = e.key === "ArrowDown";

  // Get the current block based on selection
  const block = getCurrentBlock();
  if (!block) return;

  const blockContent = block.querySelector('.block-content');
  if (!blockContent) return;

  // Handle Cmd/Ctrl + Arrow for increment/decrement
  if (modifier && (isUp || isDown)) {
    e.preventDefault();
    const direction = isUp ? 1 : -1;
    performIncrementInBlock(blockContent, direction, e.shiftKey);
    return;
  }

  // Handle plain Arrow keys for navigation between blocks (but not Shift+Arrow for selection)
  if ((isUp || isDown) && !e.shiftKey) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    // Get current cursor position (visual coordinates)
    const rects = range.getClientRects();
    if (rects.length === 0) return;

    const currentRect = rects[0];
    const currentX = currentRect.left;
    const currentY = isUp ? currentRect.top : currentRect.bottom;

    // Calculate target position (one line up/down)
    const lineHeight = parseInt(window.getComputedStyle(blockContent).lineHeight) || 25;
    const targetY = isUp ? currentY - lineHeight : currentY + lineHeight;

    // Find the target block
    const targetBlock = isUp ? block.previousElementSibling : block.nextElementSibling;

    if (targetBlock && targetBlock.classList.contains('block')) {
      e.preventDefault();

      const targetContent = targetBlock.querySelector('.block-content');
      if (targetContent) {
        // Try to find a position at the same horizontal position in the target block
        const targetRange = document.caretRangeFromPoint(currentX, targetY);

        // Check if the target position is within the target block
        if (targetRange && targetContent.contains(targetRange.startContainer)) {
          // Place cursor at the same horizontal position
          selection.removeAllRanges();
          selection.addRange(targetRange);
        } else {
          // Fall back to beginning/end of target block
          focusBlock(targetBlock, isUp);
        }
      } else {
        // No content element, just focus the block
        focusBlock(targetBlock, isUp);
      }
    }
  }
});

// Helper to scroll to corresponding control in pane when editing document
function scrollToPaneControl(blockContent) {
  const text = blockContent.textContent.trim();
  if (!text) return;

  let controlSection = null;

  // Check if it's an oscillator header
  const oscMatch = text.match(/^oscillator\s+(.+)$/i);
  if (oscMatch) {
    // Find the oscillator section by data-oscillatorIndex
    const oscName = oscMatch[1].trim();
    const oscIndex = oscillatorNames.indexOf(oscName);
    if (oscIndex >= 0) {
      controlSection = document.querySelector(`[data-oscillatorIndex="${oscIndex}"]`);
    }
  } else if (text.startsWith('  ')) {
    // It's an indented parameter - find its oscillator section
    // Get the oscillator index by scanning backwards
    const blocks = Array.from(parametersTextbox.querySelectorAll('.block'));
    const currentIndex = blocks.findIndex(b => b.querySelector('.block-content') === blockContent);

    for (let i = currentIndex - 1; i >= 0; i--) {
      const prevText = blocks[i].querySelector('.block-content')?.textContent.trim();
      const prevOscMatch = prevText?.match(/^oscillator\s+(.+)$/i);
      if (prevOscMatch) {
        const oscName = prevOscMatch[1].trim();
        const oscIndex = oscillatorNames.indexOf(oscName);
        if (oscIndex >= 0) {
          controlSection = document.querySelector(`[data-oscillatorIndex="${oscIndex}"]`);
        }
        break;
      }
    }
  } else {
    // Global parameter - match by section ID or header text
    if (text.startsWith('master volume')) {
      controlSection = document.getElementById('master-volume-section');
    } else if (text.startsWith('envelope')) {
      controlSection = document.getElementById('master-envelope-section');
    } else if (text.startsWith('compressor')) {
      controlSection = document.getElementById('compressor-section');
    } else if (text.startsWith('chord')) {
      controlSection = document.getElementById('chord-section');
    }
  }

  if (controlSection) {
    // Scroll the right pane to show the control
    const rightPane = document.querySelector('.right-pane');
    const controlTop = controlSection.offsetTop;
    rightPane.scrollTo({ top: controlTop - 100, behavior: 'smooth' });

    // Pulse the section header
    const header = controlSection.querySelector('h2');
    if (header) {
      scrollToAndPulse(header);
    }
  }
}

// Block-based input handling with event delegation
parametersTextbox.addEventListener("input", () => {
  // Get the current block based on selection
  const block = getCurrentBlock();
  if (!block) return;

  const blockContent = block.querySelector('.block-content');
  if (!blockContent) return;

  // Fix any content that ended up directly in .block instead of .block-content
  Array.from(block.childNodes).forEach(node => {
    if (node !== blockContent && node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      // Move text from .block to .block-content
      blockContent.textContent = node.textContent + blockContent.textContent;
      node.remove();
    }
  });

  // Set flag to prevent slider updates from regenerating text
  isUpdatingFromText = true;

  // Format the current block (this preserves cursor position)
  formatBlock(block);

  // Sync the UI
  syncUIFromText();

  // Scroll to and pulse the corresponding control in the pane
  scrollToPaneControl(blockContent);

  // Reset flag
  isUpdatingFromText = false;
});

// Handle paste to maintain block structure
parametersTextbox.addEventListener("paste", (e) => {
  e.preventDefault();

  // Get plain text from clipboard
  const text = e.clipboardData.getData('text/plain');
  const lines = text.split('\n');

  // Get current block and cursor position
  const currentBlock = getCurrentBlock();

  if (!currentBlock) {
    // No current block, append all lines as new blocks
    lines.forEach(line => {
      const block = createBlock(line);
      parametersTextbox.appendChild(block);
      formatBlock(block);
    });
  } else {
    // Insert at cursor position
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const contentEl = currentBlock.querySelector('.block-content');

      // Get text before and after cursor
      const beforeRange = range.cloneRange();
      beforeRange.selectNodeContents(contentEl);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeText = beforeRange.toString();

      const afterRange = range.cloneRange();
      afterRange.selectNodeContents(contentEl);
      afterRange.setStart(range.startContainer, range.startOffset);
      const afterText = afterRange.toString();

      // Update current block with before text + first pasted line
      contentEl.textContent = beforeText + lines[0];
      formatBlock(currentBlock);

      // Insert remaining lines as new blocks
      let lastBlock = currentBlock;
      for (let i = 1; i < lines.length; i++) {
        const block = createBlock(lines[i]);
        lastBlock.parentNode.insertBefore(block, lastBlock.nextSibling);
        formatBlock(block);
        lastBlock = block;
      }

      // Append after text to last block
      if (afterText) {
        lastBlock.querySelector('.block-content').textContent += afterText;
        formatBlock(lastBlock);
      }

      // Focus the last block
      focusBlock(lastBlock);
    }
  }

  // Sync UI from the updated text
  syncUIFromText();
});

// Handle Enter key to create new blocks
parametersTextbox.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;

  const currentBlock = getCurrentBlock();
  if (!currentBlock) return;

  e.preventDefault();

  const contentEl = currentBlock.querySelector('.block-content');
  if (!contentEl) return;

  // Split at cursor
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);

  // Extract content after cursor
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(contentEl);
  afterRange.setStart(range.startContainer, range.startOffset);
  const afterContent = afterRange.toString();

  // Delete content after cursor from current block
  afterRange.deleteContents();
  if (contentEl.childNodes.length === 0) {
    contentEl.innerHTML = '<br>';
  }

  // Format the current block after removing content
  formatBlock(currentBlock);

  // Create new block with content that was after cursor
  const newBlock = createBlock(afterContent);

  // Insert after current block
  currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);

  // Format the new block
  formatBlock(newBlock);

  // Focus new block
  focusBlock(newBlock);
});

// Handle Backspace at beginning to merge with previous block
parametersTextbox.addEventListener("keydown", (e) => {
  if (e.key !== "Backspace") return;

  // Get the current block based on selection
  const block = getCurrentBlock();
  if (!block) return;

  const blockContent = block.querySelector('.block-content');
  if (!blockContent) return;

  const cursorPos = getCursorPositionInBlock(blockContent);
  if (cursorPos !== 0) return; // Only handle if at beginning

  const prevBlock = block.previousElementSibling;
  if (!prevBlock || !prevBlock.classList.contains('block')) return;

  e.preventDefault();

  // Merge current block content into previous block
  const prevContent = prevBlock.querySelector('.block-content');
  if (!prevContent) return;

  const prevText = prevContent.textContent;
  const currentText = blockContent.textContent;
  const mergedText = prevText + currentText;

  prevContent.textContent = mergedText;
  formatBlock(prevBlock);

  // Remove current block
  block.remove();

  // Focus at merge point in previous block
  focusBlock(prevBlock, true);
});

// Handle Tab for indenting and Shift+Tab for outdenting
parametersTextbox.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;

  // Prevent default Tab behavior immediately
  e.preventDefault();

  // Get the current block based on selection
  const block = getCurrentBlock();
  if (!block) return;

  const blockContent = block.querySelector('.block-content');
  if (!blockContent) return;

  const text = blockContent.textContent;
  const cursorPos = getCursorPositionInBlock(blockContent);

  // Set flag to prevent slider updates
  isUpdatingFromText = true;

  if (e.shiftKey) {
    // Shift+Tab: Outdent (remove 2 spaces from beginning)
    if (text.startsWith('  ')) {
      const newText = text.substring(2);
      blockContent.textContent = newText;
      formatBlock(block);

      // Adjust cursor position (move back by 2 if we were past the removed spaces)
      const newCursorPos = Math.max(0, cursorPos - 2);
      setCursorPositionInBlock(blockContent, newCursorPos);

      // Sync UI from all blocks
      syncUIFromText();
    }
  } else {
    // Tab: Indent (add 2 spaces to beginning)
    const newText = '  ' + text;
    blockContent.textContent = newText;
    formatBlock(block);

    // Adjust cursor position (move forward by 2)
    setCursorPositionInBlock(blockContent, cursorPos + 2);

    // Sync UI from all blocks
    syncUIFromText();
  }

  // Reset flag
  isUpdatingFromText = false;
});


// All slider event listeners are now attached dynamically in the UI generation functions
// (createOscillatorSection, createMasterVolumeSection, createCompressorSection)

// MIDI Support
navigator.requestMIDIAccess()
  .then((midiAccess) => {
    const inputs = midiAccess.inputs.values();
    for (const input of inputs) {
      input.onmidimessage = handleMIDIMessage;
    }
  })
  .catch((err) => console.error("Failed to get MIDI access:", err));

function handleMIDIMessage(message) {
  const [status, note, velocity] = message.data;
  const rootFrequency = 440 * Math.pow(2, (note - 69) / 12);

  if (status === 144 && velocity > 0) {
    // Note on - start all chord notes
    const frequencies = getChordFrequencies(rootFrequency, note);
    frequencies.forEach((freq, index) => {
      const noteId = `midi-${note}-${index}`;
      const isSynthetic = index > 0; // First note (index 0) is root, rest are synthetic
      polyphonyManager.startNote(freq, noteId, velocity, isSynthetic, note);
    });
  } else if (status === 128 || (status === 144 && velocity === 0)) {
    // Note off - stop all chord notes
    const frequencies = getChordFrequencies(rootFrequency, note);
    frequencies.forEach((freq, index) => {
      const noteId = `midi-${note}-${index}`;
      polyphonyManager.stopNote(noteId);
    });
  }
}

// Virtual Keyboard Support
// Update keyboard visual highlights based on key definitions
function updateKeyboardHighlights() {
  // Remove all has-definition classes first
  document.querySelectorAll('.key-label').forEach(keyElement => {
    keyElement.classList.remove('has-definition');
  });

  // Add has-definition class to keys with configurations
  Object.keys(keyConfigs).forEach(keyChar => {
    const keyConfig = keyConfigs[keyChar];
    // Only highlight if there's actually a configuration (e.g., pitch LFO)
    if (keyConfig.pitch) {
      const keyElement = document.querySelector(`.key-label[data-key="${keyChar}"]`);
      if (keyElement) {
        keyElement.classList.add('has-definition');
      }
    }
  });
}

const activeKeys = new Set();
const activeDefinedKeys = new Set(); // Track keys with definitions that are currently held

// Keyboard to MIDI note mapping - chromatic layout starting from C3
const keyToNote = {
  'z': 48,  'x': 49,  'c': 50,  'v': 51,  'b': 52,  'n': 53,  'm': 54,  ',': 55,  '.': 56,  '/': 57,
  'a': 58,  's': 59,  'd': 60,  'f': 61,  'g': 62,  'h': 63,  'j': 64,  'k': 65,  'l': 66,  ';': 67,
  'q': 68,  'w': 69,  'e': 70,  'r': 71,  't': 72,  'y': 73,  'u': 74,  'i': 75,  'o': 76,  'p': 77,
  '1': 78,  '2': 79,  '3': 80,  '4': 81,  '5': 82,  '6': 83,  '7': 84,  '8': 85,  '9': 86,  '0': 87
};

// Use event delegation since virtual keyboard is generated dynamically
document.addEventListener("focus", (e) => {
  if (e.target.id === "virtual-keyboard") {
    parametersTextbox.blur();
  }
}, true);

document.addEventListener("click", (e) => {
  if (e.target.id === "virtual-keyboard" || e.target.closest("#virtual-keyboard")) {
    parametersTextbox.blur();
    const keyboard = document.getElementById("virtual-keyboard");
    if (keyboard) keyboard.focus();
  }
});

document.addEventListener("keydown", (e) => {
  const target = e.target;
  if (target.id !== "virtual-keyboard") return;

  const key = e.key.toLowerCase();

  // Ignore if key is already pressed (prevents retriggering on key repeat)
  if (activeKeys.has(key)) return;

  const midiNote = keyToNote[key];
  if (midiNote !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    activeKeys.add(key);

    // Highlight the key visually
    const keyElement = document.querySelector(`.key-label[data-key="${key}"]`);
    if (keyElement) {
      keyElement.classList.add('active');
    }

    // If this key has a definition (like an LFO assignment), track it but don't play notes
    if (keyConfigs[key] && keyConfigs[key].pitch) {
      activeDefinedKeys.add(key);

      // Apply this key's LFO to all currently active notes
      const lfoName = keyConfigs[key].pitch;
      polyphonyManager.activeNotes.forEach(note => {
        note.addKeyLFO(lfoName);
      });

      return;
    }

    const rootFrequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    const frequencies = getChordFrequencies(rootFrequency, midiNote);

    frequencies.forEach((freq, index) => {
      const noteId = `keyboard-${key}-${index}`;
      const isSynthetic = index > 0; // First note (index 0) is root, rest are synthetic
      polyphonyManager.startNote(freq, noteId, 100, isSynthetic, midiNote, key);
    });
  }
});

document.addEventListener("keyup", (e) => {
  const target = e.target;
  if (target.id !== "virtual-keyboard") return;

  const key = e.key.toLowerCase();
  const midiNote = keyToNote[key];

  if (midiNote !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    activeKeys.delete(key);
    activeDefinedKeys.delete(key); // Remove from defined keys tracking

    // Remove highlight from the key
    const keyElement = document.querySelector(`.key-label[data-key="${key}"]`);
    if (keyElement) {
      keyElement.classList.remove('active');
    }

    // If this key has a definition, remove its LFO from all active notes
    if (keyConfigs[key] && keyConfigs[key].pitch) {
      polyphonyManager.activeNotes.forEach(note => {
        note.removeKeyLFO();
      });
      return;
    }

    const rootFrequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    const frequencies = getChordFrequencies(rootFrequency, midiNote);

    frequencies.forEach((freq, index) => {
      const noteId = `keyboard-${key}-${index}`;
      polyphonyManager.stopNote(noteId);
    });
  }
});

document.addEventListener("blur", (e) => {
  if (e.target.id === "virtual-keyboard") {
    activeKeys.forEach(key => {
      const noteId = `keyboard-${key}`;
      polyphonyManager.stopNote(noteId);

      // Remove highlight from the key
      const keyElement = document.querySelector(`.key-label[data-key="${key}"]`);
      if (keyElement) {
        keyElement.classList.remove('active');
      }
    });
    activeKeys.clear();
    activeDefinedKeys.clear();
  }
}, true);

// Initialize application
function initialize() {
  // Initialize default oscillator names from variable_names
  initializeDefaultOscillatorNames();

  // Build chord intervals from definitions
  buildChordIntervals();

  // Then initialize the rest of the UI
  initializeBlocks();
  syncUIFromText();
}

// Start initialization
initialize();

// Clear highlight when mouse is released (for slider highlighting)
document.addEventListener('mouseup', () => {
  clearHighlight();
});

// ===== Command Modal (Slash Menu) =====

// Command modal state
let commandModalOpen = false;
let slashPosition = null;
let slashBlock = null; // Store the block where slash was pressed
let selectedCommandIndex = 0;
let filteredCommandsList = [];

// DOM elements
const commandModal = document.getElementById('command-modal');
const commandSearch = document.getElementById('command-search');
const commandList = document.getElementById('command-list');

// Text size and line spacing state (stored in CSS custom properties)
let currentFontSize = 14; // Default from CSS
let currentLineHeight = 1.6; // Default from CSS

// Helper function to get a random unused name from variable_names
function getRandomUnusedName(usedNames) {
  // Shuffle the variable_names array to get random order
  const shuffled = [...variable_names].sort(() => Math.random() - 0.5);

  // Find first name that's not used
  for (const name of shuffled) {
    if (!usedNames.includes(name)) {
      return name;
    }
  }

  // If all names are used, fall back to numeric naming
  let counter = 1;
  while (usedNames.includes(`item${counter}`)) {
    counter++;
  }
  return `item${counter}`;
}

// Command definitions
const commands = [
  {
    name: "New Oscillator",
    description: "Create a new oscillator with default settings",
    action: () => {
      // Get all existing names (oscillators, LFOs, notes)
      const existingNames = Array.from(parametersTextbox.querySelectorAll('.block-content'))
        .map(block => {
          const text = block.textContent.trim();
          const oscMatch = text.match(/^oscillator\s+(.+)$/i);
          const lfoMatch = text.match(/^lfo\s+(.+)$/i);
          const noteMatch = text.match(/^note\s+(.+)$/i);
          if (oscMatch) return oscMatch[1];
          if (lfoMatch) return lfoMatch[1];
          if (noteMatch) return noteMatch[1];
          return null;
        })
        .filter(name => name !== null);

      // Get a random unused name
      const oscName = getRandomUnusedName(existingNames);

      // Use the saved block from when slash was pressed
      const targetBlock = slashBlock;

      // Create the new oscillator blocks
      const oscHeaderBlock = createBlock(`oscillator ${oscName}`);
      const waveBlock = createBlock(`  wave sine`);
      const octaveBlock = createBlock(`  octave 0`);
      const volumeBlock = createBlock(`  volume 50`);
      const attackBlock = createBlock(`  attack time 100`);
      const sustainBlock = createBlock(`  sustain level 50`);
      const releaseBlock = createBlock(`  release time 500`);

      // Insert the blocks
      if (targetBlock) {
        // Insert after the current block (in reverse order)
        targetBlock.insertAdjacentElement('afterend', releaseBlock);
        targetBlock.insertAdjacentElement('afterend', sustainBlock);
        targetBlock.insertAdjacentElement('afterend', attackBlock);
        targetBlock.insertAdjacentElement('afterend', volumeBlock);
        targetBlock.insertAdjacentElement('afterend', octaveBlock);
        targetBlock.insertAdjacentElement('afterend', waveBlock);
        targetBlock.insertAdjacentElement('afterend', oscHeaderBlock);
      } else {
        // Append to the end
        parametersTextbox.appendChild(oscHeaderBlock);
        parametersTextbox.appendChild(waveBlock);
        parametersTextbox.appendChild(octaveBlock);
        parametersTextbox.appendChild(volumeBlock);
        parametersTextbox.appendChild(attackBlock);
        parametersTextbox.appendChild(sustainBlock);
        parametersTextbox.appendChild(releaseBlock);
      }

      // Format and sync
      formatBlock(oscHeaderBlock);
      formatBlock(waveBlock);
      formatBlock(octaveBlock);
      formatBlock(volumeBlock);
      formatBlock(attackBlock);
      formatBlock(sustainBlock);
      formatBlock(releaseBlock);

      syncUIFromText();

      // Position cursor at the end of the oscillator name
      const oscContent = oscHeaderBlock.querySelector('.block-content');
      setCursorToEnd(oscContent);
    }
  },
  {
    name: "New LFO",
    description: "Create a new LFO with default settings",
    action: () => {
      // Get all existing names (oscillators, LFOs, notes)
      const existingNames = Array.from(parametersTextbox.querySelectorAll('.block-content'))
        .map(block => {
          const text = block.textContent.trim();
          const oscMatch = text.match(/^oscillator\s+(.+)$/i);
          const lfoMatch = text.match(/^lfo\s+(.+)$/i);
          const noteMatch = text.match(/^note\s+(.+)$/i);
          if (oscMatch) return oscMatch[1];
          if (lfoMatch) return lfoMatch[1];
          if (noteMatch) return noteMatch[1];
          return null;
        })
        .filter(name => name !== null);

      // Get a random unused name
      const lfoName = getRandomUnusedName(existingNames);

      // Use the saved block from when slash was pressed
      const targetBlock = slashBlock;

      // Create the new LFO blocks
      const lfoHeaderBlock = createBlock(`lfo ${lfoName}`);
      const rateBlock = createBlock(`  rate 5`);
      const depthBlock = createBlock(`  depth 10`);
      const waveBlock = createBlock(`  wave sine`);

      // Insert the blocks
      if (targetBlock) {
        // Insert after the current block (in reverse order)
        targetBlock.insertAdjacentElement('afterend', waveBlock);
        targetBlock.insertAdjacentElement('afterend', depthBlock);
        targetBlock.insertAdjacentElement('afterend', rateBlock);
        targetBlock.insertAdjacentElement('afterend', lfoHeaderBlock);
      } else {
        // Append to the end
        parametersTextbox.appendChild(lfoHeaderBlock);
        parametersTextbox.appendChild(rateBlock);
        parametersTextbox.appendChild(depthBlock);
        parametersTextbox.appendChild(waveBlock);
      }

      // Format and sync
      formatBlock(lfoHeaderBlock);
      formatBlock(rateBlock);
      formatBlock(depthBlock);
      formatBlock(waveBlock);

      syncUIFromText();

      // Position cursor at the end of the LFO name
      const lfoContent = lfoHeaderBlock.querySelector('.block-content');
      setCursorToEnd(lfoContent);
    }
  },
  {
    name: "Increase Text Size",
    description: "Make the text in the editor larger (Cmd/Ctrl + =)",
    action: () => {
      currentFontSize = Math.min(currentFontSize + 2, 32);
      parametersTextbox.style.fontSize = `${currentFontSize}px`;
    }
  },
  {
    name: "Decrease Text Size",
    description: "Make the text in the editor smaller (Cmd/Ctrl + -)",
    action: () => {
      currentFontSize = Math.max(currentFontSize - 2, 8);
      parametersTextbox.style.fontSize = `${currentFontSize}px`;
    }
  },
  {
    name: "Increase Line Spacing",
    description: "Add more space between lines (Cmd/Ctrl + ])",
    action: () => {
      currentLineHeight = Math.min(currentLineHeight + 0.2, 3);
      parametersTextbox.style.lineHeight = currentLineHeight;
    }
  },
  {
    name: "Decrease Line Spacing",
    description: "Reduce space between lines (Cmd/Ctrl + [)",
    action: () => {
      currentLineHeight = Math.max(currentLineHeight - 0.2, 1);
      parametersTextbox.style.lineHeight = currentLineHeight;
    }
  }
];

// Show command modal
function showCommandModal() {
  commandModalOpen = true;
  commandModal.classList.remove("hidden");
  commandSearch.value = "";
  filterCommands("");
  selectedCommandIndex = 0;

  // Position modal near cursor
  setTimeout(() => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // Create a temporary span to get accurate cursor position
      const span = document.createElement('span');
      span.textContent = '\u200B'; // Zero-width space
      range.insertNode(span);
      const rect = span.getBoundingClientRect();
      span.parentNode.removeChild(span);

      let left = rect.left;
      let top = rect.bottom + 5;

      // Adjust if modal would go off-screen
      const modalWidth = 350;
      const modalHeight = commandModal.offsetHeight || 200;

      if (left + modalWidth > window.innerWidth) {
        left = window.innerWidth - modalWidth - 10;
      }

      if (top + modalHeight > window.innerHeight) {
        // Position above the cursor instead
        top = rect.top - modalHeight - 5;
      }

      // Ensure we don't go negative
      left = Math.max(10, left);
      top = Math.max(10, top);

      commandModal.style.left = `${left}px`;
      commandModal.style.top = `${top}px`;
    }

    // Focus search input
    commandSearch.focus();
  }, 0);
}

// Hide command modal
function hideCommandModal() {
  commandModalOpen = false;
  commandModal.classList.add("hidden");
  slashPosition = null;
  slashBlock = null;
}

// Filter commands based on search term
function filterCommands(searchTerm) {
  const filtered = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cmd.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  filteredCommandsList = filtered;
  selectedCommandIndex = 0;
  renderCommands(filtered);
}

// Render filtered commands
function renderCommands(filteredCommands) {
  commandList.innerHTML = "";

  if (filteredCommands.length === 0) {
    commandList.innerHTML = '<div class="command-item no-results">No commands found</div>';
    return;
  }

  filteredCommands.forEach((command, index) => {
    const commandItem = document.createElement("div");
    commandItem.className = `command-item ${index === selectedCommandIndex ? "selected" : ""}`;

    const commandName = document.createElement("div");
    commandName.className = "command-name";
    commandName.textContent = command.name;

    const commandDesc = document.createElement("div");
    commandDesc.className = "command-description";
    commandDesc.textContent = command.description;

    commandItem.appendChild(commandName);
    commandItem.appendChild(commandDesc);

    commandItem.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      executeCommand(command);
    });

    commandList.appendChild(commandItem);
  });
}

// Execute a command
function executeCommand(command) {
  // Hide modal first
  commandModalOpen = false;
  commandModal.classList.add("hidden");

  // Restore cursor to the saved position
  if (slashPosition && slashPosition.node) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();

      if (document.contains(slashPosition.node)) {
        range.setStart(slashPosition.node, slashPosition.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (e) {
      console.error("Error restoring cursor position:", e);
    }
  }

  // Return focus to editor BEFORE executing the command
  // so that the command can properly detect cursor position
  parametersTextbox.focus();

  // Small delay to ensure focus is applied before command executes
  setTimeout(() => {
    // Execute the command
    command.action();

    // Clear slash position and block after command executes
    slashPosition = null;
    slashBlock = null;
  }, 10);
}

// Keyboard event handler for slash detection in parameters textbox
const originalKeydownHandler = parametersTextbox.onkeydown;
parametersTextbox.addEventListener("keydown", (event) => {
  // Handle slash to open command modal
  if (event.key === "/" && !commandModalOpen) {
    event.preventDefault();

    const selection = window.getSelection();
    let range;

    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(parametersTextbox);
      range.collapse(false);
    }

    // Store the cursor position
    slashPosition = {
      node: range.startContainer,
      offset: range.startOffset
    };

    // Store the current block for commands that need to know where to insert
    slashBlock = getCurrentBlock();

    showCommandModal();
    return;
  }

  // Close modal on space (insert the slash now)
  if (event.key === " " && commandModalOpen) {
    event.preventDefault();
    if (slashPosition && slashPosition.node) {
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = document.createTextNode("/");
      range.setStart(slashPosition.node, slashPosition.offset);
      range.collapse(true);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    hideCommandModal();
    parametersTextbox.focus();
    return;
  }

  // Close modal on / (slash) without inserting
  if (event.key === "/" && commandModalOpen) {
    event.preventDefault();
    hideCommandModal();
    parametersTextbox.focus();
    return;
  }

  // Navigate commands with arrow keys
  if (commandModalOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    const commandItems = commandList.querySelectorAll(".command-item:not(.no-results)");

    if (event.key === "ArrowDown") {
      selectedCommandIndex = (selectedCommandIndex + 1) % commandItems.length;
    } else {
      selectedCommandIndex = (selectedCommandIndex - 1 + commandItems.length) % commandItems.length;
    }

    commandItems.forEach((item, index) => {
      item.classList.toggle("selected", index === selectedCommandIndex);
    });

    commandItems[selectedCommandIndex]?.scrollIntoView({ block: "nearest" });
    return;
  }

  // Execute command on Enter
  if (commandModalOpen && event.key === "Enter") {
    event.preventDefault();
    if (filteredCommandsList[selectedCommandIndex]) {
      executeCommand(filteredCommandsList[selectedCommandIndex]);
    }
    return;
  }
}, true); // Use capture phase to handle before other handlers

// Command search input event listeners
commandSearch.addEventListener("input", (event) => {
  filterCommands(event.target.value);
});

commandSearch.addEventListener("keydown", (event) => {
  // Close modal on space
  if (event.key === " " && commandSearch.value === "") {
    event.preventDefault();
    if (slashPosition && slashPosition.node) {
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = document.createTextNode("/");
      range.setStart(slashPosition.node, slashPosition.offset);
      range.collapse(true);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    hideCommandModal();
    parametersTextbox.focus();
    return;
  }

  // Close modal on /
  if (event.key === "/") {
    event.preventDefault();
    hideCommandModal();
    parametersTextbox.focus();
    return;
  }

  // Navigate with arrow keys
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const commandItems = commandList.querySelectorAll(".command-item:not(.no-results)");

    if (event.key === "ArrowDown") {
      selectedCommandIndex = (selectedCommandIndex + 1) % commandItems.length;
    } else {
      selectedCommandIndex = (selectedCommandIndex - 1 + commandItems.length) % commandItems.length;
    }

    commandItems.forEach((item, index) => {
      item.classList.toggle("selected", index === selectedCommandIndex);
    });

    commandItems[selectedCommandIndex]?.scrollIntoView({ block: "nearest" });
    return;
  }

  // Execute command on Enter
  if (event.key === "Enter") {
    event.preventDefault();
    if (filteredCommandsList[selectedCommandIndex]) {
      executeCommand(filteredCommandsList[selectedCommandIndex]);
    }
    return;
  }
});

// Click outside to close modal
document.addEventListener("click", (event) => {
  if (commandModalOpen && !commandModal.contains(event.target) && event.target !== parametersTextbox) {
    hideCommandModal();
  }
});

// Global keyboard shortcuts for commands
document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;

  // Increase Text Size: Cmd/Ctrl + =
  if (modifier && event.key === "=" && !event.shiftKey) {
    event.preventDefault();
    currentFontSize = Math.min(currentFontSize + 2, 32);
    parametersTextbox.style.fontSize = `${currentFontSize}px`;
    return;
  }

  // Decrease Text Size: Cmd/Ctrl + -
  if (modifier && event.key === "-" && !event.shiftKey) {
    event.preventDefault();
    currentFontSize = Math.max(currentFontSize - 2, 8);
    parametersTextbox.style.fontSize = `${currentFontSize}px`;
    return;
  }

  // Increase Line Spacing: Cmd/Ctrl + ]
  if (modifier && event.key === "]") {
    event.preventDefault();
    currentLineHeight = Math.min(currentLineHeight + 0.2, 3);
    parametersTextbox.style.lineHeight = currentLineHeight;
    return;
  }

  // Decrease Line Spacing: Cmd/Ctrl + [
  if (modifier && event.key === "[") {
    event.preventDefault();
    currentLineHeight = Math.max(currentLineHeight - 0.2, 1);
    parametersTextbox.style.lineHeight = currentLineHeight;
    return;
  }
});
