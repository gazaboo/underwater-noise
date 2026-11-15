# Refonte de l'interface (novembre 2026)

Audit du 15 novembre 2026 : le fond (science, sons, fiches, visite) est riche, mais l'écran par défaut montrait
une planète rouille, floue, sous des commandes qui se chevauchaient. Principe retenu : **l'océan d'abord**. Au
repos, une planète bleue, nette et vivante ; le bruit arrive par-dessus, comme une perturbation ; la rigueur
scientifique reste entière mais passe au second niveau de lecture.

Statuts : [C] calculé par le modèle, [E] choix empirique, [A] choix artistique, [S] sourcé. Aucun des
changements ci-dessous ne modifie un niveau calculé.

## Lot 1 : gains rapides

| Changement | Détail | Statut |
|---|---|---|
| Palette par cible | `targets.<cible>.theme` : jour sur l'écran et la page web, nuit au projecteur. `?theme=` et la touche `J` gardent la main ; le panneau enregistre la palette dans la cible courante | [A] |
| Netteté de la page web | `renderScale` 1,0 au lieu de 0,6 (l'image était rendue à 864×540 pour un écran de 1440×900). `render.minRenderScale` = 0,6 : si la cadence passe sous 48 images/s deux secondes de suite, le rendu descend d'un cran (×0,85), jusqu'au plancher ; il remonte après douze secondes à plus de 57 images/s, une seule fois (`client/src/render/adaptive-scale.ts`) | [E] |
| Bruit en brume | style `brume` par défaut, nouvelles teintes (`docs/REPRESENTATION.md`) | [A] |
| Navires plus discrets | chevrons de 6 px à 60 % d'opacité (7 px, 85 % avant) : en vue globale ils salissaient la mer | [A] |
| Mise en page de la page web | légende à gauche, commandes à droite ; une rangée défilante sur téléphone ; pendant une visite, seule sa commande reste ; cibles tactiles de 44 px | interface |
| Outils de mise au point | panneau `P`, diagnostic `D`, touches `B`, `C`, `O` : toujours avec le serveur local, seulement avec `?dev=1` sur la page web | interface |
| Curseur | il n'est plus masqué après 2 s sur la page web (il le reste pour l'installation) | interface |

## Vérifier

```
npm run build:web
python3 -m http.server 8765 --bind 127.0.0.1 --directory client/dist-web &
CHROMIUM_PATH=/chemin/chrome node scripts/capture-ui.mjs
```

`scripts/capture-ui.mjs` capture six vues (accueil, globe, carte, fiche, visite, océan sans navires) à quatre
tailles (1440×900, 1100×700, 900×700, 390×844) et échoue si deux blocs de l'interface se recouvrent, si un
bloc dépasse de l'écran ou si une cible tactile fait moins de 44 px.

## Lots 2 à 4 : la nouvelle interface

Ton d'atlas illustré [A] : panneaux de papier opaques posés sur la carte, encre bleu nuit, braise pour le bruit
et les actions, sarcelle pour le vivant. Deux polices embarquées, sous licence libre SIL OFL (l'exposition est
hors ligne) : Fraunces pour les titres, Atkinson Hyperlegible pour le texte. Feuille de style :
`client/src/ui/theme.css` ; plus aucun style d'interface dans `index.html`.

| Bloc | Rôle | Fichier |
|---|---|---|
| Accueil | titre, une phrase, « Commencer la visite » ou « Explorer librement » ; le clic démarre le son. Page web autonome seulement, et seulement si l'adresse ne porte aucun paramètre (`?accueil=0` pour s'en passer) | `ui/chrome.ts` |
| Titre et phrase d'état | « Aujourd'hui, avec le trafic maritime » / « Océan sans navires, calculé par le modèle » | `ui/chrome.ts` |
| Commande principale | « Avec navires / Sans navires » : c'est le message de l'œuvre ; à côté, « Visite guidée » | `ui/chrome.ts` |
| Vue | globe ou carte, zoom | `ui/chrome.ts` |
| On entend | le lieu sous le centre de la vue, sinon le dernier appel de cétacé, avec une jauge de clarté sur cinq crans : clarté du lieu, ou portée actuelle / portée en océan calme pour un appel [C] ; les seuils « clair », « voilé », « étouffé » (5, 3 à 4, 0 à 2 crans) sont un choix d'affichage [A] | `ui/chrome.ts`, `audio/engine.ts` |
| Calques | bruit, légende, lieux, palette ; réglages avancés : dessin du bruit, navires suivis ou estimés | `ui/chrome.ts` |
| Légende | trois niveaux : paliers et espèces ; « Comprendre la carte » ; « Méthode et fiabilité » | `ui/legend.ts`, `ui/science.ts` |
| Fiche | volet à droite (volet bas sous 1180 px) ; en tête, deux cercles à l'échelle des portées [C] et deux chiffres | `ui/card.ts` |
| Visite guidée | étape en cours, précédent, pause, suivant ; flèches et espace au clavier ; toucher la carte rend la main | `story/story.ts` |

Aucune information n'a été retirée : les statuts `[S]/[C]/[E]/[A]`, les sources et les mises en garde sont au
deuxième et au troisième niveau, et dans les infobulles des pastilles. Les chemins de fichiers de la
documentation ne figurent plus dans le texte lu par le public (ils restent dans les infobulles).

L'état vit dans la configuration : les touches (`G`, `S`, `V`, `J`, `N`, `M`, `H`), le panneau `P` et les
commandes modifient les mêmes champs ; l'interface relit cet état à chaque image.

Trois gabarits : bureau (1180 px et plus), compact (860 à 1179 px), téléphone (moins de 860 px). Sur le dôme et
au projecteur, aucun cadre : seul le texte de la visite est projeté.

