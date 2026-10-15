# La carte du vacarme — dossier de revue scientifique

> Mise à jour : le profil physique de référence est désormais fixe et une chaîne RAM régionale distincte
> a été ajoutée. Voir [ACOUSTIQUE_SCIENTIFIQUE.md](ACOUSTIQUE_SCIENTIFIQUE.md). Les chiffres ci-dessous
> décrivent le moteur mondial historique ; ils ne valident pas le nouveau moteur régional.

Ce document recense **tout** ce que l'œuvre calcule, affiche ou fait entendre, et pour chaque élément
**d'où il vient**. Il est écrit pour une relecture critique avant un usage de vulgarisation : il doit
permettre de distinguer, sans ambiguïté, ce qui est mesuré ou publié de ce qui est approximé, réglé à
la main ou inventé.

Rédigé par l'assistant de développement (Claude) à la fin du jalon J6, le 15 octobre 2026, puis mis à jour
le même jour après correction des points 1 à 3 de la §11 (bruit naturel, perte empirique, cohérence des
pertes entre le champ et les cétacés). Les valeurs mesurées l'ont été ce jour-là, sur la machine
d'exposition, avec le flux AIS réel.

---

## 0. Légende des statuts

Chaque paramètre, équation ou affirmation porte un statut :

| Statut | Signification |
|---|---|
| **[S] Sourcé** | équation ou valeur reprise d'une source primaire **que j'ai lue** (ou d'un jeu de données officiel) ; la référence est donnée |
| **[S-r] Sourcé (résumé)** | valeur vérifiée sur le résumé ou une notice de l'article (via une recherche), **article complet non lu** : à confirmer sur le texte |
| **[L] Littérature générale** | relation ou ordre de grandeur classique d'acoustique sous-marine, cité de mémoire, **non revérifié** sur la source pour ce projet |
| **[C] Calculé / mesuré** | valeur produite par le projet lui-même (calibration, test, relevé), reproductible |
| **[E] Empirique** | réglage choisi par moi pour obtenir un comportement ou un ordre de grandeur jugé plausible, **sans source** |
| **[A] Artistique** | choix esthétique ou de mise en scène, **sans prétention scientifique** |
| **[!] Non vérifié / douteux** | affirmation que je n'ai pas pu confirmer, ou dont je sais qu'elle est fragile |

Règle de lecture : seul ce qui est **[S]** ou **[C]** peut être présenté au public comme un fait ;
**[S-r]** et **[L]** comme des ordres de grandeur « selon la littérature » après vérification ; **[E]** et
**[A]** ne doivent jamais être présentés comme des mesures.

---

## 1. Synthèse pour la vulgarisation

### Ce que l'œuvre montre de défendable

- **Les navires sont réels** (mode direct) : positions, vitesses et types issus de l'AIS (aisstream.io),
  avec les limites de cette source (§3.1). **[S]** pour les données, avec biais documentés.
- **Le bruit rayonné par chaque navire est estimé par un modèle publié et validé** (JOMOPANS-ECHO,
  MacGillivray & de Jong 2021) à partir de son type, de sa vitesse et de sa longueur ; incertitude
  annoncée par les auteurs : ±6 dB. **[S]**
- **Le bruit se propage, s'atténue avec la distance et ne traverse pas les continents** : la loi
  utilisée (sphérique puis cylindrique, plus absorption) est une approximation classique, et le code la
  reproduit à moins de 1 dB près au-delà de ~700 km de la source, 2 à 3 dB près plus près (§4.4). **[L]+[C]**
- **Le bruit des navires réduit la distance à laquelle un cétacé peut être entendu** (masquage) : le
  principe, l'équation du sonar et la notion d'espace de communication sont publiés (Clark et al. 2009 ;
  Erbe et al. 2016). **[S-r]**
- **Les niveaux sources des appels** du rorqual bleu, du rorqual commun, de la baleine à bosse, du
  cachalot et de l'orque sont repris de mesures publiées (§6.1). **[S-r]**
- **Les aires de répartition** des espèces sont les cartes AquaMaps ; les positions de départ des groupes
  proviennent en partie d'observations réelles (OBIS). **[S]** pour les données.

### Ce qu'il ne faut pas dire (ou seulement avec la mise en garde)

- « Ce sont les vraies ondes sonores » : **non.** Les cercles lumineux sont une **image** (grille
  visuelle, §7.1) ; leur vitesse, leur longueur d'onde et leur persistance sont artistiques. **[A]**
- « Voici le niveau de bruit mesuré ici » : **non.** Ce sont des **estimations de modèle** ; elles
  n'ont pas été confrontées à des mesures (§4.6). Ordre d'incertitude probable : ±10 dB ou plus.
- « Ces baleines sont là, maintenant » : **non.** Les groupes sont des **présences simulées plausibles**,
  placées dans des habitats réels et près d'observations réelles, mais ce ne sont pas des animaux suivis
  (§6.7). Leur déplacement est accéléré ×30. **[A]**
- « Un rorqual bleu s'entend à 2 000 km » : **à éviter.** En eau profonde, le modèle donne ~1 800–2 400 km
  pour les rorquals dans un océan **sans aucun navire** (borne haute, étalement cylindrique), bien au-delà des
  détections publiées dans l'océan bruyant actuel (bleu localisé jusqu'à 200 km, commun suivi jusqu'à
  56 km ; Širović et al. 2007). Parler plutôt du **rapport** entre portée actuelle et portée sans navires
  (§6.4). **[!]**
- « Les orques / cachalots ont un espace de communication de cette taille » : **non.** Leurs distances
  sont **exagérées à l'écran** (×60 et ×40), sinon invisibles à l'échelle du globe (§6.7). **[A]**
- « Les zones sombres sont calmes » : **pas forcément.** La haute mer est mal couverte par l'AIS terrestre ;
  un navire non capté ne fait pas de bruit dans l'œuvre (§3.1). C'est précisément le sens de la
  « terra incognita » (§7.3), mais il faut le dire.
