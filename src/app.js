/**
 * Clarity — application shell.
 *
 * Wires the CodeMirror editor (src/editor/), the DSL pipeline (src/dsl/),
 * the audio engine (src/engine/), and the generated instrument panel
 * (src/ui/) together. The document text is the single source of truth:
 * edits parse into the instance store, which drives both the panel and
 * the audio engine; panel edits write back into the text.
 */
import { CHORD_DEFINITIONS } from './dsl/chords.js';
import { SEED_DOCUMENT } from './seed-document.js';
import { COMPONENT_SCHEMAS, TRIGGER_SCHEMAS, initializeChordValues } from './dsl/schemas.js';
import { instanceStore } from './dsl/instance-store.js';
import { parser, initializeParser } from './dsl/parser.js';
import { uiGenerator, initializeUIGenerator } from './ui/panel.js';
import { waveformVisualizer, initializeVisualizer } from './ui/visualizer.js';
import { audioEngine, initializeAudioEngine } from './engine/audio-engine.js';
import { createEditor, uiEditAnnotation } from './editor/editor.js';
import { makeIncrementKeymap } from './editor/increment.js';
import { buildCommands, setupPalette } from './editor/palette.js';
import { clarityDiagnostics } from './editor/diagnostics.js';
import { changeFontSize, changeLineHeight } from './editor/appearance.js';

// ============================================================================
// BOOTSTRAP
// ============================================================================

let audioContext;
let polyphonyManager;
let editorView = null;

function initializeNewArchitecture() {
  initializeChordValues();
  buildChordIntervals();
  initializeParser();
  initializeUIGenerator();
  initializeAudioEngine(audioContext);
  console.log('New architecture initialized');
}

// Chord interval definitions (built from CHORD_DEFINITIONS in chords.js)
let CHORD_INTERVALS = {};

function buildChordIntervals() {
  CHORD_INTERVALS = { 'none': [] };
  CHORD_DEFINITIONS.forEach(chord => {
    // Extract intervals (excluding root note at 0)
    const intervals = chord.semitones.filter(st => st !== 0);
    CHORD_INTERVALS[chord.name] = intervals;
  });
}

// ============================================================================
// DOCUMENT PERSISTENCE
// ============================================================================

const DOC_STORAGE_KEY = 'clarity.doc';

// Autosave is best-effort; the text itself is the source of truth, so a
// restored document with errors is shown with inline markers, never discarded
function autosaveDocument(text) {
  try {
    localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify({
      version: 1,
      text,
      savedAt: Date.now(),
    }));
  } catch (e) {
    // Storage full or denied — keep playing without persistence
  }
}

function loadSavedDocument() {
  try {
    const raw = localStorage.getItem(DOC_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return typeof saved.text === 'string' ? saved.text : null;
  } catch (e) {
    console.warn('Saved document unreadable, starting from seed:', e);
    return null;
  }
}

// ============================================================================
// PARSE/APPLY PIPELINE
// ============================================================================
// The editor calls scheduleSync() on text changes. Parsing and applying
// stay distinct so a future transport can quantize the apply step.

const SYNC_DEBOUNCE_MS = 60;
let syncTimer = null;
let lastParseResult = null;

function getDocumentText() {
  return editorView ? editorView.state.doc.toString() : '';
}

function getSourceMap() {
  return lastParseResult ? lastParseResult.sourceMap : null;
}

// Debounced full sync — coalesces rapid keystrokes into one parse + apply
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncUIFromText();
  }, SYNC_DEBOUNCE_MS);
}

// Surface parse errors in the status strip under the editor
function updateParseStatus(result) {
  const statusEl = document.getElementById('parse-status');
  if (!statusEl) return;

  const errors = result.errors || [];
  if (errors.length === 0) {
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
  } else {
    statusEl.classList.remove('hidden');
    const shown = errors.slice(0, 3).map(e => `line ${e.line}: ${e.message}`);
    const more = errors.length > 3 ? `  (+${errors.length - 3} more)` : '';
    statusEl.textContent = shown.join('   ·   ') + more;
  }
}