## Lot 5 : le globe éclairé

Sur le globe à l'écran seulement (`display.mode: 'globe'`), jamais sur la demi-sphère, que le projecteur éclaire
déjà. Tout est un choix graphique [A], sans sens astronomique : la lumière ne représente ni l'heure ni la saison.

| Élément | Détail | Réglage |
|---|---|---|
| Lumière | fixe dans l'image, en haut à gauche et un peu devant, comme les ombres peintes des terres (nord-ouest). Terminateur enveloppant : le côté sombre garde 40 % de la luminosité, pour rester lisible | `globe.light.strength` (0,75 ; 0 = rendu d'avant) |
| Teinte | lumière légèrement chaude, ombre légèrement froide | lié à `strength` |
| Reflet | sur la mer seulement (masque : distance à la côte de `land_shape_4096.png`) | `globe.light.specular` (0,5) |
| Atmosphère | liseré bleu à l'intérieur du limbe et halo à l'extérieur, plus forts du côté éclairé | `globe.light.atmosphere` (0,6) |
| Limbe | l'assombrissement d'origine (`globe.limbShading`) est réduit de 70 % × `strength` : la lumière prend le relais | — |

Coût : quelques opérations et une lecture de texture dans la passe plein écran existante
(`client/src/render/globe-view.ts`). Les vignettes (montagnes, arbres) et les silhouettes des cétacés, dessinées
après cette passe, ne sont pas ré-éclairées.

## Survol

À la souris, un cétacé ou un lieu sous le pointeur (rayon de 24 px, le même qu'au clic) fait passer le curseur
en « main » et affiche une étiquette : nom de l'espèce, ou titre du lieu et « à écouter » / « à lire »
(`App.installPicking`). Rien au toucher, où le survol n'existe pas.

## Lot 7 : cétacés peints

Les silhouettes fluo en aplat sont remplacées par des animaux peints, dans le style des vignettes du monde
(issue #3). Détail et statuts dans `docs/REPRESENTATION.md`, « Cétacés : deux niveaux de détail ».

```
blender -b --factory-startup -noaudio --python tools/ornaments/render_whales.py -- <dossier>
python3 tools/ornaments/pack_whales.py <dossier>
```

Les cinq modèles sont construits dans le script (aucun fichier tiers, aucune licence à suivre). Pour remplacer
un animal par une image faite autrement : déposer `whale-<espèce>-r.png` et `-l.png` (1024×512, fond transparent,
tête à droite puis à gauche) dans le dossier, puis relancer `pack_whales.py`.

## Lot 7c : navires et lieux

Reprise des modifications non commitées laissées sur `refonte-ui/7c-navires-lieux`, après `929f12a`.
Les branches précédentes sont empilées : gains rapides → interface → globe éclairé → survol → cétacés peints.

- Navires : traits translucides à l'échelle mondiale, coques de cargo avec sillage en zoomant ; les navires
  estimés restent creux et plus discrets. La silhouette de cargo est une convention graphique, pas une information AIS.
- Taille du rendu adaptée à l'échelle finale sur la carte et dans la texture du globe ; anticrénelage adapté
  à la taille de chaque navire. Les sources acoustiques restent identiques.
- Lieux : épingles ivoire, pointe sur la position ; les lieux à écouter gardent leurs ondes, les lieux à lire
  sont plus petits et sans ondes. Survol et clic gardent le même point géographique et le même rayon de sélection.

Réglages ajoutés après examen sur des scènes réelles (Atlantique, Méditerranée, détroits danois) [A] :

- les sillages sont plus fins, plus longs et près de deux fois plus lumineux : en vue globale ils étaient
  presque invisibles ;
- les coques n'apparaissent plus qu'entre 66 et 110 pixels par degré (`ships.boatsFromPxPerDeg`), au lieu de
  7,7 à 14 : à zoom moyen, les coques de milliers de navires estimés formaient un amas blanc ;
- un navire estimé de près est une coque pâle et translucide, sans liseré.

Détails des choix artistiques dans `docs/REPRESENTATION.md`. Les quatre caps ont été contrôlés sur une
planche synthétique : correction du signe nord/sud dans les coordonnées du point, sur l'écran et dans la texture monde.

Planches dans `docs/captures/refonte-ui-7c/` : rangée supérieure pour les navires suivis, inférieure pour les
estimés ; caps N/E/S/O puis navire arrêté, taille multipliée par trois. Ce sont des échantillons graphiques,
pas une capture AIS. Reproduire avec `scripts/capture-ships.mjs` (mêmes variables que `capture-ui.mjs`).

Vérifications de reprise (15 novembre) :

- `npm run typecheck`, `npm run build:web` : réussis (avertissement Vite existant sur `geo-grids.ts`).
- `npm test` : 184/184, hors sandbox pour permettre au serveur WebSocket factice d'ouvrir son port.
- `scripts/capture-ui.mjs` : six états × quatre tailles, aucun recouvrement, débordement ni cible tactile trop petite.
- `scripts/verify-illustrated.mjs` : carte, globe, demi-sphère de nuit, équirectangulaire et fisheye ; aucune
  erreur JavaScript/GLSL sur Radeon 780M (ANGLE/Vulkan).
- `scripts/verify-lieux.mjs` : 27 fiches au clic, écoute des cinq lieux sonores, clarté à 1 sans navires.
- Planche des navires : quatre caps, suivis / estimés, arrêt, jour / nuit ; aucune erreur JavaScript/GLSL.

## Suite prévue

Contrôle au dôme (palette de nuit, brume, cétacés clairs sur mer sombre) avec le projecteur réel.
Ce contrôle matériel reste à faire sur place.
