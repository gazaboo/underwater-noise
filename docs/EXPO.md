# Guide d'exposition

Matériel prévu : le portable (Ryzen 7 7840U, Radeon 780M, Fedora), un projecteur Epson EB-990U
(3LCD à lampe, WUXGA 1920×1200, 3 800 lm), une demi-sphère bombée vers le public, des enceintes.

## 1. Avant le jour J

- **Enregistrer le direct** plusieurs jours avant : laisser tourner `npm run dev` (ou `npm start`)
  avec la clé aisstream dans `.env`. On accumule ainsi :
  - `data/recordings/` : de quoi rejouer le trafic mondial si le réseau manque ;
  - `data/coverage.png` : la carte de couverture (terra incognita) bâtie au fil des jours.
- **Préparer le replay de secours** : dans `config/expo.json5`, pointer le replay sur vos
  enregistrements, par exemple `replay: { path: 'data/recordings', speed: 1 }` (temps réel) — le
  mode `auto` bascule tout seul si le direct se tait plus d'une minute.
- `npm run build` une fois (le script d'exposition le fait s'il manque).

## 2. Réglages du projecteur (menu Epson)

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Mode couleur | Cinéma ou Dynamique selon l'essai | priorité au contraste |
| Contraste dynamique / iris auto | **désactivé** | sinon l'image « pompe » quand la lueur évolue |
| Mode de consommation | **Éco** | noir plus profond, ventilateur plus discret, lampe plus durable ; 3 800 lm suffisent largement dans le noir |
| Correction trapézoïdale (keystone) | **désactivée (0)** | elle dégrade l'image ; l'alignement se fait dans le logiciel |
| Résolution d'entrée | 1920×1200 | native |

Écran du portable : **affichage étendu** (le projecteur comme second écran, en 1920×1200), ou
**miroir** si le portable est fermé/rangé. Profil d'alimentation « performance », **sur secteur**.

## 3. Installation physique

- **Projecteur dans l'axe** de la demi-sphère, à distance d. Le disque doit occuper la hauteur de
  l'image (1 200 px) ; les bandes latérales du 16:10 restent noires.
- Ordre de grandeur : pour une sphère de diamètre D, largeur d'image ≈ 1,6 × D ; distance =
  rapport de projection (1,39 à 2,23) × largeur. Pour D = 1 m : 2,2 à 3,6 m, soit d/R ≈ 4,4 à 7.
- **Molleton noir** derrière et autour de la sphère : le noir d'un LCD à lampe n'est pas noir, tout le
  rectangle projeté éclaire un peu le mur.
- L'objectif de l'EB-990U a un **décalage vertical fixe** (l'image est au-dessus de l'axe optique) :
  on placera le projecteur plus bas que le centre de la sphère, ou on compensera avec `hemisphere.shiftY`.

## 4. Calibration sur place

1. Lancer `npm run expo`, puis (clavier branché) `C` : **mire** — méridiens et parallèles tous les 15°,
   équateur et méridien origine marqués, cercles concentriques et croix d'axe dans l'image.
2. `P` ouvre le panneau ; section « Demi-sphère » (ou éditer `config/local.json5`, rechargé à chaud) :
   - `distanceRatio` : mesurer d (projecteur → centre de la sphère) et R ; saisir d / R ;
   - `throwRatio` : rapport de projection au zoom utilisé (distance / largeur de l'image projetée,
     mesurée sur un mur à la même distance) ;
   - `scale` jusqu'à ce que le bord du disque coïncide avec le bord de la sphère ;
   - `shiftX`, `shiftY` pour centrer ; `rollDeg` pour redresser l'axe des pôles ;
   - critère : méridiens droits et réguliers, parallèles concentriques, **aucune lumière sur le mur** ;
   - `edgeCompensation` (0,6) et `maxGain` (2,5) : luminosité homogène du centre au bord.
3. « Enregistrer » dans le panneau (écrit `config/local.json5`), `C` pour retirer la mire.

## 5. Lancement

```bash
npm run expo
```

Le script lance le serveur (configuration `config/expo.json5` : demi-sphère, cible projecteur) puis
Chromium en kiosque : plein écran, aucune interface, curseur masqué, son autorisé sans clic.

Démarrage automatique et relance en cas d'arrêt : service utilisateur systemd,
voir l'en-tête de `scripts/vacarme.service`.

Démarrage à froid **sans réseau** : le direct échoue, le mode `auto` passe au replay (ou à la
simulation s'il n'y a pas de fichier). Toutes les données nécessaires sont locales (`data/`).

## 6. Rotation et récit

- Un tour en 12 minutes (`globe.periodMinutes`), axe incliné de 25° vers le public (`viewLatDeg`).
- Ralentissements quand la Manche et le détroit de Malacca passent face au public (`globe.dwell`) —
  choix artistique, modifiable.
- La lueur d'accumulation monte en ~2 minutes après le démarrage : prévoir d'allumer avant l'ouverture
  au public, ou en faire une ouverture (l'océan se sature sous les yeux).
- Son : on entend la face visible ; la face cachée se fond dans la nappe.

## 7. Touches (clavier de régie)

| Touche | Action |
|---|---|
| `D` | diagnostic (images/s, GPU, source, calibration, cétacés, son) |
| `P` | panneau de réglage |
| `C` | mire de calibration |
| `O` | mode de sortie : carte, globe, demi-sphère, équirect, fisheye |
| `G` | carte plate ↔ globe |
| `M` | couper le son |
| `B` | champ physique en dB (diagnostic) |
| `V` | représentation du bruit : isophones → météo → encre → fronts bruts → nappe masquée |
| `S` | scénario : trafic actuel ↔ océan sans navires (calculé) |
| `H` | parcours guidé suivant (avant / après, puissances de dix, tour des lieux) ; `H` ou tout geste rend la main |
| clic sur un cétacé | fiche de l'espèce : photo, portée du groupe, faits sourcés, vrais enregistrements (`Échap` ferme) |
| clic sur un lieu (anneau ivoire) | fiche du lieu : texte, paire de contraste, vrais enregistrements ; on entend le lieu le plus proche du centre de la vue |

## 8. Performances mesurées (780M, Chromium + Vulkan)

25 oct. 2026, après la refonte de la représentation, 1920×1200, 50 854 navires estimés (cas le plus chargé),
cadence normale : **60 images/s en médiane** en demi-sphère, globe et carte, pour les quatre représentations
du bruit ; 1 à 2 % d'images entre 35 et 58 ms (relecture du champ à chaque pas du modèle). Détail par mode et
méthode : `docs/REPRESENTATION.md`. À vérifier sur place avec le projecteur : `node scripts/verify-representation.mjs`.

Le style « encre » est le plus coûteux (traînées) ; en cas de saccades, préférer « isophones » ou « météo ».

Si la machine chauffe : `?quality=light` (ou `display.quality: 'light'`).

## 9. Dépannage

| Symptôme | Piste |
|---|---|
| Image saccadée | portable sur batterie ; profil d'alimentation ; `chrome://gpu` (accélération matérielle ?) ; profil `light` |
| Pas de son | sortie audio du système ; en dehors du kiosque, cliquer une fois dans la page ; `M` |
| « pas de clé » dans le diagnostic | `.env` absent ou mal lu ; le replay prend le relais |
| Lumière sur le mur | `scale` trop grand, `edgeSoftness` trop faible, molleton |
| Bord du disque trop sombre | `edgeCompensation`, `maxGain` |
