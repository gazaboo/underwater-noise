/**
 * Navigation sur la carte plate : zoom (molette, pincement du pavé tactile, + / −) centré sur le
 * curseur, déplacement (glisser, flèches), retour au cadrage initial (double-clic, R ou 0).
 * Le mouvement est lissé : la vue rejoint sa cible en ~120 ms.
 */
import type { Config } from '@vacarme/shared';
import { MAX_ZOOM, clampCenterLat, computeFlatTransform, screenToGeo, type FlatNav, type FlatTransform } from '../render/flat-view.ts';

const wrap180 = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export class FlatNavigator {
  private target: FlatNav | null = null;
  private current: FlatNav | null = null;
  private dragging: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getConfig: () => Config,
  ) {
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => this.onDrag(e));
    const endDrag = () => {
      this.dragging = null;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', () => this.reset());
    addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Taille du tampon de rendu et rapport tampon / pixels CSS. */
  private buffer(): { w: number; h: number; ratio: number } {
    return { w: this.canvas.width, h: this.canvas.height, ratio: this.canvas.width / Math.max(1, this.canvas.clientWidth) };
  }

  private base(): FlatTransform {
    const { w, h } = this.buffer();
    return computeFlatTransform(this.getConfig(), w, h);
  }

  private ensure(): FlatNav {
    if (!this.target) {
      const b = this.base();
      this.target = { zoom: 1, centerLon: b.centerLon, centerLat: b.centerLat };
      this.current = { ...this.target };
    }
    return this.target;
  }

  /** Recale la latitude du centre pour que la vue reste dans la bande autorisée. */
  private clamp(nav: FlatNav): void {
    const b = this.base();
    nav.zoom = Math.min(MAX_ZOOM, Math.max(1, nav.zoom));
    nav.centerLat = clampCenterLat(nav.centerLat, b.latMin, b.latMax, b.height / 2 / (b.scale * nav.zoom));
  }

  /** Zoom d'un facteur `factor` en gardant fixe le point sous (x, y) (pixels du tampon, y vers le haut). */
  zoomAt(factor: number, x: number, y: number): void {
    const t = this.ensure();
    const b = this.base();
    const view = computeFlatTransform(this.getConfig(), b.width, b.height, t);
    const [lon, lat] = screenToGeo(view, x, y);
    t.zoom = Math.min(MAX_ZOOM, Math.max(1, t.zoom * factor));
    const scale = b.scale * t.zoom;
    t.centerLon = wrap180(lon - (x - b.width / 2) / scale);
    t.centerLat = lat - (y - b.height / 2) / scale;
    this.clamp(t);
  }

  reset(): void {
    const b = this.base();
    this.ensure();
    this.target = { zoom: 1, centerLon: b.centerLon, centerLat: b.centerLat };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { h, ratio } = this.buffer();
    // Pincement du pavé tactile : ctrlKey, petits deltas.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomAt(Math.exp(-delta * k), e.offsetX * ratio, h - e.offsetY * ratio);
  }

  private onDrag(e: PointerEvent): void {
    if (!this.dragging) return;
    const t = this.ensure();
    const { ratio } = this.buffer();
    const scale = this.base().scale * t.zoom;
    const dx = ((e.clientX - this.dragging.x) * ratio) / scale;
    const dy = ((e.clientY - this.dragging.y) * ratio) / scale;
    this.dragging = { x: e.clientX, y: e.clientY };
    t.centerLon = wrap180(t.centerLon - dx);
    t.centerLat += dy;
    this.clamp(t);
    // Pendant le glisser, la vue suit la souris sans retard.
    this.current = { ...t };
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const { w, h } = this.buffer();
    const k = e.key;
    if (k === '+' || k === '=') this.zoomAt(1.5, w / 2, h / 2);
    else if (k === '-' || k === '_') this.zoomAt(1 / 1.5, w / 2, h / 2);
    else if (k === 'r' || k === 'R' || k === '0') this.reset();
    else if (k.startsWith('Arrow')) {
      const t = this.ensure();
      const step = (0.15 * Math.min(w, h)) / (this.base().scale * t.zoom);
      if (k === 'ArrowLeft') t.centerLon = wrap180(t.centerLon - step);
      if (k === 'ArrowRight') t.centerLon = wrap180(t.centerLon + step);
      if (k === 'ArrowUp') t.centerLat += step;
      if (k === 'ArrowDown') t.centerLat -= step;
      this.clamp(t);
      e.preventDefault();
    }
  }

  /** Oublie la navigation (par exemple après un changement de cadrage dans la configuration). */
  forget(): void {
    this.target = null;
    this.current = null;
  }

  /** Avance le lissage et renvoie la navigation courante (undefined = cadrage de la configuration). */
  update(dtMs: number): FlatNav | undefined {
    if (!this.target || !this.current) return undefined;
    const a = 1 - Math.exp(-dtMs / 120);
    const c = this.current;
    const t = this.target;
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(t.zoom) - Math.log(c.zoom)) * a);
    c.centerLon = wrap180(c.centerLon + wrap180(t.centerLon - c.centerLon) * a);
    c.centerLat += (t.centerLat - c.centerLat) * a;
    this.clamp(c);
    return c;
  }

  get zoom(): number {
    return this.current?.zoom ?? 1;
  }
}