- Le **son** est une traduction musicale (§8), pas une écoute d'hydrophone. **[A]**

### Ordre de grandeur de l'incertitude totale (estimation, non quantifiée formellement)

Niveau source ±6 dB **[S]** + propagation (loi simplifiée, grille de 39 km, pas de profil de célérité,
fond calé sur une règle d'usage) ±5–10 dB **[!]** + couverture AIS (navires manquants : biais vers le bas,
non borné) **[!]** + bruit naturel : modèle empirique publié, mais vent fixé (5 m/s) alors qu'il varie
(±5 dB en bandes moyenne et haute entre 3 et 10 m/s) **[C]**. Il serait trompeur d'afficher plus d'un chiffre
significatif à la dizaine de décibels près.

---

## 2. Chaîne de calcul

```
AIS (aisstream.io, ou replay, ou simulation)
  │  lecture, contrôle de validité, fusion position + type + longueur, extrapolation 30 min max   §3.1
  ▼
Niveau source par navire et par bande : JOMOPANS-ECHO                                           §4.2–4.3
  ▼
Champ physique (GPU, 1024×512 ≈ 39 km) : équation des ondes 2D amortie, 3 bandes,               §4.4
  sources incohérentes, absorption de Thorp, pertes plateau et fond, calibration → dB re 1 µPa
  ▼                          ▼                                   ▼
Bruit naturel ajouté §4.5   Lueur d'accumulation (affichage) §4.7   Cétacés : équation du sonar §6
                                                                     espace de communication, liens
  ▼
Rendu : ondes visibles (grille visuelle, artistique) §7, globe / demi-sphère §9 ; son §8
```

Fichiers principaux : `shared/src/acoustics/` (modèles), `client/src/sim/physics-sim.ts` (champ
physique), `client/src/whales/` (cétacés), `config/default.json5` (tous les paramètres, commentés).

---

## 3. Données

| Donnée | Source | Version / date | Licence | Traitement | Statut |
|---|---|---|---|---|---|
| AIS en direct | aisstream.io (WebSocket) | flux du jour | conditions d'aisstream **[!]** non lues en détail | voir §3.1 | [S] données, biais §3.1 |
| AIS historique (replay d'exemple) | Autorité maritime danoise, aisdata.ais.dk | 26/02/2025, 1re heure | données ouvertes (loi danoise sur la réutilisation des informations publiques) **[!] conditions exactes non confirmées** | une position / navire / 60 s ; vitesses > 60 nœuds ignorées | [S] |
| Bathymétrie | ETOPO 2022 v1, 60″, « bed » (NOAA NCEI) | 2022 | domaine public | pas de 0,05°, moyenne par surface | [S] |
| Trait de côte | Natural Earth 1:10m land | v5 | domaine public | rastérisé, sur-échantillonné ×4 | [S] |
| Détroits ouverts de force | liste manuelle (20 détroits) | — | — | sinon fermés à 20–40 km de résolution | [E] |
| Routes (simulation) | `searoute` 1.6.0 (réseau marnet ORNL / Eurostat) | — | Apache-2.0 / EUPL | densifiées tous les 40 km | [S] réseau |
| Ports et poids de trafic (simulation) | liste manuelle de 75 ports | — | — | modèle gravitaire, grandes lignes ajoutées | **[A]** |
| Habitats des cétacés | AquaMaps « native range », base du paquet R aquamapsdata (archive.org) | téléchargée le 15/10/2026 | CC-BY-NC 3.0 | grille 0,5° ; lissage gaussien σ = 0,8 cellule | [S] ; AquaMaps prévient que les cartes ne sont pas toutes relues par des experts |
| Observations | OBIS (api.obis.org) | occurrences depuis 2015, tirées le 15/10/2026 | selon jeu de données (liste et licences dans `data/habitats/sightings.json`) | une par cellule de 0,25°, 400 tirées au hasard par espèce | [S] |

### 3.1 AIS : traitement et biais (`server/src/ais/`)

| Élément | Valeur | Statut | Commentaire |
|---|---|---|---|
| Valeurs « non disponible » | lat 91, lon 181, vitesse 102,3, cap 360, cap vrai 511 | [S] norme AIS (ITU-R M.1371) **[L]** non relue | — |
| Vitesse aberrante | > 60 nœuds ignorée | [E] | le flux réel contient des vitesses déclarées proches de 100 nœuds |
| Longueur | A + B, si 1–500 m | [E] bornes | longueur inconnue → longueur moyenne de la classe (Table 1 J-E) [S] |
| Extrapolation | ligne droite au dernier cap et vitesse, 30 min au plus, puis immobile | [E] | ne suit pas les routes |
| Oubli d'un navire | 3 h sans message | [E] | |
| Navires à quai | vitesse < 0,5 nœud : non envoyés à l'affichage ; dans le champ physique : niveau J-E − 10 dB | [E] | |
| Couverture | aisstream repose sur des récepteurs côtiers (portée ~60 milles) | **[!]** affirmation générale sur l'AIS terrestre, non vérifiée pour aisstream en particulier | biais majeur : haute mer sous-représentée |
| Carte de couverture | score par cellule de 1°, +0,25 par message (voisines +30 %), demi-vie 12 h | [A] indicateur | mesure « où l'on a vu des navires », pas la portée des récepteurs |

---

## 4. Bruit des navires

### 4.1 Classes de navires (`shared/src/ais/ship-class.ts`) — [S]

Correspondance type AIS → classe JOMOPANS-ECHO selon la Table 1 de l'article (lue) : pêche (30),
remorqueur (31, 32, 52), militaire (35), plaisance (36, 37), gouvernement/recherche (51, 53, 55),
croisière (60–69, l > 100 m), passagers (60–69, l ≤ 100 m), vraquier (70, 75–79, V ≤ 16 nœuds),
porte-conteneurs (71–74 ; 70, 75–79 si V > 16 nœuds), pétrolier (80–89), drague (33), autres.
Les rouliers ne sont pas identifiables par l'AIS (indiqué par l'article) : ils n'apparaissent qu'en simulation.

