/**
 * Moteur sonore (J5) : navires, nappe, cétacés — un seul bus de sortie, sans spatialisation.
 *
 * Écoute : on entend ce que l'on regarde. Les navires et les groupes de la vue sont pondérés par
 * leur distance au centre (−`edgeAttenuationDb` au bord) ; zoomer revient à tendre l'oreille.
 *  - navires : `ships.voices` voix au plus, attribuées aux plus forts avec hystérésis ;
 *  - nappe : suit le niveau moyen de la bande basse dans la zone affichée ;
 *  - cétacés : chaque appel naturel ou réponse d'un groupe visible est joué, depuis un vrai enregistrement
 *    (repli : synthèse) ; le masquage (portée actuelle / portée en océan calme) ferme le filtre, baisse le
 *    niveau, hache l'appel.
 *
 * Le navigateur n'autorise le son qu'après un geste de l'utilisateur : le contexte audio démarre
 * au premier clic ou à la première touche (en kiosque : --autoplay-policy=no-user-gesture-required).
 */
import type { Config } from '@vacarme/shared';
import type { FlatTransform } from '../render/flat-view.ts';
import { DEG, naturalLevel } from '@vacarme/shared';
import type { ShipLayer, ShipSample } from '../render/ships.ts';
import type { FieldReader } from '../whales/field-reader.ts';
import type { CallEvent } from '../whales/whales.ts';
import { allocate } from './allocator.ts';
import { AudioOutput, noiseBuffer } from './output.ts';
import { Bed, ShipVoice } from './ship-voice.ts';
import { playRecording } from './recorded-voice.ts';
import { SampleBank } from './sample-bank.ts';
import { playCall } from './whale-voice.ts';

/**
 * Ce que l'on « écoute » : distance normalisée d'un point au centre de l'écoute (0 au centre, ~1 au bord,
 * Infinity hors de vue) et points d'échantillonnage du bruit pour la nappe.
 */
export interface Listener {
  distance(lat: number, lon: number): number;
  samples(): [number, number][];
}

/** Carte plate : le centre de la vue, la vue entière. */
export function flatListener(view: FlatTransform): Listener {
  return {
    distance(lat, lon) {
      const dLon = ((((lon - view.centerLon + 180) % 360) + 360) % 360) - 180;
      const x = dLon * view.scale;
      const y = (lat - view.centerLat) * view.scale;
      if (Math.abs(x) > view.width * 0.55 || Math.abs(y) > view.height * 0.55) return Infinity;
      return Math.hypot(x, y) / (0.5 * Math.hypot(view.width, view.height));
    },
    samples() {
      const out: [number, number][] = [];
      for (let gy = 0; gy < 8; gy++)
        for (let gx = 0; gx < 12; gx++) {
          const lon = view.centerLon + ((gx + 0.5) / 12 - 0.5) * (view.width / view.scale);
          const lat = view.centerLat + ((gy + 0.5) / 8 - 0.5) * (view.height / view.scale);
          if (lat >= view.latMin && lat <= view.latMax) out.push([lat, lon]);
        }
      return out;
    },
  };
}

