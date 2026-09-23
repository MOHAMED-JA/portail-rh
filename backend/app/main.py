"""Point d'entrée FastAPI — API REST documentée + service du frontend SPA."""
from datetime import date
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import APP_NAME, APP_VERSION, ORIGINES, TACHES_DE_FOND, UPLOAD_DIR
from app.core.database import Base, SessionLocal, engine
from app.routers import (
    administration,
    auth,
    bilan_individuel,
    departs,
    generateur,
    habilitations,
    indicateurs,
    remuneration,
    revue_talents,
    demandes,
    email_actions,
    espace,
    exports,
    fiches,
    formations,
    frais,
    notifications,
    parametres,
    pilotage,
    prets,
    talents,
    mobilite,
    sante_travail,
    discipline,
    analyses,
    architecture,
    plannings,
    pointeuse,
    presences,
    delegations,
    reinitialisation,
    qualite_donnees,
    securite,
    sirh,
    supervision,
    tableau_bord,
)

Base.metadata.create_all(bind=engine)
from app.core import migrations as _migrations  # noqa: E402

_migrations.appliquer()

# Paramètres RH en mémoire et catalogue de formations initial.
with SessionLocal() as _session:
    from app.services import parametres as _parametres

    _parametres.charger(_session)
    formations.initialiser_catalogue(_session)


def _taches_de_fond() -> None:
    """E-mails en file toutes les 20 s ; clôture des journées de pointage
    (pointage impair, départ anticipé) toutes les 15 min."""
    import threading
    import time as _horloge

    from app.services import emails as _emails
    from app.services import pointage as _pointage
    from app.services import supervision as _supervision

    _emails.demarrer_expediteur(SessionLocal)

    from app.services import relances as _relances
    from app.services import validation_auto as _validation_auto

    from app.services import acquisition as _acquisition

    def avec_session(action):
        with SessionLocal() as db:
            resultat = action(db)
            db.commit()
            return resultat

    def validation_automatique():
        """Toutes les 5 min : congés et autorisations sans réponse, puis
        acquisition mensuelle des congés au changement de mois."""
        while True:
            from app.services import sorties as _sorties
            from app.services import sirh as _sirh

            _supervision.executer("sorties_programmees", lambda: avec_session(_sorties.appliquer_sorties_programmees))
            _supervision.executer("acquisition_conges", lambda: avec_session(_acquisition.crediter))
            _supervision.executer("report_conges", lambda: avec_session(_sirh.taches_report))

            def alertes_et_sauvegarde(db):
                cle = f"alertes_du_jour:{date.today()}"
                if _parametres.lire(db, cle):
                    return "déjà exécuté aujourd'hui"
                alertes = _sirh.notifier_alertes(db)
                sauvegarde = _sirh.sauvegarder()
                _parametres.ecrire(db, cle, True)
                return {"alertes": alertes, "sauvegarde": sauvegarde}

            _supervision.executer("alertes_et_sauvegarde_quotidiennes", lambda: avec_session(alertes_et_sauvegarde))

            def secours_quotidien(db):
                from app.services import secours as _secours

                if _secours.base_sqlite() is None:
                    return "sans objet (PostgreSQL)"
                cle = f"secours_du_jour:{date.today()}"
                if _parametres.lire(db, cle):
                    return "déjà exécuté aujourd'hui"
                # Marqué avant le contrôle : un échec ne doit pas relancer une
                # archive toutes les 5 min (elles chasseraient les bonnes).
                _parametres.ecrire(db, cle, True)
                db.commit()
                rapport = _secours.sauvegarder_et_controler()
                if rapport["statut"] != "ok":
                    raise RuntimeError(f"Copie de secours {rapport['archive']} : test de restauration en échec.")
                return f"{rapport['archive']} restaurée à blanc ({rapport['taille_ko']} Ko)"

            _supervision.executer("copie_de_secours_hors_onedrive", lambda: avec_session(secours_quotidien))

            def habilitations_du_jour(db):
                from app.services import habilitations as _habilitations

                cle = f"habilitations_du_jour:{date.today()}"
                if _parametres.lire(db, cle):
                    return "déjà exécuté aujourd'hui"
                resultat = _habilitations.relancer(db)
                _parametres.ecrire(db, cle, True)
                return resultat

            _supervision.executer("echeances_habilitations", lambda: avec_session(habilitations_du_jour))
            _supervision.executer("relances_quotidiennes", lambda: avec_session(_relances.relancer))
            _supervision.executer("validation_automatique", lambda: avec_session(_validation_auto.valider_echues))
            _horloge.sleep(300)

    threading.Thread(target=validation_automatique, name="validation-auto", daemon=True).start()

    def cloture():
        while True:
            _supervision.executer("cloture_pointages", lambda: avec_session(_pointage.recalculer_recents))
            _horloge.sleep(900)

    threading.Thread(target=cloture, name="cloture-pointages", daemon=True).start()


if TACHES_DE_FOND:
    _taches_de_fond()

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description=(
        "API de la plateforme RH Veltaris : présences, congés, autorisations, "
        "missions, plannings, fiches d'objectifs et d'évaluation, administration."
    ),
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINES,  # « * » sur les postes ; adresse du portail sur le serveur
    # L'authentification passe par un jeton Bearer, jamais par un cookie : sans
    # credentials, Starlette renvoie bien « * » et l'application fonctionne même
    # ouverte depuis un fichier local (origine « null »).
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (auth, tableau_bord, demandes, presences, plannings, notifications, administration, espace, exports,
               fiches, frais, formations, parametres, pointeuse, email_actions, sirh, pilotage, securite, prets, talents, mobilite, sante_travail, discipline, analyses, architecture, reinitialisation, delegations):
    app.include_router(module.router)
app.include_router(supervision.router)
for module in (generateur, habilitations, indicateurs, remuneration, revue_talents, departs, bilan_individuel):
    app.include_router(module.router)
app.include_router(qualite_donnees.router)


@app.exception_handler(Exception)
async def erreur_inattendue(requete, erreur):
    """Trace une erreur inattendue sans exposer ses détails techniques."""
    from app.services import supervision as _supervision

    _supervision.enregistrer_erreur("requete_http", erreur, f"{requete.method} {requete.url.path}")
    return JSONResponse(status_code=500, content={"detail": "Une erreur interne a été enregistrée. L'administrateur RH peut la consulter dans Supervision."})


@app.get("/api/sante", tags=["Système"], summary="Vérification de disponibilité")
def sante():
    from app.services import supervision as _supervision

    return {"statut": "ok", "version": APP_VERSION, "supervision": _supervision.apercu_public()}


app.mount("/fichiers", StaticFiles(directory=UPLOAD_DIR), name="fichiers")

# Le frontend est servi par la même origine : pas de configuration CORS
# à gérer côté navigateur, et l'application est installable en PWA.
RACINE = Path(__file__).resolve().parent.parent.parent
APPLICATION = RACINE / "portail-rh.html"

if (RACINE / "assets").exists():
    app.mount("/assets", StaticFiles(directory=RACINE / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def application():
    """L'interface est un fichier autonome : servie par la même origine que
    l'API, elle bascule automatiquement en mode connecté."""
    return FileResponse(APPLICATION)


@app.get("/{chemin:path}", include_in_schema=False)
def spa(chemin: str):
    """Toutes les routes non-API renvoient l'application : le routage est
    assuré côté client."""
    fichier = RACINE / chemin
    if chemin and fichier.is_file() and fichier.suffix in {".html", ".css", ".js", ".png", ".svg", ".webmanifest"}:
        return FileResponse(fichier)
    return FileResponse(APPLICATION)