### 4.2 Niveau source : JOMOPANS-ECHO (`shared/src/acoustics/jomopans-echo.ts`) — [S]

MacGillivray, A. & de Jong, C. (2021). *J. Mar. Sci. Eng.* 9, 369. doi:10.3390/jmse9040369.
**Lu** : équations (9), (10), (11), Table 1, figures 3 à 7 (PDF de l'éditeur, pages 4 à 11).

- L_S(f, V, l, C) = L_S0(f, C) + 60·log10(V/V_C) + 20·log10(l/l0), l0 = 300 pieds. [S]
- Spectre de référence, constantes K = 191 dB, D = 3 (croisière 4), f1 = 480 Hz × (1 nœud / V_C) ;
  pic basse fréquence des navires de charge K^LF = 208 dB, f1^LF = 600 Hz × (1 nœud / V_C),
  D^LF = 0,8 ou 1,0. [S]
- Conversion en bandes décidécades : + 10·log10(0,231·f). [S]
- V_C et longueurs moyennes : Table 1. [S]
- Validation des auteurs : 1 862 mesures (programme ECHO, 2017), écart-type des résidus ≈ 6 dB entre
  20 Hz et 20 kHz ; source supposée à 6 m de profondeur. [S]
- **Vérification [C]** (`shared/test/acoustics.test.ts`) : nos courbes reproduisent la figure 7 de
  l'article à ±3 dB (lecture graphique) pour 4 navires types.

Ajouts du projet :

| Élément | Valeur | Statut | Raison |
|---|---|---|---|
| Vitesse minimale | 0,5 nœud | [E] | éviter log(0) |
| **Vitesse maximale** | 3 × V_C | **[E]** | hors domaine d'ajustement, la loi en 60·log V diverge (remorqueur à 12 nœuds : +30 dB) ; borne non sourcée, à discuter |

### 4.3 Bandes d'analyse (`config/default.json5`, `bands`) — [A] pour le choix, [S] pour le calcul

| Bande | Fréquences | Justification | Statut |
|---|---|---|---|
| basse | 10–40 Hz | appels des rorquals bleus et communs (15–29 Hz, Širović et al. 2007) | choix [A], fréquences [S-r] |
| moyenne | 100–500 Hz | partie grave du chant de la baleine à bosse | [A] **[!]** : le chant s'étend bien au-delà |
| haute | 1–10 kHz | cris d'orque, codas de cachalot | [A] |

Niveau de bande = somme énergétique des décidécades dont le centre est dans la bande. [S] (méthode)
Fréquence représentative pour l'absorption : moyenne géométrique des bornes (20, 224, 3 162 Hz). [E]

### 4.4 Propagation (`client/src/sim/physics-sim.ts`, `shared/src/acoustics/propagation.ts`)

**Loi visée** : TL(r) = 20·log10(r_t) + 10·log10(r/r_t) + α·r (sphérique jusqu'à r_t, puis
cylindrique). **[L]** (approximation classique de manuel, p. ex. Urick, *Principles of Underwater
Sound* ; non revérifiée pour ce projet).

| Élément | Valeur | Statut | Commentaire |
|---|---|---|---|
| Distance de transition r_t | profondeur d'eau sous la source (≥ 10 m) | **[L]** | choix courant mais fragile en eau peu profonde (voir §6.4) |
| Méthode | équation des ondes 2D amortie sur la sphère (laplacien sphérique, schéma saute-mouton), grille 1024×512 (≈ 39 km par cellule en latitude) | [C] | en 2D, l'énergie d'une source continue décroît en 1/r : étalement cylindrique |
| Sources | porteuse de longueur d'onde 6 cellules (≈ 234 km), phase aléatoire (cohérence 24 pas) | [C] numérique | rend les sources incohérentes ; **la longueur d'onde de la grille n'a rien à voir avec la fréquence acoustique** |
| Amplitude injectée | a² = 10^((SL − 10·log10 r_t − L_ref)/10), L_ref = 150 dB | [C] | intègre la partie sphérique |
| **Calibration** | une source unité, eau profonde uniforme, sans absorption, 2 400 pas ; ajustement E(r) = K/r sur 18–96 cellules | **[C]** | **K = 1,4112 ; écart max 0,88 dB** sur la plage d'ajustement |
| Écart en champ proche | −3,2 dB à 2 cellules (78 km), −2,1 dB à 6 (235 km), −1,6 dB à 10 (391 km), −0,9 dB à 18 (704 km) | **[C]** | **le champ est sous-estimé de 2–3 dB à moins de ~250 km d'une source** ; en 2D, la loi en 1/r n'est atteinte qu'à quelques longueurs d'onde |
| Écart au loin | +0,4 dB à 80 cellules, −0,8 dB à 106 | [C] | bords de la grille de calibration |
| Moyenne d'énergie | constante de temps 6 s (temps réel) | [E] | fluctuation résiduelle ≈ ±1 dB [C, estimation] |
| Absorption | formule de Thorp : 0,11 f²/(1+f²) + 44 f²/(4100+f²) + 2,75·10⁻⁴ f² + 0,003 dB/km (f en kHz) | **[L]** | forme cohérente entre plusieurs sources secondaires ; article original (Thorp 1967) non lu. ≈ 0,003 / 0,008 / 0,25 dB/km pour nos 3 bandes [C] |
| Conversion absorption → amortissement | g = α·Δx·C / 8,686 par pas | [C] | approximation de faible amortissement ; non vérifiée numériquement séparément **[!]** |
| **Pertes au fond (eau peu profonde)** | perte par rebond × rebonds par km ; rebonds/km = 1000·tan θ/(2h) ; pleine sous 200 m, nulle au-delà de 400 m ; **0,09 dB/rebond à θ = 10°** → 0,08 dB/km par 100 m de fond, 0,16 par 50 m, 0,4 par 20 m | forme [L] (distance de saut d'un rayon, comme dans le modèle de Marsh-Schulkin) ; **valeur [C] calée** | seul le produit (perte × tan θ) compte. **Calé pour que la perte totale suive l'« étalement pratique » 15·log r à ±1,5 dB entre 10 et 50 km par 50–100 m de fond** (test `shared/test/ambient-losses.test.ts`). L'étalement pratique est lui-même une approximation d'usage (k = 1,5, défini p. ex. dans Lucani et al. 2008, **lu**), pas une mesure. Les bornes 200/400 m sont **[E]** (au-delà, la réfraction écarte les trajets du fond **[L]**) |
| Coupure modale | f_c ≈ c/(4h·√(1 − c²/c_b²)), c = 1 500, **c_b = 1 700 m/s** → ≈ 16 Hz par 50 m, 32 Hz par 25 m | [L] formule (guide de Pekeris, Jensen et al.) ; **[E]** c_b | sous la coupure : **5 dB/km [E]** (extinction en quelques km ; à la résolution de 39 km, cela équivaut à un mur pour la bande). Effet : en mer peu profonde (Malacca, Manche par endroits), la bande basse ne se propage plus |
| Perte supplémentaire | **0 dB/km** (paramètre conservé, désactivé) | — | **corrigé le 15/10** : la valeur de 0,004 dB/km, non sourcée, a été retirée. Conséquence : en eau profonde, l'étalement cylindrique pur s'applique, borne haute de l'efficacité de propagation |
| **Un seul modèle de pertes** | `lossRateDbPerKm()` (`shared/src/acoustics/propagation.ts`), transcrit à l'identique en GLSL (`LOSS_UNIFORMS_GLSL`) | [C] | **corrigé le 15/10** : le champ de bruit, l'espace de communication (pixel par pixel, 13 points le long du segment) et les liens (33 points le long de l'orthodromie) utilisent exactement les mêmes pertes |
| Côtes | cellules de terre à zéro ; amortissement 0,3 × fraction de terre | [E] | côtes absorbantes ; pas de réflexion réaliste |
| Pôles | au-delà de ±79° : mur (« banquise ») | [A] / contrainte numérique | la grille équirectangulaire devient instable vers les pôles |
| Non modélisé | profil de célérité, chenal SOFAR, zones de convergence et d'ombre, saisons, nature du fond, directivité des navires, profondeur des sources (sauf via r_t) | **[!]** | |

### 4.5 Bruit naturel — [S] modèle, [E] vent — **corrigé le 15/10**

Modèle empirique de densité spectrale (dB re 1 µPa²/Hz, f en kHz), **lu** dans Lucani, Stojanovic &
Médard (2008, arXiv:0801.0426, éq. 4–8), qui le reprennent de Stojanovic (2007) — lui-même tiré de
Coates (1990), ajustement des courbes de Wenz (ces deux dernières sources **non lues**) :

- turbulence : 17 − 30·log f ;
- vent : 50 + 7,5·w^½ + 20·log f − 40·log(f + 0,4), w en m/s ;
- agitation thermique : −15 + 20·log f ;
- trafic lointain : 40 + 20(s − 0,5) + 26·log f − 60·log(f + 0,03) — **exclu** : l'œuvre modélise les
  navires un par un ; l'inclure compterait le trafic deux fois. Conséquence assumée : là où l'AIS ne
  voit pas les navires, l'œuvre montre un océan plus calme que le réel (§3.1, terra incognita).

Niveaux de bande (intégration numérique, `shared/src/acoustics/ambient.ts`) pour **w = 5 m/s** (choix
[E] : mer modérée, haut de l'échelle 3 de Beaufort **[L]**) : **83,8 dB** (10–40 Hz, dominé par la
turbulence), **88,1 dB** (100–500 Hz) et **93,2 dB** (1–10 kHz), tous deux dominés par le vent. Sensibilité
[C] : bande basse 83,7–84,0 dB de 3 à 10 m/s ; bande moyenne 84,4–95,1 dB ; bande haute 89,4–100,1 dB.

Anciennes valeurs (de mémoire, **retirées**) : 88 / 88 / 92 dB — la bande basse était surestimée de
~4 dB. Les tests vérifient les composantes contre les équations et les niveaux de bande.

Limites : les courbes de Wenz sont indicatives (5–10 dB) et valables en eau profonde **[S-r]** (via une
source secondaire) ; pas de pluie, pas de glace, pas de bruits biologiques ; vent identique partout.

### 4.6 Niveaux obtenus — [C], non validés

Relevé du 15/10/2026 à 08:13 UTC, **après les corrections du 15/10** (bruit naturel du modèle, pas de
perte supplémentaire, pertes au fond calées), direct aisstream, 16 120 navires suivis (registre en cours
de reconstitution après un redémarrage, donc trafic incomplet). Niveaux de bande, dB re 1 µPa :

| Lieu | basse (10–40 Hz) | moyenne (100–500 Hz) | haute (1–10 kHz) |
|---|---|---|---|
| Manche (50° N, 2° O) | 115 | 124 | 117 |
| Mer du Nord (55° N, 3° E) | 120 | 118 | 112 |
| Méditerranée occidentale (38° N, 5° E) | 112 | 115 | 94 |
| Mer Ligure (43,6° N, 8,2° E) | 105 | 108 | 93 |
| Détroit de Malacca, dans le couloir (2,5° N, 101° E) | 100 | 100 | — |
| Malacca, 150 km au nord du couloir (3,5° N, 100° E) | 84 (= naturel) | 88 (= naturel) | 93 |
| Atlantique Nord (40° N, 35° O) | 96 | 98 | 93 |
| Golfe de Guinée (5° S, 0°) | 92 | 94 | 93 |
| Pacifique Nord (35° N, 160° O) | 88 | 89 | 93 |
| Océan Indien Sud (35° S, 75° E) | 86 | 88 | 93 (= naturel) |

Le cas de Malacca illustre le nouveau modèle : par 25–50 m de fond, la bande basse est sous la coupure
modale et ne se propage pas ; la bande moyenne perd ~24 dB sur 150 km par réflexions sur le fond. Le
bruit des mers peu profondes reste local — qualitativement attendu, quantitativement non vérifié.

**Ces niveaux n'ont été comparés à aucune mesure.** Ils dépendent fortement de la couverture AIS (le
Pacifique Nord et l'océan Indien ne « voient » presque aucun navire) et de l'heure. Attention : nos
bandes sont larges (somme de 6 à 10 décidécades), donc **plus élevées de ~8–10 dB** qu'un niveau en
une seule décidécade (63 ou 125 Hz) tel qu'en publient les cartes européennes.

Comparaisons suggérées : cartes JOMOPANS (mer du Nord, décidécades 63 et 125 Hz), NOAA SoundMap,
ShipNoiseView ; mesures d'hydrophones de la Manche ou de mer Ligure.

### 4.7 Accumulation (ce que l'on voit briller) — [A]

Niveau affiché = somme énergétique pondérée des bandes (0,45 / 0,4 / 0,15) [A], accumulé de façon
asymétrique : montée en 2 min, décrue en 20 min [A]. Lumière = smoothstep(95 dB, 125 dB)^1,3 [A].
**Les constantes de temps n'ont rien de physique** : elles servent la lecture de l'image.

---

## 5. Mode simulation (navires synthétiques) — [A] pour l'essentiel

Utilisé hors ligne ou en secours. Routes réelles du réseau marnet [S], mais **ports, poids de trafic,
nombre de navires (5 000), répartition des classes par type de port, dispersion latérale (25 km),
navires de pêche (12 %, errance autour d'un point du plateau)** : tous **[A]**. Vitesses de croisière :
V_C de la Table 1 J-E ± 10 % [S]+[E]. Temps accéléré ×20 [A]. **Ne jamais présenter le mode simulation
comme le trafic réel** (le diagnostic l'indique).

## 5 bis. Navires estimés (Global Fishing Watch) — [S] effectif et répartition, [E] mouvement

Ajouté le 15/10 (`server/src/sources/estimated.ts`, `density.ts`, `tools/build_presence.py`). Modes
`source.ships` : `real` (inchangé), `estimated` (uniquement des navires estimés), `mixed` (réels là où la
couverture AIS du flux direct ou du replay dépasse `source.coverageThreshold` = 0,15 [E], estimés ailleurs,
par cellules de 1°).

| Élément | Statut | Détail |
|---|---|---|
| Donnée | [S] | GFW, « AIS vessel presence » (`public-global-presence:latest`, v4.0) : une position par navire et par heure, AIS terrestre **et satellite**, cellules de 0,1°, en heures de présence. Période : 30 jours se terminant au dernier jour disponible (≈ 4 jours de retard), voir `data/density/meta.json` |
| Effectif par cellule | [S]+[C] | λ = heures de présence / (24 × 30) = nombre moyen de navires présents à un instant. Le nombre de navires estimés est Σ λ (sur la zone autorisée), **pas un réglage** |
| Navires en route seulement | [S] filtre / [E] seuil | filtre de vitesse GFW ≥ 2 nœuds : à quai ou au mouillage, un navire est quasi silencieux (J-E borne déjà sa vitesse à 0,5 nœud) |
| Vitesse | [S] | tranche tirée selon les heures de présence du groupe par tranche GFW (2–4, 4–6, 6–10, 10–15, 15–25, > 25 nœuds), uniforme dans la tranche |
| Classe J-E | [S] / **[L] ordre de grandeur** | `cargo`+`carrier` ≥ 15 nœuds → porte-conteneurs (même règle que la classification AIS, §4.1) ; < 15 nœuds → 60 % vraquiers / 40 % pétroliers ; passagers → 90 % ferries / 10 % croisière ; `support`, `bunker`, `other`, `seismic_vessel` → 60 % « autres » / 40 % remorqueurs : **ordres de grandeur non vérifiés** (GFW ne distingue pas ces types). Longueur : moyenne J-E de la classe ± log-normale σ = 0,25 [E] |
| Mouvement | **[E]** | synthétique : le navire suit les couloirs de densité (choix de cap tous les 5 km parmi ±0/20/40°, densité à 15 et 30 km), renaît ailleurs (tirage ∝ λ) après une durée de vie exponentielle de moyenne 24 h simulées, s'il touche terre ou se perd. **Les trajectoires ne sont pas celles de vrais navires** |
| Effectif obtenu | [C] | période 11/09 → 11/10/2026 : **≈ 50 850 navires en route en moyenne** dans le monde — 13 300 cargos et assimilés (dont 1 800 à ≥ 15 nœuds), 6 250 navires à passagers, 12 650 navires de pêche, 18 650 autres (soutien, soutage, sismique, non classés). Ordre de grandeur cohérent avec la flotte mondiale (≈ 105 000 navires ≥ 100 GT selon la CNUCED [L], dont une partie à quai), mais non comparé formellement |
| Plafond | [A] technique | `estimated.maxShips` = 60 000 (au-dessus des ≈ 51 000 actuels) ; s'il est atteint, l'effectif est réduit et le diagnostic l'affiche (bruit alors sous-estimé) |
| Terra incognita | [A] | absente en modes `estimated` et `mixed` : le bruit n'y est plus sous-estimé par défaut d'observation |

Limites à dire au public :
- **Ce sont des navires « vraisemblables », pas les navires du moment** : la répartition et le nombre sont
  ceux d'une moyenne récente de 30 jours ; les positions individuelles et les routes sont inventées.
- Les navires **sans AIS** (« navires sombres », nombreux petits navires de pêche) ne sont pas comptés :
  le trafic, donc le bruit, reste **sous-estimé**, surtout près des côtes de certaines régions.
- La réception satellite de l'AIS est imparfaite dans les zones très denses (collisions de messages) :
  la présence y est sans doute sous-estimée.
- Échelle de 0,1° (≈ 11 km) et masque terre/mer de 0,18° : une partie des navires très côtiers (ports,
  chenaux) est replacée au large, faute de cellule de mer assez fine.
- Licence : usage non commercial, attribution obligatoire (voir `docs/SOURCES_DONNEES.md`).

---

## 6. Cétacés

### 6.1 Niveaux sources des appels — [S-r]

| Espèce | Valeur retenue | Source | Statut |
|---|---|---|---|
| Rorqual bleu | **189 dB** re 1 µPa à 1 m | Širović, Hildebrand & Wiggins 2007, *JASA* 122:1208 — 189 ± 3 dB (25–29 Hz), Antarctique | [S-r] |
| Rorqual commun | **189 dB** | même article — 189 ± 4 dB (15–28 Hz) | [S-r] |
| Baleine à bosse | **172 dB** | Au et al. 2006, *JASA* (doi 10.1121/1.2211547) — unités de chant 151–173 dB ; une autre plage, 171–189 dB, est attribuée à Au et al. 2001 **[!] non vérifiée** | [S-r], haut de fourchette |
| Cachalot (codas) | **161 dB** rms | Jacobs et al. 2024, *J. Exp. Biol.* (doi 10.1242/jeb.246442) — médiane 161 dB (IQR 153–167), espace actif médian ~4 km | [S-r] |
| Orque | **153 dB** | Miller 2006 — appels stéréotypés 152,6 ± 5,9 dB (1–20 kHz) ; Holt et al. 2011 *JASA* 130 : 135–176 dB | [S-r] |

**Correction du 15/10/2026** : jusqu'au J5, le projet utilisait 186 (bleu), 175 (cachalot) et 165 dB
(orque), choisis de mémoire ; la vérification a montré que 175 et 165 étaient trop élevés de 12 à 14 dB.
Les valeurs ci-dessus sont désormais celles de la configuration.

### 6.2 Autres paramètres d'appel — [E]

| Paramètre | Valeurs | Statut |
|---|---|---|
| Seuil de détection DT | 6 / 6 / 6 / 8 / 4 dB | **[E]** — devrait venir de rapports critiques / seuils publiés (Erbe et al. 2016 les recense) |
| Largeur de bande de l'appel | 5 Hz / 10 Hz / 100 Hz / 5 kHz / 2 kHz | **[E]** |
| Intervalle entre appels | 14 / 10 / 6 / 4 / 5 s | **[A]** (les vrais rythmes diffèrent ; les rorquals communs émettent des impulsions toutes les ~10–25 s **[L]**) |
| Correction de bruit bande → appel | NL_appel = NL_bande − 10·log10(B_bande / B_appel) | [L] suppose un spectre plat dans la bande **[!]** |

### 6.3 Équation du sonar et espace de communication

SE = SL − TL(r) − NL_appel − DT ≥ 0. **[L]** (forme passive standard ; principe d'analyse du masquage :
Clark et al. 2009, *MEPS* 395:201–222, doi 10.3354/meps08402 **[S-r]** ; revue : Erbe et al. 2016,
*Mar. Pollut. Bull.* 103:15–38, doi 10.1016/j.marpolbul.2015.12.007 **[S-r]**).

- TL : même loi et **mêmes pertes** que le champ (§4.4), avec r_t = profondeur sous l'**appelant** ;
  pertes intégrées le long du trajet réel (13 points pour l'espace affiché, 33 pour les liens).
  **Corrigé le 15/10** (auparavant, l'équation du sonar ignorait les pertes de plateau et de fond).
  Exception : le **rayon scalaire** (diagnostic, son) évalue les pertes au point du groupe seulement,
  faute de trajet défini « dans toutes les directions » **[E]**.
- Espace de communication (affiché) : pour chaque pixel, SE avec le bruit **en ce pixel** (récepteur
  hypothétique) ; ombre des terres testée sur 12 points du segment. [C] méthode, [L] principe.
- Rayon (diagnostic, son) : plus grande distance où SE ≥ 0 avec le bruit au point du groupe, par
  dichotomie ; lissé sur 1,5 s [A].
- **Asymétrie des liens** : « A entend B » utilise le bruit chez A — conséquence directe de l'équation
  du sonar, physiquement fondée. [L]

### 6.4 Portées obtenues — [C] et comparaison

Portées en océan **sans aucun navire** (bruit naturel §4.5, vent 5 m/s), calculées par le code après les
corrections du 15/10, en fonction de la profondeur sous le groupe (pertes évaluées à cette profondeur) :

| Espèce | 4 000 m | 1 000 m | 200 m | 100 m | 50 m | littérature |
|---|---|---|---|---|---|---|
| Rorqual bleu | 2 375 km | 3 714 km | 612 km | 379 km | 226 km | localisé jusqu'à 200 km (Širović et al. 2007) [S-r] |
| Rorqual commun | 1 790 km | 3 020 km | 552 km | 347 km | 209 km | suivi jusqu'à 56 km (même article) [S-r] |
| Baleine à bosse | 55 km | 173 km | 175 km | 141 km | 101 km | — |
| Cachalot | 1,3 km | 1,6 km | 6,1 km | 9,3 km | 12 km | espace actif médian ~4 km (Jacobs et al. 2024) [S-r] |
| Orque | 1,3 km | 1,6 km | 6,0 km | 9,2 km | 12 km | — |

Avec +20 dB de bruit (couloir de trafic), à 4 000 m : rorqual bleu 2 375 → 116 km ; commun 1 790 → 60 km ;
baleine à bosse 55 → 1,6 km [C].

Effets des corrections du 15/10 :
- **eau peu profonde** : les portées irréalistes ont disparu (bleu par 100 m de fond : 2 650 → 379 km),
  car les appels subissent désormais les pertes au fond et la coupure ;
- **eau profonde** : les portées des rorquals **augmentent** (bleu : 980 → 2 375 km), parce que la perte
  arbitraire de 0,004 dB/km a été retirée et que le bruit naturel de la bande basse est plus bas
  (83,8 au lieu de 88 dB).

**Conclusions honnêtes** :
1. En eau profonde, les portées des rorquals sont des **bornes hautes** pour un océan sans navires :
   étalement cylindrique pur, bruit naturel sans trafic lointain, DT choisi. Elles ne doivent pas être
   comparées directement aux distances de détection publiées, mesurées dans l'océan bruyant actuel.
   L'ordre de grandeur « des milliers de km avant l'ère industrielle » est une hypothèse ancienne de la
   littérature (Payne & Webb 1971 **[L], non relu**), à citer avec prudence.
2. **Non-monotonie** : la portée est plus grande par 1 000 m que par 4 000 m de fond, parce que r_t
   (transition vers le cylindrique) vaut la profondeur : c'est un artefact de cette convention **[!]**.
3. Pour le **cachalot**, l'ordre de grandeur reste cohérent avec la mesure de Jacobs et al. (1–12 vs ~4 km).
4. Le **rapport** « portée avec trafic / portée calme » est la grandeur la plus robuste à montrer : il
   dépend de l'écart de bruit et de la pente de TL, beaucoup moins des valeurs absolues.

### 6.5 Liens entre groupes — [A] pour la dynamique

Paires d'une même espèce à moins de 1,2 × la portée calme [E] ; pas de lien si l'orthodromie traverse
les terres [C]. Hystérésis ±2 dB, rupture en 5 s, reconnexion en 14 s, fantôme 3 min : **[A]**.

Indicateur « liens vivants / liens en océan sans navires » : définition [C], affiché tel quel ; il hérite
de toutes les approximations ci-dessus. Indicateur « appels entendus » : compte aussi les groupes isolés.

### 6.6 Appels et réponses — [A]

Un appel entendu reçoit une réponse quand l'impulsion lumineuse arrive (temps de trajet du fil, ~3 s, +
0,6 s) : **mise en scène**. Les vraies baleines ne répondent pas ainsi de façon systématique, et le son
ne met pas 3 s à parcourir des centaines de kilomètres (~1 500 m/s : ~10 min pour 1 000 km).

### 6.7 Groupes : où et combien — [A] sauf les données

| Élément | Valeur | Statut |
|---|---|---|
| Habitat | probabilité AquaMaps ≥ 0,35 (déplacements : ≥ 0,25) | données [S], seuil [E] |
| Départ | 70 % près d'une observation OBIS, 30 % tirés selon l'habitat | [A] |
| Nombre de groupes | 30 / 40 / 40 / 30 / 30 | **[A]** (aucun lien avec les effectifs réels) |
| Profondeur minimale | 200 / 100 / 20 / 1 000 / 10 m | [E] (le cachalot en eau profonde est [L]) |
| Vitesse | 5 / 6 / 5 / 4 / 8 km/h, accélérée ×30 | vitesses [L] ordres de grandeur, accélération [A] |
| Déplacement | marche aléatoire corrélée | [A] (ni migration, ni saison) |
| **Exagération visuelle** | ×1 / ×1 / ×4 / ×40 / ×60 | **[A]** — appliquée de façon cohérente (une distance d'écran d compte comme d / facteur dans le calcul) ; signalée dans le diagnostic |

---

## 7. Couche visuelle

### 7.1 Ondes visibles (grille visuelle) — **[A] intégralement**

Équation des ondes sur une grille de 2048×1024 (≈ 20 km), même méthode numérique que le champ physique,
mais **paramètres purement artistiques** : vitesse (0,45 cellule/pas, soit environ une traversée de
l'Atlantique en quelques secondes), longueur d'onde (7 cellules ≈ 140 km), impulsions (0,35 par
seconde), amortissement (persistance), amplitude selon le niveau source large bande (166–192 dB → 0–1,
compression ^1,7). L'interférence est une vraie interférence **entre ces ondes fictives**. La
« réfraction » sur les plateaux (vitesse réduite à 60 % en eau peu profonde) est une **analogie
visuelle** (elle ressemble à la réfraction des vagues, pas du son). **Rien de cette couche n'est un son
réel.**

Grille de détail au zoom (≈ 6 km par cellule à ×7) : même statut.

### 7.2 Lueur d'accumulation — mapping [A] d'un champ [C]

Voir §4.7. Couleur, seuils, courbe : [A].

### 7.3 Terra incognita — [A] d'un indicateur [C]

Zones où la carte de couverture (§3.1) est faible : assombries, brouillard et grain. Indique « l'AIS ne
voit rien ici », pas « il n'y a rien ici ».

### 7.4 Espaces de communication et fils — rendu [A] d'un calcul [C]

Remplissage, contour au seuil SE = 0, pointillés en terra incognita, couleur chaude : [A]. La **forme**
résulte du calcul §6.3.

---

## 8. Son — [A] intégralement

Traduction sensible, pas une auralisation :
- **navires** : 12 voix au plus, attribuées aux plus forts de la vue (niveau source − 18 dB entre centre
  et bord de la vue) ; timbre par classe inventé (fondamental ≈ 20 + 2 000 / longueur Hz, pulsation
  « d'hélice », cavitation, génératrice), transposé de 2 octaves ;
- **nappe** : bruit brun dont le niveau suit le niveau de la bande basse dans la vue ;
- **cétacés** : appels **synthétisés** d'après les plages de fréquences réelles (rorquals transposés ×5) ;
  formes et rythmes inventés ; le « masquage » (filtrage, hachage) est une métaphore de la réduction de
  portée, pas une simulation psychoacoustique.

Niveaux de sortie mesurés [C] : −18,5 dBFS RMS en vue mondiale, aucun écrêtage, aucun clic.

---

## 9. Globe et projection — [S] géométrie, [A] mise en scène

- Projection d'une sphère unité par lancer de rayons ; caméra = projecteur réel (d/R, rapport de
  projection, décalage d'objectif) : géométrie exacte, vérifiée par des tests (`client/test/globe.test.ts`). [C]
- Compensation de luminosité en 1/cos(incidence), plafonnée : suppose une surface **lambertienne**
  éclairée en incidence oblique. [L] ; plafond et dosage [E].
- Rotation (12 min par tour), latitude présentée (25° N), ralentissements sur la Manche et Malacca : [A].
- Le son suit la face visible : [A].

---

## 10. Vérifications réalisées et ce qu'elles prouvent

| Vérification | Prouve | Ne prouve pas |
|---|---|---|
| 71 tests automatiques (`npm test`) | implémentation conforme aux équations (J-E ±3 dB / figure 7, Thorp, TL, sonar, liens, AIS, géométrie) | que les équations sont adaptées |
| Calibration (0,88 dB) | la grille reproduit 10·log r au loin | la validité de 10·log r en mer réelle |
| Relevés de niveaux (§4.6) | ordre de grandeur des sorties | leur exactitude (aucune comparaison à des mesures) |
| Vérification des niveaux d'appel (§6.1) | valeurs dans les plages publiées | articles complets non lus |
| Scène `?scene=duo` | la dynamique des liens (asymétrie, rupture, fantôme) fonctionne sur du trafic réel | — |
| Enregistrement audio | absence d'écrêtage et de clics | — |

---

## 11. Points faibles, par priorité de correction

1. ~~Bruit naturel non vérifié~~ — **corrigé le 15/10** : modèle empirique publié (§4.5) ; reste le choix
   du vent (5 m/s, uniforme) **[E]**.
2. ~~Perte empirique de 0,004 dB/km~~ — **corrigé le 15/10** : retirée. Reste l'optimisme de l'étalement
   cylindrique en eau profonde (§6.4), désormais affiché comme borne haute.
3. ~~Équation du sonar sans pertes de fond~~ — **corrigé le 15/10** : un seul modèle de pertes pour le
   champ et les cétacés, intégré le long du trajet ; pertes au fond **calées** sur l'étalement pratique
   15·log r (la règle de référence elle-même reste une approximation d'usage).
4. **Seuils DT et largeurs de bande des appels (§6.2)** non sourcés.
5. **Niveaux calculés jamais confrontés à des mesures (§4.6).**
6. **Couverture AIS** : biais non quantifié vers le bas en haute mer.
7. **Champ proche** sous-estimé de 2–3 dB à moins de ~250 km d'une source (§4.4).
8. Borne de vitesse à 3 × V_C (§4.2) : raisonnable mais arbitraire.
9. Bandes larges : niveaux non comparables directement aux cartes en décidécades (§4.6).

---

## 12. Bibliographie et statut de vérification

| Référence | Utilisée pour | Statut |
|---|---|---|
| MacGillivray & de Jong 2021, *J. Mar. Sci. Eng.* 9:369, doi 10.3390/jmse9040369 | niveau source des navires | **lue** (PDF, pages 3–15) |
| Širović, Hildebrand & Wiggins 2007, *JASA* 122:1208–1215, doi 10.1121/1.2749452 | SL rorquals bleu et commun ; distances de détection | résumé vérifié |
| Au et al. 2006, *JASA*, doi 10.1121/1.2211547 | SL baleine à bosse | notice vérifiée |
| Jacobs et al. 2024, *J. Exp. Biol.*, doi 10.1242/jeb.246442 | SL des codas de cachalot, espace actif | résumé vérifié |
| Miller 2006 (orques résidentes, *active space*) | SL orque | résumé vérifié ; **revue exacte à confirmer** |
| Holt, Noren & Emmons 2011, *JASA* 130:3100 | plage de SL orque | résumé vérifié |
| Clark et al. 2009, *MEPS* 395:201–222, doi 10.3354/meps08402 (corrigendum 2016, *MEPS* 554:281) | espace de communication, masquage | résumé vérifié ; corrigendum non lu |
| Erbe et al. 2016, *Mar. Pollut. Bull.* 103:15–38, doi 10.1016/j.marpolbul.2015.12.007 | masquage, seuils | résumé vérifié (accès libre) |
| Lucani, Stojanovic & Médard 2008, arXiv:0801.0426 | modèle de bruit ambiant (éq. 4–8), formule de Thorp (éq. 2), définition de l'étalement pratique (k = 1,5) | **lu** (pages 1–3) |
| Stojanovic 2007 ; Coates 1990 (*Underwater Acoustic Systems*) | origine du modèle de bruit ambiant | **non lus** (cités par Lucani et al.) |
| Thorp 1967 (*JASA*) | absorption | **non lu** ; formule identique dans Lucani et al. 2008 (lu) |
| Wenz 1962 ; Knudsen, Alford & Emling 1948 | courbes de bruit ambiant (à l'origine du modèle de Coates) | **non lus** |
| Payne & Webb 1971 | hypothèse de portées océaniques des rorquals avant l'ère industrielle | **non lu**, cité de mémoire **[!]** |
| Marsh & Schulkin (modèle « Colossus ») | notion de distance de saut pour les pertes au fond | **non lu** (notice seulement) |
| Urick, *Principles of Underwater Sound* | TL sphérique/cylindrique | **non relu** pour ce projet |
| Jensen, Kuperman, Porter & Schmidt, *Computational Ocean Acoustics* | fréquence de coupure modale | **non relu** pour ce projet |
| AquaMaps (Kaschner et al.) ; OBIS | habitats, observations | données utilisées ; conditions lues sur les sites |
| ETOPO 2022 (NOAA NCEI) ; Natural Earth | bathymétrie, côtes | données utilisées |

Références citées dans des versions antérieures du code ou des commentaires et **retirées** car je ne les
avais pas consultées pour les valeurs en question : Richardson et al. 1995 (*Marine Mammals and Noise*),
comme source des niveaux d'appel.
