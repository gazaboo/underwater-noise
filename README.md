# La carte du vacarme

Installation projetée qui rend visible et audible, en temps réel et à l'échelle du monde, le bruit
sous-marin des navires — et ce qu'il fait à l'espace de communication des cétacés.

Le bruit ajouté par les navires s'étend sur l'océan en nappe de paliers chauds ; les cétacés, en
silhouettes froides, voient leur espace de communication se réduire et leurs appels se briser sur ce bruit.
Trois usages : installation projetée (demi-sphère), écran du portable, **page web autonome** (sans serveur).

> État : **jalon J6** — navires en direct (aisstream.io), en replay ou simulés ; ondes visibles ;
> champ de bruit calibré en dB (trois bandes) ; lueur d'accumulation ; terra incognita ; exploration (zoom) ;
> cétacés : espace de communication rongé par le bruit, liens entre groupes ; son ; globe et demi-sphère
> (un projecteur) ; mode exposition. Revue scientifique : [`docs/REVUE_SCIENTIFIQUE.md`](docs/REVUE_SCIENTIFIQUE.md).
> Refonte de la représentation (bruit, cétacés, navires, légende) et mode web autonome :
> [`docs/REPRESENTATION.md`](docs/REPRESENTATION.md). Plan complet et jalons : « Feuille de route » plus bas.

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

Page web autonome (statique, sans serveur Node : les navires sont calculés dans le navigateur) :

```bash
npm run build:web                                   # client/dist-web (≈ 37 Mo avec les données)
cd client && npx vite preview --outDir dist-web     # vérification locale
```

En développement, `?standalone` donne le même fonctionnement depuis `npm run dev`. Mettre la page en ligne
(GitHub Pages ou autre) est une publication : à décider explicitement.

Production (un seul processus, le serveur sert le client compilé) :

```bash
npm run build && npm start   # http://localhost:8787
```

### Paramètres d'URL

| Paramètre | Valeurs | Effet |
|---|---|---|
| `target` | `screen` (défaut), `projector`, `web` | cible d'affichage : écran du portable, Epson EB-990U, page web |
| `standalone` | (présent) | web autonome : navires calculés dans le navigateur, sans `/ws` ni `/api` |
| `quality` | `expo` (défaut), `light` | qualité du rendu (la grille physique de référence reste fixe) |
| `hud` | (présent) | affiche le diagnostic au démarrage |
| `scene` | `duo` | scène de test des liens (deux groupes en mer Ligure) |
| `mode` | `flat`, `globe`, `hemisphere`, `equirect`, `fisheye` | mode de rendu |
| `theme` | `night` (défaut), `day` | palette de nuit (installation) ou de jour (continents lisibles) |

### Clavier

