"""Dernier recours : réinitialiser la double authentification d'un compte
(téléphone ET codes de secours perdus, aucun autre administrateur RH).

À lancer sur le poste ou le serveur qui héberge la base, portail arrêté :
    cd backend
    python ..\\outils\\reinitialiser_double_auth.py MATRICULE

L'opération est inscrite au journal d'audit ; le compte reconfigurera sa
double authentification à la connexion suivante.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models import Employe, JournalAudit  # noqa: E402

if len(sys.argv) != 2:
    print(__doc__)
    raise SystemExit(1)

with SessionLocal() as db:
    e = db.scalar(select(Employe).where(Employe.matricule == sys.argv[1].strip().upper()))
    if e is None:
        raise SystemExit(f"Matricule inconnu : {sys.argv[1]}")
    e.totp_active = False
    e.totp_secret = None
    e.codes_secours = None
    e.echecs_connexion = 0
    e.bloque_jusqu = None
    db.add(JournalAudit(action="double_auth_reinitialisee", cible=e.matricule, detail="Outil de secours en ligne de commande"))
    db.commit()
    print(f"Double authentification réinitialisée pour {e.prenom} {e.nom} ({e.matricule}).")
