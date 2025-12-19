/**
 * ============================================================================
 * INSTANCE STORE
 * ============================================================================
 *
 * Manages component instances, variables, and their scope hierarchies.
 * Provides methods for creating, updating, and querying instances.
 */

/**
 * Scope types
 */
const ScopeType = {
  GLOBAL: 'global',
  TRIGGER: 'trigger'  // For master, note, key
};

/**
 * Instance store - holds all component instances and variables
 */
class InstanceStore {
  constructor() {
    this.reset();
  }

  /**
   * Reset the store to empty state
   */
  reset() {
    // Component instances organized by scope
    // Structure: { global: { oscillators: {...}, lfos: {...}, ... }, triggers: { master: {...}, note_c4: {...}, key_a: {...} } }
    this.components = {
      global: {
        oscillators: {},
        lfos: {},
        envelopes: {},
        filters: {},
        compressors: {}
      },
      triggers: {}
    };

    // Variables organized by scope
    // Structure: { global: { varName: value }, triggers: { master: { varName: value }, ... } }
    this.variables = {
      global: {},
      triggers: {}
    };

    // Name registry to ensure uniqueness
    // Maps name -> { scope, type, scopeKey }
    this.nameRegistry = {};
  }

  /**
   * Get the plural form of a component type for storage
   */
  _getComponentStorageKey(componentType) {
    const plurals = {
      oscillator: 'oscillators',
      lfo: 'lfos',
      envelope: 'envelopes',
      filter: 'filters',
      compressor: 'compressors'
    };
    return plurals[componentType] || componentType + 's';
  }

  /**
   * Register a name in the global registry
   */
  _registerName(name, scope, type, scopeKey = null) {
    if (this.nameRegistry[name]) {
      console.warn(`Name "${name}" is already registered`);
      return false;
    }
    this.nameRegistry[name] = { scope, type, scopeKey };
    return true;
  }

  /**
   * Unregister a name from the global registry
   */
  _unregisterName(name) {
    delete this.nameRegistry[name];
  }

  /**
   * Check if a name is registered
   */
  isNameRegistered(name) {
    return this.nameRegistry.hasOwnProperty(name);
  }

  /**
   * Get registration info for a name
   */
  getNameInfo(name) {
    return this.nameRegistry[name] || null;
  }

  /**
   * Add a component instance
   * @param {string} componentType - Type of component (oscillator, lfo, etc.)
   * @param {string} name - Instance name
   * @param {string} scope - Scope type (global, master, note, key)
   * @param {string} scopeKey - Scope identifier (null for global, "master", "c4", "a", etc.)
   * @param {object} attributes - Attribute values
   * @returns {boolean} Success
   */
  addComponent(componentType, name, scope, scopeKey = null, attributes = {}) {
    // Register name
    if (!this._registerName(name, scope, componentType, scopeKey)) {
      return false;
    }

    const storageKey = this._getComponentStorageKey(componentType);

    if (scope === ScopeType.GLOBAL) {
      this.components.global[storageKey][name] = {
        type: componentType,
        name,
        scope: ScopeType.GLOBAL,
        attributes: { ...attributes }
      };
    } else {
      // Trigger scope
      if (!this.components.triggers[scopeKey]) {
        this.components.triggers[scopeKey] = {
          type: scope,
          components: {
            oscillators: {},
            lfos: {},
            envelopes: {},
            filters: {},
            compressors: {}
          },
          attributes: {},
          variableOverrides: {}
        };
      }
      this.components.triggers[scopeKey].components[storageKey][name] = {
        type: componentType,
        name,
        scope: ScopeType.TRIGGER,
        scopeKey,
        attributes: { ...attributes }
      };
    }

    return true;
  }

  /**
   * Get a component instance by name
   * @param {string} name - Instance name
   * @returns {object|null} Component instance or null
   */
  getComponent(name) {
    const info = this.nameRegistry[name];
    if (!info || info.type === 'variable') return null;

    const storageKey = this._getComponentStorageKey(info.type);

    if (info.scope === ScopeType.GLOBAL) {
      return this.components.global[storageKey][name] || null;
    } else {
      const trigger = this.components.triggers[info.scopeKey];
      return trigger?.components[storageKey][name] || null;
    }
  }

