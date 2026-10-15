# Protocole de validation des niveaux sonores — pré-enregistré

> Statut : **version 1, figée avant tout calcul de comparaison sur les stations ci-dessous.**
> Toute modification ultérieure est versionnée (git) et justifiée dans la section « Écarts au protocole ».
> Les stations de développement (FINO3, ICES 13076) ont déjà été examinées et sont exclues des tests.

## 1. Question posée

Quel écart sépare les niveaux que la carte mondiale calcule (loi du moteur mondial : source
JOMOPANS-ECHO, pertes `lossRateDbPerKm`, étalement `pathTransmissionLoss`, fond naturel, AIS) des
niveaux mesurés par des hydrophones, et cet écart est-il comparable à celui des cartes de bruit de
navires validées publiées ?

Repère publié [S, lu] : Farcas et al. 2020 (*Science of the Total Environment* 735, 139509), 4 sites en
mer du Nord, médianes prédites à ±3 dB pour 93 % des comparaisons en tiers d’octave 125 Hz–5 kHz ; à
63 Hz, écarts de −10,8 à +6,0 dB.

## 2. Ce qui est évalué

- **Modèle principal** : `world-law`, profil `north-sea-reference-v1` non calé, au point exact de
  l’hydrophone (`tools/science/point-predict.ts`).
- **Références** : `ambient-only` (fond naturel seul : ce que vaut l’absence de navires) ; `ram-curves`
  (RAM au récepteur, seulement si convergé à 1 dB, sinon non interprété).
- **Bandes** : décidécades 63 et 125 Hz (indicateurs DCSMM, comparables aux cartes européennes) et les
  trois bandes larges de l’œuvre, reconstituées en sommant les décidécades mesurées que la source J-E
  somme elle-même : 10–40 Hz (décidécades 10 à 40), 100–500 Hz, 1–10 kHz.
- **Vent** : ERA5 au point (archive Open-Meteo). Le scénario d’exposition (5 m/s uniforme) est évalué en
  plus, comme variante, pour dire ce que voit réellement le public.

## 3. Stations et périodes

Critères d’inclusion, fixés avant tout calcul : mesures publiques étalonnées à la minute ou plus fin ;
position publiée par le producteur ; trafic dans la couverture d’un AIS historique libre et complet :
AIS terrestre danois (DMA) pour les stations ICES 2019, MarineCadastre (NOAA/BOEM) pour les stations
américaines.

| Station | Nom (dictionnaire ICES / NCEI) | Position | Fond | Strate | Rôle |
|---|---|---|---|---|---|
| 12867 | DKMst103, BIAS Hjelm | 56,1131 N 10,7337 E | 10,4 m | Kattégat | calage |
| 12868 | DKMst104, BIAS Anholt | 56,9242 N 11,2057 E | 11,4 m | Kattégat | **test** |
| 12863 | DKMst035, BIAS Lillebælt | 55,0747 N 9,9219 E | 27,3 m | Belts/Baltique | **test** |
| 12866 | DKMst038, BIAS Stevns | 55,1989 N 12,2590 E | 10,3 m | Belts/Baltique | calage |
| 2174 | Fehmarn Belt | 54,6 N 11,15 E (±0,018°) | 28,3 m | Belts/Baltique | **test** |
| 2654 | Arkona Deep | 54,8833 N 13,8667 E (±0,016°) | 45,1 m | Belts/Baltique | calage |
| 12870 | DKMst201, Horns Rev 3 | 55,6894 N 7,5857 E | 14,1 m | mer du Nord | calage |
| NRS11 | NOAA NRS11, Cordell Bank (Californie) | 37,881 N 123,435 W (métadonnées NCEI) | 528 m (MNT NOAA NCEI ; récepteur à 500 m) | eau profonde (talus) | **test** (régime profond) |
| 13557 | FINO3 | 55,1937 N 7,1585 E | 21,8 m | mer du Nord | développement |
| 13076 | Hon1, Hönö (identité ambiguë) | 57,6797 N 11,5915 E | 20,0 m | Skagerrak | développement |

