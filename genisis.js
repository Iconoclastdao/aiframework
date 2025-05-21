#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Command } = require('commander');
const express = require('express');
const Ajv = require('ajv');
const { v4: uuidv4 } = require('uuid');
const nlp = require('compromise');
const tf = require('@tensorflow/tfjs-node');
const IPFS = require('ipfs-core');
const { CeramicClient } = require('@ceramicnetwork/http-client');
const { TCCLogger, TCCLogEntry, BioInspiredSecuritySystem } = require('./security');
const { generateWorkflow, renderWorkflowAsMermaid } = require('./parser');

// Load schema.json
async function loadSchema(schemaPath = 'schema.json') {
  try {
    return JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load schema: ${err.message}`);
  }
}

// Enhanced Logger (extends TCCLogger)
class EnhancedLogger extends TCCLogger {
  constructor({ level = 'info', useIPFS = false, ceramicUrl = null } = {}) {
    super(level);
    this.useIPFS = useIPFS;
    this.ceramicUrl = ceramicUrl;
    this.ipfs = null;
    this.ceramic = ceramicUrl ? new CeramicClient(ceramicUrl) : {
      createStream: async (data) => ({ id: `ceramic://mock-${crypto.randomBytes(16).toString('hex')}` })
    };
  }

  async initIPFS() {
    if (this.useIPFS && !this.ipfs) {
      this.ipfs = await IPFS.create();
    }
  }

  async log(operation, input, output, metadata = {}, level = 'info', errorCode = 'NONE') {
    const entry = new TCCLogEntry({
      step: this.step++,
      operation,
      inputBuffer: Buffer.from(input),
      outputBuffer: Buffer.from(output),
      metadata,
      level,
      errorCode,
      prevHash: this._prevHash()
    });
    this.logs.push(entry);

    if (this.useIPFS && this.ipfs) {
      const cid = await this.ipfs.add(JSON.stringify(entry.toJSON()));
      entry.ipfsCid = cid.path;
    }
    if (this.ceramicUrl) {
      const stream = await this.ceramic.createStream(entry.toJSON());
      entry.ceramicId = stream.id;
    }

    return { ipfsCid: entry.ipfsCid, ceramicId: entry.ceramicId };
  }

  async save(filename = 'audit_log.jsonl') {
    const data = this.logs.map(e => JSON.stringify(e.toJSON())).join('\n');
    await fs.writeFile(filename, data);
    let ipfsCid = null, ceramicId = null;
    if (this.useIPFS && this.ipfs) {
      const cid = await this.ipfs.add(data);
      ipfsCid = cid.path;
    }
    if (this.ceramicUrl) {
      const stream = await this.ceramic.createStream({ logs: data });
      ceramicId = stream.id;
    }
    return { filename, ipfsCid, ceramicId };
  }
}

// Enhanced Security System (extends BioInspiredSecuritySystem)
class EnhancedSecuritySystem extends BioInspiredSecuritySystem {
  constructor({ sampleRate = 1000, windowSize = 128, logger = new EnhancedLogger(), useNeuralNetwork = false, ceramicUrl = null } = {}) {
    super({ sampleRate, windowSize, logger });
    this.useNeuralNetwork = useNeuralNetwork;
    this.ceramicUrl = ceramicUrl;
    if (this.useNeuralNetwork) {
      this.model = this._buildNeuralNetwork();
    }
  }

