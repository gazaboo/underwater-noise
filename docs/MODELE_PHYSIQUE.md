# Modèle physique

L'œuvre vise des **ordres de grandeur justes**, pas une prédiction de gestion : chaque
simplification ci-dessous est assumée et documentée. Deux grilles coexistent :

| Grille | Rôle | Résolution (profil `expo`) | Calibrée ? |
|---|---|---|---|
| **visuelle** | fronts d'onde visibles, interférences | 2048×1024 (≈ 20 km), + grille de détail au zoom (≈ 6 km au zoom ×7) | non : paramètres artistiques |
| **physique** | niveau de bruit en dB re 1 µPa, trois bandes | 1024×512 (≈ 39 km) | oui |

Le niveau de la grille physique pilote la lueur d'accumulation (J3), le rayon d'écoute et les
liens entre cétacés (J4), le mixage sonore (J5).

## 1. Niveau source des navires : JOMOPANS-ECHO

MacGillivray, A. & de Jong, C. (2021). *A Reference Spectrum Model for Estimating Source Levels of
Marine Shipping Based on Automated Identification System Data.* J. Mar. Sci. Eng. 9, 369.
Implémentation : `shared/src/acoustics/jomopans-echo.ts`.

- Densité spectrale : L_S(f, V, l, C) = L_S0(f, C) + 60·log10(V / V_C) + 20·log10(l / l0), l0 = 300 pieds.
- Spectre de référence : L_S0 = K − 20·log10(f1) − 10·log10[(1 − f/f1)² + D²], K = 191 dB, D = 3
  (croisière : 4), f1 = 480 Hz × (1 nœud / V_C).
- Navires de charge sous 100 Hz : K^LF − 40·log10(f1^LF) + 10·log10(f) − 10·log10[(1 − (f/f1^LF)²)² + (D^LF)²],
  K^LF = 208 dB, f1^LF = 600 Hz × (1 nœud / V_C), D^LF = 0,8 (porte-conteneurs, vraquiers) ou 1,0 (pétroliers, rouliers).
- Bandes décidécades : + 10·log10(0,231·f). Bandes de l'œuvre : somme énergétique des décidécades.
- 13 classes (Table 1 de l'article), correspondance AIS → classe par type, longueur et vitesse.

**Hypothèses** : monopole à 6 m de profondeur ; écart-type des résidus ≈ 6 dB (20 Hz – 20 kHz) ;
raies de pales sous 20 Hz non modélisées ; vitesse bornée à 0,5 nœud ; longueur inconnue → moyenne
de la classe ; les rouliers ne sont pas identifiables par l'AIS.

**Vérification** (`shared/test/acoustics.test.ts`) : comparaison à la figure 7 de l'article à ±3 dB
(pic ≈ 177 dB vers 40 Hz pour un vraquier à 13,5 nœuds, ≈ 185 dB pour un porte-conteneurs à 18,8 nœuds).
Niveaux large bande obtenus : 184–191 dB re 1 µPa·m pour les grands navires de charge, 165–175 dB
pour la pêche et les petites unités.

## 2. Bandes d'analyse

| Bande | Fréquences | Espèces (J4) | Fréquence représentative | Absorption (Thorp) |
|---|---|---|---|---|
| basse | 10–40 Hz | rorqual bleu, rorqual commun | 20 Hz | ≈ 0,003 dB/km |
| moyenne | 100–500 Hz | baleine à bosse | 224 Hz | ≈ 0,008 dB/km |
| haute | 1–10 kHz | orque, cachalot | 3,2 kHz | ≈ 0,25 dB/km |

## 3. Propagation

Perte de transmission visée : **TL(r) = 20·log10(r_t) + 10·log10(r / r_t) + α·r**, sphérique jusqu'à
r_t ≈ profondeur d'eau, puis cylindrique.

Elle est obtenue par une **simulation de l'équation des ondes 2D amortie sur la sphère** (grille
équirectangulaire, laplacien sphérique, schéma saute-mouton) — `client/src/sim/physics-sim.ts` :

- **Étalement cylindrique** : en 2D, l'intensité d'une source continue décroît en 1/r (au-delà
  d'une à deux longueurs d'onde de la grille) : c'est exactement 10·log10(r).
- **Partie sphérique** : r_t est bien plus petit qu'une cellule ; on l'intègre à l'injection,
  a² = 10^((SL − 10·log10(r_t) − L_ref) / 10), avec r_t = profondeur sous le navire (≥ 10 m).
