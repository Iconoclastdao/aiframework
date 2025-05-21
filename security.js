const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class TCCLogger {
  constructor(level = 'info') {
    this.logs = [];
    this.step = 0;
    this.level = level;
  }

  _prevHash() {
    if (this.logs.length === 0) return Buffer.alloc(32);
    return crypto.createHash('sha256').update(this.logs[this.logs.length - 1].toBytes()).digest();
  }

  log(operation, input, output, metadata = {}, level = 'info', errorCode = 'NONE') {
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
  }

  save(filename = 'audit_log.jsonl') {
    fs.writeFileSync(filename, this.logs.map(e => JSON.stringify(e.toJSON())).join('\n'));
  }
}

class TCCLogEntry {
  constructor({ step, operation, inputBuffer, outputBuffer, metadata, level, errorCode, prevHash }) {
    this.step = step;
    this.operation = operation;
    this.input = inputBuffer;
    this.output = outputBuffer;
    this.metadata = metadata;
    this.level = level;
    this.errorCode = errorCode;
    this.prevHash = prevHash;
    this.timestamp = Date.now();
    this.operationId = crypto.createHash('sha256')
      .update(`${step}:${operation}:${Date.now()}`).digest('hex').slice(0, 32);
  }

  toBytes() {
    return Buffer.concat([
      Buffer.from(this.step.toString()),
      this.input,
      this.output,
      this.prevHash
    ]);
  }

  toJSON() {
    return {
      step: this.step,
      operation: this.operation,
      input: this.input.toString('base64'),
      output: this.output.toString('base64'),
      metadata: this.metadata,
      level: this.level,
      errorCode: this.errorCode,
      prevHash: this.prevHash.toString('base64'),
      operationId: this.operationId,
      timestamp: this.timestamp
    };
  }
}

class BioInspiredSecuritySystem {
  constructor({ sampleRate = 1000, windowSize = 128, logger = new TCCLogger() } = {}) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.logger = logger;
    this.baseline = [];
  }

  generateSignal(isMalicious = false, seed = 42) {
    const t = Array.from({ length: this.windowSize }, (_, i) => i / this.sampleRate);
    const base = t.map(ti =>
      Math.sin(2 * Math.PI * 5 * ti) +
      0.5 * Math.sin(2 * Math.PI * 10 * ti) +
      0.2 * Math.sin(2 * Math.PI * 20 * ti)
    );
    const noise = t.map(() => (Math.random() - 0.5) * 0.3);
    let signal = base.map((v, i) => v + noise[i]);

    if (isMalicious) {
      const freq = 45 + Math.random() * 10;
      const anomaly = t.map((ti, i) => 0.8 * Math.sin(2 * Math.PI * freq * ti) * (1 + Math.random()));
      signal = signal.map((v, i) => v + anomaly[i]);
    }

    this.logger.log('generateSignal', JSON.stringify({ isMalicious, seed }), Buffer.from(Float32Array.from(signal).buffer), { isMalicious });
    return signal;
  }

  fft(signal) {
    const re = [...signal];
    const im = new Array(signal.length).fill(0);
    const N = signal.length;

    for (let k = 0; k < N; k++) {
      re[k] = signal.reduce((sum, x_n, n) => sum + x_n * Math.cos((2 * Math.PI * k * n) / N), 0);
      im[k] = -signal.reduce((sum, x_n, n) => sum + x_n * Math.sin((2 * Math.PI * k * n) / N), 0);
    }

    const magnitudes = re.map((re, i) => Math.sqrt(re ** 2 + im[i] ** 2));
    const freqs = Array.from({ length: N }, (_, k) => k * this.sampleRate / N);

    this.logger.log('fft', Buffer.from(Float32Array.from(signal).buffer), Buffer.from(Float32Array.from(magnitudes).buffer), { N });
    return { freqs, magnitudes };
  }

  establishBaseline(numSamples = 5) {
    const magSets = [];

    for (let i = 0; i < numSamples; i++) {
      const signal = this.generateSignal(false, i);
      const { magnitudes } = this.fft(signal);
      magSets.push(magnitudes);
    }

    this.baseline = magSets[0].map((_, i) =>
      magSets.reduce((sum, mags) => sum + mags[i], 0) / magSets.length
    );

    this.logger.log('establishBaseline', Buffer.from(''), Buffer.from(Float32Array.from(this.baseline).buffer), { numSamples });
    return this.baseline;
  }

  detectAnomaly(signal) {
    const { magnitudes } = this.fft(signal);
    const deviation = magnitudes.map((m, i) => Math.abs(m - this.baseline[i] || 0));
    const meanDeviation = deviation.reduce((a, b) => a + b, 0) / deviation.length;
    const isAnomaly = meanDeviation > 5; // Threshold tuned manually

    const explanation = isAnomaly
      ? `Anomaly detected. Mean deviation: ${meanDeviation.toFixed(2)}`
      : `No anomaly. Deviation: ${meanDeviation.toFixed(2)}`;

    this.logger.log(
      'detectAnomaly',
      Buffer.from(Float32Array.from(signal).buffer),
      Buffer.from(JSON.stringify({ isAnomaly })),
      { meanDeviation, isAnomaly, explanation }
    );

    return { isAnomaly, meanDeviation, explanation };
  }

  runAudit(seed = 42) {
    const signal = this.generateSignal(true, seed);
    const result = this.detectAnomaly(signal);
    return result;
  }
}

module.exports = {
  TCCLogger,
  BioInspiredSecuritySystem
};
