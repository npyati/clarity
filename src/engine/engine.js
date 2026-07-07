/**
 * AudioEngine — time-addressable voice engine.
 *
 * All public methods take absolute AudioContext timestamps via `when`
 * (0 = now), so a future transport/scheduler drives the identical API
 * that live keyboard/MIDI input uses today.
 *
 * Chord expansion lives HERE: noteOn snapshots the chord (and key-scope
 * state) at call time and returns a NoteHandle capturing every voice, so
 * note-off never recomputes anything — editing the chord while holding a
 * note can no longer strand voices.
 *
 * Node topology:
 *   voices -> busIn -> [compressor?] -> [filter?] -> masterGain -> destination
 * masterGain is permanent (the visualizer taps it once); structure changes
 * rebuild only the busIn..filter section.
 */
import { CHORD_DEFINITIONS } from '../dsl/chords.js';
import { Voice } from './voice.js';
import { createProcessor, roleOf } from './component-factory.js';
import { resolveNumeric } from './resolve.js';
import { smoothSet } from './param.js';
import { ComponentRole } from '../dsl/schemas.js';

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

export function midiToNoteName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[midiNote % 12]}${octave}`;
}

export function midiToFrequency(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export class AudioEngine {
  constructor(audioContext, store, { maxVoices = 32 } = {}) {
    this.audioContext = audioContext;
    this.store = store;
    this.maxVoices = maxVoices;

    // Permanent output stage — the visualizer connects to masterGain once
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(audioContext.destination);

    // Rebuilt-on-structure-change bus section
    this.busIn = null;
    this._busProcessors = []; // [{ name, processor }]
    this._lastFilterRef = null;
    this._lastCompressorRef = null;

    this.voices = new Map();   // voiceId -> Voice
    this.handles = new Map();  // handleId -> NoteHandle
    this._voiceSeq = 0;
    this._handleSeq = 0;
    this.transport = null;

    // Chord intervals from definitions (0 = root, included implicitly)
    this.chordIntervals = { none: [] };
    for (const chord of CHORD_DEFINITIONS) {
      this.chordIntervals[chord.name] = chord.semitones.filter(st => st !== 0);
    }

    this._rebuildBus();
  }

  setTransport(transport) {
    this.transport = transport;
  }

  _time(when) {
    return when && when > 0 ? when : this.audioContext.currentTime;
  }

  // --------------------------------------------------------------------
  // Snapshot application (master chain + live param refresh)
  // --------------------------------------------------------------------

  _masterRefs() {
    const filterRef = this.store.getTriggerAttribute('master', 'filter');
    const compressorRef = this.store.getTriggerAttribute('master', 'compressor');
    return {
      filter: (filterRef && filterRef.type === 'component_ref') ? filterRef.value : null,
      compressor: (compressorRef && compressorRef.type === 'component_ref') ? compressorRef.value : null,
    };
  }

  _rebuildBus() {
    if (this.busIn) {
      this.busIn.disconnect();
      for (const { processor } of this._busProcessors) {
        try { processor.node.disconnect(); } catch (e) { /* fine */ }
      }
    }
    this._busProcessors = [];

    const refs = this._masterRefs();
    this.busIn = this.audioContext.createGain();

    // busIn -> [compressor] -> [filter] -> masterGain
    let tail = this.busIn;
    for (const name of [refs.compressor, refs.filter]) {
      if (!name) continue;
      const component = this.store.getComponent(name);
      if (!component || roleOf(component.type) !== ComponentRole.PROCESSOR) continue;
      const processor = createProcessor(this.audioContext, this.store, component, null);
      if (!processor) continue;
      tail.connect(processor.input);
      tail = processor.output;
      this._busProcessors.push({ name, processor });
    }
    tail.connect(this.masterGain);

    this._lastFilterRef = refs.filter;
    this._lastCompressorRef = refs.compressor;
  }

  /**
   * Apply the (already-parsed) instance store to the running graph.
   * `at` is reserved for quantized application via a transport.
   * Returns whether the bus structure was rebuilt.
   */
  applySnapshot({ at = 0 } = {}) {
    const refs = this._masterRefs();
    const structureChanged =
      refs.filter !== this._lastFilterRef ||
      refs.compressor !== this._lastCompressorRef;

    if (structureChanged) {
      this._rebuildBus();
    } else {
      // Values-only: refresh every bound processor param live
      for (const { name, processor } of this._busProcessors) {
        const component = this.store.getComponent(name);
        if (!component) continue;
        for (const [attrName, param] of Object.entries(processor.params)) {
          const target = resolveNumeric(this.store, component.attributes[attrName], null, param.value);
          if (Math.abs(target - param.value) > 1e-6) {
            smoothSet(this.audioContext, param, target);
          }
        }
      }
    }

    const volume = resolveNumeric(this.store, this.store.getTriggerAttribute('master', 'volume'), null, 80);
    smoothSet(this.audioContext, this.masterGain.gain, Math.max(0, Math.min(1, volume / 100)));

    return structureChanged;
  }

  // --------------------------------------------------------------------
  // Notes and voices
  // --------------------------------------------------------------------

  _chordFrequencies(rootFrequency, noteName) {
    let chordType = this.store.getTriggerAttribute('master', 'chord') || 'none';

    // Note-specific chord overrides the global one; exact name first
    // ('c4'), then wildcard note class ('c')
    let noteChord = this.store.getTriggerAttribute(`note_${noteName}`, 'chord');
    if (!noteChord) {
      noteChord = this.store.getTriggerAttribute(`note_${noteName.replace(/\d+$/, '')}`, 'chord');
    }
    if (noteChord) chordType = noteChord;

    let intervals;
    if (typeof chordType === 'string' && /^[\d\s\-]+$/.test(chordType)) {
      // Custom numeric definition, e.g. "-2 0 1 4 7"
      intervals = chordType.split(/\s+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    } else {
      intervals = this.chordIntervals[chordType] || [];
      if (!intervals.includes(0)) intervals = [0, ...intervals];
    }

    return intervals.map(st => rootFrequency * Math.pow(2, st / 12));
  }

  _componentsForNote(noteScope, keyScope) {
    let components = this.store.getAllComponentsInScope('global');
    const merge = (extra) => {
      const result = { ...components };
      for (const [type, instances] of Object.entries(extra)) {
        result[type] = { ...result[type], ...instances };
      }
      return result;
    };

    // Trigger-scoped components only (no global merge — global processors
    // are patched via master references, not per voice)
    const noteComponents = this.store.getTriggerScopedComponents(noteScope);
    components = merge(noteComponents);
    let keyComponents = {};
    if (keyScope) {
      keyComponents = this.store.getTriggerScopedComponents(keyScope);
      components = merge(keyComponents);
    }

    const scopedProcessors = [];
    for (const scoped of [noteComponents, keyComponents]) {
      for (const instances of Object.values(scoped)) {
        for (const component of Object.values(instances)) {
          if (roleOf(component.type) === ComponentRole.PROCESSOR) {
            scopedProcessors.push(component);
          }
        }
      }
    }

    return { components, scopedProcessors };
  }

  _resumeIfNeeded() {
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /**
   * Start a note (with chord expansion). Returns a NoteHandle.
   * @param {number} midiNote - MIDI note number of the root
   */
  noteOn(midiNote, { velocity = 127, keyScope = null, when = 0 } = {}) {
    this._resumeIfNeeded();
    const t = this._time(when);
    const noteName = midiToNoteName(midiNote);
    const rootFrequency = midiToFrequency(midiNote);
    const frequencies = this._chordFrequencies(rootFrequency, noteName);

    const handle = {
      id: `h${this._handleSeq++}`,
      root: noteName,
      voices: [],
      off: (opts = {}) => this.noteOff(handle, opts),
    };

    frequencies.forEach((frequency, index) => {
      const voiceId = this.voiceOn(noteName, frequency, {
        velocity,
        keyScope,
        when: t,
        isSynthetic: index > 0,
      });
      handle.voices.push({ voiceId, frequency, isRoot: index === 0 });
    });

    this.handles.set(handle.id, handle);
    return handle;
  }

  noteOff(handle, { when = 0 } = {}) {
    if (!handle || !this.handles.has(handle.id)) return;
    const t = this._time(when);
    for (const { voiceId } of handle.voices) {
      this.voiceOff(voiceId, { when: t });
    }
    this.handles.delete(handle.id);
  }

  /**
   * Start a single voice (chord-agnostic). Returns its id.
   */
  voiceOn(noteName, frequency, { velocity = 127, keyScope = null, when = 0, isSynthetic = false } = {}) {
    this._resumeIfNeeded();
    const t = this._time(when);

    // Polyphony cap: steal the oldest voice
    if (this.voices.size >= this.maxVoices) {
      let oldest = null;
      for (const voice of this.voices.values()) {
        if (!oldest || voice.startTime < oldest.startTime) oldest = voice;
      }
      if (oldest) {
        oldest.stop(this.audioContext.currentTime);
        this.voices.delete(oldest.id);
      }
    }

    const noteScope = `note_${noteName}`;
    const { components, scopedProcessors } = this._componentsForNote(noteScope, keyScope);

    const voice = new Voice(this.audioContext, this.store, {
      id: `v${this._voiceSeq++}`,
      noteName,
      frequency,
      velocity,
      noteScope,
      keyScope,
      components,
      scopedProcessors,
      isSynthetic,
      onEnded: (v) => this.voices.delete(v.id),
    });

    voice.start(this.busIn, t);
    this.voices.set(voice.id, voice);
    return voice.id;
  }

  voiceOff(voiceId, { when = 0 } = {}) {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    voice.release(this._time(when));
    // The voice deletes itself from the map when it actually ends
  }

  allOff({ when = 0 } = {}) {
    const t = this._time(when);
    for (const voice of this.voices.values()) {
      voice.release(t);
    }
    this.handles.clear();
  }

  /**
   * Info for the note display: currently sounding voices.
   */
  activeVoiceInfo() {
    const info = [];
    for (const voice of this.voices.values()) {
      if (!voice._released) {
        info.push({ frequency: voice.frequency, isSynthetic: voice.isSynthetic });
      }
    }
    return info.sort((a, b) => a.frequency - b.frequency);
  }
}

// Global instance (window.audioEngine is the visualizer bridge)
let audioEngine = null;

function initializeAudioEngine(audioContext, store) {
  audioEngine = new AudioEngine(audioContext, store);
  window.audioEngine = audioEngine;
  console.log('Audio engine initialized');
  return audioEngine;
}

export { audioEngine, initializeAudioEngine };