| Touche | Action |
|---|---|
| `P` | panneau de réglage (caché) |
| `D` | diagnostic : images/s, temps CPU et GPU, navires, source, calibration, niveau de bruit sous le curseur |
| `V` | représentation du bruit : isophones → météo → encre → fronts bruts |
| `B` | champ physique en dB (isolignes tous les 10 dB) : accumulé → basse → moyenne → haute → rendu |
| `M` | couper / rétablir le son |
| `G` | carte plate ↔ globe (globe : glisser = tourner, molette = zoom) |
| `O` | mode de sortie : carte, globe, demi-sphère, équirect, fisheye |
| `C` | mire de calibration (méridiens, parallèles, cercles, croix d'axe) |
| `J` | palette de jour ↔ de nuit (`dayPalette` dans la configuration) |
| `N` | navires réels → estimés → réels + estimés (`source.ships`) |
| `F` | plein écran |
| molette / pincement | zoom centré sur le curseur (jusqu'à ×40) |
| glisser | déplacer la carte |
| flèches, `+` / `-` | déplacer, zoomer au clavier |
| double-clic, `R`, `0` | revenir au cadrage initial |

Le zoom interpole le **même champ acoustique mondial**, de résolution ≈ 39 km par cellule dans
le profil de référence. Il ne crée plus de grille d’ondes indépendante : vitesse et portée ne changent
pas avec le cadrage ou le profil de rendu. Les petits détroits restent insuffisamment résolus.

Le curseur disparaît après deux secondes d'immobilité.

## Sources de navires

| Mode (`source.mode`) | Comportement |
|---|---|
| `auto` (défaut) | direct si la clé est présente et le flux en bonne santé ; sinon replay ; sinon simulation |
| `live` | aisstream.io uniquement |
| `replay` | fichiers de `replay.path` (en boucle, vitesse commune `playback.timeScale`) |
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
- **Navires réels / estimés** (`source.ships`, touche `N` ou panneau `P`) :
  - `real` (défaut) : la source ci-dessus ;
  - `estimated` : uniquement des **navires estimés**, tirés de la présence AIS mondiale (terrestre et
    satellite) de Global Fishing Watch : leur **nombre et leur répartition** sont ceux du trafic réel en
    moyenne sur 30 jours (navires en route, ≥ 2 nœuds), leur mouvement est synthétique ;
  - `mixed` : navires réels là où l'AIS couvre, estimés ailleurs.

  En modes `estimated` et `mixed`, la terra incognita disparaît ; les navires estimés sont dessinés en
  **anneaux creux** et comptés à part dans le diagnostic (`D`). Données : jeton gratuit (usage non
  commercial) de [Global Fishing Watch](https://globalfishingwatch.org/our-apis/) dans `.env`
  (`GLOBALFISHINGWATCH_API_KEY=…`), puis `uv run tools/build_presence.py` (≈ 10 min, une fois ; produit
  `data/density/`). Méthode et limites : `docs/REVUE_SCIENTIFIQUE.md` §5 bis.

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

**Fiabilité des décibels** : le panneau « Fiabilité » en haut à gauche distingue niveaux des navires,
fond naturel et augmentation du bruit. Le profil physique de référence est fixe ; les réglages
artistiques ne modifient pas ces lectures. Les niveaux sont confrontés à des mesures d’hydrophones
selon un protocole pré-enregistré ([`docs/VALIDATION_PROTOCOLE.md`](docs/VALIDATION_PROTOCOLE.md)) ;
les écarts mesurés ne sont affichés que dans les zones mesurées, « non validé » ailleurs.
Méthode et outils : [`docs/ACOUSTIQUE_SCIENTIFIQUE.md`](docs/ACOUSTIQUE_SCIENTIFIQUE.md).

Les paramètres sont dans **`config/default.json5`**, commenté ligne à ligne. Le profil de référence fixe
les hypothèses acoustiques ; `science.mode: 'experimental'` permet les variantes physiques.

- Le serveur recharge la configuration **à chaud** : on modifie, on enregistre, l'image suit.
- Le panneau (`P`) agit en direct ; « Enregistrer » écrit `config/local.json5` (ignoré par git),
  qui surcharge `default.json5`. Les réglages de rendu et de cadrage sont enregistrés pour la cible
  courante (`targets.screen` ou `targets.projector`), la palette et les ondes pour toutes les cibles.
- `config/expo.json5` s'applique en plus quand le serveur est lancé avec `VACARME_MODE=expo`.

Le dossier **« Temps de la scène »** propose un facteur unique ×1–×100 (`playback.timeScale`).
À ×1, le modèle propage le son à environ **1,5 km/s** ; le même facteur accélère navires, cétacés,
appels, liens et accumulation. Le direct AIS impose ×1. Le curseur est appliqué et enregistré sur
le serveur ; une modification du facteur ne redémarre pas la scène.

Les fronts visibles viennent du **champ acoustique à trois bandes**. Le panneau conserve seulement
la bande affichée (`waves.band`, 10–40 Hz par défaut), la luminosité et le relief. Leur enveloppe suit
l’augmentation du niveau sur le fond naturel modélisé : invisible jusqu’à +1 dB, transition douce
jusqu’à +10 dB. Ce sont des **conventions de lisibilité**, pas des seuils biologiques. Augmenter la
luminosité ne révèle pas les zones sous ce seuil. L’espacement des anneaux reste numérique.

Les anciens réglages de vitesse, amortissement, impulsions, réfraction et amplitudes visuelles sont
ignorés au chargement. Les accélérations séparées des sources et des cétacés sont également ignorées.
La correction ne valide pas les portées en mer : le profil v1 est conservé avec ses limites publiées.
Les contrôles et la méthode sont décrits dans [`docs/PROPAGATION.md`](docs/PROPAGATION.md).

## Ce que l'on voit

Détails, statut de chaque choix et captures : [`docs/REPRESENTATION.md`](docs/REPRESENTATION.md).

- **Bruit ajouté par les navires** (teintes chaudes) : ΔL au-dessus du fond naturel dans une bande, en
  paliers +10 / +20 / +30 dB (×10, ×100, ×1000 l'énergie). Quatre représentations (touche `V`) : isophones
  animées, carte météo, encre, fronts bruts du modèle. Une légende permanente dit ce que l'on voit.
- **Terra incognita** : hachures là où l'AIS ne voit rien (bruit sous-estimé). Une zone sombre ne prouve pas le silence.
- **Navires** : chevrons orientés selon la route ; navires estimés en chevrons creux.
- **Cétacés** (teintes froides, une par espèce) : silhouettes des rorquals bleus et communs, baleines à bosse,
  cachalots, orques, en groupes placés dans leurs habitats (AquaMaps) et près d'observations réelles (OBIS).
  - **Vue rapprochée** (groupe le plus proche du centre) : zone encore audible, portée sans navires en
    pointillés, espace perdu en semis de points, anneau d'appel qui se brise sur le bruit.
  - **Liens** : fils colorés entre groupes qui s'entendent ; les appels y circulent dans le sens de
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

Projecteur 1920×1200, profil expo, 50 854 navires estimés, cadence normale (25 oct. 2026) : 60 images/s en
médiane dans tous les modes et toutes les représentations du bruit ; 1 à 2 % d'images entre 35 et 58 ms
(relecture du champ à chaque pas du modèle). Tableau complet et méthode : [`docs/REPRESENTATION.md`](docs/REPRESENTATION.md).

## Architecture

```
shared/   modèle acoustique (JOMOPANS-ECHO, bandes, Thorp), protocole binaire, schéma de config,
          sources de navires sans Node (shared/ships : simulation, estimés, AIS, couverture)
server/   serveur local : configuration, sources (AIS direct, replay, simulation, bascule), enregistreur,
          carte de couverture, WebSocket
client/   rendu WebGL2 (Three.js) : champ acoustique GPU, nappe de bruit, navires, cétacés, monde illustré,
          légende, panneau ; web autonome (sources de navires dans un Web Worker)
tools/    scripts Python (uv) : grilles, routes, conversion d'archives AIS
scripts/  utilitaires (faux serveur aisstream pour les tests)
data/     grilles terre/mer et bathymétrie, routes maritimes
docs/     sources et licences ; modèle physique (J3) ; guide d'exposition (J6)
```

- **Champ et fronts acoustiques** (`client/src/sim/physics-sim.ts`) : équation des ondes 2D amortie
  sur la sphère ; pas en secondes physiques, différences d’ordre 4 en mer et d’ordre 2 au voisinage
  de la terre. Les sources et les pertes sont communes aux fronts et aux lectures en dB. Les navires
  injectent un signal numérique incohérent dont la longueur d’onde ne représente pas le spectre réel.
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
npm run test:propagation                           # contrôles numériques sous Chromium
node scripts/verify-representation.mjs              # captures de la représentation et temps d'image (dev actif)
```

## Feuille de route

- [x] **J1** carte plate + navires simulés + ondes
- [x] **J2** AIS réel (aisstream.io), replay, bascule automatique, carte de couverture
- [x] **J3** champ physique calibré en dB (3 bandes), accumulation, terra incognita, exploration (zoom)
- [x] **J4** cétacés, espace de communication, liens entre groupes
- [x] **J5** son (sans spatialisation)
- [x] **J6** globe, demi-sphère avec un projecteur, mode exposition

Contrôles numériques et interface sous **Chromium** (serveurs temporaires isolés, aucun AIS réel,
aucun changement de `config/local.json5`) : `npm run test:propagation`. Chromium doit être installé ;
`CHROMIUM_PATH` permet de préciser son exécutable. Résultats dans `/tmp/vacarme-propagation-results`.

### Terres « gouache »

Les terres utilisent les couleurs idéalisées de Natural Earth II, stylisées dans le shader : aplats doux, relief chaud/froid, granulation et pigment sur les côtes. La nuit, leur lumière reste discrète pour laisser les ondes au premier plan. `J` bascule entre palettes nuit et jour.

Le panneau `P`, dossier **Terres (gouache)**, règle la matière et active séparément ornements, papier et étoiles. Les arbres et volcans apparaissent au zoom en carte plate ; étoiles et halo entourent uniquement le globe à l'écran. Les réglages sont enregistrés dans `config/local.json5` par le bouton du panneau. La palette de jour dispose de ses propres réglages `landLight` et `landTint`.

Pour retrouver l'ancien rendu, choisir `land.style: 'flat'` et désactiver `land.paper.enabled` ainsi que `land.stars.enabled`. Les positions des volcans sont sourcées (Smithsonian GVP) ; arbres, indice de forêt, fumée et traitement des couleurs sont **artistiques**, sans mesure de couverture forestière ni activité volcanique en direct. Voir `docs/SOURCES_DONNEES.md` et `docs/REVUE_SCIENTIFIQUE.md`. `npm run data` reconstruit aussi les données des terres.

### Monde illustré (par défaut)

Les terres et leurs ornements sont dessinés comme un globe illustré : milieux peints, relief en paliers,
plages, montagnes, volcans fumants, bosquets et nuages hors d'échelle. Ils sont visibles dans **tous les
modes**, demi-sphère comprise, pour un coût GPU non mesurable sur la Radeon 780M. `J` bascule nuit / jour ;
`P` → **Terres** règle tout (et permet de revenir à la gouache ou à l'aplat). Données, sources, traçabilité,
reconstruction et captures : [`docs/MONDE_ILLUSTRE.md`](docs/MONDE_ILLUSTRE.md).
