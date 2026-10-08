# Design du calculateur de salaire — « Billet de dinar »

Le net est un billet que l'on imprime pour la personne : le calcul se lit comme une coupure de banque, pas comme un tableau de bord. Une seule page, sans onglets ; la saisie est une phrase à compléter.

## Monde visuel

Impression monétaire : papier de billet clair légèrement vert, encre taille-douce vert profond, violet de sécurité, or de feuille, rouge de numérotation. Les guilloches, la rosace et le micro-texte sont **dessinés par le code** et **portent de vraies données** :

- la rosace du billet a autant de lobes que de salaires par an (12 à 18) ; son amplitude suit la part du brut que la personne garde ;
- le micro-texte en bas du billet et des billets d'offre répète les vrais montants (net, brut, CNSS, IRPP, CSS) ;
- le numéro de série rouge est formé du salaire de base, de la caisse et du nombre de salaires ;
- le fil de sécurité (« Où partent vos dinars ») porte les parts réelles en micro-texte.

Aucun montant décoratif : tout vient du moteur (`js/calcul.js`, `config/parametres.js`).

## Jetons (`css/billet.css`)

| Rôle | Clair | Sombre (« tirage de nuit ») |
|---|---|---|
| Papier (fond) `--papier` | #EAEFE8 | #0B1411 |
| Billet (surfaces) `--billet` | #F6F8F2 | #13201B |
| Filet `--filet` | #CBD6CC | #22352E |
| Encre `--encre` / `--encre-2` / `--encre-3` | #0E3B34 / #34524B / #4E6760 | #E8F0EA / #BACBC2 / #93A89E |
| Trame (guilloches) `--trame` / `--trame-forte` | vert à 16 % / 30 % | menthe à 14 % / 28 % |
| Net, actions `--vert` | #0E6B57 | #7FD6B8 |
| Cotisations (CNSS/CNRPS) `--bleu` | #1E5A86 | #8EC1F0 |
| Impôt (IRPP) `--violet` | #4B2E83 | #B9A2F0 |
| Solidarité (CSS) `--or` / `--or-feuille` | #7D5A10 / #C9A44C | #E2C46F / #B8933A |
| Numérotation `--rouge` | #A3202B | #FF8A8A |

Couleur des données : net = vert, caisse = bleu, impôt = violet, CSS = or, partout (billet, coupons, fil, pièces de l'employeur).

## Typographie (polices libres, auto-hébergées)

- **Bodoni Moda** (didone, axe optique) : titres et partie entière du net géant, filigrane, titres des billets d'offre. Jamais pour des montants avec décimales : la virgule d'une didone se lit comme un point.
- **Mona Sans** : interface, phrase de saisie, tous les montants secondaires (chiffres tabulaires), millimes du net. Même police que l'Espace Finances TN.
- **JetBrains Mono** : numéros de série, micro-texte, colonnes chiffrées du détail.

## Composants

- **Phrase de saisie** : champs « blancs » en pointillés intégrés au texte, listes dimensionnées sur le choix affiché, compteurs ± (icônes SVG). « Préciser ma situation » regroupe les cas rares.
- **Billet** (2,05:1 sur grand écran) : libellé, série rouge, net géant à rouleaux de chiffres, phrase d'explication, filigrane « % du brut gardé », ligne de contexte, micro-texte.
- **Coupons** : retenues (caisse, IRPP, CSS) rattachées au billet par une rangée de trous poinçonnés, séparées par des tirets, talon numéroté ; jamais de survol « carte ».
- **Billets d'offre** : même grammaire en réduit (trame, série, micro-texte) pour comparer deux offres.
- **Billet miniature** (téléphone) : barre fixe en bas tant que le net n'est pas entièrement à l'écran.
- **Sections** : où partent vos dinars (fil de sécurité), augmentation (curseur), coût employeur (pièces), deux offres, détail ligne par ligne (empilé sur téléphone), courbe net = f(brut) (version étroite sur téléphone).

## Mouvement

- Un seul moment marquant au chargement : la planche du billet se dévoile (clip-path, 720 ms), puis l'encre apparaît (flou 4 px → net, 420 ms).
- Réimpression : les chiffres roulent (300 ms, décalés de droite à gauche) sur un changement de liste ou de compteur ; **instantané pendant la frappe**.
- Rosace : morphing du tracé (420 ms) quand le nombre de salaires ou la part gardée change.
- Coupons : décalage de 3 px le long de la perforation quand leur montant change.
- Courbes : `--sortie` cubic-bezier(.23,1,.32,1), `--mouvement` (.77,0,.175,1), `--tiroir` (.32,.72,0,1). Boutons : `scale(.97)` à l'appui.
- `prefers-reduced-motion` : pas de dévoilement, de roulement ni de déplacement ; les fondus restent.

## Accessibilité

WCAG 2.1 AA vérifié par axe-core (clair, sombre, 1440 et 390 px) : libellés de chaque blanc de la phrase, annonce du résultat sans bavardage pendant la frappe, courbe pilotable au clavier, tableau défilable focalisable, dialogue natif pour la méthode et les sources, cibles de 44 px.

## Fichiers

`index.html` (structure), `css/billet.css` (monde et composants), `js/billet.js` (interface, guilloches, rendu), `js/theme-init.js` (thème avant affichage). Le moteur `js/calcul.js`, les règles `config/parametres.js` et l'état partageable `js/etat.js` sont inchangés et testés. La copie de l'Espace Finances TN est produite par `scripts/importer-salaire.py` du dépôt espace-finances-tn.
