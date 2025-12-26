/**
 * ============================================================================
 * GENERIC PARSER
 * ============================================================================
 *
 * Parses the document text and builds the instance store.
 * Handles 4 element types: triggers, components, attributes, variables
 * Uses schemas for validation and type checking.
 */

/**
 * ============================================================================
 * EXPRESSION EVALUATOR
 * ============================================================================
 *
 * Safely evaluates mathematical expressions with variable substitution
 * Supports: +, -, *, /, (), numbers, and variable references
 */
class ExpressionEvaluator {
  /**
   * Evaluate a mathematical expression with variable substitution
   * @param {string} expression - The expression to evaluate (e.g., "x + 5 * 2")
   * @param {function} variableResolver - Function to resolve variable values
   * @returns {number} The result of the evaluation
   */
  static evaluate(expression, variableResolver) {
    try {
      // Tokenize the expression
      const tokens = this._tokenize(expression);

      // Replace variable tokens with their values
      const resolvedTokens = tokens.map(token => {
        if (token.type === 'variable') {
          const value = variableResolver(token.value);
          if (value === null || value === undefined) {
            throw new Error(`Variable "${token.value}" not found`);
          }
          return { type: 'number', value: parseFloat(value) };
        }
        return token;
      });

      // Evaluate the expression using precedence climbing
      return this._evaluateTokens(resolvedTokens);
    } catch (error) {
      console.error('Expression evaluation error:', error);
      return null;
    }
  }

  /**
   * Tokenize an expression into numbers, operators, and variables
   */
  static _tokenize(expression) {
    const tokens = [];
    const str = expression.replace(/\s+/g, ''); // Remove whitespace
    let i = 0;

    while (i < str.length) {
      const char = str[i];

      // Numbers (including decimals)
      if (char >= '0' && char <= '9' || char === '.') {
        let num = '';
        while (i < str.length && (str[i] >= '0' && str[i] <= '9' || str[i] === '.')) {
          num += str[i];
          i++;
        }
        tokens.push({ type: 'number', value: parseFloat(num) });
        continue;
      }

      // Operators
      if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
        tokens.push({ type: 'operator', value: char });
        i++;
        continue;
      }

      // Variables (letters and underscores)
      if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_') {
        let varName = '';
        while (i < str.length && ((str[i] >= 'a' && str[i] <= 'z') || (str[i] >= 'A' && str[i] <= 'Z') || str[i] === '_' || (str[i] >= '0' && str[i] <= '9'))) {
          varName += str[i];
          i++;
        }
        tokens.push({ type: 'variable', value: varName });
        continue;
      }

      // Unknown character - skip it
      i++;
    }

    return tokens;
  }

  /**
   * Evaluate tokenized expression with operator precedence
   */
  static _evaluateTokens(tokens) {
    let index = 0;

    const parseExpression = () => {
      return parseAddSub();
    };

    const parseAddSub = () => {
      let left = parseMulDiv();

      while (index < tokens.length && tokens[index].type === 'operator' && (tokens[index].value === '+' || tokens[index].value === '-')) {
        const op = tokens[index].value;
        index++;
        const right = parseMulDiv();
        left = op === '+' ? left + right : left - right;
      }

      return left;
    };

    const parseMulDiv = () => {
      let left = parsePrimary();

      while (index < tokens.length && tokens[index].type === 'operator' && (tokens[index].value === '*' || tokens[index].value === '/')) {
        const op = tokens[index].value;
        index++;
        const right = parsePrimary();
        left = op === '*' ? left * right : left / right;
      }

      return left;
    };

    const parsePrimary = () => {
      const token = tokens[index];

      if (token.type === 'number') {
        index++;
        return token.value;
      }

      if (token.type === 'operator' && token.value === '(') {
        index++; // skip '('
        const result = parseExpression();
        index++; // skip ')'
        return result;
      }

      if (token.type === 'operator' && token.value === '-') {
        index++; // unary minus
        return -parsePrimary();
      }

      throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
    };

    return parseExpression();
  }

  /**
   * Check if a value string contains a mathematical expression
   */
  static isExpression(value) {
    if (typeof value !== 'string') return false;
    // Check for math operators (but not just a negative number)
    return /[+\-*/()]/.test(value) && !(/^-?\d+\.?\d*$/.test(value));
  }
}

