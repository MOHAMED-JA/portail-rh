"""Simule un plan JSON ; --appliquer sauvegarde puis modifie la base SQLite.

Le portail doit être arrêté avant application. Une simulation ne modifie
jamais la source. Aucune clé ni donnée de connexion n'est incluse au rapport.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
from datetime import datetime

RACINE = Path(__file__).resolve().parents[1]


def copier_base(source, destination):
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as entree:
        with sqlite3.connect(str(destination)) as sortie:
            entree.backup(sortie)


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("plan", type=Path)
    arguments.add_argument("--base", type=Path, default=RACINE / "backend/data/portail.db")
    arguments.add_argument("--rapport", type=Path, required=True)
    arguments.add_argument("--appliquer", action="store_true")
    args = arguments.parse_args()
    source = args.base.resolve()
    if not source.is_file():
        raise SystemExit("Base source introuvable.")
    if args.rapport.resolve() == source or args.plan.resolve() == args.rapport.resolve():
        raise SystemExit("Le rapport doit avoir un chemin distinct de la base et du plan.")
    if args.appliquer:
        for hote in ("127.0.0.1", "::1"):
            try:
                with socket.create_connection((hote, int(os.environ.get("PORTAIL_RH_PORT", "8000"))), timeout=1):
                    raise SystemExit("Arrêtez le portail local avant d'appliquer l'organisation.")
            except OSError:
                pass
    with tempfile.TemporaryDirectory(prefix="portail-organisation-") as dossier:
        temporaire = Path(dossier)
        cible = source if args.appliquer else temporaire / "simulation.db"
        if not args.appliquer:
            copier_base(source, cible)
        os.environ["PORTAIL_RH_DATABASE_URL"] = "sqlite:///" + cible.as_posix()
        os.environ["PORTAIL_RH_DATA_DIR"] = str(temporaire)
        os.environ["PORTAIL_RH_TACHES_FOND"] = "0"
        os.environ["PORTAIL_RH_SECRET"] = "simulation-organisation-sans-connexion"
        cle = source.parent / "chiffrement.key"
        if cle.exists() and not os.environ.get("PORTAIL_RH_CLE_CHIFFREMENT"):
            os.environ["PORTAIL_RH_CLE_CHIFFREMENT"] = cle.read_text(encoding="utf-8").strip()
        sys.path.insert(0, str(RACINE / "backend"))
        from app.core.database import SessionLocal, engine
        from app.core import migrations
        from app.services.organisation import PlanOrganisation, appliquer_plan

        plan = PlanOrganisation.model_validate_json(args.plan.read_text(encoding="utf-8"))
        sauvegarde = None
        if args.appliquer:
            sauvegarde = source.parent / "sauvegardes" / f"portail-avant-organisation-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
            sauvegarde.parent.mkdir(parents=True, exist_ok=True)
            copier_base(source, sauvegarde)
        try:
            migrations.appliquer()
            with SessionLocal.begin() as db:
                rapport = appliquer_plan(db, plan)
            rapport.update(mode="application" if args.appliquer else "simulation",
                           sauvegarde=str(sauvegarde) if sauvegarde else None)
            args.rapport.write_text(json.dumps(rapport, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"{rapport['mode']} : {len(rapport['changements'])} changement(s), {len(rapport['non_affectes'])} personne(s) sans département.")
            print(f"Rapport : {args.rapport.resolve()}")
            if sauvegarde:
                print(f"Sauvegarde : {sauvegarde}")
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
