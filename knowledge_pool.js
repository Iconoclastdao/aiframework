
class KnowledgePool {
  constructor() {
    this.entries = new Map(); // Canonical key → fact object
  }

  _normalize(fact) {
    const base = `${fact.subject}:${fact.predicate}:${fact.object || ''}`;
    return base.toLowerCase().replace(/\s+/g, '_');
  }

  /**
   * Adds or updates a fact based on timestamp and confidence
   */
  addFact(fact, confidence = 1.0) {
    const key = this._normalize(fact);
    const now = Date.now();

    const newFact = {
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object || null,
      confidence,
      timestamp: now
    };

    if (this.entries.has(key)) {
      const existing = this.entries.get(key);
      if (confidence > existing.confidence || now > existing.timestamp) {
        this.entries.set(key, newFact);
      }
    } else {
      this.entries.set(key, newFact);
    }
  }

  /**
   * Force-update a fact, ignoring timestamp/confidence
   */
  updateFact(fact, confidence = 1.0) {
    const key = this._normalize(fact);
    this.entries.set(key, {
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object || null,
      confidence,
      timestamp: Date.now()
    });
  }

  /**
   * Retrieves a specific fact
   */
  getFact(subject, predicate, object = null) {
    const key = this._normalize({ subject, predicate, object });
    return this.entries.get(key) || null;
  }

  /**
   * Returns facts matching a filter function
   */
  findFacts(filterFn = () => true) {
    return Array.from(this.entries.values()).filter(filterFn);
  }

  /**
   * Removes a specific fact
   */
  removeFact(subject, predicate, object = null) {
    const key = this._normalize({ subject, predicate, object });
    this.entries.delete(key);
  }

  /**
   * Merge in another knowledge pool (respects timestamp/confidence)
   */
  mergePool(otherPool) {
    for (const fact of otherPool.exportFacts()) {
      this.addFact(fact, fact.confidence);
    }
  }

  /**
   * Export all facts
   */
  exportFacts() {
    return Array.from(this.entries.values());
  }

  /**
   * Remove facts with low confidence
   */
  cleanLowConfidence(threshold = 0.5) {
    for (const [key, fact] of this.entries.entries()) {
      if (fact.confidence < threshold) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Sort facts by confidence or timestamp
   */
  rankFacts(by = 'confidence') {
    return this.exportFacts().sort((a, b) => b[by] - a[by]);
  }

  /**
   * Search all facts by subject
   */
  searchBySubject(subject) {
    const normalized = subject.toLowerCase().replace(/\s+/g, '_');
    return this.findFacts(f => f.subject.toLowerCase().replace(/\s+/g, '_') === normalized);
  }

  /**
   * Search all facts by predicate
   */
  searchByPredicate(predicate) {
    const normalized = predicate.toLowerCase().replace(/\s+/g, '_');
    return this.findFacts(f => f.predicate.toLowerCase().replace(/\s+/g, '_') === normalized);
  }

  /**
   * Load facts from JSON array
   */
  loadFromJSON(jsonArray) {
    for (const fact of jsonArray) {
      this.addFact(fact, fact.confidence || 1.0);
    }
  }

  /**
   * Serialize facts as JSON array
   */
  toJSON() {
    return this.exportFacts();
  }

  /**
   * Parse fact-like statements from plain text input
   */
  autoIngest(text, defaultConfidence = 0.8) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^(.*?)( is | are | has | equals | means | consists of | composed of )(.*?)\.?$/i);
      if (match) {
        const [, subject, predicate, object] = match;
        this.addFact(
          {
            subject: subject.trim(),
            predicate: predicate.trim().replace(/\s+/g, '_'),
            object: object.trim()
          },
          defaultConfidence
        );
      }
    }
  }

  /**
   * Sync to IPFS (requires ipfs-core instance)
   */
  async syncWithIPFS(ipfs) {
    const data = JSON.stringify(this.toJSON());
    const { cid } = await ipfs.add(data);
    return cid.toString();
  }
}

// Example: CLI testing (run directly)
if (require.main === module) {
  const pool = new KnowledgePool();

  pool.addFact({ subject: 'water', predicate: 'is_composed_of', object: 'H2O' }, 1.0);
  pool.addFact({ subject: 'gravity', predicate: 'is_theory' }, 0.7);
  pool.addFact({ subject: 'gravity', predicate: 'is_force' }, 0.4);

  console.log('\n✅ FACT: What is water made of?');
  console.log(pool.getFact('water', 'is_composed_of'));

  console.log('\n🧹 CLEAN: Removing low confidence...');
  pool.cleanLowConfidence(0.5);
  console.log(pool.exportFacts());

  console.log('\n🧠 RANKED FACTS BY CONFIDENCE:');
  console.log(pool.rankFacts());

  console.log('\n🔎 SEARCH: By subject "gravity"');
  console.log(pool.searchBySubject('gravity'));

  console.log('\n🧬 Ingesting natural language...');
  pool.autoIngest(`
    Water is composed of H2O.
    Light is electromagnetic radiation.
    Electrons are negatively charged.
    Gravity is a theory.
  `);

  console.log('\n🧠 Updated Fact Pool:');
  console.log(JSON.stringify(pool.toJSON(), null, 2));
}

module.exports = {
  KnowledgePool
};
