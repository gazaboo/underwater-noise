/**
 * Voix de cétacés, synthétisées (aucun enregistrement, donc aucune licence) et inspirées des vraies
 * fréquences, transposées pour être audibles :
 *  - rorqual bleu : appels A (pulsés) et B (tonal descendant) vers 15–20 Hz, très longs ;
 *  - rorqual commun : impulsions descendantes 23 → 17 Hz d'une seconde, par paires ;
 *  - baleine à bosse : unités de chant (montées, gémissements, « whoops ») 150 Hz – 1,5 kHz ;
 *  - cachalot : codas, trains de clics (2–10 kHz) au rythme caractéristique ;
 *  - orque : cris pulsés 1–2 kHz, harmoniques, glissés.
 *
 * Le masquage s'entend : `clarity` (portée actuelle / portée en océan calme) ferme le filtre,
 * baisse le niveau et, en dessous de 0,3, hache l'appel en fragments.
 */

export interface CallOptions {
  species: string;
  /** Volume linéaire. */
  gain: number;
  /** 0 (masqué) → 1 (océan calme). */
  clarity: number;
  /** Facteur de transposition des fréquences. */
  transpose: number;
}

function env(g: GainNode, t0: number, attack: number, hold: number, release: number, peak: number): number {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
  return t0 + attack + hold + release;
}

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

export function playCall(ctx: AudioContext, dest: AudioNode, o: CallOptions): void {
  const t0 = ctx.currentTime + 0.02;
  const k = o.transpose;
  const c = Math.max(0, Math.min(1, o.clarity));
  // Chaîne commune : filtre de masquage → hachage → volume.
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 + 9000 * c * c, Q: 0.7 });
  const chop = new GainNode(ctx, { gain: 1 });
  const out = new GainNode(ctx, { gain: o.gain * (0.25 + 0.75 * c) });
  lp.connect(chop).connect(out).connect(dest);
  let end = t0;
  const tone = (type: OscillatorType, f: (t: number) => [number, number][], start: number, dur: number, peak: number, attack = 0.3, release = 0.6) => {
    const osc = new OscillatorNode(ctx, { type });
    const g = new GainNode(ctx, { gain: 0 });
    f(start).forEach(([t, freq], i) => (i === 0 ? osc.frequency.setValueAtTime(freq, t) : osc.frequency.linearRampToValueAtTime(freq, t)));
    osc.connect(g).connect(lp);
    const stop = env(g, start, attack, Math.max(0, dur - attack - release), release, peak);
    osc.start(start);
    osc.stop(stop + 0.05);
    end = Math.max(end, stop);
    return osc;
  };

  switch (o.species) {
    case 'blue': {
      // Appel A : tonal pulsé ~16 Hz (8 s), puis appel B : glissé 18 → 16 Hz (10 s).
      const a = tone('sine', (t) => [[t, 16 * k], [t + 8, 15.5 * k]], t0, 8, 0.9, 1.5, 2);
      const trem = new OscillatorNode(ctx, { frequency: 1.6 });
      const depth = new GainNode(ctx, { gain: 0.5 });
      const am = new GainNode(ctx, { gain: 0.5 });
      a.disconnect();
      a.connect(am).connect(lp);
      trem.connect(depth).connect(am.gain);
      trem.start(t0);
      trem.stop(t0 + 8.1);
      tone('sine', (t) => [[t, 18 * k], [t + 10, 16 * k]], t0 + 9, 10, 0.8, 2, 3);
      tone('sine', (t) => [[t, 36 * k], [t + 10, 32 * k]], t0 + 9, 10, 0.25, 2, 3);
      break;
    }
    case 'fin': {
      // Doublet d'impulsions descendantes 23 → 17 Hz.
      for (const dt of [0, 1.4]) {
        tone('sine', (t) => [[t, 23 * k], [t + 1, 17 * k]], t0 + dt, 1, 1, 0.15, 0.5);
        tone('sine', (t) => [[t, 46 * k], [t + 1, 34 * k]], t0 + dt, 1, 0.2, 0.15, 0.5);
      }
      break;
    }
    case 'humpback': {
      // Phrase de 3 à 5 unités.
      let t = t0;
      const units = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < units; i++) {
        const kind = Math.floor(Math.random() * 4);
        const dur = 0.6 + Math.random() * 1.4;
        const f = (150 + Math.random() * 250) * k;
        if (kind === 0) tone('sine', (s) => [[s, f], [s + dur, f * 3]], t, dur, 0.8, 0.1, 0.3); // montée
        else if (kind === 1) {
          tone('triangle', (s) => [[s, f * 0.8], [s + dur / 2, f * 0.85], [s + dur, f * 0.75]], t, dur, 0.7, 0.2, 0.4); // gémissement
          tone('sine', (s) => [[s, f * 1.6], [s + dur, f * 1.5]], t, dur, 0.25, 0.2, 0.4);
        } else if (kind === 2) tone('sine', (s) => [[s, f * 2], [s + dur * 0.4, f * 4], [s + dur, f * 1.5]], t, dur, 0.7, 0.05, 0.3); // whoop
        else tone('sawtooth', (s) => [[s, f * 0.7], [s + dur, f * 0.6]], t, dur * 0.6, 0.35, 0.05, 0.2); // grognement
        t += dur + 0.3 + Math.random() * 0.6;
      }
      break;
    }
    case 'sperm': {
      // Coda : 3 à 7 clics, rythmes réguliers ou « 1+1+3 ».
      const n = 3 + Math.floor(Math.random() * 5);
      const regular = Math.random() < 0.5;
      let t = t0;
      for (let i = 0; i < n; i++) {
        const osc = new OscillatorNode(ctx, { type: 'square', frequency: (2500 + Math.random() * 1500) * k });
        const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 5000 * k, Q: 1.5 });
        const g = new GainNode(ctx, { gain: 0 });
        osc.connect(bp).connect(g).connect(lp);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.001);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
        osc.start(t);
        osc.stop(t + 0.02);
        end = Math.max(end, t + 0.02);
        t += regular ? 0.18 : i < 2 ? 0.3 : 0.12;
      }
      break;
    }
    case 'orca': {
      // Cri pulsé : porteuse 1–1,5 kHz modulée à ~300 Hz, glissé descendant, harmonique.
      const dur = 0.8 + Math.random() * 0.8;
      const f = (1100 + Math.random() * 400) * k;
      const car = tone('sawtooth', (s) => [[s, f], [s + dur * 0.7, f * 1.15], [s + dur, f * 0.7]], t0, dur, 0.35, 0.05, 0.25);
      const pr = new OscillatorNode(ctx, { type: 'square', frequency: 280 + Math.random() * 80 });
      const depth = new GainNode(ctx, { gain: 0.45 });
      const am = new GainNode(ctx, { gain: 0.55 });
      car.disconnect();
      car.connect(am).connect(lp);
      pr.connect(depth).connect(am.gain);
      pr.start(t0);
      pr.stop(t0 + dur + 0.1);
      break;
    }
  }
  fragment(chop, t0, end - t0, c);
  setTimeout(() => out.disconnect(), (end - ctx.currentTime + 1) * 1000);
}
