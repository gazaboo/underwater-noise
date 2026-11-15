/**
 * Échelle de rendu adaptative [E] : la page web vise la résolution de l'appareil et ne la réduit que si la
 * cadence ne suit pas. Mesure sur des fenêtres d'une seconde ; deux fenêtres lentes de suite font descendre
 * d'un cran (×0,85), douze fenêtres rapides font remonter. Une remontée suivie d'une rechute fixe un plafond :
 * pas d'oscillation.
 */
const STEP = 0.85;
/** Durée moyenne d'image (ms) au-delà de laquelle la cadence est jugée insuffisante (≈ 48 images/s). */
const SLOW_MS = 21;
/** En deçà (≈ 57 images/s et plus), il reste de la marge. */
const FAST_MS = 17.5;
const WINDOW_MS = 1000;

export class AdaptiveScale {
  /** Multiplicateur de render.renderScale, entre le plancher et 1. */
  factor = 1;
  private acc = 0;
  private frames = 0;
  private slow = 0;
  private fast = 0;
  private ceiling = 1;
  private raised = false;

  /**
   * À appeler une fois par image. `floor` : plancher du multiplicateur (minRenderScale / renderScale ; 1 : fixe).
   * Renvoie vrai quand le multiplicateur vient de changer (le tampon de rendu est alors à redimensionner).
   */
  frame(dtMs: number, floor: number): boolean {
    const lo = Math.min(1, Math.max(0.1, floor));
    if (this.factor < lo) {
      this.factor = lo;
      return true;
    }
    // Onglet en arrière-plan ou calage ponctuel : la fenêtre en cours ne dit rien de l'appareil.
    if (dtMs > 250 || dtMs <= 0) {
      this.acc = 0;
      this.frames = 0;
      return false;
    }
    this.acc += dtMs;
    this.frames++;
    if (this.acc < WINDOW_MS) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (avg > SLOW_MS) {
      this.fast = 0;
      if (++this.slow < 2 || this.factor <= lo) return false;
      this.slow = 0;
      this.factor = Math.max(lo, this.factor * STEP);
      if (this.raised) this.ceiling = this.factor;
      this.raised = false;
      return true;
    }
    this.slow = 0;
    if (avg >= FAST_MS) {
      this.fast = 0;
      return false;
    }
    if (++this.fast < 12) return false;
    this.fast = 0;
    const up = Math.min(1, this.factor / STEP);
    if (up <= this.factor || up > this.ceiling + 1e-6) return false;
    this.factor = up;
    this.raised = true;
    return true;
  }
}
