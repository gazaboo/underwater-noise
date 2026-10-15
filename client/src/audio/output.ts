/**
 * Bus de sortie unique : volume général → limiteur → haut-parleurs, avec un analyseur de crête.
 *
 * C'est le seul point de sortie du son : pour ajouter plus tard une spatialisation (panoramique,
 * multicanal, pont OSC), on remplacera ce module sans toucher aux voix.
 */
export class AudioOutput {
  /** Entrée du bus : toutes les voix s'y connectent. */
  readonly input: GainNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly analyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;

  constructor(readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.master = ctx.createGain();
    // Limiteur : seuil haut, taux élevé, attaque rapide — protège des sommes de voix.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.input.connect(this.master).connect(this.limiter).connect(this.analyser).connect(ctx.destination);
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  /** Dérivation de la sortie vers un flux (enregistrement de test). */
  tap(): MediaStream {
    const d = this.ctx.createMediaStreamDestination();
    this.analyser.connect(d);
    return d.stream;
  }

  /** Crête de sortie (dBFS) sur la dernière fenêtre. */
  peakDb(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let m = 0;
    for (const x of this.buf) m = Math.max(m, Math.abs(x));
    return m > 0 ? 20 * Math.log10(m) : -Infinity;
  }

  /** Réduction de gain appliquée par le limiteur (dB, ≤ 0). */
  get reductionDb(): number {
    return this.limiter.reduction;
  }
}

/** Tampons de bruit (rose, brun) partagés, en boucle. */
export function noiseBuffer(ctx: AudioContext, kind: 'pink' | 'brown', seconds = 4): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      // Filtre de Paul Kellet.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}