Exclues faute d’AIS libre couvrant 2019 : stations britanniques, néerlandaise, belge, norvégiennes,
ES1, FINO1, Sundsvall, Estonie. NRS11 : spectres « hybrid millidecade » NOAA à 1 min (CC0, étalonnage
appliqué par le producteur, bandes 0–10 Hz et 2–2,5 kHz déclarées inutilisables par le producteur) ;
les décidécades sont reconstituées en sommant les bandes millidécades comprises dans leurs bords ;
la bande 1–10 kHz n’y est donc pas évaluable (échantillonnage à 5 kHz), et les périodes retirées par
la Navy (« Navy redactions ») restent absentes.
Seule station profonde : elle n’est **jamais utilisée pour le calage** et sert de test du régime
profond (où les paramètres calables, liés au fond, n’agissent presque pas).

**Répartition** : tirage stratifié reproductible (`random.Random(20261015)`, codes triés, 1 station de
test dans le Kattégat, 2 dans les Belts/Baltique, la seule station de mer du Nord en calage), réalisé
avant tout calcul. En complément, validation croisée « une station de calage laissée de côté ».

**Périodes** : **un jour par saison**, choisi d’après la seule disponibilité des fichiers (catalogue
ICES), pas d’après les niveaux. Version volontairement réduite (~0,6 Go d’AIS DMA et ~0,3 Go d’AIS
MarineCadastre par jour, ~3,5 Go au total) ; une version 2 pourra ajouter des jours, déclarés avant
d’être calculés.

| Saison | Stations danoises/allemandes (2019) | NRS11 |
|---|---|---|
| hiver | 20 février 2019 (toutes sauf Horns Rev 3) | 20 février 2020 |
| printemps | 16 avril 2019 (toutes) | 16 avril 2020 |
| été | 5 juin 2019 (toutes sauf Arkona) | 5 juin 2020 |
| automne | 12 novembre 2019 (Lillebælt, Anholt, Horns Rev 3, Fehmarn, Arkona) | 12 novembre 2019 |

Chaque station est évaluée sur 3 ou 4 jours. NRS11 ne commence que le 23/10/2019 : ses jours sont
pris aux mêmes dates calendaires, 2019–2020 (avril 2020 inclut la baisse de trafic due à la pandémie,
présente aussi dans l’AIS). Fenêtres de 00:15 à 24:00 UTC (mise en route du registre AIS : 15 min ;
fenêtres à cheval sur minuit exclues). Avec un jour par saison, les L50/L10 par station sont aussi
calculés sur l’ensemble de ses jours ; un jour isolé n’est jamais présenté comme représentatif d’une
saison.

**Limite assumée** : une seule station profonde (NRS11, bord du plateau californien). Le régime
profond n’est donc testé qu’en un point ; tout énoncé sur le grand large restera prudent. D’autres
stations profondes (MBARI MARS, ~900 m, audio brut à traiter ; autres stations NRS) pourront être
ajoutées par une version 2 du protocole, avant d’être calculées.

## 4. Contrôle qualité des mesures (avant toute comparaison)

Décidé en regardant **uniquement les mesures** (spectres de percentiles, spectrogrammes, métadonnées),
jamais les prédictions. Consigné dans la section `qc` de chaque fiche station, avec sa source.

1. Intégrité : export sans séries chevauchantes ambiguës ; fichier vérifié par empreinte.
2. Étalonnage déclaré (métadonnée `CalibrationProcedure`), sinon station exclue.
3. Contaminations connues de la littérature (p. ex. pic de plateforme), bande exclue.
4. Plancher de bruit de l’instrument : bande exclue si le percentile 1 % et la médiane mesurés diffèrent
   de moins de 3 dB sur la semaine (spectre « plat » au plancher, d’après Basan et al. 2024, §4.1.2).
5. Bruit d’écoulement : décidécades ≤ 63 Hz signalées (Basan et al. 2024, §4.2.3) ; évaluées mais
   **jamais utilisées pour le calage** faute de courants mesurés au point.
6. Périodes d’intervention (mouillage, maintenance) : exclues si documentées par le producteur.

