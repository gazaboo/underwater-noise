/**
 * Schéma de la configuration (config/default.json5 + surcharges).
 *
 * Les valeurs vivent dans config/default.json5 (commenté, c'est la référence pour
 * l'artiste) ; ce schéma n'en vérifie que la forme et les bornes.
 */
import { z } from 'zod';
import { SHIP_CLASSES } from './acoustics/jomopans-echo.ts';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #rrggbb');
const unit = z.number().min(0).max(1);

const qualityProfile = z.object({
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
  /** Terres « gouache » : luminosité générale (basse la nuit) et teinte multipliée (chaleur). */
  landLight: unit,
  landTint: color,
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
  /** Bruit ajouté par les navires (couche de données) : du plus faible palier au plus fort. Artistique. */
  noiseLow: color,
  noiseMid: color,
  noiseHigh: color,
});

/** Couleurs du monde illustré (une palette pour la nuit, une pour le jour). Toutes artistiques. */
const illustratedPalette = z.object({
  ice: color, tundra: color, boreal: color, temperate: color, tropical: color,
  grass: color, savanna: color, sand: color, rock: color,
  /** Roche d'altitude, neiges, plages. */
  mountain: color, snow: color, beach: color,
  /** Mer peu profonde du plateau continental, lignes d'eau le long des côtes. */
  shelf: color, ripple: color,
  /** Teinte multipliée des ornements (vignettes). */
  ornament: color,
});

const illustrated = z.object({
  night: illustratedPalette,
  day: illustratedPalette,
  /** Variation de ton héritée de Natural Earth II à l'intérieur d'un milieu. */
  tone: unit,
  /** Lumière précalculée du relief (ombré, ombres portées, vallées). */
  relief: z.number().min(0).max(2),
  /** Paliers d'altitude (relief « en couches de papier ») : ombre portée et liseré éclairé. */
  terraces: z.object({ enabled: z.boolean(), shadow: unit, lip: unit, shadowPx: z.number().min(0).max(20) }),
  /** Neiges éternelles (limite d'ordre de grandeur selon la latitude) et roche d'altitude. */
  snow: unit,
  rock: unit,
  /** Côtes : plage (largeur à l'écran), ombre portée des terres sur la mer, liseré éclairé. */
  coast: z.object({ beachPx: z.number().min(0).max(20), beach: unit, shadowPx: z.number().min(0).max(30), shadow: unit, rim: unit }),
  /** Teinte du plateau continental (mer peu profonde). */
  shelf: unit,
  /** Lignes d'eau parallèles aux côtes (fixes : ne pas confondre avec les ondes sonores). */
  ripples: z.object({ enabled: z.boolean(), spacingPx: z.number().min(2).max(40), strength: unit }),
});

/** Surcharges propres à une cible d'affichage (écran du portable / projecteur). */
const targetOverride = z.object({
  render: render.partial().optional(),
  palette: palette.partial().optional(),
  view: z.object({ flat: flatView.partial().optional() }).partial().optional(),
});

