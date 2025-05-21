const mermaid = require('mermaid');

class Visualizer {
  constructor() {
    mermaid.initialize({ startOnLoad: false });
  }

  generateDiagram(fact, trace) {
    let diagram = 'graph TD\n';
    trace.forEach((step, i) => {
      diagram += `  A${i}["${step}"] -->|derived| A${i + 1}["${fact.subject} ${fact.predicate} ${fact.object}"]\n`;
    });
    return mermaid.render('reasoningDiagram', diagram);
  }
}

module.exports = Visualizer;
