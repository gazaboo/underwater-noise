# Modèles originaux du pilote

`modeles.blend` conserve les dix modèles avec matériaux à couleurs de sommets, une planche de présentation et son éclairage. Les modèles exportés sont centrés sur leur pied, axe vertical Y dans les GLB. Ils ne contiennent aucune ressource externe.

`build_assets.py` reconstruit les sources et exporte deux niveaux de détail par modèle :

```bash
ALSOFT_DRIVERS=null blender -b -noaudio --python tools/diorama/build_assets.py
```

Le projet utilise Blender 5.2. Les messages d'indisponibilité de Draco/MeshOptimizer sont sans incidence : les GLB sont volontairement exportés sans ces extensions. La version système utilisée lors du chantier signale aussi une incompatibilité OpenColorIO et emploie son mode de repli pour la planche Blender ; les couleurs du rendu applicatif ont été contrôlées séparément dans Chromium.

Les formes, matériaux et proportions sont artistiques. Les modèles de volcans ne sont pas des relevés de volcans individuels. Voir `docs/DIORAMA_PILOTE.md` pour l'intégration, les limites et les vérifications.
