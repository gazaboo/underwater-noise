# Passation — validation des niveaux sonores sur mesures d’hydrophones

État au 15/10/2026, ~16 h 50 (heure locale). Reprise par un autre agent : **lire d’abord**
[VALIDATION_PROTOCOLE.md](VALIDATION_PROTOCOLE.md) (contrat scientifique, figé) puis
[ACOUSTIQUE_SCIENTIFIQUE.md](ACOUSTIQUE_SCIENTIFIQUE.md) (chaîne et outils).

## 1. Objectif et décisions de l’utilisateur (ne pas remettre en cause)

- Rendre **la carte mondiale** (ce que voit le public) crédible face aux mesures réelles ; RAM n’est plus
  qu’une référence hors ligne, la couche RAM régionale a été retirée de l’œuvre.
- Données : stations ICES 2019 dans la couverture AIS danoise (DMA) + NOAA NRS11 (eau profonde, AIS
  MarineCadastre). **Un jour par saison** (l’utilisateur veut des volumes de données réduits ; extensions
  possibles par un protocole v2 déclaré avant calcul).
- Contrôle qualité : fait par l’agent, critères écrits, figures publiées, mention « pas une revue
  d’acousticien ».
- Critère public : ≥ 80 % des médianes (125 Hz–10 kHz) des stations de test à ±3 dB ⇒ formulation
  « compatible avec les mesures … à l’état de l’art des cartes publiées » ; sinon on affiche l’écart.
- Fichiers ICES bruts : tout télécharger, extraire les jours, **puis supprimer** les HDF5 (`qc.py --prune-raw`).
- L’utilisateur exige une traçabilité stricte : chaque nombre étiqueté [S]/[L]/[E]/[C]/[C-calé]/[A].

## 2. Règles d’intégrité à respecter absolument

1. **Aucune comparaison modèle–mesure sur les stations de test (Anholt, Lillebælt, Fehmarn, NRS11) avant
   la fin du calage.** `run_protocol.py --phase test` ne se lance **qu’une fois**, après `calibrate.py`.
2. Le contrôle qualité se décide sur les **mesures seules** (`qc.py`, figures), jamais en regardant des
   prédictions. Statut `reviewed` à poser dans chaque fiche avant `run_protocol.py`.
3. Toute modification du protocole va dans §8 « Écarts au protocole », datée, justifiée, **avant** le calcul
   concerné. Deux écarts existent déjà (profondeur NRS11 ; critère de plancher instrumental reformulé).
4. Stations de développement (FINO3, ICES 13076) : rapports `--exploratory` uniquement, jamais en test.
5. Rien n’est ajusté hors de la liste fermée du protocole §6 (et le modèle de vent « eau peu profonde »
   ne peut être essayé que si une formule est **lue** dans une source ; sinon ne pas l’explorer).

## 3. Ce qui est fait (commits `beb9256` → `998459f`)

| Commit | Contenu |
|---|---|
| beb9256 | Travail Codex initial commité tel quel (base). |
| 9a8d1bb | `ices.py` (fenêtres contiguës, séries chevauchantes refusées), `point-predict.ts`, `validate.py` (QC par fiche), RAM convergence adaptative, benchmark JOMOPANS en test lent, `station_case.py`, fiches FINO3/13076. |
| 623cd0a | Protocole v1 figé. |
| f50f451 | `fetch_protocol.py`, `noaa.py` (HMD → décidécades exact), `replay.py`, `qc.py`, `calibrate.py` (recalcul exact des pertes, identité TS vérifiée), `run_protocol.py`, `make_stations.py`, fiche NRS11, instantané dictionnaire ICES + EMODnet. |
| 8896e2e | Couche RAM régionale retirée ; schéma `validationSummarySchema` ; serveur `/api/science` renvoie `{status, validation}` ; panneau « Fiabilité » montre l’écart publié dans une zone mesurée, « non validé » ailleurs. |
| 8b2d4a3 | Extraction des jours puis suppression des HDF5 ; `fetch_protocol.py --relog`. |
| 998459f | Écart n° 2 (critère 4) ; fiche Hjelm ; figures QC Hjelm et NRS11. |

Tests : `npm test` (87 + 4 outils), `npm run typecheck`, `npm run build`, et
`tools/.venv-science/bin/python -m unittest discover -s tools/science -p 'test_*.py'` (16 tests ; benchmark
lent avec `VACARME_SLOW=1`, ~10 s, OK). Tout est vert au dernier commit.

## 4. Données : état exact (cache `tools/.cache/science/`, hors dépôt)

- `ais/` : `mc-*.csv.gz` (4 jours, complets) ; `dma-2019-02-20.csv.gz` + **replay déjà construit**
  (`dma-2019-02-20.replay.ndjson.gz` + `.json`) ; `dma-2019-04-16`, `dma-2019-06-05` et `dma-2019-11-12` complets
  (**tous les téléchargements du protocole sont terminés**).
- `ices/` : **tous les fichiers du protocole sont téléchargés** (24 fichiers uniques, journal complet) +
  les deux fichiers de développement (~10 Go au total : à supprimer après extraction, `qc.py --prune-raw`).
- `nrs/` : NRS11 complet (4 jours). `days/` : jours extraits (Hjelm, NRS11).
- Aucun processus en arrière-plan. `fetch_protocol.py` reste **relançable sans risque**
  (fichiers présents sautés ; un `.part` DMA est réécrit).

## 5. Reprise : commandes, dans l’ordre

