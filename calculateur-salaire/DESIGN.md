# Design du calculateur de salaire — « Lumineux et vivant »

Un fond clair, d'énormes chiffres noirs et un grand bloc de couleur franche pour chaque poste du salaire. On comprend son net d'un coup d'œil, puis on voit où part chaque dinar. Le tout tient sur une seule page, sans onglets, avec des champs classiques et clairs.

## Principes

- **Lisible d'abord** : le net s'affiche en très grand, en noir sur blanc. Une seule police sans empattement sert partout, et tous les chiffres sont tabulaires.
- **Une couleur, un poste**, la même partout : net = vert, caisse (CNSS/CNRPS) = bleu, impôt (IRPP) = violet, solidarité (CSS) = jaune. Elle s'applique aux blocs, aux légendes, à la grille des 100 dinars, au coût employeur et à la courbe.
- **Vivant, jamais bavard** : le mouvement confirme une action ou montre un changement de proportion. Rien ne bouge pendant la frappe.
- Aucun montant décoratif : tout vient du moteur (`js/calcul.js`, `config/parametres.js`).

## Jetons (`css/salaire.css`)

| Rôle | Clair | Sombre |
|---|---|---|
| Fond `--fond` | #F4F5F7 | #0B0D12 |
| Carte `--carte` | #FFFFFF | #14171F |
| Champ `--champ` | #F4F5F7 | #1B1F29 |
| Filet `--filet` / `--filet-fort` | #E3E5EA / #C9CDD6 | #262A35 / #3A4050 |
| Encre `--encre` / `-2` / `-3` | #0B0D12 / #414652 / #5B6170 | #F3F4F7 / #C3C7D1 / #9AA0AE |
| Net (bloc / texte / fond doux) | #19C37D / #087A4C / #DDF7EA | #19C37D / #4ADE9B / #10291F |
| Caisse | #3B82F6 / #1D5FD0 / #E1ECFE | #3B82F6 / #7AA9FF / #13213A |
| Impôt | #7C3AED / #6D28D9 / #EEE6FD | #7C3AED / #B49CFF / #221839 |
| Solidarité | #F5B70A / #8A6100 / #FDF2CF | #F5B70A / #FACC4B / #2D250D |

Le texte posé sur un bloc est noir, sauf sur le violet, où il est blanc. Toutes les paires de couleurs ont été vérifiées en AA.

## Typographie (polices libres, auto-hébergées)

- **Mona Sans** (variable, largeur 100–125 %) est la seule police de l'interface : titres larges et serrés, net géant (graisse 800), libellés, montants.
- **JetBrains Mono** est réservée au détail ligne par ligne.

## Composants

- **Saisie** : un grand champ montant, puis des bascules à pastille glissante (brut/net, mois/an, privé/public). Viennent ensuite un interrupteur « chef de famille » et des compteurs ± (enfants, salaires par an de 12 à 18). « Plus d'options » regroupe les cas rares.
- **Résultat** : un libellé, le net géant avec des rouleaux de chiffres et des millimes plus petits, puis une phrase de contexte. Les quatre blocs de couleur ont une largeur égale à leur part du brut. Une légende en cartes douces donne les montants et les pourcentages. Les actions viennent en dernier : partager, comparer, imprimer.
- **Sections** :
  - sur 100 dinars de brut (grille de 100 carrés) ;
  - augmentation (curseur, barres avant/après) ;
  - coût employeur (blocs) ;
  - deux offres (cartes à barre de net) ;
  - détail ligne par ligne (empilé sur téléphone) ;
  - courbe net = f(brut).
- **Résultat miniature** (téléphone) : une barre sombre fixe en bas, affichée tant que le net n'est pas à l'écran.

## Mouvement (`--sortie` .23,1,.32,1 · `--ressort` .34,1.45,.64,1 · `--tiroir` .32,.72,0,1)

- **Arrivée** : le titre, la saisie puis le résultat montent en cascade (520 ms, 60 ms de décalage).
- **Changement de réglage** : les chiffres roulent avec un léger rebond (420 ms, de droite à gauche). Les blocs se redimensionnent par ressort (560 ms) et clignent une fois. Pendant la frappe, l'affichage est **instantané**.
- **Pastilles et interrupteurs** : glissement à ressort (300–320 ms). Les compteurs sautent légèrement quand on les change. Les boutons s'enfoncent à `scale(.97)` à l'appui.
- **Défilement**, une seule fois par section :
  - chaque section apparaît en montant ;
  - les 100 carrés se remplissent en cascade (7 ms par carré) ;
  - la courbe se trace (900 ms).
- `prefers-reduced-motion` : aucune cascade, aucun roulement, aucun tracé. L'état final s'affiche directement.

## Accessibilité

WCAG 2.1 AA vérifié par axe-core, en clair et en sombre, à 1440 et 390 px :

- les bascules sont de vrais boutons radio et les interrupteurs des cases `role="switch"` ;
- le résultat est annoncé après la frappe, pas à chaque touche ;
- la courbe se pilote au clavier ;
- le tableau défilable peut recevoir le focus ;
- la méthode et les sources s'ouvrent dans un dialogue natif ;
- les cibles tactiles font au moins 40 à 44 px.

## Fichiers

- `index.html` : structure.
- `css/salaire.css` : jetons, composants, mouvement.
- `js/salaire.js` : interface et rendu.
- `js/theme-init.js` : thème appliqué avant l'affichage.

Le moteur `js/calcul.js`, les règles `config/parametres.js` et l'état partageable `js/etat.js` sont inchangés et testés. La copie de l'Espace Finances TN est produite par `scripts/importer-salaire.py` du dépôt espace-finances-tn.
