# La carte du vacarme

Installation projetée qui rend visible et audible, en temps réel et à l'échelle du monde, le bruit
sous-marin des navires — et ce qu'il fait à l'espace de communication des cétacés.

Chaque navire émet des fronts d'onde qui se propagent sur l'océan, interfèrent, s'arrêtent sur les
côtes ; là où le trafic est dense, l'océan s'illumine ; ailleurs, il reste noir.

> État : **jalon J6** — navires en direct (aisstream.io), en replay ou simulés ; ondes visibles ;
> champ de bruit calibré en dB (trois bandes) ; lueur d'accumulation ; terra incognita ; exploration (zoom) ;
> cétacés : espace de communication rongé par le bruit, liens entre groupes ; son ; globe et demi-sphère
> (un projecteur) ; mode exposition. Revue scientifique : [`docs/REVUE_SCIENTIFIQUE.md`](docs/REVUE_SCIENTIFIQUE.md).
> Plan complet et jalons : voir la section « Feuille de route » plus bas.

## Installation

Prérequis : Node ≥ 20, [uv](https://docs.astral.sh/uv/) (pour les scripts de données, Python ≥ 3.10),
Chromium ou Chrome.

```bash
npm install
npm run data        # télécharge ETOPO 2022 + Natural Earth et construit data/ (≈ 4 min, une seule fois)
# Habitats des cétacés (déjà fournis dans data/habitats) : base AquaMaps (1,2 Go) + OBIS
#   voir l'en-tête de tools/build_habitats.py
cp .env.example .env  # puis y mettre la clé gratuite d'aisstream.io (AISSTREAM_API_KEY=…)
```

Les fichiers de `data/` sont versionnés : `npm run data` n'est nécessaire que pour les régénérer.

## Lancement

```bash
npm run dev         # serveur local (port 8787) + client Vite (http://localhost:5173)
```

Exposition (demi-sphère, projecteur, kiosque) : `npm run expo` — voir [`docs/EXPO.md`](docs/EXPO.md).

Production (un seul processus, le serveur sert le client compilé) :

```bash
npm run build && npm start   # http://localhost:8787
```

### Paramètres d'URL

| Paramètre | Valeurs | Effet |
|---|---|---|
| `display` | `screen` (défaut), `projector` | cible d'affichage : écran du portable ou Epson EB-990U |
| `quality` | `expo` (défaut), `light` | profil de qualité (taille de la simulation, pas par image) |
| `hud` | (présent) | affiche le diagnostic au démarrage |
| `scene` | `duo` | scène de test des liens (deux groupes en mer Ligure) |
| `mode` | `flat`, `globe`, `hemisphere`, `equirect`, `fisheye` | mode de rendu |

### Clavier

| Touche | Action |
|---|---|
| `P` | panneau de réglage (caché) |
| `D` | diagnostic : images/s, temps CPU et GPU, navires, source, calibration, niveau de bruit sous le curseur |
| `B` | champ physique en dB (isolignes tous les 10 dB) : accumulé → basse → moyenne → haute → rendu |
| `M` | couper / rétablir le son |
| `G` | carte plate ↔ globe (globe : glisser = tourner, molette = zoom) |
| `O` | mode de sortie : carte, globe, demi-sphère, équirect, fisheye |
| `C` | mire de calibration (méridiens, parallèles, cercles, croix d'axe) |
| `F` | plein écran |
| molette / pincement | zoom centré sur le curseur (jusqu'à ×40) |
| glisser | déplacer la carte |
| flèches, `+` / `-` | déplacer, zoomer au clavier |
| double-clic, `R`, `0` | revenir au cadrage initial |

Au-delà d'un zoom ×2,5 (`view.detail.minZoom`), une **grille d'ondes de détail** couvre la zone
visible (≈ 6 km par cellule au zoom ×7, contre ≈ 20 km pour la grille mondiale) : les fronts d'onde
restent fins quand on explore une mer ou un détroit. Elle est recalculée quand on sort de son emprise.

Le curseur disparaît après deux secondes d'immobilité.

## Sources de navires

| Mode (`source.mode`) | Comportement |
|---|---|
| `auto` (défaut) | direct si la clé est présente et le flux en bonne santé ; sinon replay ; sinon simulation |
| `live` | aisstream.io uniquement |
| `replay` | fichiers de `replay.path` (en boucle, vitesse `replay.speed`) |
| `simulation` | navires synthétiques sur les grandes routes (`simulation.*`) |

- **Direct** : la clé est lue dans `.env` (`AISSTREAM_API_KEY`), jamais dans le code ni dans le
  navigateur (aisstream refuse les connexions directes depuis un navigateur : c'est le serveur local
  qui se connecte, avec compression). Au démarrage, le mode auto reste sur le replay tant que le
  direct ne suit pas `source.liveMinShips` navires, puis bascule. S'il se tait plus de
  `source.liveSilenceSec` secondes, retour au replay ; il reprend la main après
  `source.liveRecoverSec` secondes de bonne santé.
- **Couverture** : aisstream repose sur des stations côtières (portée ~60 milles) ; la haute mer est
  peu vue. Les navires perdus de vue poursuivent leur route à l'estime (`live.maxExtrapolateMin`),
  puis sont oubliés (`live.evictAfterMin`). La carte de couverture (`data/coverage.png`, construite au
  fil des jours) assombrit les zones jamais observées (`palette.unknownDim`).
- **Enregistrement** : le flux direct est enregistré dans `data/recordings/AAAA-MM-JJ/HH.ndjson.gz`
  (heure UTC, une position par navire toutes les 30 s). Pour l'exposition, rejouez vos propres
  enregistrements : `replay: { path: 'data/recordings' }`.
- **Mode hybride** (`source.hybrid`, désactivé) : ajoute des navires simulés dans les zones mal couvertes.

Fichier de replay fourni : `data/replays/dma-2025-02-26.ndjson.gz` — une heure de trafic dans les
eaux danoises (Autorité maritime danoise, données ouvertes). Pour en produire d'autres :

```bash
uv run tools/convert_ais.py --dma 2025-02-26 --hours 2 --out data/replays/dma-2025-02-26.ndjson.gz
uv run tools/convert_ais.py --noaa AIS_2024_01_01.csv --hours 2 --out data/replays/noaa.ndjson.gz
```

Tester le direct sans clé ni réseau : `node scripts/mock-aisstream.mjs` lance un faux aisstream
local qui rediffuse un fichier de replay ; mettre `AISSTREAM_API_KEY=test` dans `.env` et
`live: { url: 'ws://localhost:9999' }` dans `config/local.json5`.

Le diagnostic (`D`) affiche la source active, l'état du direct (messages/s, navires suivis, erreur
éventuelle — par exemple une clé refusée) et le fichier en cours d'enregistrement.

## Réglages

Tous les paramètres artistiques et physiques sont dans **`config/default.json5`**, commenté ligne à ligne.

- Le serveur recharge la configuration **à chaud** : on modifie, on enregistre, l'image suit.
- Le panneau (`P`) agit en direct ; « Enregistrer » écrit `config/local.json5` (ignoré par git),
  qui surcharge `default.json5`. Les réglages de rendu et de cadrage sont enregistrés pour la cible
  courante (`targets.screen` ou `targets.projector`), la palette et les ondes pour toutes les cibles.
- `config/expo.json5` s'applique en plus quand le serveur est lancé avec `VACARME_MODE=expo`.

Repères pour régler les ondes :

| Paramètre | Effet |
|---|---|
| `waves.damping` | persistance des fronts. Trop bas (≈ 0,004) : tout l'océan sature, plus de contraste. |
| `waves.amplitude.slMin` / `gamma` | quels navires « marquent » : monter `slMin` éteint les petits bateaux |
| `waves.brightness`, `waves.relief` | luminosité des crêtes ; part de reflets « en relief » |
| `waves.pulse.*` | longueur d'onde, nombre de cycles par impulsion, cadence |
| `render.blackLift` | plancher de noir (utile au projecteur, dont le noir est gris) |

## Ce que l'on voit

- **Ondes** (grille visuelle) : chaque navire émet des fronts d'onde ; ils interfèrent, se réfractent
  sur les plateaux continentaux et s'arrêtent sur les côtes.
- **Lueur d'accumulation** (grille physique, calibrée en dB re 1 µPa) : là où le bruit dure,
  l'océan s'illumine lentement ; quand le trafic s'en va, la lueur s'efface plus lentement encore.
- **Terra incognita** : les zones où l'AIS ne voit rien sont dans l'ombre, sous un brouillard lent et
  un grain fin — distinctes du calme connu (noir net, relief du fond à peine perceptible).
- **Cétacés** (lumière chaude, pâle) : rorquals bleus et communs, baleines à bosse, cachalots, orques,
  en groupes placés dans leurs habitats (AquaMaps) et près d'observations réelles (OBIS).
  - **Espace de communication** : autour de chaque groupe, la zone où son appel reste audible, calculée
    pixel par pixel avec le bruit local — rongée par les couloirs de trafic, coupée par les côtes ;
    contour pointillé et tremblant là où l'AIS ne voit rien (bruit sous-estimé).
  - **Liens** : fils de lumière entre groupes qui s'entendent ; les appels y circulent dans le sens de
    l'écoute ; un lien peut devenir asymétrique (l'un entend, l'autre non), s'effilocher, se rompre, laisser
    une trace fantôme, se retisser.
  - Scène de test : `?scene=duo` — deux groupes de rorquals communs en mer Ligure, au seuil de s'entendre.
- **Son** : on entend ce que l'on regarde (zoomer = tendre l'oreille). Les navires les plus forts de la vue
  ont chacun une voix grave (timbre selon la classe) ; une nappe suit le bruit moyen de la zone ; les
  cétacés appellent, leurs voix se brouillent quand le bruit les masque ; un lien vivant donne un appel et
  une réponse, un lien rompu un appel sans réponse. Le son démarre au premier clic ou à la première
  touche (contrainte des navigateurs) ; `M` le coupe. Détails : `docs/MODELE_PHYSIQUE.md`, section 9.

Modèle, calibration (écart < 1 dB à la loi théorique), niveaux obtenus et limites :
[`docs/MODELE_PHYSIQUE.md`](docs/MODELE_PHYSIQUE.md).

## Performances mesurées (Radeon 780M, Chromium + Vulkan)

| Cible | Résolution de rendu | GPU / image | Images/s |
|---|---|---|---|
| écran (profil expo) | 1692×1128 (échelle 0,75 de 2256×1504) | 9,3 ms | 60 |
| projecteur (profil expo) | 1920×1200 | 11,6 ms | 60 |
| écran (profil light) | 1692×1128 | 6,7 ms | 60 |

Avec la grille de détail (zoom), compter 1 à 2 ms de plus.

## Architecture

```
shared/   modèle acoustique (JOMOPANS-ECHO, bandes, Thorp), protocole binaire, schéma de config
server/   serveur local : configuration, sources (AIS direct, replay, simulation, bascule), enregistreur,
          carte de couverture, WebSocket
client/   rendu WebGL2 (Three.js) : simulation d'ondes GPU, navires, composition, HUD, panneau
tools/    scripts Python (uv) : grilles, routes, conversion d'archives AIS
scripts/  utilitaires (faux serveur aisstream pour les tests)
data/     grilles terre/mer et bathymétrie, routes maritimes
docs/     sources et licences ; modèle physique (J3) ; guide d'exposition (J6)
```

- **Simulation d'ondes** (`client/src/sim/wave-sim.ts`) : équation des ondes 2D amortie, calculée sur
  la sphère en équirectangulaire (laplacien sphérique, stabilité locale près des pôles), les terres
  forment une frontière. Les navires y injectent des impulsions dont l'amplitude dépend de leur
  niveau source.
- **Niveaux sources** (`shared/src/acoustics/jomopans-echo.ts`) : modèle JOMOPANS-ECHO
  (MacGillivray & de Jong, 2021), 13 classes de navires, vitesse et longueur ; testé contre la figure 7
  de l'article.
- **Navires** : le serveur envoie un instantané binaire par seconde ; le GPU extrapole les positions
  (cap et vitesse) à chaque image.

## Tests

```bash
npm test         # vitest : modèle acoustique, protocole, classes AIS, géodésie, simulation,
                 #         messages aisstream, registre, couverture, enregistreur, replay, direct (serveur factice)
npm run typecheck
```

## Feuille de route

- [x] **J1** carte plate + navires simulés + ondes
- [x] **J2** AIS réel (aisstream.io), replay, bascule automatique, carte de couverture
- [x] **J3** champ physique calibré en dB (3 bandes), accumulation, terra incognita, exploration (zoom)
- [x] **J4** cétacés, espace de communication, liens entre groupes
- [x] **J5** son (sans spatialisation)
- [x] **J6** globe, demi-sphère avec un projecteur, mode exposition
