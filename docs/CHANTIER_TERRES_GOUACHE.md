# Chantier : terres « gouache » façon Petit Prince

Document de reprise (pour un humain ou un autre agent, ex. Codex). Branche : **`terres-gouache`**
(partie de `main` au commit 2390e66). Ne pas fusionner dans `main` sans l'accord de l'auteur.

## Objectif

Remplacer les continents en aplat (`palette.land`, noir la nuit) par des terres peintes, inspirées des
illustrations du *Petit Prince* (référence visuelle : littleprince.dev), sans voler la vedette aux ondes.

Décisions prises avec l'auteur :

| Sujet | Décision |
|---|---|
| Style | gouache / aquarelle en 2D, dans le shader de composition (léger pour la Radeon 780M) |
| Nuit (installation) | terres **discrètes mais belles** : sombres, chaudes ; ondes et lueur restent le sujet |
| Couleurs des milieux | **Natural Earth II** (NE2_HR_LC, domaine public), stylisées dans le shader |
| Extras | ciel étoilé autour du globe ; petits arbres et volcans au zoom ; grain de papier global |
| Bascule | **chaque extra doit pouvoir être activé/désactivé** (config + panneau `P`) ; `land.style: 'flat'` rend l'ancien rendu |
| Traçabilité | chaque nombre est étiqueté : sourcé / ordre de grandeur / empirique / **artistique** |

## Fait (vérifié : `npm run typecheck` OK, `vitest` 71/71, `config/default.json5` valide pour le schéma)

