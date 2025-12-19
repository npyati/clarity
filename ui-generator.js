/**
 * ============================================================================
 * GENERIC UI GENERATOR
 * ============================================================================
 *
 * Generates UI controls dynamically from schemas and instance store.
 * Replaces hard-coded createXXXSection functions.
 */

class UIGenerator {
  constructor(store, schemas) {
    this.store = store;
    this.schemas = schemas;
    this.isUpdatingFromText = false;
  }

  /**
   * Generate entire UI panel from instance store
   * @param {HTMLElement} container - Container element for UI
   */
  generateUI(container) {
    // Clear container
    container.innerHTML = '';

    // Generate master section
    this._generateMasterSection(container);

    // Generate global components
    this._generateGlobalComponents(container);

    // Generate variables section (if any)
    this._generateVariablesSection(container);

    // Generate note-specific sections
    this._generateNoteScopes(container);

    // Generate key-specific sections
    this._generateKeyScopes(container);
  }

  /**
   * Generate focused UI for a specific component or trigger
   * @param {HTMLElement} container - Container element for UI
   * @param {Object} context - Current context { type, componentType/triggerType, name }
   */
  generateFocusedUI(container, context) {
    // Clear container
    container.innerHTML = '';

    if (!context) {
      // No context - leave blank
      return;
    }

    if (context.type === 'component') {
      // Find the component
      const component = this.store.getComponent(context.name);
      if (component) {
        const section = this._createComponentSection(component);
        if (section) {
          container.appendChild(section);
        }
      }
    } else if (context.type === 'trigger') {
      if (context.triggerType === 'master') {
        // Generate master section
        this._generateMasterSection(container);
      } else if (context.triggerType === 'variable') {
        // Generate variable control (single or group)
        this._generateSingleVariable(container, context);
      } else {
        // Generate trigger section (note or key)
        const scopeKey = context.name ? `${context.triggerType}_${context.name}` : context.triggerType;
        const section = this._createTriggerSection(scopeKey, context.triggerType);
        if (section) {
          container.appendChild(section);
        }
      }
    }
  }

  /**
   * Generate control for a single variable (or its group)
   */
  _generateSingleVariable(container, context) {
    const varName = context.name;
    const variableGroup = context.variableGroup || [varName];

    console.log(`_generateSingleVariable called for ${varName}, group:`, variableGroup);

    if (variableGroup.length > 1) {
      // Show the entire group
      console.log(`Showing group of ${variableGroup.length} variables`);
      const group = variableGroup.map(name => {
        const metadata = this.store.getVariableMetadata(name);
        return { name, ...metadata };
      });
      this._generateVariableGroup(container, group);
    } else {
      // Show just this variable
      console.log(`Showing single variable ${varName}`);
      const metadata = this.store.getVariableMetadata(varName);
      if (!metadata) return;
      const { value, min, max } = metadata;
      this._generateSingleVariableControl(container, varName, value, min, max);
    }
  }

  /**
   * Generate UI for a group of variables
   */
  _generateVariableGroup(container, group) {
    const section = document.createElement('div');
    section.className = 'controls-section';

    const header = document.createElement('h2');
    header.textContent = 'variables';
    section.appendChild(header);

    for (const { name, value, min, max } of group) {
      const sliderContainer = this._createVariableSlider(name, value, min, max);
      section.appendChild(sliderContainer);
    }

    container.appendChild(section);
  }