export const configSchema = z.object({
  science: z.object({
    mode: z.enum(['reference', 'experimental']).default('reference'),
    /** Résumé de validation publié par tools/science (écarts mesurés par zone), sous data/science/. */
    validationSummary: z.string().default('data/science/validation-summary.json'),
  }).default({}),
  playback: z.object({ timeScale: z.number().min(1).max(100).default(1) }).default({}),
  display: z.object({
    target: z.enum(['screen', 'projector']),
    /** flat : carte plate ; globe : globe à l'écran ; hemisphere : demi-sphère éclairée par un projecteur ;
     *  equirect : texture « monde » brute (TouchDesigner, MapMap) ; fisheye : projection azimutale. */
    mode: z.enum(['flat', 'globe', 'hemisphere', 'equirect', 'fisheye']),
    quality: z.enum(['expo', 'light']),
    /** night : palette de l'installation (fond noir) ; day : palette claire pour lire la carte (touche J). */
    theme: z.enum(['night', 'day']),
  }),
  qualityProfiles: z.object({ expo: qualityProfile, light: qualityProfile }),
  view: z.object({
    flat: flatView,

  }),
  render,
  palette,
  /** Palette du mode jour (display.theme = 'day') : remplace `palette` champ par champ. */
  dayPalette: palette.partial(),
  /** Globe (modes globe, hemisphere, fisheye) : rotation de la Terre sous un regard fixe. */
  globe: z.object({
    /** Durée d'un tour complet (minutes réelles : présentation, indépendante du facteur temporel). 0 = immobile. */
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
    /** Bande dont les fronts et l'augmentation sur le fond sont affichés. */
    band: z.enum(['low', 'mid', 'high']).default('low'),
    /** Rendu des ondes : gain de luminosité et part de l'éclairage « relief ». */
    brightness: z.number().min(0).max(20),
    relief: unit,
  }),
  /**
   * Représentation du bruit ajouté par les navires, ΔL = 10·log10(1 + E_navires / E_naturel) dans la bande
   * `waves.band`. La forme vient du champ calculé [C] ; paliers, couleurs et mouvement sont artistiques [A].
   */
  noise: z.object({
    /** isophones : nappe en paliers + lignes d'égal niveau qui défilent ; meteo : nappe seule, immobile ;
     *  encre : traînées émises par les navires le long du gradient ; fronts : fronts bruts du modèle. */
    style: z.enum(['isophones', 'meteo', 'encre', 'fronts']).default('isophones'),
    /** Lissage d'affichage de l'énergie (s, temps de la scène) : supprime le pompage de la moyenne courte. */
    smoothSec: z.number().min(1).max(600).default(45),
    /** Régime établi supposé avant le début de l'histoire (minutes de scène, navires immobiles). 0 = aucun. */
    warmupMinutes: z.number().min(0).max(120).default(20),
    /** Paliers de la nappe (dB au-dessus du fond naturel). */
    steps: z.tuple([z.number(), z.number(), z.number()]).default([10, 20, 30]),
    /** Écart entre deux lignes d'égal niveau (dB) et leur défilement (lignes par seconde réelle). */
    lineStepDb: z.number().min(0.5).max(20).default(5),
    lineSpeed: z.number().min(0).max(5).default(0.35),
    /** Opacité de la nappe et intensité des lignes. */
    opacity: unit.default(0.8),
    lines: unit.default(0.55),
    /** Encre : nombre de traînées et durée de vie (s réelles). */
    inkParticles: z.number().int().min(0).max(100000).default(24000),
    inkLifeSec: z.number().min(1).max(60).default(9),
  }).default({}),
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
        /**
         * Bruit ambiant naturel dans la bande (dB re 1 µPa, niveau de bande). Calculé par le serveur à partir
         * du modèle `ambient` (vent) s'il est absent ; une valeur donnée ici le remplace (à documenter).
         */
        naturalDb: z.number().optional(),
      }),
    )
    .length(3),
  /** Champ de bruit physique (grille calibrée en dB). */
  physics: z.object({
    enabled: z.boolean(),
    /** Constante de temps de la moyenne d'énergie (s, temps de scène). */
    energyTauSec: z.number().min(0.5).max(60),
    /** Pertes au fond en eau peu profonde (< 200 m, nulles au-delà de 400 m) : dB par rebond. */
    bottomBounceLossDb: z.number().min(0).max(10),
    /** Angle de rasance effectif des trajets qui touchent le fond (degrés). */
    grazingAngleDeg: z.number().min(1).max(45),
    /** Célérité du sédiment (m/s), pour la fréquence de coupure modale. */
    sedimentSoundSpeed: z.number().min(1510).max(3000),
    /** Perte sous la fréquence de coupure modale (dB/km). */
    cutoffLossDbPerKm: z.number().min(0).max(100),
    /** Perte supplémentaire partout (dB/km) ; 0 par défaut : aucune valeur sourcée. */
    extraLossDbPerKm: z.number().min(0).max(0.1),
  }),
  /** Bruit ambiant naturel : modèle empirique (Coates 1990, via Stojanovic 2007 / Lucani et al. 2008), sans trafic. */
  ambient: z.object({
    /** Vitesse du vent (m/s) : fixe la composante « vent » (dominante entre ~100 Hz et 10 kHz). */
    windSpeedMs: z.number().min(0).max(30),
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
    /** Montée (minutes, temps de la scène) : la saturation s'installe progressivement. */
    riseMinutes: z.number().min(0.01).max(240),
    /** Décrue (minutes) : l'océan garde la trace. */
    fallMinutes: z.number().min(0.01).max(1440),
    /** Intensité de la lueur. */
    strength: z.number().min(0).max(4),
  }),
  /** Terres peintes (gouache d'après Natural Earth II) et ornements « Petit Prince ». Paramètres artistiques. */
  land: z.object({
    /** 'illustre' : monde illustré (milieux, paliers de relief, côtes, ornements dans tous les modes) ;
     *  'gouache' : terres peintes de la première proposition ; 'flat' : aplat `palette.land` (rendu d'origine). */
    style: z.enum(['illustre', 'gouache', 'flat']),
    /** Monde illustré (land.style = 'illustre'). Cartes précalculées par tools/build_illustrated.py. */
    illustrated: illustrated,
    /** Saturation des couleurs Natural Earth II (pastel à l'origine : > 1 les ravive). */
    saturation: z.number().min(0).max(3),
    /** Nombre de paliers de luminosité (aplats de gouache) ; 0 = dégradé continu. */
    steps: z.number().int().min(0).max(12),
    /** Intensité du relief ombré (lumière chaude, ombre froide). */
    relief: z.number().min(0).max(2),
    /** Taille des coups de pinceau (degrés) et amplitude de la déformation des frontières. */
    brushScale: z.number().min(0.05).max(10),
    brushWarp: unit,
    /** Grain du pigment (granulation de l'aquarelle). */
    granulation: unit,
    /** Pigment accumulé au bord des côtes (bord « mouillé »). */
    wetEdge: unit,
    /** Petits arbres (forêts) et volcans (positions du Smithsonian GVP), visibles au zoom sur la carte plate. */
    ornaments: z.object({
      enabled: z.boolean(),
      /** Zoom à partir duquel ils apparaissent (fondu). */
      minZoom: z.number().min(1).max(40),
      /** Part des cellules forestières qui portent un arbre. */
      treeDensity: unit,
      volcanoes: z.boolean(),
      /** Taille des volcans à l'écran (pixels CSS, au zoom d'apparition). */
      volcanoSize: z.number().min(2).max(80),
      /** Panache de fumée pour les volcans dont la dernière éruption est postérieure à cette année. */
      smokeSinceYear: z.number().int(),
      /** Monde illustré : taille des vignettes (pixels CSS pour une Terre de 1000 px de diamètre). */
      size: z.number().min(4).max(200),
      /** Croissance des vignettes avec le zoom (0 = taille fixe à l'écran, 1 = proportionnelle). */
      growth: z.number().min(0).max(1),
      /** Densité : plus elle est forte, plus les niveaux de détail apparaissent tôt (vignettes serrées). */
      density: z.number().min(0.1).max(4),
      /** Arbres, buissons et pierres ; montagnes ; fumée des volcans récents. */
      vegetation: z.boolean(),
      mountains: z.boolean(),
      smoke: z.boolean(),
      /** Nuages peints dérivant vers l'est (artistiques, sans lien avec la météo). */
      clouds: z.object({ enabled: z.boolean(), count: z.number().int().min(0).max(200), opacity: unit, speed: z.number().min(0).max(10) }),
    }),
    /** Grain de papier sur toute l'image (espace écran). */
    paper: z.object({ enabled: z.boolean(), strength: unit, scale: z.number().min(0.2).max(10) }),
    /** Ciel étoilé et halo d'atmosphère autour du globe (mode globe à l'écran seulement). */
    stars: z.object({ enabled: z.boolean(), density: unit, twinkle: unit, halo: unit }),
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
    /** Ancien réglage ignoré : utiliser playback.timeScale. */
    timeScale: z.unknown().transform(() => 1),
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
    /**
     * Navires affichés : real = source réelle (direct, replay, ou simulation par routes en secours) ;
     * estimated = navires estimés d'après la densité mondiale Global Fishing Watch ;
     * mixed = réels là où l'AIS couvre, estimés ailleurs.
     */
    ships: z.enum(['real', 'estimated', 'mixed']),
    /** En mode mixte : couverture AIS (0–1) en dessous de laquelle une cellule de 1° reçoit des navires estimés. */
    coverageThreshold: unit,
  }),
  /** Navires estimés (tools/build_presence.py → data/density). */
  estimated: z.object({
    dir: z.string(),
    /** Ancien réglage ignoré : utiliser playback.timeScale. */
    timeScale: z.unknown().transform(() => 1),
    /** Plafond de sécurité : au-delà, l'effectif est réduit (le bruit est alors sous-estimé). */
    maxShips: z.number().int().min(0).max(65000),
    /** Durée de vie moyenne d'un navire avant renaissance ailleurs (heures simulées). */
    lifetimeHours: z.number().min(0.1).max(1000),
    /** Distance d'anticipation pour suivre les couloirs de densité (km). */
    lookAheadKm: z.number().min(1).max(500),
    /** Répartition de chaque groupe GFW en classes JOMOPANS-ECHO (poids relatifs). */
    classMix: z.record(z.string(), z.record(z.enum(SHIP_CLASSES), z.number().min(0))),
    seed: z.number().int(),
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
    /** Ancien réglage ignoré : utiliser playback.timeScale. */
    speed: z.unknown().transform(() => 1),
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
    /** Ancien réglage ignoré : utiliser playback.timeScale. */
    timeScale: z.unknown().transform(() => 1),
    /** Probabilité d'habitat minimale (0–1) pour placer ou déplacer un groupe. */
    habitatThreshold: unit,
    /** Positions initiales tirées des observations OBIS quand elles existent. */
    useSightings: z.boolean(),
    color: color,
    /** Espace de communication : remplissage, contour, douceur (dB). */
    space: z.object({
      fill: unit, contour: unit, softnessDb: z.number().min(0.5).max(40), markerSize: z.number().min(0).max(20),
      /** Vue globale : remplissage faible, sans contour (la lecture passe par les glyphes et les fils). */
      farFill: unit.default(0.06),
      /** Espace perdu (audible sans navires, plus maintenant) : semis de points. */
      lost: unit.default(0.35),
    }),
    /** Glyphes par espèce (silhouettes), taille à l'écran (pixels CSS) et liseré sombre. Artistique. */
    glyphs: z.object({ size: z.number().min(4).max(80).default(26), outline: color.default('#08131c') }).default({}),
    /** Passage vue globale → vue rapprochée (bulle perdue, anneaux d'appel), en pixels CSS par degré. */
    lod: z.object({ closePxPerDeg: z.number().min(1).max(500).default(14), fullPxPerDeg: z.number().min(1).max(1000).default(30) }).default({}),
    /** Anneau émis à chaque appel : durée de son expansion jusqu'à la portée sans navires (s de scène). [A] */
    calls: z.object({ ringSec: z.number().min(0.3).max(30).default(3.2) }).default({}),
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
      /** Épaisseur des fils à l'écran (pixels CSS). */
      widthPx: z.number().min(0.5).max(10).default(2.2),
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
