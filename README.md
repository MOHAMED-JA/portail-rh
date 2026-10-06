# Portail RH

Portail de ressources humaines complet, **en français**, pour une entreprise de
50 à 500 personnes : congés et autorisations, présences et pointeuse, fiches
d'objectifs et d'évaluation, notes de frais, formations, organigramme, dossier
du collaborateur, prêts, compétences, mobilité interne, analyses RH…

**▶ Essayer tout de suite, sans rien installer :
[mohamed-ja.github.io/portail-rh](https://mohamed-ja.github.io/portail-rh/)** —
cliquez sur un profil pour entrer. Cette démonstration tourne entièrement dans
votre navigateur ; les fonctions qui demandent un serveur (e-mails, pointeuse,
documents PDF…) s'essaient en installant le portail (voir « Démarrer »).

> **Démonstration** : toutes les données sont fictives. La société « Veltaris »
> et ses collaborateurs n'existent pas ; toute ressemblance serait fortuite.

Le projet cherche des **retours d'utilisateurs** : ouvrez une *issue* pour
signaler un défaut, une incompréhension ou une idée (voir « Donner votre avis »).

**Nouveau : [calculateur de salaire brut ⇄ net (Tunisie 2026)](calculateur-salaire/)**
— application autonome dans le dossier `calculateur-salaire/` (secteurs
privé CNSS et public CNRPS, IRPP, CSS, déductions familiales, calcul inverse
exact). Voir son
[README](calculateur-salaire/README.md).

## Aperçu des fonctions

| Domaine | Ce que fait le portail |
|---|---|
| Congés et absences | Demandes, circuit de validation N+1 puis RH, solde calculé en direct (jours ouvrés, fériés), report au 31 décembre, remplaçant pendant une absence, validation automatique après 48 h |
| Présences | Pointages, anomalies et justificatifs, plannings d'équipe (siège, télétravail, terrain…), liaison avec une pointeuse (export CSV ou lecture réseau) |
| Objectifs et évaluation | Fiche d'objectifs pondérés, évaluation par le N+1, note de comportement par les RH (80 % / 20 %), fiches validées en lecture seule |
| Organisation | Organigramme dessiné (arbre ou liste) centré sur la direction générale, pôles regroupés sous leur responsable, unités vacantes signalées ; structures et responsables (mention « par intérim ») ; remplacement d'un responsable avec prévisualisation |
| Dossier RH | Carrière, documents, attestations PDF vérifiables par QR code, bilan individuel |
| Pilotage | Tableau de bord d'équipe, indicateurs, bilan social, analyses, qualité des données, **prévisions RH sur 12 mois** (présence prévue par pôle, départs connus et probables, effectifs projetés et besoins de recrutement, fiabilité des données) |
| Assistant RH | Questions en français (solde, demandes, valideur, règles, équipe…) avec réponses calculées dans le périmètre de chacun, demandes pré-remplies à vérifier ; relais facultatif vers une IA, désactivé par défaut |
| Autres | Notes de frais, formations, avances sur salaire ou sur primes et prêt social (plafonds réglables), compétences et succession, offres internes, accidents du travail, dossier disciplinaire, entretiens de sortie |
| Sécurité | Sessions JWT fermées au changement de mot de passe, mots de passe robustes, blocage après 5 échecs, double authentification (TOTP, codes à usage unique), pièces jointes servies après connexion et contrôle des droits, dépôts vérifiés et limités, chiffrement des données sensibles, journal d'audit, copies de secours testées |

L'interface fonctionne sur ordinateur et sur téléphone (application web
installable).

## Démarrer

Ce guide s'adresse à quelqu'un qui n'a jamais installé de logiciel de ce type.
Comptez une dizaine de minutes la première fois. Le portail tourne **sur votre
ordinateur** et s'utilise dans votre navigateur (Edge, Chrome, Firefox…) ;
aucune donnée n'est envoyée sur Internet.

### Ce qu'il faut installer : uniquement Python

Le portail a besoin de **Python 3.11 ou plus récent** (gratuit). Rien d'autre
n'est à installer à la main : au premier lancement, le portail télécharge
lui-même ses composants (serveur web FastAPI et Uvicorn, base de données
SQLAlchemy, création des PDF ReportLab, fichiers Excel openpyxl…, voir
`backend/requirements.txt`). Une connexion Internet est donc nécessaire **au
premier lancement seulement**.