/**
 * Parse context - tracks parsing state
 */
class ParseContext {
  constructor() {
    this.reset();
  }

  reset() {
    // Current scope stack
    // Each entry: { type: 'global'|'master'|'note'|'key', key: null|'master'|'note_c4'|'key_a', indent: 0 }
    this.scopeStack = [{ type: 'global', key: null, indent: -1 }];

    // Current component being defined (for attributes)
    // { type, name, scope, scopeKey }
    this.currentComponent = null;

    // Current trigger being defined
    // { type, key }
    this.currentTrigger = null;

    // Current attribute being defined (for modulation)
    // { name, indent }
    this.currentAttribute = null;

    // Line number for error reporting
    this.lineNumber = 0;

    // Errors and warnings
    this.errors = [];
    this.warnings = [];
  }

  getCurrentScope() {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  pushScope(type, key, indent) {
    this.scopeStack.push({ type, key, indent });
  }

  popScopesToIndent(indent) {
    while (this.scopeStack.length > 1 && this.scopeStack[this.scopeStack.length - 1].indent >= indent) {
      this.scopeStack.pop();
    }
  }

  addError(message) {
    this.errors.push({ line: this.lineNumber, message });
  }

  addWarning(message) {
    this.warnings.push({ line: this.lineNumber, message });
  }
}

/**
 * Parser class
 */
class Parser {
  constructor(schemas, instanceStore) {
    this.schemas = schemas;
    this.store = instanceStore;
    this.context = new ParseContext();
  }

  /**
   * Main parse function
   * @param {string} text - Document text
   * @returns {object} { success, errors, warnings }
   */
  parse(text) {
    // Reset store and context
    this.store.reset();
    this.context.reset();

    // Split into lines
    const lines = text.split('\n');

    // PASS 1: Parse all lines (components, triggers, variables, attributes)
    // Attributes may have unresolved references at this point
    for (let i = 0; i < lines.length; i++) {
      this.context.lineNumber = i + 1;
      const line = lines[i];

      // Skip empty lines and comments
      if (line.trim() === '' || line.trim().startsWith('#')) {
        continue;
      }

      this.parseLine(line);
    }

    // PASS 2: Resolve all attribute references now that all components are known
    this._resolveAllReferences();

    // Return results
    return {
      success: this.context.errors.length === 0,
      errors: this.context.errors,
      warnings: this.context.warnings
    };
  }

  /**
   * Parse a single line
   * @param {string} line - Line text
   */
  parseLine(line) {
    // Measure indentation
    const indent = this._getIndent(line);
    const content = line.trim();

    // Pop scopes if needed
    if (indent < this.context.getCurrentScope().indent) {
      this.context.popScopesToIndent(indent);
      this.context.currentComponent = null;
      this.context.currentTrigger = null;
      this.context.currentAttribute = null;
    }

    // Clear currentAttribute if indent is not deeper than attribute indent
    if (this.context.currentAttribute && indent <= this.context.currentAttribute.indent) {
      this.context.currentAttribute = null;
    }

    // Special case: if we're at indent 0 and parsing a component/variable/trigger,
    // ensure we're back at global scope (not in a trigger scope)
    if (indent === 0 && (this._isComponent(content) || this._isVariable(content) || this._isTrigger(content))) {
      this.context.popScopesToIndent(0);
      this.context.currentComponent = null;
      this.context.currentTrigger = null;
      this.context.currentAttribute = null;
    }

    // Determine line type and parse
    if (this._isVariable(content)) {
      this._parseVariable(content, indent);
    } else if (this._isTrigger(content)) {
      this._parseTrigger(content, indent);
    } else if (this._isModulation(content)) {
      // Modulation line - must be nested under an attribute
      this._parseModulation(content, indent);
    } else if (indent > 0 && (this.context.currentComponent || this.context.currentTrigger)) {
      // Indented line inside a component or trigger scope - must be an attribute
      this._parseAttribute(content, indent);
    } else if (this._isComponent(content)) {
      this._parseComponent(content, indent);
    } else {
      // Must be an attribute
      this._parseAttribute(content, indent);
    }
  }

  /**
   * Get indentation level
   */
  _getIndent(line) {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') indent++;
      else if (char === '\t') indent += 2;
      else break;
    }
    return indent;
  }

