/** Vérifie les parcours commités : schéma, et chaque lieu, espèce ou pas de légende référencé existe. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { lieuIndex } from '../src/media-schema.ts';
import { parcours, parcoursIndex } from '../src/parcours-schema.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const DATA = join(ROOT, 'data');
const read = (p: string): unknown => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const species = new Set((JSON5.parse(readFileSync(join(ROOT, 'config', 'default.json5'), 'utf8')) as { whales: { species: { id: string }[] } }).whales.species.map((s) => s.id));
const lieux = new Set(lieuIndex.parse(read('lieux/liste.json')).lieux);
const ids = existsSync(join(DATA, 'parcours', 'liste.json')) ? parcoursIndex.parse(read('parcours/liste.json')).parcours : [];

describe('parcours', () => {
  for (const id of ids) {
    it(id, () => {
      const p = parcours.parse(read(`parcours/${id}.json`));
      expect(p.id).toBe(id);
      for (const s of p.steps) {
        if (s.camera?.lieu) expect(lieux, `${id} : caméra ${s.camera.lieu}`).toContain(s.camera.lieu);
        if (s.open?.startsWith('lieu:')) expect(lieux, `${id} : ${s.open}`).toContain(s.open.slice(5));
        if (s.open?.startsWith('espece:')) expect(species, `${id} : ${s.open}`).toContain(s.open.slice(7));
        // Une légende qui affirme quelque chose porte un statut, et une source dès qu'elle n'est pas artistique.
        if (s.caption && s.status && s.status !== 'A') expect(s.source, `${id} : « ${s.caption} »`).toBeTruthy();
      }
    });
  }
});
