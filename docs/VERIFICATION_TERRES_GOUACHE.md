# Vérification des terres gouache — 15 octobre 2026

Branche `terres-gouache`, reprise du commit `cc72bb3`. Les vérifications visuelles utilisent Brave (Chromium), WebGL2 et **SwiftShader**, fenêtre 1280×800, profil `light`. Les captures vérifient le rendu et les masques ; elles ne mesurent pas les performances de la Radeon 780M ni le résultat physique du projecteur.

## Contrôles

| Contrôle | Résultat |
|---|---|
| Typage TypeScript | Réussi |
| Vitest | 74 tests réussis |
| Compilation Vite | Réussie ; avertissement préexistant sur `geo-grids.ts` |
| JavaScript et compilation GLSL | Aucune erreur |
| Aplat nuit et jour, extras coupés | Zéro octet différent de l'ancien shader, entrées et temps identiques |
| Arbres, papier, volcans, fumée | Chaque commande modifie effectivement les pixels attendus |
| Volcans désactivés | Même image que sans leur passe de dessin |
| Étoiles et halo | Modifient uniquement le mode globe |
| Demi-sphère, fisheye, équirect | Coins hors du masque noirs, même avec papier et étoiles activés |
| Écran → projecteur | Réglages des terres et de la palette de jour conservés |
| Panneau P | Construction, choix aplat/gouache et cases des trois extras |
| Enregistrement | Réglages `land` et palette de jour relus par l'API ; configuration locale initiale restaurée après l'essai |

Le test comparatif emploie les mêmes textures, uniformes, cadrage et temps pour les shaders actuel et initial. Les tests unitaires supplémentaires couvrent la transmission du zoom, le cadrage géographique et le zoom nul de la texture monde.

## Captures

| Vue | Capture |
|---|---|
| Carte nuit | [Nuit](captures/terres-gouache/nuit.png) |
| Carte jour | [Jour](captures/terres-gouache/jour.png) |
| Arbres en Amazonie | [Amazonie](captures/terres-gouache/amazonie.png) |
| Volcans des Andes | [Andes](captures/terres-gouache/andes.png) |
| Islande | [Islande](captures/terres-gouache/islande.png) |
| Indonésie, volcans et fumée | [Indonésie](captures/terres-gouache/indonesie.png) |
| Globe, étoiles et halo | [Globe](captures/terres-gouache/globe.png) |
| Demi-sphère | [Demi-sphère](captures/terres-gouache/hemisphere.png) |
| Fisheye | [Fisheye](captures/terres-gouache/fisheye.png) |
| Équirectangulaire | [Équirectangulaire](captures/terres-gouache/equirect.png) |
| Cible projecteur | [Projecteur](captures/terres-gouache/projecteur.png) |
| Réglages | [Panneau](captures/terres-gouache/panneau.png) |

## Reproduire

Lancer `npm run dev` dans le worktree. Le script optionnel `scripts/verify-land.mjs` utilise Playwright Core (installation séparée, non requise par l'application) et un navigateur Chromium :

```bash
PLAYWRIGHT_MODULE=/chemin/vers/playwright-core/index.mjs \
CHROMIUM_PATH=/chemin/vers/chromium \
node scripts/verify-land.mjs
```

Sans `PLAYWRIGHT_MODULE`, le script cherche le paquet `playwright-core`. Le navigateur par défaut est Brave dans `/opt/brave.com/brave/brave`. `VACARME_URL` permet de changer l'URL locale (par défaut `http://localhost:5173/`). Le script régénère les captures et teste brièvement la sauvegarde ; il restaure ensuite le fichier local préexistant, ou retire celui créé par l'essai. L'exécuter sans édition simultanée de la configuration.

## À vérifier sur le matériel d'exposition

Avec `D`, comparer les temps GPU de l'aplat sans extras et de la gouache avec extras en 1920×1200, profils `expo` et `light`. Objectif : 60 images/s. Contrôler les noirs, les terres de nuit et le bord de la demi-sphère sur l'Epson EB-990U ; aucune performance matérielle n'est déduite des captures SwiftShader.
