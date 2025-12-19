# Clarity - New Architecture

## Overview

The new architecture implements a **generic, schema-driven system** that eliminates hard-coded component logic. The system is based on **4 element types** (Triggers, Components, Attributes, Variables) with clear nesting rules and scope semantics.

## Architecture Files

### 1. **schemas.js** - Component and Attribute Schemas
Defines all component types (oscillator, lfo, envelope, filter, compressor) and their attributes with:
- Type system (number, enum, percentage, time, frequency, component references)
- Validation rules (min, max, step, allowed values)
- UI hints (control type, labels)
- Modulation routing rules (what can modulate what)

Key features:
- `COMPONENT_SCHEMAS` - All component type definitions
- `TRIGGER_SCHEMAS` - Trigger definitions (master, note, key)
- `SchemaUtils` - Helper functions for schema access
- `initializeChordValues()` - Populates chord enum from chords.js

### 2. **instance-store.js** - Scope-Based Instance Storage
Manages all component instances and variables with scope awareness:
- Organizes components by scope (global, master, note, key)
- Tracks variable values and overrides
- Name registry for uniqueness validation
- Scope resolution for variable lookups

Key features:
- `instanceStore.addComponent()` - Create component instance
- `instanceStore.addVariable()` - Create variable
- `instanceStore.setVariableOverride()` - Override variable in scope
- `instanceStore.resolveVariable()` - Resolve with scope chain
- `instanceStore.getAllComponentsInScope()` - Get all available components

### 3. **parser.js** - Generic Parser
Parses document text and builds instance store:
- Recognizes 4 element types by syntax
- Handles indentation for scope nesting
- Resolves references (values, variables, components)
- Schema-driven validation

Syntax recognition:
- `variable [name] = [value]` → Variable
- `master|note|key [name]` → Trigger
- `[componentType] [name]` → Component
- `[attrName] [value]` → Attribute

Key features:
- `parser.parse(text)` - Main parse function
- Returns errors and warnings
- Builds complete instance store from text

### 4. **audio-engine.js** - Generic Audio Engine
Creates Web Audio nodes from instance store:
- Generic component instantiation based on type
- Automatic modulation routing from attribute references
- Scope-aware note creation
- Variable resolution

Key features:
- `audioEngine.initializeMaster()` - Create master chain
- `audioEngine.createNote(name, freq, keyScope)` - Create note
- `NoteInstance` class - Manages oscillators, envelopes, LFOs per note
- Automatic pitch modulation via LFO references
- Master envelope application

### 5. **ui-generator.js** - Generic UI Generation
Generates UI controls dynamically from schemas:
- Iterates instance store to create sections
- Schema-driven control generation (sliders, dropdowns, etc.)
- Shows variable references
- Updates instance store on interaction

Key features:
- `uiGenerator.generateUI(container)` - Generate full UI
- Automatic control type selection based on attribute schema
- Variable reference display
- Component reference dropdowns

## Element Types

### 1. **Triggers** (Scope Creators)
Define where components and variables exist:
- `master` - Special global scope with attributes
- `note [name]` - Note-specific scope (e.g., `note c4`)
- `key [char]` - Key-triggered scope (e.g., `key a`)

Can contain:
- Components (create scoped instances)
- Attributes (for `master` only)
- Variable overrides

### 2. **Components** (Functional Units)
Audio processing units:
- `oscillator [name]` - Sound source
- `lfo [name]` - Low frequency modulator
- `envelope [name]` - ADSR envelope
- `filter [name]` - Audio filter
- `compressor [name]` - Dynamic compressor

Can contain:
- Attributes only (not other components)

### 3. **Attributes** (Properties)
Shape components:
- Direct values: `wave sawtooth`
- Variable references: `volume my_volume`
- Component references: `pitch vibrato` (modulation)

### 4. **Variables** (Indirection Layer)
Reusable values with scope overrides:
- Syntax: `variable [name] = [value]`
- Can be overridden in nested scopes
- Enable flexible parameter control

## Nesting Rules

```
Trigger (master, note, key)
├── Component (oscillator, lfo, envelope, filter, compressor)
│   └── Attribute (wave, pitch, volume, etc.)
├── Attribute (master only - volume, attack, etc.)
└── Variable override
```

Key rules:
- **Components cannot nest inside components** - they reference via attributes
- **Triggers create scope** for components and variables
- **Indentation defines scope hierarchy**

## Example Document

```
# Variables for easy control
variable vibrato_depth = 30
variable vibrato_rate = 5

# Components
oscillator lead
  wave sawtooth
  pitch vibrato     # References LFO component
  volume 70

lfo vibrato
  rate vibrato_rate  # References variable
  depth vibrato_depth
  wave sine

filter main
  frequency 2000

master
  volume 80
  filter main       # References filter component

# Note-specific overrides
note c4
  variable vibrato_depth = 50   # Override variable for C4

# Key-triggered changes
key a
  variable vibrato_depth = 100  # More vibrato when 'a' is held
```

## Scope Resolution

**Variable Resolution:**
1. Check trigger-specific override (e.g., `key_a`)
2. Check trigger-specific definition
3. Check global scope
4. Use attribute default

**Component References:**
- Components are globally unique (no shadowing)
- Note-scoped components can reference global components
- Global components cannot reference trigger-scoped variables

## Benefits

### ✅ **Extensibility**
- Add new component types: define schema only
- Add new attributes: update schema, no code changes
- Add new triggers: follow same pattern

### ✅ **Flexibility**
- Variables enable complex parameter control
- Scope-based overrides without duplication
- Target-based modulation routing (component owns connections)

### ✅ **Maintainability**
- Single source of truth (schemas)
- No hard-coded component logic
- Generic parsing, audio, and UI code

### ✅ **Readability**
- Natural language syntax
- Clear hierarchy via indentation
- No code-y keywords

## Testing

Open `test-integration.html` in a browser to:
1. See the parser process example document
2. View generated UI from instance store
3. Play test notes with the audio engine
4. Inspect debug output

## Migration Path

The new architecture is complete and functional. To migrate the full application:

1. **Update script.js** to use new systems:
   - Replace `syncUIFromText()` with `parser.parse()` + `uiGenerator.generateUI()`
   - Replace `Note` class with `audioEngine.createNote()`
   - Replace hard-coded UI functions with generic generation

2. **Update text editor integration**:
   - Call `parser.parse()` on document change
   - Regenerate UI from instance store
   - Update audio engine configuration

3. **Preserve existing features**:
   - MIDI input handling
   - Keyboard mapping
   - Command palette
   - Syntax highlighting

4. **Testing**:
   - Verify all existing documents parse correctly
   - Test audio playback matches current behavior
   - Validate UI generation

## Future Enhancements

With this architecture, future additions are straightforward:

- **New component types**: Add schema, audio node factory
- **New modulation targets**: Update schema `acceptsModulation`
- **New triggers**: Add to `TRIGGER_SCHEMAS`
- **Complex routing**: Extend attribute types
- **User-defined components**: Make schemas dynamic

The system is designed for growth without complexity.
