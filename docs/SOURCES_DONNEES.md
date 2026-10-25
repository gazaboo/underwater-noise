# Sources de données et licences

Sources candidates, non intégrées (audit pour la vulgarisation, focus régionaux) :
[`SOURCES_CANDIDATES.md`](SOURCES_CANDIDATES.md).

| Donnée | Source | Licence | Fichiers produits |
|---|---|---|---|
| Bathymétrie / altitude | ETOPO 2022 v1, 60″, version « bed » — NOAA NCEI, via OPeNDAP (THREDDS NOAA), pas de 0,05° | Domaine public (gouvernement des États-Unis) | `data/grid/ocean_*.png`, `data/grid/elevation_4096.png` |
| Trait de côte / terres | Natural Earth 1:10m « land » | Domaine public | idem (masque terre/mer, fraction de terre) |
| Routes maritimes (mode simulation) | Paquet Python `searoute` 1.6.0 (Apache-2.0), réseau marnet (Oak Ridge National Laboratory / Eurostat) | Apache-2.0 / EUPL — à créditer | `data/routes.json` |
| Ports et poids de trafic | Liste manuelle (ordres de grandeur), `tools/build_routes.py` | — | `data/routes.json` |
| AIS en direct | aisstream.io (WebSocket, clé gratuite, sans garantie de service) | conditions d'aisstream.io ; données non redistribuées | `data/recordings/` (non versionné) |
| AIS historique (replay d'exemple) | Autorité maritime danoise (DMA), aisdata.ais.dk — archive du 26/02/2025, première heure | données ouvertes au titre de la loi danoise sur la réutilisation des informations publiques — **mention de la source ; conditions exactes à confirmer** | `data/replays/dma-2025-02-26.ndjson.gz` |
| AIS historique (option) | NOAA MarineCadastre (eaux des États-Unis) | domaine public | via `tools/convert_ais.py --noaa` |
| Présence mondiale des navires (navires estimés) | Global Fishing Watch, API 4Wings, jeu « AIS vessel presence » (`public-global-presence:latest`), AIS terrestre et satellite, 0,1°, navires en route (≥ 2 nœuds), 30 jours — période exacte dans `data/density/meta.json` | **usage non commercial** ; conditions de l'API : CC BY-NC 4.0 ; l'archive livrée avec les données indique CC BY-SA 4.0 → on respecte les deux (attribution, non commercial, partage à l'identique). Le nom et le logo GFW ne s'utilisent pas sans accord écrit | `data/density/*.png`, `data/density/meta.json` (via `tools/build_presence.py`) |

| Habitats des cétacés | AquaMaps (Kaschner et al.), cartes « native range » 0,5°, base publiée pour le paquet R aquamapsdata (archive.org/details/aquamapsdb) | **CC-BY-NC 3.0** : usage non commercial, attribution obligatoire | `data/habitats/<espèce>.png` |
| Observations de cétacés | OBIS (Ocean Biodiversity Information System), occurrences depuis 2015 | selon les jeux de données (CC0, CC-BY, CC-BY-SA, CC-BY-NC) ; liste et licences dans `data/habitats/sightings.json` | `data/habitats/sightings.json` |
| Sons de cétacés et de lieux | extraits de vrais enregistrements : MBARI *Pacific Ocean Sound Recordings* (hydrophone MARS, Monterey) ; Alfred Wegener Institute, observatoire PALAOA (projet *Polar Sounds*) ; Orcasound. Provenance extrait par extrait dans [`MEDIAS.md`](MEDIAS.md) | MBARI CC-BY 4.0 ; AWI CC-BY 4.0 ; Orcasound CC BY-NC-SA 4.0 (extrait dérivé diffusé sous la même licence) | `data/media/` (via `tools/build_media.py`) |
| Lieux sonores | position et description des lieux, avec leur source | voir chaque `lieu.json` | `data/lieux/` |
| Photos des fiches | Wikimedia Commons : NOAA Photo Library (domaine public) ; A. Rosing-Asvid, Visit Greenland (CC BY 2.0) ; G. Barathieu (CC BY-SA 2.0). Détail dans [`MEDIAS.md`](MEDIAS.md) | selon la photo, lue sur Commons | `data/media/photos/` |
| Faits des fiches espèces | NOAA Fisheries, Species Directory (domaine public) ; statuts UICN via Wikidata (CC0) ; effectifs Cooke 2018 (Liste rouge UICN), cités par des sources secondaires, **à confirmer** | valeurs citées, avec leur source | `data/fiches/especes.json` |

## Crédits à reproduire sur le cartel

> Données AIS : aisstream.io ; Autorité maritime danoise (DMA). Navires estimés : Powered by Global Fishing Watch (globalfishingwatch.org) — AIS vessel presence, période indiquée dans data/density/meta.json. Bathymétrie : NOAA NCEI, ETOPO 2022. Trait de côte : Natural Earth. Routes maritimes : searoute / réseau marnet (ORNL, Eurostat).
> Niveaux sources des navires : modèle JOMOPANS-ECHO (MacGillivray & de Jong, 2021).
> Habitats des cétacés : AquaMaps (www.aquamaps.org), cartes de répartition calculées, CC-BY-NC 3.0.
> Observations : OBIS (obis.org) et les jeux de données qui y contribuent.
> Sons : Pacific Ocean Sound Recordings, MBARI (CC-BY 4.0) ; Alfred Wegener Institute, Helmholtz Centre for Polar and Marine Research, projet Polar Sounds (CC-BY 4.0) ; Orcasound (orcasound.net, CC BY-NC-SA 4.0). Rorquals bleu et commun transposés pour être audibles.
> Photos : NOAA Photo Library ; Aqqa Rosing-Asvid, Visit Greenland (CC BY 2.0) ; Gabriel Barathieu (CC BY-SA 2.0) ; via Wikimedia Commons. Fiches : NOAA Fisheries ; Liste rouge UICN.

## Terres peintes et volcans

- **Natural Earth II**, Tom Patterson, domaine public : [variante 1:10m sans relief ombré ni eau](https://www.naturalearthdata.com/downloads/10m-raster-data/10m-natural-earth-2/), archive `NE2_HR_LC.zip`. Couleurs de milieux idéalisés, sans prétention de représenter la couverture actuelle du sol. Réduction en RGBA 4096×2048 par `tools/build_landcover.py` ; RGB prolongé de 8 pixels sur la mer pour le filtrage côtier. Alpha : indice artistique dérivé de l'excès de vert, sans valeur de mesure forestière.
- **Global Volcanism Program (2026)**, *Volcanoes of the World*, v. 5.4.0 (7 août 2026), E. Venzke (comp.), Smithsonian Institution. [DOI : 10.5479/si.GVP.VOTW5-2026.5.4](https://doi.org/10.5479/si.GVP.VOTW5-2026.5.4). Export WFS des volcans holocènes émergés du **15 octobre 2026**, date consignée dans `data/grid/meta.json`. Fichier `volcanoes.json` : `[longitude, latitude, altitude en m, année de dernière éruption ou null]`, 1 099 positions. Le panache indique seulement une dernière éruption depuis l'année configurée : **il ne décrit pas une activité en direct**.

Les paliers, pinceaux, granulation, couleurs d'éclairage, tailles, densités, seuil de fumée, étoiles et papier sont des choix **artistiques**. Le relief provient de l'altitude ETOPO déjà utilisée par la carte.

## Monde illustré

- Cartes `land_biome_4096.png`, `land_shape_4096.png` et placements `ornaments.json` : **dérivés** des sources
  ci-dessus (ETOPO 2022, Natural Earth, Natural Earth II, Smithsonian GVP) par `tools/build_illustrated.py`.
  La classification en milieux illustrés est une interprétation artistique des couleurs NE II.
- **Quaternius**, *Ultimate Stylized Nature* (mai 2022), [quaternius.com](https://quaternius.com),
  **CC0 1.0** (domaine public, aucune attribution exigée ; citée par courtoisie). Arbres, buissons, fleurs et
  rochers des vignettes `data/ornaments/atlas.png`. Le pack lui-même n'est pas versionné.
- Montagnes, plateaux de grès, volcans, fumées et nuages des vignettes : modèles procéduraux créés pour le
  projet (`tools/ornaments/render_cells.py`).
