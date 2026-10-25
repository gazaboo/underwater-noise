/**
 * Adresse d'une donnée de data/ : servie par le serveur local (/data/…) en développement et en
 * exposition, copiée à côté de la page dans le build web autonome (base relative).
 */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path.replace(/^\/+/, '')}`;
}

/** Page web autonome : aucun serveur Node (navires calculés dans le navigateur). */
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1' || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('standalone'));
