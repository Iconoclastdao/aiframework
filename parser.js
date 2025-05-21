const fs = require('fs').promises;
const Ajv = require('ajv');
const nlp = require('compromise');

// Cached schema
let cachedSchema = null;

// Constants
const STEP_TYPES = {
  SET: 'set',
  WHILE: 'while',
  WAIT: 'wait',
  RETURN: 'return'
};

const OPERATORS = {
  COMPARE: ['>', '<', '>=', '<=', '===', '!==', '=='],
  MATH: { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' },
  LOGICAL: ['&&', '||']
};

// Parser Context
class ParserContext {
  constructor() {
    this.stepCounter = 1;
    this.typeMap = {};
    this.errors = [];
  }

  nextId() {
    return `step${this.stepCounter++}`;
  }

  addError(message) {
    this.errors.push(message);
  }
}

/**
 * Creates a 'set' step.
 * @param {string} id - Step ID
 * @param {string} target - Variable to set
 * @param {Object} value - Value to assign
 * @returns {Object} Set step
 */
function createSetStep(id, target, value) {
  return { id, type: STEP_TYPES.SET, target, value };
}

/**
 * Creates a 'while' step.
 * @param {string} id - Step ID
 * @param {Object} condition - Condition object
 * @param {Object[]} body - Array of steps in the loop
 * @returns {Object} While step
 */
function createWhileStep(id, condition, body) {
  return { id, type: STEP_TYPES.WHILE, condition, body };
}

/**
 * Creates a 'wait' step.
 * @param {string} id - Step ID
 * @param {number} seconds - Duration in seconds
 * @returns {Object} Wait step
 */
function createWaitStep(id, seconds) {
  return { id, type: STEP_TYPES.WAIT, duration: { unit: 'seconds', value: seconds } };
}

/**
 * Creates a 'return' step.
 * @param {string} id - Step ID
 * @param {Object} value - Value to return
 * @returns {Object} Return step
 */
function createReturnStep(id, value) {
  return { id, type: STEP_TYPES.RETURN, value };
}

/**
 * Infers the type of a value.
 * @param {Object} value - Value object
 * @returns {string} Inferred type
 */
function inferType(value) {
  if (value.value !== undefined) {
    return typeof value.value === 'number' ? 'number' :
           typeof value.value === 'boolean' ? 'boolean' : 'string';
  }
  if (value.add || value.subtract || value.multiply || value.divide) {
    return 'number';
  }
  if (value.and || value.or) {
    return 'boolean';
  }
  return 'string';
}

/**
 * Sanitizes input string.
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
function sanitizeInput(input) {
  return input.replace(/[<>{}]/g, '').trim();
}

/**
 * Parses a condition string (e.g., "x > 5", "x contains y").
 * @param {string} conditionStr - Condition string
 * @returns {Object} Parsed condition
 */
function parseCondition(conditionStr) {
  const sanitized = sanitizeInput(conditionStr);
  if (!sanitized) return { compare: { left: { value: false }, op: '===', right: { value: false } } };

  if (sanitized.includes('contains')) {
    const [left, right] = sanitized.split(/\s+contains\s+/i).map(s => s.trim());
    if (!left || !right) return { compare: { left: { value: false }, op: '===', right: { value: false } } };
    return {
      regex: {
        pattern: `.*${right.replace(/['"]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`,
        input: { get: left }
      }
    };
  }
  const logicalMatch = sanitized.match(/^(.+?)\s*(\|\||&&)\s*(.+)$/);
  if (logicalMatch) {
    const [, left, op, right] = logicalMatch;
    return {
      [op === '&&' ? 'and' : 'or']: [
        parseCondition(left.trim()),
        parseCondition(right.trim())
      ]
    };
  }
  const compareMatch = sanitized.match(/(\w+)\s*(>|>=|<|<=|===|!==|==)\s*(\S+)/);
  if (compareMatch) {
    const [, left, op, right] = compareMatch;
    return {
      compare: {
        left: { get: left },
        op,
        right: isNaN(right) ? { get: right } : { value: parseFloat(right) }
      }
    };
  }
  return {
    compare: { left: { get: sanitized }, op: '===', right: { value: true } }
  };
}

/**
 * Parses an expression string (e.g., "x + y * z").
 * @param {string} valueStr - Expression string
 * @returns {Object|null} Parsed expression
 */
function parseExpression(valueStr) {
  const sanitized = sanitizeInput(valueStr);
  const tokens = sanitized.match(/\w+|\d+\.\d+|\d+|[+\-*/()]/g) || [];
  let index = 0;
  let parenCount = 0;

  function parsePrimary() {
    if (index >= tokens.length) return null;
    const token = tokens[index++];
    if (token === '(') parenCount++;
    if (token === ')') parenCount--;
    if (parenCount < 0) return null;
    if (token.match(/^\w+$/)) return { get: token };
    if (token.match(/^\d+(\.\d+)?$/)) return { value: parseFloat(token) };
    if (token === '(') {
      const expr = parseExpressionTokens();
      if (index < tokens.length && tokens[index] === ')') {
        index++;
        parenCount--;
        return expr;
      }
      return null;
    }
    return null;
  }

  function parseMulDiv() {
    let left = parsePrimary();
    while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
      const op = tokens[index++] === '*' ? 'multiply' : 'divide';
      const right = parsePrimary();
      if (!right) return null;
      left = { [op]: [left, right] };
    }
    return left;
  }

  function parseAddSub() {
    let left = parseMulDiv();
    if (!left) return null;
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++] === '+' ? 'add' : 'subtract';
      const right = parseMulDiv();
      if (!right) return null;
      left = { [op]: [left, right] };
    }
    return left;
  }

  function parseExpressionTokens() {
    return parseAddSub();
  }

  const result = parseExpressionTokens();
  return index === tokens.length && parenCount === 0 ? result : null;
}