  _buildNeuralNetwork() {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [this.windowSize] }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
    model.compile({ optimizer: 'adam', loss: 'binaryCrossentropy' });
    return model;
  }

  async trainModel(signals, labels) {
    if (!this.useNeuralNetwork) throw new Error('Neural network not enabled');
    const xs = tf.tensor2d(signals);
    const ys = tf.tensor1d(labels, 'float32');
    await this.model.fit(xs, ys, { epochs: 10, batchSize: 32 });
    await this.logger.log('trainModel', JSON.stringify({ signals: signals.length, labels: labels.length }), JSON.stringify({}), { epochs: 10 });
    xs.dispose();
    ys.dispose();
  }

  async establishBaseline(numSamples = 5) {
    const signals = [];
    const labels = [];

    for (let i = 0; i < numSamples; i++) {
      const signal = await this.generateSignal(false, i);
      signals.push(signal);
      labels.push(0);
    }

    if (this.useNeuralNetwork) {
      await this.trainModel(signals, labels);
      this.baseline = signals[0];
    } else {
      const magSets = signals.map(signal => this.fft(signal).magnitudes);
      this.baseline = magSets[0].map((_, i) =>
        magSets.reduce((sum, mags) => sum + mags[i], 0) / magSets.length
      );
    }

    await this.logger.log(
      'establishBaseline',
      Buffer.from(''),
      Buffer.from(Float32Array.from(this.baseline).buffer),
      { numSamples }
    );

    return this.baseline;
  }

  async detectAnomaly(signal) {
    let isAnomaly, score, explanation;

    if (this.useNeuralNetwork) {
      const tensor = tf.tensor2d([signal]);
      const prediction = this.model.predict(tensor);
      score = (await prediction.data())[0];
      isAnomaly = score > 0.5;
      explanation = isAnomaly
        ? `Anomaly detected. Neural network score: ${score.toFixed(2)}`
        : `No anomaly. Neural network score: ${score.toFixed(2)}`;
      tensor.dispose();
      prediction.dispose();
    } else {
      const { magnitudes } = this.fft(signal);
      const deviation = magnitudes.map((m, i) => Math.abs(m - (this.baseline[i] || 0)));
      score = deviation.reduce((a, b) => a + b, 0) / deviation.length;
      isAnomaly = score > 5;
      explanation = isAnomaly
        ? `Anomaly detected. Mean deviation: ${score.toFixed(2)}`
        : `No anomaly. Mean deviation: ${score.toFixed(2)}`;
    }

    await this.logger.log(
      'detectAnomaly',
      Buffer.from(Float32Array.from(signal).buffer),
      Buffer.from(JSON.stringify({ isAnomaly })),
      { score, isAnomaly, explanation }
    );

    return { isAnomaly, score, explanation };
  }
}

// Extended Parser
class ExtendedParserContext {
  constructor() {
    this.stepCounter = 1;
    this.typeMap = {};
    this.errors = [];
    this.macros = {};
  }

  nextId() {
    return `step${this.stepCounter++}`;
  }

  addError(message) {
    this.errors.push(message);
  }

  defineMacro(name, steps) {
    this.macros[name] = steps;
  }

  getMacro(name) {
    return this.macros[name] || [];
  }
}

const STEP_TYPES = {
  SET: 'set',
  IF: 'if',
  WHILE: 'while',
  WAIT: 'wait',
  RETURN: 'return',
  BREAK: 'break',
  CALL: 'call',
  AI_ANALYSIS: 'ai_classify',
  UI_RENDER: 'ui_render',
  UI_STATE: 'ui_state',
  CSS_STYLE: 'css_style',
  UI_EVENT: 'ui_event'
};

function createUIRenderStep(id, component, target, nl_phrase, nl_examples = []) {
  return {
    id,
    type: STEP_TYPES.UI_RENDER,
    component,
    target,
    nl_phrase: nl_phrase || `render ${component.type} as ${target}`,
    nl_examples: nl_examples.length ? nl_examples : [`render ${component.type} as ${target}`],
    access_control: { roles: ['admin', 'user'], permissions: ['view_ui'] }
  };
}

function createUIStateStep(id, state, nl_phrase, nl_examples = []) {
  return {
    id,
    type: STEP_TYPES.UI_STATE,
    state,
    nl_phrase: nl_phrase || `define state ${state.name}`,
    nl_examples: nl_examples.length ? nl_examples : [`define state ${state.name}`],
    access_control: { roles: ['admin', 'user'], permissions: ['view_ui'] }
  };
}

function createCSSStyleStep(id, styles, nl_phrase, nl_examples = []) {
  return {
    id,
    type: STEP_TYPES.CSS_STYLE,
    styles,
    nl_phrase: nl_phrase || `style ${styles.selector}`,
    nl_examples: nl_examples.length ? nl_examples : [`style ${styles.selector}`],
    access_control: { roles: ['admin', 'user'], permissions: ['view_ui'] }
  };
}

