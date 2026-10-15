/**
 * Voix d'un navire : un bourdon grave dont le timbre dépend de la classe.
 *
 *  - fondamental (dent de scie + sinus à l'octave) qui baisse avec la longueur du navire ;
 *  - pulsation d'amplitude au rythme de l'arbre d'hélice (lente pour les grands navires,
 *    rapide et nerveuse pour les petites unités) ;
 *  - bruit de cavitation filtré (remorqueurs, pêche, plaisance) ;
 *  - bourdonnement de génératrice à 50/60 Hz (paquebots, passagers).
 * Tout est transposé de `transposeOctaves` octaves : les vrais 10–60 Hz demandent un caisson.
 */
import { SHIP_CLASSES } from '@vacarme/shared';

interface Timbre {
  /** Facteur sur le fondamental déduit de la longueur. */
  pitch: number;
  /** Part de bruit de cavitation (0–1) et fréquence centrale du filtre (Hz, réels). */
  noise: number;
  noiseHz: number;
  /** Bourdonnement de génératrice (0–1). */
  hum: number;
  /** Pulsation : fréquence de base (Hz) et sensibilité à la vitesse. */
  amHz: number;
  amPerKnot: number;
  /** Ouverture du filtre (multiple du fondamental). */
  bright: number;
}

const TIMBRES: Record<(typeof SHIP_CLASSES)[number], Timbre> = {
  fishing: { pitch: 1.2, noise: 0.35, noiseHz: 600, hum: 0, amHz: 2.2, amPerKnot: 0.15, bright: 6 },
  tug: { pitch: 1.1, noise: 0.45, noiseHz: 450, hum: 0, amHz: 3, amPerKnot: 0.25, bright: 7 },
  naval: { pitch: 0.9, noise: 0.15, noiseHz: 300, hum: 0.05, amHz: 1.6, amPerKnot: 0.08, bright: 4 },
  recreational: { pitch: 1.6, noise: 0.55, noiseHz: 1400, hum: 0, amHz: 9, amPerKnot: 0.5, bright: 10 },
  government: { pitch: 1, noise: 0.2, noiseHz: 400, hum: 0.05, amHz: 1.8, amPerKnot: 0.1, bright: 5 },
  cruise: { pitch: 0.85, noise: 0.08, noiseHz: 250, hum: 0.3, amHz: 1.2, amPerKnot: 0.05, bright: 4 },
  passenger: { pitch: 1, noise: 0.15, noiseHz: 350, hum: 0.25, amHz: 2, amPerKnot: 0.1, bright: 5 },
  bulker: { pitch: 0.8, noise: 0.06, noiseHz: 200, hum: 0, amHz: 1.1, amPerKnot: 0.05, bright: 3.5 },
  container: { pitch: 0.75, noise: 0.08, noiseHz: 220, hum: 0.05, amHz: 1.4, amPerKnot: 0.06, bright: 4 },
  vehicleCarrier: { pitch: 0.8, noise: 0.06, noiseHz: 220, hum: 0.08, amHz: 1.3, amPerKnot: 0.06, bright: 4 },
  tanker: { pitch: 0.7, noise: 0.05, noiseHz: 180, hum: 0, amHz: 1, amPerKnot: 0.05, bright: 3 },
  dredger: { pitch: 1, noise: 0.5, noiseHz: 300, hum: 0.05, amHz: 2.5, amPerKnot: 0.1, bright: 5 },
  other: { pitch: 1, noise: 0.2, noiseHz: 400, hum: 0, amHz: 2, amPerKnot: 0.1, bright: 5 },
};

export interface ShipSound {
  classIndex: number;
  lengthM: number;
  sog: number;
  /** Volume linéaire visé. */
  gain: number;
}

