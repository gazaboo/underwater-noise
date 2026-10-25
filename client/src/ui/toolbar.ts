/**
 * Barre d'outils tactile du mode web autonome (pas de clavier ni de panneau P sur un téléphone) :
 * mêmes actions que les touches G, V, S, J, N, M, H et l'affichage de la légende.
 */
export interface ToolbarActions {
  view(): string;
  noise(): string;
  scenario(): string;
  theme(): string;
  ships(): string;
  sound(): string;
  legend(): string;
  story(): string;
}

export class Toolbar {
  private readonly element = document.createElement('nav');

  constructor(actions: ToolbarActions, labels: ToolbarActions) {
    this.element.id = 'toolbar';
    this.element.setAttribute('aria-label', 'Réglages de la carte');
    for (const key of Object.keys(actions) as (keyof ToolbarActions)[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = labels[key]();
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.textContent = actions[key]();
      });
      for (const ev of ['pointerdown', 'wheel', 'dblclick'] as const) b.addEventListener(ev, (e) => e.stopPropagation());
      this.element.append(b);
    }
    document.body.append(this.element);
  }
}