/**
 * Command parser interface.
 * @typedef {Object} CommandParser
 * @property {string} verb - Verb to match
 * @property {RegExp} pattern - Pattern to match the sentence
 * @property {Function} parse - Parsing function
 */

/**
 * Registry of command parsers.
 * @type {CommandParser[]}
 */
const commandParsers = [
  {
    verb: 'repeat',
    pattern: /^(?:repeat|loop)\s+(.+?)\s+(\d+)\s+times$/i,
    parse: (match, context) => {
      const [, bodyStr, times] = match;
      if (!bodyStr || isNaN(times)) {
        context.addError(`Invalid repeat command: "${match[0]}"`);
        return [];
      }
      const id = context.nextId();
      const loopCounter = `_loop_counter_${id}`;
      const init = createSetStep(context.nextId(), loopCounter, { value: 0 });
      const body = parseSentence(bodyStr, context);
      const inc = createSetStep(context.nextId(), loopCounter, {
        add: [{ get: loopCounter }, { value: 1 }]
      });
      const loop = createWhileStep(id, {
        compare: {
          left: { get: loopCounter },
          op: '<',
          right: { value: parseInt(times) }
        }
      }, [...body, inc]);
      context.typeMap[loopCounter] = 'number';
      return [init, loop];
    }
  },
  {
    verb: 'wait',
    pattern: /^wait\s+(\d+)\s+seconds$/i,
    parse: (match, context) => {
      const seconds = parseInt(match[1]);
      if (isNaN(seconds)) {
        context.addError(`Invalid wait duration: "${match[1]}"`);
        return [];
      }
      return [createWaitStep(context.nextId(), seconds)];
    }
  },
  {
    verb: 'set',
    pattern: /^(?:set|assign)\s+(\w+)\s+to\s+(.+)$/i,
    parse: (match, context) => {
      const [, target, rawValue] = match;
      if (!target.match(/^\w+$/)) {
        context.addError(`Invalid variable name: "${target}"`);
        return [];
      }
      const expr = parseExpression(rawValue);
      const value = expr || (/^\w+$/.test(rawValue.trim())
        ? { get: rawValue.trim() }
        : { value: isNaN(rawValue) ? rawValue.trim() : parseFloat(rawValue) });
      if (!value) {
        context.addError(`Invalid expression: "${rawValue}"`);
        return [];
      }
      context.typeMap[target] = inferType(value);
      return [createSetStep(context.nextId(), target, value)];
    }
  },
  {
    verb: 'return',
    pattern: /^return\s+(.+)$/i,
    parse: (match, context) => {
      const valueStr = match[1].trim();
      if (!valueStr) {
        context.addError('Return statement requires a value');
        return [];
      }
      const value = isNaN(valueStr) ? { get: valueStr } : { value: parseFloat(valueStr) };
      return [createReturnStep(context.nextId(), value)];
    }
  }
];

