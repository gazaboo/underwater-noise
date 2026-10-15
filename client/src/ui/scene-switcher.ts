/** Comparateur visuel ; aucun changement de navigation ni de simulation. */
import type { Config } from '@vacarme/shared';
import { SCENE_STYLES, supportsSceneStyle } from '../render/scene-style.ts';

export class SceneSwitcher {
  private readonly root = document.createElement('section');
  private readonly toggle = document.createElement('button');
  private readonly message = document.createElement('p');
  private readonly buttons: HTMLButtonElement[] = [];
  private lastState = '';

  constructor(private readonly getConfig: () => Config, onChange: () => void) {
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
  update(): void {
    const cfg = this.getConfig(), supported = supportsSceneStyle(cfg.display.mode);
    const state = `${cfg.scene.style}:${cfg.display.mode}:${cfg.display.theme}`;
    if (state === this.lastState) return;
    this.lastState = state;
    this.root.dataset.style = cfg.scene.style;
    this.root.dataset.theme = cfg.display.theme;
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].disabled = !supported;
      this.buttons[i].setAttribute('aria-pressed', String(SCENE_STYLES[i].id === cfg.scene.style));
    }
    this.message.textContent = supported
      ? `${cfg.display.mode === 'globe' ? 'Glisser pour tourner' : 'Glisser pour explorer'} · Molette : zoom · J : jour / nuit · P : réglages`
      : 'Rendu actuel pour cette projection. Revenez au globe ou à la carte pour comparer.';
  }
}
