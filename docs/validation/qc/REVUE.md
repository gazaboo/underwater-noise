# Revue des mesures seules

Revue du 15/10/2026 par l’agent selon le protocole ; **pas une revue d’acousticien**.
Aucune prédiction des stations de test n’est consultée pour cette revue.
Les durées, niveaux et écarts ci-dessous sont calculés à partir des mesures [C] ; les
identifiants et déclarations instrumentales viennent des métadonnées ICES [S].

## Décision QC : Stevns en hiver et Anholt en automne

La [figure de Stevns](stevns-qc.png) montre un spectre presque figé toute la journée
du 20 février 2019. Les fenêtres contiguës disponibles totalisent 705 min [C].
Le niveau large bande a pour percentiles 1 / 50 / 99 : 78,017 / 78,099 / 78,202 dB
re 1 µPa [C], soit une étendue interpercentile de 0,185 dB [C]. La largeur maximale
L1 − L99 d’une décidécade est de 1,986 dB [C]. La procédure d’étalonnage « CPC » est
déclarée [S] ; aucun commentaire de panne n’est fourni.

Le numéro d’hydrophone est **681486** [S], identique à celui du déploiement de Hjelm
en été [S]. Le spectre médian de Stevns en hiver diffère de celui du silence
instrumental de Hjelm en été d’au plus **0,344 dB** sur toutes les décidécades [C].
Ce silence de Hjelm a été détecté indépendamment par le critère existant, sans modèle.
Cela renforce l’hypothèse d’un plancher instrumental ; le producteur ne l’a pas confirmée.

Le critère actuel compare à la médiane du jour : il ne peut détecter une panne
persistant toute la journée. Ajout au critère 4, **approuvé par l’utilisateur le 15/10/2026** :
exclure un jour si son étendue large bande entre percentiles 1 et 99 est inférieure
à 0,5 dB [E, seuil de stabilité repris du critère 4a] ET si chaque décidécade de son
spectre médian est à moins de 3 dB [E, seuil repris du critère 4b] du spectre d’un
silence déjà détecté par 4a, dans un autre jour du protocole avec le même numéro
d’hydrophone [S]. Appliquer cette règle à toutes les stations sur les seules mesures.
L’accord et l’écart sont consignés au §8 **avant** d’appliquer l’exclusion et avant le calage.

L’examen de toutes les autres figures révèle la même signature à **Anholt le
12 novembre 2019**, station de test dont seules les mesures sont examinées :
709 min disponibles [C], étendue large bande P99 − P1 de **0,160 dB** [C], même
hydrophone **681486** [S], écart maximal des spectres médians au silence de Hjelm
de **0,356 dB** [C]. La règle proposée s’y appliquerait aussi. Aucun autre jour
déjà extrait n’a d’étendue large bande P99 − P1 inférieure à 1 dB [C]. La règle
s’applique donc aussi à ce jour d’Anholt ; aucune comparaison n’a été lancée.

## Intégrité et corrections d’implémentation

- Anholt : le segment d’indice 1 [C] est le seul couvrant le jour de printemps ; le
  segment d’indice 0 [C] est le seul couvrant le jour d’été. Les chevauchements sont
  hors de ces jours. Sélection par les horodatages seuls, autorisée par le critère 1.
- Le détecteur de silence doit interrompre ses suites aux lacunes d’enregistrement.
  Sa correction applique le critère « minutes consécutives » existant. Les pauses
  d’acquisition ne sont jamais interpolées.
- L’export géométrique pour le calage conservait seulement un instant par minute,
  alors que les prédictions intègrent des pas de 10 s [C, configuration]. L’export
  est corrigé pour garder tous les pas ; le calage doit reproduire l’énergie de la
  prédiction de référence avant optimisation. Cela ne change aucun paramètre calable.

## Littérature lue

Basan et al. (2024), §4.1.2 et §4.2.3, PDF conservé dans le cache : bruit
d’écoulement surtout aux basses fréquences ; pic de plateforme identifié à FINO3,
station de développement. Aucune attribution supplémentaire de panne ou de pic
instrumental n’est faite aux stations du protocole à partir de cette source.