  /**
   * Get all components of a type in a scope
   * @param {string} componentType - Type of component
   * @param {string} scope - Scope type
   * @param {string} scopeKey - Scope identifier (null for global)
   * @returns {object} Object with name -> instance mappings
   */
  getComponentsByType(componentType, scope = ScopeType.GLOBAL, scopeKey = null) {
    const storageKey = this._getComponentStorageKey(componentType);

    if (scope === ScopeType.GLOBAL) {
      return this.components.global[storageKey];
    } else {
      const trigger = this.components.triggers[scopeKey];
      return trigger?.components[storageKey] || {};
    }
  }

  /**
   * Get all components in a scope (combines global + scope-specific)
   * @param {string} scope - Scope type (global, master, note, key)
   * @param {string} scopeKey - Scope identifier
   * @returns {object} Object with componentType -> { name -> instance }
   */
  getAllComponentsInScope(scope = ScopeType.GLOBAL, scopeKey = null) {
    if (scope === ScopeType.GLOBAL) {
      return this.components.global;
    }

    // For trigger scopes, combine global + trigger-specific
    const result = {
      oscillators: { ...this.components.global.oscillators },
      lfos: { ...this.components.global.lfos },
      envelopes: { ...this.components.global.envelopes },
      filters: { ...this.components.global.filters },
      compressors: { ...this.components.global.compressors }
    };

    const trigger = this.components.triggers[scopeKey];
    if (trigger) {
      Object.keys(trigger.components).forEach(storageKey => {
        result[storageKey] = {
          ...result[storageKey],
          ...trigger.components[storageKey]
        };
      });
    }

    return result;
  }

  /**
   * Update a component attribute
   * @param {string} name - Component name
   * @param {string} attributeName - Attribute to update
   * @param {any} value - New value
   * @returns {boolean} Success
   */
  updateComponentAttribute(name, attributeName, value) {
    const component = this.getComponent(name);
    if (!component) return false;

    component.attributes[attributeName] = value;
    return true;
  }

  /**
   * Add a variable
   * @param {string} name - Variable name
   * @param {any} value - Variable value
   * @param {string} scope - Scope type
   * @param {string} scopeKey - Scope identifier (null for global)
   * @returns {boolean} Success
   */
  addVariable(name, value, scope = ScopeType.GLOBAL, scopeKey = null, min = null, max = null, lineNumber = null) {
    // Check if variable already exists (during reparse)
    const existingInfo = this.nameRegistry[name];
    const isUpdate = existingInfo && existingInfo.type === 'variable' && existingInfo.scope === scope;

    // Register name (or update existing)
    if (!isUpdate && !this._registerName(name, scope, 'variable', scopeKey)) {
      return false;
    }

    // Store variable with metadata (value, min, max, lineNumber for UI grouping)
    const variableData = { value, min, max, lineNumber };

    if (scope === ScopeType.GLOBAL) {
      this.variables.global[name] = variableData;
    } else {
      if (!this.variables.triggers[scopeKey]) {
        this.variables.triggers[scopeKey] = {};
      }
      this.variables.triggers[scopeKey][name] = variableData;
    }

    return true;
  }

  /**
   * Set a variable override (for trigger scopes)
   * This doesn't create a new variable, just overrides an existing one in a scope
   * @param {string} name - Variable name
   * @param {any} value - Override value
   * @param {string} scopeKey - Trigger scope key
   */
  setVariableOverride(name, value, scopeKey) {
    // Ensure the trigger scope exists
    if (!this.components.triggers[scopeKey]) {
      this.components.triggers[scopeKey] = {
        type: scopeKey.startsWith('note_') ? 'note' :
              scopeKey.startsWith('key_') ? 'key' : 'master',
        components: {
          oscillators: {},
          lfos: {},
          envelopes: {},
          filters: {},
          compressors: {}
        },
        attributes: {},
        variableOverrides: {}
      };
    }

    this.components.triggers[scopeKey].variableOverrides[name] = value;
  }

  /**
   * Resolve a variable value with scope chain
   * @param {string} name - Variable name
   * @param {string} scopeKey - Current scope key (null for global)
   * @returns {any|null} Resolved value or null
   */
  resolveVariable(name, scopeKey = null) {
    // Check for override in current scope first
    if (scopeKey) {
      const trigger = this.components.triggers[scopeKey];
      if (trigger?.variableOverrides?.hasOwnProperty(name)) {
        return trigger.variableOverrides[name];
      }
      // Check if variable is defined in this trigger scope
      if (this.variables.triggers[scopeKey]?.hasOwnProperty(name)) {
        const varData = this.variables.triggers[scopeKey][name];
        return typeof varData === 'object' ? varData.value : varData;
      }
    }

    // Fall back to global scope
    if (this.variables.global.hasOwnProperty(name)) {
      const varData = this.variables.global[name];
      return typeof varData === 'object' ? varData.value : varData;
    }

    return null;
  }

