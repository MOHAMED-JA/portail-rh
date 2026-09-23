"""Suivi des tâches automatiques, des erreurs et de l'intégrité des sauvegardes."""
from __future__ import annotations

import hashlib
import sqlite3
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, TypeVar

from sqlalchemy import select

from app.core.config import DATABASE_URL
from app.core.database import SessionLocal
from app.models import EtatTache, IncidentTechnique

T = TypeVar("T")


def _detail_resultat(resultat: object) -> str | None:
    if resultat is None:
        return None
    if isinstance(resultat, (list, tuple, set, dict)):
        return f"{len(resultat)} élément(s)"
    return str(resultat)[:500]


def _enregistrer_etat(nom: str, statut: str, duree_ms: int, detail: str | None,
                      intervalle_succes: int = 0) -> None:
    maintenant = datetime.utcnow()
    try:
        with SessionLocal() as db:
            etat = db.get(EtatTache, nom)
            if etat is None:
                etat = EtatTache(nom=nom)
                db.add(etat)
            elif statut == "succes" and intervalle_succes and etat.derniere_execution \
                    and maintenant - etat.derniere_execution < timedelta(seconds=intervalle_succes):
                return
            etat.statut = statut
            etat.derniere_execution = maintenant
            etat.duree_ms = duree_ms
            etat.detail = detail[:500] if detail else None
            etat.executions = (etat.executions or 0) + 1
            if statut == "succes":
                etat.dernier_succes = maintenant
            else:
                etat.dernier_echec = maintenant
                etat.echecs = (etat.echecs or 0) + 1
            db.commit()
    except Exception:  # La supervision ne doit jamais arrêter le portail.
        pass


def enregistrer_erreur(source: str, erreur: BaseException, detail: str | None = None) -> None:
    type_erreur = type(erreur).__name__
    message = str(erreur)[:1000] or type_erreur
    empreinte = hashlib.sha256(f"{source}|{type_erreur}|{message}".encode("utf-8", errors="replace")).hexdigest()
    trace = detail or "".join(traceback.format_exception(type(erreur), erreur, erreur.__traceback__))
    try:
        with SessionLocal() as db:
            incident = db.scalar(select(IncidentTechnique).where(IncidentTechnique.empreinte == empreinte))
            maintenant = datetime.utcnow()
            if incident is None:
                incident = IncidentTechnique(empreinte=empreinte, source=source, type_erreur=type_erreur,
                                             message=message, detail=trace[-8000:])
                db.add(incident)
            else:
                incident.occurrences = (incident.occurrences or 0) + 1
                incident.derniere_le = maintenant
                incident.detail = trace[-8000:]
                incident.resolu_le = None
                incident.resolu_par_id = None
            db.commit()
    except Exception:
        pass


def executer(nom: str, action: Callable[[], T], intervalle_succes: int = 0) -> T | None:
    """Exécute une tâche, consolide son état et transforme l'échec en incident."""
    debut = time.perf_counter()
    try:
        resultat = action()
    except Exception as erreur:  # noqa: BLE001
        duree = round((time.perf_counter() - debut) * 1000)
        enregistrer_erreur(nom, erreur)
        _enregistrer_etat(nom, "echec", duree, f"{type(erreur).__name__} : {erreur}")
        return None
    duree = round((time.perf_counter() - debut) * 1000)
    _enregistrer_etat(nom, "succes", duree, _detail_resultat(resultat), intervalle_succes)
    return resultat


def verifier_sqlite(chemin: Path) -> dict:
    if not chemin.exists():
        return {"nom": chemin.name, "statut": "absente", "detail": "Fichier introuvable"}
    try:
        with sqlite3.connect(str(chemin)) as connexion:
            resultat = connexion.execute("PRAGMA integrity_check").fetchone()[0]
        return {
            "nom": chemin.name,
            "statut": "ok" if resultat == "ok" else "erreur",
            "detail": resultat,
            "taille_ko": round(chemin.stat().st_size / 1024),
            "modifie_le": datetime.fromtimestamp(chemin.stat().st_mtime).isoformat(timespec="seconds"),
        }
    except Exception as erreur:  # noqa: BLE001
        enregistrer_erreur("controle_sauvegarde", erreur, str(chemin))
        return {"nom": chemin.name, "statut": "erreur", "detail": f"{type(erreur).__name__} : {erreur}"}


def etat_sauvegardes() -> dict:
    if not DATABASE_URL.startswith("sqlite:///"):
        return {
            "mode": "postgresql", "statut": "a_configurer",
            "message": "La sauvegarde PostgreSQL doit être configurée et supervisée par la DSI.", "fichiers": [],
        }
    from app.services.sirh import DOSSIER_SAUVEGARDES

    fichiers = sorted(DOSSIER_SAUVEGARDES.glob("portail-*.db"), key=lambda f: f.stat().st_mtime, reverse=True)
    controles = [verifier_sqlite(f) for f in fichiers[:5]]
    if not controles:
        return {"mode": "sqlite", "statut": "absente", "message": "Aucune sauvegarde disponible.", "fichiers": []}
    age_heures = (datetime.now() - datetime.fromtimestamp(fichiers[0].stat().st_mtime)).total_seconds() / 3600
    statut = "ok" if controles[0]["statut"] == "ok" and age_heures <= 48 else "alerte"
    return {"mode": "sqlite", "statut": statut, "age_heures": round(age_heures, 1), "fichiers": controles}


def apercu_public() -> str:
    """État très synthétique pour /api/sante, sans exposer les erreurs."""
    try:
        with SessionLocal() as db:
            echec = db.scalar(select(EtatTache.nom).where(EtatTache.statut == "echec").limit(1))
            incident = db.scalar(select(IncidentTechnique.id).where(IncidentTechnique.resolu_le.is_(None)).limit(1))
            return "alerte" if echec or incident else "ok"
    except Exception:
        return "indisponible"