Revue réalisée par l’assistant de développement selon ces seuls critères, figures publiées (spectres de
percentiles et spectrogrammes par station et par jour) ; relecture possible par l’auteur de l’œuvre. Le
statut `reviewed` signifie « critères écrits appliqués », **pas** « revue par un acousticien » : les
fiches et le rapport l’indiquent.

## 5. Métriques

Par station × bande × semaine, écart prédit − mesuré :

- **principales** : ΔL50 (médiane) et ΔL10 (niveau dépassé 10 % du temps) sur les fenêtres de 60 s ;
  part des comparaisons de médiane à ±3 dB (même indicateur que Farcas et al. 2020) ;
- **secondaires** : biais, RMSE, quantiles 5–95 % et corrélation des séries minute par minute ;
  mêmes indicateurs selon que les navires, le fond ou aucun ne domine (écart de 3 dB) ;
- **diagnostics** : énergie cumulée selon le rayon AIS (part du trafic lointain), navire le plus proche,
  trajets bloqués par la terre, couverture des fenêtres.

Écart attendu a priori, pour ne pas sur-interpréter : niveau source J-E ±6 dB par navire (écart-type des
résidus publiés) [S] ; trafic non équipé d’AIS absent (biais vers le bas) ; vent ERA5 à ~30 km.

## 6. Calage (stations de calage uniquement)

Seuls ces paramètres, déjà empiriques [E] dans le code, peuvent bouger, dans des bornes physiques :

| Paramètre | Actuel | Bornes | Origine des bornes |
|---|---|---|---|
| `bottomBounceLossDb` (× tan θ fixe) | 0,09 dB/rebond à 10° | 0,01–1 | perte par réflexion sur sables–graviers aux faibles rasances [L, à lire : Jensen et al., *Computational Ocean Acoustics*, ch. 1] |
| `sedimentSoundSpeed` | 1 700 m/s | 1 550–1 900 | vases à graviers [L, même source] |
| `cutoffLossDbPerKm` | 5 dB/km | 1–20 | extinction sous la coupure en quelques km [E] |
| règle de transition r_t | r_t = profondeur | {1, 2} × profondeur | choix d’usage [L] |
| modèle de bruit de vent | Wenz/Coates (eau profonde) | {actuel, modèle d’eau peu profonde sourcé} | choix discret, Reeder et al. 2011 utilisé par Farcas et al. 2020 [à lire] |

Critère : moindres carrés sur ΔL50 et ΔL10 des stations de calage, bandes 125 Hz, 100–500 Hz et
1–10 kHz (les bandes signalées pour l’écoulement sont exclues). Résultat publié comme profil
`north-sea-reference-v2`, chaque valeur étiquetée [C-calé]. Le profil v1 reste évalué en parallèle.

## 7. Test et publication

Les deux profils (v1 non calé, v2 calé) sont évalués **une seule fois** sur les stations de test
(Anholt, Lillebælt, Fehmarn ; NRS11 pour le régime profond, rapporté séparément), avec
publication intégrale des résultats, favorables ou non, dans `docs/VALIDATION.md`. Formulation autorisée
dans l’œuvre si, sur les stations de test, ≥ 80 % des médianes 125 Hz–10 kHz sont à ±3 dB :
« compatible avec les mesures en eau peu profonde (mer du Nord / Baltique occidentale) à l’état de l’art
des cartes publiées », et de même pour l’eau profonde si NRS11 satisfait seule le critère (« en un point
de mesure » précisé). Sinon, l’œuvre affiche l’écart mesuré tel quel. Hors des conditions testées :
« non validé ».

## 8. Écarts au protocole

1. *15/10/2026, avant tout calcul de comparaison* — NRS11 : la profondeur de ~1 370 m venait d’une
   cellule ETOPO à 0,05° sur la pente continentale. Le MNT NOAA NCEI au point exact donne 528 m et les
   métadonnées du déploiement 500 m (profondeur de l’instrument). La station reste au-delà de 400 m, où
   la loi mondiale n’applique plus de perte au fond : son rôle de test du régime profond est inchangé,
   mais il s’agit d’un talus, pas d’une plaine abyssale.