  /**
   * Check if line is a variable declaration
   */
  _isVariable(content) {
    return content.startsWith('variable ') && content.includes('=');
  }

  /**
   * Check if line is a trigger
   */
  _isTrigger(content) {
    const triggerTypes = this.schemas.SchemaUtils.getAllTriggerTypes();
    for (const type of triggerTypes) {
      if (content === type || content.startsWith(type + ' ')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if line is a component declaration
   */
  _isComponent(content) {
    const componentTypes = this.schemas.SchemaUtils.getAllComponentTypes();
    const firstWord = content.split(' ')[0];
    return componentTypes.includes(firstWord);
  }

  /**
   * Check if line is a modulation declaration
   */
  _isModulation(content) {
    return content.startsWith('modulation ');
  }

  /**
   * Parse variable declaration
   * Format: variable [name] = [value] or variable [name] = [value] [min, max]
   */
  _parseVariable(content, indent) {
    const match = content.match(/^variable\s+(\w+)\s*=\s*(.+)$/);
    if (!match) {
      this.context.addError(`Invalid variable syntax: ${content}`);
      return;
    }

    const [, name, rest] = match;

    // Check for range syntax: [min, max]
    const rangeMatch = rest.match(/^(.+?)\s*\[([^\]]+)\]$/);
    let value, min = null, max = null;

    if (rangeMatch) {
      // Parse value and range
      value = this._parseValue(rangeMatch[1].trim());
      const rangeStr = rangeMatch[2].trim();
      const rangeParts = rangeStr.split(',').map(s => s.trim());

      if (rangeParts.length === 2) {
        min = parseFloat(rangeParts[0]);
        max = parseFloat(rangeParts[1]);

        if (isNaN(min) || isNaN(max)) {
          this.context.addWarning(`Invalid range for variable "${name}": [${rangeStr}]`);
          min = null;
          max = null;
        }
      } else {
        this.context.addWarning(`Invalid range syntax for variable "${name}": expected [min, max]`);
      }
    } else {
      // No range specified
      value = this._parseValue(rest.trim());
    }

    // Determine scope
    const currentScope = this.context.getCurrentScope();
    const isGlobal = currentScope.type === 'global';

    // Check if this is a variable override in a trigger scope
    if (!isGlobal && this.store.isNameRegistered(name)) {
      // This is an override (note: overrides don't support range syntax)
      this.store.setVariableOverride(name, value, currentScope.key);
    } else {
      // New variable
      const success = this.store.addVariable(
        name,
        value,
        isGlobal ? 'global' : 'trigger',
        isGlobal ? null : currentScope.key,
        min,
        max,
        this.context.lineNumber
      );

      if (!success) {
        this.context.addError(`Variable name "${name}" is already in use`);
      }
    }
  }

  /**
   * Parse trigger
   * Format: master | note [name] | key [char]
   */
  _parseTrigger(content, indent) {
    const parts = content.split(' ');
    const triggerType = parts[0];
    const triggerName = parts.slice(1).join(' ').trim();

    // Validate trigger type
    const schema = this.schemas.SchemaUtils.getTriggerSchema(triggerType);
    if (!schema) {
      this.context.addError(`Unknown trigger type: ${triggerType}`);
      return;
    }

    // Check if trigger requires a name
    if (schema.requiresName && !triggerName) {
      this.context.addError(`Trigger "${triggerType}" requires a name`);
      return;
    }

    // Create scope key
    let scopeKey;
    if (triggerType === 'master') {
      scopeKey = 'master';
    } else if (triggerType === 'note') {
      scopeKey = `note_${triggerName}`;
    } else if (triggerType === 'key') {
      scopeKey = `key_${triggerName}`;
    }

    // Push scope
    this.context.pushScope(triggerType, scopeKey, indent);
    this.context.currentTrigger = { type: triggerType, key: scopeKey };
    this.context.currentComponent = null;
  }

  /**
   * Parse component declaration
   * Format: [type] [name]
   */
  _parseComponent(content, indent) {
    const parts = content.split(' ');
    const componentType = parts[0];
    const componentName = parts.slice(1).join(' ').trim();

    if (!componentName) {
      this.context.addError(`Component "${componentType}" requires a name`);
      return;
    }

    // Validate component type
    const schema = this.schemas.SchemaUtils.getComponentSchema(componentType);
    if (!schema) {
      this.context.addError(`Unknown component type: ${componentType}`);
      return;
    }

    // Determine scope
    const currentScope = this.context.getCurrentScope();
    const isGlobal = currentScope.type === 'global';

    // Add component to store
    const success = this.store.addComponent(
      componentType,
      componentName,
      isGlobal ? 'global' : 'trigger',
      isGlobal ? null : currentScope.key,
      {}
    );

    if (!success) {
      this.context.addError(`Component name "${componentName}" is already in use`);
      return;
    }

    // Set as current component for attribute parsing
    this.context.currentComponent = {
      type: componentType,
      name: componentName,
      scope: isGlobal ? 'global' : 'trigger',
      scopeKey: currentScope.key
    };
  }

  /**
   * Parse attribute
   * Format: [name] [value|reference]
   */
  _parseAttribute(content, indent) {
    const parts = content.split(' ');
    const attributeName = parts[0];
    const valueStr = parts.slice(1).join(' ').trim();

    if (!valueStr) {
      this.context.addError(`Attribute "${attributeName}" requires a value`);
      return;
    }

    // Determine context - are we in a component or trigger?
    if (this.context.currentComponent) {
      // Component attribute
      this._parseComponentAttribute(attributeName, valueStr, indent);
    } else if (this.context.currentTrigger) {
      // Trigger attribute
      this._parseTriggerAttribute(attributeName, valueStr, indent);
    } else {
      this.context.addError(`Attribute "${attributeName}" must be inside a component or trigger`);
    }
  }

  /**
   * Parse component attribute
   */
  _parseComponentAttribute(attributeName, valueStr, indent) {
    const { type, name } = this.context.currentComponent;

    // Get attribute schema
    const attrSchema = this.schemas.SchemaUtils.getAttributeSchema(type, attributeName);
    if (!attrSchema) {
      this.context.addWarning(`Unknown attribute "${attributeName}" for component type "${type}"`);
      // Still set it - allows for forward compatibility
    }

    // Resolve value (could be literal, variable ref, or component ref)
    const value = this._resolveAttributeValue(valueStr, type, attributeName, attrSchema);

    // BACKWARDS COMPATIBILITY: Check if value is a component_ref and attribute accepts modulation
    // Old syntax: "pitch vibrato" -> New syntax: "pitch 0" + nested "modulation vibrato"
    if (value && typeof value === 'object' && value.type === 'component_ref' &&
        attrSchema && attrSchema.acceptsModulation && !attrSchema.acceptsComponents) {

      this.context.addWarning(
        `Deprecated syntax: "${attributeName} ${valueStr}". ` +
        `Use "${attributeName} ${attrSchema.default}" with nested "modulation ${valueStr}" instead.`
      );

      // Set attribute to default value
      this.store.updateComponentAttribute(name, attributeName, attrSchema.default);

      // Set modulation
      this.store.updateComponentAttributeModulation(name, attributeName, value);

      console.log(`✓ Auto-converted old syntax: ${attributeName} ${valueStr} -> ${attributeName} ${attrSchema.default} + modulation ${valueStr}`);
    } else {
      // Normal case - just update the attribute
      this.store.updateComponentAttribute(name, attributeName, value);
    }

    // Set as current attribute for potential modulation
    this.context.currentAttribute = { name: attributeName, indent, isComponent: true };
  }

  /**
   * Parse trigger attribute (for triggers like master that can have attributes)
   */
  _parseTriggerAttribute(attributeName, valueStr, indent) {
    const { type, key } = this.context.currentTrigger;

    // Get trigger schema
    const triggerSchema = this.schemas.SchemaUtils.getTriggerSchema(type);
    if (!triggerSchema || !triggerSchema.canHaveAttributes) {
      this.context.addError(`Trigger "${type}" cannot have attributes`);
      return;
    }

    // Get attribute schema
    const attrSchema = this.schemas.SchemaUtils.getTriggerAttributeSchema(type, attributeName);
    if (!attrSchema) {
      this.context.addWarning(`Unknown attribute "${attributeName}" for trigger "${type}"`);
    }

    // Resolve value
    const value = this._resolveAttributeValue(valueStr, type, attributeName, attrSchema);

    // BACKWARDS COMPATIBILITY: Check if value is a component_ref and attribute accepts modulation
    // Old syntax: "volume tremolo" -> New syntax: "volume 80" + nested "modulation tremolo"
    if (value && typeof value === 'object' && value.type === 'component_ref' &&
        attrSchema && attrSchema.acceptsModulation && !attrSchema.acceptsComponents) {

      this.context.addWarning(
        `Deprecated syntax: "${attributeName} ${valueStr}". ` +
        `Use "${attributeName} ${attrSchema.default}" with nested "modulation ${valueStr}" instead.`
      );

      // Set attribute to default value
      this.store.setTriggerAttribute(key, attributeName, attrSchema.default);

      // Set modulation
      this.store.setTriggerAttributeModulation(key, attributeName, value);

      console.log(`✓ Auto-converted old syntax: ${attributeName} ${valueStr} -> ${attributeName} ${attrSchema.default} + modulation ${valueStr}`);
    } else {
      // Normal case - set trigger attribute
      this.store.setTriggerAttribute(key, attributeName, value);
    }

    // Set as current attribute for potential modulation
    this.context.currentAttribute = { name: attributeName, indent, isComponent: false, triggerKey: key };
  }

  /**
   * Parse modulation line
   * Format: modulation [lfoname|envelopename]
   */
  _parseModulation(content, indent) {
    // Extract modulator name
    const parts = content.split(' ');
    if (parts.length < 2) {
      this.context.addError('Modulation requires a modulator name (e.g., "modulation vibrato")');
      return;
    }

    const modulatorName = parts.slice(1).join(' ').trim();

    // Check if we have a current attribute
    if (!this.context.currentAttribute) {
      this.context.addError('Modulation must be nested under an attribute');
      return;
    }

    // Create modulation reference (validation will happen in Pass 2)
    const modulationRef = {
      type: 'component_ref',
      value: modulatorName,
      componentType: null  // Will be resolved in Pass 2
    };

    // Update the attribute's modulation
    const attrName = this.context.currentAttribute.name;
    if (this.context.currentAttribute.isComponent && this.context.currentComponent) {
      this.store.updateComponentAttributeModulation(
        this.context.currentComponent.name,
        attrName,
        modulationRef
      );
    } else if (!this.context.currentAttribute.isComponent && this.context.currentTrigger) {
      this.store.setTriggerAttributeModulation(
        this.context.currentAttribute.triggerKey,
        attrName,
        modulationRef
      );
    }

    // console.log(`✓ Modulation added: ${attrName} <- ${modulatorName} (will be validated in Pass 2)`);
  }

  /**
   * Resolve attribute value (literal, variable ref, component ref, or expression)
   */
  _resolveAttributeValue(valueStr, ownerType, attributeName, attrSchema) {
    if (!attrSchema) {
      // No schema - check for expression, otherwise parse as literal
      if (ExpressionEvaluator.isExpression(valueStr)) {
        return { type: 'expression', value: valueStr };
      }
      return this._parseValue(valueStr);
    }

    // Check if it's a component reference
    if (attrSchema.type === this.schemas.AttributeType.COMPONENT_REF || attrSchema.acceptsModulation) {
      const componentInfo = this.store.getNameInfo(valueStr);
      // console.log(`Checking component ref for "${attributeName}" = "${valueStr}":`, componentInfo);
      if (componentInfo && componentInfo.type !== 'variable') {
        // It's a component reference - validate type
        if (attrSchema.acceptsComponents) {
          if (!attrSchema.acceptsComponents.includes(componentInfo.type)) {
            this.context.addError(`Attribute "${attributeName}" cannot accept component type "${componentInfo.type}"`);
            return null;
          }
        } else if (attrSchema.acceptsModulation) {
          if (!attrSchema.acceptsModulation.includes(componentInfo.type)) {
            this.context.addError(`Attribute "${attributeName}" cannot accept modulation from "${componentInfo.type}"`);
            return null;
          }
        }
        console.log(`✓ Component ref accepted: ${attributeName} -> ${valueStr}`);
        return { type: 'component_ref', value: valueStr, componentType: componentInfo.type };
      }
    }

    // Check if it's a variable reference
    const variableInfo = this.store.getNameInfo(valueStr);
    if (variableInfo && variableInfo.type === 'variable') {
      if (attrSchema.canReference?.includes(this.schemas.AttributeType.VARIABLE_REF)) {
        return { type: 'variable_ref', value: valueStr };
      } else {
        this.context.addWarning(`Attribute "${attributeName}" cannot reference variables`);
      }
    }

    // Check if it's an enum value
    if (attrSchema.type === this.schemas.AttributeType.ENUM) {
      if (attrSchema.values.includes(valueStr) || attrSchema.allowCustom) {
        return valueStr;
      } else {
        this.context.addError(`Invalid enum value "${valueStr}" for attribute "${attributeName}". Valid values: ${attrSchema.values.join(', ')}`);
        return attrSchema.default;
      }
    }

    // Check if it's a mathematical expression
    if (ExpressionEvaluator.isExpression(valueStr)) {
      return { type: 'expression', value: valueStr };
    }

    // Otherwise, parse as literal value
    return this._parseValue(valueStr);
  }

  /**
   * Parse a literal value (number, string, etc.)
   */
  _parseValue(valueStr) {
    // Try to parse as number
    const num = parseFloat(valueStr);
    if (!isNaN(num)) {
      return num;
    }

    // Return as string
    return valueStr;
  }

  /**
   * PASS 2: Resolve all attribute references after all components are known
   */
  _resolveAllReferences() {
    // console.log('Pass 2: Resolving attribute references...');

    // Resolve references in global components
    this._resolveComponentReferences(this.store.components.global);

    // Resolve references in trigger components
    for (const [triggerKey, trigger] of Object.entries(this.store.components.triggers)) {
      if (trigger.components) {
        this._resolveComponentReferences(trigger.components);
      }
    }

    // Resolve references in trigger attributes (e.g., master's filter reference)
    this._resolveTriggerAttributeReferences();

    // console.log('Pass 2 complete');
  }

  /**
   * Resolve references in a component collection
   */
  _resolveComponentReferences(componentCollection) {
    for (const [typeKey, instances] of Object.entries(componentCollection)) {
      for (const [name, component] of Object.entries(instances)) {
        this._resolveComponentAttributeReferences(component);
      }
    }
  }

  /**
   * Resolve attribute references for a single component
   */
  _resolveComponentAttributeReferences(component) {
    const schema = this.schemas.SchemaUtils.getComponentSchema(component.type);
    if (!schema) return;

    for (const [attrName, attrValue] of Object.entries(component.attributes)) {
      const attrSchema = schema.attributes[attrName];
      if (!attrSchema) continue;

      // Handle new { value, modulation } structure
      if (attrValue && typeof attrValue === 'object' && attrValue.hasOwnProperty('modulation')) {
        // Validate modulation reference if present
        if (attrValue.modulation && attrValue.modulation.type === 'component_ref') {
          const modulatorName = attrValue.modulation.value;
          const modulatorInfo = this.store.getNameInfo(modulatorName);

          if (!modulatorInfo || modulatorInfo.type === 'variable') {
            this.context.addError(`Modulator "${modulatorName}" not found or is not a component`);
          } else if (modulatorInfo.type !== 'lfo' && modulatorInfo.type !== 'envelope' && modulatorInfo.type !== 'noise') {
            this.context.addError(`Component "${modulatorName}" is type "${modulatorInfo.type}", but only "lfo", "envelope", and "noise" can be used as modulators`);
          } else if (attrSchema.acceptsModulation && !attrSchema.acceptsModulation.includes(modulatorInfo.type)) {
            this.context.addError(`Attribute "${attrName}" cannot accept modulation from "${modulatorInfo.type}"`);
          } else {
            // Valid modulation - update componentType
            attrValue.modulation.componentType = modulatorInfo.type;
            // console.log(`✓ Resolved modulation: ${component.type} ${component.name}.${attrName} <- ${modulatorName} (${modulatorInfo.type})`);
          }
        }
        continue;
      }

      // Check if this attribute should be a component reference but is still a string
      if (typeof attrValue === 'string' &&
          (attrSchema.type === this.schemas.AttributeType.COMPONENT_REF || attrSchema.acceptsModulation)) {

        // Try to resolve as component reference
        const componentInfo = this.store.getNameInfo(attrValue);
        console.log(`Resolving "${attrName}" = "${attrValue}" in ${component.type} ${component.name}:`, componentInfo);

        if (componentInfo && componentInfo.type !== 'variable') {
          // Validate type
          let isValid = false;
          if (attrSchema.acceptsComponents && attrSchema.acceptsComponents.includes(componentInfo.type)) {
            isValid = true;
          } else if (attrSchema.acceptsModulation && attrSchema.acceptsModulation.includes(componentInfo.type)) {
            isValid = true;
          }

          if (isValid) {
            // Convert to component reference
            component.attributes[attrName] = {
              type: 'component_ref',
              value: attrValue,
              componentType: componentInfo.type
            };
            console.log(`✓ Resolved: ${component.type} ${component.name}.${attrName} -> ${attrValue}`);
          } else {
            console.warn(`Component type "${componentInfo.type}" not accepted for attribute "${attrName}"`);
          }
        }
      }
    }
  }

  /**
   * Resolve attribute references in all triggers (e.g., master's filter/compressor references)
   */
  _resolveTriggerAttributeReferences() {
    // console.log('Resolving trigger attribute references...');

    for (const [triggerKey, trigger] of Object.entries(this.store.components.triggers)) {
      if (!trigger.attributes) {
        console.log(`  Trigger "${triggerKey}" has no attributes`);
        continue;
      }

      // Get trigger type
      const triggerType = trigger.type;
      // console.log(`  Processing trigger "${triggerKey}" (type: ${triggerType})`);

      const triggerSchema = this.schemas.SchemaUtils.getTriggerSchema(triggerType);
      if (!triggerSchema) {
        console.warn(`  No schema found for trigger type "${triggerType}"`);
        continue;
      }

      if (!triggerSchema.attributes) {
        console.log(`  Trigger type "${triggerType}" has no attributes in schema`);
        continue;
      }

      // Resolve each attribute that might be a component reference
      for (const [attrName, attrValue] of Object.entries(trigger.attributes)) {
        // console.log(`    Checking attribute "${attrName}" = ${JSON.stringify(attrValue)}`);

        const attrSchema = triggerSchema.attributes[attrName];
        if (!attrSchema) {
          console.warn(`    No schema for attribute "${attrName}"`);
          continue;
        }

        // Check if this attribute should be a component reference but is still a string
        if (typeof attrValue === 'string' && attrSchema.type === this.schemas.AttributeType.COMPONENT_REF) {
          // Try to resolve as component reference
          const componentInfo = this.store.getNameInfo(attrValue);
          console.log(`    Attempting to resolve "${attrName}" = "${attrValue}":`, componentInfo);

          if (componentInfo && componentInfo.type !== 'variable') {
            // Validate type
            let isValid = false;
            if (attrSchema.acceptsComponents && attrSchema.acceptsComponents.includes(componentInfo.type)) {
              isValid = true;
            }

            if (isValid) {
              // Convert to component reference
              trigger.attributes[attrName] = {
                type: 'component_ref',
                value: attrValue,
                componentType: componentInfo.type
              };
              console.log(`    ✓ Resolved: ${triggerKey}.${attrName} -> ${attrValue} (${componentInfo.type})`);
            } else {
              console.warn(`    ✗ Component type "${componentInfo.type}" not accepted for trigger attribute "${attrName}"`);
              console.warn(`      Accepts:`, attrSchema.acceptsComponents);
            }
          } else {
            console.warn(`    ✗ Component "${attrValue}" not found or is a variable`);
          }
        } else if (typeof attrValue === 'object' && attrValue.type === 'component_ref') {
          console.log(`    Already resolved as component_ref`);
        } else {
          // console.log(`    Not a string or not COMPONENT_REF type (is ${typeof attrValue})`);
        }
      }
    }

    // console.log('Trigger attribute resolution complete');
  }
}

/**
 * Create global parser instance
 * Note: This will be initialized after schemas and instanceStore are loaded
 */
let parser = null;

function initializeParser() {
  if (typeof COMPONENT_SCHEMAS === 'undefined' || typeof instanceStore === 'undefined') {
    console.error('Cannot initialize parser: schemas or instanceStore not loaded');
    return;
  }

  parser = new Parser({
    AttributeType,
    ComponentRole,
    COMPONENT_SCHEMAS,
    TRIGGER_SCHEMAS,
    SchemaUtils
  }, instanceStore);

  console.log('Parser initialized');
}
