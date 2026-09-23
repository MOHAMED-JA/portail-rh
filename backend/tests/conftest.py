"""Socle des tests : base SQLite et dossier de fichiers temporaires, tâches de
fond coupées. Rien n'est écrit dans backend/data.

Lancer depuis backend/ :  python -m pytest
"""
import os
import tempfile
from pathlib import Path

# Avant tout import de l'application : la configuration est lue à l'import.
_DOSSIER = Path(tempfile.mkdtemp(prefix="portail-tests-"))
os.environ["PORTAIL_RH_DATA_DIR"] = str(_DOSSIER)
_BASE_POSTGRESQL = os.environ.get("PORTAIL_RH_TEST_DATABASE_URL")
os.environ["PORTAIL_RH_DATABASE_URL"] = _BASE_POSTGRESQL or f"sqlite:///{(_DOSSIER / 'tests.db').as_posix()}"
os.environ["PORTAIL_RH_TACHES_FOND"] = "0"
os.environ["PORTAIL_RH_SECRET"] = "cle-de-test"
# Double authentification RH : testée à part (tests/test_securite_avancee.py).
os.environ["PORTAIL_RH_DOUBLE_AUTH_RH"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import creer_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Departement, Employe, Role, SoldeConge  # noqa: E402
from app.services import parametres  # noqa: E402
from tests.constantes import ANNEE, MOT_DE_PASSE  # noqa: E402

_HACHE = hash_password(MOT_DE_PASSE)  # bcrypt est lent : une seule fois


def _creer(db, matricule, prenom, nom, role, departement, validateur=None, doit_changer=False):
    e = Employe(matricule=matricule, prenom=prenom, nom=nom, email=f"{matricule.lower()}@exemple.test",
                poste="Chargé d'études", role=role, mot_de_passe_hash=_HACHE, departement_id=departement.id,
                validateur_id=validateur.id if validateur else None, doit_changer_mdp=doit_changer)
    db.add(e)
    db.flush()
    db.add(SoldeConge(employe_id=e.id, annee=ANNEE, jours_acquis=21, jours_pris=0, report_anterieur=0))
    return e


def pytest_sessionfinish(session, exitstatus):
    """Supprime la base et les fichiers temporaires des tests."""
    import shutil

    if _BASE_POSTGRESQL:
        Base.metadata.drop_all(bind=engine)
    engine.dispose()
    shutil.rmtree(_DOSSIER, ignore_errors=True)


@pytest.fixture(autouse=True)
def base():
    """Base neuve pour chaque test : RH, un manager, deux collaborateurs."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        parametres.charger(db)
        d = Departement(code="DIR", nom="Direction Audit et Contrôle")
        db.add(d)
        db.flush()
        _creer(db, "ADMINRH", "Administration", "RH", Role.ADMIN_RH, d)
        chef = _creer(db, "100130", "Claire", "Morel", Role.VALIDATEUR, d)
        _creer(db, "100259", "Julien", "Garnier", Role.EMPLOYE, d, chef)
        _creer(db, "100281", "Paul", "Benoit", Role.EMPLOYE, d, chef)
        _creer(db, "NOUVEAU", "Nouvel", "Arrivant", Role.EMPLOYE, d, chef, doit_changer=True)
        db.commit()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def entetes():
    """entetes("100259") → en-tête d'authentification de ce compte."""
    def fabriquer(matricule):
        with SessionLocal() as db:
            e = db.query(Employe).filter_by(matricule=matricule).one()
            return {"Authorization": f"Bearer {creer_token(e)}"}
    return fabriquer


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session
