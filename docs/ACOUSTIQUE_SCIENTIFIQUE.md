# Niveaux acoustiques : fonctionnement et confiance

## État

Les niveaux de la carte mondiale sont des **estimations de modèle**. Leur écart aux mesures
d’hydrophones est en cours d’établissement selon un protocole pré-enregistré
([VALIDATION_PROTOCOLE.md](VALIDATION_PROTOCOLE.md)) ; tant qu’aucun résumé de validation n’est
publié (`data/science/validation-summary.json`), l’œuvre affiche « non validé ». Une fois publié, les
écarts mesurés ne sont montrés **que dans les zones mesurées** ; ailleurs, « non validé ».

Le panneau « Fiabilité », en haut à gauche, donne au curseur les niveaux des navires, le fond naturel
modélisé, leur somme et l’augmentation par rapport au fond, en dB re 1 µPa (moyenne quadratique par
bande) :

`total = 10 log10(10^(navires/10) + 10^(fond/10))` ; `augmentation = total − fond`.

Le fond n’inclut ni trafic lointain ajouté arbitrairement, ni pluie, ni biologie. Les navires absents
de l’AIS sous-estiment le bruit. Une augmentation acoustique n’est pas une mesure de dommage biologique.

## Profils et affichage

- `science.mode: 'reference'` : profil `north-sea-reference-v1`. Les anciennes surcharges locales de
  `physics`, `bands`, `ambient` et de résolution physique sont neutralisées au chargement ; l’API refuse
  de les modifier. Vent uniforme de scénario 5 m/s, moyenne exponentielle τ = 6 s en temps d’affichage,
  grille mondiale 1024 × 512, domaine numérique ±79°.
- `science.mode: 'experimental'` (dans `config/local.json5`) permet des variantes physiques, signalées
  comme expérimentales ; aucun écart mesuré n’est alors affiché.
- Ondes, palette et accumulation sont artistiques. Les lectures utilisent directement l’énergie
  calculée, indépendamment de la lueur, de sa mémoire et de ses pondérations.
- `GET /api/science` renvoie le statut et le résumé de validation, refusé s’il est invalide, hors de
  `data/science/` ou d’un autre profil physique.

## Chaîne de validation (outils hors ligne, `tools/science/`)

```bash
uv venv tools/.venv-science
uv pip install --python tools/.venv-science/bin/python -r tools/science/requirements.txt
P=tools/.venv-science/bin/python
$P tools/science/fetch_protocol.py              # mesures, AIS, spectres NOAA → tools/.cache/science
$P tools/science/make_stations.py               # fiches des stations ICES depuis des sources figées
$P tools/science/qc.py                          # contrôle qualité des MESURES seules → docs/validation/qc
$P tools/science/run_protocol.py --phase calibration
$P tools/science/calibrate.py                   # stations de calage seulement
$P tools/science/run_protocol.py --phase test --physics tools/science/calibration-v2.json   # une fois
```

1. **Mesures.** `ices.py` (ICES, HDF5) : enregistrements triés, doublons exacts retirés, séries qui se
   chevauchent avec des valeurs différentes **refusées** tant qu’un segment n’est pas choisi dans la
   fiche ; fenêtres de 60 s formées de mesures **contiguës** (les horloges d’enregistreur dérivent,
   aucune grille UTC n’est imposée, rien n’est interpolé à travers un trou) ; toutes les décidécades.
   `noaa.py` (NOAA « hybrid millidecade », 1 min) : décidécades par recouvrement exact des bandes,
   qualité « Good » et minutes complètes seulement.
2. **AIS.** `replay.py` convertit l’AIS historique (DMA, MarineCadastre) en replay du serveur ; le
   registre du serveur, avec les options du direct, donne les navires toutes les 10 s.
3. **Vent.** ERA5 au point (archive Open-Meteo, m/s), interpolé linéairement ; variante avec le vent de
   scénario de l’exposition (5 m/s) pour dire ce que voit le public.
4. **Prédictions** (`point-predict.ts`), pour les fenêtres exactes des mesures :
   - `world-law` : la loi du moteur mondial — mêmes fonctions partagées que le GPU (source J-E,
     `lossRateDbPerKm`, `pathTransmissionLoss`), même grille océan 1024, trajets bloqués par la terre —
     au point exact, sans la discrétisation de 39 km du champ GPU (écart chiffré séparément) ;
   - `ambient-only` : fond naturel seul ;
   - `ram-curves` (option) : pertes RAM au récepteur (63/125 Hz), référence de propagation.
   Les bandes larges de l’œuvre sont comparées en sommant les décidécades mesurées que la source J-E
   somme elle-même (10–40 Hz = décidécades 10 à 40 Hz, etc.).