// Apply a parse result to the UI and audio engine
function applyParseResult(result, { rebuildUI = true } = {}) {
  lastParseResult = result;

  if (!result.success) {
    console.error('Parse errors:', result.errors);
    // Still continue to show UI even with errors
  }
  if (result.warnings.length > 0) {
    console.warn('Parse warnings:', result.warnings);
  }

  updateParseStatus(result);

  if (rebuildUI) {
    updateFocusedPanel();
  }

  if (audioEngine) {
    const masterRebuilt = audioEngine.initializeMaster();

    // Reconnect the visualizer only when the master chain was actually
    // torn down — a values-only edit must not churn nodes mid-note
    if (masterRebuilt && waveformVisualizer && audioEngine.audioContext.state === 'running') {
      waveformVisualizer.isConnected = false;
      waveformVisualizer.ensureConnected();
    }
  }
}

// Sync just the store and audio engine from text (no panel rebuild)
// Used for value changes so sliders keep focus while dragging
function syncStoreFromText() {
  if (!parser) return;
  const text = getDocumentText();
  autosaveDocument(text);
  applyParseResult(parser.parse(text), { rebuildUI: false });
}

// Full sync: store, audio engine, and instrument panel
function syncUIFromText() {
  if (!parser || !uiGenerator) return;
  const text = getDocumentText();
  autosaveDocument(text);
  applyParseResult(parser.parse(text), { rebuildUI: true });
}

// ============================================================================
// FOCUSED INSTRUMENT PANEL
// ============================================================================
// The panel shows controls for the component/trigger under the cursor,
// resolved through the parser's source map (no ad-hoc text re-parsing).

function focusedContextForLine(lineNumber) {
  const sourceMap = getSourceMap();
  if (!sourceMap) return null;

  let node = sourceMap.lineToNode(lineNumber);
  if (!node) return null;

  // Attribute/modulation lines focus their owning component/trigger
  if ((node.kind === 'attribute' || node.kind === 'modulation') && node.owner) {
    node = node.owner.kind === 'component'
      ? { kind: 'component', type: node.owner.type, name: node.owner.name }
      : { kind: 'trigger', type: node.owner.type, scopeKey: node.owner.scopeKey };
  }

  if (node.kind === 'component') {
    return { type: 'component', componentType: node.type, name: node.name };
  }

  if (node.kind === 'trigger') {
    const name = node.scopeKey === 'master'
      ? ''
      : node.scopeKey.replace(/^(note|key)_/, '');
    return { type: 'trigger', triggerType: node.type, name };
  }

  if (node.kind === 'variable') {
    // Group consecutive variable lines (blank lines break the group)
    const sourceMapLines = sourceMap.lines;
    const variableGroup = [];
    let start = lineNumber;
    while (sourceMapLines.get(start - 1)?.kind === 'variable') start--;
    for (let ln = start; sourceMapLines.get(ln)?.kind === 'variable'; ln++) {
      variableGroup.push(sourceMapLines.get(ln).name);
    }
    return { type: 'trigger', triggerType: 'variable', name: node.name, variableGroup };
  }

  return null;
}

function updateFocusedPanel() {
  const container = document.getElementById('oscillators-container');
  if (!container || !uiGenerator) return;

  const line = editorView
    ? editorView.state.doc.lineAt(editorView.state.selection.main.head).number
    : 1;
  const context = focusedContextForLine(line);

  uiGenerator.setUpdatingFromText(true);
  if (context) {
    uiGenerator.generateFocusedUI(container, context);
  } else {
    uiGenerator.generateUI(container);
  }
  uiGenerator.setUpdatingFromText(false);
}

// ============================================================================
// PANEL -> TEXT WRITE-BACK
// ============================================================================
// Bridge for the UI generator: a control change becomes a text edit at the
// line the source map points to. The transaction is annotated so the sync
// pipeline skips panel regeneration (the slider must not be rebuilt
// mid-drag).

window.updateTextFromUIChange = function(componentOrTrigger, name, attribute, value) {
  const sourceMap = getSourceMap();
  if (!editorView || !sourceMap) return false;

  let line = null;
  if (componentOrTrigger === 'variable') {
    line = sourceMap.nodeToLine({ kind: 'variable', name });
  } else {
    const isTrigger = componentOrTrigger in TRIGGER_SCHEMAS;
    const owner = isTrigger
      ? { kind: 'trigger', scopeKey: componentOrTrigger === 'master' ? 'master' : `${componentOrTrigger}_${name}` }
      : { kind: 'component', name };
    line = sourceMap.nodeToLine({ kind: 'attribute', attribute, owner });
  }

  if (line === null) {
    console.warn('Could not locate line to update:', componentOrTrigger, name, attribute);
    return false;
  }

  const docLine = editorView.state.doc.line(line);
  let newText;
  if (componentOrTrigger === 'variable') {
    const metadata = instanceStore.getVariableMetadata(name);
    newText = `variable ${name} = ${value}`;
    if (metadata && metadata.min !== null && metadata.max !== null) {
      newText += ` [${metadata.min}, ${metadata.max}]`;
    }
  } else {
    const indent = /^\s*/.exec(docLine.text)[0];
    newText = `${indent}${attribute} ${value}`;
  }

  editorView.dispatch({
    changes: { from: docLine.from, to: docLine.to, insert: newText },
    annotations: uiEditAnnotation.of(true),
  });
  return true;
};

