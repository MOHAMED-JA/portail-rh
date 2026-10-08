# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Salariés tunisiens et grand public, en priorité : une personne qui veut comprendre son salaire net, évaluer une offre d'emploi ou préparer une négociation d'augmentation, souvent sur téléphone. Les RH et employeurs restent servis (coût employeur, comparaison), mais en second plan, à la demande.

## Product Purpose
Calculer au millime le salaire net à partir du brut (et l'inverse), selon les règles tunisiennes 2026 (CNSS ou CNRPS, IRPP, CSS, situation de famille, 12 à 18 salaires par an), et rendre ce calcul compréhensible : où va chaque dinar. Réussite : la personne repart en sachant son net, pourquoi, et ce que changerait une hausse ou un autre contrat.

## Positioning
Moteur de calcul transparent et testé (50 tests), sources officielles citées, calcul local dans le navigateur, gratuit, en français ; le même moteur alimente l'Espace Finances TN où les simulations s'enregistrent.

## Operating Context
Consulté sur téléphone et ordinateur, souvent au moment d'une décision (offre, entretien, fiche de paie). Partage par lien et QR code. Installable (PWA) et utilisable hors connexion sur le portail public. Deux déploiements : `portail-rh/calculateur-salaire` (public, GitHub Pages) et `espace-finances-tn/public/outils/salaire` (Espace, avec barre d'enregistrement et compte).

## Capabilities and Constraints
- Brut → net et net → brut exact (dichotomie), mensuel ou annuel, 12 à 18 salaires (verrouillage avant modification).
- Secteur privé (CNSS 9,68 %) ou public (CNRPS 12,95 %), chef de famille, enfants, étudiants, handicapés, parents à charge.
- Primes imposables, non cotisables, avantages en nature, indemnités non imposables, taux AT, industrie manufacturière.
- Résultats : net, détail des retenues, répartition du brut, coût employeur et « 1 dinar de coût employeur », comparateur A/B, simulateur d'augmentation, courbe net = f(brut).
- Lien de partage (paramètres d'adresse, contrat `js/etat.js`), thème clair/sombre mémorisé, impression.
- Contraintes : site statique sans build ; moteur `js/calcul.js`, règles `config/parametres.js` et état `js/etat.js` inchangés et testés ; CSP stricte dans l'Espace (aucun script en ligne) ; l'Espace attend `window.EspaceOutil` (etat, resume, nomParDefaut, charger).

## Brand Commitments
Signature commune « Application développée par Mohamed Aziz Jaouadi » (lien LinkedIn) et liens vers les autres simulateurs du même auteur. Langue française, montants en dinars au millime (format tunisien, espace fine et virgule).

## Evidence on Hand
Barèmes et taux officiels 2026 dans `config/parametres.js` avec sources ; aucun témoignage, aucun chiffre d'usage : ne pas en inventer.

## Product Principles
1. Un seul grand chiffre d'abord : le net, puis l'explication.
2. Parler comme une personne : phrases simples, pas de jargon sans définition.
3. Jamais de chiffre décoratif : tout vient du moteur.
4. Moins d'écrans, plus de clarté : progression naturelle plutôt qu'une grille d'onglets.
5. Le calcul doit se sentir vivant : chaque changement se voit et se comprend.

## Accessibility & Inclusion
WCAG 2.1 AA : contrastes, clavier complet, lecteurs d'écran (annonces des résultats), cibles tactiles 44 px, mouvement réduit respecté.
