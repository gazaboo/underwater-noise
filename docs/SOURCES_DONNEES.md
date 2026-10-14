# Sources de données et licences

| Donnée | Source | Licence | Fichiers produits |
|---|---|---|---|
| Bathymétrie / altitude | ETOPO 2022 v1, 60″, version « bed » — NOAA NCEI, via OPeNDAP (THREDDS NOAA), pas de 0,05° | Domaine public (gouvernement des États-Unis) | `data/grid/ocean_*.png`, `data/grid/elevation_4096.png` |
| Trait de côte / terres | Natural Earth 1:10m « land » | Domaine public | idem (masque terre/mer, fraction de terre) |
| Routes maritimes (mode simulation) | Paquet Python `searoute` 1.6.0 (Apache-2.0), réseau marnet (Oak Ridge National Laboratory / Eurostat) | Apache-2.0 / EUPL — à créditer | `data/routes.json` |
| Ports et poids de trafic | Liste manuelle (ordres de grandeur), `tools/build_routes.py` | — | `data/routes.json` |
| AIS en direct | aisstream.io (WebSocket, clé gratuite, sans garantie de service) | conditions d'aisstream.io ; données non redistribuées | `data/recordings/` (non versionné) |
| AIS historique (replay d'exemple) | Autorité maritime danoise (DMA), aisdata.ais.dk — archive du 26/02/2025, première heure | données ouvertes au titre de la loi danoise sur la réutilisation des informations publiques — **mention de la source ; conditions exactes à confirmer** | `data/replays/dma-2025-02-26.ndjson.gz` |
| AIS historique (option) | NOAA MarineCadastre (eaux des États-Unis) | domaine public | via `tools/convert_ais.py --noaa` |

| Habitats des cétacés | AquaMaps (Kaschner et al.), cartes « native range » 0,5°, base publiée pour le paquet R aquamapsdata (archive.org/details/aquamapsdb) | **CC-BY-NC 3.0** : usage non commercial, attribution obligatoire | `data/habitats/<espèce>.png` |
| Observations de cétacés | OBIS (Ocean Biodiversity Information System), occurrences depuis 2015 | selon les jeux de données (CC0, CC-BY, CC-BY-SA, CC-BY-NC) ; liste et licences dans `data/habitats/sightings.json` | `data/habitats/sightings.json` |

## Crédits à reproduire sur le cartel

> Données AIS : aisstream.io ; Autorité maritime danoise (DMA). Bathymétrie : NOAA NCEI, ETOPO 2022. Trait de côte : Natural Earth. Routes maritimes : searoute / réseau marnet (ORNL, Eurostat).
> Niveaux sources des navires : modèle JOMOPANS-ECHO (MacGillivray & de Jong, 2021).
> Habitats des cétacés : AquaMaps (www.aquamaps.org), cartes de répartition calculées, CC-BY-NC 3.0.
> Observations : OBIS (obis.org) et les jeux de données qui y contribuent.
