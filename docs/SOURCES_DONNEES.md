# Sources de données et licences

| Donnée | Source | Licence | Fichiers produits |
|---|---|---|---|
| Bathymétrie / altitude | ETOPO 2022 v1, 60″, version « bed » — NOAA NCEI, via OPeNDAP (THREDDS NOAA), pas de 0,05° | Domaine public (gouvernement des États-Unis) | `data/grid/ocean_*.png`, `data/grid/elevation_4096.png` |
| Trait de côte / terres | Natural Earth 1:10m « land » | Domaine public | idem (masque terre/mer, fraction de terre) |
| Routes maritimes (mode simulation) | Paquet Python `searoute` 1.6.0 (Apache-2.0), réseau marnet (Oak Ridge National Laboratory / Eurostat) | Apache-2.0 / EUPL — à créditer | `data/routes.json` |
| Ports et poids de trafic | Liste manuelle (ordres de grandeur), `tools/build_routes.py` | — | `data/routes.json` |

À venir : AIS (aisstream.io, J2), habitats AquaMaps (CC-BY-NC 3.0, attribution obligatoire) et observations OBIS (J4).

## Crédits à reproduire sur le cartel

> Bathymétrie : NOAA NCEI, ETOPO 2022. Trait de côte : Natural Earth. Routes maritimes : searoute / réseau marnet (ORNL, Eurostat).
> Niveaux sources des navires : modèle JOMOPANS-ECHO (MacGillivray & de Jong, 2021).