```bash
cd tools/science; P=../.venv-science/bin/python
# 0. Vérifier/relancer les téléchargements (ne pas tuer avec `pkill -f` : le motif tue aussi le shell appelant)
ps aux | grep fetch_protocol | grep -v grep
$P fetch_protocol.py --only dma      # ~10–20 min/jour
$P fetch_protocol.py --only ices     # ~6 Go restants
$P fetch_protocol.py --relog         # consigne les fichiers présents absents du journal
# 1. Fiches des stations ICES (Hjelm existe déjà ; une fiche existante n'est jamais écrasée)
$P make_stations.py
# 2. Contrôle qualité des mesures seules, puis examen visuel de docs/validation/qc/<station>-qc.png
$P qc.py
```

3. **Revue QC, fiche par fiche** (`stations/<id>.json`, section `qc`), à partir de `docs/validation/qc/<id>-qc.json` :
   - `excludePeriods` ← chaque `instrumentSilences` (start, end, raison « silence instrumental, critère 4a »).
     Hjelm : 2019-06-05T20:00:01Z → 21:17:01Z (47 min, spectre figé à 78 dB).
   - `excludeBands` ← `bandsAtInstrumentFloorHz` (critère 4b) + contaminations de la littérature (critère 3).
   - garder le signalement `flow-noise-susceptible` (≤ 63 Hz) des fiches ICES ; pour NRS11, ajouter en
     signalement le chœur de rorquals (~20 Hz, nov./fév.) — biologie non modélisée — sans exclure.
   - vérifier critère 2 (`calibrationDeclared`) et l’intégrité (segments, chevauchements) dans le JSON QC.
   - `status: "reviewed"`, `notes` : « Critères écrits du protocole appliqués par l’agent sur les mesures
     seules ; pas une revue d’acousticien », date.
   - puis `$P qc.py --prune-raw` (supprime les HDF5 ; `station_case.py` relit alors `days/`).
4. **Calage** : `$P run_protocol.py --phase calibration` (construit les replays manquants — ~8 min/jour —,
   télécharge le vent ERA5 via Open-Meteo, ~35 s de prédiction par station-jour), puis `$P calibrate.py`
   → `tools/science/calibration-v2.json`. Grille 7³ × 2 puis affinement : vérifier la durée sur un cas
   avant de tout lancer. Les calculs d’une station de **calage** peuvent être regardés librement.
5. **Test (une seule fois)** : `$P run_protocol.py --phase test --physics calibration-v2.json`.
6. **Synthèse — à écrire** (`tools/science/summarize.py`, n’existe pas encore) :
   - agréger les rapports `runs/v1-test/*-report.json` (variantes `world-law`, `world-law-wind5`,
     `world-law-calibrated[-wind5]`, `ambient-only`) : par station × jour × bande ΔL50/ΔL10, part à ±3 dB,
     séparément eau peu profonde / profonde ; validation croisée « une station de calage laissée de côté » ;
   - produire `docs/VALIDATION.md` (tableaux, figures séries temporelles, résultats bruts même mauvais) et
     `data/science/validation-summary.json` conforme à `validationSummarySchema`
     (`shared/src/acoustics/scientific.ts`) ; `profileId` doit égaler `SCIENTIFIC_PROFILE_ID`.
   - **Si** le profil calé v2 est adopté pour l’œuvre : mettre ses valeurs dans `REFERENCE_PHYSICS`,
     passer `SCIENTIFIC_PROFILE_ID` à `north-sea-reference-v2`, étiqueter [C-calé] ; si `transitionFactor ≠ 1`,
     modifier aussi `physAmplitude` (r_t) dans `client/src/sim/physics-sim.ts` et la loi des cétacés.
7. Mettre à jour `docs/REVUE_SCIENTIFIQUE.md` (§1 « ce qu’il ne faut pas dire », §4.4, §4.6, §10, §11
   point 5) et vérifier le panneau dans l’app (`npm run dev`, survol d’une zone mesurée / non mesurée).

## 6. Constats déjà établis (à reprendre dans le rapport)

- FINO3 (dev., tempête 10 m/s, 1 h) : loi mondiale +12 dB à 63 Hz, −22 dB en 10–40 Hz, −4 dB en 1–10 kHz ;
  RAM convergé (pas ÷ 8 à 63 Hz) n’attribue presque rien aux navires à 63 Hz : le niveau mesuré y vient
  vraisemblablement du vent / de l’écoulement. Exploratoire, non publiable comme validation.
- Hjelm 20/02/2019 (prédiction seule, sans comparaison) : ~660 navires dans 300 km, **80 % des trajets
  bloqués par la terre** dans la grille 1024 (39 km) ; 82 % de l’énergie à 125 Hz vient de 10–30 km.
- Fichier ICES FINO3 : deux séries complètes décalées de 5 s (question au producteur BSH) ; 13076 = Hönö
  selon le dictionnaire ICES (pas Vinga) ; NRS11 : fond 528 m, hydrophone 500 m (métadonnée à confirmer).
- Benchmark JOMOPANS : 0,59 dB max ; ancienne convergence RAM non valable (8,3 dB à 63 Hz).

## 7. Reste ouvert hors chemin critique

- Contrôle GPU ↔ loi au point (plan, phase 2.2) : écart dû à la grille 39 km et au champ proche GPU
  (−3,2 dB à 78 km, REVUE §4.4) non chiffré aux stations ; à faire dans le navigateur (replay + lecture
  `PhysicsField.readComponents`) ou à déclarer comme limite.
- RAM avec milieu sourcé (EMODnet, Copernicus) : optionnel (référence).
- Incohérence mineure de l’œuvre : le fond naturel d’une bande large est intégré sur fMin–fMax exacts,
  la source J-E sur les bords des décidécades (≤ ~1 dB) ; à harmoniser et documenter.
- `visual_assets_references/` non suivi : ne pas commiter sans demander.
