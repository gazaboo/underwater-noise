/**
 * Vérifie les données de vulgarisation commitées : catalogue des médias, fiches espèces, lieux.
 * Un média sans licence ou sans crédit, un fichier absent ou une référence cassée fait échouer les tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { FACT_LABELS, lieu, lieuIndex, mediaCatalog, speciesCards } from '../src/media-schema.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const DATA = join(ROOT, 'data');
const read = (p: string): unknown => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const config = JSON5.parse(readFileSync(join(ROOT, 'config', 'default.json5'), 'utf8')) as {
  whales: { species: { id: string }[] };
};
const SPECIES = new Set(config.whales.species.map((s) => s.id));

const catalog = mediaCatalog.parse(read('media/catalog.json'));
const byId = new Map(catalog.items.map((m) => [m.id, m]));
const lieuIds = existsSync(join(DATA, 'lieux', 'index.json')) ? lieuIndex.parse(read('lieux/index.json')).lieux : [];

describe('catalogue des médias', () => {
  it('identifiants uniques', () => {
    expect(byId.size).toBe(catalog.items.length);
  });

  it('chaque média a une licence, un crédit et ses fichiers', () => {
    for (const m of catalog.items) {
      expect(m.license.trim(), m.id).not.toBe('');
      expect(m.credit.trim(), m.id).not.toBe('');
      const files = m.kind === 'son' ? [m.files.ogg, m.files.m4a, m.spectrogram.file] : [m.files.image];
      for (const f of files) expect(existsSync(join(DATA, 'media', f)), `${m.id} : ${f}`).toBe(true);
    }
  });

  it('chaque sujet existe : espèce de la config ou lieu déclaré', () => {
    for (const m of catalog.items) {
      if ('species' in m.subject) expect(SPECIES.has(m.subject.species), m.id).toBe(true);
      else expect(lieuIds, m.id).toContain(m.subject.lieu);
    }
  });

  it('un son au moins par espèce de la config', () => {
    const covered = new Set(catalog.items.flatMap((m) => (m.kind === 'son' && 'species' in m.subject ? [m.subject.species] : [])));
    for (const s of SPECIES) expect(covered.has(s), s).toBe(true);
  });

  it('le spectrogramme est calculé sur l\'original, dans la bande de l\'extrait', () => {
    for (const m of catalog.items) {
      if (m.kind !== 'son') continue;
      expect(m.spectrogram.fMaxHz, m.id).toBeGreaterThan(m.spectrogram.fMinHz);
      expect(m.spectrogram.fMaxHz, m.id).toBeLessThanOrEqual(m.sampleRateHz / 2);
    }
  });
});

describe('lieux', () => {
  for (const id of lieuIds) {
    it(id, () => {
      const l = lieu.parse(read(`lieux/${id}/lieu.json`));
      expect(l.id).toBe(id);
      for (const s of l.sounds) {
        const m = byId.get(s);
        expect(m, `${id} : son ${s}`).toBeDefined();
        expect(m!.subject, `${id} : son ${s}`).toEqual({ lieu: id });
      }
      if (l.pair) expect(lieuIds).toContain(l.pair);
    });
  }
});

describe('fiches espèces', () => {
  const path = join(DATA, 'fiches', 'especes.json');
  it.runIf(existsSync(path))('références et statuts', () => {
    const cards = speciesCards.parse(read('fiches/especes.json'));
    for (const c of cards.species) {
      expect(SPECIES.has(c.id), c.id).toBe(true);
      for (const ref of [...c.sounds, ...c.photos]) expect(byId.has(ref), `${c.id} : ${ref}`).toBe(true);
      for (const key of Object.keys(c.facts)) expect(Object.keys(FACT_LABELS), `${c.id} : rubrique ${key}`).toContain(key);
      for (const p of c.photos) expect(byId.get(p)?.kind, `${c.id} : ${p}`).toBe('photo');
    }
    expect(cards.species.map((c) => c.id).sort()).toEqual([...SPECIES].sort());
  });
});
