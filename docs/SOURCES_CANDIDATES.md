# Sources candidates (audit, non intégrées)

Audit des données publiques utilisables pour faire de la carte un outil de vulgarisation sur la vie
des cétacés et les pressions humaines ([issue #15](https://github.com/gazaboo/underwater-noise/issues/15),
chantier « 0 bis »). Rien de ce qui suit n'est encore intégré. Les sources déjà utilisées sont dans
[`SOURCES_DONNEES.md`](SOURCES_DONNEES.md).

**Cadre de licence** : projet personnel de recherche et de vulgarisation, **sans but lucratif**, qui
ne rencontrera peut-être jamais de public. Les licences **ne bloquent pas** le travail.
- Les licences non commerciales (NC) sont acceptées.
- Plusieurs auteurs de jeux de données sont des contacts personnels. Une source « lien seulement » ou
  « sur demande » (Watkins, DOSITS…) reste donc possible après un **accord personnel**, noté dans le
  catalogue des médias avec sa date.
- On note toujours la source, l'auteur, la licence ou l'accord, le crédit et les transformations
  appliquées. C'est d'abord une exigence de **traçabilité scientifique**.
- Si un média est modifié (transposition, recadrage, spectrogramme) et qu'il est sous licence ND, on
  demande l'accord de l'auteur.

**Statut de cet audit : [S-r].** Recherches web du 25 octobre 2026, à partir de résumés de pages.
Aucune condition d'utilisation officielle n'a encore été lue en entier. Chaque licence est à
confirmer sur la page de la source avant intégration. Ensuite, télécharger d'abord un **petit
échantillon** : une espèce, un jour, un extrait.

---

## 1. Répartition, effectifs, saisons

| Source | Apport | Couverture | Accès | Licence [S-r] | Décision |
|---|---|---|---|---|---|
| AquaMaps (existant) | habitat favorable, 0,5° | monde, moyenne annuelle | déjà dans `data/habitats` | CC-BY-NC 3.0 | **garder** (couche globale) |
| OBIS (existant) | observations réelles | monde, biais d'effort | API | selon le jeu | **enrichir** avec `eventDate`, `basisOfRecord`, `individualCount` (mois, type d'observation) |
| Liste rouge UICN (API v4) | statut, tendance, effectif estimé | monde, par espèce | jeton gratuit | non commercial ; pas de redistribution en jeu de données ; citation obligatoire | **intégrer** : cinq fiches, valeurs citées |
| CBI, table des effectifs | effectifs par stock, intervalle de confiance à 95 % | stocks évalués seulement (ex. : rorqual bleu de l'hémisphère sud ≈ 2 300, 1991/92–2003/04) | page web | à vérifier | **intégrer** (chiffres cités dans les fiches) |
| Duke MGEL (Roberts et al. 2023) | **densité mensuelle** modélisée par espèce | côte Est des États-Unis, golfe du Mexique | téléchargement SEAMAP | CC-BY 4.0 | **focus** côte Est ; seule source mensuelle ouverte trouvée |
| SCANS-IV (2022) | abondance, cartes de densité modélisées | Atlantique européen, été | rapport, shapefiles (TiHo) | à vérifier | **focus** Atlantique Nord-Est |
| ACCOBAMS ASI (2018) | abondance : rorqual commun ≈ 3 282 (corrigé), cachalot ≈ 2 700 | Méditerranée, été | rapports, articles Frontiers | articles CC-BY ; données sur demande | **focus** Méditerranée |
| NOAA Stock Assessment Reports | effectifs des stocks | États-Unis | PDF | domaine public | **fiches et focus** |
| BlueCorridors.org (WWF, 2025) | trajets satellite de plus de 1 400 baleines, menaces superposées | monde, par endroits | visualiseur | données non ouvertes en bloc | **lien seulement** ; accès à demander plus tard |
| Movebank | trajets de balises (rorquals bleus et communs de Californie, baleines à bosse d'Australie de l'Est) | ponctuel | dépôt avec DOI | variable (CC0 pour les bosses d'Australie) | **focus** : quelques trajets réels pour illustrer la migration |
| Happywhale | photo-identification d'individus | monde, littoral | partiel ; reste sur accord | non ouverte | **écarté** pour l'instant |
| IMMA (UICN) | zones importantes pour les mammifères marins | monde | shapefile sur demande | licence d'utilisation non commerciale | **intégrer** : contour discret « zones importantes » |

**Taille des groupes** : aucun jeu public exploitable. Dans un échantillon OBIS de 200 baleines à
bosse, `individualCount` vaut 1 dans 168 cas. On prendra des ordres de grandeur [O] dans la
littérature, avec une référence par espèce.

**Saison** : seules deux sources la donnent.
- Duke MGEL : mensuel, mais régional.
- Les mois OBIS : biaisés par l'effort d'observation.

Aucune saisonnalité mondiale honnête n'est disponible : elle n'existera que dans les focus.

## 2. Sons

| Source | Contenu | Licence [S-r] | Décision |
|---|---|---|---|
| MBARI Pacific Sound (AWS, depuis juillet 2015) | hydrophone profond de la baie de Monterey : rorquals bleus, communs, baleines à bosse, navires ; fichiers à 16 et 2 kHz | CC-BY 4.0 | **source principale** des sons de rorquals et de navires ; station profonde envisagée pour la validation |
| NOAA NCEI Passive Acoustic Data (Google Cloud) : NRS, SanctSound, ADEON | paysages sonores, détections, sonar actif enregistré (SanctSound CI05) | données fédérales publiques ; citation dans chaque ReadMe | **intégrer** : bruits humains, paysages ; NRS11 déjà utilisé |
| NOAA, canons à air du golfe du Mexique (2010–2024) | sismique enregistrée, croisée avec l'AIS | CC0 | **intégrer** : son réel d'un canon à air |
| Orcasound (AWS, flux HLS sans compte) | orques résidentes du Sud et navires, **en direct** | CC BY-NC-SA 4.0 | **focus mer des Salish** ; SA pour les extraits |
| Ocean Networks Canada (Oceans 3.0) | hydrophones câblés (Pacifique, Arctique) | jeton requis ; CC-BY non confirmé | plus tard |
| Watkins (WHOI) | plus de 10 000 extraits, toutes espèces | usage personnel ou académique non commercial ; **republication sur un site tiers interdite** | **demander un accord d'hébergement** : meilleure couverture des cinq espèces, utile pour le cachalot |
| DOSITS | galerie pédagogique | licence clip par clip (souvent CC non commerciale), sinon sur permission | au cas par cas |
| GLUBS / IQOE | répertoire mondial des sonothèques (en construction) | — | **outil d'audit** pour combler les manques (cachalot, orque) |

### 2 bis. Extraits candidats (lot 0, recherches web du 25 octobre 2026)

Statut **[S-r]** : pistes repérées, rien n'est téléchargé. Pour chaque espèce et chaque lieu, on
écoute d'abord 1 ou 2 extraits avant d'en retenir un. Critères : appel net, peu de bruit de fond
d'origine, espèce identifiée par la source, date et lieu connus.

**Cétacés** (#1) :

| Espèce | 1er choix | Autres pistes | Remarque |
|---|---|---|---|
| Rorqual bleu | MBARI Pacific Sound / *Soundscape Listening Room* (MARS, 900 m, Monterey), CC-BY 4.0 | AWI *Polar Sounds* (Antarctique, CC-BY 4.0) | infrason : transposition ×5 [A] |
| Rorqual commun | MBARI Pacific Sound | CIBRA (Pavie, Méditerranée), sur accord ; Watkins, sur accord | idéalement un extrait méditerranéen pour le focus Ligure |
| Baleine à bosse | MBARI Pacific Sound | NPS Glacier Bay (domaine public, hydrophone de l'entrée de la baie) | |
| Cachalot | AWI *Polar Sounds* (clics réguliers, Antarctique, CC-BY 4.0) | archive WHOI DTAG, golfe du Mexique 2002 (licence à lire) ; CIBRA (Méditerranée) ; Watkins, sur accord | n'est plus une lacune si l'extrait AWI convient |
| Orque | Orcasound : appels favoris des pods J, K, L et catalogue d'appels (Ford / Osborne), CC BY-NC-SA 4.0 | NPS Glacier Bay (orques, domaine public) | écotype : résidents du Sud, à dire dans la fiche |

**Lieux** (#2) :

| Lieu | Ce qu'on entend | Source | Licence [S-r] | Remarque |
|---|---|---|---|---|
| Plateau d'Ekström (PALAOA) | frottement de banquise, collisions d'icebergs, phoques de Weddell | AWI *Polar Sounds* | CC-BY 4.0 | glace et vie dans le même lieu |
| Séisme de glace (*Bloop*, 1997) | grondement basse fréquence | NOAA PMEL ; copie Wikimedia Commons accélérée ×16 | domaine public | l'accélération ×16 est déjà dans le fichier : à afficher [A] |
| West Mata (Tonga) et volcans d'arc | éruption sous-marine, bulles de lave | NOAA PMEL (Dziak et al. 2015 ; clip « whistle » de 1997) | domaine public | |
| Glacier Bay (Alaska) | baleines à bosse, orques, phoques ; paquebots | NPS, hydrophone continu depuis 2000 | domaine public | **paire avec / sans navires** : 2020 vs années d'avant (Gabriele et al. 2021 : −3,3 à −5,1 dB en médiane). Les extraits bruts sont à demander |
| Grande Barrière de corail (Lizard Island) | récif sain (2012) / dégradé (2016) | Gordon et al. 2018 (PNAS) | article CC BY-NC-ND ; sons non déposés | **paire de contraste** ; demander les enregistrements au groupe d'Exeter |
| Baie de Monterey | navire qui passe pendant un chant de rorqual | MBARI Pacific Sound | CC-BY 4.0 | sert aussi la piste « spectrogramme vivant » (`PARCOURS_PISTES.md`, piste 8) |
| Golfe du Mexique | canon à air sismique | NOAA (2010–2024) | CC0 | bruit humain impulsif |

Demandes personnelles possibles : Watkins, CIBRA, Gordon (Exeter), NPS Glacier Bay (extraits 2019
et 2020).

Références :
- [MBARI, Soundscape Listening Room](https://www.mbari.org/soundscape-listening-room/)
- [AWI, sons des océans polaires](https://www.awi.de/en/science/climate-sciences/physical-oceanography/main-research-focus/ocean-acoustics-group/awi-ocean-acoustics-group-polar-underwater-sounds-1.html)
- [Orcasound, appels favoris des résidents du Sud](https://www.orcasound.net/learn/learn-the-favorite-calls-of-the-southern-resident-killer-whales-j-k-and-l-pods/) ; [catalogue d'appels](https://www.orcasound.net/data/processed/SRKW/call-catalog/latest.html)
- [NPS, sons enregistrés à Glacier Bay](https://home.nps.gov/glba/learn/nature/soundclips.htm) ; [Gabriele et al. 2021, Frontiers](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2021.674787/full)
- [NOAA PMEL, archives acoustiques](https://www.pmel.noaa.gov/acoustics/highlights-archived.html) ; [clip « whistle »](https://pmel.noaa.gov/acoustics/sounds/whistle.html)
- [WHOI, enregistrements DTAG de cachalots (2002)](https://darchive.mblwhoilibrary.org/entities/publication/3ce1f85f-df2b-578d-8a40-8e1a131b9498)
- [Gordon et al. 2018 (JCU)](https://researchonline.jcu.edu.au/53896/)

Règles pour chaque extrait :
- l'espèce est identifiée par la source ;
- la date et le lieu sont connus ;
- toute transposition des infrasons est signalée (rorquals ×5 aujourd'hui) ;
- le spectrogramme est calculé sur l'enregistrement original.

## 3. Fiches espèces (clic sur un animal)

| Besoin | Source | Licence [S-r] |
|---|---|---|
| Longueur, masse, noms, statut | Wikidata (P2043, P2067, P141) | CC0 |
| Taxonomie, attributs | WoRMS | CC-BY |
| Tailles maximales normalisées | MOBS 1.0 (McClain et al. 2025) | à vérifier |
| Texte naturaliste | NOAA Fisheries Species Directory ; Wikipédia FR | domaine public ; CC BY-SA (sur le texte repris) |
| Photos | NOAA (souvent domaine public, crédit demandé, quelques CC BY-SA) ; Wikimedia Commons ; iNaturalist filtré `photo_license=cc0,cc-by,cc-by-nc` | licence et crédit stockés photo par photo |
| Portée de communication | déjà calculée (`communicationRange`, équation du sonar) | [C], avec la mise en garde de `REVUE_SCIENTIFIQUE.md` §6.4 |

## 4. Pressions humaines au-delà de l'AIS

| Source | Contenu | Couverture | Licence [S-r] | Décision |
|---|---|---|---|---|
| Global Fishing Watch (existant) | présence des navires sur 30 jours, 0,1° | monde | CC BY-NC / BY-SA | garder ; mensuel possible pour les focus |
| EMODnet, densité des navires | heures/km²/mois **par type de navire**, 1 km, 2017–2023 | eaux européennes | CC-BY 4.0 | **focus Europe** |
| Registre ICES des bruits impulsionnels (avec ACCOBAMS) | battage de pieux, explosions, sismique : événements datés et localisés | OSPAR, HELCOM, Méditerranée, mer Noire | CC-BY 4.0 | **intégrer** dans les focus européens |
| Global Energy Monitor, Wind Power Tracker | parcs éoliens, en mer compris | monde | CC-BY 4.0 (formulaire) | **intégrer** : marqueurs, chantiers |
| Sismique, monde | — | pas de carte mondiale ouverte (questionnaire IWC en cours ; Oceana pour l'Atlantique Nord-Ouest) | — | **dire la lacune** |
| Sonar militaire | — | aucune position publique ; détections SanctSound seulement | — | **dire la lacune** |
| NOAA CetSound (CetMap, SoundMap) | densités et bruit modélisés | États-Unis | à vérifier | référence de comparaison |

## 5. Focus régionaux

**Principe** : une région = un **paquet de données** valable seulement dans son cadre. Il contient
des couches plus fines, une courte histoire et ses sources. Hors du cadre, la carte revient aux
couches mondiales.

**Pourquoi** :
- ne jamais étendre au globe une donnée locale ;
- les régions bien étudiées montrent ce que la science sait ;
- les autres montrent ce qu'elle ignore.

**Comment** (à concevoir dans un chantier séparé) :
- `data/focus/<id>/manifest.json` : contour, titre, espèces, couches, sons, texte, statuts, crédits.
- Rasters au format des habitats (`tools/build_habitats.py` → PNG lu par
  `client/src/whales/geo-grids.ts`) ; GeoJSON pour les événements.
- Côté client : sélecteur de focus, vol de caméra, extérieur estompé, dans l'esprit des hachures
  « terra incognita ». Légende : « données locales, valables dans ce cadre ».
- La page web autonome pèse déjà ≈ 37 Mo. Les focus se chargent donc à la demande, avec des
  extraits sonores courts (≈ 30 s, Opus).

| Focus | Histoire | Données | Intérêt |
|---|---|---|---|
| Mer Ligure / Pelagos | rorquals communs et ferries | ACCOBAMS ASI ; EMODnet 1 km ; registre ICES/ACCOBAMS ; étude Quiet-Oceans pour Pelagos (+5 à 10 dB au-dessus du naturel, pointes > +20 dB ; licence des cartes inconnue) ; scène `duo` existante | public français, déjà amorcé → **1er focus** |
| Mer des Salish | orques résidentes du Sud, en danger critique, et trafic | Orcasound en direct ; programme ECHO du port de Vancouver (ralentissement de 2023 : jusqu'à −4,2 dB par rapport à 2019, analyse préliminaire) | son en direct, effet mesuré d'une mesure réelle → **2e focus** |
| Baie de Monterey / Californie | chœur des rorquals bleus et commerce transpacifique | MBARI ; NRS11 (validation) ; trajets Movebank ; Whale Safe (indice de présence seulement) | relie l'œuvre à la validation |
| Fosse hellénique | ≈ 200–300 cachalots et collisions | Frantzis et al. 2019 (PLoS ONE) : routes décalées → risque −70 % (modèle) ; armateurs qui se détournent (ACCOBAMS 2024) | **histoire de solution** |
| Sud du Sri Lanka | rorquals bleus sur la route maritime | étude 2014–2015 : route décalée de 15 milles nautiques → risque −95 % (chiffre diffusé par IFAW) | même ressort, autre océan |
| Côte Est des États-Unis | densités mensuelles | Duke MGEL ; SanctSound (Stellwagen) | seule saisonnalité ouverte |
| Détroit de Malacca | l'un des détroits les plus fréquentés au monde | presque rien sur nos cinq espèces (études acoustiques locales sur dauphins et marsouins à Langkawi et Penang) | **focus « lacune »** : beaucoup de bruit, peu de connaissance. À présenter comme tel |

Les chiffres d'ONG (IFAW, WWF) gardent leur origine affichée. Les réductions de risque sont des
estimations de modèle, pas des baisses observées.

## 6. Priorités

1. **Fiches espèces** : Wikidata, UICN, NOAA, photos libres, tailles de groupe [O]. **Sons** MBARI
   et NOAA. C'est le plus fort apport pour le public.
2. **Enrichissement OBIS** (mois, type d'observation), test sur une espèce.
3. **Focus mer Ligure**, puis **mer des Salish** : ils posent l'architecture des focus.
4. Plus tard : Duke MGEL, SCANS-IV, registre ICES, EMODnet, éolien, IMMA, Movebank.
5. En attente d'accord (demande personnelle possible) : Watkins (hébergement), Happywhale, BlueCorridors, API
   Whale Safe, cartes Quiet-Oceans.

## Références (pages consultées)

Effectifs et répartition :
- [Duke MGEL, modèles de la côte Est](https://seamap.env.duke.edu/models/Duke/EC/)
- [SCANS-IV (TiHo)](https://www.tiho-hannover.de/en/clinics-institutes/institutes/institute-of-terrestrial-and-aquatic-wildlife-research-itaw/scans-iv-survey)
- [ACCOBAMS ASI, sujet de recherche Frontiers](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2024.1164026/pdf)
- [CBI, estimations d'effectifs](https://iwc.int/about-whales/estimate)
- [Conditions d'utilisation de la Liste rouge UICN](https://www.iucnredlist.org/terms/terms-of-use)
- [BlueCorridors (WWF)](https://wwfwhales.org/news-stories/protecting-blue-corridors-report)
- [Dépôt de données Movebank](https://datarepository.movebank.org/)
- [Happywhale sur OBIS-SEAMAP](https://seamap.env.duke.edu/dataset/1787/html)
- [IMMA, couche spatiale](https://marinemammalhabitat.org/immas/imma-spatial-layer-download/)

Sons :
- [MBARI, données acoustiques ouvertes](https://www.mbari.org/project/open-acoustic-data/)
- [Pacific Sound (documentation)](https://docs.mbari.org/pacific-sound/)
- [NOAA NCEI Passive Acoustic Data](https://www.ncei.noaa.gov/products/passive-acoustic-data)
- [Canons à air, golfe du Mexique 2010–2024 (NOAA)](https://repository.library.noaa.gov/view/noaa/72381)
- [Orcasound (AWS Open Data)](https://registry.opendata.aws/orcasound)
- [Client Python Oceans 3.0 (ONC)](https://github.com/OceanNetworksCanada/api-python-client)
- [Watkins (WHOI), conditions](https://cis.whoi.edu/science/B/whalesounds/about.cfm)
- [DOSITS, avertissement sur les droits](https://dosits.org/dosits-disclaimer/)
- [GLUBS, présentation SCOR 2025](https://scor-int.org/wp-content/uploads/2025/10/GLUBS_Presentation-2025.pdf)

Pressions humaines :
- [Registre ICES des bruits impulsionnels](https://www.ices.dk/data/data-portals/Pages/impulsive-noise.aspx)
- [EMODnet, densité des navires](https://emodnet.ec.europa.eu/geonetwork/srv/api/records/0f2f3ff1-30ef-49e1-96e7-8ca78d58a07c)
- [Global Wind Power Tracker (GEM)](https://globalenergymonitor.org/projects/global-wind-power-tracker)
- [NOAA CetSound](https://coastalscience.noaa.gov/products/cetacean-sound-mapping-cetsound/)
- [Questionnaire IWC sur les campagnes sismiques](https://iwc.int/resources/news/seismic-survey-questionnaire)

Focus régionaux :
- [Pelagos, étude trafic et bruit](https://pelagos-sanctuary.org/a-quieter-ocean-for-the-pelagos-sanctuary-a-study-on-maritime-traffic-and-underwater-noise/)
- [Rapport ECHO 2025 (port de Vancouver)](https://www.portvancouver.com/article/echo-programs-2025-annual-report-highlights-continued-collaboration-protect-risk-whales)
- [Frantzis et al. 2019, fosse hellénique](https://pmc.ncbi.nlm.nih.gov/articles/PMC6392247)
- [ACCOBAMS 2024, fosse hellénique](https://accobams.org/wp-content/uploads/2024/11/SC16.Inf18_Update-on-reducing-the-risk-of-ship-strikes-of-endangered-sperm-whales-in-the-Hellenic-Trench.pdf)
- [IFAW, Sri Lanka](https://www.ifaw.org/international/journal/research-into-blue-whale-ship-strikes-off-sri-lanka-offers-solution-to-deadly-threat)
- [Whale Safe](https://whalesafe.com/2022-year-in-review-a-look-back-at-whales-ships-in-the-santa-barbara-channel-san-francisco-region)
- [Langkawi, détroit de Malacca (Kyoto)](https://repository.kulib.kyoto-u.ac.jp/dspace/bitstream/2433/278801/1/esr01194.pdf)