  /**
   * Generate UI for a single variable (not in a group)
   */
  _generateSingleVariableControl(container, varName, value, min, max) {

    const section = document.createElement('div');
    section.className = 'controls-section';

    const header = document.createElement('h2');
    header.textContent = `variable ${varName}`;
    section.appendChild(header);

    const controlContainer = document.createElement('div');
    controlContainer.className = 'slider-container';

    const label = document.createElement('label');
    label.textContent = varName;

    // Create slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.value = value;

    // Use custom range if specified, otherwise auto-detect
    if (min !== null && max !== null) {
      slider.min = min;
      slider.max = max;
      // Auto-detect step based on range
      const range = max - min;
      if (range <= 1) {
        slider.step = 0.01;
      } else if (range <= 20) {
        slider.step = 0.1;
      } else {
        slider.step = 1;
      }
    } else {
      // Auto-detect sensible range based on current value
      if (value <= 1) {
        slider.min = 0;
        slider.max = 1;
        slider.step = 0.01;
      } else if (value <= 10) {
        slider.min = 0;
        slider.max = 20;
        slider.step = 0.1;
      } else if (value <= 100) {
        slider.min = 0;
        slider.max = 200;
        slider.step = 1;
      } else {
        slider.min = 0;
        slider.max = value * 2;
        slider.step = Math.max(1, Math.floor(value / 100));
      }
    }

    // Create value display
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'slider-value';
    valueDisplay.textContent = value;

    slider.addEventListener('input', () => {
      if (!this.isUpdatingFromText) {
        const newValue = parseFloat(slider.value);
        // Update value display
        valueDisplay.textContent = newValue;
        // Update just the value, preserve min/max
        this.store.variables.global[varName].value = newValue;
        this._updateTextFromUI('variable', varName, '', newValue);
      }
    });

    controlContainer.appendChild(label);
    controlContainer.appendChild(slider);
    controlContainer.appendChild(valueDisplay);
    section.appendChild(controlContainer);
    container.appendChild(section);
  }

  /**
   * Generate master section
   */
  _generateMasterSection(container) {
    const masterAttrs = this.store.getTriggerAttributes('master');

    // Only show master section if it has attributes
    if (Object.keys(masterAttrs).length === 0) return;

    const section = document.createElement('div');
    section.className = 'controls-section';
    section.id = 'master-section';

    const header = document.createElement('h2');
    header.textContent = 'master';
    section.appendChild(header);

    // Generate controls for each attribute
    const schema = this.schemas.TRIGGER_SCHEMAS.master;
    for (const [attrName, attrValue] of Object.entries(masterAttrs)) {
      const attrSchema = schema.attributes[attrName];
      if (!attrSchema) continue;

      const control = this._createAttributeControl(
        attrName,
        attrValue,
        attrSchema,
        'master',
        null,
        (value) => {
          this.store.setTriggerAttribute('master', attrName, value);
          this._updateTextFromUI('master', '', attrName, value);
        }
      );

      if (control) {
        section.appendChild(control);
      }
    }

    container.appendChild(section);
  }

  /**
   * Generate global components
   */
  _generateGlobalComponents(container) {
    const globalComponents = this.store.getAllComponentsInScope('global');

    // For each component type
    for (const [typeKey, instances] of Object.entries(globalComponents)) {
      for (const [name, component] of Object.entries(instances)) {
        const section = this._createComponentSection(component);
        if (section) {
          container.appendChild(section);
        }
      }
    }
  }

  /**
   * Generate variables section (grouped by consecutive lines)
   */
  _generateVariablesSection(container) {
    const globalVars = this.store.variables.global;

    if (Object.keys(globalVars).length === 0) return;

    // Convert to array with metadata and sort by line number
    const varArray = Object.entries(globalVars).map(([name, varData]) => {
      const metadata = typeof varData === 'object' ? varData : { value: varData, min: null, max: null, lineNumber: null };
      return { name, ...metadata };
    });

    console.log('Variables before sorting:', varArray);

    // Sort by line number (variables without line numbers go to end)
    varArray.sort((a, b) => {
      if (a.lineNumber === null) return 1;
      if (b.lineNumber === null) return -1;
      return a.lineNumber - b.lineNumber;
    });

    console.log('Variables after sorting:', varArray);

    // Group consecutive variables (line numbers differ by 1)
    const groups = [];
    let currentGroup = [];
    let lastLineNumber = null;

    for (const varItem of varArray) {
      if (lastLineNumber === null || varItem.lineNumber === lastLineNumber + 1) {
        // Continue current group
        currentGroup.push(varItem);
        console.log(`Adding ${varItem.name} to current group (line ${varItem.lineNumber})`);
      } else {
        // Start new group
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          console.log(`Starting new group. Previous group had ${currentGroup.length} variables`);
        }
        currentGroup = [varItem];
        console.log(`New group started with ${varItem.name} (line ${varItem.lineNumber})`);
      }
      lastLineNumber = varItem.lineNumber;
    }

