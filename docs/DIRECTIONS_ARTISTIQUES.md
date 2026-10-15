# Un monde à écouter — trois directions artistiques

Les six références fournies dans `visual_assets_references` ont guidé les matières, les volumes et la lumière. Elles ne sont pas intégrées à l'application. La branche `directions-artistiques` prolonge `terres-gouache`, sans fusion dans `main`.

## Choisir dans l'application

Le comparateur permet de passer entre les trois propositions et le témoin **Actuel** sans changer de cadrage, de zoom ou d'état de simulation. Il peut être masqué. Le panneau technique `P` est conservé ; son dossier **Direction artistique** règle le style et le relief, et son bouton d'enregistrement sauvegarde le choix.

| Proposition | Intention | Globe jour | Globe nuit | Carte jour | Carte nuit |
|---|---|---|---|---|---|
| **Planète peinte** | Pigments, lumière chaude, bouquets d'arbres illustrés et texture de papier. Globe sphérique, relief apparent. | [Voir](captures/directions-artistiques/globe-day-painted.png) | [Voir](captures/directions-artistiques/globe-night-painted.png) | [Voir](captures/directions-artistiques/flat-day-painted.png) | [Voir](captures/directions-artistiques/flat-night-painted.png) |
| **Monde sculpté** | Argile, terres surélevées, montagnes continues, forêts en volume et ombres. | [Voir](captures/directions-artistiques/globe-day-sculpted.png) | [Voir](captures/directions-artistiques/globe-night-sculpted.png) | [Voir](captures/directions-artistiques/flat-day-sculpted.png) | [Voir](captures/directions-artistiques/flat-night-sculpted.png) |
| **Atlas facetté** | Géométrie simplifiée, surfaces minérales, végétation anguleuse et lumière rasante. | [Voir](captures/directions-artistiques/globe-day-faceted.png) | [Voir](captures/directions-artistiques/globe-night-faceted.png) | [Voir](captures/directions-artistiques/flat-day-faceted.png) | [Voir](captures/directions-artistiques/flat-night-faceted.png) |

[Détail du volume dans les Andes](captures/directions-artistiques/andes-volume.png) · [Réglages](captures/directions-artistiques/reglages.png)

La carte reste en 2,5D. Demi-sphère, fisheye et équirectangulaire conservent le rendu d'origine ; le comparateur y explique cette limite et retrouve le style choisi au retour. La mire de calibration reste analytique.

## Construction

- Configuration : `scene: { style: 'current' | 'painted' | 'sculpted' | 'faceted', relief: 0..1 }`. Valeurs par défaut : `current`, `0.7`. Le paramètre URL `style` initialise le choix sans bloquer les commandes ensuite.
- Les palettes jour/nuit des propositions sont des surcharges de rendu ; elles ne réécrivent pas les palettes éditables du témoin. Les réglages de matière et les bascules d'ornements restent accessibles dans `P`.
- Le relief est calculé d'après ETOPO, avec une base continentale et une exagération artistique non linéaire. Aucune modification des grilles ni des calculs acoustiques. La texture monde des ondes/navires/cétacés est conservée et projetée sur la surface ; les données océaniques ne reçoivent pas les ombres terrestres.
- Géométries mises en cache par style et profil, instances pour arbres, cratères, volcans et fumée. Les normales de la couture sont raccordées. Le diagnostic sous le curseur utilise une intersection avec la géométrie réellement affichée.
- `expo` : surface sculptée 512×256, atlas 192×96, ombres 2048² et anticrénelage MSAA 4×. `light` : 256×128, atlas 128×64, ombres 1024², moins d'arbres et sans MSAA. La simulation physique conserve ses réglages propres aux profils existants.

## Vérification

- Typage TypeScript, compilation Vite et **83 tests** : validation du rendu actuel, des modes pris en charge, de l'absence de modification des paramètres physiques, du relief géométrique, de l'orientation des faces, de la couture, des pôles et de l'interpolation des données.
- Contrôle WebGL dans Brave/Chromium, via **SwiftShader**, fenêtre 1280×900 : comparaison des trois styles sur carte et globe, jour et nuit ; absence d'erreur JavaScript/GLSL.
- Contrôle des mêmes cadrages et du temps lors des changements ; silhouette 3D réellement déformée ; lecture géographique dans les Andes, en Amazonie, en Islande, en Indonésie, à l'antiméridien et près des deux pôles.
- Contrôle des projections conservées, du masquage du comparateur, de `J`/`P`, de la conservation du choix au changement de cible, de l'enregistrement et de sa relecture.
- Contrôle de la stabilité du nombre de géométries après changements répétés (**21, constant**) ; surface sculptée : **131 841 sommets** en `expo`, **33 153** en `light`.
- Non-régression du chantier gouache : toutes les bascules et sauvegardes restent valides ; l’ancien aplat jour/nuit reste identique **octet par octet** lorsque les extras sont coupés.

Le script optionnel `scripts/verify-scenes.mjs` nécessite un serveur de développement actif et Playwright Core disponible séparément :

```bash
PLAYWRIGHT_MODULE=/chemin/vers/playwright-core/index.mjs \
CHROMIUM_PATH=/chemin/vers/chromium \
node scripts/verify-scenes.mjs
```

Il régénère les captures et effectue un essai réversible de sauvegarde ; éviter de modifier simultanément la configuration locale. `VACARME_URL` permet de changer l'URL locale. `scripts/verify-land.mjs` conserve les vérifications du chantier précédent ; `CAPTURE_DIR` peut rediriger ses captures vers un dossier temporaire.

Les captures SwiftShader ne valident pas les 60 images/s sur la Radeon 780M. Sur le matériel d'exposition, comparer le diagnostic `D` des quatre styles en 1920×1200, profils `expo` et `light`. Les nouveaux volumes sont réservés au mode globe ; les sorties de projection gardent le rendu existant.
