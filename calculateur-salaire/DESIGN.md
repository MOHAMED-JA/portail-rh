# Design du calculateur de salaire

## Un espace de travail compact

La synthèse reste commune aux six vues : Synthèse, Détail, Comparer,
Augmentation, Employeur et Courbe. La navigation est persistante et les
fonctions ne sont plus empilées dans une longue page.

Le formulaire comporte quatre onglets : Salaire, Famille, Primes et Options.
Sur ordinateur, il reste à gauche des résultats. Sur téléphone, il s'ouvre
dans un dialogue natif, avec retour au résultat en une action. Les sources,
l'installation et les autres simulateurs sont réunis dans un guide séparé.

## Identité visuelle

Thème clair par défaut, avec conservation du thème choisi par l'utilisateur.
Le thème sombre reste disponible. Palette de l'espace définie dans
`css/workspace.css`, chargé après les composants de `css/styles.css` :

| Usage | Clair | Sombre |
|---|---|---|
| Fond | #f3f5f7 | #0b151e |
| Surface | #ffffff | #12232e |
| Texte | #142c38 | #eff7f8 |
| Accent | #087f74 | #70ddc5 |

La carte de résultat utilise un fond navy #142c38 et un montant menthe
#98f0d9 dans les deux thèmes. Manrope pour l'interface, JetBrains Mono
pour les montants ; polices auto-hébergées. Rayons de 12 à 20 pixels,
ombres discrètes, cibles tactiles d'au moins 44 pixels pour les contrôles
principaux. Aucun montant décoratif : toutes les données viennent du moteur.

## Mouvement et accessibilité

- Transitions d'onglets : 210 ms, opacité et translation courte.
- Ouverture des dialogues : 220 ms, translation et légère mise à l'échelle.
- Compteurs et graphiques : animations existantes conservées.
- `prefers-reduced-motion` désactive les déplacements et les compteurs animés.
- Onglets avec rôles ARIA, navigation par flèches, Début/Fin et focus visible.
- Dialogues natifs : focus contenu dans le panneau, fermeture par Échap,
  retour au contrôle d'ouverture.
- Défilement interne limité aux formulaires et tableaux longs ; aucun
  verrouillage de la hauteur de la page qui couperait les informations.

## Fichiers

`index.html` organise les vues et conserve les identifiants du calculateur.
`js/workspace.js` gère uniquement la navigation, les dialogues et les résumés.
Le moteur `js/calcul.js` et les règles `config/parametres.js` restent inchangés.
