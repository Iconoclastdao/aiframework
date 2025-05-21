// knowledge_pool.js

class KnowledgePool {
  constructor() {
    this.entries = new Map(); // key = canonical string, value = { fact, confidence, timestamp }
  }

  _normalize(fact) {
    const base = `${fact.subject}:${fact.predicate}:${fact.object || ''}`;
    return base.toLowerCase().replace(/\s+/g, '_');
  }

  addFact(fact, confidence = 1.0) {
    const key = this._normalize(fact);
    const now = Date.now();

    if (this.entries.has(key)) {
      const existing = this.entries.get(key);
      // Update if newer or higher confidence
      if (confidence > existing.confidence || now > existing.timestamp) {
        this.entries.set(key, { ...fact, confidence, timestamp: now });
      }
    } else {
      this.entries.set(key, { ...fact, confidence, timestamp: now });
    }
  }

  getFact(subject, predicate, object = null) {
    const key = this._normalize({ subject, predicate, object });
    return this.entries.get(key) || null;
  }

  findFacts(filterFn = () => true) {
    return Array.from(this.entries.values()).filter(filterFn);
  }

  removeFact(subject, predicate, object = null) {
    const key = this._normalize({ subject, predicate, object });
    this.entries.delete(key);
  }

  mergePool(otherPool) {
    for (const fact of otherPool.exportFacts()) {
      this.addFact(fact, fact.confidence);
    }
  }

  exportFacts() {
    return Array.from(this.entries.values());
  }

  cleanLowConfidence(threshold = 0.5) {
    for (const [key, fact] of this.entries.entries()) {
      if (fact.confidence < threshold) {
        this.entries.delete(key);
      }
    }
  }

  toJSON() {
    return this.exportFacts();
  }

  loadFromJSON(jsonArray) {
    for (const fact of jsonArray) {
      this.addFact(fact, fact.confidence);
    }
  }
}

// Example Usage
if (require.main === module) {
  const pool = new KnowledgePool();

  pool.addFact({ subject: 'water', predicate: 'is_composed_of', object: 'H2O' }, 1.0);
  pool.addFact({ subject: 'water', predicate: 'is_composed_of', object: 'H2O' }, 0.9); // older, ignored
  pool.addFact({ subject: 'gravity', predicate: 'is_theory' }, 0.7);
  pool.addFact({ subject: 'gravity', predicate: 'is_force' }, 0.4); // low confidence

  console.log('\n✅ FACT: What is water made of?');
  console.log(pool.getFact('water', 'is_composed_of'));

  console.log('\n🧹 CLEAN: Removing low confidence...');
  pool.cleanLowConfidence(0.5);
  console.log(pool.exportFacts());

  console.log('\n🧠 ALL FACTS:');
  console.log(JSON.stringify(pool.toJSON(), null, 2));
}

module.exports = { KnowledgePool };