/**
 * Parses a sentence into workflow steps using NLP.
 * @param {string} sentence - Input sentence
 * @param {ParserContext} context - Parser context
 * @returns {Object[]} Array of steps
 */
function parseSentence(sentence, context) {
  const sanitized = sanitizeInput(sentence);
  if (!sanitized) {
    context.addError(`Invalid sentence: "${sentence}"`);
    return [];
  }

  const doc = nlp(sanitized);
  const verb = doc.verbs().toInfinitive().out('array')[0]?.toLowerCase() || 
               sanitized.split(' ')[0].toLowerCase();
  const parser = commandParsers.find(p => p.verb === verb || 
               sanitized.toLowerCase().startsWith(p.verb));
  if (parser) {
    const match = sanitized.match(parser.pattern);
    if (match) {
      return parser.parse(match, context);
    }
  }
  context.addError(`Unable to parse: "${sanitized}"`);
  return [];
}

/**
 * Loads and caches schema.
 * @param {string} schemaPath - Path to schema file
 * @returns {Object} Schema
 */
async function loadSchema(schemaPath = 'schema.json') {
  if (cachedSchema) return cachedSchema;
  try {
    cachedSchema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    return cachedSchema;
  } catch (err) {
    throw new Error(`Failed to load schema: ${err.message}`);
  }
}

/**
 * Generates a workflow from input text.
 * @param {string} input - Input text with commands
 * @param {string} [schemaPath] - Path to schema file
 * @returns {Object} Workflow object with steps and errors
 * @throws {Error} If schema loading fails
 */
async function generateWorkflow(input, schemaPath = 'schema.json') {
  if (!input || typeof input !== 'string') {
    return { workflow: null, errors: ['Input must be a non-empty string'] };
  }

  let schema;
  try {
    schema = await loadSchema(schemaPath);
  } catch (err) {
    return { workflow: null, errors: [err.message] };
  }

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const context = new ParserContext();

  const steps = input.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(sentence => parseSentence(sentence, context));

  const inputs = Object.fromEntries(
    Object.keys(context.typeMap)
      .filter(v => steps.some(s => JSON.stringify(s).includes(`"get":"${v}"`)))
      .map(name => [name, { type: context.typeMap[name] || 'string' }])
  );

  const outputs = Object.fromEntries(
    Object.keys(context.typeMap)
      .filter(v => steps.some(s => s.type === STEP_TYPES.SET && s.target === v))
      .map(name => [name, { type: context.typeMap[name] || 'string' }])
  );

  const workflow = {
    function: 'generatedWorkflow',
    metadata: {
      schema_version: '1.0.0',
      version: '0.1.0',
      author: 'APlusParser',
      description: 'Generated workflow from natural language input'
    },
    schema: {
      inputs,
      context: {},
      outputs
    },
    steps
  };

  if (!validate(workflow)) {
    context.errors.push(...validate.errors.map(e => `Validation error: ${e.message}`));
    return { workflow: null, errors: context.errors };
  }

  return { workflow, errors: context.errors };
}

// Example usage
if (require.main === module) {
  const input = `
    set x to 0
    repeat set x to x + 1 3 times
    wait 2 seconds
    set y to x * 5
    return y
  `;
  generateWorkflow(input).then(({ workflow, errors }) => {
    console.log('Workflow:', JSON.stringify(workflow, null, 2));
    if (errors.length) console.log('Errors:', errors);
  });
}
