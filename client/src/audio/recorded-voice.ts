/**
 * Appels de cétacés lus depuis de vrais enregistrements (data/media, provenance dans docs/MEDIAS.md), à travers
 * la même chaîne de masquage que la synthèse.
 *
 * À chaque appel, on lit une fenêtre tirée au hasard dans l'extrait, plafonnée à `maxSec` secondes réelles :
 * les appels sont fréquents et un seul extrait par espèce ne doit pas se répéter à l'identique [A].
 * `playbackRate` transpose hauteur et durée ensemble (rorquals ×5) : choix artistique [A], affiché dans la légende.
 * La durée d'un enregistrement ne suit pas l'accélération de la scène : seule la cadence des appels la suit.
 */

import { maskChain } from './mask-chain.ts';

export interface RecordingOptions {
  /** Volume linéaire. */
  gain: number;
  /** 0 (masqué) → 1 (océan calme). */
  clarity: number;
  /** Facteur de lecture : hauteur et durée (1 = original). */
  playbackRate: number;
  /** Durée maximale jouée, en secondes réelles. */
  maxSec: number;
  /** Niveau actif du fichier (catalogue) : égalisé vers LEVEL_REF_DBFS. */
  levelDbfs: number;
}

/**
 * Égalisation des espèces [E] : chaque fichier est ramené au même niveau actif (90e centile des trames de 100 ms,
 * mesuré par tools/build_media.py), dans une limite de ±15 dB. Les clics épars du cachalot sont sinon inaudibles.
 * Réglage provisoire, à confirmer à l'oreille : sortie des seuls cétacés sur 30 s, −29,9 dB en synthèse contre
 * −35,1 dB avec une référence à −18 dBFS et −34,3 dB à −14 dBFS (scripts/verify-audio.mjs, 25 oct. 2026). Sur
 * 30 s, la mesure varie de plusieurs dB d'un essai à l'autre (espèces tirées, distance, masquage).
 */
export const LEVEL_REF_DBFS = -14;
export const levelGain = (levelDbfs: number): number =>
  Math.pow(10, Math.max(-15, Math.min(15, LEVEL_REF_DBFS - levelDbfs)) / 20);

/** Fondu aux bords d'une fenêtre coupée dans l'extrait (s). */
const EDGE_FADE = 0.25;

export function playRecording(ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, o: RecordingOptions): { endTime: number; stop(): void } {
  const t0 = ctx.currentTime + 0.02;
  const rate = Math.max(0.05, o.playbackRate);
  const full = buffer.duration / rate;
  const play = Math.min(full, Math.max(0.1, o.maxSec));
  // Position de départ dans l'extrait (secondes du fichier).
  const offset = full > play ? Math.random() * (full - play) * rate : 0;
  const chain = maskChain(ctx, dest, o.gain * levelGain(o.levelDbfs), o.clarity);
  const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
  const fade = new GainNode(ctx, { gain: 1 });
  src.connect(fade).connect(chain.input);
  const end = t0 + play;
  if (play < full) {
    const f = Math.min(EDGE_FADE, play / 4);
    fade.gain.setValueAtTime(0, t0);
    fade.gain.linearRampToValueAtTime(1, t0 + f);
    fade.gain.setValueAtTime(1, end - f);
    fade.gain.linearRampToValueAtTime(0, end);
  }
  src.start(t0, offset, play * rate);
  chain.fragment(t0, play);
  const timer = setTimeout(() => chain.out.disconnect(), (end - ctx.currentTime + 1) * 1000);
  return {
    endTime: end,
    stop() {
      clearTimeout(timer);
      chain.out.gain.cancelScheduledValues(ctx.currentTime);
      chain.out.gain.setTargetAtTime(0, ctx.currentTime, 0.005);
      try { src.stop(ctx.currentTime + 0.03); } catch { /* already ended */ }
      setTimeout(() => chain.out.disconnect(), 50);
    },
  };
}
