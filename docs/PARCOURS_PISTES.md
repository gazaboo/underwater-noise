# Parcours de vulgarisation : pistes (divergence)

Phase de divergence de l'[issue #4](https://github.com/gazaboo/underwater-noise/issues/4). On liste
des pistes **très différentes**, sans encore filtrer. On en prototypera ensuite 2 ou 3, contrastées,
avant de choisir un format.

Ces pistes s'appuient sur cinq briques communes aux issues #1, #2, #4 et #15. Les briques ne
présupposent aucun format de récit :

| Brique | Rôle |
|---|---|
| **A. Catalogue** | sons, photos et faits, avec provenance, crédit et statut [S]/[O]/[E]/[A] |
| **B. Enregistrements** | lecture de vrais sons dans la chaîne de masquage existante |
| **C. Scénarios** | nappe affichée ou masquée ; « océan sans navires » calculé [C] ; plus tard, d'autres scénarios |
| **D. Fiche** | panneau d'information (espèce ou lieu), ouvert au clic ou par le parcours |
| **E. Lieux** | objet placé sur le globe : zone sonore, focus régional, étape de parcours |

Une piste peut aussi demander une **caméra scriptée** (transition sur le globe, absente aujourd'hui ;
`FlatNavigator` a déjà des cibles lissées) ou un **mode inactif** (boucle qui démarre seule).

Contexte d'exposition (`docs/EXPO.md`) : demi-sphère projetée, portable 780M, son non spatialisé,
interaction minimale ou nulle. Le visiteur de 30 secondes et celui de 10 minutes doivent tous deux
repartir avec quelque chose.

---

## Les pistes

### 1. « Avant / après » en boucle
L'océan sans navires, puis le trafic qui s'allume.
- **Esquisse** : globe calme, chants clairs, portées en océan calme. Les navires apparaissent, port
  par port. La nappe monte, les chants se ferment puis se hachent, les fils entre groupes se brisent.
  Retour au calme, puis la boucle reprend.
- **Concept** : masquage, perte d'espace de communication.
- **Durée, interaction** : 2 à 3 min, aucune interaction.
- **Briques** : B, C, E (un lieu pour cadrer), mode inactif.
- **Coût** : faible une fois C posé.
- **Risque scientifique** : faible. L'« après » est le modèle actuel et l'« avant » le même modèle
  sans navires [C]. Le masquage audible reste une métaphore [A], à dire.

### 2. Puissances de dix
Du globe entier à deux rorquals communs et un ferry, puis retour.
- **Esquisse** : globe → Méditerranée → mer Ligure → duo de rorquals (`?scene=duo`). L'anneau d'appel
  part, atteint la portée sans navires, puis se brise. Un ferry passe. Retour vers le globe.
- **Concept** : échelle (de 10 000 km à 10 km) et portée de communication.
- **Durée, interaction** : 1 à 2 min, aucune interaction.
- **Briques** : C, D (fiche courte du rorqual commun), E (lieu mer Ligure), caméra scriptée.
- **Coût** : moyen, à cause de la transition de caméra sur le globe.
- **Risque scientifique** : moyen. Les portées des rorquals sont des bornes hautes
  (`REVUE_SCIENTIFIQUE.md` §6.4) ; le rapport « avec / sans navires » est ce qu'il y a de plus robuste.

### 3. Une journée d'un groupe
Point de vue d'un animal.
- **Esquisse** : la caméra suit un groupe de baleines à bosse pendant 24 h accélérées. Son espace de
  communication respire, puis se réduit au passage d'une route maritime. On entend ses chants se
  dégrader.
- **Concept** : vie d'un groupe, effet cumulé du trafic sur une journée.
- **Durée, interaction** : 3 à 5 min, aucune interaction.
- **Briques** : B, D, caméra qui suit un groupe.
- **Coût** : moyen.
- **Risque scientifique** : **élevé si mal dit**. Le groupe est une présence plausible [A], pas un
  animal suivi (voir `REPRESENTATION.md`, « Ce que représentent les cétacés »). Un trajet réel
  Movebank (balise) réduirait ce risque.

### 4. Chapitres
Parcours linéaire avancé à la télécommande ou au clavier.
- **Esquisse** : cinq chapitres courts, chacun une scène de la carte et une phrase :
  1. trafic ;
  2. décibels ;
  3. propagation ;
  4. communication ;
  5. solutions.
- **Concept** : tous, dans l'ordre.
- **Durée, interaction** : 5 à 10 min ; le visiteur avance à son rythme.
- **Briques** : toutes, plus caméra scriptée.
- **Coût** : élevé : c'est la somme des autres pistes.
- **Risque scientifique** : réparti ; chaque chapitre est relu séparément.

### 5. Points d'intérêt sur la carte libre
- **Esquisse** : la carte reste libre. Des marqueurs discrets (lieux, groupes) ouvrent une fiche et
  une micro-animation : un son, un zoom, une phrase.
