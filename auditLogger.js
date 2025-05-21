class AuditLogger {
  constructor() {
    this.logs = [];
  }

  log(action, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      data
    };
    this.logs.push(entry);
    // In production, extend with QuantumTCCLogger for persistent storage
    console.log('Audit:', entry);
  }

  getLogs() {
    return this.logs;
  }
}

module.exports = AuditLogger;
