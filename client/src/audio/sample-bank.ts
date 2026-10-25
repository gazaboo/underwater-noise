/**
 * Banque des vrais enregistrements de cétacés : catalogue data/media/catalog.json (tools/build_media.py),
 * décodé une fois au démarrage du son. Opus d'abord, AAC en repli (navigateurs sans Opus).
 * Une espèce sans fichier lisible n'a pas d'entrée : l'appel revient alors à la synthèse.
 */

import type { MediaCatalog, SoundItem } from '@vacarme/shared';
import { dataUrl } from '../data-url.ts';

type Fetch = (url: string) => Promise<Response>;

function formats(): ('ogg' | 'm4a')[] {
  if (typeof document === 'undefined') return ['ogg', 'm4a'];
  const probe = document.createElement('audio');
  return probe.canPlayType('audio/ogg; codecs="opus"') ? ['ogg', 'm4a'] : ['m4a', 'ogg'];
}

export class SampleBank {
  private readonly bySpecies = new Map<string, { item: SoundItem; buffer: AudioBuffer }[]>();
  private readonly byLieu = new Map<string, { item: SoundItem; buffer: AudioBuffer }[]>();
  private loading: Promise<void> | null = null;
  /** Lisible pour le diagnostic. */
  status = 'enregistrements : non chargés';

  constructor(private readonly fetcher: Fetch = (url) => fetch(url)) {}

  /** Charge le catalogue une seule fois (appels suivants : même promesse). */
  load(ctx: BaseAudioContext): Promise<void> {
    this.loading ??= this.loadAll(ctx);
    return this.loading;
  }

  private async loadAll(ctx: BaseAudioContext): Promise<void> {
    this.status = 'enregistrements : chargement…';
    let catalog: MediaCatalog;
    try {
      const r = await this.fetcher(dataUrl('media/catalog.json'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      catalog = (await r.json()) as MediaCatalog;
    } catch (err) {
      this.status = `enregistrements : catalogue absent (${String(err)}), synthèse`;
      return;
    }
    const all = catalog.items.filter((m): m is SoundItem => m.kind === 'son');
    const sounds = all.filter((m) => 'species' in m.subject);
    const order = formats();
    await Promise.all(all.map(async (item) => {
      for (const ext of order) {
        try {
          const r = await this.fetcher(dataUrl(`media/${item.files[ext]}`));
          if (!r.ok) continue;
          const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
          const [map, key] = 'species' in item.subject ? [this.bySpecies, item.subject.species] : [this.byLieu, item.subject.lieu];
          const list = map.get(key) ?? [];
          list.push({ item, buffer });
          map.set(key, list);
          return;
        } catch { /* format suivant */ }
      }
      console.warn(`[son] enregistrement illisible, synthèse à la place : ${item.id}`);
    }));
    this.status = `enregistrements : ${this.bySpecies.size} espèce(s) sur ${new Set(sounds.map((s) => (s.subject as { species: string }).species)).size}`;
  }

  /** Un enregistrement de l'espèce, au hasard, avec son niveau actif ; null si aucun (repli sur la synthèse). */
  pick(species: string): { buffer: AudioBuffer; levelDbfs: number } | null {
    const list = this.bySpecies.get(species);
    if (!list?.length) return null;
    const { buffer, item } = list[Math.floor(Math.random() * list.length)];
    return { buffer, levelDbfs: item.levelDbfs };
  }

  /** Sons décodés d'un lieu. */
  lieu(id: string): { buffer: AudioBuffer; levelDbfs: number; item: SoundItem }[] {
    return (this.byLieu.get(id) ?? []).map(({ buffer, item }) => ({ buffer, levelDbfs: item.levelDbfs, item }));
  }

  /** Espèces disposant d'au moins un enregistrement décodé. */
  get species(): string[] {
    return [...this.bySpecies.keys()];
  }
}