function createUIEventStep(id, event, nl_phrase, nl_examples = []) {
  return {
    id,
    type: STEP_TYPES.UI_EVENT,
    event,
    nl_phrase: nl_phrase || `on ${event.type} execute ${event.handler}`,
    nl_examples: nl_examples.length ? nl_examples : [`on ${event.type} execute ${event.handler}`],
    access_control: { roles: ['admin', 'user'], permissions: ['view_ui'] }
  };
}

function createAIAnalysisStep(id, model, input, target, nl_phrase, nl_examples = []) {
  return {
    id,
    type: STEP_TYPES.AI_ANALYSIS,
    model,
    input,
    target,
    nl_phrase: nl_phrase || `analyze ${JSON.stringify(input)} with ${model}`,
    nl_examples: nl_examples.length ? nl_examples : [`analyze ${JSON.stringify(input)} with ${model}`],
    access_control: { roles: ['admin', 'user'], permissions: ['execute_workflow'] }
  };
}

function parseExpression(valueStr) {
  const sanitized = valueStr.replace(/[<>{}]/g, '').trim();
  const doc = nlp(sanitized);
  if (doc.has('#Verb classify')) {
    const model = doc.match('with #Noun').out('text').replace(/^with\s+/i, '');
    const input = doc.match('^classify (.+?) with').out('text').replace(/^classify\s+/i, '');
    return { classify: { model, input } };
  }
  return generateWorkflow.prototype.parseExpression(sanitized);
}

const extendedCommandParsers = [
  {
    verb: 'macro',
    pattern: /^macro\s+(\w+)\s+(.+)$/i,
    parse: (match, context) => {
      const [, name, bodyStr] = match;
      const steps = parseSentence(bodyStr, context);
      context.defineMacro(name, steps);
      return [];
    }
  },
  {
    verb: 'call',
    pattern: /^call\s+(\w+)$/i,
    parse: (match, context) => {
      const [, macroName] = match;
      const macroSteps = context.getMacro(macroName);
      if (!macroSteps.length) {
        context.addError(`Unknown macro: ${macroName}`);
        return [];
      }
      return macroSteps.map(step => ({ ...step, id: context.nextId() }));
    }
  },
  {
    verb: 'analyze',
    pattern: /^analyze\s+(.+?)\s+with\s+(\w+)$/i,
    parse: (match, context) => {
      const [, input, model] = match;
      const parsedInput = parseExpression(input);
      return [createAIAnalysisStep(context.nextId(), model, parsedInput, `result_${model}`, `analyze ${input} with ${model}`)];
    }
  },
  {
    verb: 'render',
    pattern: /^render\s+(\w+)\s+as\s+(\w+)$/i,
    parse: (match, context) => {
      const [, componentType, target] = match;
      const component = { type: componentType, props: { className: 'bg-gray-100 p-4' }, children: [], hooks: [] };
      return [createUIRenderStep(context.nextId(), component, target, `render ${componentType} as ${target}`)];
    }
  },
  {
    verb: 'state',
    pattern: /^state\s+(\w+)\s+as\s+(.+)$/i,
    parse: (match, context) => {
      const [, name, initialStr] = match;
      const initial = parseExpression(initialStr);
      const state = { name, initial };
      return [createUIStateStep(context.nextId(), state, `state ${name} as ${initialStr}`)];
    }
  },
  {
    verb: 'style',
    pattern: /^style\s+(\S+)\s+with\s+(.+)$/i,
    parse: (match, context) => {
      const [, selector, stylesStr] = match;
      const styles = { selector, properties: stylesStr.split(',').map(s => s.trim()), framework: 'tailwind' };
      return [createCSSStyleStep(context.nextId(), styles, `style ${selector} with ${stylesStr}`)];
    }
  },
  {
    verb: 'on',
    pattern: /^on\s+(\w+)\s+execute\s+(\w+)$/i,
    parse: (match, context) => {
      const [, eventType, handler] = match;
      const event = { type: eventType, handler };
      return [createUIEventStep(context.nextId(), event, `on ${eventType} execute ${handler}`)];
    }
  }
];

