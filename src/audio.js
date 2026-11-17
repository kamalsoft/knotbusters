const KEY = 'knotbusters.audio';

export class Sfx {
  constructor() {
    this.muted = false;
    try {
      this.muted = JSON.parse(localStorage.getItem(KEY) || '{}').muted === true;
    } catch (e) {
      this.muted = false;
    }
    this.ctx = null;
  }

  ctxOrNull() {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(KEY, JSON.stringify({ muted: this.muted }));
    } catch (e) {
      return this.muted;
    }
    return this.muted;
  }

  tone(freq, dur, type, gain, when = 0, sweep = 0) {
    const c = this.ctxOrNull();
    if (!c || this.muted) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  clack() {
    this.tone(880, 0.06, 'triangle', 0.25, 0, 0.5);
    this.tone(220, 0.08, 'sine', 0.2);
  }

  friction() {
    this.tone(160, 0.12, 'sawtooth', 0.04, 0, 1.3);
  }

  lock() {
    this.tone(1320, 0.04, 'square', 0.08);
    this.tone(990, 0.05, 'square', 0.06, 0.05);
  }

  chime() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.15, i * 0.09));
  }
}
