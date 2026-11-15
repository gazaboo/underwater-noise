/**
 * Point d'entrée. Paramètres d'URL :
 *   ?display=screen|projector   cible d'affichage
 *   ?quality=expo|light         profil de qualité
 *   ?hud=1                      affiche le diagnostic au démarrage
 *   ?scene=duo                  scène de test : deux groupes de rorquals communs en mer Ligure
 *   ?mode=flat|globe|hemisphere|equirect|fisheye   mode de rendu
 *   ?theme=night|day            palette de nuit (installation) ou de jour
 *   ?parcours=<id>              démarre un parcours (data/parcours) : avant-apres, puissances-de-dix, tour-des-lieux
 *   ?dev=1                      page web autonome : rend le panneau P, le diagnostic D et les touches B, C, O
 *   ?accueil=0                  page web autonome : pas d'écran d'accueil (il est aussi omis dès qu'un autre paramètre est donné)
 */
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-400-italic.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource-variable/fraunces/wght.css';
import './ui/theme.css';
import { App, type UrlOverrides } from './app.ts';

const params = new URLSearchParams(location.search);
const overrides: UrlOverrides = {
  target: (['screen', 'projector'] as const).find((t) => t === params.get('display')),
  quality: (['expo', 'light'] as const).find((q) => q === params.get('quality')),
  hud: params.has('hud'),
  scene: params.get('scene') ?? undefined,
  mode: (['flat', 'globe', 'hemisphere', 'equirect', 'fisheye'] as const).find((m) => m === params.get('mode')),
  theme: (['night', 'day'] as const).find((t) => t === params.get('theme')),
  parcours: params.get('parcours') ?? undefined,
  dev: params.has('dev'),
  welcome: [...params.keys()].length === 0,
};

const status = document.getElementById('status')!;
const canvas = document.createElement('canvas');
document.body.prepend(canvas);

App.create(canvas, overrides)
  .then((app) => {
    // Accès depuis la console du navigateur, pour le diagnostic.
    (window as unknown as { vacarme: App }).vacarme = app;
    status.style.transition = 'opacity 2s';
    status.style.opacity = '0';
  })
  .catch((e: Error) => {
    console.error(e);
    status.textContent = `erreur : ${e.message}`;
    status.style.color = '#a06060';
  });
