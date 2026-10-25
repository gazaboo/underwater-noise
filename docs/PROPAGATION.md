# Fronts acoustiques et temps commun

Correction du 16 octobre 2026. Le profil de pertes et les sources de référence v1 restent actifs.
Les tests numériques ci-dessous vérifient leur implémentation ; ils ne valident pas les portées
réelles en mer. Les résultats défavorables de la campagne hydrophones restent figés dans
[VALIDATION.md](VALIDATION.md).

## Ce que représente l’image

Une grille acoustique à trois bandes fournit à la fois les fronts, les estimations de niveaux,
la lueur d’accumulation et le bruit utilisé par les cétacés. L’ancienne grille visuelle et sa
simulation de détail indépendante ont été supprimées. Le zoom interpole le même champ.

La bande affichée se choisit dans le panneau P : 10–40 Hz par défaut, 100–500 Hz ou 1–10 kHz.
Dans cette bande, l’enveloppe de visibilité utilise :

`ΔL = 10 log10(1 + E_navires / E_fond_naturel)`.

Les énergies de tous les navires sont calculées ensemble. Cette enveloppe montre l’apport collectif
au fond naturel modélisé ; elle n’attribue pas individuellement un niveau reçu à chaque bateau.
Les fronts sont les variations du même champ, normalisées par son énergie pour dessiner les crêtes.
Il n’existe plus de seuil de niveau source qui retire arbitrairement des bateaux de ce calcul.

La visibilité vaut zéro jusqu’à +1 dB, puis `smoothstep(1, 10, ΔL)` jusqu’à +10 dB.
Ces deux bornes sont des conventions de lisibilité, sans signification biologique. La luminosité
s’applique après ce masque : elle ne peut révéler les zones en dessous du seuil. Couleur et relief
restent graphiques. L’espacement des anneaux est numérique, sans correspondance avec les oscillations
acoustiques réelles. Les anciennes impulsions artistiques ne pilotent plus l’injection.

## Temps, mètres et stabilité

- Célérité de référence : **1 500 m/s**, approximation uniforme de l’eau de mer, pas un profil
  océanographique mesuré.
- Une horloge serveur alimente fronts, navires, déplacements et cycles des cétacés, réponses,
  états des liens et accumulation. Le facteur `playback.timeScale` va de ×1 à ×100, initialement ×1.
- L’AIS direct impose ×1 ; le facteur choisi est conservé pour les replays et sources synthétiques.
  Aucun futur AIS n’est inventé. Les scénarios GFW restent synthétiques.
- Les sources synthétiques avancent par pas d’une seconde simulée ; les cétacés par pas de 0,1 s.
  Les fractions restantes sont conservées, quelle que soit la cadence d’affichage.
- Le pas du solveur vaut `Δt = 0,14 × Δx / 1500`. À 1024×512, une cellule mesure environ 39,09 km
  en latitude et un pas environ **3,65 s simulées**.
- Les différences spatiales d’ordre 4 en mer réduisent la dispersion numérique. Près d’une cellule
  terrestre, le schéma redevient d’ordre 2 pour ne pas sauter une barrière d’une cellule. Le pas
  est stable sur tout le domaine ±79°, sans ralentissement artificiel avec la latitude.
- La « réfraction sur les plateaux » artistique a été retirée. Le modèle conserve l’absorption,
  l’étalement, les pertes au fond et la coupure modale ; il ne calcule pas la vraie réfraction 3D.
- Le rendu interpole les états précédents et courants : il conserve un retard numérique maximal
  d’un pas. Le solveur n’avance pas vers un état futur pour rendre l’image plus fluide.

Un changement de vitesse ne redémarre pas l’histoire. Le serveur ferme d’abord l’intervalle à
l’ancienne vitesse et annonce immédiatement la nouvelle. Les instantanés suivants ne recalent pas
brutalement l’horloge : les variations de délai réseau ne doivent pas modifier la vitesse des fronts. Une bascule de source, une boucle de replay,
une reconnexion ou une suspension prolongée de l’onglet réinitialise les états liés à l’histoire.
Un identifiant de chronologie est transmis dans les quatre octets auparavant réservés de l’en-tête
binaire ; sa taille et sa version restent compatibles avec les lecteurs anciens qui les ignoraient.
Les paquets contenant un temps ou un facteur non fini, ou un facteur hors de ×1–×100, sont refusés.

Les enveloppes et rythmes des appels synthétiques suivent le facteur temporel ; changer de facteur
interrompt brièvement les appels audio en cours pour annuler leurs événements programmés à l’ancienne
vitesse. Les niveaux sources, les fréquences des bandes et les vitesses physiques ne sont pas
multipliés dans les calculs acoustiques.

## Réglages anciens et interfaces

`playback.timeScale` et `waves.band` sont appliqués et enregistrés par l’API de configuration
existante. Les anciens `waves.courant`, `damping`, `pulse`, `amplitude`, `shallowSpeed`, `coastDamping`
et `polarCapLat` sont ignorés. Les anciens facteurs `simulation.timeScale`, `estimated.timeScale`,
`replay.speed` et `whales.timeScale` sont neutralisés : aucune multiplication supplémentaire.
Les anciens paramètres de grille visuelle et de détail n’influencent plus le calcul.

Le serveur accepte `VACARME_CONFIG_DIR` pour charger un dossier de configuration distinct, notamment
lors des vérifications. Par défaut, il utilise toujours le dossier `config` du projet.

## Vérifications reproductibles

