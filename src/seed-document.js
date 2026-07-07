/**
 * Seed document — the instrument users see on first launch, and the
 * fixture the test suite parses. If a DSL change breaks this document,
 * CI fails.
 *
 * (note-specific overrides are not working yet in the parser;
 * will return as: note c4 with variable vibrato_depth = 40)
 */
const SEED_DOCUMENT_LINES = [
  'variable vibrato_depth = 20',
  'variable vibrato_rate = 5',
  '',
  'variable lead_volume = 60',
  'variable bass_volume = 40',
  '',
  'oscillator lead',
  '  wave triangle',
  '  octave 0',
  '  volume lead_volume',
  '  pitch 0',
  '    modulation vibrato',
  '',
  'oscillator bass',
  '  wave sine',
  '  octave -1',
  '  volume bass_volume',
  '',
  // LFO for vibrato (order doesn't matter - parser handles forward references)
  'lfo vibrato',
  '  rate vibrato_rate + 2',
  '  depth vibrato_depth * 0.5',
  '  wave sine',
  '',
  'master',
  '  volume 80',
  '  attack 10',
  '  sustain 100',
  '  release 500',
  '',
];

const SEED_DOCUMENT = SEED_DOCUMENT_LINES.join('\n');

export { SEED_DOCUMENT_LINES, SEED_DOCUMENT };