**Installer Python sous Windows :**

1. Ouvrez https://www.python.org/downloads/ et cliquez sur le bouton jaune
   **Download Python 3.x**.
2. Ouvrez le fichier téléchargé.
3. ⚠️ Sur le premier écran, **cochez la case « Add python.exe to PATH »** en
   bas de la fenêtre. Sans elle, le portail ne trouvera pas Python.
4. Cliquez sur **Install Now**, attendez la fin, puis sur **Close**.

> Python est déjà installé ? Ouvrez l'invite de commandes (touche Windows,
> tapez `cmd`, Entrée) et tapez `python --version` : il faut 3.11 ou plus.

### Étape 1 — Télécharger le portail

1. Sur la page du projet, https://github.com/MOHAMED-JA/portail-rh, cliquez
   sur le bouton vert **< > Code**, au-dessus de la liste des fichiers.
2. Cliquez sur **Download ZIP**.
3. Le fichier **`portail-rh-main.zip`** arrive dans votre dossier
   **Téléchargements**.

### Étape 2 — Décompresser le fichier ZIP

1. Ouvrez le dossier **Téléchargements**.
2. Faites un **clic droit** sur `portail-rh-main.zip`, puis
   **Extraire tout…**, puis **Extraire**.
3. Vous obtenez un dossier **`portail-rh-main`**. Ouvrez-le : vous devez y voir
   le fichier **`DEMARRER.bat`** et les dossiers `backend`, `assets`…

> ⚠️ Ne lancez pas le portail depuis l'intérieur du ZIP (double-clic sur le ZIP
> sans l'extraire) : il ne fonctionnerait pas. Vous pouvez déplacer le dossier
> extrait où vous voulez, par exemple sur le Bureau.

### Étape 3 — Lancer le portail (Windows)

1. Dans le dossier `portail-rh-main`, **double-cliquez sur `DEMARRER.bat`**.
2. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur
   **Informations complémentaires**, puis **Exécuter quand même** (le fichier
   vient d'Internet, d'où l'avertissement).
3. Une fenêtre noire s'ouvre. **La première fois, patientez deux à trois
   minutes** : elle installe les composants
   (dans `%LOCALAPPDATA%\Portail-RH\venv`) et crée une base de démonstration.
4. Votre navigateur s'ouvre ensuite tout seul sur **http://127.0.0.1:8100**,
   la page de connexion du portail.

> ⚠️ Une fenêtre nommée **« Portail RH - SERVEUR (ne pas fermer) »** reste
> ouverte, réduite dans la barre des tâches : c'est elle qui fait tourner le
> portail. **La fermer arrête le portail.**

**Les fois suivantes**, double-cliquez simplement sur `DEMARRER.bat` : le
portail démarre en quelques secondes, sans Internet.

### Problèmes fréquents

| Message ou symptôme | Solution |
|---|---|
| « Python 3.11 ou plus récent est introuvable » | Installez Python (voir plus haut) en cochant bien « Add python.exe to PATH », puis relancez `DEMARRER.bat`. |
| « L'installation des composants a échoué » | Vérifiez la connexion Internet (ou le proxy de l'entreprise), puis relancez `DEMARRER.bat`. |
| « Le serveur n'a pas répondu après 60 secondes » | Ouvrez la fenêtre « Portail RH - SERVEUR » dans la barre des tâches : le message d'erreur y est affiché. |
| Le navigateur ne s'ouvre pas | Ouvrez-le vous-même et tapez l'adresse http://127.0.0.1:8100. |
| Vous voulez seulement regarder | Utilisez la démonstration en ligne, sans rien installer : https://mohamed-ja.github.io/portail-rh/ |

### Linux, macOS ou Windows en ligne de commande

