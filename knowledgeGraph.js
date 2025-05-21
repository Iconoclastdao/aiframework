const { Store, DataFactory } = require('n3');
const { namedNode, literal } = DataFactory;

class KnowledgeGraph {
  constructor() {
    this.store = new Store();
  }

  add(fact) {
    const { subject, predicate, object } = fact;
    this.store.addQuad(
      namedNode(subject),
      namedNode(predicate),
      literal(object)
    );
  }

  get(subject, predicate) {
    const quads = this.store.getQuads(
      subject ? namedNode(subject) : null,
      predicate ? namedNode(predicate) : null,
      null
    );
    return quads.map(quad => ({
      subject: quad.subject.value,
      predicate: quad.predicate.value,
      object: quad.object.value
    }));
  }

  trace(fact) {
    const { subject, predicate, object } = fact;
    const quads = this.get(subject, predicate);
    if (quads.some(q => q.object === object)) {
      return [`${subject} ${predicate} ${object} (direct fact)`];
    }
    // Simple forward-chaining for derivation
    const related = this.get(subject, null);
    return related.map(r => `${subject} ${r.predicate} ${r.object}`);
  }

  verify(fact) {
    const { subject, predicate, object } = fact;
    const quads = this.get(subject, predicate);
    if (quads.some(q => q.object === object)) {
      return { valid: true, reason: 'Fact exists in knowledge base' };
    }
    // Check for contradictions
    const conflicts = quads.filter(q => q.object !== object);
    if (conflicts.length > 0) {
      return { valid: false, reason: `Contradiction found: ${JSON.stringify(conflicts)}` };
    }
    return { valid: false, reason: 'Fact not found' };
  }

  reason(goal) {
    // Simple backward-chaining for goal-directed reasoning
    const facts = this.get(null, null);
    const relevant = facts.filter(f => f.subject === goal || f.object === goal);
    if (relevant.length === 0) {
      return `No facts found for goal: ${goal}`;
    }
    return relevant.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('\n');
  }
}

module.exports = KnowledgeGraph;
