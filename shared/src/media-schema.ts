/**
 * Schémas des données de vulgarisation : catalogue des médias (data/media/catalog.json, produit par
 * tools/build_media.py), fiches espèces (data/fiches/especes.json) et lieux (data/lieux/).
 *
 * Le client ne revalide pas ces fichiers : shared/test/media.test.ts les vérifie au moment des tests.
 * Règle commune : chaque média porte sa provenance, sa licence (ou l'accord obtenu) et son crédit ; chaque
 * valeur montrée au public porte son statut.
 */
import { z } from 'zod';

/**
 * Statut d'une valeur ou d'une transformation (docs/REVUE_SCIENTIFIQUE.md) :
 * S sourcé · S-r source repérée, à vérifier · O ordre de grandeur · C calculé par le modèle ·
 * E choix empirique · A choix artistique · L littérature générale.
 */
export const valueStatus = z.enum(['S', 'S-r', 'O', 'C', 'E', 'A', 'L']);
export type ValueStatus = z.infer<typeof valueStatus>;

const text = z.string().min(1);
const relPath = z.string().regex(/^[\w./-]+$/, 'chemin relatif à data/media');

/** Sujet d'un média : une espèce de la config (whales.species[].id) ou un lieu (data/lieux). */
export const mediaSubject = z.union([
  z.object({ species: text }).strict(),
  z.object({ lieu: text }).strict(),
]);

export const mediaOrigin = z.object({
  source: text,
  /** Page de la source (pas le fichier). */
  url: z.string().url(),
  author: text,
  /** Date ISO, ou vide quand la source ne la donne pas. */
  recordedAt: z.string(),
  place: text,
  instrument: text,
});

const transform = z.object({ op: text, detail: text, status: valueStatus });

const common = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  subject: mediaSubject,
  title: text,
  origin: mediaOrigin,
  /** Licence de la source, ou « accord personnel <date> ». */
  license: text,
  credit: text,
  transforms: z.array(transform).min(1),
  notes: z.string(),
  status: valueStatus,
};

export const soundItem = z.object({
  ...common,
  kind: z.literal('son'),
  /** Opus (.ogg) et AAC (.m4a, repli), à la hauteur d'origine. */
  files: z.object({ ogg: relPath, m4a: relPath }),
  durationSec: z.number().positive(),
  sampleRateHz: z.number().int().positive(),
  /** Niveau actif du fichier (dBFS, 90e centile des trames de 100 ms) : égalisation à la lecture [E]. */
  levelDbfs: z.number().max(0),
  /** Spectrogramme de l'extrait original, en niveaux de gris, hautes fréquences en haut. */
  spectrogram: z.object({
    file: relPath,
    fMinHz: z.number().min(0),
    fMaxHz: z.number().positive(),
    computedOn: z.literal('original'),
  }),
});

export const photoItem = z.object({
  ...common,
  kind: z.literal('photo'),
  files: z.object({ image: relPath }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const mediaItem = z.discriminatedUnion('kind', [soundItem, photoItem]);
export type MediaItem = z.infer<typeof mediaItem>;
export type SoundItem = z.infer<typeof soundItem>;

export const mediaCatalog = z.object({
  generated: z.string(),
  about: z.string(),
  items: z.array(mediaItem),
});
export type MediaCatalog = z.infer<typeof mediaCatalog>;

/** Une valeur affichée dans une fiche : toujours un statut et une source. */
export const fact = z.object({
  value: z.union([z.number(), text]),
  unit: z.string().optional(),
  status: valueStatus,
  source: text,
  note: z.string().optional(),
});
export type Fact = z.infer<typeof fact>;

/** Rubriques d'une fiche espèce, dans l'ordre d'affichage. */
export const FACT_LABELS = {
  longueur: 'Longueur',
  masse: 'Masse',
  longevite: 'Longévité',
  groupe: 'Groupes',
  regime: 'Alimentation',
  migration: 'Déplacements',
  statutUicn: 'Liste rouge UICN',
  effectif: 'Effectif',
  menaces: 'Menaces',
} as const;

/** Sens des statuts, pour l'infobulle des badges. */
export const STATUS_LABELS: Record<ValueStatus, string> = {
  S: 'sourcé',
  'S-r': 'source repérée, à confirmer',
  O: 'ordre de grandeur',
  C: 'calculé par le modèle',
  E: 'choix empirique',
  A: 'choix artistique',
  L: 'littérature générale',
};

export const speciesCard = z.object({
  /** whales.species[].id */
  id: text,
  name: text,
  latin: text,
  facts: z.record(z.string(), fact),
  /** Identifiants du catalogue des médias. */
  sounds: z.array(text),
  photos: z.array(text),
});

export const speciesCards = z.object({ about: z.string().optional(), species: z.array(speciesCard) });
export type SpeciesCard = z.infer<typeof speciesCard>;

/**
 * Lieu : une zone sonore (#2), un focus régional (#15) ou une étape de parcours (#4).
 * Un focus ajoute des couches locales, valables seulement dans son cadre.
 */
export const lieu = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: text,
  center: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  radiusKm: z.number().positive(),
  /** Texte court, lisible de loin. */
  text,
  /** Statut de la position et du texte. */
  status: valueStatus,
  source: text,
  /** Identifiants du catalogue des médias (sujet { lieu: id }). */
  sounds: z.array(text),
  /** Lieu de contraste (récif sain / blanchi, avec / sans navires). */
  pair: z.string().optional(),
  /** Vitesse de lecture des sons du lieu (hauteur et durée) : transposition des basses fréquences [A]. */
  playbackRate: z.number().min(0.25).max(16).optional(),
  /** Paire de sons du même lieu à comparer : calme et avec navires, et ce qu'il faut en dire. */
  contrast: z.object({ quiet: text, noisy: text, text }).optional(),
  /** Couches locales d'un focus régional (phase ultérieure). */
  layers: z.array(z.object({ id: text, file: relPath, source: text, license: text })).optional(),
});
export type Lieu = z.infer<typeof lieu>;

/** data/lieux/liste.json */
export const lieuIndex = z.object({ lieux: z.array(z.string()) });
