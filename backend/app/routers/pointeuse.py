"""Liaison directe avec la pointeuse.

Le connecteur (outils/connecteur_pointeuse.py) ou le logiciel de la pointeuse
envoie les passages bruts à POST /api/pointeuse/passages, authentifié par une
clé propre à la pointeuse (en-tête X-Cle-Pointeuse). Les journées concernées
sont recalculées aussitôt : l'heure de passage s'affiche dans le portail.
"""
from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis
from app.models import Employe, JournalAudit, PassageBadge
from app.services import parametres
from app.services import pointage as moteur

router = APIRouter(prefix="/api/pointeuse", tags=["Pointeuse"])


class Passage(BaseModel):
    matricule: str | None = None       # matricule interne, ou…
    badge: str | None = None           # …numéro de badge (table de correspondance)
    horodatage: datetime
    terminal: str | None = None


class Lot(BaseModel):
    passages: list[Passage] = Field(max_length=5000)


class CorrespondancePayload(BaseModel):
    badges: dict[str, str]             # numéro de badge → matricule


def cle_pointeuse(db: Session) -> str:
    cle = parametres.lire(db, "cle_pointeuse")
    if not cle:
        cle = secrets.token_urlsafe(32)
        parametres.ecrire(db, "cle_pointeuse", cle)
        db.commit()
    return cle


@router.post("/passages", summary="Recevoir des passages de badge (pointeuse ou connecteur)")
def recevoir(lot: Lot, x_cle_pointeuse: str = Header(...), db: Session = Depends(get_db)):
    if not secrets.compare_digest(x_cle_pointeuse, cle_pointeuse(db)):
        raise HTTPException(status_code=401, detail="Clé de pointeuse invalide")
    badges = parametres.lire(db, "badges_pointeuse", {}) or {}
    matricules = {e.matricule: e.id for e in db.scalars(select(Employe))}
    ajoutes, doublons, inconnus = 0, 0, []
    journees: set[tuple[int, object]] = set()
    for p in lot.passages:
        matricule = (p.matricule or badges.get(str(p.badge or "").strip()) or str(p.badge or "")).strip().upper()
        employe_id = matricules.get(matricule)
        if employe_id is None:
            inconnus.append(p.matricule or p.badge)
            continue
        if moteur.enregistrer_passage(db, employe_id, p.horodatage, "pointeuse", p.terminal):
            ajoutes += 1
            journees.add((employe_id, p.horodatage.date()))
        else:
            doublons += 1
    for employe_id, jour in journees:
        moteur.recalculer(db, employe_id, jour)
    parametres.ecrire(db, "pointeuse_dernier_contact", datetime.now().isoformat(timespec="seconds"))
    db.commit()
    return {"ajoutes": ajoutes, "doublons": doublons, "inconnus": sorted({str(x) for x in inconnus})[:50]}


@router.get("/etat", summary="État de la liaison pointeuse (administration RH)")
def etat(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    derniers = db.scalars(select(PassageBadge).order_by(PassageBadge.recu_le.desc()).limit(15)).all()
    return {
        "cle": cle_pointeuse(db),
        "dernier_contact": parametres.lire(db, "pointeuse_dernier_contact"),
        "passages_total": db.scalar(select(func.count(PassageBadge.id))),
        "badges": parametres.lire(db, "badges_pointeuse", {}) or {},
        "derniers": [{"matricule": p.employe.matricule, "nom": f"{p.employe.prenom} {p.employe.nom}",
                      "horodatage": p.horodatage, "source": p.source, "terminal": p.terminal} for p in derniers],
    }


@router.post("/cle", summary="Générer une nouvelle clé (l'ancienne cesse de fonctionner)")
def regenerer(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    parametres.ecrire(db, "cle_pointeuse", secrets.token_urlsafe(32))
    db.add(JournalAudit(acteur_id=utilisateur.id, action="cle_pointeuse_regeneree", cible="Pointeuse"))
    db.commit()
    return {"cle": cle_pointeuse(db)}


@router.put("/badges", summary="Correspondance numéro de badge → matricule")
def badges(payload: CorrespondancePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    propre = {str(k).strip(): str(v).strip().upper() for k, v in payload.badges.items() if str(k).strip() and str(v).strip()}
    parametres.ecrire(db, "badges_pointeuse", propre)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="badges_pointeuse", cible="Pointeuse", detail=f"{len(propre)} badge(s)"))
    db.commit()
    return {"badges": propre}
