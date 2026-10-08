# Calculateur de salaire brut ⇄ net — Tunisie 2026

Application web statique (HTML, CSS, JavaScript, sans étape de construction)
qui calcule :

- le **salaire net** à partir du brut ;
- le **salaire brut** nécessaire pour obtenir un net donné (calcul inverse exact).

Il couvre le **secteur privé (CNSS)** et le **secteur public (CNRPS)**.
Le détail est présenté étape par étape (cotisations, revenu imposable,
déductions, impôt, contribution sociale, net), en mensuel et en annuel, avec un
graphique de répartition et un coût employeur indicatif.

> **Résultat indicatif.** Ce calculateur ne remplace pas un calcul de paie
> officiel ni l'avis d'un professionnel (expert-comptable, CNSS, administration
> fiscale).

**En ligne :** <https://mohamed-ja.github.io/portail-rh/calculateur-salaire/>
(une fois la branche fusionnée dans `main`, voir « Déploiement »).

## Sommaire

- [Utilisation](#utilisation)
- [Règles appliquées](#règles-appliquées)
- [Méthode de calcul](#méthode-de-calcul)
- [Mettre à jour les paramètres](#mettre-à-jour-les-paramètres)
- [Lancer les tests](#lancer-les-tests)
- [Lancer en local](#lancer-en-local)
- [Déploiement sur GitHub Pages](#déploiement-sur-github-pages)
- [Structure du dossier](#structure-du-dossier)
- [Limites](#limites)

## Utilisation

1. Choisissez le sens du calcul (**Brut → net** ou **Net → brut**), le
   secteur (**privé · CNSS** ou **public · CNRPS**) et la période
   (**mensuel** ou **annuel**), puis le nombre de **salaires versés par an**
   (12 = salaire mensuel seul ; 13 = 12 salaires + un 13e mois ; 14, 15…).
2. Saisissez le montant (virgule décimale acceptée : `2 500,750`).
3. Indiquez la situation familiale : chef de famille, enfants à charge,
   enfants étudiants non boursiers, enfants handicapés, parents à charge.
4. Options : primes imposables, primes imposables non soumises à cotisation,
   avantages en nature, indemnités non imposables, taux accidents du travail et
   TFP réduite (coût employeur, secteur privé).

Le résultat se met à jour à chaque saisie. En mode **Net → brut**, un encadré
confirme que le net recalculé à partir du brut trouvé est égal au net saisi.

### Fonctions avancées

- **Lien de partage** : l'adresse de la page contient toujours la simulation
  en cours (`?m=2500&chef=1&enf=2…`). Le bouton *Partager ce calcul* la copie
  (ou ouvre le partage du téléphone) ; le lien rouvre exactement le même calcul.
- **Comparateur** : bouton *Comparer* → scénarios A et B (onglets), tableau
  des écarts B − A (cotisations, impôt, net, coût employeur, taux de
  prélèvement). Les deux scénarios sont inclus dans le lien de partage.
- **Simulateur d'augmentation** : hausse en net, en brut ou en %, avec la
  hausse du coût employeur et le coût d'un dinar net supplémentaire ; le
  bouton *Comparer avec la situation actuelle* crée le scénario B.
- **Graphiques** : répartition du brut ; « sur 1 dinar dépensé par
  l'employeur » (salarié, caisse sociale, État) ; courbe du net selon le brut
  avec les bandes du taux marginal de l'IRPP, lisible au survol et au clavier.
- **Lignes modifiées** : après chaque changement, les lignes des tableaux dont
  la valeur a changé s'éclairent brièvement (désactivé si « réduire les
  animations » est demandé par le système).
- **Application installable et hors connexion** : manifeste, icônes, service
  worker (`sw.js`) et code QR d'installation.
- **Signature commune** aux quatre simulateurs de l'auteur, avec liens croisés.

## Règles appliquées

Paramètres de l'année **2026**, vérifiés le **6 octobre 2026**.
Secteur privé : régime des salariés non agricoles (CNSS). Secteur public :
agents de l'État, des collectivités locales et des établissements publics
(CNRPS). Seules les cotisations diffèrent ; l'impôt est identique.

| Élément | Valeur 2026 | Source |
|---|---|---|
| CNSS salarié | 9,18 % du brut + 0,5 % fonds perte d'emploi = **9,68 %**, sans plafond | Loi n° 60-30 du 14/12/1960 et textes modificatifs ; loi n° 2024-48 du 09/12/2024 (LF 2025), art. 17 |
| CNSS employeur | 16,57 % + 0,5 % = **17,07 %** | Mêmes textes |
| CNRPS agent public | retraite 9,2 % + maladie 2,75 % + capital décès 1 % = **12,95 %** | Loi n° 85-12 ; loi n° 2019-37 du 30/04/2019 ; décret n° 2007-1406 ; décrets n° 74-572 et 93-308 |
| CNRPS employeur public | retraite 14,5 % + maladie 4 % = **18,5 %** ; FOPROLOS 1 % ; ni TFP ni cotisation accidents du travail | Loi n° 2019-37 ; décret n° 2007-1406 ; loi n° 77-54 |
| Frais professionnels | **10 %** du revenu après cotisations, plafonnés à **2 000 DT/an** | Code IRPP-IS, art. 26-I ; loi n° 2016-78 (LF 2017), art. 14 |
| Chef de famille | **300 DT/an** | Code IRPP-IS, art. 40-I ; loi n° 2017-66 (LF 2018), art. 54 |
| Enfant à charge (< 20 ans) | **100 DT/an** par enfant, 4 premiers enfants | Code IRPP-IS, art. 40-II ; LF 2018, art. 54 |
| Enfant étudiant non boursier (< 25 ans) | **1 000 DT/an** (dans la limite des 4 enfants) | Code IRPP-IS, art. 40-III ; loi n° 2013-54 (LF 2014), art. 94 |
| Enfant handicapé | **2 000 DT/an**, sans condition d'âge ni de rang | Code IRPP-IS, art. 40-III ; LF 2018, art. 55 |
| Parent à charge | **5 %** du revenu net, plafonné à **450 DT** par parent (2 au plus) | Code IRPP-IS, art. 40-IV ; loi n° 2019-78 (LF 2020), art. 41 |
| Barème IRPP annuel | 0 % jusqu'à 5 000 ; 15 % jusqu'à 10 000 ; 25 % jusqu'à 20 000 ; 30 % jusqu'à 30 000 ; 33 % jusqu'à 40 000 ; 36 % jusqu'à 50 000 ; 38 % jusqu'à 70 000 ; **40 %** au-delà | Code IRPP-IS, art. 44 ; loi n° 2024-48 (LF 2025) |
| Contribution sociale de solidarité (CSS) | **0,5 %** du revenu net imposable ; dispense si ce revenu ≤ **5 000 DT/an** | Loi n° 2017-66 (LF 2018), art. 53 ; décret-loi n° 2022-79 (LF 2023), art. 22 ; loi n° 2025-17 (LF 2026), art. 87 et note DGELF de janvier 2026 ; dispense : loi n° 2019-78 (LF 2020), art. 39 |
| Coût employeur privé (indicatif) | Accidents du travail selon l'activité (0,5 % par défaut, modifiable) ; TFP 2 % (1 % industries manufacturières) ; FOPROLOS 1 % | Décret n° 95-538 ; loi n° 77-54 du 03/08/1977 |
| SMIG (repère d'affichage) | 554,736 DT/mois (48 h) ; 470,251 DT/mois (40 h) | Décret n° 2026-67, JORT du 30/04/2026 |

### Sources consultées

- Paramètres législatifs d'[OpenFisca-Tunisia](https://github.com/openfisca/openfisca-tunisia)
  (dépôt consulté le 06/10/2026), qui référencent les textes au JORT et les
  notes communes de la DGELF.
- [La Presse de Tunisie, 14/01/2026 — CSS : nouvelles modalités confirmées pour 2026](https://www.lapresse.tn/2026/01/14/contribution-sociale-de-solidarite-nouvelles-modalites-confirmees-pour-lannee-2026/)
  (note DGELF sur l'article 87 de la LF 2026).
- [JurisiteTunisie — LF 2025, fonds d'assurance contre la perte d'emploi](https://www.jurisitetunisie.com/tunisie/codes/lf2025/loifinances2025-17_fr.html).
- [JurisiteTunisie — taux des cotisations à la CNRPS](https://www.jurisitetunisie.com/tunisie/index/CNRPS.htm)
  et [CLEISS — les cotisations en Tunisie](https://www.cleiss.fr/docs/cotisations/tunisie.html)
  pour le recoupement des taux CNRPS.
- [Managers, 30/04/2026 — nouveau SMIG](https://managers.tn/2026/04/30/voici-le-nouveau-smig-en-tunisie/).
- Sites de paie et de fiscalité consultés pour recoupement :
  [compta.tn — LF 2026](https://www.compta.tn/blog/loi-de-finances-2026-tunisie-mesures-fiscales/),
  [paie-tunisie.com — taux CNSS](https://paie-tunisie.com/412/fr/73/publications/taux-des-cotisations-cnss).

### Points tranchés

- **CSS 2026.** Une source secondaire affirmait sa suppression en 2026 ;
  l'article 87 de la LF 2026 et la note de la DGELF la **maintiennent à 0,5 %**
  pour les personnes physiques. C'est la règle retenue (validée par le
  propriétaire du projet).
- **Anciens montants.** Certaines pages citent encore 150 DT (chef de famille),
  90/75/60/45 DT (enfants), 1 200 DT (enfant handicapé) ou 150 DT (parent) : ce
  sont des montants antérieurs aux LF 2014, 2018 et 2020.
- **Assiette de la CSS.** Elle est calculée sur le revenu net imposable (après
  déductions familiales), pas sur le brut.

## Navigation de l'interface

Les six vues **Synthèse**, **Détail**, **Comparer**, **Augmentation**,
**Employeur** et **Courbe** sont accessibles depuis une navigation qui reste
visible pendant le défilement. Une seule vue est affichée à la fois, avec
le résultat principal commun aux six vues.

Les informations sont regroupées dans quatre onglets : **Salaire**, **Famille**, **Primes**
et **Options**. Sur ordinateur, elles restent à gauche du résultat. Sur
téléphone, le bouton **Ma situation** ouvre le formulaire dans un panneau ;
**Voir mon résultat** le referme. Les informations déjà saisies sont conservées
lors des changements d'onglet. Fermer le panneau annule uniquement une
modification du nombre de salaires qui n'a pas été validée.

Le **Guide & informations** rassemble l'installation, les sources, la méthode
et les autres simulateurs. Les onglets sont utilisables au clavier et les
animations respectent la préférence de réduction des mouvements.

## Nombre de salaires par an (13e mois, primes)

Beaucoup d'entreprises versent plus de 12 salaires par an (13e mois, primes
de bilan ou de rentrée versées comme un mois de salaire). Le calculateur
accepte de 12 à 18 versements. Le champ et les boutons − / + sont verrouillés
par défaut : choisissez **Modifier**, ajustez le nombre, puis **Valider** pour
appliquer la modification et reverrouiller. **Annuler** (ou la touche Échap)
conserve la valeur précédente. La saisie en cours ne change ni le calcul ni
le lien de partage avant validation. La molette ne modifie jamais ce champ.
Le changement de scénario et la réinitialisation rétablissent le verrou.

Le calcul distingue :

- **Revenu annuel** = salaire de base × nombre de salaires + primes,
  avantages et indemnités mensuels × 12. L'impôt annuel (IRPP, CSS) est
  calculé sur ce total.
- **Mois type** : le salaire régulier, avec la retenue mensuelle calculée sur
  12 mois. C'est le net affiché « par mois ».
- **Versements supplémentaires** : chacun égal au salaire de base ; ils
  supportent le complément d'impôt de l'année (taux marginal), d'où un net
  inférieur à celui d'un mois normal. Exemple : 2 500 DT bruts, chef de
  famille, 2 enfants, 13 salaires → 12 × 1 862,018 DT + 1 × 1 569,310 DT
  = 23 913,530 DT net par an.
- Les tableaux affichent alors deux colonnes : **Mois type** et
  **Année · N salaires**.
- En calcul **net → brut** mensuel, le net visé est celui du mois type ; en
  saisie annuelle, c'est le net de l'année entière.

Le minimum et le maximum se règlent dans `config/parametres.js`
(`versements`).

## Méthode de calcul

Le calcul est **annuel**, comme la retenue à la source : un salaire mensuel est
multiplié par 12, puis les montants annuels sont ramenés au mois.

1. **Brut** = salaire de base + primes imposables (soumises ou non à
   cotisation) + avantages en nature.
2. **Cotisations** = (brut − primes non soumises à cotisation) × 9,68 % (CNSS)
   ou × 12,95 % (CNRPS).
3. **Revenu après cotisations** = brut − cotisations.
4. **Frais professionnels** = min(10 % × revenu après cotisations ; 2 000 DT).
5. **Revenu net** = revenu après cotisations − frais professionnels.
6. **Déductions familiales** : chef de famille ; enfants (accordées au chef de
   famille, 4 premiers rangs, étudiants comptés en priorité) ; enfants
   handicapés (sans limite de rang) ; parents à charge.
7. **Revenu net imposable** = revenu net − déductions (au moins 0).
8. **IRPP** = barème progressif appliqué tranche par tranche.
9. **CSS** = 0,5 % × revenu net imposable, sauf si celui-ci ≤ 5 000 DT.
10. **Salaire net** = brut − cotisations − IRPP − CSS.
11. **Net à payer** = salaire net − avantages en nature (non versés en espèces)
    + indemnités non imposables.

### Calcul inverse (net → brut)

Le barème progressif empêche une formule directe. Le salaire de base est
cherché par **dichotomie** : on encadre la solution entre deux bruts, puis on
coupe l'intervalle en deux jusqu'à une précision bien inférieure au millime
(200 itérations au plus). Le net est ensuite **recalculé** à partir du brut
trouvé et comparé au net saisi (tolérance : un demi-millime).

Le net croît avec le brut, à une exception près : quand le revenu imposable
franchit 5 000 DT, la CSS s'applique d'un coup sur tout le revenu, ce qui fait
baisser le net d'environ 25 DT par an. La dichotomie garde toujours
`net(bas) < cible ≤ net(haut)`, ce qui l'empêche de s'arrêter sur ce saut :
elle trouve toujours un brut exact. Dans cette petite zone, deux bruts peuvent
donner le même net ; les tests le vérifient.

## Mettre à jour les paramètres

Tous les taux, plafonds, tranches et l'année sont dans
[`config/parametres.js`](config/parametres.js). La logique
([`js/calcul.js`](js/calcul.js)) n'en contient aucun.

Chaque année, après la publication de la loi de finances :

1. Ouvrez `config/parametres.js`.
2. Modifiez `annee` et `dateVerification`.
3. Ajustez les valeurs concernées, par exemple :
   - une nouvelle tranche : ajoutez `{ de: 80000, taux: 0.42 }` dans
     `irpp.bareme` (bornes croissantes) ;
   - un nouveau taux de cotisation : changez `taux` dans
     `regimes.prive` (CNSS) ou `regimes.public` (CNRPS), parties `salarie`
     ou `employeur`, ou ajoutez une ligne ;
   - la CSS : `css.taux` (mettre `0` si elle est supprimée) et
     `css.seuilDispense` ;
   - les déductions : `irpp.deductions` ; les frais professionnels :
     `irpp.fraisProfessionnels`.
4. Mettez à jour le champ `source` de chaque valeur modifiée, puis le tableau
   « Règles appliquées » de ce README.
5. Incrémentez `VERSION` dans `sw.js` (par exemple `calc-salaire-v3`) pour que
   les applications installées récupèrent les nouveaux paramètres.
6. Adaptez les montants attendus dans `tests/calcul.test.js` et lancez les
   tests.

L'interface lit les libellés (montants de déduction, taux affichés) dans ce
même fichier : rien d'autre à modifier.

## Lancer les tests

Il faut [Node.js](https://nodejs.org) 18 ou plus récent, aucune dépendance à
installer.

```bash
cd calculateur-salaire
npm test            # ou : node --test tests/*.test.js
```

50 tests couvrent : le barème, des cas typiques, le SMIG, les bas salaires
(ni IRPP ni CSS), les très hauts salaires (tranche à 40 %), le salaire nul,
les entrées invalides, les plafonds (frais professionnels, 4 enfants,
parents), les primes et avantages, le coût employeur, le **secteur public
(CNRPS)**, et **1 600 allers-retours brut → net → brut** sur huit profils
(privé et public), plus un balayage fin autour du seuil de la CSS ; ainsi que
l'augmentation (en net, en brut, en %), la courbe net/brut, la répartition
d'un dinar de coût employeur et le lien de partage (aller-retour, valeurs
invalides, deux scénarios) et le nombre de salaires par an (13e mois,
15 à 18 salaires, saisie annuelle, calcul inverse, augmentation).

## Lancer en local

Ouvrez simplement `index.html` dans un navigateur (double-clic) : l'application
fonctionne sans serveur. Pour la servir comme en ligne :

```bash
cd calculateur-salaire
python3 -m http.server 8080   # puis http://localhost:8080
```

## Déploiement sur GitHub Pages

Le dépôt `portail-rh` publie déjà la branche `main` sur GitHub Pages
(dossier racine). Le calculateur est un sous-dossier autonome :

1. Fusionnez la branche dans `main` (demande de fusion sur GitHub).
2. Vérifiez dans **Settings → Pages** : *Source* « Deploy from a branch »,
   branche `main`, dossier `/ (root)`.
3. Après une à deux minutes, l'application est en ligne à
   `https://mohamed-ja.github.io/portail-rh/calculateur-salaire/`.

Le fichier `.nojekyll` à la racine du dépôt évite le traitement Jekyll. Tous
les chemins sont relatifs : le dossier peut aussi être déplacé tel quel dans
un dépôt dédié.

## Structure du dossier

```
calculateur-salaire/
├── index.html            Page unique (formulaire + résultats)
├── config/parametres.js  Paramètres légaux de l'année (seul fichier à mettre à jour)
├── js/calcul.js          Moteur de calcul pur (brut → net, net → brut, augmentation, courbe)
├── js/etat.js            État d'une simulation ⇄ lien de partage (pur, testé)
├── js/salaire.js         Interface : saisie, résultat animé, sections, courbe, partage
├── js/theme-init.js      Thème clair/sombre appliqué avant affichage
├── sw.js                 Service worker (hors connexion)
├── manifest.webmanifest  Application installable (nom, icônes, couleurs)
├── css/salaire.css       Styles « Lumineux et vivant » (jetons, composants, mouvement)
├── assets/               Icônes, QR d'installation, image d'aperçu, polices auto-hébergées
├── tests/                Tests automatisés (calcul.test.js, fonctions.test.js)
├── DESIGN.md             Système visuel
├── package.json          Scripts `npm test` et `npm run serve`
└── LICENSE               Licence MIT (code) et mentions des polices
```

## Limites

- Régimes agricoles et des travailleurs indépendants non couverts.
- Secteur public : l'assiette CNRPS dépend du statut ; les indemnités exclues
  se saisissent dans « primes non soumises à cotisation ». Les régimes
  spéciaux (membres du gouvernement, militaires…) ne sont pas traités.
- Calcul sur une année pleine à salaire constant : pas de régularisation
  annuelle, de prime de fin d'année ponctuelle, d'heures supplémentaires ni
  d'arrondis propres à un logiciel de paie.
- Les conditions des déductions (âge, études, ressources des parents, statut
  de chef de famille) ne sont pas vérifiées : elles sont supposées remplies.
- Le coût employeur ignore les exonérations ou aides à l'emploi.

## Les autres simulateurs

L'application renvoie vers les autres simulateurs du même auteur :
[crédit](https://mohamed-ja.github.io/simulateur-credit/),
[assurance vie et CEA](https://mohamed-ja.github.io/simulateur-assurance-vie/)
et [assurance automobile](https://mohamed-ja.github.io/simulateur-Assurance-Automobile/).

## Licence

Code sous licence MIT (voir [LICENSE](LICENSE)). Polices Mona Sans et JetBrains
Mono sous licence SIL Open Font License 1.1.

