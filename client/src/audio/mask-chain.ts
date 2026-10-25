/**
 * Chaîne de masquage commune aux appels synthétisés et enregistrés : filtre → hachage → volume.
 *
 * `clarity` (portée actuelle / portée en océan calme) ferme le filtre, baisse le niveau et, en dessous de 0,3,
 * hache l'appel en fragments. C'est une métaphore de la réduction de portée [A], pas une simulation
 * psychoacoustique (docs/REVUE_SCIENTIFIQUE.md §8).
 */

export interface MaskChain {
  /** Entrée de la chaîne : y brancher la source. */
  input: AudioNode;
  /** Volume de sortie, déjà relié à la destination. */
  out: GainNode;
  /** Hache [t0, t0 + dur] si l'appel est très masqué. */
  fragment(t0: number, dur: number): void;
}

/** Fréquence de coupure du filtre de masquage (Hz). */
export const maskCutoffHz = (clarity: number): number => 400 + 9000 * clarity * clarity;
/** Gain de sortie relatif. */
export const maskGain = (clarity: number): number => 0.25 + 0.75 * clarity;

/** Hache un appel en fragments quand il est très masqué. */
function fragment(g: GainNode, t0: number, dur: number, clarity: number): void {
  if (clarity >= 0.3) return;
  const holes = Math.ceil(dur * 3);
  for (let i = 0; i < holes; i++) {
    if (Math.random() > 0.55) continue;
    const t = t0 + Math.random() * dur;
    g.gain.setValueAtTime(0.05, t);
    g.gain.setValueAtTime(1, t + 0.1 + Math.random() * 0.25);
  }
}

export function maskChain(ctx: BaseAudioContext, dest: AudioNode, gain: number, clarity: number): MaskChain {
  const c = Math.max(0, Math.min(1, clarity));
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: maskCutoffHz(c), Q: 0.7 });
  const chop = new GainNode(ctx, { gain: 1 });
  const out = new GainNode(ctx, { gain: gain * maskGain(c) });
  lp.connect(chop).connect(out).connect(dest);
  return { input: lp, out, fragment: (t0, dur) => fragment(chop, t0, dur, c) };
}
