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
      const result = this._evaluateTokens(resolvedTokens);
      if (!Number.isFinite(result)) {
        throw new Error(`Expression did not produce a finite number: ${expression}`);
      }
      return result;
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
    const str = expression;
    let i = 0;

    while (i < str.length) {
      const char = str[i];

      // Whitespace is a token boundary, not removable — "5 5" must not
      // silently merge into "55"
      if (char === ' ' || char === '\t') {
        i++;
        continue;
      }

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

      // Unknown character - error out rather than silently mutating the
      // expression (e.g. "x % 2" must not become "x2")
      throw new Error(`Unknown character "${char}" in expression`);
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
        if (op === '/' && right === 0) {
          throw new Error('Division by zero');
        }
        left = op === '*' ? left * right : left / right;
      }

      return left;
    };

    const parsePrimary = () => {
      const token = tokens[index];
      if (!token) {
        throw new Error('Unexpected end of expression');
      }

      if (token.type === 'number') {
        index++;
        return token.value;
      }

      if (token.type === 'operator' && token.value === '(') {
        index++; // skip '('
        const result = parseExpression();
        if (!tokens[index] || tokens[index].value !== ')') {
          throw new Error('Missing closing parenthesis');
        }
        index++; // skip ')'
        return result;
      }

      if (token.type === 'operator' && token.value === '-') {
        index++; // unary minus
        return -parsePrimary();
      }

      throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
    };

    const result = parseExpression();
    if (index < tokens.length) {
      throw new Error(`Unexpected trailing token: ${JSON.stringify(tokens[index])}`);
    }
    return result;
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

export { ExpressionEvaluator };
