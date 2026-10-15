# Passation — validation des niveaux sonores sur mesures d’hydrophones

État après achèvement du test indépendant, le 15/10/2026. Lire ensuite
[VALIDATION_PROTOCOLE.md](VALIDATION_PROTOCOLE.md), contrat figé avec écarts datés,
puis [ACOUSTIQUE_SCIENTIFIQUE.md](ACOUSTIQUE_SCIENTIFIQUE.md).

**LE TEST V1 EST TERMINÉ. NE PAS RELANCER `run_protocol.py --phase test`.**
Ne pas réajuster ni écraser `calibration-v2.json` après lecture du test. Les données
de test sont désormais ouvertes : elles ne constituent plus un jeu de réserve
pour une autre tentative de calage.

## Résultat et décision de l’utilisateur

Le critère pré-enregistré de ≥80 % [E] des médianes à ±3 dB n’est atteint par aucun
profil. Résultats sur les bandes principales, comptage station × jour × bande [C] :

| Régime | v1 / ERA5 | v2 / ERA5 | v1 / vent de scénario | v2 / vent de scénario |
|---|---:|---:|---:|---:|
| Eau peu profonde | 4/33 (12,1 %) | 9/33 (27,3 %) | 3/33 (9,1 %) | 5/33 (15,2 %) |
| NRS11, un point profond | 0/8 (0 %) | 2/8 (25 %) | 0/8 (0 %) | 2/8 (25 %) |

**Décision explicite après présentation du rapport : conserver v1 et garder v2
comme étude hors ligne.** `SCIENTIFIC_PROFILE_ID` et `REFERENCE_PHYSICS` restent
sur `north-sea-reference-v1`. Le facteur de transition proposé par v2 n’est donc
pas appliqué au GPU ni aux cétacés. Voir [le journal des décisions](validation/DECISIONS.md).

Aucune formulation « compatible avec les mesures à l’état de l’art des cartes
publiées » n’est autorisée par ces résultats. L’app publie les écarts historiques
au repère des stations ; autres lieux, profil expérimental et trafic synthétique
ou mixte restent « non validés ». La loi est évaluée au point exact ; l’écart
supplémentaire du champ GPU aux hydrophones n’a pas été quantifié. Ne pas parler
de validation mondiale ni biologique.

## Ce qui est achevé

- Téléchargements du protocole achevés et journal reconstitué : tailles et empreintes
  ICES/AIS vérifiées, 32 fichiers et 10,16 Go avant suppression des HDF5 [C].
- Toutes les fiches créées, toutes les figures et métadonnées QC relues sur les
  mesures seules, avant toute comparaison sur les stations de test.
- Ajout QC approuvé et consigné avant application (§8.3) : détection d’un silence
  persistant par comparaison à un silence du même hydrophone, sans prédiction.
- Silences exclus : Hjelm en été, deux suites totalisant 47 min [C] ; Stevns en
  hiver et Anholt en automne, journées entières. Aucun autre retrait de bande au
  plancher [C]. Écoulement signalé aux basses fréquences ; biologie possible
  signalée à NRS11, sans exclusion. **Pas une revue d’acousticien.**
- Sélections de segments décidées sur les horodatages seuls : Anholt printemps
  et été ; Horns Rev 3 printemps et automne. Les lacunes restent absentes et les
  figures les laissent en blanc. Voir [la revue QC](validation/qc/REVUE.md).
- Jours extraits et empreintes conservés ; tous les HDF5 ICES du protocole supprimés
  par `qc.py --prune-raw`. Les fichiers de développement restent dans le cache.
- Replays AIS et vent ERA5 préparés. Une conversion du replay d’été a été demandée
  deux fois : intégrité gzip contrôlée et empreintes des prédictions identiques au
  fichier final avant optimisation. Un verrou empêche désormais deux écrivains.
- Calage sur les seules stations autorisées ; géométrie de tous les pas conservée,
  identité Python/TypeScript vérifiée à moins de 0,000010 dB [C] sur tous les cas.
  Grille du protocole et même recherche pour les plis « une station laissée de côté ».
  Aucun modèle alternatif de vent exploré faute de formule sourcée lue.
