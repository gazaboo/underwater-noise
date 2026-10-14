/**
 * HUD de diagnostic (touche D) : images/s, temps CPU et GPU par image, navires, source.
 * Le temps GPU est mesuré par EXT_disjoint_timer_query_webgl2 quand le pilote le fournit.
 */

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  lastMs = NaN;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT);
      if (!disjoint) this.lastMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

export interface HudInfo {
  source: string;
  connected: boolean;
  ships: number;
  simTime: Date;
  timeScale: number;
  simSize: string;
  steps: number;
  canvas: string;
  target: string;
  quality: string;
}

export class Hud {
  private readonly el = document.getElementById('hud')!;
  private frames = 0;
  private acc = 0;
  private cpuAcc = 0;
  private fps = 0;
  private cpuMs = 0;
  private lastText = 0;

  get visible(): boolean {
    return this.el.classList.contains('on');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('on', force);
  }

  frame(dtMs: number, cpuMs: number, gpuMs: number, info: () => HudInfo): void {
    this.frames++;
    this.acc += dtMs;
    this.cpuAcc += cpuMs;
    if (this.acc >= 500) {
      this.fps = (1000 * this.frames) / this.acc;
      this.cpuMs = this.cpuAcc / this.frames;
      this.frames = 0;
      this.acc = 0;
      this.cpuAcc = 0;
    }
    const now = performance.now();
    if (!this.visible || now - this.lastText < 250) return;
    this.lastText = now;
    const i = info();
    const gpu = Number.isFinite(gpuMs) ? `${gpuMs.toFixed(2)} ms` : 'n/d';
    this.el.textContent = [
      `${this.fps.toFixed(1)} img/s   cpu ${this.cpuMs.toFixed(2)} ms   gpu ${gpu}`,
      `navires ${i.ships}   source ${i.source}${i.connected ? '' : ' (déconnecté)'}`,
      `temps simulé ${i.simTime.toISOString().slice(0, 16).replace('T', ' ')} UTC   ×${i.timeScale}`,
      `ondes ${i.simSize}   ${i.steps} pas/image`,
      `rendu ${i.canvas}   cible ${i.target}   profil ${i.quality}`,
      `P réglages · D diagnostic · F plein écran`,
    ].join('\n');
  }
}
