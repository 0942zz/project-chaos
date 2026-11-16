/**
 * Fully synthesised sound library (Web Audio API) — no audio files.
 * Three independent buses: music, sfx, ambient. Nothing plays until
 * `unlock()` is called from a user gesture (browser autoplay policy).
 */
type Bus = 'music' | 'sfx' | 'ambient'
type Mood = 'calm' | 'tension' | 'bonus'

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)

class AudioEngine {
  private ctx: AudioContext | null = null
  private buses: Record<Bus, GainNode> | null = null
  private noise: AudioBuffer | null = null
  private volumes: Record<Bus, number> = { music: 0.55, sfx: 0.8, ambient: 0.5 }
  private mood: Mood = 'calm'
  private step = 0
  private nextNoteTime = 0
  private timer: number | null = null
  private lastTick = 0
  private lastPin = 0

  get unlocked(): boolean {
    return this.ctx !== null
  }

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    const master = ctx.createDynamicsCompressor()
    master.threshold.value = -14
    master.ratio.value = 4
    master.connect(ctx.destination)
    const mk = (bus: Bus): GainNode => {
      const g = ctx.createGain()
      g.gain.value = this.volumes[bus]
      g.connect(master)
      return g
    }
    this.buses = { music: mk('music'), sfx: mk('sfx'), ambient: mk('ambient') }

    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    this.startAmbient()
    this.nextNoteTime = ctx.currentTime + 0.1
    this.timer = window.setInterval(() => this.schedule(), 40)
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else void this.ctx.resume()
    })
  }

  setVolume(bus: Bus, v: number): void {
    this.volumes[bus] = v
    if (this.ctx && this.buses) this.buses[bus].gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  setMood(m: Mood): void {
    this.mood = m
  }

  /* ───────── primitives ───────── */

  private tone(
    freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; bus?: Bus; at?: number; attack?: number; slideTo?: number; detune?: number } = {},
  ): void {
    const ctx = this.ctx
    if (!ctx || !this.buses) return
    const t = opts.at ?? ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = opts.type ?? 'sine'
    o.frequency.setValueAtTime(freq, t)
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur)
    if (opts.detune) o.detune.value = opts.detune
    const peak = opts.gain ?? 0.2
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.buses[opts.bus ?? 'sfx'])
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private burst(
    dur: number, opts: { gain?: number; bus?: Bus; at?: number; type?: BiquadFilterType; freq?: number; q?: number; sweepTo?: number; attack?: number } = {},
  ): void {
    const ctx = this.ctx
    if (!ctx || !this.buses || !this.noise) return
    const t = opts.at ?? ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = opts.type ?? 'bandpass'
    f.frequency.setValueAtTime(opts.freq ?? 2000, t)
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur)
    f.Q.value = opts.q ?? 1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + (opts.attack ?? 0.004))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.buses[opts.bus ?? 'sfx'])
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /* ───────── ambient ───────── */

  private startAmbient(): void {
    const ctx = this.ctx
    if (!ctx || !this.buses || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const g = ctx.createGain()
    g.gain.value = 0.11
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.04
    lfo.connect(lfoGain).connect(g.gain)
    src.connect(lp).connect(g).connect(this.buses.ambient)
    src.start()
    lfo.start()
    for (const [f, v] of [[55, 0.05], [82.5, 0.025]] as const) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      const og = ctx.createGain()
      og.gain.value = v
      o.connect(og).connect(this.buses.ambient)
      o.start()
    }
  }

  /* ───────── generative music ───────── */

  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const bpm = this.mood === 'tension' ? 126 : this.mood === 'bonus' ? 132 : 108
    const sixteenth = 60 / bpm / 4
    if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime + 0.05
    while (this.nextNoteTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextNoteTime, sixteenth)
      this.nextNoteTime += sixteenth
      this.step = (this.step + 1) % 128
    }
  }

  private playStep(step: number, t: number, sixteenth: number): void {
    const chords = this.mood === 'bonus'
      ? [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [53, 60, 65, 69, 72], [48, 55, 60, 64, 67]]
      : [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]]
    const chord = chords[Math.floor(step / 32) % 4]
    const s = step % 32
    const m = this.mood
    if (s === 0) {
      for (let i = 1; i < 5; i++) {
        this.tone(midi(chord[i]), sixteenth * 30, { type: 'sawtooth', gain: 0.022, bus: 'music', at: t, attack: 0.6, detune: i % 2 ? 7 : -7 })
        this.tone(midi(chord[i]), sixteenth * 30, { type: 'triangle', gain: 0.03, bus: 'music', at: t, attack: 0.4 })
      }
    }
    const bassOn = m === 'calm' ? s % 8 === 0 || s % 16 === 6 : s % 4 === 0 || s % 8 === 6
    if (bassOn) this.tone(midi(chord[0] - 12), sixteenth * 2.2, { type: 'triangle', gain: 0.16, bus: 'music', at: t, attack: 0.01 })
    if (s % 8 === 0 && m !== 'calm') this.tone(110, 0.16, { type: 'sine', gain: 0.3, bus: 'music', at: t, slideTo: 38 })
    if (s % 4 === 2) this.burst(0.04, { gain: m === 'calm' ? 0.025 : 0.05, bus: 'music', at: t, type: 'highpass', freq: 7000 })
    if (m !== 'calm' && s % 8 === 4) this.burst(0.11, { gain: 0.06, bus: 'music', at: t, freq: 1800, q: 0.7 })
    const arp = m === 'calm' ? s % 4 === 0 : s % 2 === 0
    if (arp) {
      const pattern = [1, 2, 3, 4, 3, 2, 4, 3]
      const n = chord[pattern[(s / (m === 'calm' ? 4 : 2)) % 8 | 0]] + 12
      this.tone(midi(n), sixteenth * 1.8, { type: 'square', gain: m === 'calm' ? 0.014 : 0.024, bus: 'music', at: t })
    }
  }

  /* ───────── sound effects ───────── */

  ui(): void {
    this.tone(880, 0.06, { type: 'triangle', gain: 0.12 })
  }

  chip(): void {
    this.tone(1900, 0.05, { type: 'triangle', gain: 0.12 })
    this.burst(0.03, { gain: 0.1, freq: 5200, q: 3 })
  }

  beep(final: boolean): void {
    this.tone(final ? 1320 : 880, final ? 0.4 : 0.14, { type: 'square', gain: 0.07 })
    this.tone(final ? 660 : 440, final ? 0.4 : 0.14, { type: 'sine', gain: 0.12 })
  }

  lock(): void {
    this.tone(140, 0.3, { type: 'sine', gain: 0.4, slideTo: 50 })
    this.burst(0.09, { gain: 0.2, freq: 900, q: 0.8 })
  }

  whoosh(): void {
    this.burst(1.3, { gain: 0.16, freq: 300, sweepTo: 3600, q: 1.2, attack: 0.5 })
  }

  /** Pointer flapper striking a peg. `speed` is the wheel's angular speed. */
  tick(speed: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    if (t - this.lastTick < 0.028) return
    this.lastTick = t
    const v = Math.min(1, 0.35 + speed / 14)
    this.burst(0.022, { gain: 0.22 * v, freq: 3400 + Math.random() * 500, q: 2.5 })
    this.tone(1250 + Math.random() * 120, 0.035, { type: 'triangle', gain: 0.1 * v })
  }

  land(): void {
    this.tone(196, 0.9, { type: 'sine', gain: 0.3, slideTo: 98 })
    this.burst(0.25, { gain: 0.14, freq: 1400, q: 0.6 })
    ;[67, 71, 74].forEach((n, i) => this.tone(midi(n), 0.9, { type: 'triangle', gain: 0.09, at: this.now() + 0.05 + i * 0.03 }))
  }

  win(big: boolean): void {
    const notes = big ? [72, 76, 79, 84, 88, 91] : [72, 76, 79, 84]
    notes.forEach((n, i) => this.tone(midi(n), 0.5, { type: 'triangle', gain: 0.14, at: this.now() + i * 0.09 }))
    this.applause(big ? 2.6 : 1.4, big ? 0.14 : 0.08)
  }

  private applause(dur: number, gain: number): void {
    this.burst(dur, { gain, freq: 2400, q: 0.5, attack: 0.25 })
    this.burst(dur, { gain: gain * 0.7, freq: 5200, q: 0.6, attack: 0.4 })
  }

  bonus(): void {
    const t = this.now()
    ;[60, 64, 67, 72, 76, 79, 84].forEach((n, i) => {
      this.tone(midi(n), 0.6, { type: 'sawtooth', gain: 0.07, at: t + i * 0.07 })
      this.tone(midi(n + 12), 0.6, { type: 'triangle', gain: 0.08, at: t + i * 0.07 })
    })
    this.burst(1.6, { gain: 0.14, freq: 600, sweepTo: 7000, q: 1.5, attack: 0.9, at: t })
    this.tone(60, 1.2, { type: 'sine', gain: 0.4, at: t + 0.5, slideTo: 30 })
    this.applause(2.4, 0.1)
  }

  jackpot(): void {
    const t = this.now()
    const seq = [60, 64, 67, 72, 67, 72, 76, 79, 76, 79, 84, 88, 91, 96]
    seq.forEach((n, i) => {
      this.tone(midi(n), 0.7, { type: 'sawtooth', gain: 0.06, at: t + i * 0.1 })
      this.tone(midi(n), 0.7, { type: 'triangle', gain: 0.1, at: t + i * 0.1 })
    })
    ;[48, 55, 60, 64].forEach((n) => this.tone(midi(n), 3.2, { type: 'sawtooth', gain: 0.05, at: t + 1.4, attack: 0.1 }))
    for (let i = 0; i < 26; i++) this.tone(2000 + Math.random() * 4000, 0.25, { gain: 0.035, at: t + 0.2 + i * 0.12 })
    this.applause(4.5, 0.16)
  }

  coinToss(): void {
    const t = this.now()
    this.tone(2400, 1.4, { type: 'sine', gain: 0.12 })
    this.tone(3610, 1.1, { type: 'sine', gain: 0.07 })
    for (let i = 0; i < 16; i++) this.burst(0.05, { gain: 0.05, freq: 5000, q: 2, at: t + i * 0.13 })
  }

  coinLand(win: boolean): void {
    const t = this.now()
    this.tone(2100, 0.7, { type: 'sine', gain: 0.16 })
    this.tone(3170, 0.5, { type: 'sine', gain: 0.1 })
    this.burst(0.08, { gain: 0.25, freq: 1200, q: 0.7 })
    if (win) [76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), 0.45, { type: 'triangle', gain: 0.13, at: t + 0.25 + i * 0.08 }))
    else this.tone(196, 0.9, { type: 'sawtooth', gain: 0.1, at: t + 0.25, slideTo: 82 })
  }

  reveal(value: number): void {
    const t = this.now()
    const steps = value >= 25 ? 7 : value >= 8 ? 5 : 3
    this.burst(0.35, { gain: 0.2, freq: 900, sweepTo: 6000, q: 1.2 })
    for (let i = 0; i < steps; i++) this.tone(midi(79 + i * 2 + (i > 3 ? 1 : 0)), 0.3, { type: 'triangle', gain: 0.11, at: t + 0.06 + i * 0.06 })
  }

  hover(): void {
    this.tone(1500, 0.03, { type: 'sine', gain: 0.03 })
  }

  /** Ball striking a pin; `impact` is the change in velocity. */
  pin(impact: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    if (t - this.lastPin < 0.03) return
    this.lastPin = t
    const v = Math.min(1, impact / 9)
    this.tone(1700 + Math.random() * 1500, 0.09, { type: 'sine', gain: 0.05 + 0.14 * v })
    this.burst(0.02, { gain: 0.05 + 0.1 * v, freq: 4200, q: 3 })
  }

  slot(): void {
    const t = this.now()
    this.tone(90, 0.5, { type: 'sine', gain: 0.4, slideTo: 45 })
    ;[72, 79, 84].forEach((n, i) => this.tone(midi(n), 0.5, { type: 'triangle', gain: 0.12, at: t + 0.1 + i * 0.07 }))
  }

  charge(level: number): void {
    this.tone(180 + level * 90, 0.5, { type: 'sawtooth', gain: 0.07, slideTo: 360 + level * 180 })
    this.burst(0.5, { gain: 0.08, freq: 500, sweepTo: 5000, q: 2 })
  }

  shard(kind: 'mul' | 'add' | 'void'): void {
    const t = this.now()
    if (kind === 'void') {
      this.tone(220, 1.1, { type: 'sawtooth', gain: 0.14, slideTo: 40 })
      this.burst(0.7, { gain: 0.16, freq: 3000, sweepTo: 200, q: 1 })
    } else {
      const base = kind === 'mul' ? 72 : 67
      ;[0, 4, 7, 12, 16].forEach((n, i) => this.tone(midi(base + n), 0.5, { type: 'triangle', gain: 0.13, at: t + i * 0.07 }))
      this.tone(55, 0.8, { type: 'sine', gain: 0.35, slideTo: 30 })
    }
  }
}

export const audio = new AudioEngine()
