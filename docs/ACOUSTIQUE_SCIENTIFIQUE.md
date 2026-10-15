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

Le contrôle de convergence compare des pas distance/profondeur divisés par deux et une quadrature
fréquentielle à 5 puis 10 points. Ce dernier contrôle emploie un spectre plat. `maxDifferenceDb ≤ 1`
indique une convergence contrôlée, **pas une validation physique**. Les benchmarks JOMOPANS complets
restent à intégrer avant de revendiquer leur vérification.

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

```bash
tools/.venv-science/bin/python tools/science/data.py catalog --year 2019 --out /tmp/ices-2019.json
tools/.venv-science/bin/python tools/science/data.py download 1673 /tmp/ices-1673.h5
tools/.venv-science/bin/python tools/science/data.py inspect /tmp/ices-1673.h5
tools/.venv-science/bin/python tools/science/ices.py /tmp/ices-1673.h5 station.json observations.csv
tools/.venv-science/bin/python tools/science/validate.py \
  data/science/north-sea.json observations.csv /tmp/validation.json
```

Accès testé le 15/10/2026 : catalogue consultable ; relevé `WST_2019_10.h5`, station ICES 13559, du
01/10/2019 au 02/10/2019, téléchargé et lu (54 000 fenêtres de 1 s, 34 bandes, métadonnée de calibration
`CPC`). La hauteur indiquée de 1 m est **au-dessus du fond**, pas une profondeur de réception de 1 m.
Il reste à assembler coordonnées/profondeur de déploiement, historique AIS et météo correspondants.
Les archives danoises ne couvrent pas seules toute la mer du Nord. Les données téléchargées restent
hors du dépôt ; leurs conditions sont conservées dans un fichier `.policy.txt` adjacent.

`station.json` fournit `station`, `lat`, `lon`, `receiverDepthM`, `timestampConvention` (`start`/`end`)
et `source` (référence de déploiement). L’export accepte les SPL de 1 s, retient les minutes complètes,
moyenne les énergies et laisse les lignes `quality=unreviewed`. Calibration, bruit de courant, intégrité
et indépendance doivent être contrôlés avant de marquer les lignes utilisables `accepted`.

Le CSV de validation comporte `station,start,end,bandHz,lat,lon,receiverDepthM,observedDb,split,quality`.
Seules les lignes `split=holdout,quality=accepted` sont comparées ; les données d’ajustement restent
`calibration`. Période exacte, bande, position et profondeur doivent correspondre. Une moyenne en
profondeur n’est pas comparée à un hydrophone ponctuel. Le rapport publie effectif, biais, RMSE, médiane
et quantiles des écarts par station/bande, avec les empreintes des entrées. Il n’attribue aucun certificat
de précision ; l’application reste signalée comme non validée.

## Vérifications et références

```bash
npm test
npm run typecheck
npm run build
tools/.venv-science/bin/python -m unittest discover -s tools/science -p 'test_*.py' -v
```

Les tests couvrent sommation énergétique, moyenne temporelle, données manquantes, profils fixes,
compatibilité des récepteurs et quadrature. RAM est comparé à la solution analytique d’une source et
de son image sous une surface à pression nulle (tolérance 0,3 dB aux deux fréquences).

- [JOMOPANS-ECHO (2021)](https://www.mdpi.com/2077-1312/9/4/369).
- [RAM, guide de Michael Collins](https://oalib-acoustics.org/website_resources/PE/RAM.pdf) ; [PyRAM](https://github.com/marcuskd/pyram).
- [JOMOPANS : mesures en mer du Nord](https://eprintspublications.npl.co.uk/10094/).
- [ICES : accès aux données](https://underwaternoise.ices.dk/continuous/webservices) ; [archives AIS danoises](https://www.dma.dk/safety-at-sea/navigational-information/ais-data).
- Milieu régional à assembler : bathymétrie ETOPO existante, [sédiments EMODnet](https://emodnet.ec.europa.eu/en/geology), profils température/salinité [Copernicus Marine](https://data.marine.copernicus.eu/product/NWSHELF_MULTIYEAR_PHY_004_009/description).
