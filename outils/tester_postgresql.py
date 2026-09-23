"""Valide le portail et la migration sur une vraie base PostgreSQL jetable.

La base cible doit contenir « test » dans son nom. Le script exécute les tests
pytest sur PostgreSQL, crée ensuite une base SQLite de démonstration, la copie
avec ``transferer_base.py`` et vérifie tous les nombres de lignes. La cible est
vidée à la fin, même en cas d'échec.

Usage depuis la racine du projet :
    python outils/tester_postgresql.py postgresql+psycopg://user:mdp@localhost:55432/portail_test
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

RACINE = Path(__file__).resolve().parent.parent
BACKEND = RACINE / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(RACINE / "outils"))


def _valider_cible(url: str) -> None:
    cible = make_url(url)
    if cible.get_backend_name() != "postgresql":
        raise SystemExit("La cible doit être une vraie base PostgreSQL.")
    if "test" not in (cible.database or "").lower():
        raise SystemExit("Sécurité : le nom de la base PostgreSQL doit contenir « test ».")


def _vider(url: str) -> None:
    moteur = create_engine(url)
    # Une remise à zéro du schéma est plus robuste qu'un ``drop_all`` : elle
    # supprime aussi un objet résiduel après une création de tables interrompue.
    with moteur.begin() as connexion:
        connexion.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connexion.execute(text("CREATE SCHEMA public"))
    moteur.dispose()


def tester(url: str) -> None:
    _valider_cible(url)
    environnement = os.environ.copy()
    environnement.update({
        "PORTAIL_RH_TEST_DATABASE_URL": url,
        "PORTAIL_RH_TACHES_FOND": "0",
        "PORTAIL_RH_DOUBLE_AUTH_RH": "0",
        "PYTHONIOENCODING": "utf-8",
    })
    try:
        _vider(url)
        print("1/2 — Suite pytest complète sur PostgreSQL")
        subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=BACKEND, env=environnement, check=True)

        print("2/2 — Transfert SQLite vers PostgreSQL et contrôle des lignes")
        _vider(url)
        with tempfile.TemporaryDirectory(prefix="portail-pg-") as dossier:
            chemin = Path(dossier) / "source.db"
            env_seed = os.environ.copy()
            env_seed.update({
                "PORTAIL_RH_DATA_DIR": dossier,
                "PORTAIL_RH_DATABASE_URL": f"sqlite:///{chemin.as_posix()}",
                "PORTAIL_RH_TACHES_FOND": "0",
                "PORTAIL_RH_DOUBLE_AUTH_RH": "0",
                "PYTHONIOENCODING": "utf-8",
            })
            subprocess.run([sys.executable, "-m", "app.seed", "--reset"], cwd=BACKEND, env=env_seed, check=True,
                           stdout=subprocess.DEVNULL)
            from transferer_base import transferer

            comptes = transferer(f"sqlite:///{chemin.as_posix()}", url)
            total = sum(comptes.values())
            if total <= 0 or comptes.get("employes", 0) <= 0:
                raise SystemExit("Le transfert PostgreSQL n'a copié aucune donnée métier.")
            print(f"Migration vérifiée : {total} ligne(s), {len(comptes)} table(s), {comptes['employes']} employé(s).")
    finally:
        _vider(url)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(1)
    tester(sys.argv[1])
