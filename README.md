# Clarity

A text-based polyphonic synthesizer for the browser. Define your instrument by editing structured text that dynamically generates the user interface.

## Quick Start

1. Open `index.html` in a web browser
2. Edit the text in the left pane to configure your synthesizer
3. Use controls in the right pane or play with your keyboard

## Text Syntax

Clarity uses a simple indented text format to define your instrument. Non-indented lines define sections, and indented lines (2 spaces) define parameters within those sections.

### Oscillators

Define oscillators to create the sound:

```
oscillator main
  wave sine
  octave 0
  detune 0
  volume 50
  attack time 100
  sustain level 80
  release time 500
```

**Parameters:**
- `wave` - Waveform type: sine, square, sawtooth, triangle
- `octave` - Octave offset: -2 to 2
- `detune` - Fine pitch adjustment in cents: -100 to 100 (100 cents = 1 semitone)
- `volume` - Volume level: 0 to 100
- `attack time` - Attack time in milliseconds
- `sustain level` - Sustain level: 0 to 100
- `release time` - Release time in milliseconds

### LFOs (Low Frequency Oscillators)

Create modulation sources:

```
lfo vibrato
  rate 5
  depth 20
  wave sine
```

**Parameters:**
- `rate` - LFO frequency in Hz
- `depth` - Modulation depth in cents
- `wave` - LFO waveform: sine, square, sawtooth, triangle

**Apply to oscillators:**
```
oscillator main
  wave sine
  pitch vibrato
```

### Global Settings

Global settings use section-based syntax with indented parameters.

**Master Volume:**
```
master
  volume 80
```

**Envelope (applies to all notes):**
```
envelope
  attack time 100
  sustain level 100
  release time 500
```

**Compressor:**
```
compressor
  threshold -20
  ratio 12
  knee 30
  attack 0.003
  release 0.25
```

**Global Settings (chord and detune):**
```
global
  chord major
  detune 0
```

- **chord** - Available chords: none, major, minor, sus2, sus4, maj7, min7, dom7, dim, aug
- **detune** - Global tuning offset in cents: -100 to 100 (affects all oscillators)

### Note-Specific Configuration

Apply settings to specific notes or note classes:

```
note c4
  pitch vibrato

note c d e
  chord major
```

### Key Definitions

Define special keys that apply modulation when held:

```
key f
  pitch vibrato
```

When you press and hold the F key (highlighted in orange), it applies the vibrato LFO to any notes you play. Release F to remove the modulation.

**Behavior:**
- Keys with definitions don't play notes themselves
- They act as real-time modulation controls
- Apply/remove LFOs to ongoing notes dynamically
- Multiple keys can be defined with different LFOs

### Variables

Create reusable values:

```
variable attack 150
variable release 800

oscillator main
  attack time attack
  release time release
```

## Playing Notes

### Virtual Keyboard

Click the virtual keyboard panel and use your computer keyboard:

**Bottom row (Z-/):** C3 to A3 (chromatic)
**Home row (A-;):** A#3 to G4 (chromatic)
**Top row (Q-P):** G#4 to E5 (chromatic)
**Number row (1-0):** F#5 to D#6 (chromatic)

### MIDI Support

Connect a MIDI controller and it will work automatically.

## Features

### Polyphonic Playback
Play multiple notes simultaneously with independent envelopes.

### Dynamic UI Generation
The right pane updates in real-time as you edit the text.

### Syntax Highlighting
Keywords, values, and parameters are color-coded for easy reading.

### Command Palette
Press `/` in the text editor to open the command palette for quick actions.

### Keyboard Shortcuts
- Arrow keys: Navigate between lines
- Cmd/Ctrl + Up/Down: Increment/decrement numeric values
- Shift + Cmd/Ctrl + Up/Down: Increment/decrement by 10

## Example Configurations

### Simple Sine Wave
```
oscillator main
  wave sine
  volume 50
```

### Pad with Vibrato
```
lfo vibrato
  rate 5
  depth 15
  wave sine

oscillator main
  wave sine
  pitch vibrato
  volume 50
  attack time 800
  release time 1200
```

### Detuned Saw Stack
```
oscillator saw1
  wave sawtooth
  octave 0
  detune -10
  volume 40

oscillator saw2
  wave sawtooth
  octave 0
  detune 10
  volume 40

oscillator saw3
  wave sawtooth
  octave -1
  volume 30
```

### Dynamic Vibrato Control
```
lfo vibrato
  rate 6
  depth 25
  wave sine

key f
  pitch vibrato

oscillator main
  wave sine
  volume 50
```

Now hold F while playing other keys to add vibrato in real-time!

## Tips

1. **Start Simple:** Begin with one oscillator and add complexity gradually
2. **Use Variables:** Define common values once and reuse them
3. **Layer Sounds:** Combine multiple oscillators at different octaves
4. **Experiment with LFOs:** Try different rates and depths for various effects
5. **Use Key Definitions:** Create expressive performance controls
6. **Save Your Work:** Copy the text to save your instrument configurations

## Browser Compatibility

Clarity uses the Web Audio API and works best in:
- Chrome/Edge (recommended)
- Firefox
- Safari
