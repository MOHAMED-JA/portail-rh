"""Dernier recours : redonner un mot de passe provisoire à un compte
(mot de passe oublié, aucun autre administrateur RH pour le faire depuis le
portail).

À lancer sur le poste ou le serveur qui héberge la base, portail arrêté :
    cd backend
    python ..\\outils\\reinitialiser_mot_de_passe.py MATRICULE [MOT_DE_PASSE]

Sans mot de passe en argument, il est demandé à la saisie (masquée).
La base est sauvegardée avant modification dans data/sauvegardes. Le compte
devra changer son mot de passe à la connexion suivante ; le blocage après
échecs répétés est levé. L'opération est inscrite au journal d'audit.
"""
import getpass
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.config import DATA_DIR  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Employe, JournalAudit  # noqa: E402

if not 2 <= len(sys.argv) <= 3:
    print(__doc__)
    raise SystemExit(1)

matricule = sys.argv[1].strip().upper()
if len(sys.argv) == 3:
    mot_de_passe = sys.argv[2]
else:
    mot_de_passe = getpass.getpass("Nouveau mot de passe provisoire : ")
    if mot_de_passe != getpass.getpass("Confirmation : "):
        raise SystemExit("Les deux saisies diffèrent : rien n'a été modifié.")
if len(mot_de_passe) < 6:
    raise SystemExit("Mot de passe trop court (6 caractères au minimum).")

base = DATA_DIR / "portail.db"
if base.exists():
    dossier = DATA_DIR / "sauvegardes"
    dossier.mkdir(parents=True, exist_ok=True)
    copie = dossier / f"portail_avant_mdp_{datetime.now():%Y%m%d_%H%M%S}.db"
    shutil.copy2(base, copie)
    print(f"Sauvegarde : {copie}")

with SessionLocal() as db:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule))
    if e is None:
        raise SystemExit(f"Matricule inconnu : {matricule}")
    e.mot_de_passe_hash = hash_password(mot_de_passe)
    e.doit_changer_mdp = True
    e.echecs_connexion = 0
    e.bloque_jusqu = None
    db.add(JournalAudit(action="mot_de_passe_reinitialise", cible=e.matricule,
                        detail="Outil de secours en ligne de commande"))
    db.commit()
    print(f"Mot de passe provisoire redonné à {e.prenom} {e.nom} ({e.matricule}).")
    print("Il sera à changer dès la connexion suivante.")
