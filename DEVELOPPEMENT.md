# Guide de développement

Interface, données et messages sont **en français**, et le code aussi (noms de
variables, fonctions, tables) : merci de garder cette convention.

## Pile technique

| Couche | Technologie |
|---|---|
| Serveur | Python 3.11+, FastAPI, SQLAlchemy 2 (style `Mapped`), Pydantic v2, uvicorn |
| Base | SQLite par défaut ; PostgreSQL via `PORTAIL_RH_DATABASE_URL` (`requirements-serveur.txt`) |
| Sécurité | JWT (12 h), bcrypt 4.0.1 **épinglé** (passlib), TOTP, chiffrement Fernet |
| Documents | openpyxl (Excel), reportlab (PDF) |
| Interface | HTML, CSS et JavaScript sans compilation ; Chart.js par CDN |
| Tests | pytest (`backend/tests/`) et Playwright sur Edge (`backend/tests/interface/`) |

## Interface : modules numérotés

`portail-rh.html` charge les modules `assets/js/NN-*.js` dans l'ordre. Une
nouvelle fonction est un **nouveau module de numéro supérieur** qui enveloppe
l'existant :

```js
const brancherAvant = BRANCHEMENTS["/route"] || function () {};
BRANCHEMENTS["/route"] = function () { brancherAvant(); /* ajout */ };
```

Toutes les routes n'ont pas d'entrée dans `BRANCHEMENTS` : gardez le
`|| function () {}`.

Un nouveau module se déclare à **trois endroits** : le fichier dans
`assets/js/`, sa balise `<script>` dans `portail-rh.html` et son chemin dans
`STATIQUES` de `sw.js`. Changez aussi `CACHE` dans `sw.js` à chaque livraison,
sinon les navigateurs gardent l'ancienne version.

Points d'extension : `VUES[route]` (rendu), `BRANCHEMENTS[route]` (écouteurs),
`menuNavigation`, `naviguer`, `chargerDonneesApi`, `TITRES`. Outils :
`API.appel(chemin, {methode, corps})`, `connecte()`, `moi()`, `estAdmin()`,
`estValideur()`, `estDirection()`, `toast()`, `ouvrirCouche()`, `fermerCouche()`,
`etatVide()`, `echapper()`, `fmtDate()`, `dateServeur()`, `ico()`, `$`, `$$`.

**Mode démonstration** : sans serveur, l'interface fonctionne avec des données
générées (`connecte()` renvoie faux). Toute nouvelle vue doit le supporter,
au besoin avec un message « Disponible avec le serveur ».

## Serveur

- **Périmètre de consultation** : toujours passer par `services/hierarchie.py`
  (`perimetre_ids`, `peut_consulter`, `voit_tout`). Un supérieur voit toute sa
  ligne hiérarchique ; la direction générale et les RH voient tout ; les données
  confidentielles (paie, dossier personnel, santé, sanctions) restent réservées
  aux RH et à l'intéressé.
- **Circuit de validation** : la direction générale ne valide jamais en premier ;
  sans supérieur opérationnel, les RH décident.
- **Rôles** : `employe`, `validateur`, `gestionnaire_rh`, `admin_rh`. Testez
  `role in ROLES_RH`, pas l'égalité avec un seul rôle.
- **Nouvelle colonne** sur une table existante : l'ajouter aussi dans
  `core/migrations.py` (`COLONNES`), sinon une base existante plante. Nouvelle
  table : `create_all` suffit.
- **Règle paramétrable** : `services/parametres.REGLES_DEFAUT`,
  `routers/parametres.ReglesPayload` et le formulaire *Paramètres*.
- Toute action RH sensible écrit dans `JournalAudit` ; tout événement destiné à
  un utilisateur passe par `services/notifications.notifier(...)`.
- Données sensibles : colonnes `TexteChiffre` (`services/chiffrement.py`).
- Pièces jointes : PDF, DOC, DOCX uniquement.
- Heures du serveur en UTC, affichées via `dateServeur()`.
- Pas de SQL propre à SQLite : le code doit aussi tourner sur PostgreSQL.

## Tests

```bash
cd backend
python -m pytest
```

`conftest.py` travaille dans un dossier temporaire : rien n'est écrit dans
`backend/data`. Fixtures : `client` (TestClient), `entetes("100259")` (en-tête
d'authentification d'un compte), `db`. Ne jamais importer `conftest` depuis un
test : passer par `tests/constantes.py`.

**Tout nouveau comportement métier s'accompagne d'un test.**

Parcours d'interface : `npm install`, puis `npm run test:interface`. Le serveur
de test démarre seul sur le port 8010 avec une base jetable ; l'interpréteur
Python est celui de `DEMARRER.bat`, ou `PORTAIL_RH_PYTHON` s'il est défini.

Contrôles syntaxiques :

```bash
python -m compileall -q backend/app
for f in assets/js/*.js; do node --check "$f" || echo "ERREUR $f"; done
```

## Pièges connus

- bcrypt doit rester en 4.0.1 (passlib est incompatible avec les versions récentes).
- Changer `PORTAIL_RH_SECRET` (ou supprimer `secret.key`) déconnecte tout le
  monde et invalide les liens de validation envoyés par e-mail. Perdre
  `chiffrement.key` rend illisibles les données de santé et disciplinaires.
- Sous Windows, arrêter un serveur de test ne tue pas toujours uvicorn : vérifier
  que le port est libéré.
- Console Windows : `PYTHONIOENCODING=utf-8`, sinon les accents sont illisibles.
