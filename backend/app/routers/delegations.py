"""Délégation de validation : déclarer un remplaçant pendant son absence.

Un valideur déclare lui-même son remplaçant ; l'administration RH peut le faire
pour n'importe qui, et voit toutes les délégations. La décision prise par le
remplaçant reste inscrite à son nom dans l'historique de la demande.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import DelegationValidation, Employe, JournalAudit, ROLES_RH, StatutEmploye
from app.services import delegation as svc
from app.services.notifications import notifier

router = APIRouter(prefix="/api/delegations", tags=["Délégation de validation"])


class DelegationPayload(BaseModel):
    titulaire_id: int | None = None          # la RH délègue pour un autre valideur
    suppleant_id: int
    debut: date
    fin: date
    motif: str | None = Field(default=None, max_length=120)


def _titulaire(db: Session, payload_titulaire_id: int | None, utilisateur: Employe) -> Employe:
    if payload_titulaire_id is None or payload_titulaire_id == utilisateur.id:
        return utilisateur
    if utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail=(
            "Vous ne pouvez déclarer un remplaçant que pour vous-même."))
    titulaire = db.get(Employe, payload_titulaire_id)
    if titulaire is None or titulaire.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=404, detail="Valideur introuvable.")
    return titulaire


@router.get("", summary="Mes délégations (et toutes, pour la RH)")
def lister(toutes: bool = False, db: Session = Depends(get_db),
           utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(DelegationValidation).order_by(DelegationValidation.debut.desc())
    if toutes:
        if utilisateur.role not in ROLES_RH:
            raise HTTPException(status_code=403, detail="Réservé à l'administration RH.")
    else:
        requete = requete.where(or_(DelegationValidation.titulaire_id == utilisateur.id,
                                    DelegationValidation.suppleant_id == utilisateur.id))
    return [svc.resume(d) for d in db.scalars(requete.limit(200))]


@router.post("", status_code=201, summary="Déclarer un remplaçant")
def declarer(payload: DelegationPayload, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(utilisateur_courant)):
    titulaire = _titulaire(db, payload.titulaire_id, utilisateur)
    suppleant = svc.verifier(db, titulaire, payload.suppleant_id, payload.debut, payload.fin)

    delegation = DelegationValidation(
        titulaire_id=titulaire.id, suppleant_id=suppleant.id, debut=payload.debut,
        fin=payload.fin, motif=(payload.motif or None), cree_par_id=utilisateur.id)
    db.add(delegation)
    db.add(JournalAudit(
        acteur_id=utilisateur.id, action="delegation_validation", cible=titulaire.matricule,
        detail=f"{suppleant.nom_complet} remplace {titulaire.nom_complet} "
               f"du {payload.debut:%d/%m/%Y} au {payload.fin:%d/%m/%Y}"))
    periode = f"du {payload.debut:%d/%m/%Y} au {payload.fin:%d/%m/%Y}"
    notifier(db, suppleant.id, "Vous remplacez un valideur",
             f"{titulaire.nom_complet} vous a désigné pour décider de ses demandes {periode}.",
             "action", "/valider")
    if titulaire.id != utilisateur.id:
        notifier(db, titulaire.id, "Remplaçant désigné",
                 f"L'administration RH a désigné {suppleant.nom_complet} pour décider "
                 f"de vos demandes {periode}.", "info", "/valider")
    db.commit()
    db.refresh(delegation)
    return svc.resume(delegation)


@router.delete("/{delegation_id}", status_code=204, summary="Annuler une délégation")
def annuler(delegation_id: int, db: Session = Depends(get_db),
            utilisateur: Employe = Depends(utilisateur_courant)):
    delegation = db.get(DelegationValidation, delegation_id)
    if delegation is None:
        raise HTTPException(status_code=404, detail="Délégation introuvable.")
    if delegation.titulaire_id != utilisateur.id and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Seul le titulaire ou la RH peut l'annuler.")
    if delegation.annulee_le is not None:
        raise HTTPException(status_code=409, detail="Cette délégation est déjà annulée.")
    delegation.annulee_le = datetime.utcnow()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="delegation_annulee",
                        cible=delegation.titulaire.matricule,
                        detail=f"Remplacement par {delegation.suppleant.nom_complet} annulé"))
    notifier(db, delegation.suppleant_id, "Remplacement terminé",
             f"Vous ne décidez plus des demandes de {delegation.titulaire.nom_complet}.",
             "info", "/valider")
    db.commit()


@router.get("/valideurs", summary="Valideurs et leur remplaçant du jour (RH)")
def valideurs(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    """Vue RH : qui décide aujourd'hui pour chaque encadrant."""
    encadrants = db.scalars(select(Employe).where(
        Employe.statut != StatutEmploye.SORTI,
        Employe.id.in_(select(Employe.validateur_id).where(Employe.validateur_id.isnot(None)))))
    lignes = []
    for e in encadrants:
        remplacant = svc.suppleant_de(db, e.id)
        lignes.append({
            "employe": {"id": e.id, "matricule": e.matricule, "nom": e.nom_complet},
            "remplacant": {"id": remplacant.id, "nom": remplacant.nom_complet} if remplacant else None,
        })
    return sorted(lignes, key=lambda x: (x["remplacant"] is None, x["employe"]["nom"]))
