# Vignettes des ornements (monde illustré)

1. `render_cells.py` (Blender, Cycles) compose et rend chaque vignette en 512×512 : bosquets à partir du pack
   *Ultimate Stylized Nature* de Quaternius (CC0, dossier `Blends`), montagnes, volcans, fumées et nuages
   procéduraux. Sortie : un PNG par vignette et `cells.json`.
2. `pack_atlas.py` réduit en 256×256 (couleurs prémultipliées), ajoute un liseré sombre (lisibilité au
   projecteur), assemble `data/ornaments/atlas.png` et `atlas.json`.

```bash
blender -b --factory-startup -noaudio --python tools/ornaments/render_cells.py -- <Blends> <dossier>
blender -b --factory-startup -noaudio --python tools/ornaments/render_cells.py -- <Blends> <dossier> volcano,mesa
python3 tools/ornaments/pack_atlas.py <dossier>
```

Remplacer une vignette par une gouache scannée : déposer un PNG 512×512 à fond transparent, point d'ancrage
au sol à 24 % du bas (50 % pour fumées et nuages), sous le même nom dans `<dossier>`, puis relancer
`pack_atlas.py`.
