# Captures des pull requests de la refonte

Branche sans code : images et animations jointes aux PR de la refonte (bruit, cétacés, navires, web autonome).
Chaque dossier correspond à l'état exact d'un commit, capturé dans les mêmes conditions :
Chromium sans fenêtre sur la Radeon 780M (Vulkan), 1440×900 (téléphone : 390×844), navires estimés
(densité Global Fishing Watch, 50 854 navires) ou AIS enregistré (web), 20 s de scène après l'arrivée des navires.

| Dossier | Commit | État |
|---|---|---|
| `s0-avant-propagation` | 83e4fe4 | ondes artistiques indépendantes (avant la correction de propagation) |
| `s1-propagation` | dc7e3f5 | fronts tirés du champ acoustique commun, horloge unique |
| `s2-monde-illustre` | 58f2497 | monde illustré intégré |
| `s3-bruit` | ab0afbd | nappe en paliers, isophones, météo, légende |
| `s4-cetaces` | 0daf93b | silhouettes, bulle perdue, anneaux d'appel, chevrons, encre |
| `s5-web` | 70df994 | web autonome (build statique, sans serveur) |
