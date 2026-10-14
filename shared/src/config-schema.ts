/**
 * Schéma de la configuration (config/default.json5 + surcharges).
 *
 * Les valeurs vivent dans config/default.json5 (commenté, c'est la référence pour
 * l'artiste) ; ce schéma n'en vérifie que la forme et les bornes.
 */
import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #rrggbb');
const unit = z.number().min(0).max(1);

const qualityProfile = z.object({
  /** Largeur de la grille visuelle (hauteur = largeur / 2). */
  visualSimWidth: z.number().int().min(256).max(4096),
  /** Pas de simulation par image. */
  visualSimSteps: z.number().int().min(1).max(8),
  /** Largeur de la grille de détail (zoom), en cellules. */
  detailSimWidth: z.number().int().min(256).max(2048),
});

const flatView = z.object({
  /** Longitude au centre de la carte. */
  centerLon: z.number().min(-180).max(180),
  /** Latitudes affichées (recadrage). */
  latMin: z.number().min(-90).max(90),
  latMax: z.number().min(-90).max(90),
  /** 'contain' : tout le cadre visible (bandes) ; 'cover' : remplit l'écran (rogne en longitude). */
  fit: z.enum(['contain', 'cover']),
});

const render = z.object({
  /** Fraction de la résolution native utilisée pour le rendu (agrandi ensuite). */
  renderScale: z.number().min(0.25).max(2),
  exposure: z.number().min(0).max(8),
  gamma: z.number().min(0.5).max(3),
  /** Plancher de noir (0–1) : relève le noir pour les projecteurs au noir gris. */
  blackLift: unit,
  vignette: unit,
  dither: z.boolean(),
});

const palette = z.object({
  background: color,
  oceanShallow: color,
  oceanDeep: color,
  /** Intensité du relief bathymétrique (0 = invisible). */
  bathyRelief: unit,
  land: color,
  coast: color,
  /** Luminosité relative des zones non observées par l'AIS (terra incognita) : 1 = aucune différence. */
  unknownDim: unit,
  coastOpacity: unit,
  wave: color,
  ship: color,
});

/** Surcharges propres à une cible d'affichage (écran du portable / projecteur). */
const targetOverride = z.object({
  render: render.partial().optional(),
  palette: palette.partial().optional(),
  view: z.object({ flat: flatView.partial().optional() }).partial().optional(),
});

