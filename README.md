# Portail RH

Portail de ressources humaines complet, **en français**, pour une entreprise de
50 à 500 personnes : congés et autorisations, présences et pointeuse, fiches
d'objectifs et d'évaluation, notes de frais, formations, organigramme, dossier
du collaborateur, prêts, compétences, mobilité interne, analyses RH…

> **Démonstration** : toutes les données sont fictives. La société « Veltaris »
> et ses collaborateurs n'existent pas ; toute ressemblance serait fortuite.

Le projet cherche des **retours d'utilisateurs** : ouvrez une *issue* pour
signaler un défaut, une incompréhension ou une idée (voir « Donner votre avis »).

## Aperçu des fonctions

| Domaine | Ce que fait le portail |
|---|---|
| Congés et absences | Demandes, circuit de validation N+1 puis RH, solde calculé en direct (jours ouvrés, fériés), report au 31 décembre, remplaçant pendant une absence, validation automatique après 48 h |
| Présences | Pointages, anomalies et justificatifs, plannings d'équipe (siège, télétravail, terrain…), liaison avec une pointeuse |
| Objectifs et évaluation | Fiche d'objectifs pondérés, évaluation par le N+1, note de comportement par les RH (80 % / 20 %), fiches validées en lecture seule |
| Organisation | Organigramme dessiné (arbre ou liste), structures et responsables, remplacement d'un responsable avec prévisualisation |
| Dossier RH | Carrière, documents, attestations PDF vérifiables par QR code, bilan individuel |
| Pilotage | Tableau de bord d'équipe, indicateurs, bilan social, analyses, qualité des données |
| Autres | Notes de frais, formations, avances et prêts, compétences et succession, offres internes, accidents du travail, dossier disciplinaire, entretiens de sortie |
| Sécurité | Sessions JWT, mots de passe robustes, blocage après 5 échecs, double authentification (TOTP), chiffrement des données sensibles, journal d'audit, copies de secours testées |

L'interface fonctionne sur ordinateur et sur téléphone (application web
installable).

## Démarrer

**Prérequis** : Python 3.11 ou plus récent.

### Windows

Double-cliquez sur `DEMARRER.bat`. Au premier lancement, il installe les
composants dans `%LOCALAPPDATA%\Portail-RH\venv`, crée une base de
démonstration puis ouvre http://127.0.0.1:8000.

### Linux, macOS ou Windows en ligne de commande

```bash
cd backend
python -m venv .venv-portail
source .venv-portail/bin/activate        # Windows : .venv-portail\Scripts\activate
pip install -r requirements.txt
python -m app.seed --reset               # base de démonstration
python serveur.py                        # http://127.0.0.1:8000
```

La documentation de l'API est servie sur http://127.0.0.1:8000/api/docs.

### Comptes de démonstration

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
| `PORTAIL_RH_HOTE` / `PORTAIL_RH_PORT` | Adresse et port d'écoute (127.0.0.1:8000 par défaut) |
| `PORTAIL_RH_ORIGINES` | Origines autorisées (CORS) |
| `PORTAIL_RH_DOUBLE_AUTH_MATRICULES` | Comptes soumis à la double authentification obligatoire |
| `PORTAIL_RH_TACHES_FOND` | `0` coupe les tâches automatiques |
| `PORTAIL_RH_DOSSIER_SECOURS` | Dossier des copies de secours quotidiennes |

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
