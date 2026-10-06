# DESIGN.md — Calculateur de salaire

Mode : **Operate** (outil). L'interface doit disparaître derrière la tâche :
saisir un montant, lire un résultat juste, comprendre d'où il vient.

## Direction : « instrument »

Un tableau de bord de précision, sombre par défaut (thème clair disponible).
Le futurisme vient de la rigueur, pas de l'ornement : chiffres en police à
chasse fixe, filets fins, une seule couleur d'accent, une trame de points
discrète en fond. Ni verre dépoli, ni dégradés de texte, ni halos colorés.

## Tokens (définis une seule fois dans `css/styles.css`, `:root`)

| Rôle | Sombre | Clair |
|---|---|---|
| Fond | `#070b14` | `#eef2f8` |
| Surface / surface 2 / surface 3 | `#0d1422` / `#131c2e` / `#1a2539` | `#ffffff` / `#f4f7fb` / `#e8eef6` |
| Texte / secondaire / tertiaire | `#e8eef8` / `#b0bdd0` / `#8a98ae` | `#0b1220` / `#3d4a60` / `#57647a` |
| Accent (actions, état actif, net) | `#4fe3c1` | `#0a7a66` |
| Alerte | `#f5b450` | `#8a5300` |
| Graphique : net / CNSS / IRPP / CSS | `#4fe3c1` `#7aa7ff` `#f5b450` `#ff7a90` | `#0f9e85` `#3d6fe0` `#c27a0e` `#d6455f` |

Contraste : texte ≥ 4,5:1 sur toutes les surfaces (audit axe-core, WCAG 2.2 AA).

### Typographie

- **Manrope** (variable, auto-hébergée) pour toute l'interface.
- **JetBrains Mono** pour les montants uniquement (chiffres tabulaires, zéro
  barré) : c'est une donnée mesurée, pas un costume.
- Échelle 1,2 : 12 · 14 · 16 · 19 · 23 · 28 px ; montant principal
  `clamp(36px → 52px)`, interlettrage −0,04 em.

### Espacements et formes

Base 4 px : 4 · 8 · 12 · 16 · 24 · 32 · 48. Rayons 8 / 12 / 18 px, pilules
pour les compteurs. Cibles tactiles ≥ 44 px.

## Mouvement

| Élément | Durée | Courbe | Raison |
|---|---|---|---|
| Compteurs du résultat | 420 ms | ease-out quartique (JS), interruptible | montrer le sens et l'ampleur du changement |
| Barre de répartition | 380 ms | `cubic-bezier(0.23, 1, 0.32, 1)` sur `transform` | transition interruptible, GPU |
| Curseur des contrôles segmentés, interrupteur | 220 ms | même courbe | continuité spatiale |
| Pression des boutons | 140 ms | `scale(0.9–0.98)` | retour immédiat |
| Apparition des panneaux | 480 ms, décalage 50 ms | une seule fois au chargement | entrée unique, pas de chorégraphie répétée |

`prefers-reduced-motion: reduce` : aucun déplacement ; seules les couleurs et
l'opacité changent, les compteurs affichent directement la valeur finale.
Les survols sont limités aux appareils à pointeur fin.
