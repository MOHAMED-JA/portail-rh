"""Prévisions RH (12 mois) : RH et Direction générale en consultation ;
hypothèses et effectifs cibles réglés par l'administrateur RH. La liste
nominative des départs connus reste réservée à la RH."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import administrateur_requis, utilisateur_courant
from app.models import ROLES_RH, Employe, JournalAudit
from app.services import hierarchie, parametres, previsions

router = APIRouter(prefix="/api/previsions", tags=["Prévisions RH"])


@router.get("", summary="Prévisions sur 12 mois par pôle ou direction (RH et Direction générale)")
def consulter(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    return previsions.calculer(db, rh=utilisateur.role in ROLES_RH)


class HypothesesPayload(BaseModel):
    taux_absenteisme: float = Field(ge=0, le=30)
    taux_depart: float = Field(ge=0, le=50)
    seuil_presence: int = Field(ge=50, le=100)
    saison_absences: list[float] = Field(min_length=12, max_length=12)
    saison_conges: list[float] = Field(min_length=12, max_length=12)
    effectifs_cibles: dict[str, int] = Field(default_factory=dict)

    @field_validator("saison_absences", "saison_conges")
    @classmethod
    def coefficients(cls, valeurs: list[float]) -> list[float]:
        if any(v < 0 or v > 5 for v in valeurs):
            raise ValueError("Chaque coefficient mensuel doit être compris entre 0 et 5.")
        return [round(v, 2) for v in valeurs]

    @field_validator("effectifs_cibles")
    @classmethod
    def cibles(cls, valeurs: dict[str, int]) -> dict[str, int]:
        if any(v < 0 or v > 5000 for v in valeurs.values()):
            raise ValueError("Un effectif cible doit être compris entre 0 et 5 000.")
        return valeurs


@router.put("/hypotheses", summary="Régler les repères et les effectifs cibles (administrateur RH)")
def regler(payload: HypothesesPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    codes = {d.code for d in previsions.structures(db).values()}
    inconnus = set(payload.effectifs_cibles) - codes
    if inconnus:
        raise HTTPException(status_code=422, detail=f"Structure inconnue : {', '.join(sorted(inconnus))}.")
    avant = previsions.hypotheses(db)
    apres = payload.model_dump()
    parametres.ecrire(db, previsions.CLE_HYPOTHESES, apres)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="previsions_hypotheses", cible=previsions.CLE_HYPOTHESES,
                        detail=json.dumps({"avant": avant, "apres": apres}, ensure_ascii=False)))
    db.commit()
    return previsions.hypotheses(db)
