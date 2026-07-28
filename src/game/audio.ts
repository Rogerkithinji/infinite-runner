/**
 * Tiny procedural sound. No asset files: every effect is an oscillator plus a
 * gain envelope, which keeps the bundle honest and the sounds on-theme.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the
 * context is created lazily on the first `play` call — which always follows a
 * keypress or a tap.
 */

type Sfx = "jump" | "land" | "near" | "crash" | "tick";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  play(sfx: Sfx): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(this.master);

    switch (sfx) {
      case "jump":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(720, now + 0.12);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      case "land":
        osc.type = "sine";
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.09);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      case "near":
        osc.type = "square";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.05);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      case "tick":
        osc.type = "square";
        osc.frequency.setValueAtTime(1760, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      case "crash": {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.5);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
        osc.start(now);
        osc.stop(now + 0.64);

        // A burst of filtered noise on top, so the crash has some grit.
        const frames = Math.floor(ctx.sampleRate * 0.35);
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(200, now + 0.35);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.5, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.master);
        noise.start(now);
        break;
      }
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
