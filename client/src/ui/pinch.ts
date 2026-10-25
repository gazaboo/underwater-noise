/**
 * Pincement à deux doigts (écrans tactiles) : appelle `onPinch(facteur, x, y)` avec le centre du geste en
 * pixels CSS relatifs au canevas. Pendant le pincement, `active` est vrai : le glisser à un doigt s'arrête.
 */
export class Pinch {
  private readonly points = new Map<number, { x: number; y: number }>();
  private lastDist = 0;

  constructor(canvas: HTMLCanvasElement, onPinch: (factor: number, x: number, y: number) => void) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.points.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.points.size === 2) this.lastDist = this.distance();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.points.has(e.pointerId)) return;
      this.points.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.points.size !== 2) return;
      const d = this.distance();
      if (this.lastDist > 0 && d > 0) {
        const [a, b] = [...this.points.values()];
        onPinch(d / this.lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      this.lastDist = d;
    });
    const end = (e: PointerEvent) => {
      this.points.delete(e.pointerId);
      this.lastDist = this.points.size === 2 ? this.distance() : 0;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  get active(): boolean {
    return this.points.size >= 2;
  }

  private distance(): number {
    const [a, b] = [...this.points.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
