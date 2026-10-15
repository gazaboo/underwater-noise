/**
 * Orchestration des cétacés : groupes, rayon d'écoute (équation du sonar avec le bruit local),
 * liens entre groupes, indicateur de connectivité, rendu.
 */
import * as THREE from 'three';
import { bandCenter, thorpAbsorptionDbPerKm, communicationRange, fray, isAlive, isAsymmetric, newLink, pathTransmissionLoss, updateLink, type Config, type LinkState } from '@vacarme/shared';
import type { FlatTransform } from '../render/flat-view.ts';
import { hexToVec3 } from '../render/fullscreen.ts';
import { WhaleAgents, distanceM, lossRateOf, naturalOf, noiseCorrection, type WhaleGroup } from './agents.ts';
import type { FieldReader } from './field-reader.ts';
import { OceanCpu, type ByteGrid, type SpeciesData } from './geo-grids.ts';
import { WhaleRenderer, greatCircleArc, type GroupDraw, type LinkDraw } from './render.ts';

interface Link {
  a: WhaleGroup;
  b: WhaleGroup;
  state: LinkState;
  /** État qu'aurait le lien dans un océan sans navires (pour la connectivité). */
  quietAlive: boolean;
  seed: number;
  draw: LinkDraw;
}

const BAND_INDEX = { low: 0, mid: 1, high: 2 } as const;

/** Appel d'un groupe (pour le son). Une réponse ne déclenche jamais d'autre réponse. */
export interface CallEvent {
  group: WhaleGroup;
  kind: 'call' | 'answer';
  /** Nombre de groupes qui entendent cet appel (0 : appel sans réponse). */
  heardBy: number;
}

export interface WhaleStats {
  groups: number;
  links: number;
  alive: number;
  asymmetric: number;
  quietAlive: number;
  /** Portée moyenne / portée en océan calme, par espèce. */
  rangeRatio: Map<string, number>;
}

export class Whales {
  readonly agents: WhaleAgents;
  private readonly renderer: WhaleRenderer;
  private links = new Map<string, Link>();
  private reader: FieldReader | null = null;
  private linkList: Link[] = [];
  private lastPairs = -1e9;
  private lastGeometry = -1e9;
  private readonly prevPhase = new Map<number, number>();
  private pendingAnswers: { group: WhaleGroup; at: number }[] = [];
  private events: CallEvent[] = [];
  /** Appels sans réponse / avec réponse depuis le début (indicateur). */
  calls = { answered: 0, unanswered: 0 };
  stats: WhaleStats = { groups: 0, links: 0, alive: 0, asymmetric: 0, quietAlive: 0, rangeRatio: new Map() };

  constructor(
    private readonly ocean: OceanCpu,
    data: Map<string, SpeciesData>,
    elevLinear: THREE.Texture,
    oceanTexture: THREE.Texture,
    private readonly coverageAt: (lat: number, lon: number) => number,
    cfg: Config,
    private readonly scene?: string,
  ) {
    this.agents = new WhaleAgents(ocean, data);
    this.agents.populate(cfg, scene);
    this.renderer = new WhaleRenderer(elevLinear, oceanTexture);
  }

