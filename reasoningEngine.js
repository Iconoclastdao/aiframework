// ReasoningEngine.js

class ReasoningEngine {
  constructor(knowledgePool, auditLogger) {
    this.kg = knowledgePool;
    this.logger = auditLogger;
  }

  query(subject, predicate) {
    const fact = this.kg.getFact(subject, predicate);
    this.logger.log('query', { subject, predicate, result: fact });
    return fact;
  }

  assert(fact, confidence = 1.0) {
    this.kg.addFact(fact, confidence);
    this.logger.log('assert', fact);
  }

  explain(subject, predicate) {
    const fact = this.kg.getFact(subject, predicate);
    const explanation = fact
      ? `Fact exists: ${subject} ${predicate} ${fact.object}`
      : `No known fact: ${subject} ${predicate}`;
    this.logger.log('explain', { subject, predicate, explanation });
    return explanation;
  }

  challenge(subject, predicate, expected) {
    const fact = this.kg.getFact(subject, predicate);
    const verdict = fact?.object === expected;
    this.logger.log('challenge', { subject, predicate, expected, actual: fact?.object, verdict });
    return verdict;
  }

  think(goalFn) {
    const facts = this.kg.exportFacts();
    const result = goalFn(facts);
    this.logger.log('think', { goal: goalFn.toString(), result });
    return result;
  }
}

module.exports = ReasoningEngine;
