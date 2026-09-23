"""Confirmation progressive de l'architecture et des responsables de structures."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import administrateur_requis
from app.models import ConfirmationArchitecture, Departement, Employe, JournalAudit, StatutEmploye

router = APIRouter(prefix="/api/architecture", tags=["Architecture"])


class ConfirmationResponsablePayload(BaseModel):
    responsable_id: int | None = None


def _employe(employe: Employe | None) -> dict | None:
    if employe is None:
        return None
    return {"id": employe.id, "matricule": employe.matricule, "identite": employe.nom_complet,
            "poste": employe.poste, "niveau": employe.niveau, "departement_id": employe.departement_id}


@router.get("/confirmations", summary="Questions de confirmation de l'organigramme")
def lister_confirmations(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    """Retourne une question par structure, sans reprendre les titulaires historiques."""
    structures = list(db.scalars(select(Departement).order_by(Departement.nom)))
    confirmations = {ligne.structure_id: ligne for ligne in db.scalars(select(ConfirmationArchitecture))}
    actifs = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI).order_by(
        Employe.nom, Employe.prenom
    )))
    return {
        "total": len(structures), "confirmees": len(confirmations),
        "candidats": [_employe(employe) for employe in actifs],
        "questions": [{"structure_id": structure.id, "code": structure.code, "structure": structure.nom,
                       "parent_id": structure.parent_id, "responsable_actuel": _employe(structure.responsable),
                       "confirmee": structure.id in confirmations,
                       "confirmee_le": confirmations[structure.id].confirme_le.isoformat() if structure.id in confirmations else None}
                      for structure in structures],
    }


@router.put("/confirmations/{structure_id}", summary="Confirmer le responsable d'une structure")
def confirmer_responsable(structure_id: int, payload: ConfirmationResponsablePayload,
                          db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    structure = db.get(Departement, structure_id)
    if structure is None:
        raise HTTPException(status_code=404, detail="Structure introuvable.")
    responsable = db.get(Employe, payload.responsable_id) if payload.responsable_id is not None else None
    if payload.responsable_id is not None and (responsable is None or responsable.statut == StatutEmploye.SORTI):
        raise HTTPException(status_code=422, detail="Le responsable choisi est introuvable ou sorti des effectifs.")
    structure.responsable_id = responsable.id if responsable else None
    confirmation = db.scalar(select(ConfirmationArchitecture).where(ConfirmationArchitecture.structure_id == structure.id))
    if confirmation is None:
        confirmation = ConfirmationArchitecture(structure_id=structure.id, responsable_confirme_id=structure.responsable_id,
                                                confirme_par_id=utilisateur.id)
        db.add(confirmation)
    else:
        confirmation.responsable_confirme_id = structure.responsable_id
        confirmation.confirme_par_id = utilisateur.id
        confirmation.confirme_le = datetime.utcnow()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="confirmation_architecture", cible=structure.code,
                        detail=f"Responsable confirmé : {responsable.nom_complet if responsable else 'aucun'}"))
    db.commit()
    return {"structure_id": structure.id, "responsable": _employe(responsable), "confirmee": True}