// ============================================================================
// POLYPHONY
// ============================================================================

class PolyphonyManager {
  constructor() {
    this.activeNotes = new Map();
  }

  startNote(frequency, noteId, velocity = 127, isSynthetic = false, midiNote = null, keyChar = null) {
    if (this.activeNotes.has(noteId)) {
      this.stopNote(noteId);
    }

    // Resume audio context if suspended (required by browser autoplay policies)
    if (audioEngine && audioEngine.audioContext.state === 'suspended') {
      audioEngine.audioContext.resume().then(() => {
        if (waveformVisualizer) {
          waveformVisualizer.ensureConnected();
        }
      });
    } else if (waveformVisualizer) {
      waveformVisualizer.ensureConnected();
    }

    // Convert MIDI note or frequency to note name (e.g., 'c4')
    const noteName = midiNote ? midiNoteToNoteName(midiNote) : frequencyToNoteName(frequency).toLowerCase();

    // Determine key scope if a key is held
    const keyScope = keyChar ? `key_${keyChar}` : null;

    // Create note using audio engine
    const note = audioEngine ? audioEngine.createNote(noteName, frequency, keyScope) : null;

    if (note) {
      note.isSynthetic = isSynthetic;
      this.activeNotes.set(noteId, note);
    }

    updateNoteDisplay();
  }

  stopNote(noteId) {
    const note = this.activeNotes.get(noteId);
    if (note && audioEngine) {
      audioEngine.stopNote(note);
      this.activeNotes.delete(noteId);
      updateNoteDisplay();
    }
  }

  stopAllNotes() {
    if (audioEngine) {
      this.activeNotes.forEach((note) => audioEngine.stopNote(note));
    }
    this.activeNotes.clear();
    updateNoteDisplay();
  }
}

// ============================================================================
// CHORDS
// ============================================================================

// Calculate all frequencies for a chord based on root frequency
function getChordFrequencies(rootFrequency, midiNote = null) {
  // Get chord type from master trigger attributes (defaults to 'none')
  let chordType = instanceStore ? instanceStore.getTriggerAttribute('master', 'chord') : null;
  if (!chordType) {
    chordType = 'none';
  }

  // Check for note-specific chord config (overrides global)
  if (midiNote !== null) {
    const noteName = midiNoteToNoteName(midiNote); // e.g., "c4"

    // Check for note-specific chord in instance store
    let noteScope = `note_${noteName}`;
    let noteChord = instanceStore ? instanceStore.getTriggerAttribute(noteScope, 'chord') : null;

    // If not found, check for wildcard match (note name without octave)
    if (!noteChord) {
      const noteNameWithoutOctave = noteName.replace(/\d+$/, ''); // e.g., "c4" -> "c"
      noteScope = `note_${noteNameWithoutOctave}`;
      noteChord = instanceStore ? instanceStore.getTriggerAttribute(noteScope, 'chord') : null;
    }

    // If note-specific chord is defined, use it
    if (noteChord) {
      chordType = noteChord;
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
  return intervals.map(semitones => rootFrequency * Math.pow(2, semitones / 12));
}

// ============================================================================
// NOTE DISPLAY
// ============================================================================

// Convert frequency to note name (e.g., 440Hz -> A4)
function frequencyToNoteName(frequency) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midiNote = Math.round(12 * Math.log2(frequency / 440) + 69);
  const octave = Math.floor(midiNote / 12) - 1;
  return `${noteNames[midiNote % 12]}${octave}`;
}

// Convert MIDI note number to note name (e.g., 60 -> c4)
function midiNoteToNoteName(midiNote) {
  const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const octave = Math.floor(midiNote / 12) - 1;
  return `${noteNames[midiNote % 12]}${octave}`;
}

// Update the note display to show currently playing notes
function updateNoteDisplay() {
  const noteDisplayText = document.getElementById('note-display-text');
  if (!noteDisplayText) return;

  if (polyphonyManager.activeNotes.size === 0) {
    noteDisplayText.textContent = '--';
    return;
  }

  // Display all currently active notes (for polyphony), sorted by frequency
  const notes = Array.from(polyphonyManager.activeNotes.values())
    .sort((a, b) => a.frequency - b.frequency);

  // Root notes in teal, synthetic (chord) notes in muted gray
  const noteHTML = notes.map(note => {
    const noteName = frequencyToNoteName(note.frequency);
    return note.isSynthetic
      ? `<span style="color: #969896;">${noteName}</span>`
      : `<span style="color: #5fd3bc;">${noteName}</span>`;
  }).join(' <span style="color: #969896;">+</span> ');

  noteDisplayText.innerHTML = noteHTML;
}

// ============================================================================
// MIDI INPUT
// ============================================================================

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
      polyphonyManager.stopNote(`midi-${note}-${index}`);
    });
  }
}

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess()
    .then((midiAccess) => {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = handleMIDIMessage;
      }
    })
    .catch((err) => console.error('Failed to get MIDI access:', err));
}