- **Concept** : au choix du visiteur.
- **Durée, interaction** : libre ; interaction forte.
- **Briques** : D, E, B.
- **Coût** : faible à moyen.
- **Risque scientifique** : faible, porté par les fiches.
- **Remarque** : idéal pour le web autonome, peu adapté au dôme.

### 6. Le tour du monde des sons
- **Esquisse** : le globe tourne de lieu en lieu (glace de l'Antarctique, récif, volcan sous-marin,
  Challenger Deep, Glacier Bay). Chaque fois, on entend le vrai paysage sonore, puis le même masqué
  par les navires de la région.
- **Concept** : l'océan n'est pas silencieux ; le bruit humain s'ajoute à un monde sonore riche.
- **Durée, interaction** : boucle de 3 à 5 min, aucune interaction.
- **Briques** : A, B, E, caméra scriptée (ou rotation du globe actuelle avec arrêts, voir `dwell`).
- **Coût** : faible à moyen ; il dépend surtout de la collecte des sons.
- **Risque scientifique** : faible, car ce sont de vrais enregistrements [S]. La conversion du ΔL
  local en masquage est [A].

### 7. L'échelle des décibels, à l'oreille
- **Esquisse** : un navire, puis 10, puis 100, à la même distance : +10 dB, puis +20 dB, avec le niveau
  affiché et l'énergie ×10, ×100. Un encart dit pourquoi on ne compare pas les dB dans l'air et dans
  l'eau.
- **Concept** : échelle logarithmique ; addition des sources.
- **Durée, interaction** : 1 min, aucune interaction.
- **Briques** : C ; une scène dédiée avec quelques navires simulés.
- **Coût** : moyen : il faut une scène hors carte, ou une zone de la carte isolée.
- **Risque scientifique** : moyen. La confusion entre dB dans l'air et dans l'eau est fréquente et
  doit être désamorcée explicitement.

### 8. Le spectrogramme vivant
- **Esquisse** : un vrai enregistrement d'hydrophone (MBARI, baie de Monterey) où un navire passe
  pendant que chante un rorqual bleu. Le spectrogramme défile : le chant et le moteur occupent la
  même bande. Puis le même extrait sans le navire (avant son passage).
- **Concept** : fréquences ; masquage réel, mesuré et non simulé.
- **Durée, interaction** : 1 à 2 min, aucune interaction.
- **Briques** : A, B, D (lecteur et spectrogramme).
- **Coût** : faible une fois l'extrait trouvé.
- **Risque scientifique** : très faible : c'est une donnée brute [S]. C'est la piste la plus
  « vraie ».

### 9. Ce que voit l'AIS
Données et incertitude.
- **Esquisse** : navires AIS réels seuls, puis les navires estimés (GFW) qui s'ajoutent, puis la
  terra incognita. Une phrase : « ici, l'AIS ne voit presque rien ».
- **Concept** : comment on sait ce qu'on montre ; les limites des données.
- **Durée, interaction** : 1 min, aucune interaction.
- **Briques** : C (couches) ; les modes de navires existent déjà (touche N).
- **Coût** : faible.
- **Risque scientifique** : faible ; il diminue même le risque global, en montrant les limites.

### 10. Les solutions : ralentir, dévier
- **Esquisse** : dans un lieu (mer des Salish, fosse hellénique, sud du Sri Lanka), on applique une
  mesure réelle : ralentir les navires ou décaler une route. On voit la nappe baisser et les portées
  revenir.
- **Concept** : ce qui marche, avec un effet calculé.
- **Durée, interaction** : 1 à 2 min, aucune interaction.
- **Briques** : C (scénario « vitesse plafonnée »), D, E.
- **Coût** : moyen. Le niveau source dépend déjà de la vitesse (`sourceLevelDecidecade`,
  `shared/src/acoustics/jomopans-echo.ts`) : plafonner la vitesse est donc un calcul [C]. Décaler une
  route demanderait des trajectoires modifiées : coût plus élevé.
- **Risque scientifique** : moyen. Il faut citer les effets mesurés à part (ECHO : jusqu'à −4,2 dB,
  analyse préliminaire) et ne pas les confondre avec ceux du modèle.