/** Globe : la face visible, centrée sur le point face au public (distance angulaire / 80°). */
export function globeListener(facingLat: number, facingLon: number): Listener {
  const p1 = facingLat * DEG;
  const angle = (lat: number, lon: number) => {
    const p2 = lat * DEG;
    const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos((lon - facingLon) * DEG);
    return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
  };
  return {
    distance(lat, lon) {
      const a = angle(lat, lon);
      return a > 85 ? Infinity : a / 80;
    },
    samples() {
      const out: [number, number][] = [];
      for (let lat = -80; lat <= 80; lat += 10) for (let lon = -180; lon < 180; lon += 10) if (angle(lat, lon) < 70) out.push([lat, lon]);
      return out;
    },
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private output: AudioOutput | null = null;
  private bed: Bed | null = null;
  private pink: AudioBuffer | null = null;
  private readonly voices = new Map<number, ShipVoice>();
  private active = new Set<number>();
  private playingCalls: ReturnType<typeof playCall>[] = [];
  /** Vrais enregistrements de cétacés, décodés au démarrage du son. */
  private readonly bank = new SampleBank();
  private timeScale = 1;
  private lastUpdate = 0;
  private readonly sample: ShipSample = { id: 0, lat: 0, lon: 0, sog: 0, classIndex: 0, lengthM: 0, slBroad: 0 };
  muted = false;
  /** État lisible pour le diagnostic. */
  status = 'son : en attente d\'un clic ou d\'une touche';
  private bedIntensity = 0;

  constructor() {
    const start = () => void this.start();
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
    // En kiosque (autoplay autorisé), on démarre sans attendre.
    void this.start(true);
  }

  private async start(probe = false): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.output = new AudioOutput(this.ctx);
      this.pink = noiseBuffer(this.ctx, 'pink');
      this.bed = new Bed(this.ctx, this.output.input, noiseBuffer(this.ctx, 'brown', 6));
      void this.bank.load(this.ctx);
    }
    if (this.ctx.state === 'suspended' && !probe) await this.ctx.resume();
  }

  /** Flux de la sortie (diagnostic : enregistrement). */
  tap(): MediaStream | null {
    return this.output?.tap() ?? null;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }

  reset(): void {
    for (const call of this.playingCalls) call.stop();
    this.playingCalls = [];
    for (const voice of this.voices.values()) voice.release();
    this.voices.clear();
    this.active.clear();
    this.bedIntensity = 0;
  }

  update(now: number, cfg: Config, listener: Listener, ships: ShipLayer, field: FieldReader, calls: CallEvent[], timeScale = 1): void {
    if (timeScale !== this.timeScale) {
      // Cancel calls scheduled at the old rate rather than leaving a second biological clock running.
      for (const call of this.playingCalls) call.stop();
      this.playingCalls = [];
      this.timeScale = timeScale;
    }
    const ctx = this.ctx;
    if (!ctx || !this.output || ctx.state !== 'running') {
      if (ctx?.state === 'suspended') this.status = 'son : en attente d\'un clic ou d\'une touche';
      return;
    }
    const a = cfg.audio;
    this.output.setVolume(a.enabled && !this.muted ? a.master : 0);

    // Cétacés : à chaque image, pour ne pas décaler les appels.
    const t = ctx.currentTime;
    this.playingCalls = this.playingCalls.filter(call => call.endTime > t);
    for (const ev of calls) {
      if (!a.enabled || this.playingCalls.length >= a.whales.voices) continue;
      const g = ev.group;
      const d = listener.distance(g.lat, g.lon);
      if (!Number.isFinite(d)) continue;
      const clarity = g.rangeM / Math.max(1, g.quietRangeM);
      const id = g.species.id;
      // Même atténuation centre → bord que les navires ; niveau de base modéré (les appels se superposent).
      const gain = a.whales.volume * Math.pow(10, (-a.ships.edgeAttenuationDb * d) / 20) * 0.2;
      const transpose = a.whales.transpose[id] ?? 1;
      const rec = a.whales.source === 'recorded' ? this.bank.pick(id) : null;
      const call = rec
        ? playRecording(ctx, this.output.input, rec.buffer, { gain, clarity, playbackRate: transpose, maxSec: a.whales.maxCallSec[id] ?? 6, levelDbfs: rec.levelDbfs })
        : playCall(ctx, this.output.input, { timeScale, species: id, gain, clarity, transpose });
      this.playingCalls.push(call);
    }

    // Navires et nappe : dix fois par seconde suffit.
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;

    // Candidats : les voix actives, plus les 2 × voix plus forts. L'allocateur ne retient jamais un nouveau
    // venu au-delà des (voix + actives) premiers : c'est équivalent à tout lui passer, sans allouer un objet
    // par navire (des dizaines de milliers avec les navires estimés).
    type Cand = { id: number; score: number; i: number; sog: number; classIndex: number; lengthM: number };
    const n = a.enabled ? a.ships.voices : 0;
    const k = 2 * Math.max(1, n);
    const top: Cand[] = []; // décroissant, au plus k
    const kept: Cand[] = [];
    const s = this.sample;
    for (let i = 0; i < ships.shipCount; i++) {
      // Le score ne dépasse jamais le niveau source : la plupart des navires s'écartent sans calcul de position.
      const active = this.active.has(ships.idOf(i));
      if (!active && top.length >= k && ships.slBroadOf(i) <= top[top.length - 1].score) continue;
      ships.shipInto(i, now, s);
      if (s.sog < 0.5) continue;
      const d = listener.distance(s.lat, s.lon);
      if (!Number.isFinite(d)) continue;
      const score = s.slBroad - a.ships.edgeAttenuationDb * d;
      if (!active && top.length >= k && score <= top[top.length - 1].score) continue;
      const c = { id: s.id, score, i, sog: s.sog, classIndex: s.classIndex, lengthM: s.lengthM };
      if (active) {
        kept.push(c);
        continue;
      }
      let j = top.length;
      while (j > 0 && top[j - 1].score < score) j--;
      top.splice(j, 0, c);
      if (top.length > k) top.pop();
    }
    const candidates = [...kept, ...top];
    this.active = allocate(this.active, candidates, n, a.ships.hysteresisDb);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    // Somme de voix : niveau d'ensemble stable quel que soit le nombre de voix.
    const norm = 0.5 / Math.sqrt(Math.max(1, n));
    for (const [id, v] of this.voices) {
      if (!this.active.has(id)) {
        v.release();
        this.voices.delete(id);
      }
    }
    for (const id of this.active) {
      const c = byId.get(id)!;
      let v = this.voices.get(id);
      if (!v) {
        v = new ShipVoice(ctx, this.output.input, this.pink!);
        this.voices.set(id, v);
      }
      // Plafonné au niveau de référence : aucune voix ne dépasse le volume plein.
      const rel = Math.pow(10, (Math.min(c.score, a.ships.refDb) - a.ships.refDb) / 20);
      v.set({ classIndex: c.classIndex, lengthM: c.lengthM, sog: c.sog, gain: a.ships.volume * norm * rel }, a.ships.transposeOctaves);
    }

    // Nappe : moyenne énergétique du niveau de la bande basse (le grondement) sur une grille de points
    // de la vue ; elle réagit tout de suite à ce que l'on regarde.
    if (field.ready) {
      let e = 0;
      let k = 0;
      for (const [lat, lon] of listener.samples()) {
        const db = field.sample(lat, lon, 1);
        const nat = naturalLevel(cfg.bands[0], cfg.ambient.windSpeedMs);
        if (!Number.isFinite(db) || db <= nat + 0.01) continue; // terre ou silence absolu
        e += Math.pow(10, db / 10);
        k++;
      }
      const mean = k ? 10 * Math.log10(e / k) : naturalLevel(cfg.bands[0], cfg.ambient.windSpeedMs);
      const acc = cfg.accumulation;
      this.bedIntensity = Math.max(0, Math.min(1, (mean - acc.quietDb) / (acc.saturationDb - acc.quietDb)));
    }
    this.bed?.set(this.bedIntensity, a.enabled ? a.bed.volume : 0);

    const peak = this.output.peakDb();
    this.status = this.muted
      ? 'son : coupé (M)'
      : `son : ${this.active.size} navires · ${this.playingCalls.length} appels en cours (${a.whales.source === 'recorded' ? this.bank.status : 'synthèse'}) · nappe ${(100 * this.bedIntensity).toFixed(0)} % · crête ${Number.isFinite(peak) ? peak.toFixed(1) : '−∞'} dBFS · limiteur ${this.output.reductionDb.toFixed(1)} dB`;
  }
}
