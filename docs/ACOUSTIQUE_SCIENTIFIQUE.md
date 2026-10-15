# Niveaux acoustiques : fonctionnement et confiance

## État livré

La carte mondiale reste une **estimation simplifiée non validée**. Le profil de référence fixe ses
hypothèses pour éviter les réglages physiques accidentels ; il ne transforme pas ces hypothèses en
mesures. La chaîne RAM régionale calcule des pré-calculs hors ligne, puis les affiche dans la carte.
**Aucun champ régional réel ni validation sur hydrophones n’est fourni par défaut.**

Le panneau « Fiabilité », en haut à gauche, donne les niveaux des navires, le fond naturel modélisé,
leur somme et l’augmentation par rapport au fond. Les niveaux sont des pressions RMS par bande en
dB re 1 µPa ; l’augmentation est une différence en dB :

`total = 10 log10(10^(navires/10) + 10^(fond/10))` ; `augmentation = total − fond`.

Le fond n’inclut ni trafic lointain ajouté arbitrairement, ni pluie, ni biologie. Les navires manquants
dans l’AIS sous-estiment le bruit. Une augmentation acoustique n’est pas une mesure de dommage biologique.

## Profils et affichage

- `science.mode: 'reference'` : `north-sea-reference-v1`. Les anciennes surcharges locales de `physics`,
  `bands`, `ambient` et résolution physique sont neutralisées au chargement. Les pertes mondiales restent
  empiriques ; vent uniforme de scénario 5 m/s, moyenne exponentielle τ = 6 s en temps d’affichage,
  grille mondiale 1024 × 512 et domaine numérique ±79°.
- `science.mode: 'experimental'` dans `config/local.json5` permet les variantes physiques, signalées
  comme expérimentales. L’API refuse les modifications physiques tant que le profil reste fixe.
- Ondes, palette et accumulation sont artistiques. Les lectures mondiales utilisent directement
  l’énergie calculée, indépendamment de la lueur, de sa mémoire et de ses pondérations.
- Les bandes historiques 10–40 / 100–500 / 1 000–10 000 Hz restent utilisées pour les cétacés. Les bandes
  régionales sont séparées : centres exacts `10^1.8` et `10^2.1` Hz (63/125 nominaux), bornes × `10^±0.05`.
- Les fenêtres régionales UTC de 60 s sont sélectionnées explicitement. Les navires et cétacés du direct
  sont masqués dans cette vue historique. Les hachures signifient donnée absente ; aucune interpolation
  ou extrapolation ne remplit les trous.

## Calcul régional reproductible

```bash
uv venv tools/.venv-science
uv pip install --python tools/.venv-science/bin/python -r tools/science/requirements.txt
tools/.venv-science/bin/python tools/science/ram.py environment.json kernels.json
node --import tsx tools/science/import-replay.ts replay.ndjson.gz wind.json \
  2019-10-01T00:00:00Z 2019-10-01T01:00:00Z traffic.json
node --import tsx tools/science/build.ts kernels.json traffic.json data/science/north-sea.json
```

Environnement : suivre `tools/science/environment.example.json`. Chaque source est un nœud géographique,
chaque récepteur le centre d’une cellule. Les trajets spécifient bathymétrie (distance/profondeur en m),
profils de célérité par distance, célérité/densité/atténuation du sédiment, période de validité et
profondeur du récepteur. La distance maximale de rattachement des navires aux nœuds est explicite.
Les paramètres réels doivent provenir des données régionales, pas de l’exemple idéal. La longueur du
trajet est contrôlée contre les coordonnées ; aucun trajet terrestre n’est accepté. PyRAM 1.0.1 exige
que le profil de célérité se termine au maximum bathymétrique.

RAM v1.5 est exécuté via PyRAM 1.0.1, avec source monopolaire à 6 m, fond fluide homogène par trajet,
propagation 2D et absorption de Thorp ajoutée. Le wrapper applique la réinitialisation des coefficients
Padé après le démarreur et le pas entier de la version amont, ainsi que les alias NumPy supprimés.
Une couche absorbante de 80 longueurs d’onde limite les réflexions numériques de bord.

