const SOUND_PREF_KEY = "creature-sound-enabled-v1";

function centsToRate(cents) {
  return 2 ** (cents / 1200);
}

export class SoundEngine {
  constructor(options = {}) {
    this.volume = Number(options.volume) || 0.16;
    this.stepMinIntervalMs = Number(options.stepMinIntervalMs) || 34;
    this.enabled = this.readEnabledPreference();
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.toneFilter = null;
    this.noiseBuffer = null;
    this.lastStepAt = { head: 0, torso: 0, legs: 0, feet: 0 };
  }

  readEnabledPreference() {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) === "1";
    } catch {
      return false;
    }
  }

  persistEnabledPreference() {
    try {
      localStorage.setItem(SOUND_PREF_KEY, this.enabled ? "1" : "0");
    } catch {
      // Ignore storage issues and keep going silently.
    }
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this.persistEnabledPreference();
  }

  async initFromUserGesture() {
    this.setEnabled(true);

    if (!this.ctx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return false;
      }

      this.ctx = new AudioContextCtor();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 2.4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;

      this.toneFilter = this.ctx.createBiquadFilter();
      this.toneFilter.type = "lowpass";
      this.toneFilter.frequency.value = 9200;
      this.toneFilter.Q.value = 0.3;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;

      this.compressor.connect(this.toneFilter);
      this.toneFilter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    return this.ctx.state === "running";
  }

  async unlock() {
    if (!this.enabled) {
      return false;
    }

    if (!this.ctx) {
      return this.initFromUserGesture();
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    return this.ctx.state === "running";
  }

  createNoiseBuffer() {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * 0.8));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < length; i += 1) {
      channel[i] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  canPlay() {
    return Boolean(this.enabled && this.ctx && this.ctx.state === "running" && this.compressor);
  }

  connectVoice(node) {
    node.connect(this.compressor);
  }

  jitter(min, max) {
    return min + Math.random() * (max - min);
  }

  partVoice(part) {
    const voices = {
      head: { freq: 980, filter: 3600, click: 0.032 },
      torso: { freq: 760, filter: 2700, click: 0.036 },
      legs: { freq: 620, filter: 2100, click: 0.039 },
      feet: { freq: 490, filter: 1700, click: 0.042 },
    };

    return voices[part] || voices.torso;
  }

  tone({
    type = "sine",
    freq = 440,
    gain = 0.05,
    start = this.ctx.currentTime,
    attack = 0.003,
    hold = 0.01,
    release = 0.08,
    detune = 0,
    endFreq = null,
  }) {
    if (!this.canPlay()) {
      return;
    }

    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.detune.setValueAtTime(detune, start);
    if (endFreq != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + attack + hold + release);
    }

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.72), start + attack + hold);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);

    osc.connect(amp);
    this.connectVoice(amp);
    osc.start(start);
    osc.stop(start + attack + hold + release + 0.03);
  }

  noise({
    gain = 0.03,
    start = this.ctx.currentTime,
    attack = 0.001,
    hold = 0.008,
    release = 0.05,
    type = "bandpass",
    freq = 1800,
    endFreq = null,
    q = 0.8,
  }) {
    if (!this.canPlay() || !this.noiseBuffer) {
      return;
    }

    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const amp = this.ctx.createGain();

    src.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(freq, start);
    filter.Q.setValueAtTime(q, start);
    if (endFreq != null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), start + attack + hold + release);
    }

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.65), start + attack + hold);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);

    src.connect(filter);
    filter.connect(amp);
    this.connectVoice(amp);
    src.start(start);
    src.stop(start + attack + hold + release + 0.04);
  }

  step(part, dir) {
    if (!this.canPlay()) {
      return;
    }

    const nowMs = performance.now();
    const last = this.lastStepAt[part] || 0;
    if (nowMs - last < this.stepMinIntervalMs) {
      return;
    }
    this.lastStepAt[part] = nowMs;

    const voice = this.partVoice(part);
    const start = this.ctx.currentTime;
    const detune = this.jitter(-18, 18);
    const directionTilt = dir > 0 ? 1.035 : 0.968;

    this.noise({
      start,
      gain: voice.click,
      attack: 0.001,
      hold: 0.004,
      release: 0.03,
      freq: voice.filter * this.jitter(0.94, 1.06),
      q: 1.2,
    });

    this.tone({
      start,
      type: "triangle",
      freq: voice.freq * directionTilt * centsToRate(detune),
      gain: 0.022,
      attack: 0.002,
      hold: 0.006,
      release: 0.05,
    });
  }

  randomizeStart() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.noise({
      start,
      gain: 0.026,
      attack: 0.002,
      hold: 0.02,
      release: 0.14,
      type: "bandpass",
      freq: 540,
      endFreq: 2600,
      q: 0.9,
    });
    this.tone({
      start,
      type: "sine",
      freq: 210,
      endFreq: 430,
      gain: 0.018,
      attack: 0.004,
      hold: 0.04,
      release: 0.12,
      detune: this.jitter(-12, 12),
    });
  }

  randomizeEnd() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.tone({
      start,
      type: "triangle",
      freq: 560 * centsToRate(this.jitter(-8, 10)),
      gain: 0.026,
      attack: 0.002,
      hold: 0.016,
      release: 0.09,
    });
    this.tone({
      start: start + 0.018,
      type: "sine",
      freq: 820 * centsToRate(this.jitter(-10, 10)),
      gain: 0.018,
      attack: 0.002,
      hold: 0.008,
      release: 0.07,
    });
  }

  original() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.tone({ start, type: "triangle", freq: 420, gain: 0.02, attack: 0.003, hold: 0.012, release: 0.08 });
    this.tone({ start: start + 0.028, type: "sine", freq: 630, gain: 0.018, attack: 0.002, hold: 0.008, release: 0.07 });
  }

  back() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.tone({ start, type: "triangle", freq: 360, endFreq: 280, gain: 0.022, attack: 0.002, hold: 0.006, release: 0.08 });
    this.noise({ start, gain: 0.012, attack: 0.001, hold: 0.003, release: 0.03, freq: 1200, q: 0.7 });
  }

  lockOn(part) {
    if (!this.canPlay()) {
      return;
    }

    const voice = this.partVoice(part);
    const start = this.ctx.currentTime;
    this.tone({
      start,
      type: "square",
      freq: voice.freq * 0.78 * centsToRate(this.jitter(-14, 10)),
      gain: 0.015,
      attack: 0.001,
      hold: 0.006,
      release: 0.06,
    });
  }

  lockOff(part) {
    if (!this.canPlay()) {
      return;
    }

    const voice = this.partVoice(part);
    const start = this.ctx.currentTime;
    this.tone({
      start,
      type: "triangle",
      freq: voice.freq * 0.66 * centsToRate(this.jitter(-10, 10)),
      gain: 0.012,
      attack: 0.001,
      hold: 0.004,
      release: 0.05,
    });
  }

  stamp() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.noise({
      start,
      gain: 0.03,
      attack: 0.001,
      hold: 0.01,
      release: 0.1,
      type: "bandpass",
      freq: 180,
      endFreq: 480,
      q: 2.8,
    });
    this.tone({
      start,
      type: "sine",
      freq: 130,
      endFreq: 96,
      gain: 0.04,
      attack: 0.001,
      hold: 0.012,
      release: 0.11,
    });
    this.noise({
      start: start + 0.024,
      gain: 0.01,
      attack: 0.001,
      hold: 0.002,
      release: 0.03,
      freq: 3200,
      q: 1.4,
    });
  }

  matchPart(part) {
    if (!this.canPlay()) {
      return;
    }

    const voice = this.partVoice(part);
    const start = this.ctx.currentTime;
    this.tone({
      start,
      type: "sine",
      freq: voice.freq * 1.14 * centsToRate(this.jitter(-8, 8)),
      gain: 0.014,
      attack: 0.002,
      hold: 0.01,
      release: 0.12,
    });
  }

  matchAll() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.tone({ start, type: "sine", freq: 520, gain: 0.016, attack: 0.002, hold: 0.008, release: 0.12 });
    this.tone({ start: start + 0.04, type: "sine", freq: 660, gain: 0.015, attack: 0.002, hold: 0.008, release: 0.12 });
    this.tone({ start: start + 0.08, type: "triangle", freq: 820, gain: 0.016, attack: 0.002, hold: 0.012, release: 0.14 });
  }

  nope() {
    if (!this.canPlay()) {
      return;
    }

    const start = this.ctx.currentTime;
    this.noise({
      start,
      gain: 0.012,
      attack: 0.001,
      hold: 0.003,
      release: 0.05,
      freq: 640,
      endFreq: 420,
      q: 1.4,
    });
    this.tone({
      start,
      type: "sawtooth",
      freq: 180,
      endFreq: 150,
      gain: 0.01,
      attack: 0.001,
      hold: 0.004,
      release: 0.06,
    });
  }
}
