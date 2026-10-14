# La carte du vacarme

Installation projetée qui rend visible et audible, en temps réel et à l'échelle du monde, le bruit
sous-marin des navires — et ce qu'il fait à l'espace de communication des cétacés.

Chaque navire émet des fronts d'onde qui se propagent sur l'océan, interfèrent, s'arrêtent sur les
côtes ; là où le trafic est dense, l'océan s'illumine ; ailleurs, il reste noir.

> État : **jalon J1** — carte plate, navires simulés sur les grandes routes, ondes GPU.
> Plan complet et jalons : voir la section « Feuille de route » plus bas.

## Installation

Prérequis : Node ≥ 20, [uv](https://docs.astral.sh/uv/) (pour les scripts de données, Python ≥ 3.10),
Chromium ou Chrome.

```bash
npm install
npm run data        # télécharge ETOPO 2022 + Natural Earth et construit data/ (≈ 4 min, une seule fois)
cp .env.example .env  # clé aisstream.io — utile à partir du J2
```

Les fichiers de `data/` sont versionnés : `npm run data` n'est nécessaire que pour les régénérer.

## Lancement

```bash
npm run dev         # serveur local (port 8787) + client Vite (http://localhost:5173)
```

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

### Clavier

| Touche | Action |
|---|---|
| `P` | panneau de réglage (caché) |
| `D` | diagnostic : images/s, temps CPU et GPU, navires, source |
| `F` | plein écran |

Le curseur disparaît après deux secondes d'immobilité.

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

## Performances mesurées (Radeon 780M, Chromium + Vulkan)

| Cible | Résolution de rendu | GPU / image | Images/s |
|---|---|---|---|
| écran (profil expo) | 1692×1128 (échelle 0,75 de 2256×1504) | 6,2 ms | 60 |
| projecteur (profil expo) | 1920×1200 | 7,4 ms | 60 |
| écran (profil light) | 1692×1128 | 3,6 ms | 60 |

## Architecture

```
shared/   modèle acoustique (JOMOPANS-ECHO, bandes, Thorp), protocole binaire, schéma de config
server/   serveur local : configuration, sources de navires (simulation ; AIS et replay au J2), WebSocket
client/   rendu WebGL2 (Three.js) : simulation d'ondes GPU, navires, composition, HUD, panneau
tools/    scripts Python (uv) de préparation des données
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
npm test         # vitest : modèle acoustique, protocole, classes AIS, géodésie, simulation
npm run typecheck
```

## Feuille de route

- [x] **J1** carte plate + navires simulés + ondes
- [ ] **J2** AIS réel (aisstream.io), replay, bascule automatique, carte de couverture
- [ ] **J3** champ physique calibré en dB (3 bandes), accumulation, terra incognita, esthétique finale
- [ ] **J4** cétacés, espace de communication, liens entre groupes
- [ ] **J5** son
- [ ] **J6** globe, demi-sphère avec un projecteur, mode exposition
