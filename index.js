const { Command } = require('commander');
const KnowledgeGraph = require('./knowledgeGraph');
const ReasoningEngine = require('./reasoningEngine');
const FactExtractor = require('./factExtractor');
const AuditLogger = require('./auditLogger');

const program = new Command();
const kg = new KnowledgeGraph();
const logger = new AuditLogger();
const reasoner = new ReasoningEngine(kg, logger);

program
  .command('extract-from-github')
  .description('Extract facts from a GitHub repo')
  .option('--repo <url>', 'GitHub repo URL')
  .action(async (options) => {
    const extractor = new FactExtractor();
    const facts = await extractor.extractFromRepo(options.repo);
    facts.forEach(fact => {
      kg.add(fact);
      logger.log('assert', fact);
    });
    console.log('Extracted facts:', facts);
  });

program
  .command('assert')
  .description('Assert a new fact')
  .argument('<fact>', 'Fact in JSON format, e.g., {"subject":"Water","predicate":"is","object":"wet"}')
  .action((fact) => {
    const parsedFact = JSON.parse(fact);
    kg.add(parsedFact);
    logger.log('assert', parsedFact);
    console.log('Fact asserted:', parsedFact);
  });

program
  .command('think')
  .description('Reason about a goal')
  .argument('<goal>', 'Goal to reason about')
  .action((goal) => {
    const result = reasoner.think(goal);
    console.log('Reasoning result:', result);
  });

program
  .command('explain')
  .description('Explain a fact')
  .argument('<fact>', 'Fact to explain in JSON format')
  .action((fact) => {
    const parsedFact = JSON.parse(fact);
    const explanation = reasoner.explain(parsedFact);
    console.log('Explanation:', explanation);
  });

program.parse(process.argv);