5. **Comparaison** (`validate.py`) : ΔL50 et ΔL10 (prédit − mesuré), biais, RMSE, quantiles d’écart,
   corrélation, séparément selon que les navires, le fond ou aucun ne domine (écart de 3 dB, [A]).
   **L’acceptation des mesures ne vient jamais des lignes exportées** : elle vient de la section `qc`
   de la fiche station ; sans statut `reviewed`, seul un rapport `--exploratory`, étiqueté, est possible.
6. **Calage** (`calibrate.py`) : la géométrie de chaque contribution (distance, codes de profondeur
   8 bits traversés dans la grille) est exportée ; la perte se recalcule donc exactement pour d’autres
   paramètres (identité avec le TypeScript vérifiée à 7·10⁻⁶ dB). Seuls les paramètres et bornes du
   protocole bougent, sur les seules stations de calage.

Stations de développement, exclues de tout test : FINO3 (04-DE-FN3, 18/12/2019) et ICES 13076
(01/07/2019). Le fichier ICES de FINO3 contient deux séries complètes décalées de 5 s (écart moyen
0,3 dB) : segment 0 retenu, question à poser au producteur ; son pic à 125 Hz (« most likely caused
by generator or platform noise », Basan et al. 2024, §4.1.2, lu) exclut cette décidécade et la bande
100–500 Hz. La station 13076, prise pour Vinga par la version précédente de la chaîne, est
« Hon1, Hönö primary station » dans le dictionnaire ICES : identité et profondeur (20 ou 45 m) ambiguës.

## Référence RAM

RAM v1.5 via PyRAM 1.0.1 : source monopolaire à 6 m, fond fluide homogène, propagation 2D, absorption
de Thorp ajoutée ; corrections amont du démarreur Padé et du pas entier ; couche absorbante de
80 longueurs d’onde. La convergence compare l’**énergie de bande intégrée** entre grilles dont les pas
sont divisés par deux, et raffine jusqu’à ≤ 1 dB aux distances où la perte reste sous 120 dB (au-delà,
un navire de niveau source décidécade ~190 dB re 1 µPa·m arrive sous le plus faible fond mesuré,
~70 dB [C]). Constat du 15/10/2026 : à FINO3 (21,8 m, 63 Hz proche de la coupure), la grille
d’origine différait encore de **8,3 dB** ; il a fallu diviser les pas par 8. Une convergence contrôlée
n’est pas une validation physique.

**Benchmark JOMOPANS** (de Jong et al. 2021, *Guidelines for modelling ocean ambient noise*, annexe E ;
`benchmark.py`, test `VACARME_SLOW=1`) : guide uniforme et remontée du fond, 63 et 125 Hz, 1 à 50 km.
Écart maximal **0,59 dB** (15/10/2026) [C], tolérance 1 dB. Il vérifie l’implémentation sur des
milieux idéalisés, pas le milieu réel.

## Vérifications et références

```bash
npm test && npm run typecheck && npm run build
tools/.venv-science/bin/python -m unittest discover -s tools/science -p 'test_*.py' -v
```

Les tests couvrent : sommation énergétique ; fenêtres contiguës, trous, séries chevauchantes, doublons ;
libellés de décidécades ; conversion HMD exacte (bruit blanc) ; contrôle qualité par fiche ; bandes larges
reconstituées ; loi mondiale au point (cas analytique en eau profonde, trajet bloqué par la terre) ;
identité Python/TypeScript des pertes ; résumé de validation (structure, profil, emplacement) ; RAM contre
la solution analytique source + image (0,3 dB) et, en test lent, le benchmark JOMOPANS.

- [JOMOPANS-ECHO (2021)](https://www.mdpi.com/2077-1312/9/4/369).
- [Basan et al. 2024, The underwater soundscape of the North Sea](https://eprintspublications.npl.co.uk/10094/) (stations, profondeurs, bruit d’écoulement).
- Farcas et al. 2020, *Validated shipping noise maps of the Northeast Atlantic*, Science of the Total Environment 735, 139509 (repère de validation).
- [ICES, bruit continu](https://underwaternoise.ices.dk/continuous/webservices) ; [dictionnaire de stations ICES](https://gis.ices.dk/gis/rest/services/ICES_Datasets/Station_Dictionary/MapServer) ; [AIS DMA](https://www.dma.dk/safety-at-sea/navigational-information/ais-data).
- [NOAA NRS, spectres HMD](https://doi.org/10.25921/tr4q-xa94) ; [MarineCadastre AIS](https://hub.marinecadastre.gov/pages/vesseltraffic) ; Martin et al. 2021, *Hybrid millidecade spectra*, JASA, doi:10.1121/10.0003324.
- [RAM, guide de Michael Collins](https://oalib-acoustics.org/website_resources/PE/RAM.pdf) ; [PyRAM](https://github.com/marcuskd/pyram).