function parseSentence(sentence, context) {
  const sanitized = sentence.replace(/[<>{}]/g, '').trim();
  if (!sanitized) {
    context.addError(`Invalid sentence: "${sentence}"`);
    return [];
  }

  const doc = nlp(sanitized);
  const verb = doc.verbs().toInfinitive().out('array')[0]?.toLowerCase() ||
               sanitized.split(' ')[0].toLowerCase();
  const parser = extendedCommandParsers.find(p => p.verb === verb || sanitized.toLowerCase().startsWith(p.verb));
  if (parser) {
    const match = sanitized.match(parser.pattern);
    if (match) {
      return parser.parse(match, context);
    }
  }
  return generateWorkflow.prototype.parseSentence(sanitized, context);
}

async function enhancedGenerateWorkflow(input, schemaPath = 'schema.json') {
  if (!input || typeof input !== 'string') {
    return { workflow: null, errors: ['Input must be a non-empty string'], mermaidDiagram: null };
  }

  const schema = await loadSchema(schemaPath);
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const context = new ExtendedParserContext();

  const originalSteps = (await generateWorkflow(input)).workflow?.steps || [];
  const extendedSteps = input.split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(sentence => parseSentence(sentence, context));

  const steps = [...originalSteps, ...extendedSteps.filter(s => !originalSteps.some(os => os.nl_phrase === s.nl_phrase))];

  const inputs = Object.fromEntries(
    Object.keys(context.typeMap)
      .filter(v => steps.some(s => JSON.stringify(s).includes(`"get":"${v}"`)))
      .map(name => [name, { type: context.typeMap[name] || 'string', required: true, description: `Variable ${name}` }])
  );

  const outputs = Object.fromEntries(
    Object.keys(context.typeMap)
      .filter(v => steps.some(s => s.type === STEP_TYPES.SET && s.target === v))
      .map(name => [name, { type: context.typeMap[name] || 'string', description: `Output ${name}` }])
  );

  const workflow = {
    function: `workflow_${uuidv4().replace(/-/g, '')}`,
    metadata: {
      schema_version: '2.0.0',
      version: '1.0.0',
      author: 'EnhancedParser',
      description: 'AI-generated workflow with security and UI',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: ['ai', 'security', 'ui'],
      target_languages: ['javascript', 'react', 'css'],
      language: 'en',
      dependencies: [
        { name: 'react', version: '18.2.0', source: 'https://cdn.jsdelivr.net/npm/react@18.2.0' },
        { name: 'react-dom', version: '18.2.0', source: 'https://cdn.jsdelivr.net/npm/react-dom@18.2.0' },
        { name: 'tailwindcss', version: '3.4.1', source: 'https://cdn.tailwindcss.com' }
      ]
    },
    schema: {
      inputs,
      context: {},
      outputs,
      nl_context: {
        prompts: [{ language: 'en', text: input.split('\n')[0] || 'set variable' }],
        entities: Object.fromEntries(Object.keys(context.typeMap).map(k => [k, context.typeMap[k] || 'string'])),
        intent: 'security',
        sentiment: 'neutral'
      }
    },
    steps,
    access_policy: { roles: ['admin', 'user'], permissions: ['execute_workflow', 'view_ui'] },
    execution_policy: { max_runs_per_minute: 60, max_concurrent_runs: 10, priority: 'medium', timeout: 300 },
    model_registry: {
      neural_net: { name: 'neural_net', version: '1.0.0', type: 'tabular', source: 'local', capabilities: ['classification'] }
    },
    codegen_config: {
      javascript: { async: true, module: 'esm', minify: false, target: 'es6' },
      python: { async: true, version: '3.10', imports: ['asyncio'], type_hints: true },
      solidity: { version: '0.8.20', contract_name: 'WorkflowContract', optimize: true },
      react: { component_type: 'functional', css_framework: 'tailwind', typescript: false, jsx: true, hooks: ['useState', 'useEffect'] },
      css: { module: false, minify: false }
    },
    reverse_config: { language: 'en', style: 'concise', reverse_template: 'Step {step.id}: {step.nl_phrase}' },
    plugins: [{ name: 'tailwindcss', version: '3.4.1', source: 'https://cdn.tailwindcss.com' }],
    tests: [
      {
        name: 'TestWorkflow',
        type: 'unit',
        inputs: Object.fromEntries(Object.keys(inputs).map(k => [k, inputs[k].default || null])),
        expected: Object.fromEntries(Object.keys(outputs).map(k => [k, null])),
        steps
      }
    ],
    extensions: {}
  };

  const mermaidDiagram = renderWorkflowAsMermaid(workflow);

  if (!validate(workflow)) {
    context.errors.push(...validate.errors.map(e => `Validation error: ${e.message}`));
    return { workflow: null, errors: context.errors, mermaidDiagram };
  }

  return { workflow, errors: context.errors, mermaidDiagram };
}