export class ShipVoice {
  private readonly saw: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly hum: OscillatorNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly lp: BiquadFilterNode;
  private readonly bp: BiquadFilterNode;
  private readonly am: GainNode;
  private readonly lfoDepth: GainNode;
  private readonly noiseGain: GainNode;
  private readonly humGain: GainNode;
  readonly out: GainNode;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
  ) {
    const t = ctx.currentTime;
    this.saw = new OscillatorNode(ctx, { type: 'sawtooth' });
    this.sub = new OscillatorNode(ctx, { type: 'sine' });
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.9 });
    this.am = new GainNode(ctx, { gain: 0.65 });
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 1 });
    this.lfoDepth = new GainNode(ctx, { gain: 0.35 });
    this.noise = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true, loopStart: Math.random() * 3 });
    this.bp = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 1.2 });
    this.noiseGain = new GainNode(ctx, { gain: 0 });
    this.hum = new OscillatorNode(ctx, { type: 'triangle', frequency: 120 });
    this.humGain = new GainNode(ctx, { gain: 0 });
    this.out = new GainNode(ctx, { gain: 0 });

    const sawGain = new GainNode(ctx, { gain: 0.35 });
    const subGain = new GainNode(ctx, { gain: 0.6 });
    this.saw.connect(sawGain).connect(this.lp);
    this.sub.connect(subGain).connect(this.lp);
    this.lp.connect(this.am);
    this.noise.connect(this.bp).connect(this.noiseGain).connect(this.am);
    this.lfo.connect(this.lfoDepth).connect(this.am.gain);
    this.hum.connect(this.humGain).connect(this.out);
    this.am.connect(this.out);
    this.out.connect(dest);
    for (const n of [this.saw, this.sub, this.lfo, this.noise, this.hum]) n.start(t + Math.random() * 0.05);
  }

  /** Met à jour le timbre et le volume (transitions douces). */
  set(s: ShipSound, transposeOctaves: number): void {
    const t = this.ctx.currentTime;
    const timbre = TIMBRES[SHIP_CLASSES[s.classIndex] ?? 'other'] ?? TIMBRES.other;
    const k = Math.pow(2, transposeOctaves);
    // Fondamental réel : ~27 Hz pour 300 m, ~90 Hz pour 30 m.
    const len = Math.max(8, s.lengthM || 80);
    const f0 = (20 + 2000 / len) * timbre.pitch * k;
    this.saw.frequency.setTargetAtTime(f0, t, 0.5);
    this.sub.frequency.setTargetAtTime(f0 * 0.5, t, 0.5);
    this.lp.frequency.setTargetAtTime(Math.min(8000, f0 * timbre.bright), t, 0.5);
    this.lfo.frequency.setTargetAtTime(timbre.amHz + timbre.amPerKnot * s.sog, t, 0.5);
    this.bp.frequency.setTargetAtTime(Math.min(8000, timbre.noiseHz * Math.sqrt(k)), t, 0.5);
    this.noiseGain.gain.setTargetAtTime(timbre.noise * Math.min(1, 0.3 + s.sog / 15), t, 0.5);
    this.humGain.gain.setTargetAtTime(timbre.hum * 0.15, t, 0.5);
    this.out.gain.setTargetAtTime(s.gain, t, 0.8);
  }

  /** Fondu de sortie puis libération. */
  release(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.5);
    const end = t + 3;
    for (const n of [this.saw, this.sub, this.lfo, this.noise, this.hum]) n.stop(end);
    setTimeout(() => this.out.disconnect(), 3500);
  }
}

/**
 * Nappe : le grondement de la masse. Bruit brun filtré, dont le niveau et la brillance suivent
 * le bruit moyen de la zone affichée, plus deux bourdons très graves qui battent lentement.
 */
export class Bed {
  private readonly lp: BiquadFilterNode;
  private readonly out: GainNode;
  private readonly drones: OscillatorNode[];

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    brown: AudioBuffer,
  ) {
    const src = new AudioBufferSourceNode(ctx, { buffer: brown, loop: true });
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.5 });
    this.out = new GainNode(ctx, { gain: 0 });
    src.connect(this.lp).connect(this.out).connect(dest);
    src.start();
    const droneGain = new GainNode(ctx, { gain: 0.12 });
    droneGain.connect(this.lp);
    this.drones = [55, 55.4, 82.6].map((f) => {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      o.connect(droneGain);
      o.start();
      return o;
    });
    // Lente respiration du filtre.
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.07 });
    const depth = new GainNode(ctx, { gain: 40 });
    lfo.connect(depth).connect(this.lp.frequency);
    lfo.start();
  }

  /** intensity : 0 (silence de la zone) → 1 (saturation). */
  set(intensity: number, volume: number): void {
    const t = this.ctx.currentTime;
    const i = Math.max(0, Math.min(1, intensity));
    // Toujours un peu présente (la mer n'est jamais muette), puis montée franche avec le bruit.
    this.out.gain.setTargetAtTime(volume * 2.5 * (0.08 + 0.92 * Math.pow(i, 1.5)), t, 2);
    this.lp.frequency.setTargetAtTime(110 + 600 * i, t, 2);
  }
}