1. **Données** — `tools/build_landcover.py` (nouveau, lancé par `npm run data` après `build_bathymetry.py`) :
   - télécharge `NE2_HR_LC.zip` (21600×10800, sans relief ombré ni eau) dans `tools/.cache/` ;
   - écrit `data/grid/landcover_4096.png` (RGBA, même convention que `elevation_4096.png` :
     u = (lon+180)/360, ligne 0 au nord). RGB = couleur NE II, prolongée de 8 px sur la mer pour que le
     filtrage linéaire ne fasse pas déborder de bleu sur les côtes ; A = indice de forêt (excès de vert de
     la palette NE II, seuils `12/255` à `40/255` ; **artistique**, ≈ 15 % des terres > 0,5) ;
   - écrit `data/grid/volcanoes.json` : `[lon, lat, altitude m, année de dernière éruption | null]`,
     1 099 volcans holocènes **émergés** (Smithsonian GVP, service WFS public ; les sous-marins sont exclus) ;
   - complète `data/grid/meta.json` (sources, encodages, date d'extraction GVP).
   - Couleurs NE II mesurées (pastel) : Amazonie (137,188,145), Sahara (242,237,211), taïga (164,199,173),
     Groenland (227,236,247). D'où `land.saturation` 1,7 par défaut.
2. **Schéma** — `shared/src/config-schema.ts` :
   - `palette.landLight` (unit) et `palette.landTint` (couleur) : surchargeables par `dayPalette` ;
   - section `land` : `style`, `saturation`, `steps`, `relief`, `brushScale`, `brushWarp`, `granulation`,
     `wetEdge`, `ornaments{enabled,minZoom,treeDensity,volcanoes,volcanoSize,smokeSinceYear}`,
     `paper{enabled,strength,scale}`, `stars{enabled,density,twinkle,halo}`.
3. **Configuration** — `config/default.json5` : valeurs commentées (palette nuit `landLight 0.3`,
   `landTint #ffdcb4` ; jour `0.95`, `#fff4e4` ; section `land` complète).
4. `package.json` : `npm run data` lance aussi `build_landcover.py`.

**Rien n'est encore branché côté client** : le rendu à l'écran est inchangé tant que l'étape 1 ci-dessous
n'est pas faite.

## Reste à faire (dans l'ordre)

### 1. Chargement — `client/src/assets.ts`
- Ajouter `landcover: THREE.Texture` à `WorldAssets` (`cachedBitmap('/data/grid/landcover_4096.png')`,
  `dataTexture(…, THREE.LinearFilter)` : octets intacts, pas de prémultiplication — l'alpha est une donnée).
- `loadVolcanoes(): Promise<Array<[number, number, number, number | null]>>` (fetch du JSON).
- Vérifier que le serveur sert bien `/data/grid/*` (c'est le cas pour les autres PNG).

### 2. Shader des terres — `client/src/render/flat-view.ts` (`COMPOSITE_FRAG`)
Aujourd'hui, en fin de `main()` : `col = mix(mix(sea, uLand, land), uCoast, min(coast, 1.0));`.
Remplacer `uLand` par `landCol` calculé **seulement si `land > 0.0`** (branche ; ne pas utiliser
`fwidth`/`dFdx` dedans, l'anticrénelage se fait avec la taille d'un pixel en degrés = `1.0 / uScale`).
Nouveaux uniformes : `uLandcover`, `uLandStyle` (0 aplat, 1 gouache), `uLandLight`, `uLandTint`,
`uLandSat`, `uLandSteps`, `uLandRelief`, `uBrushScale`, `uBrushWarp`, `uGranulation`, `uWetEdge`,
`uTrees` (0/1 × fondu), `uTreeDensity`. Étapes :
1. Coordonnées pinceau : `p = vec2(lon * cos(radians(lat)), lat) / uBrushScale` ; déformation
   `uv + (vec2(fbm(p), fbm(p + 5.2)) - 0.5) * uBrushWarp * uBrushScale` converti en uv (÷360, ÷180).
   Réutiliser `vnoise` / `fbm` / `hash`, qui existent déjà.
2. Couleur : `texture(uLandcover, uvWarp).rgb`, saturation `mix(vec3(luma), c, uLandSat)`.
3. Aplats : luminance quantifiée en `uLandSteps` paliers à transitions douces
   (`floor(L*n) + smoothstep(0.5-w, 0.5+w, fract(L*n))`, w ≈ 0,15) puis `c *= Lq / L`.
4. Relief : **réutiliser `ax`, `ay`** déjà calculés pour le fond marin ; normale
   `normalize(vec3(-ax, -ay, ~4000.0))`, lumière `(-0.6, 0.5, 0.62)` ; ombre vers un bleu froid,
   lumière vers un jaune chaud, intensité `uLandRelief`.
5. Granulation : `c *= 1.0 - uGranulation * 0.15 * (fbm(p * 6.0) - 0.5)`.
6. Bord mouillé : `frac` (canal B de `uElevL`) entre 0,5 et 0,7 → assombrir de `uWetEdge * 0.4`.
7. Arbres (si `uTrees > 0`) : trois niveaux de grilles en degrés (1°, 0,25°, 0,0625°), chacun en fondu quand
   sa cellule fait ≥ ~14 px (`cell * uScale`) ; par cellule : `hash(cellId)` < `forest(A au centre) * uTreeDensity`
   → houppier rond (rayon ≈ 0,2 cellule, borné par `0.45 * cos(lat)`), reflet en haut à gauche, petit tronc,
   ombre portée. Couleur : vert de la forêt assombri. Coordonnées locales x multipliées par `cos(lat)`.
8. Teinte finale : `landCol = c * uLandTint * uLandLight` ; `uLandStyle == 0` → `uLand` (rendu d'origine
   strictement inchangé).
- Le « zoom » n'est pas connu de `FlatView` : ajouter `zoom` à `FlatTransform` (`computeFlatTransform` :
  `nav?.zoom ?? 1` ; `worldTransform` : `0`, donc pas d'ornements dans la texture monde des modes globe,
  trop petite de toute façon). Fondu des ornements entre `minZoom` et `minZoom * 1.5`.
- `render()` : remplir les uniformes depuis `cfg.land` et `cfg.palette.landLight/landTint`.

### 3. Volcans — nouveau `client/src/render/volcanoes.ts`
- Calquer l'affichage de `client/src/render/ships.ts` (`DISPLAY_VERT`/`DISPLAY_FRAG`, `THREE.Points`,
  positions lon/lat → pixels avec `uCenter`, `uScale`, `uResolution`, `uLatRange`).
- Attributs : `aLatLon`, `aAlt`, `aSmoke` (1 si dernière éruption ≥ `smokeSinceYear`, seuil **artistique**).
- Fragment (`gl_PointCoord`) : petit cône en gouache (brun-gris, cratère sombre, flanc éclairé à gauche),
  panache de fumée animé (`uTime`) si `aSmoke`. Mélange alpha **normal** (pas additif).
- Taille : `volcanoSize * pixelRatio * zoom^0.35`, fondu par zoom comme les arbres. Dessiné dans `App.frame`
  (`client/src/app.ts`) juste après `this.flat.render(...)` en carte plate, **avant** les navires.

### 4. Papier et étoiles
- Papier (`land.paper`) : dans la finition de `COMPOSITE_FRAG` (bloc après `if (!uFinish)`) et dans celle de
  `GLOBE_FRAG` (`client/src/render/globe-view.ts`). Fibres en espace écran (fbm anisotrope + `hash`, échelle
  `scale`), multiplicatif faible + très léger ajout pour rester visible sur les noirs. Dans `GLOBE_FRAG`,
  seulement si `hit` (rien sur le mur autour de la demi-sphère).
- Étoiles (`land.stars`) : `GLOBE_FRAG`, **uniquement `uMode == 1`** et hors du disque (`!hit`) : grille de
  cellules hachées, étoiles chaudes/froides, scintillement lent (`twinkle`) ; halo d'atmosphère autour du
  limbe à partir de la distance minimale du rayon au centre `sqrt(dot(ro,ro) - b*b)` (`halo`).
  Jamais en demi-sphère, fisheye ni équirect.
- `GlobeView.render` reçoit déjà `cfg` : y lire `cfg.land.paper` et `cfg.land.stars`.

### 5. Panneau et enregistrement
- `client/src/ui/panel.ts` : dossier « Terres (gouache) » : `style` (gouache / aplat), `landLight`,
  `landTint` (couleur), `saturation`, `steps`, `relief`, `brushScale`, `brushWarp`, `granulation`, `wetEdge` ;
  sous-dossiers avec case à cocher pour **ornements**, **papier**, **étoiles** et leurs réglages.
  Ajouter `landLight`/`landTint` aux boucles des dossiers « Palette » et « Palette de jour ».
- `client/src/app.ts`, `save()` : ajouter `land: c.land` au corps envoyé (sinon non enregistré).

### 6. Documentation
- `docs/SOURCES_DONNEES.md` : Natural Earth II (Tom Patterson, domaine public, NE2_HR_LC) ;
  Smithsonian GVP, *Volcanoes of the World* (citation demandée par le GVP, date d'extraction dans `meta.json`).
- `docs/REVUE_SCIENTIFIQUE.md` et `README.md` : couleurs des terres = **artistique** d'après NE II ;
  indice de forêt et arbres = **artistique** (pas une mesure de couverture forestière) ; volcans =
  **positions sourcées**, dessin et seuil de fumée artistiques. Mentionner `land.style: 'flat'`.

### 7. Vérification
1. `npm run typecheck && npm test`.
2. `npm run dev` puis Chromium : carte plate nuit et jour (`?theme=day`), zoom sur l'Amazonie, les Andes,
   l'Islande et l'Indonésie (arbres, volcans, fumée), `?mode=globe` (étoiles, halo), `?mode=hemisphere`
   (rien hors du disque), `?display=projector`.
3. Chaque bascule dans le panneau `P` : style aplat (doit redonner exactement l'ancien rendu), ornements,
   papier, étoiles.
4. Diagnostic `D` sur le portable (Radeon 780M) : temps GPU avant/après en 1920×1200, objectif 60 images/s ;
   sinon fbm à 3 octaves ou ornements coupés dans le profil `light`.

## Repères utiles
- Plan approuvé d'origine : `~/.claude/plans/memoized-toasting-tide.md` (machine de l'auteur).
- Rendu : carte plate = `COMPOSITE_FRAG` (tout est composé par pixel en lon/lat) ; modes globe = la même
  passe dessinée dans une texture « monde » équirectangulaire (`worldTransform`, `uFinish = false`), puis
  reprojetée par `GLOBE_FRAG`.
- Couleurs : pas de conversion colorimétrique (`hexToVec3`, `NoColorSpace`) : la couleur choisie est celle affichée.
- Contraintes d'exposition : portable Radeon 780M, projecteur Epson EB-990U (noirs gris), demi-sphère
  éclairée par un seul projecteur.