// Audit Runner
async function runAudit({ seed = 42, inputCommands = '', useNeuralNetwork = false, ceramicUrl = null, logger = new EnhancedLogger({ useIPFS: true, ceramicUrl }) } = {}) {
  await logger.initIPFS();
  const securitySystem = new EnhancedSecuritySystem({ logger, useNeuralNetwork, ceramicUrl });
  let workflowResult = { errors: [] };

  if (inputCommands) {
    const { workflow, errors, mermaidDiagram } = await enhancedGenerateWorkflow(inputCommands);
    workflowResult = { workflow, errors, mermaidDiagram };

    if (errors.length || !workflow) {
      await logger.log('runAudit', inputCommands, JSON.stringify({ errors }), { errors }, 'error', 'WORKFLOW_ERROR');
      return { errors };
    }

    for (const step of workflow.steps) {
      const logData = { step };
      switch (step.type) {
        case 'set':
          await logger.log('executeSet', JSON.stringify(step), JSON.stringify({ target: step.target, value: step.value }), logData);
          break;
        case 'if':
          await logger.log('executeIf', JSON.stringify(step.condition), JSON.stringify({ then: step.then, else: step.else }), logData);
          break;
        case 'while':
          await logger.log('executeWhile', JSON.stringify(step.condition), JSON.stringify(step.body), logData);
          break;
        case 'wait':
          await logger.log('executeWait', JSON.stringify(step.duration), JSON.stringify({}), logData);
          break;
        case 'return':
          await logger.log('executeReturn', JSON.stringify(step.value), JSON.stringify({}), logData);
          break;
        case 'break':
          await logger.log('executeBreak', JSON.stringify({}), JSON.stringify({}), logData);
          break;
        case 'call':
          await logger.log('executeCall', JSON.stringify(step.endpoint), JSON.stringify({ target: step.target }), logData);
          break;
        case 'ai_classify':
          await logger.log('executeAIAnalysis', JSON.stringify(step.input), JSON.stringify({ model: step.model, target: step.target }), logData);
          break;
        case 'ui_render':
          await logger.log('executeUIRender', JSON.stringify(step.component), JSON.stringify({ target: step.target }), logData);
          break;
        case 'ui_state':
          await logger.log('executeUIState', JSON.stringify(step.state), JSON.stringify({}), logData);
          break;
        case 'css_style':
          await logger.log('executeCSSStyle', JSON.stringify(step.styles), JSON.stringify({}), logData);
          break;
        case 'ui_event':
          await logger.log('executeUIEvent', JSON.stringify(step.event), JSON.stringify({}), logData);
          break;
      }
    }
  }

  await securitySystem.establishBaseline();
  const signal = await securitySystem.generateSignal(true, seed);
  const result = await securitySystem.detectAnomaly(signal);
  result.workflow = workflowResult.workflow;
  result.mermaidDiagram = workflowResult.mermaidDiagram;
  return result;
}

// Web Interface
function startWebServer(logger, port = 3000) {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json());

  app.get('/logs', async (req, res) => {
    res.json(logger.getLogs());
  });

  app.get('/mermaid/:workflowId', async (req, res) => {
    const workflowId = req.params.workflowId;
    const log = logger.getLogs().find(l => l.metadata?.workflow?.function === workflowId);
    if (log && log.metadata?.workflow?.mermaidDiagram) {
      res.send(log.metadata.workflow.mermaidDiagram);
    } else {
      res.status(404).send('Workflow not found');
    }
  });

  app.listen(port, () => {
    console.log(`Web interface running at http://localhost:${port}`);
  });
}

// CLI Implementation
const program = new Command();

program
  .name('enhanced-genesis-ai')
  .description('Enhanced Genesis AI Agent Framework CLI - Security, workflow automation, and UI')
  .version('1.0.0');

