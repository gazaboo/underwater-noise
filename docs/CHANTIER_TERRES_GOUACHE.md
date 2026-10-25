# Chantier : terres « gouache » façon Petit Prince

> **Suite** : ce chantier est repris et prolongé par le monde illustré, branche `monde-peint` —
> voir [`MONDE_ILLUSTRE.md`](MONDE_ILLUSTRE.md). Le style `gouache` reste disponible pour comparaison.

Document de reprise (pour un humain ou un autre agent, ex. Codex). Branche : **`terres-gouache`**
(partie de `main` au commit 2390e66). Ne pas fusionner dans `main` sans l'accord de l'auteur.

## Objectif

Remplacer les continents en aplat (`palette.land`, noir la nuit) par des terres peintes, inspirées des
illustrations du *Petit Prince* (référence visuelle : littleprince.dev), sans voler la vedette aux ondes.

Décisions prises avec l'auteur :

| Sujet | Décision |
|---|---|
| Style | gouache / aquarelle en 2D, dans le shader de composition (léger pour la Radeon 780M) |
| Nuit (installation) | terres **discrètes mais belles** : sombres, chaudes ; ondes et lueur restent le sujet |
| Couleurs des milieux | **Natural Earth II** (NE2_HR_LC, domaine public), stylisées dans le shader |
| Extras | ciel étoilé autour du globe ; petits arbres et volcans au zoom ; grain de papier global |
| Bascule | **chaque extra doit pouvoir être activé/désactivé** (config + panneau `P`) ; `land.style: 'flat'` rend l'ancien rendu |
| Traçabilité | chaque nombre est étiqueté : sourcé / ordre de grandeur / empirique / **artistique** |

## État au 15 octobre 2026

La reprise de Claude est implémentée dans le worktree dédié. Aucune fusion dans `main`.

- Texture Natural Earth II raccordée au client, octets et alpha conservés sans conversion colorimétrique.
- Terres gouache : saturation, paliers doux, déformation du pinceau, relief ETOPO chaud/froid, granulation et bord mouillé.
- Arbres procéduraux sur trois grilles géographiques (1°, 0,25°, 0,0625°), placements et rayons variés, fondu selon zoom et taille à l'écran. L'indice de forêt reste artistique.
- Volcans GVP : cônes peints, cratère, fumée animée selon dernière éruption et seuil artistique. Une année inconnue ne produit jamais de fumée. Carte plate zoomée seulement, avant les navires.
- Papier partagé entre les deux finitions, appliqué une seule fois. Étoiles et halo uniquement hors du disque en mode globe ; masques des autres projections conservés.
- Panneau `P` complet, palettes jour/nuit, sauvegarde de `land` et conservation des réglages lors du changement de cible.
- Sources et interprétations artistiques documentées dans `SOURCES_DONNEES.md`, `REVUE_SCIENTIFIQUE.md` et le README.

### Compatibilité

`land.style: 'flat'` restitue les terres en aplat et retire les ornements. Pour retrouver toute l'image d'origine, désactiver également `land.paper.enabled` et `land.stars.enabled` : ces effets disposent de commandes indépendantes.

`WorldAssets` expose désormais `landcover`, `loadVolcanoes()` charge les tuples `[lon, lat, altitude, dernière éruption | null]`. `FlatTransform.zoom` vaut le zoom de navigation ou zéro pour la texture monde, afin d'exclure ses ornements.

## Vérification

- `npm run typecheck` : réussi.
- `npm test` : **74/74** ; trois tests supplémentaires couvrent le cadrage, le zoom et l'exclusion des ornements de la texture monde.
- `npm run build` : réussi ; avertissement existant sur les imports statique/dynamique de `geo-grids.ts`.
- Chromium (Brave, WebGL2 via SwiftShader) : rendu des shaders sans erreur JavaScript/GLSL ; voir le [compte rendu et les captures](VERIFICATION_TERRES_GOUACHE.md).
- Comparaison du shader aplat avec celui du commit initial `cc72bb3`, temps et entrées identiques : **zéro octet différent**, palettes nuit et jour, extras désactivés.

## Validation matérielle restante

La session de vérification utilise SwiftShader, pas la Radeon 780M. Les **60 images/s en 1920×1200 ne sont pas validées**. Sur le portable, comparer le diagnostic `D` avant/après (aplat sans extras / gouache avec extras), profils `expo` et `light`. Si nécessaire, réduire les octaves du bruit propre aux terres avant de modifier les valeurs par défaut. Le rendu du projecteur Epson EB-990U et la calibration de la demi-sphère restent à apprécier sur place.

## Repères

Les modes globe composent d'abord la carte dans la texture monde équirectangulaire (`uFinish = false`), puis la reprojettent. Les ornements sont exclus de cette texture. Les constantes de formes, de bruit, de lumière, de densité et de fondu sont artistiques ; l'altitude ETOPO et les positions GVP sont sourcées.
