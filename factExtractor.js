const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
// Note: compromise is assumed to be in aiframework.git
const nlp = require('compromise');

class FactExtractor {
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(JavaScript);
  }

  async extractFromRepo(repoUrl) {
    // Mock repo fetching (replace with actual GitHub API call in production)
    const mockCode = `
      // Example LLM code
      const model = {
        temperature: 0.7,
        max_tokens: 512,
        prompt: "You are a helpful assistant."
      };
    `;
    const mockText = "Prompt engineering affects generation quality.";

    const facts = [];

    // Parse code with tree-sitter
    const tree = this.parser.parse(mockCode);
    this.traverseTree(tree.rootNode, facts);

    // Parse text with compromise
    const doc = nlp(mockText);
    const sentences = doc.sentences().out('array');
    sentences.forEach(sentence => {
      const terms = nlp(sentence).terms().out('array');
      if (terms.length >= 3) {
        facts.push({
          subject: terms[0],
          predicate: terms[1],
          object: terms[2]
        });
      }
    });

    return facts;
  }

  traverseTree(node, facts) {
    if (node.type === 'property_identifier' && node.parent.type === 'pair') {
      const key = node.text;
      const valueNode = node.parent.children[2];
      if (valueNode.type === 'string' || valueNode.type === 'number') {
        facts.push({
          subject: 'Model',
          predicate: 'has',
          object: `${key}:${valueNode.text}`
        });
      }
    }
    node.children.forEach(child => this.traverseTree(child, facts));
  }
}

module.exports = FactExtractor;
