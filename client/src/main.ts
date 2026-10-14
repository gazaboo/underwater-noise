/**
 * Point d'entrée. Paramètres d'URL :
 *   ?display=screen|projector   cible d'affichage
 *   ?quality=expo|light         profil de qualité
 *   ?hud=1                      affiche le diagnostic au démarrage
 */
import { App, type UrlOverrides } from './app.ts';

const params = new URLSearchParams(location.search);
const overrides: UrlOverrides = {
  target: (['screen', 'projector'] as const).find((t) => t === params.get('display')),
  quality: (['expo', 'light'] as const).find((q) => q === params.get('quality')),
  hud: params.has('hud'),
};

const status = document.getElementById('status')!;
const canvas = document.createElement('canvas');
document.body.prepend(canvas);

App.create(canvas, overrides)
  .then(() => {
    status.style.transition = 'opacity 2s';
    status.style.opacity = '0';
  })
  .catch((e: Error) => {
    console.error(e);
    status.textContent = `erreur : ${e.message}`;
    status.style.color = '#a06060';
  });
