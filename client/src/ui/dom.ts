/**
 * Petits outils de construction du DOM pour l'interface : pas de framework, des éléments réels (boutons,
 * liens) et des icônes en traits, sans émoji.
 */
type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

/** Crée un élément : attributs, classes (`class`), écouteurs (`onclick`…), puis enfants (texte ou nœuds). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'hidden') el.hidden = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const PATHS = {
  son: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  muet: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  calques: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  lecture: '<path d="M7 5l12 7-12 7V5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  precedent: '<path d="M15 5l-7 7 7 7"/>',
  suivant: '<path d="M9 5l7 7-7 7"/>',
  fermer: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Icône décorative (le libellé vient du bouton : texte visible ou aria-label). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name];
  return svg;
}
