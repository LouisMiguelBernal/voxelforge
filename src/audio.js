// ---------------------------------------------------------------------------
// Fully procedural WebAudio SFX — synthesized oscillators + filtered noise.
// No audio files. Context is created lazily on the first user gesture.
// ---------------------------------------------------------------------------

export class Sound {
  constructor() {
    this.ctx = null
    this.on = true
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.on ? 0.3 : 0
    this.master.connect(this.ctx.destination)
    this._noiseBuf = this._makeNoise()
    this._ambient()
  }

  toggle() {
    this.on = !this.on
    if (this.master) this.master.gain.value = this.on ? 0.3 : 0
    return this.on
  }

  _makeNoise() {
    const len = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  // short oscillator sweep
  _tone({ f0 = 200, f1 = f0, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + dur + 0.02)
  }

  // filtered noise burst
  _noise({ f0 = 800, f1 = 200, q = 1, dur = 0.15, vol = 0.2, delay = 0 }) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime + delay
    const s = this.ctx.createBufferSource()
    s.buffer = this._noiseBuf
    s.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'; f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f); f.connect(g); g.connect(this.master)
    s.start(t); s.stop(t + dur + 0.02)
  }

  // low ambient wind hum, breathes slowly
  _ambient() {
    const s = this.ctx.createBufferSource()
    s.buffer = this._noiseBuf; s.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'; f.frequency.value = 160
    const g = this.ctx.createGain()
    g.gain.value = 0.045
    const lfo = this.ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lg = this.ctx.createGain()
    lg.gain.value = 0.02
    lfo.connect(lg); lg.connect(g.gain)
    s.connect(f); f.connect(g); g.connect(this.master)
    s.start(); lfo.start()
  }

  // ---- game events ----
  swing(sp = 1)  { this._noise({ f0: 1400, f1: 260, dur: 0.16 / Math.max(0.5, sp), vol: 0.13, q: 1.4 }) }
  hit()          { this._tone({ f0: 150, f1: 55, dur: 0.1, vol: 0.26 }); this._noise({ f0: 900, f1: 300, dur: 0.07, vol: 0.12 }) }
  kill()         { this._tone({ f0: 95, f1: 38, dur: 0.3, type: 'sawtooth', vol: 0.22 }); this._noise({ f0: 500, f1: 100, dur: 0.25, vol: 0.16 }) }
  crack()        { this._noise({ f0: 1200, f1: 500, dur: 0.05, vol: 0.08 }) }
  breakBlock()   { this._noise({ f0: 700, f1: 170, dur: 0.18, vol: 0.2, q: 0.8 }); this._tone({ f0: 210, f1: 90, dur: 0.08, vol: 0.1 }) }
  place()        { this._tone({ f0: 320, f1: 250, dur: 0.05, type: 'square', vol: 0.09 }) }
  jump()         { this._tone({ f0: 170, f1: 300, dur: 0.09, type: 'square', vol: 0.07 }) }
  land(v = 5)    { this._tone({ f0: 100, f1: 45, dur: 0.12, vol: Math.min(0.3, v * 0.03) }); this._noise({ f0: 300, f1: 120, dur: 0.08, vol: Math.min(0.15, v * 0.015) }) }
  step()         { this._noise({ f0: 320, f1: 150, dur: 0.05, vol: 0.05, q: 0.7 }) }
  hurt()         { this._tone({ f0: 260, f1: 85, dur: 0.28, type: 'sawtooth', vol: 0.2 }) }
  pickup()       { this._tone({ f0: 480, dur: 0.07, type: 'square', vol: 0.1 }); this._tone({ f0: 720, dur: 0.09, type: 'square', vol: 0.1, delay: 0.07 }) }
  zap()          { this._tone({ f0: 1200, f1: 180, dur: 0.08, type: 'square', vol: 0.08 }) }
  click()        { this._tone({ f0: 800, f1: 600, dur: 0.04, type: 'square', vol: 0.07 }) }
  die()          { this._tone({ f0: 220, f1: 30, dur: 0.7, type: 'sawtooth', vol: 0.25 }); this._noise({ f0: 400, f1: 60, dur: 0.6, vol: 0.18 }) }
}