Le contrôle de convergence compare l’**énergie de bande intégrée** (quadrature de la décidécade) entre
deux grilles successives dont les pas distance/profondeur sont divisés par deux. Les écarts à une seule
fréquence ne sont pas la grandeur prédite : leurs franges d’interférence bougent avec la grille. Pour
les courbes au récepteur, le raffinement double jusqu’à un écart ≤ 1 dB aux distances où la perte
reste sous 120 dB (au-delà, un navire de niveau source décidécade ~190 dB re 1 µPa·m arrive sous le
plus faible fond mesuré, ~70 dB [C]). Une convergence contrôlée n’est **pas une validation physique**.

Constat du 15/10/2026 : à FINO3 (guide de 21,8 m, 63 Hz proche de la coupure), la grille d’origine
(pas divisés par deux une seule fois) différait encore de **8,3 dB** en énergie de bande : les
prédictions RAM antérieures à 63 Hz en eau peu profonde n’étaient pas convergées.

**Benchmark JOMOPANS** (de Jong et al. 2021, *Guidelines for modelling ocean ambient noise*, annexe E ;
`tools/science/benchmark.py`, test `VACARME_SLOW=1`) : guide uniforme (cas 1) et remontée du fond
(cas 2), 63 et 125 Hz, 1 à 50 km, source à 5 m. Écart maximal aux valeurs de référence **0,59 dB**
(15/10/2026) [C], tolérance du test 1 dB. Ce benchmark vérifie l’implémentation RAM sur des milieux
idéalisés ; il ne dit rien du milieu réel.

Vent d’entrée : `{ "provenance": "source et hypothèses", "intervals": [
{ "start": "…Z", "end": "…Z", "windMs": 5 }] }`. Le vent est uniforme sur le domaine à chaque instant ;
une période sans vent provoque une erreur. L’import AIS échantillonne toutes les 10 s, extrapole au plus
2 min et documente les omissions (navires à quai/vitesse inconnue). `coverage=observed` signifie réception
AIS récente, **pas couverture exhaustive**. Les drapeaux synthétiques/estimés sont refusés.

L’intégrateur emploie le modèle JOMOPANS-ECHO partagé : propagation par fréquence, puis sommation des
énergies entre fréquences, navires et instants. Les périodes incomplètes, bateaux hors nœuds et trajets
manquants donnent des cellules absentes. Une cellule `null` signifie donnée absente ; `shipsDb=null`
dans une cellule présente signifie énergie des navires nulle. L’erreur spatiale due au rattachement
aux nœuds n’est pas couverte par la convergence RAM.

`GET /api/science` fournit statut et jeu validé structurellement ; le bouton « Recharger les pré-calculs »
recharge la couche. `science.dataset` doit rester sous `data/science/`. Les messages WebSocket `science`
transmettent le statut du profil. `depthMode=depth-mean` moyenne les énergies sur la profondeur avant
conversion en dB ; `receiver` conserve la profondeur ponctuelle pour les comparaisons aux hydrophones.

Les deux fichiers `*.example.json` sont des **cas idéaux de test** avec un navire fictif représenté comme
entrée numérique pour tester l’intégrateur. Ils ne sont jamais chargés par défaut ni utilisés comme
observations. Pour tester la chaîne, écrire leur sortie sous `/tmp`, pas comme carte réelle.
Pour la sensibilité, refaire les calculs avec des variantes documentées de milieu et de vent ; leur
dispersion ne constitue pas automatiquement un intervalle de confiance.

## Mesures et validation

Chaîne par station, pilotée par une fiche versionnée `tools/science/stations/<id>.json` (position,
profondeurs, sources lues, fichier ICES et son empreinte, segment retenu, contrôle qualité, rôle dans
le protocole) :

```bash
tools/.venv-science/bin/python tools/science/station_case.py tools/science/stations/fino3.json \
  --ais-csv tools/.cache/science/fino3-ais.csv --start 2019-12-18T00:15:00Z --end 2019-12-18T01:29:00Z \
  --out /tmp/cases --ram-depth 21.8 --exploratory
```