program
  .command('audit')
  .description('Run a security audit with optional workflow commands')
  .option('-i, --input <file>', 'Input file with workflow commands')
  .option('-s, --seed <number>', 'Random seed for signal generation', '42')
  .option('-o, --output <file>', 'Output file for audit results', 'audit_result.json')
  .option('-c, --ceramic <url>', 'Ceramic node URL for log anchoring')
  .option('-n, --neural', 'Use neural network for anomaly detection', false)
  .action(async (options) => {
    try {
      const logger = new EnhancedLogger({ useIPFS: true, ceramicUrl: options.ceramic });
      let inputCommands = '';

      if (options.input) {
        inputCommands = await fs.readFile(options.input, 'utf8');
      }

      const result = await runAudit({ seed: parseInt(options.seed), inputCommands, useNeuralNetwork: options.neural, logger });
      await fs.writeFile(options.output, JSON.stringify(result, null, 2));
      console.log(`Audit Result saved to ${options.output}`);

      const { ipfsCid, ceramicId } = await logger.save();
      console.log('Audit Log CID:', ipfsCid);
      console.log('Ceramic Stream ID:', ceramicId);

      if (result.mermaidDiagram) {
        const mermaidFile = options.output.replace('.json', '.mmd');
        await fs.writeFile(mermaidFile, result.mermaidDiagram);
        console.log(`Mermaid diagram saved to ${mermaidFile}`);
      }

      startWebServer(logger);
    } catch (err) {
      console.error('Error running audit:', err.message);
      process.exit(1);
    }
  });

program
  .command('workflow')
  .description('Generate and visualize a workflow from commands')
  .option('-i, --input <file>', 'Input file with workflow commands', 'commands.txt')
  .option('-o, --output <file>', 'Output file for workflow JSON', 'workflow.json')
  .option('-m, --mermaid <file>', 'Output file for Mermaid diagram', 'workflow.mmd')
  .action(async (options) => {
    try {
      const input = await fs.readFile(options.input, 'utf8');
      const { workflow, errors, mermaidDiagram } = await enhancedGenerateWorkflow(input);

      if (errors.length) {
        console.error('Errors:', errors);
        process.exit(1);
      }

      await fs.writeFile(options.output, JSON.stringify(workflow, null, 2));
      console.log(`Workflow saved to ${options.output}`);

      if (mermaidDiagram) {
        await fs.writeFile(options.mermaid, mermaidDiagram);
        console.log(`Mermaid diagram saved to ${options.mermaid}`);
      }
    } catch (err) {
      console.error('Error generating workflow:', err.message);
      process.exit(1);
    }
  });

program
  .command('verify-log')
  .description('Verify the integrity of a log entry')
  .option('-i, --index <number>', 'Log entry index to verify', parseInt)
  .option('-l, --log-file <file>', 'Audit log file', 'audit_log.jsonl')
  .option('-c, --ceramic <url>', 'Ceramic node URL for log anchoring')
  .action(async (options) => {
    try {
      const logger = new EnhancedLogger({ useIPFS: true, ceramicUrl: options.ceramic });
      await logger.initIPFS();
      const data = await fs.readFile(options.logFile, 'utf8');
      logger.logs = data.split('\n')
        .filter(Boolean)
        .map(line => {
          const json = JSON.parse(line);
          const entry = new TCCLogEntry({
            step: json.step,
            operation: json.operation,
            inputBuffer: Buffer.from(json.input, 'base64'),
            outputBuffer: Buffer.from(json.output, 'base64'),
            metadata: json.metadata,
            level: json.level,
            errorCode: json.errorCode,
            prevHash: Buffer.from(json.prevHash, 'base64')
          });
          entry.ipfsCid = json.ipfsCid;
          entry.ceramicId = json.ceramicId;
          entry.timestamp = json.timestamp;
          entry.operationId = json.operationId;
          return entry;
        });

      const isValid = await logger.verifyLogIntegrity(options.index);
      console.log(`Log entry ${options.index} is ${isValid ? 'valid' : 'invalid'}`);
    } catch (err) {
      console.error('Error verifying log:', err.message);
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}

module.exports = { EnhancedLogger, EnhancedSecuritySystem, enhancedGenerateWorkflow, runAudit };
