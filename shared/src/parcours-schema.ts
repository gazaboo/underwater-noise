/**
 * Parcours (data/parcours) : prototypes de l'issue #4 (pistes dans docs/PARCOURS_PISTES.md). Un parcours est une
 * suite d'étapes ; chaque étape règle la caméra, le scénario, la nappe, une légende courte (avec son statut) et
 * peut ouvrir une fiche. Les parcours n'inventent rien : ils montrent le modèle et les données de la carte.
 */
import { z } from 'zod';
import { valueStatus } from './media-schema.ts';

export const parcoursStep = z.object({
  /** Durée de l'étape (s réelles). */
  duration: z.number().positive(),
  /** Caméra : un lieu (data/lieux) ou un point ; zoom de la carte plate (1 = carte entière). */
  camera: z.object({
    lieu: z.string().optional(),
    lon: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
    zoom: z.number().positive().default(1),
    /** Durée du vol (s), sur le globe. */
    flySec: z.number().min(0).default(3),
  }).refine((c) => c.lieu !== undefined || (c.lon !== undefined && c.lat !== undefined), 'lieu ou lon/lat').optional(),
  /** Mode d'affichage, appliqué seulement à l'écran ou sur le web (jamais sur le dôme). */
  mode: z.enum(['flat', 'globe']).optional(),
  scenario: z.enum(['actuel', 'sans-navires']).optional(),
  /** Nappe affichée. */
  noise: z.boolean().optional(),
  /** Légende courte, lisible de loin. */
  caption: z.string().optional(),
  /** Statut de ce que dit la légende, et sa source (infobulle). */
  status: valueStatus.optional(),
  source: z.string().optional(),
  /** Fiche à ouvrir : 'lieu:<id>', 'espece:<id>' (groupe le plus proche du centre) ou 'fermer'. */
  open: z.string().regex(/^(lieu:[a-z0-9-]+|espece:[a-z0-9-]+|fermer)$/).optional(),
});
export type ParcoursStep = z.infer<typeof parcoursStep>;

export const parcours = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** Numéro de la piste dans docs/PARCOURS_PISTES.md. */
  piste: z.number().int().positive(),
  loop: z.boolean(),
  steps: z.array(parcoursStep).min(1),
});
export type Parcours = z.infer<typeof parcours>;

/** data/parcours/liste.json */
export const parcoursIndex = z.object({ parcours: z.array(z.string()) });