- Profil proposé [C-calé] : perte par rebond 0,464159 dB, célérité du sédiment
  1 666,67 m/s, perte sous coupure 1 dB/km (borne basse), transition à 2 × profondeur.
  Critère de calage 25 469,74 → 2 912,44 dB² [C]. Paramètres effectifs du modèle,
  aucune mesure locale du sédiment ; profil non adopté dans l’œuvre.
- Test complet exécuté **une seule fois**, du 15/10/2026 à 16:02:53 UTC au même jour
  à 16:16:11 UTC [C, horodatages du journal]. Le verrou conserve les empreintes du
  profil et du protocole. Les cas indépendants ont tourné dans cette même invocation.
- `summarize.py` écrit le rapport intégral, les statistiques, les figures, les rapports
  bruts et le résumé de l’app ; contrôle Zod réel et profil actif vérifiés. Aucun
  modèle n’est relancé pour régénérer une restitution.
- Panneau « Fiabilité » vérifié dans un navigateur local : données historiques au
  repère mesuré, absence de validation ailleurs, garde-fous expérimental et synthétique.
  Les captures identifient les coordonnées et le statut AIS injectés pour ce test
  d’interface ; elles ne vérifient pas un niveau GPU face à un hydrophone.

## Artefacts à lire

- [VALIDATION.md](VALIDATION.md) : résultats complets, limites, tableaux et figures.
- [results.json](validation/results.json) / [results.csv](validation/results.csv) :
  335 comparaisons station × jour × bande [C], toutes les variantes, percentiles
  regroupés et diagnostics ; 80 rapports de test [C], y compris les vides.
- [Rapports de calage](validation/calibration-reports/) : 36 rapports bruts [C].
- [Profil v2](../tools/science/calibration-v2.json) : paramètres, résidus et validation croisée.
- [Manifeste du calage](validation/calibration-manifest.json) et
  [manifeste du test](validation/test-manifest.json) : empreintes figées à ces étapes.
  Les outils de restitution ont évolué après le calage, sans modifier le modèle testé.
- [Résumé de l’app](../data/science/validation-summary.json) : profil v1, variante
  au vent de scénario. Seul ce petit fichier de données est suivi dans `data/science/`.
- [Capture au repère mesuré](validation/ui-fiabilite-station.png) et
  [hors mesure](validation/ui-fiabilite-hors-mesure.png).

## Cache et commandes sûres

Les grandes entrées, les jours extraits, les replays et les sorties complètes restent
hors dépôt dans `tools/.cache/science/`. Aucun téléchargement supplémentaire n’est
nécessaire à la restitution. Les HDF5 supprimés sont identifiables par leurs fiches,
les notices et le journal `fetch-log.json`.

Régénérer **la restitution seulement**, sans ouvrir de test ni modifier le calage :

```bash
MPLCONFIGDIR=/tmp/vacarme-mpl tools/.venv-science/bin/python tools/science/summarize.py
npm test
npm run typecheck
npm run build
MPLCONFIGDIR=/tmp/vacarme-mpl tools/.venv-science/bin/python -m unittest discover -s tools/science -p 'test_*.py'
```

Vérifications : 89 tests TypeScript [C], suite Python de 26 tests dont 25 exécutés
et un benchmark RAM conditionnel non relancé [C] ; typage et compilation vérifiés.
Le benchmark RAM avait été validé avant cette reprise, code RAM inchangé.

## Ce qui reste hors de cette étude

Une amélioration physique, un milieu RAM local sourcé, une meilleure grille côtière,
la comparaison GPU ↔ loi au point, l’harmonisation des bords de bandes du fond naturel,
plus de jours ou de sites profonds nécessitent un travail distinct et, si le protocole
change, une déclaration avant calcul. Ne pas transformer les stations déjà ouvertes
en nouveau test indépendant. Les erreurs constatées restent publiques.

`visual_assets_references/` est volontairement non suivi : ne pas le commiter sans
accord. Faire des commits séparés et lisibles. Ne pas utiliser `pkill -f` avec un
motif présent dans sa propre commande.
