class ReasoningEngine {
  constructor(knowledgeGraph, auditLogger) {
    this.kg = knowledgeGraph;
    this.logger = auditLogger;
  }

  query(subject, predicate) {
    return this.kg.get(subject, predicate);
  }

  assert(fact) {
    this.kg.add(fact);
    this.logger.log('assert', fact);
  }

  explain(fact) {
    const trace = this.kg.trace(fact);
    this.logger.log('explain', { fact, trace });
    return trace;
  }

  challenge(fact) {
    const verification = this.kg.verify(fact);
    this.logger.log('challenge', { fact, verification });
    return verification;
  }

  think(goal) {
    const result = this.kg.reason(goal);
    this.logger.log('think', { goal, result });
    return result;
  }
}

module.exports = ReasoningEngine;
