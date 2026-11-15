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

## Suite prévue

Fondations de l'interface (jetons, polices, commande principale « avec / sans navires », menu des calques),
accueil et lecteur de visite, pastille « ce qu'on entend », légende à trois niveaux et fiche en volet, globe
éclairé, cétacés et navires peints, contrôle au dôme.