  /**
   * Get a variable (without scope resolution)
   * @param {string} name - Variable name
   * @returns {any|null} Variable value or null
   */
  getVariable(name) {
    const info = this.nameRegistry[name];
    if (!info || info.type !== 'variable') return null;

    if (info.scope === ScopeType.GLOBAL) {
      const varData = this.variables.global[name];
      return typeof varData === 'object' ? varData.value : varData;
    } else {
      const varData = this.variables.triggers[info.scopeKey]?.[name];
      return varData ? (typeof varData === 'object' ? varData.value : varData) : null;
    }
  }

  /**
   * Get variable metadata (value, min, max)
   * @param {string} name - Variable name
   * @returns {object|null} { value, min, max } or null
   */
  getVariableMetadata(name) {
    const info = this.nameRegistry[name];
    if (!info || info.type !== 'variable') return null;

    let varData;
    if (info.scope === ScopeType.GLOBAL) {
      varData = this.variables.global[name];
    } else {
      varData = this.variables.triggers[info.scopeKey]?.[name];
    }

    // Convert old format (plain value) to new format
    if (typeof varData !== 'object') {
      return { value: varData, min: null, max: null };
    }

    return varData;
  }

  /**
   * Set trigger attribute (for triggers like master that can have attributes)
   * @param {string} scopeKey - Trigger scope key
   * @param {string} attributeName - Attribute name
   * @param {any} value - Attribute value
   */
  setTriggerAttribute(scopeKey, attributeName, value) {
    if (!this.components.triggers[scopeKey]) {
      this.components.triggers[scopeKey] = {
        type: scopeKey === 'master' ? 'master' :
              scopeKey.startsWith('note_') ? 'note' : 'key',
        components: {
          oscillators: {},
          lfos: {},
          envelopes: {},
          filters: {},
          compressors: {}
        },
        attributes: {},
        variableOverrides: {}
      };
    }

    this.components.triggers[scopeKey].attributes[attributeName] = value;
  }

  /**
   * Get trigger attribute
   * @param {string} scopeKey - Trigger scope key
   * @param {string} attributeName - Attribute name
   * @returns {any|null} Attribute value or null
   */
  getTriggerAttribute(scopeKey, attributeName) {
    return this.components.triggers[scopeKey]?.attributes[attributeName] || null;
  }

  /**
   * Get all trigger attributes
   * @param {string} scopeKey - Trigger scope key
   * @returns {object} All attributes
   */
  getTriggerAttributes(scopeKey) {
    return this.components.triggers[scopeKey]?.attributes || {};
  }

  /**
   * Get all triggers of a type
   * @param {string} triggerType - Type (master, note, key)
   * @returns {array} Array of scope keys
   */
  getTriggersByType(triggerType) {
    return Object.keys(this.components.triggers).filter(key => {
      const trigger = this.components.triggers[key];
      return trigger.type === triggerType;
    });
  }

  /**
   * Remove a component
   * @param {string} name - Component name
   * @returns {boolean} Success
   */
  removeComponent(name) {
    const info = this.nameRegistry[name];
    if (!info || info.type === 'variable') return false;

    const storageKey = this._getComponentStorageKey(info.type);

    if (info.scope === ScopeType.GLOBAL) {
      delete this.components.global[storageKey][name];
    } else {
      const trigger = this.components.triggers[info.scopeKey];
      if (trigger) {
        delete trigger.components[storageKey][name];
      }
    }

    this._unregisterName(name);
    return true;
  }

  /**
   * Remove a variable
   * @param {string} name - Variable name
   * @returns {boolean} Success
   */
  removeVariable(name) {
    const info = this.nameRegistry[name];
    if (!info || info.type !== 'variable') return false;

    if (info.scope === ScopeType.GLOBAL) {
      delete this.variables.global[name];
    } else {
      delete this.variables.triggers[info.scopeKey]?.[name];
    }

    this._unregisterName(name);
    return true;
  }

  /**
   * Debug: Print the store state
   */
  debug() {
    console.log('=== INSTANCE STORE ===');
    console.log('Components:', JSON.stringify(this.components, null, 2));
    console.log('Variables:', JSON.stringify(this.variables, null, 2));
    console.log('Name Registry:', JSON.stringify(this.nameRegistry, null, 2));
  }
}

// Create global instance
const instanceStore = new InstanceStore();
