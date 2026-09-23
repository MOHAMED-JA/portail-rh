"""Serveur jetable utilisé exclusivement par les tests Playwright."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BACKEND = RACINE / "backend"
sys.path.insert(0, str(BACKEND))

dossier = Path(tempfile.gettempdir()) / "portail-tests-interface"
shutil.rmtree(dossier, ignore_errors=True)
dossier.mkdir(parents=True, exist_ok=True)
os.environ.update({
    "PORTAIL_RH_DATA_DIR": str(dossier),
    "PORTAIL_RH_DATABASE_URL": f"sqlite:///{(dossier / 'interface.db').as_posix()}",
    "PORTAIL_RH_TACHES_FOND": "0",
    "PORTAIL_RH_DOUBLE_AUTH_RH": "0",
    "PORTAIL_RH_SECRET": "cle-tests-interface",
    "PYTHONIOENCODING": "utf-8",
})

from app import seed  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models import Employe  # noqa: E402

seed.reinitialiser()
seed.peupler()
with SessionLocal() as db:
    for employe in db.query(Employe):
        employe.doit_changer_mdp = False
        employe.totp_active = False
    db.commit()

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", app_dir=str(BACKEND), host="127.0.0.1", port=8010, log_level="warning")