Installez Python 3.11 ou plus récent (sous macOS : https://www.python.org/downloads/),
décompressez le ZIP comme ci-dessus, ouvrez un terminal dans le dossier
`portail-rh-main`, puis :

```bash
cd backend
python3 -m venv .venv-portail
source .venv-portail/bin/activate        # Windows : .venv-portail\Scripts\activate
pip install -r requirements.txt
python -m app.seed --reset               # base de démonstration
python serveur.py                        # http://127.0.0.1:8100
```

La documentation de l'API est servie sur http://127.0.0.1:8100/api/docs.

### Comptes de démonstration

Le **[guide d'utilisation](GUIDE_UTILISATION.md)** ([PDF](GUIDE_UTILISATION.pdf))
fait découvrir le portail pas à pas avec ces comptes.

Mot de passe commun : **`demo2026`**

| Matricule | Profil | Personne (fictive) |
|---|---|---|
| `VT0010` | Collaborateur | Julien Garnier, Systèmes d'information |
| `VT0003` | Supérieur hiérarchique | Karim Delorme, responsable des systèmes d'information |
| `VT0002` | Administration RH | Nadia Roche, directrice des ressources humaines |

Sans serveur, `portail-rh.html` s'ouvre aussi en **mode démonstration** : des
données générées dans le navigateur, rien n'est enregistré.

## Configuration

Toutes les variables sont facultatives (détail dans `backend/app/core/config.py`) :

| Variable | Rôle |
|---|---|
| `PORTAIL_RH_DATABASE_URL` | Base de données : SQLite par défaut (`backend/data/portail.db`), PostgreSQL accepté |
| `PORTAIL_RH_DATA_DIR` | Dossier des fichiers (téléversements, sauvegardes) |
| `PORTAIL_RH_SECRET` | Clé de signature des sessions (sinon `secret.key` générée) |
| `PORTAIL_RH_CLE_CHIFFREMENT` | Clé des données sensibles (sinon `chiffrement.key` générée) |
| `PORTAIL_RH_HOTE` / `PORTAIL_RH_PORT` | Adresse et port d'écoute (127.0.0.1:8100 par défaut) |
| `PORTAIL_RH_ORIGINES` | Origines autorisées (CORS) |
| `PORTAIL_RH_DOUBLE_AUTH_MATRICULES` | Comptes soumis à la double authentification obligatoire |
| `PORTAIL_RH_TACHES_FOND` | `0` coupe les tâches automatiques |
| `PORTAIL_RH_DOSSIER_SECOURS` | Dossier des copies de secours quotidiennes |
| `PORTAIL_RH_IA` | `1` active le relais IA de l'assistant (questions non comprises, sans données personnelles) ; clé dans `ANTHROPIC_API_KEY`, SDK dans `requirements-serveur.txt` ; `PORTAIL_RH_IA_MODELE` et `PORTAIL_RH_IA_EFFORT` facultatifs |

**Règles par défaut** : le calendrier (jours fériés, jours ouvrés, acquisition de
2,5 jours par mois) suit le droit du travail tunisien, pays d'origine du projet.
Les règles RH (horaires, autorisations, seuils) se règlent dans la rubrique
*Paramètres* ; les jours fériés sont dans `backend/app/services/calendrier.py`.

> Pour un usage réel, placez le serveur derrière HTTPS, fixez
> `PORTAIL_RH_SECRET` et `PORTAIL_RH_CLE_CHIFFREMENT`, et **conservez la clé de
> chiffrement** : sans elle, les données sensibles deviennent illisibles.

## Architecture

```
portail-rh.html            coquille de l'interface
assets/css/portail-rh.css  styles (thèmes clair et sombre)
assets/js/NN-*.js          modules chargés dans l'ordre, sans compilation
sw.js, manifest.webmanifest  application web installable
backend/app/               FastAPI, SQLAlchemy 2, Pydantic v2
  routers/                 une route par domaine (demandes, fiches, sirh…)
  services/                règles métier (hiérarchie, calendrier, validation…)
backend/tests/             tests pytest et parcours Playwright
outils/                    scripts d'administration
```

Le front n'a **aucune chaîne de compilation** : chaque fonction est un module
numéroté qui enrichit les précédents. Détails pour contribuer :
[DEVELOPPEMENT.md](DEVELOPPEMENT.md).

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest                 # tests du serveur
cd ..
npm install
npm run test:interface           # parcours d'interface (Playwright, Microsoft Edge)
```

## Donner votre avis

Les retours sont les bienvenus, même courts :

- **Défaut** : ce que vous faisiez, ce qui s'est passé, ce que vous attendiez
  (et le navigateur ou le téléphone utilisé) ;
- **Incompréhension** : l'écran concerné et ce qui n'était pas clair ;
- **Idée** : le besoin RH derrière la proposition.

Ouvrez une *issue* sur ce dépôt. Merci de ne jamais y joindre de données
personnelles réelles.

## Licence

Code publié sous licence [MIT](LICENSE).
