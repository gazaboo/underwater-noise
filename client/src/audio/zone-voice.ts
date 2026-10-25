/**
 * Paysage sonore d'un lieu (data/lieux) : ses vrais enregistrements joués l'un après l'autre, en boucle, à travers
 * la même chaîne de masquage que les appels des cétacés (filtre, niveau, hachage sous une clarté de 0,3).
 *
 * La clarté vient du bruit ajouté par les navires au lieu : clarté = 10^(−ΔL/20), comme la réduction de portée
 * d'une source en propagation sphérique [A]. Ce n'est pas une simulation psychoacoustique ; « océan sans
 * navires » rend la clarté à 1.
 */
import { maskCutoffHz, maskGain } from './mask-chain.ts';
import { levelGain } from './recorded-voice.ts';

export interface ZoneSound {
  buffer: AudioBuffer;
  levelDbfs: number;
}

/** Clarté d'un lieu : bruit ajouté ΔL (dB) → 0–1 [A]. */
export const zoneClarity = (excessDb: number): number => Math.pow(10, -Math.max(0, excessDb) / 20);

/** Pause entre deux extraits (s). */
const GAP = 1.5;
/** Fondus d'entrée et de sortie du lieu (s). */
const FADE = 1.5;

export class ZoneVoice {
  private readonly lp: BiquadFilterNode;
  private readonly chop: GainNode;
  private readonly out: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private srcGain: GainNode | null = null;
  private index = 0;
  private stopped = false;
  private choppedUntil = 0;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, private readonly sounds: ZoneSound[], private readonly rate = 1) {
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: maskCutoffHz(1), Q: 0.7 });
    this.chop = new GainNode(ctx, { gain: 1 });
    this.out = new GainNode(ctx, { gain: 0 });
    this.lp.connect(this.chop).connect(this.out).connect(dest);
    this.next(ctx.currentTime + 0.05);
  }

  private next(at: number): void {
    if (this.stopped || !this.sounds.length) return;
    const s = this.sounds[this.index % this.sounds.length];
    this.index++;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: s.buffer, playbackRate: this.rate });
    const g = new GainNode(this.ctx, { gain: levelGain(s.levelDbfs) });
    src.connect(g).connect(this.lp);
    src.onended = () => {
      g.disconnect();
      if (this.src === src) this.next(this.ctx.currentTime + GAP);
    };
    src.start(at);
    this.src = src;
    this.srcGain = g;
  }

  /** Volume (0–1, avant masquage) et clarté (0–1), à chaque mise à jour du moteur. */
  set(gain: number, clarity: number): void {
    const t = this.ctx.currentTime;
    const c = Math.max(0, Math.min(1, clarity));
    this.lp.frequency.setTargetAtTime(maskCutoffHz(c), t, 0.4);
    this.out.gain.setTargetAtTime(gain * maskGain(c), t, FADE / 3);
    // Hachage : des trous programmés une demi-seconde à l'avance, comme pour les appels.
    if (c < 0.3 && t > this.choppedUntil - 0.1) {
      const until = t + 0.5;
      for (let k = 0; k < 2; k++) {
        if (Math.random() > 0.55) continue;
        const h = Math.max(t, this.choppedUntil) + Math.random() * 0.5;
        this.chop.gain.setValueAtTime(0.05, h);
        this.chop.gain.setValueAtTime(1, h + 0.1 + Math.random() * 0.25);
      }
      this.choppedUntil = until;
    }
  }

  /** Fondu de sortie puis arrêt. */
  stop(): void {
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, FADE / 3);
    const src = this.src;
    this.src = null;
    try { src?.stop(t + FADE * 1.5); } catch { /* déjà fini */ }
    setTimeout(() => { this.srcGain?.disconnect(); this.out.disconnect(); }, FADE * 1.5 * 1000 + 100);
  }
}