- **Terres** : cellules à zéro (Dirichlet) ; côtes absorbantes. Le bruit ne traverse pas les
  continents et diffracte autour des caps.
- **Absorption** : amortissement par pas g = α·Δx·C / 8,686 (une onde parcourt C cellules par pas).
- **Plateau continental** (profondeur < 200 m) : perte générique `physics.shallowLossDbPerKm`.
- **Coupure modale** : sous f_c ≈ c / (4h·√(1 − c²/c_b²)) ≈ 797 / h Hz (fond sédimentaire, c_b ≈ 1 700 m/s),
  une bande ne se propage plus : amortissement fort `physics.bottomLoss`. Effet : le grondement à
  20 Hz disparaît sous ~40 m de fond (mer du Nord peu profonde, Baltique en partie).
- **Correction empirique** `physics.extraLossDbPerKm` (0,004 dB/km par défaut) : l'étalement
  purement cylindrique surestime le bruit loin des sources (pas de pertes par le fond en eau
  profonde, pas de zones d'ombre). Sans elle, le plein Atlantique sortait vers 102 dB en bande basse ;
  avec, vers 95 dB.
- **Sources incohérentes** : chaque navire injecte une porteuse à phase aléatoire lentement
  variable ; les interférences entre navires s'annulent dans la moyenne d'énergie (constante de temps
  `physics.energyTauSec`, 6 s). Fluctuation résiduelle ≈ ±1 dB.

### Calibration

Au démarrage du client : une source unique d'amplitude 1 au centre d'une grille d'eau profonde
uniforme, sans absorption ; après stabilisation (2 400 pas), on mesure l'énergie E(r) dans les quatre
directions et on ajuste E(r) = K / r. Niveau reçu : **L = 10·log10(E) + L_ref − 10·log10(K · Δx)**.

Résultat mesuré (Radeon 780M, Chromium) : **K = 1,41 ; écart maximal à la loi en 1/r : 0,88 dB**
entre 18 et 96 cellules (critère du plan : < 2 dB). Durée : ≈ 0,9 s. Le résultat est affiché dans
le diagnostic (touche `D`).

## 4. Bruit ambiant naturel

Ajouté en énergie au bruit des navires, par bande (`bands[].naturalDb`, dB re 1 µPa, niveau de bande),
d'après les courbes de Wenz pour un état de mer ~3, sans trafic : 88 dB (basse), 88 dB (moyenne),
92 dB (haute). Ordres de grandeur seulement : le vent, la pluie et la saison changent ces valeurs de
±10 dB.

## 5. Niveaux obtenus (direct aisstream, 15 octobre 2026, nuit en Europe, ~6 000 navires suivis)

| Zone | Basse | Moyenne | Haute |
|---|---|---|---|
| Manche | 116 dB | 125 dB | 108 dB |
| Mer du Nord | 108 dB | 120 dB | 101 dB |
| Méditerranée occidentale | 104 dB | 108 dB | ≈ naturel |
| Détroit de Malacca | 97 dB | 110 dB | ≈ naturel |
| Atlantique Nord, 35° O | 95 dB | 96 dB | ≈ naturel |
| Océan Indien Sud | ≈ naturel | ≈ naturel | ≈ naturel |

Ordres de grandeur cohérents avec les mesures publiées (niveaux de bande de 100–120 dB dans les
grands couloirs, 90–100 dB au large), avec une tendance à la surestimation de quelques dB près des
couloirs : une cellule de 39 km moyenne le champ proche de plusieurs navires. Le niveau réel dépend
aussi de la couverture AIS : un navire invisible ne fait pas de bruit dans l'œuvre.

## 6. Accumulation (ce que l'on voit)

Niveau affiché : somme énergétique pondérée des trois bandes (`accumulation.bandWeights`). Il est
accumulé de façon asymétrique : montée en `riseMinutes` (2 min), décrue en `fallMinutes` (20 min).
L'océan démarre au bruit naturel (noir) et « se sature » progressivement ; quand le trafic s'en va,
la lueur s'efface lentement. Correspondance lumière : smoothstep(`quietDb`, `saturationDb`)^`gamma`.

## 7. Limites connues

- **Résolution** : 39 km par cellule pour le champ physique ; le champ proche d'un navire (< 50 km)
  est lissé. Pour le rayon d'écoute d'un cétacé tout proche d'un navire (J4), une contribution
  analytique locale complétera la grille.
- **Couverture AIS** : essentiellement côtière ; la haute mer est sous-représentée (terra incognita).
- **Extrapolation** : un navire hors de portée continue en ligne droite pendant 30 min au plus.
- **Bandes larges** : une seule fréquence représentative par bande pour l'absorption et la coupure.
- **Pas de saison, de météo, de profil de célérité** (pas de chenal SOFAR, pas de zones de convergence).
- **Pôles** : au-delà de ±79°, banquise (mur) ; la grille équirectangulaire y devient instable.

## 8. Cétacés : espace de communication et liens (J4)

Implémentation : `shared/src/acoustics/sonar.ts`, `shared/src/whales/links.ts`, `client/src/whales/`.

### Équation du sonar

Un appel de niveau SL est entendu à la distance r si la marge **SE = SL − TL(r) − NL_appel − DT ≥ 0**
(Clark et al. 2009 ; Erbe et al. 2016).

- **TL** : même loi que le champ physique (sphérique jusqu'à la profondeur sous l'appelant, puis
  cylindrique, absorption de la bande + perte empirique).
- **NL_appel** : bruit au point de **celui qui écoute**, lu dans le champ physique (bande de l'espèce),
  ramené à la largeur de bande de l'appel : NL_appel = NL_bande − 10·log10(B_bande / B_appel).
- **DT** : seuil de détection, qui inclut la capacité à reconnaître l'appel.

Paramètres (`config/default.json5`, ordres de grandeur ; Richardson et al. 1995, Erbe et al. 2016) :

| Espèce | Bande | SL (dB re 1 µPa·m) | B_appel | DT | Portée en océan calme* | Exagération visuelle |
|---|---|---|---|---|---|---|
| Rorqual bleu | basse | 186 | 5 Hz | 6 dB | ≈ 700–1 000 km | ×1 |
| Rorqual commun | basse | 189 | 10 Hz | 6 dB | ≈ 900–1 100 km | ×1 |
| Baleine à bosse | moyenne | 172 | 100 Hz | 6 dB | ≈ 50–150 km | ×4 |
| Cachalot (codas) | haute | 175 | 5 kHz | 8 dB | ≈ 20–40 km | ×10 |
| Orque | haute | 165 | 2 kHz | 4 dB | ≈ 2–15 km | ×20 |

\* selon la profondeur sous le groupe ; l'étalement cylindrique rend ces portées optimistes en eau
profonde, du même ordre que les « centaines de kilomètres » avancées pour les grands rorquals.

**Exagération visuelle** : à l'échelle du globe, l'espace d'une orque (quelques km) serait invisible.
Les distances d'une espèce sont donc multipliées à l'écran par `visualScale`, et ce facteur s'applique
de façon cohérente au calcul : une distance d'écran d se traite comme une distance réelle d / visualScale,
pour l'espace de communication comme pour les liens. C'est un choix artistique, signalé dans le diagnostic.

### Rayon d'écoute et espace de communication

- **Rayon** (diagnostic, son du J5) : portée où SE = 0 avec le bruit au point du groupe (dichotomie),
  lissée sur ~1,5 s pour « respirer ». Le diagnostic affiche aussi la portée en océan calme.
- **Espace de communication**, pour chaque pixel autour du groupe : SE avec le bruit **en ce pixel**.
  La forme n'est pas un cercle : elle est rongée par les couloirs et les ports bruyants, et coupée par
  les côtes (test des terres le long du segment groupe–pixel). Dans les zones non observées par l'AIS,
  le bruit est sous-estimé : le contour y est pointillé et tremblant.

### Liens entre groupes

Pour chaque paire d'une même espèce à portée en océan calme, on calcule les deux directions :
« A entend B » avec le bruit chez A, « B entend A » avec le bruit chez B. Un lien peut donc être
**asymétrique**. Pas de lien si l'orthodromie traverse les terres.

Dynamique (`whales.links`) : hystérésis de ±2 dB (pas de clignotement), rupture en 5 s
(effilochage), reconnexion en 14 s, trace fantôme de 3 minutes.

**Indicateur de connectivité** (diagnostic) : nombre de liens vivants, rapporté au nombre de liens qui
existeraient avec le seul bruit naturel.

### Groupes

Placement : observations OBIS récentes (70 % des groupes) ou tirage pondéré par la probabilité
d'habitat AquaMaps ; profondeur minimale par espèce (cachalot > 1 000 m). Déplacement : marche aléatoire
corrélée dans l'habitat, vitesse réelle × `whales.timeScale` (30 par défaut : artistique).
Les groupes ne sont pas des animaux réels suivis : ce sont des présences plausibles.