1. **Mesures** (`ices.py`) : les enregistrements sont triés ; les doublons exacts sont retirés ; des
   séries qui se chevauchent avec des valeurs différentes sont **refusées** tant qu’un segment n’est
   pas choisi explicitement dans la fiche. Les fenêtres de 60 s sont formées de mesures **contiguës**
   (début + durée de moyenne) : les horloges d’enregistreur dérivent, aucune grille UTC n’est imposée
   et rien n’est interpolé à travers un trou. Toutes les décidécades sont exportées.
2. **AIS** : CSV DMA trié puis converti en replay ; le registre du serveur (mêmes options que le
   direct) donne les navires à des instants réguliers de chaque fenêtre.
3. **Vent** : ERA5 au point (archive Open-Meteo, m/s), interpolé linéairement.
4. **Prédictions** (`point-predict.ts`) pour les fenêtres exactes des mesures :
   - `world-law` : la loi du moteur mondial (source J-E, `lossRateDbPerKm`, `pathTransmissionLoss`,
     grille océan 1024, trajets bloqués par la terre) au point exact, sans la discrétisation de
     39 km du champ GPU ;
   - `ram-curves` : pertes RAM au récepteur (63/125 Hz), référence de propagation ;
   - `ambient-only` : fond naturel seul.
   Les bandes larges de l’œuvre sont comparées en sommant les décidécades mesurées que la source
   J-E somme elle-même (10–40 Hz = décidécades 10 à 40 Hz, etc.).
5. **Comparaison** (`validate.py`) : biais, RMSE, quantiles d’écart, corrélation, niveaux dépassés
   L90/L50/L10 mesurés et prédits, séparément selon que les navires, le fond ou aucun des deux ne
   domine (écart de 3 dB, choix de présentation [A]).

**L’acceptation des mesures ne vient jamais des lignes exportées** : elle vient de la section `qc`
de la fiche station (bandes exclues avec leur source, périodes exclues, signalements). Tant que son
statut n’est pas `reviewed`, seul un rapport `--exploratory`, étiqueté comme tel, peut être produit.

Stations de développement : Vinga (01-SE-VIN, 01/07/2019) et FINO3 (04-DE-FN3, 18/12/2019) ont servi
à mettre au point la chaîne ; elles sont exclues de tout jeu de test. Le fichier ICES de FINO3
(décembre 2019) contient deux séries complètes décalées de 5 s (écart moyen 0,3 dB) : segment 0
retenu, segment 2 en sensibilité, question à poser au producteur. Le pic à 125 Hz de FINO3 (« most
likely caused by generator or platform noise », Basan et al. 2024, §4.1.2, lu) exclut cette
décidécade et la bande 100–500 Hz qui la contient.

## Vérifications et références

```bash
npm test
npm run typecheck
npm run build
tools/.venv-science/bin/python -m unittest discover -s tools/science -p 'test_*.py' -v
```

Les tests couvrent sommation énergétique, fenêtres contiguës et trous, séries chevauchantes, doublons,
libellés de décidécades, contrôle qualité par fiche, bandes larges reconstituées, loi mondiale au point
(cas analytique en eau profonde, trajet bloqué par la terre), profils fixes et quadrature. RAM est comparé à la solution analytique d’une source et
de son image sous une surface à pression nulle (tolérance 0,3 dB aux deux fréquences).

- [JOMOPANS-ECHO (2021)](https://www.mdpi.com/2077-1312/9/4/369).
- [RAM, guide de Michael Collins](https://oalib-acoustics.org/website_resources/PE/RAM.pdf) ; [PyRAM](https://github.com/marcuskd/pyram).
- [Basan et al. 2024, The underwater soundscape of the North Sea](https://eprintspublications.npl.co.uk/10094/) (stations, profondeurs, bruit d’écoulement).
- [ICES : accès aux données](https://underwaternoise.ices.dk/continuous/webservices) ; [archives AIS danoises](https://www.dma.dk/safety-at-sea/navigational-information/ais-data).
- Milieu régional à assembler : bathymétrie ETOPO existante, [sédiments EMODnet](https://emodnet.ec.europa.eu/en/geology), profils température/salinité [Copernicus Marine](https://data.marine.copernicus.eu/product/NWSHELF_MULTIYEAR_PHY_004_009/description).