### 11. Le modèle face au réel
- **Esquisse** : en un point d'hydrophone (NRS11, Monterey), on écoute l'enregistrement réel et on lit
  le niveau calculé par le modèle. On dit aussi où ils divergent, y compris l'échec de validation
  (#6).
- **Concept** : comment la science se vérifie ; ce que le modèle sait et ne sait pas.
- **Durée, interaction** : 2 min ; mieux adapté au web qu'au dôme.
- **Briques** : A, B, D, E.
- **Coût** : moyen.
- **Risque scientifique** : faible si l'on montre honnêtement l'écart.

---

## Tableau de synthèse

| # | Piste | Concept principal | Durée | Interaction | Dôme | Web | Briques | Coût | Risque scientifique |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Avant / après | masquage | 2–3 min | aucune | ++ | + | B C E | faible | faible |
| 2 | Puissances de dix | échelle, portée | 1–2 min | aucune | ++ | + | C D E + caméra | moyen | moyen |
| 3 | Journée d'un groupe | vie d'un groupe | 3–5 min | aucune | + | + | B D + caméra | moyen | élevé |
| 4 | Chapitres | tous | 5–10 min | avancer | + | ++ | toutes | élevé | réparti |
| 5 | Points d'intérêt | au choix | libre | forte | − | ++ | B D E | faible–moyen | faible |
| 6 | Tour du monde des sons | richesse sonore | 3–5 min | aucune | ++ | + | A B E | faible–moyen | faible |
| 7 | Échelle des dB | logarithme | 1 min | aucune | + | + | C + scène | moyen | moyen |
| 8 | Spectrogramme vivant | fréquences, masquage réel | 1–2 min | aucune | + | ++ | A B D | faible | très faible |
| 9 | Ce que voit l'AIS | incertitude | 1 min | aucune | + | + | C | faible | faible |
| 10 | Solutions | ralentir, dévier | 1–2 min | aucune | ++ | + | C D E | moyen | moyen |
| 11 | Modèle face au réel | vérification | 2 min | faible | − | ++ | A B D E | moyen | faible |

Toutes les pistes, sauf la 9, utilisent au moins deux des briques B, C, D et E. Les construire d'abord
ne ferme donc aucune option.

Une boucle d'attraction n'est pas une piste en soi : c'est un **enchaînement** de pistes courtes et
sans interaction (1, 2, 6, 8, 9, 10), interrompu dès qu'un visiteur interagit.

## Prochaine étape : prototypes

Proposition de 2 ou 3 prototypes contrastés, à confirmer :

| Prototype | Pourquoi | Contraste |
|---|---|---|
| **1. Avant / après** | le cœur du propos, peu coûteux | boucle passive, émotion |
| **2. Puissances de dix** | fait sentir l'échelle ; pose la caméra scriptée | narration guidée, zoom |
| **5. Points d'intérêt** | format du web autonome | exploration libre |

La piste 8 (spectrogramme vivant) peut s'ajouter dès qu'un bon extrait MBARI est trouvé : elle coûte
peu et elle est entièrement sourcée.

## Prototypes réalisés (lot 6, 25 octobre 2026)

Trois prototypes jouables, décrits dans `data/parcours/*.json` et lus par `client/src/story/story.ts` :

| Parcours | Piste | Durée | Ce qu'il montre |
|---|---|---|---|
| `avant-apres` | 1 | ≈ 55 s, en boucle | Monterey sans navires (portées calmes [C]), puis le trafic actuel, puis la paire de contraste réelle du lieu, puis le monde |
| `puissances-de-dix` | 2 | ≈ 50 s, en boucle | du globe à la Méditerranée, puis à la mer Ligure (anneaux d'appel), puis la fiche d'un rorqual commun, retour |
| `tour-des-lieux` | 6 | ≈ 85 s, en boucle | les cinq lieux à écouter, chacun avec sa fiche et son son |

La piste 5 (points d'intérêt) n'a pas de script : c'est la carte libre avec les lieux et les fiches (lots 4 et 5).

**Comment les lancer** : touche `H` (parcours suivant ; `H` de nouveau pour arrêter), `?parcours=<id>` dans
l'adresse, bouton « Visite guidée » du web autonome. Boucle d'attraction : `parcours.attract` (un id) et
`parcours.idleSec` dans la config ; désactivée par défaut, c'est un choix d'exposition.

**Règles** :
- chaque légende qui affirme quelque chose porte un statut et une source (vérifié par `shared/test/parcours.test.ts`) ;
- un geste du visiteur (toucher, molette, touche) arrête le parcours et restaure le scénario, la nappe et le mode ;
  un geste dans la fiche la laisse ouverte ;
- la légende permanente est masquée pendant le parcours ; elle revient ensuite ;
- sur le dôme, le parcours n'ouvre pas de fiche (panneau hors du disque) et ne change pas de mode.

Vérification : `CHROMIUM_PATH=/chemin/chrome node scripts/verify-parcours.mjs` (`MODE=hemisphere` pour le dôme).

## Test avec des non-spécialistes

Pour chaque prototype, 3 à 5 personnes, sans explication préalable :
- **compris** : « qu'est-ce qui se passe à l'écran ? » ;
- **retenu** : le lendemain, « qu'est-ce qui vous reste ? » ;
- **ressenti** : un mot ;
- **erreurs** : noter toute idée fausse, par exemple « une baleine est ici maintenant » ou « les dB
  de l'eau sont ceux de l'air ».

Converger ensuite : choisir le format, écrire le scénario détaillé, ouvrir les issues d'implémentation,
puis faire relire chaque scène avant l'expo.
