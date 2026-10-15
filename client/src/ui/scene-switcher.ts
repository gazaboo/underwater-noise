/** Comparateur visuel ; aucun changement de navigation ni de simulation. */
import { DIORAMA_VIEWS, type DioramaView } from '../render/diorama-terrain.ts';
import type { DioramaStatus } from '../render/diorama-globe.ts';
import type { Config } from '@vacarme/shared';
import { SCENE_STYLES, supportsSceneStyle, supportsStyle } from '../render/scene-style.ts';

export class SceneSwitcher {
  private readonly root = document.createElement('section');
  private readonly toggle = document.createElement('button');
  private readonly message = document.createElement('p');
  private readonly buttons: HTMLButtonElement[] = [];
  private lastState = '';
  private readonly pilot = document.createElement('div');
  private readonly loadMessage = document.createElement('p');
  private readonly retry = document.createElement('button');
  private loadState = '';

  constructor(private readonly getConfig: () => Config, onChange: () => void, onView: (view: DioramaView) => void, onRetry: () => void) {
    this.root.className = 'scene-switcher';
    this.root.setAttribute('aria-label', 'Directions artistiques');
    const header = document.createElement('div'); header.className = 'scene-switcher-header';
    const title = document.createElement('div');
    title.innerHTML = '<span class="scene-eyebrow">LA CARTE DU VACARME</span><h1>Un monde à écouter.</h1>';
    header.append(title);
    const hide = document.createElement('button'); hide.type = 'button'; hide.textContent = 'Masquer';
    hide.className = 'scene-hide'; hide.setAttribute('aria-label', 'Masquer le comparateur');
    hide.onclick = () => this.setHidden(true); header.append(hide); this.root.append(header);
    const choices = document.createElement('div'); choices.className = 'scene-choices';
    for (const style of SCENE_STYLES) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `scene-choice scene-choice-${style.id}`;
      const sample = document.createElement('span'); sample.className = 'scene-sample'; sample.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.innerHTML = `<small>${style.subtitle}</small><strong>${style.title}</strong>`;
      button.append(sample, label); button.setAttribute('aria-pressed', 'false');
      button.onclick = () => { this.getConfig().scene.style = style.id; onChange(); this.update(); };
      this.buttons.push(button); choices.append(button);
    }
    this.root.append(choices);
    this.pilot.className = 'diorama-views';
    for (const [id, view] of Object.entries(DIORAMA_VIEWS)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = view.label;
      button.onclick = () => onView(id as DioramaView); this.pilot.append(button);
    }
    this.loadMessage.className = 'scene-note';
    this.retry.type = 'button'; this.retry.textContent = 'Réessayer'; this.retry.onclick = onRetry; this.retry.hidden = true;
    this.root.append(this.pilot, this.loadMessage, this.retry);
    this.message.className = 'scene-note'; this.root.append(this.message);
    this.toggle.type = 'button'; this.toggle.className = 'scene-reopen'; this.toggle.textContent = '◈ Directions artistiques';
    this.toggle.hidden = true; this.toggle.onclick = () => this.setHidden(false);
    document.body.append(this.root, this.toggle); this.update();
  }
  private setHidden(hidden: boolean): void {
    this.root.hidden = hidden; this.toggle.hidden = !hidden;
    const selected = this.buttons.find(b => b.getAttribute('aria-pressed') === 'true' && !b.disabled);
    (hidden ? this.toggle : selected ?? this.root.querySelector<HTMLButtonElement>('.scene-hide'))?.focus();
  }
  setDioramaStatus(status: DioramaStatus): void {
    if (this.loadState === status) return; this.loadState = status;
    this.loadMessage.textContent = status === 'loading' ? 'Préparation de la miniature…' : status === 'error'
      ? 'La miniature n’a pas pu être chargée. La scène précédente est conservée.'
      : 'Pilote régional · Relief et végétation artistiques · Glissez pour découvrir les volumes.';
    const cfg = this.getConfig();
    this.retry.hidden = status !== 'error' || cfg.scene.style !== 'diorama' || cfg.display.mode !== 'globe';
  }
  update(): void {
    const cfg = this.getConfig(), supported = supportsSceneStyle(cfg.display.mode);
    const state = `${cfg.scene.style}:${cfg.display.mode}:${cfg.display.theme}`;
    if (state === this.lastState) return;
    this.lastState = state;
    this.root.dataset.style = cfg.scene.style;
    this.root.dataset.theme = cfg.display.theme;
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].disabled = !supportsStyle(SCENE_STYLES[i].id, cfg.display.mode);
      this.buttons[i].setAttribute('aria-pressed', String(SCENE_STYLES[i].id === cfg.scene.style));
    }
    this.retry.hidden = this.loadState !== 'error' || cfg.scene.style !== 'diorama' || cfg.display.mode !== 'globe';
    this.pilot.hidden = cfg.scene.style !== 'diorama' || cfg.display.mode !== 'globe';
    this.loadMessage.hidden = cfg.scene.style !== 'diorama' || cfg.display.mode !== 'globe';
    this.message.textContent = cfg.scene.style === 'diorama' && cfg.display.mode !== 'globe'
      ? 'Le pilote se visite en mode globe (touche G). Le rendu actuel est conservé ici.' : supported
      ? `${cfg.display.mode === 'globe' ? 'Glisser pour tourner' : 'Glisser pour explorer'} · Molette : zoom · J : jour / nuit · P : réglages`
      : 'Rendu actuel pour cette projection. Revenez au globe ou à la carte pour comparer.';
  }
}