    // Add final group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    console.log(`Total groups: ${groups.length}`, groups);

    // Create a section for each group
    for (const group of groups) {
      const section = document.createElement('div');
      section.className = 'controls-section';

      const header = document.createElement('h2');
      header.textContent = 'variables';
      section.appendChild(header);

      for (const { name, value, min, max } of group) {
        const sliderContainer = this._createVariableSlider(name, value, min, max);
        section.appendChild(sliderContainer);
      }

      container.appendChild(section);
    }
  }

  /**
   * Create a variable slider control
   */
  _createVariableSlider(name, value, min, max) {
    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'slider-container';

    const label = document.createElement('label');
    label.textContent = name;

    // Create slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.value = value;

    // Use custom range if specified, otherwise auto-detect
    if (min !== null && max !== null) {
      slider.min = min;
      slider.max = max;
      // Auto-detect step based on range
      const range = max - min;
      if (range <= 1) {
        slider.step = 0.01;
      } else if (range <= 20) {
        slider.step = 0.1;
      } else {
        slider.step = 1;
      }
    } else {
      // Auto-detect sensible range based on current value
      if (value <= 1) {
        slider.min = 0;
        slider.max = 1;
        slider.step = 0.01;
      } else if (value <= 10) {
        slider.min = 0;
        slider.max = 20;
        slider.step = 0.1;
      } else if (value <= 100) {
        slider.min = 0;
        slider.max = 200;
        slider.step = 1;
      } else {
        slider.min = 0;
        slider.max = value * 2;
        slider.step = Math.max(1, Math.floor(value / 100));
      }
    }

    // Create value display
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'slider-value';
    valueDisplay.textContent = value;

    slider.addEventListener('input', () => {
      if (!this.isUpdatingFromText) {
        const newValue = parseFloat(slider.value);
        // Update value display
        valueDisplay.textContent = newValue;
        // Update just the value, preserve min/max
        if (typeof this.store.variables.global[name] === 'object') {
          this.store.variables.global[name].value = newValue;
        } else {
          this.store.variables.global[name] = newValue;
        }
        this._updateTextFromUI('variable', name, '', newValue);
      }
    });

    sliderContainer.appendChild(label);
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);

    return sliderContainer;
  }

  /**
   * Generate note scope sections
   */
  _generateNoteScopes(container) {
    const noteTriggers = this.store.getTriggersByType('note');

    for (const scopeKey of noteTriggers) {
      const section = this._createTriggerSection(scopeKey, 'note');
      if (section) {
        container.appendChild(section);
      }
    }
  }

  /**
   * Generate key scope sections
   */
  _generateKeyScopes(container) {
    const keyTriggers = this.store.getTriggersByType('key');

    for (const scopeKey of keyTriggers) {
      const section = this._createTriggerSection(scopeKey, 'key');
      if (section) {
        container.appendChild(section);
      }
    }
  }

  /**
   * Create a component section
   */
  _createComponentSection(component) {
    const section = document.createElement('div');
    section.className = 'controls-section';
    section.dataset.componentName = component.name;

    const header = document.createElement('h2');
    header.textContent = `${component.type} ${component.name}`;
    section.appendChild(header);

    // Get component schema
    const schema = this.schemas.SchemaUtils.getComponentSchema(component.type);
    if (!schema) return null;

    // Create controls ONLY for attributes that exist in the component
    for (const [attrName, attrValue] of Object.entries(component.attributes)) {
      const attrSchema = schema.attributes[attrName];
      if (!attrSchema) continue;

      const control = this._createAttributeControl(
        attrName,
        attrValue,
        attrSchema,
        component.type,
        component.name,
        (value) => {
          this.store.updateComponentAttribute(component.name, attrName, value);
          this._updateTextFromUI(component.type, component.name, attrName, value);
        }
      );

      if (control) {
        section.appendChild(control);
      }
    }

    return section;
  }

  /**
   * Create a trigger section
   */
  _createTriggerSection(scopeKey, triggerType) {
    const trigger = this.store.components.triggers[scopeKey];
    if (!trigger) return null;

    const section = document.createElement('div');
    section.className = 'controls-section trigger-section';

    const header = document.createElement('h2');
    header.textContent = scopeKey;
    section.appendChild(header);

    // Show trigger attributes if any
    for (const [attrName, attrValue] of Object.entries(trigger.attributes || {})) {
      // Create control (simplified for now)
      const container = document.createElement('div');
      container.className = 'slider-container';

      const label = document.createElement('label');
      label.textContent = attrName;

      const value = document.createElement('span');
      value.textContent = JSON.stringify(attrValue);

      container.appendChild(label);
      container.appendChild(value);
      section.appendChild(container);
    }

    // Show components in this trigger
    for (const [typeKey, instances] of Object.entries(trigger.components)) {
      for (const [name, component] of Object.entries(instances)) {
        const compSection = this._createComponentSection(component);
        if (compSection) {
          section.appendChild(compSection);
        }
      }
    }

    return section;
  }

  /**
   * Create an attribute control
   */
  _createAttributeControl(attrName, attrValue, attrSchema, ownerType, ownerName, onChange) {
    const container = document.createElement('div');
    container.className = 'slider-container';

    const label = document.createElement('label');
    label.textContent = attrSchema.ui?.label || attrName;

    // Resolve current value
    let currentValue = this._resolveDisplayValue(attrValue, attrSchema);

    // Check if this attribute uses a variable
    const usesVariable = attrValue && typeof attrValue === 'object' && attrValue.type === 'variable_ref';

    // Debug logging
    console.log('Creating control for', attrName, '- attrValue:', attrValue, 'usesVariable:', usesVariable, 'currentValue:', currentValue);

    if (usesVariable) {
      label.textContent += ` (${attrValue.value})`;
    }

    // Create appropriate control based on attribute type
    let control;

    if (attrSchema.type === this.schemas.AttributeType.ENUM) {
      // Dropdown
      control = document.createElement('select');
      for (const value of attrSchema.values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === currentValue) option.selected = true;
        control.appendChild(option);
      }

      control.addEventListener('change', () => {
        if (!this.isUpdatingFromText) {
          onChange(control.value);
        }
      });

    } else if (attrSchema.type === this.schemas.AttributeType.COMPONENT_REF) {
      // Component reference dropdown
      control = document.createElement('select');

      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = '(none)';
      control.appendChild(noneOption);

      // Get available components of the right type
      const acceptedTypes = attrSchema.acceptsComponents || [];
      for (const compType of acceptedTypes) {
        const instances = this.store.getComponentsByType(compType, 'global');
        for (const name of Object.keys(instances)) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          if (attrValue && attrValue.value === name) option.selected = true;
          control.appendChild(option);
        }
      }

      control.addEventListener('change', () => {
        if (!this.isUpdatingFromText) {
          if (control.value === '') {
            onChange(null);
          } else {
            onChange({ type: 'component_ref', value: control.value });
          }
        }
      });

    } else {
      // Number slider
      control = document.createElement('input');
      control.type = 'range';
      control.min = attrSchema.min || 0;
      control.max = attrSchema.max || 100;
      control.step = attrSchema.step || 1;
      control.value = currentValue !== null ? currentValue : (attrSchema.default || 0);

      // Create value display
      const valueDisplay = document.createElement('span');
      valueDisplay.className = 'slider-value';

      // Check if this attribute uses an expression or variable
      const usesExpression = attrValue && typeof attrValue === 'object' && attrValue.type === 'expression';
      if (usesExpression) {
        valueDisplay.textContent = `${currentValue} (${attrValue.value})`;
      } else if (usesVariable) {
        valueDisplay.textContent = currentValue;
      } else {
        valueDisplay.textContent = currentValue !== null ? currentValue : (attrSchema.default || 0);
      }

      if (usesVariable || usesExpression) {
        control.disabled = true;
        control.style.opacity = '0.5';
      }

      control.addEventListener('input', () => {
        console.log('Slider input event fired for', attrName, 'value:', control.value, 'isUpdatingFromText:', this.isUpdatingFromText);
        if (!this.isUpdatingFromText) {
          let value = parseFloat(control.value);

          // Update value display
          valueDisplay.textContent = value;

          // Convert percentage to 0-1 if needed
          if (attrSchema.type === this.schemas.AttributeType.PERCENTAGE) {
            // Keep as 0-100 for now, conversion happens in audio engine
          }

          console.log('Calling onChange with value:', value);
          onChange(value);
        } else {
          console.warn('Blocked by isUpdatingFromText flag');
        }
      });

      container.appendChild(label);
      container.appendChild(control);
      container.appendChild(valueDisplay);

      return container;
    }

    container.appendChild(label);
    container.appendChild(control);

    return container;
  }

  /**
   * Resolve display value for UI
   */
  _resolveDisplayValue(attrValue, attrSchema) {
    if (attrValue === null || attrValue === undefined) {
      return attrSchema.default;
    }

    if (typeof attrValue === 'object' && attrValue.type === 'variable_ref') {
      const resolved = this.store.resolveVariable(attrValue.value, null);
      return resolved !== null ? resolved : attrSchema.default;
    }

    if (typeof attrValue === 'object' && attrValue.type === 'component_ref') {
      return attrValue.value;
    }

    // Handle expressions - evaluate them for display
    if (typeof attrValue === 'object' && attrValue.type === 'expression') {
      // Create a variable resolver
      const variableResolver = (varName) => {
        const resolved = this.store.resolveVariable(varName, null);
        if (resolved === null || resolved === undefined) {
          return null;
        }
        // If the variable itself is an object (e.g., metadata), extract the value
        if (typeof resolved === 'object' && 'value' in resolved) {
          return resolved.value;
        }
        return resolved;
      };

      try {
        const result = ExpressionEvaluator.evaluate(attrValue.value, variableResolver);
        return result !== null ? result : attrSchema.default;
      } catch (error) {
        console.error('Error evaluating expression for display:', attrValue.value, error);
        return attrSchema.default;
      }
    }

    return attrValue;
  }

  /**
   * Update text document from UI changes
   * This is a placeholder - will need to implement reverse generation
   */
  _updateTextFromUI(componentType, componentName, attributeName, value) {
    // Call bridge function in script.js to update text document
    if (typeof window.updateTextFromUIChange === 'function') {
      window.updateTextFromUIChange(componentType, componentName, attributeName, value);
    }
  }

  /**
   * Set flag to prevent circular updates
   */
  setUpdatingFromText(value) {
    this.isUpdatingFromText = value;
  }
}

// Global UI generator instance
let uiGenerator = null;

function initializeUIGenerator() {
  if (typeof instanceStore === 'undefined' || typeof COMPONENT_SCHEMAS === 'undefined') {
    console.error('Cannot initialize UI generator: instanceStore or schemas not loaded');
    return;
  }

  uiGenerator = new UIGenerator(instanceStore, {
    AttributeType,
    COMPONENT_SCHEMAS,
    TRIGGER_SCHEMAS,
    SchemaUtils
  });

  console.log('UI generator initialized');
}