```sh
npm test
npm run typecheck
npm run build
npm run test:propagation
```

Le dernier contrôle exige Chromium installé. L’exécutable par défaut est `/usr/bin/chromium-browser` ;
`CHROMIUM_PATH` permet de préciser un autre chemin Chromium. Le script ouvre ses propres ports locaux,
crée une configuration temporaire, utilise 200 navires simulés et quelques groupes de cétacés,
désactive l’AIS réel et l’enregistrement, puis ferme les serveurs. Il ne modifie pas la configuration
d’exposition ni les résultats de la campagne scientifique.

Les sorties vont dans `/tmp/vacarme-propagation-results` ; `VACARME_TEST_ARTIFACTS` change ce dossier.
`VACARME_TEST_URL` permet de tester un serveur de développement déjà ouvert : les contrôles sur un
serveur externe ne changent pas sa configuration et omettent le test d’écriture du facteur ×10.

Les contrôles couvrent :

- paquets mobiles analytiques à 0°, 45° et 70° : distance après environ une minute, sur une grille
  de test de 5 km par cellule ; tolérance d’une cellule, distincte de la grille de l’œuvre ;
- dispersion du paquet de six cellules utilisé par le modèle, absorption des trois bandes et
  supplément de pertes sur un plateau uniforme de 100 m ;
- somme des énergies de deux sources à phases différentes, dans une moyenne numérique longue ;
- absence d’énergie transmise à travers une barrière terrestre d’une cellule ;
- pixels réellement noirs sous +1 dB même à luminosité 20, fronts visibles au-dessus du seuil et
  absence de fuite entre bandes ;
- calibration numérique au démarrage, verrou ×1 avec un statut direct injecté dans l’interface
  (sans connexion AIS), changement réel du facteur à ×10 par le curseur,
  conservation du champ au zoom et dans les cinq projections, absence d’erreur WebGL ;
- horloge, interruptions, migration des réglages, identité des trajectoires et cycles à durée
  simulée égale dans les tests unitaires.

## Résultats numériques conservés

[Rapport Chromium](propagation/verification.json) et [capture des réglages](propagation/fronts-reglages.png),
obtenus avec du trafic synthétique de test. Ces résultats [C] ne sont pas des mesures en mer.

| Contrôle | Résultat [C] |
|---|---|
| Paquet large, distance attendue 89,600 km après 59,733 s | 89,601 km à 0° ; 89,569 km à 45° ; 89,583 km à 70° |
| Paquet numérique de six cellules après 119,933 s | 174,907 km pour 179,900 km attendus ; retard résiduel de 2,78 % |
| Absorption profonde, écart au calcul des pertes | moins de 0,03 dB dans les trois bandes sur cette scène |
| Plateau uniforme de 100 m | 14,23 dB de perte supplémentaire dans la bande basse sur cette scène |
| Barrière terrestre d’une cellule | aucune énergie mesurée au-delà dans ce contrôle |
| Deux sources, moyenne numérique longue de 1000 pas | écart de +0,68 dB à la somme des énergies séparées ; ne valide pas la moyenne de 6 s |
| Calibration en 1/r sur 18–96 cellules | écart maximal de 0,38 dB sur la plage d’ajustement |
| Curseur réel porté à ×10 | facteur mesuré ×10, histoire conservée, un seul enregistrement de configuration |
| Bande non sélectionnée et énergie sous le seuil | pixels noirs, même à luminosité 20 |
| Zoom et cinq projections | même champ conservé ; aucune erreur WebGL |

La durée de 59,733 s correspond aux pas entiers effectués sur la grille de test de 5 km par cellule.
La cellule de l’œuvre reste d’environ 39 km. Le résultat du paquet large ne supprime pas le retard
résiduel mesuré pour le paquet court, ni les erreurs de champ proche et de côte.

Le suivi scientifique est ouvert dans l’[issue #8](https://github.com/gazaboo/underwater-noise/issues/8),
complément de l’[issue #6](https://github.com/gazaboo/underwater-noise/issues/6).

## Limites qui restent à traiter

La grille de référence est très grossière, surtout dans les détroits et en champ proche.
Le domaine au-delà de ±79° est non calculé. Les frontières côtières et les vitesses sous-marines
réelles restent simplifiées. Un affichage fin ne crée aucune information physique supplémentaire.

La calibration K reproduit une loi en 1/r dans une scène numérique idéale et lointaine. Elle ne
corrige pas les erreurs de la loi de propagation, du fond naturel, du trafic manquant ou du milieu.
Le test ancien aux hydrophones a échoué et ne devient pas favorable du fait de cette correction.

La moyenne d’énergie de 6 s **de scène** est courte par rapport à la porteuse numérique de six cellules
(environ 156 s par cycle sur la grille mondiale). La décorrélation de plusieurs sources, les
transitoires et l’équivalence entre ce champ grossier et une vraie énergie acoustique doivent donc
être étudiés. Une bonne vérification d’absorption ne suffit pas à démontrer cette équivalence.

L’historique avant le premier instantané est inconnu. Le démarrage du champ n’est pas la mise en
marche réelle des moteurs : la légende conserve « historique acoustique incomplet ». Une zone sombre
peut être sous le seuil, mal observée, hors domaine ou insuffisamment initialisée ; elle ne prouve
pas le silence. Il n’y a pas de rayon universel imposé pour raccourcir artificiellement les portées :
si le modèle prévoit une contribution lointaine, elle reste une estimation à évaluer scientifiquement.
