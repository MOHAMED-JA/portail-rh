"""Espace personnel : documents RH, signature électronique, recherche globale."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import Demande, DocumentRH, Employe, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402
from app.schemas import DocumentDetail
from app.services.demandes import libelle_sous_type

router = APIRouter(prefix="/api/espace", tags=["Espace personnel"])


class SignaturePayload(BaseModel):
    signature: str  # data URL PNG produite par le pavé de signature


@router.get("/documents", response_model=list[DocumentDetail], summary="Mes documents RH")
def documents(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return list(
        db.scalars(
            select(DocumentRH)
            .where(DocumentRH.employe_id == utilisateur.id)
            .order_by(DocumentRH.cree_le.desc())
        )
    )


@router.post("/documents/{document_id}/signer", response_model=DocumentDetail, summary="Signer un document")
def signer(
    document_id: int,
    payload: SignaturePayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    document = db.get(DocumentRH, document_id)
    if not document or document.employe_id != utilisateur.id:
        raise HTTPException(status_code=404, detail="Document introuvable")
    if not payload.signature.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="Signature invalide")
    document.signature = payload.signature
    document.signe = True
    db.commit()
    db.refresh(document)
    return document


@router.get("/recherche", summary="Recherche globale (palette de commandes)")
def recherche(
    q: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    """Alimente la palette Cmd+K : demandes, collaborateurs, documents."""
    motif = f"%{q.lower()}%"
    resultats: list[dict] = []

    demandes = db.scalars(
        select(Demande)
        .where(Demande.employe_id == utilisateur.id)
        .where(func.lower(Demande.reference).like(motif) | func.lower(Demande.sous_type).like(motif))
        .limit(5)
    ).all()
    for d in demandes:
        resultats.append({
            "categorie": "Mes demandes",
            "titre": f"{d.reference} — {libelle_sous_type(d.type_demande, d.sous_type)}",
            "sous_titre": f"{d.date_debut:%d/%m/%Y} → {d.date_fin:%d/%m/%Y} · {d.statut.value.replace('_', ' ')}",
            "route": "/mes-demandes",
            "icone": "file",
        })

    if utilisateur.role in (Role.VALIDATEUR, *ROLES_RH):
        requete = select(Employe).where(Employe.statut != StatutEmploye.SORTI).where(
            func.lower(Employe.nom).like(motif)
            | func.lower(Employe.prenom).like(motif)
            | func.lower(Employe.matricule).like(motif)
        )
        if utilisateur.role == Role.VALIDATEUR:
            requete = requete.where(Employe.validateur_id == utilisateur.id)
        for e in db.scalars(requete.limit(6)):
            resultats.append({
                "categorie": "Collaborateurs",
                "titre": f"{e.prenom} {e.nom}",
                "sous_titre": f"{e.matricule} · {e.poste}",
                "route": "/administration",
                "icone": "user",
            })

    documents_trouves = db.scalars(
        select(DocumentRH)
        .where(DocumentRH.employe_id == utilisateur.id, func.lower(DocumentRH.titre).like(motif))
        .limit(4)
    ).all()
    for doc in documents_trouves:
        resultats.append({
            "categorie": "Mes documents",
            "titre": doc.titre,
            "sous_titre": doc.periode or doc.categorie,
            "route": "/documents",
            "icone": "doc",
        })

    return resultats