export const configSchema = z.object({
  display: z.object({
    target: z.enum(['screen', 'projector']),
    mode: z.enum(['flat']),
    quality: z.enum(['expo', 'light']),
  }),
  qualityProfiles: z.object({ expo: qualityProfile, light: qualityProfile }),
  view: z.object({
    flat: flatView,
    /** Grille de détail lancée quand on zoome (exploration). */
    detail: z.object({ enabled: z.boolean(), minZoom: z.number().min(1), margin: z.number().min(1).max(3) }),
  }),
  render,
  palette,
  targets: z.object({ screen: targetOverride, projector: targetOverride }),
  waves: z.object({
    /** Nombre de Courant à l'équateur (cellules par pas) : vitesse visuelle des ondes. */
    courant: z.number().min(0.05).max(0.7),
    /** Amortissement global par pas (persistance des ondes : petit = longues traînes). */
    damping: z.number().min(0).max(0.2),
    /** Amortissement supplémentaire près des côtes (0 = côtes réfléchissantes). */
    coastDamping: z.number().min(0).max(1),
    /** Latitude au-delà de laquelle on considère la banquise (mur). */
    polarCapLat: z.number().min(60).max(89),
    pulse: z.object({
      /** Longueur d'onde des fronts, en cellules de simulation. */
      wavelengthCells: z.number().min(3).max(64),
      /** Nombre de cycles par impulsion (1 = un seul anneau net). */
      cycles: z.number().min(0.5).max(8),
      /** Impulsions par seconde (temps réel) pour un navire de référence. */
      rate: z.number().min(0.01).max(5),
      /** Gain d'injection. */
      gain: z.number().min(0).max(10),
    }),
    /** Correspondance niveau source large bande → amplitude visuelle. */
    amplitude: z.object({
      slMin: z.number(),
      slMax: z.number(),
      /** Exposant de compression (>1 : seuls les plus bruyants ressortent). */
      gamma: z.number().min(0.1).max(5),
    }),
    /** Rendu des ondes : gain de luminosité et part de l'éclairage « relief ». */
    brightness: z.number().min(0).max(20),
    relief: unit,
  }),
  ships: z.object({
    visible: z.boolean(),
    pointSize: z.number().min(0).max(10),
    opacity: unit,
  }),
  bands: z.array(z.object({ id: z.enum(['low', 'mid', 'high']), fMin: z.number(), fMax: z.number() })).length(3),
  simulation: z.object({
    shipCount: z.number().int().min(0).max(50000),
    /** Temps simulé / temps réel (1 = temps réel). */
    timeScale: z.number().min(0.1).max(3600),
    fishingFraction: unit,
    /** Écart latéral typique autour des routes (km). */
    laneWidthKm: z.number().min(0).max(200),
    seed: z.number().int(),
  }),
  /** Choix de la source de navires. */
  source: z.object({
    /** auto : direct si possible, sinon replay, sinon simulation. */
    mode: z.enum(['auto', 'live', 'replay', 'simulation']),
    /** En auto : silence du direct (s) avant de basculer. */
    liveSilenceSec: z.number().min(5).max(3600),
    /** En auto : durée (s) de bonne santé du direct avant d'y revenir. */
    liveRecoverSec: z.number().min(0).max(3600),
    /** Nombre minimal de navires suivis pour considérer le direct exploitable. */
    liveMinShips: z.number().int().min(0),
    /** Mode hybride : navires simulés là où la couverture AIS est faible. */
    hybrid: z.boolean(),
    hybridCoverageThreshold: unit,
  }),
  live: z.object({
    url: z.string(),
    /** Position considérée « ancienne » après N minutes sans message (extrapolée, drapeau). */
    staleAfterMin: z.number().min(0.5),
    /** Durée maximale d'extrapolation à l'estime (minutes). */
    maxExtrapolateMin: z.number().min(0),
    /** Oubli d'un navire après N minutes sans message. */
    evictAfterMin: z.number().min(1),
    /** Inclure les navires à quai (vitesse < 0,5 nœud) dans les instantanés. */
    includeMoored: z.boolean(),
  }),
  replay: z.object({
    /** Fichier .ndjson.gz ou dossier (tous les .ndjson.gz, triés). */
    path: z.string(),
    /** Vitesse de lecture (temps du fichier / temps réel). */
    speed: z.number().min(0.1).max(3600),
    loop: z.boolean(),
  }),
  recorder: z.object({
    enabled: z.boolean(),
    dir: z.string(),
    /** Une position par navire au plus toutes les N secondes. */
    minIntervalSec: z.number().min(0),
  }),
  coverage: z.object({
    /** Demi-vie de la mémoire de couverture (heures, temps de la source). */
    halfLifeHours: z.number().min(0.1),
    /** Gain d'observation par message reçu dans une cellule. */
    gainPerMessage: z.number().min(0).max(1),
    /** Couverture en mode simulation : tout observé, ou dernière couverture réelle enregistrée. */
    simulation: z.enum(['full', 'recorded']),
  }),
  server: z.object({
    port: z.number().int(),
    snapshotHz: z.number().min(0.1).max(10),
  }),
});

export type Config = z.infer<typeof configSchema>;
export type DisplayTarget = Config['display']['target'];

/** Fusion profonde : les objets sont fusionnés, le reste (tableaux compris) est remplacé. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof over !== 'object' || Array.isArray(over)) {
    return over as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** Configuration effective pour une cible d'affichage (surcharges `targets[target]` appliquées). */
export function resolveForTarget(cfg: Config, target: DisplayTarget): Config {
  const o = cfg.targets[target];
  return deepMerge(cfg, { render: o.render, palette: o.palette, view: o.view, display: { ...cfg.display, target } });
}