// ============================================================================
// VIRTUAL KEYBOARD (computer keyboard as instrument)
// ============================================================================

const activeKeys = new Set();
const activeModifierKeys = new Set(); // Keys with trigger definitions act as modifiers

// Keyboard to MIDI note mapping - chromatic layout starting from C3
const keyToNote = {
  'z': 48,  'x': 49,  'c': 50,  'v': 51,  'b': 52,  'n': 53,  'm': 54,  ',': 55,  '.': 56,  '/': 57,
  'a': 58,  's': 59,  'd': 60,  'f': 61,  'g': 62,  'h': 63,  'j': 64,  'k': 65,  'l': 66,  ';': 67,
  'q': 68,  'w': 69,  'e': 70,  'r': 71,  't': 72,  'y': 73,  'u': 74,  'i': 75,  'o': 76,  'p': 77,
  '1': 78,  '2': 79,  '3': 80,  '4': 81,  '5': 82,  '6': 83,  '7': 84,  '8': 85,  '9': 86,  '0': 87
};

document.addEventListener('click', (e) => {
  if (e.target.id === 'virtual-keyboard' || e.target.closest('#virtual-keyboard')) {
    const keyboard = document.getElementById('virtual-keyboard');
    if (keyboard) keyboard.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'virtual-keyboard' || !polyphonyManager) return;

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
    if (keyElement) keyElement.classList.add('active');

    // Check if this key has trigger definition (makes it a modifier key)
    const keyScope = `key_${key}`;
    const hasActions = instanceStore ? instanceStore.collectActions(keyScope).length > 0 : false;

    if (hasActions) {
      // This is a modifier key - track it but don't play notes
      activeModifierKeys.add(key);
      return;
    }

    // This is a note-playing key - get active modifier if any
    const activeModifier = activeModifierKeys.size > 0
      ? `key_${activeModifierKeys.values().next().value}`
      : null;

    // Play the note - actions from activeModifier will be applied automatically
    const rootFrequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    const frequencies = getChordFrequencies(rootFrequency, midiNote);

    frequencies.forEach((freq, index) => {
      const noteId = `keyboard-${key}-${index}`;
      const isSynthetic = index > 0; // First note (index 0) is root, rest are synthetic
      polyphonyManager.startNote(freq, noteId, 100, isSynthetic, midiNote, activeModifier ? activeModifier.slice(4) : null);
    });
  }
});

document.addEventListener('keyup', (e) => {
  if (e.target.id !== 'virtual-keyboard' || !polyphonyManager) return;

  const key = e.key.toLowerCase();
  const midiNote = keyToNote[key];

  if (midiNote !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    activeKeys.delete(key);

    // Remove highlight from the key
    const keyElement = document.querySelector(`.key-label[data-key="${key}"]`);
    if (keyElement) keyElement.classList.remove('active');

    // Check if this was a modifier key
    const keyScope = `key_${key}`;
    const hasActions = instanceStore ? instanceStore.collectActions(keyScope).length > 0 : false;

    if (hasActions) {
      activeModifierKeys.delete(key);
      return;
    }

    // Stop the notes for regular keys
    const rootFrequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    const frequencies = getChordFrequencies(rootFrequency, midiNote);

    frequencies.forEach((freq, index) => {
      polyphonyManager.stopNote(`keyboard-${key}-${index}`);
    });
  }
});

