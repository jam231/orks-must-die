export class AudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private unlocked = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * Unlocks Web Audio on the first user gesture (required on iPad Safari & Android Chrome).
   */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.unlocked && this.ctx) {
      this.unlocked = true;
      // Silent micro-buffer wakes iOS Safari audio output reliably
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.ctx.destination);
      src.start(0);
    }
  }

  private getReadyContext(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0
  ): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoise(duration: number, filterFreq: number, volume: number, delay = 0): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.setValueAtTime(1.2, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration + 0.02);
  }

  public playBolt(): void {
    this.playTone(540, 220, 0.08, 'triangle', 0.07);
    this.playNoise(0.04, 1800, 0.035);
  }

  public playBlast(): void {
    this.playTone(220, 58, 0.26, 'sawtooth', 0.14);
    this.playNoise(0.22, 620, 0.12);
  }

  public playFrost(): void {
    this.playTone(880, 1480, 0.14, 'sine', 0.09);
    this.playTone(1320, 660, 0.28, 'triangle', 0.08, 0.04);
    this.playNoise(0.24, 3400, 0.06);
  }

  public playDash(): void {
    this.playTone(320, 740, 0.12, 'sine', 0.08);
    this.playNoise(0.11, 1400, 0.05);
  }

  public playTrapPlace(): void {
    this.playTone(190, 290, 0.09, 'triangle', 0.11);
    this.playTone(380, 460, 0.07, 'sine', 0.07, 0.04);
  }

  public playTrapSell(): void {
    this.playTone(520, 780, 0.08, 'sine', 0.08);
    this.playTone(780, 1040, 0.09, 'sine', 0.07, 0.06);
  }

  public playError(): void {
    this.playTone(170, 120, 0.13, 'sawtooth', 0.08);
  }

  public playSpikes(): void {
    this.playTone(460, 180, 0.11, 'sawtooth', 0.09);
    this.playNoise(0.08, 2200, 0.07);
  }

  public playArrowWall(): void {
    for (let i = 0; i < 3; i++) {
      this.playNoise(0.07, 2400 + i * 350, 0.05, i * 0.035);
      this.playTone(420 + i * 40, 260, 0.06, 'triangle', 0.04, i * 0.035);
    }
  }

  public playFlip(): void {
    this.playTone(180, 620, 0.16, 'sine', 0.11);
    this.playTone(260, 760, 0.12, 'triangle', 0.07, 0.03);
  }

  public playPounder(): void {
    this.playTone(120, 38, 0.24, 'square', 0.14);
    this.playNoise(0.18, 320, 0.12);
  }

  public playLavaSplash(): void {
    this.playTone(150, 70, 0.18, 'sine', 0.08);
    this.playNoise(0.32, 1600, 0.11);
  }

  public playExplosion(): void {
    this.playTone(140, 32, 0.32, 'sawtooth', 0.16);
    this.playNoise(0.28, 420, 0.16);
  }

  public playCombo(comboCount: number): void {
    const base = 440 * Math.pow(1.12, Math.min(comboCount, 8));
    this.playTone(base, base * 1.25, 0.12, 'sine', 0.09);
    this.playTone(base * 1.5, base * 1.5, 0.14, 'triangle', 0.06, 0.05);
  }

  public playWaveHorn(): void {
    this.playTone(146.8, 146.8, 0.42, 'sawtooth', 0.09);
    this.playTone(220, 220, 0.48, 'sawtooth', 0.08, 0.08);
  }

  public playRiftHit(): void {
    this.playTone(280, 110, 0.28, 'sawtooth', 0.13);
    this.playTone(210, 88, 0.3, 'triangle', 0.1, 0.04);
  }

  public playVictory(): void {
    const notes = [392, 493.88, 587.33, 783.99];
    notes.forEach((n, idx) => {
      this.playTone(n, n * 1.01, 0.26, 'triangle', 0.11, idx * 0.11);
    });
  }
}
