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
  /** Largeur de la grille physique (champ de bruit calibré en dB). */
  physicsSimWidth: z.number().int().min(256).max(2048),
  /** Largeur de la texture « monde » (modes globe, demi-sphère, équirect, fisheye). */
  worldTextureWidth: z.number().int().min(1024).max(4096),
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
  /** Lueur d'accumulation (bruit durable). */
  glow: color,
  /** Brouillard de la terra incognita. */
  fog: color,
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
    /** flat : carte plate ; globe : globe à l'écran ; hemisphere : demi-sphère éclairée par un projecteur ;
     *  equirect : texture « monde » brute (TouchDesigner, MapMap) ; fisheye : projection azimutale. */
    mode: z.enum(['flat', 'globe', 'hemisphere', 'equirect', 'fisheye']),
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
  /** Globe (modes globe, hemisphere, fisheye) : rotation de la Terre sous un regard fixe. */
  globe: z.object({
    /** Durée d'un tour complet (minutes, temps réel). 0 = immobile. */
    periodMinutes: z.number().min(0).max(1440),
    /** Latitude présentée au centre (inclinaison de l'axe vers le public). */
    viewLatDeg: z.number().min(-90).max(90),
    /** Longitude au centre au démarrage. */
    startLonDeg: z.number().min(-180).max(180),
    /** Ralentissements : quand une longitude passe au centre, la rotation ralentit. */
    dwell: z.array(z.object({ name: z.string(), lonDeg: z.number(), widthDeg: z.number().min(1).max(180), slowdown: z.number().min(0.02).max(1) })),
    /** Assombrissement du limbe à l'écran (relief du globe), 0 = aucun. */
    limbShading: unit,
    /** Taille du globe à l'écran (fraction de la hauteur). */
    screenSize: z.number().min(0.2).max(1.5),
  }),
  /** Demi-sphère bombée éclairée par un seul projecteur dans son axe. */
  hemisphere: z.object({
    /** Distance projecteur – centre de la sphère, en rayons de sphère (d/R). */
    distanceRatio: z.number().min(1.2).max(50),
    /** Rapport de projection du projecteur (distance / largeur d'image) au zoom utilisé. */
    throwRatio: z.number().min(0.3).max(5),
    /** Décalage de l'axe optique (fraction de la demi-hauteur d'image) : décalage fixe de l'objectif. */
    shiftX: z.number().min(-2).max(2),
    shiftY: z.number().min(-2).max(2),
    /** Ajustement fin de l'échelle et rotation de l'image (degrés). */
    scale: z.number().min(0.2).max(5),
    rollDeg: z.number().min(-180).max(180),
    /** Compensation de luminosité vers le bord (0 = aucune, 1 = 1/cos complet), plafonnée. */
    edgeCompensation: unit,
    maxGain: z.number().min(1).max(10),
    /** Largeur du fondu au bord du disque (en cosinus d'incidence). */
    edgeSoftness: z.number().min(0).max(0.5),
  }),
  fisheye: z.object({
    fovDeg: z.number().min(60).max(360),
    model: z.enum(['equidistant', 'equisolid']),
  }),
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
    /** Réfraction : vitesse relative des ondes en eau peu profonde (1 = aucun effet). */
    shallowSpeed: z.number().min(0.2).max(1),
  }),
  ships: z.object({
    visible: z.boolean(),
    pointSize: z.number().min(0).max(10),
    opacity: unit,
  }),
  bands: z
    .array(
      z.object({
        id: z.enum(['low', 'mid', 'high']),
        fMin: z.number(),
        fMax: z.number(),
        /** Bruit ambiant naturel dans la bande (dB re 1 µPa, niveau de bande) — Wenz, état de mer ~3. */
        naturalDb: z.number(),
      }),
    )
    .length(3),
  /** Champ de bruit physique (grille calibrée en dB). */
  physics: z.object({
    enabled: z.boolean(),
    /** Constante de temps de la moyenne d'énergie (s, temps réel). */
    energyTauSec: z.number().min(0.5).max(60),
    /** Amortissement supplémentaire par pas en eau très peu profonde, sous la fréquence de coupure modale. */
    bottomLoss: z.number().min(0).max(0.5),
    /** Perte générique sur le plateau (profondeur < 200 m), dB/km. */
    shallowLossDbPerKm: z.number().min(0).max(1),
    /** Perte empirique supplémentaire partout (dB/km) : corrige l'étalement cylindrique, optimiste au large. */
    extraLossDbPerKm: z.number().min(0).max(0.1),
  }),
  /** Accumulation : l'océan se « sature » là où le bruit dure. */
  accumulation: z.object({
    /** Poids des bandes dans le niveau affiché (somme énergétique pondérée). */
    bandWeights: z.object({ low: unit, mid: unit, high: unit }),
    /** Niveau (dB re 1 µPa) en dessous duquel l'océan reste noir. */
    quietDb: z.number(),
    /** Niveau de saturation (pleine lueur). */
    saturationDb: z.number(),
    gamma: z.number().min(0.2).max(5),
    /** Montée (minutes, temps réel) : la saturation s'installe progressivement. */
    riseMinutes: z.number().min(0.01).max(240),
    /** Décrue (minutes) : l'océan garde la trace. */
    fallMinutes: z.number().min(0.01).max(1440),
    /** Intensité de la lueur. */
    strength: z.number().min(0).max(4),
  }),
  /** Matière de la terra incognita (zones non observées par l'AIS). */
  incognita: z.object({
    /** Intensité du brouillard. */
    fog: unit,
    /** Échelle du brouillard (degrés). */
    scaleDeg: z.number().min(0.5).max(90),
    /** Vitesse de dérive du brouillard. */
    drift: z.number().min(0).max(5),
    /** Grain fin (0 = aucun). */
    grain: unit,
    /** Les ondes qui entrent dans l'ombre s'y estompent (0 = disparaissent, 1 = intactes). */
    waveKeep: unit,
  }),
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
  /** Cétacés : groupes simulés, espace de communication, liens (J4). */
  whales: z.object({
    enabled: z.boolean(),
    /** Accélération du déplacement des groupes (artistique). */
    timeScale: z.number().min(0).max(1000),
    /** Probabilité d'habitat minimale (0–1) pour placer ou déplacer un groupe. */
    habitatThreshold: unit,
    /** Positions initiales tirées des observations OBIS quand elles existent. */
    useSightings: z.boolean(),
    color: color,
    /** Espace de communication : remplissage, contour, douceur (dB). */
    space: z.object({ fill: unit, contour: unit, softnessDb: z.number().min(0.5).max(40), markerSize: z.number().min(0).max(20) }),
    links: z.object({
      enabled: z.boolean(),
      hysteresisDb: z.number().min(0).max(20),
      breakSec: z.number().min(0.1).max(120),
      reknitSec: z.number().min(0.1).max(300),
      ghostSec: z.number().min(0).max(3600),
      intensity: z.number().min(0).max(4),
      ghost: unit,
      /** Vitesse des impulsions le long des fils (fraction du fil par seconde). */
      pulseSpeed: z.number().min(0.01).max(5),
    }),
    species: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        latin: z.string(),
        enabled: z.boolean(),
        groups: z.number().int().min(0).max(200),
        band: z.enum(['low', 'mid', 'high']),
        /** Niveau source de l'appel (dB re 1 µPa·m). */
        sl: z.number(),
        /** Seuil de détection (dB). */
        dt: z.number(),
        callBandwidthHz: z.number().min(0.1),
        callIntervalSec: z.number().min(0.5),
        minDepthM: z.number().min(0),
        speedKmh: z.number().min(0),
        /** Exagération visuelle des distances (1 = vraie échelle) : portée réelle trop petite à l'échelle du globe. */
        visualScale: z.number().min(1).max(100),
        color: color.optional(),
      }),
    ),
  }),
  /** Son (J5) : un seul bus de sortie, sans spatialisation. */
  audio: z.object({
    enabled: z.boolean(),
    /** Volume général (0–1), avant le limiteur. */
    master: unit,
    ships: z.object({
      volume: unit,
      /** Nombre maximal de voix de navires simultanées. */
      voices: z.number().int().min(0).max(32),
      /** Niveau source (dB) qui donne le volume plein. */
      refDb: z.number(),
      /** Atténuation (dB) entre le centre de la vue et son bord : on entend surtout ce que l'on regarde. */
      edgeAttenuationDb: z.number().min(0).max(60),
      /** Écart (dB) qu'un navire doit avoir pour prendre la place d'une voix existante. */
      hysteresisDb: z.number().min(0).max(20),
      /** Transposition (octaves) : les vrais 10–60 Hz demandent un caisson de basses. */
      transposeOctaves: z.number().min(-1).max(4),
    }),
    bed: z.object({ volume: unit }),
    whales: z.object({
      volume: unit,
      voices: z.number().int().min(0).max(16),
      /** Délai d'une réponse (s) le long d'un lien vivant. */
      answerDelaySec: z.number().min(0).max(20),
      /** Transposition (facteur de fréquence) par espèce : les infrasons des rorquals sont inaudibles sans cela. */
      transpose: z.record(z.string(), z.number().min(0.25).max(16)),
    }),
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