document.addEventListener('blur', (e) => {
  if (e.target.id === 'virtual-keyboard' && polyphonyManager) {
    polyphonyManager.stopAllNotes();
    activeKeys.forEach(key => {
      const keyElement = document.querySelector(`.key-label[data-key="${key}"]`);
      if (keyElement) keyElement.classList.remove('active');
    });
    activeKeys.clear();
    activeModifierKeys.clear();
  }
}, true);

// ============================================================================
// EDITOR INTEGRATION
// ============================================================================

let cursorSyncTimer = null;

function onDocChanged(update) {
  const fromPanel = update.transactions.some(tr => tr.annotation(uiEditAnnotation));
  if (fromPanel) {
    // Value edit from a panel control: update store + audio immediately,
    // never rebuild the panel (the control being dragged must survive)
    syncStoreFromText();
  } else {
    scheduleSync();
  }
}

function onCursorLine(lineNumber, update) {
  const fromPanel = update.transactions.some(tr => tr.annotation(uiEditAnnotation));
  if (fromPanel) return;
  if (update.docChanged) return; // scheduleSync's full sync rebuilds the panel

  // Don't regenerate the panel out from under an active control
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.type === 'range' || activeEl.tagName === 'INPUT')) return;

  if (cursorSyncTimer) clearTimeout(cursorSyncTimer);
  cursorSyncTimer = setTimeout(() => {
    cursorSyncTimer = null;
    updateFocusedPanel();
  }, 100);
}

function focusVirtualKeyboard() {
  const keyboard = document.getElementById('virtual-keyboard');
  if (keyboard) keyboard.focus();
  return true;
}

function createAppEditor(initialDoc) {
  const host = document.getElementById('parameters');

  const appCommands = [
    {
      name: 'Reset to Seed Document',
      description: 'Discard the saved document and restore the built-in example',
      run: (view) => {
        try {
          localStorage.removeItem(DOC_STORAGE_KEY);
        } catch (e) {
          // Storage denied — still rebuild from seed
        }
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: SEED_DOCUMENT },
        });
      },
    },
    {
      name: 'Increase Text Size',
      description: 'Make the editor text larger',
      run: (view) => changeFontSize(view, 1),
    },
    {
      name: 'Decrease Text Size',
      description: 'Make the editor text smaller',
      run: (view) => changeFontSize(view, -1),
    },
    {
      name: 'Increase Line Spacing',
      description: 'Add vertical space between lines',
      run: (view) => changeLineHeight(view, 0.1),
    },
    {
      name: 'Decrease Line Spacing',
      description: 'Reduce vertical space between lines',
      run: (view) => changeLineHeight(view, -0.1),
    },
  ];

  const paletteKeymap = setupPalette(() => editorView, buildCommands(appCommands));

  editorView = createEditor({
    parent: host,
    doc: initialDoc,
    onDocChanged,
    onCursorLine,
    extensions: clarityDiagnostics(() => lastParseResult),
    extraKeymap: [
      ...paletteKeymap,
      ...makeIncrementKeymap(getSourceMap),
      { key: 'Mod-k', run: focusVirtualKeyboard },
      { key: 'Mod-=', run: (view) => { changeFontSize(view, 1); return true; } },
      { key: 'Mod--', run: (view) => { changeFontSize(view, -1); return true; } },
      { key: 'Mod-]', run: (view) => { changeLineHeight(view, 0.1); return true; } },
      { key: 'Mod-[', run: (view) => { changeLineHeight(view, -0.1); return true; } },
    ],
  });

  return editorView;
}

// ============================================================================
// STARTUP
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('DOM loaded, initializing...');

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    initializeNewArchitecture();

    // Visualizer connects to the engine's master output
    initializeVisualizer();

    polyphonyManager = new PolyphonyManager();

    const saved = loadSavedDocument();
    createAppEditor(saved !== null ? saved : SEED_DOCUMENT);
    window.clarityEditor = editorView; // debug/e2e handle

    // First parse + panel + audio configuration
    syncUIFromText();

    console.log('Initialization complete!');
  } catch (error) {
    console.error('Error during initialization:', error);
    console.error('Stack trace:', error.stack);
  }
});
