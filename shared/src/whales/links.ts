/**
 * Liens entre groupes de cétacés : qui entend qui, et comment le lien vit, se rompt, se retisse.
 *
 * Un lien A–B porte deux directions :
 *   « A entend B » si SL_B − TL(d) − NL(au point de A) − DT ≥ 0 — le bruit compte chez celui qui écoute.
 * Le lien peut donc être asymétrique : A près d'un couloir de trafic n'entend plus B, B entend encore A.
 *
 * Chaque direction a une force lissée dans [0, 1] :
 *  - hystérésis : on ne bascule qu'au-delà de ±`hysteresisDb` autour du seuil ;
 *  - rupture en `breakSec` (le fil s'effiloche), reconnexion plus lente en `reknitSec` ;
 *  - quand les deux directions sont éteintes, une trace fantôme subsiste `ghostSec` secondes.
 */

export interface LinkOptions {
  hysteresisDb: number;
  breakSec: number;
  reknitSec: number;
  ghostSec: number;
}

export interface LinkDirection {
  /** Marge courante (dB). */
  margin: number;
  /** Cible après hystérésis (vrai = entend). */
  target: boolean;
  /** Force lissée 0..1. */
  strength: number;
}

export interface LinkState {
  /** B → A : A entend B. */
  aHearsB: LinkDirection;
  /** A → B : B entend A. */
  bHearsA: LinkDirection;
  /** Trace fantôme 0..1 (mémoire d'un lien perdu). */
  ghost: number;
  /** Le lien a-t-il déjà existé ? (sinon pas de fantôme) */
  everAlive: boolean;
}

export function newLink(): LinkState {
  const dir = (): LinkDirection => ({ margin: -Infinity, target: false, strength: 0 });
  return { aHearsB: dir(), bHearsA: dir(), ghost: 0, everAlive: false };
}

function updateDirection(d: LinkDirection, margin: number, dtSec: number, o: LinkOptions): void {
  d.margin = margin;
  if (margin > o.hysteresisDb) d.target = true;
  else if (margin < -o.hysteresisDb) d.target = false;
  // Entre les deux seuils : la cible précédente est conservée (pas de clignotement).
  if (d.target) d.strength = Math.min(1, d.strength + dtSec / o.reknitSec);
  else d.strength = Math.max(0, d.strength - dtSec / o.breakSec);
}

/** Met à jour un lien avec les marges des deux directions. */
export function updateLink(link: LinkState, marginAHearsB: number, marginBHearsA: number, dtSec: number, o: LinkOptions): void {
  const before = Math.max(link.aHearsB.strength, link.bHearsA.strength);
  updateDirection(link.aHearsB, marginAHearsB, dtSec, o);
  updateDirection(link.bHearsA, marginBHearsA, dtSec, o);
  const after = Math.max(link.aHearsB.strength, link.bHearsA.strength);
  if (after > 0.5) link.everAlive = true;
  // Le fantôme naît quand le lien s'éteint, puis s'efface.
  if (link.everAlive && before > 0 && after === 0) link.ghost = 1;
  else link.ghost = Math.max(0, link.ghost - dtSec / o.ghostSec);
}

/** Effilochage 0..1 : un lien qui s'éteint ou qui est près du seuil. */
export function fray(link: LinkState): number {
  const f = (d: LinkDirection) => (d.target ? 0 : d.strength);
  return Math.max(f(link.aHearsB), f(link.bHearsA));
}

/** Le lien est-il vivant (au moins une direction) ? */
export function isAlive(link: LinkState): boolean {
  return link.aHearsB.strength > 0.5 || link.bHearsA.strength > 0.5;
}

/** Asymétrique : une direction vivante, l'autre non. */
export function isAsymmetric(link: LinkState): boolean {
  return (link.aHearsB.strength > 0.5) !== (link.bHearsA.strength > 0.5);
}