  static async create(cfg: Config, oceanUrl: string, elevLinear: THREE.Texture, coverageAt: (lat: number, lon: number) => number, scene?: string): Promise<Whales> {
    const { ByteGrid, loadSpeciesData } = await import('./geo-grids.ts');
    const grid = (await ByteGrid.load(oceanUrl)) as ByteGrid;
    const data = await loadSpeciesData(cfg.whales.species.map((s) => s.id));
    // Même grille côté GPU (espace de communication), mipmappée : voir WhaleRenderer.
    const tex = new THREE.DataTexture(Uint8Array.from(grid.data), grid.width, grid.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return new Whales(new OceanCpu(grid), data, elevLinear, tex, coverageAt, cfg, scene);
  }

  repopulate(cfg: Config): void {
    this.agents.populate(cfg, this.scene);
    this.prevPhase.clear();
    this.pendingAnswers = [];
    this.links.clear();
    this.linkList = [];
    this.lastPairs = -1e9;
  }

  configure(cfg: Config): void {
    this.agents.configure(cfg);
  }

  /** Le segment A–B reste-t-il en mer (pas de lien à travers les terres) ? */
  private waterPath(arc: [number, number][]): boolean {
    for (let i = 1; i < arc.length - 1; i++) if (!this.ocean.isWater(arc[i][0], arc[i][1])) return false;
    return true;
  }

  update(reader: FieldReader, cfg: Config, now: number, dtSec: number): void {
    if (!cfg.whales.enabled) return;
    this.reader = reader;
    this.agents.move(cfg, dtSec);
    const groups = this.agents.groups;

    // Bruit local et rayon d'écoute de chaque groupe (lissé : le rayon « respire »).
    const k = 1 - Math.exp(-dtSec / 1.5);
    for (const g of groups) {
      g.coverage = this.coverageAt(g.lat, g.lon);
      if (!this.reader?.ready) continue;
      const band = BAND_INDEX[g.species.band] + 1;
      const nl = this.reader.sample(g.lat, g.lon, band);
      if (!Number.isFinite(nl)) continue;
      g.noiseCall = nl - noiseCorrection(cfg, g.species);
      const target = communicationRange(g.species, g.noiseCall, g.depth, lossRateOf(cfg, g.species, g.depth));
      g.rangeM += (target - g.rangeM) * k;
    }

    // Appels et réponses. Un appel naturel (cycle de l'espèce) est entendu par les groupes liés ;
    // chacun répond quand l'impulsion lui parvient (temps de trajet du fil + courte pause).
    const travel = 1 / cfg.whales.links.pulseSpeed;
    for (const g of groups) {
      const prev = this.prevPhase.get(g.id);
      this.prevPhase.set(g.id, g.callPhase);
      if (prev === undefined || g.callPhase >= prev) continue;
      const hearers = this.linkList.filter((l) => (l.a === g ? l.state.bHearsA.strength > 0.5 : l.b === g && l.state.aHearsB.strength > 0.5));
      for (const l of hearers) {
        const partner = l.a === g ? l.b : l.a;
        if (!this.pendingAnswers.some((p) => p.group === partner)) this.pendingAnswers.push({ group: partner, at: now + 1000 * (travel + cfg.audio.whales.answerDelaySec) });
      }
      if (hearers.length) this.calls.answered++;
      else this.calls.unanswered++;
      this.events.push({ group: g, kind: 'call', heardBy: hearers.length });
    }
    this.pendingAnswers = this.pendingAnswers.filter((p) => {
      if (now < p.at) return true;
      p.group.callPhase = 0; // l'appel de réponse part maintenant (visuel et son)
      this.prevPhase.set(p.group.id, 0);
      this.events.push({ group: p.group, kind: 'answer', heardBy: 1 });
      return false;
    });

    // Paires candidates (même espèce, à portée en océan calme), toutes les 2 s.
    if (now - this.lastPairs > 2000) {
      this.lastPairs = now;
      this.rebuildPairs(cfg);
    }

    // Marges et états des liens.
    const opts = cfg.whales.links;
    let alive = 0;
    let asym = 0;
    let quiet = 0;
    for (const l of this.linkList) {
      const s = l.a.species;
      const d = distanceM(l.a.lat, l.a.lon, l.b.lat, l.b.lon) / s.visualScale;
      // Pertes intégrées le long de l'orthodromie (profondeur à chaque point de l'arc) : même modèle que
      // le champ de bruit. Étalement : transition à la profondeur sous l'appelant.
      const rates = l.draw.arc.map(([lat, lon]) => lossRateOf(cfg, s, Math.max(10, this.ocean.depth(lat, lon))));
      const tlFromB = pathTransmissionLoss(d, l.b.depth, rates);
      const tlFromA = pathTransmissionLoss(d, l.a.depth, rates);
      // A entend B : l'appel part de B, le bruit compte chez A.
      const mAB = s.sl - tlFromB - l.a.noiseCall - s.dt;
      const mBA = s.sl - tlFromA - l.b.noiseCall - s.dt;
      updateLink(l.state, mAB, mBA, dtSec, opts);
      const natural = naturalOf(cfg, s) - noiseCorrection(cfg, s);
      l.quietAlive = s.sl - Math.min(tlFromA, tlFromB) - natural - s.dt > 0;
      if (isAlive(l.state)) alive++;
      if (isAsymmetric(l.state)) asym++;
      if (l.quietAlive) quiet++;
      Object.assign(l.draw, {
        sAB: l.state.aHearsB.strength,
        sBA: l.state.bHearsA.strength,
        fray: fray(l.state),
        ghost: l.state.ghost,
        margin: Math.max(mAB, mBA),
        sinceA: l.a.callPhase * l.a.species.callIntervalSec,
        sinceB: l.b.callPhase * l.b.species.callIntervalSec,
      });
    }

    // Géométrie des arcs : les groupes bougent lentement, une mise à jour par seconde suffit.
    if (now - this.lastGeometry > 1000) {
      this.lastGeometry = now;
      for (const l of this.linkList) l.draw.arc = greatCircleArc(l.a.lat, l.a.lon, l.b.lat, l.b.lon);
      this.renderer.setLinkGeometry(this.linkList.map((l) => l.draw));
    }
    this.renderer.setLinkStates(this.linkList.map((l) => l.draw));

    const ratio = new Map<string, number[]>();
    for (const g of groups) {
      if (!ratio.has(g.species.id)) ratio.set(g.species.id, []);
      ratio.get(g.species.id)!.push(g.rangeM / Math.max(1, g.quietRangeM));
    }
    this.stats = {
      groups: groups.length,
      links: this.linkList.length,
      alive,
      asymmetric: asym,
      quietAlive: quiet,
      rangeRatio: new Map([...ratio].map(([id, v]) => [id, v.reduce((a, b) => a + b, 0) / v.length])),
    };
  }

  private rebuildPairs(cfg: Config): void {
    const groups = this.agents.groups;
    const next = new Map<string, Link>();
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (a.species.id !== b.species.id) continue;
        const d = distanceM(a.lat, a.lon, b.lat, b.lon) / a.species.visualScale;
        if (d > 1.2 * Math.max(a.quietRangeM, b.quietRangeM)) continue;
        const key = `${a.id}-${b.id}`;
        const existing = this.links.get(key);
        const arc = existing?.draw.arc ?? greatCircleArc(a.lat, a.lon, b.lat, b.lon);
        if (!this.waterPath(arc)) continue;
        if (existing) {
          next.set(key, existing);
          continue;
        }
        const seed = ((a.id * 7919 + b.id * 104729) % 1000) / 1000;
        next.set(key, {
          a,
          b,
          state: newLink(),
          quietAlive: false,
          seed,
          draw: { arc, sAB: 0, sBA: 0, fray: 0, ghost: 0, margin: -99, seed, sinceA: 99, sinceB: 99 },
        });
      }
    }
    // Les liens disparus mais encore fantômes restent le temps de s'effacer.
    for (const [key, l] of this.links) if (!next.has(key) && l.state.ghost > 0.02) next.set(key, l);
    this.links = next;
    this.linkList = [...next.values()];
    this.lastGeometry = -1e9;
  }

  draw(renderer: THREE.WebGLRenderer, view: FlatTransform, cfg: Config, levels: THREE.Texture, coverage: THREE.Texture, timeSec: number, pixelRatio: number, target: THREE.WebGLRenderTarget | null = null): void {
    if (!cfg.whales.enabled) return;
    const base = hexToVec3(cfg.whales.color);
    const groups: GroupDraw[] = this.agents.groups.map((g) => {
      const s = g.species;
      // Rayon visuel maximal : portée en océan calme (le pixel décide ensuite avec le bruit local).
      const radiusKm = Math.min(2500, (g.quietRangeM / 1000) * s.visualScale * 1.05);
      const pulse = Math.exp(-Math.pow(g.callPhase / 0.06, 2)) + Math.exp(-Math.pow((1 - g.callPhase) / 0.02, 2));
      return {
        lat: g.lat,
        lon: g.lon,
        sl: s.sl,
        dt: s.dt,
        noiseCorrection: noiseCorrection(cfg, s),
        depth: g.depth,
        band: BAND_INDEX[s.band],
        alpha: thorpAbsorptionDbPerKm(bandCenter(cfg.bands.find((b) => b.id === s.band)!)) + cfg.physics.extraLossDbPerKm,
        visualScale: s.visualScale,
        radiusKm,
        color: s.color ? hexToVec3(s.color) : base,
        pulse,
      };
    });
    this.renderer.setGroups(groups);
    this.renderer.draw(renderer, view, cfg, levels, coverage, timeSec, pixelRatio, target);
  }

  /** Événements d'appel depuis le dernier relevé (consommés par le son). */
  drainEvents(): CallEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Groupe le plus proche d'un point (pour le diagnostic). */
  nearest(lat: number, lon: number, maxKm = 300): WhaleGroup | null {
    let best: WhaleGroup | null = null;
    let bd = maxKm * 1000;
    for (const g of this.agents.groups) {
      const d = distanceM(lat, lon, g.lat, g.lon);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }
}
