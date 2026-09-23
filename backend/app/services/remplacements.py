"""Passation atomique entre un responsable sortant et son remplaçant."""
from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Demande,
    Departement,
    Employe,
    EvenementCarriere,
    JournalAudit,
    Role,
    ROLES_RH,
    StatutDemande,
    StatutEmploye,
)
from app.services.hierarchie import NIVEAUX
from app.services.notifications import notifier

RANG_NIVEAU = {code: rang for rang, (code, _) in enumerate(NIVEAUX)}


def _nom(employe: Employe) -> str:
    return f"{employe.prenom} {employe.nom}"


def _charger(db: Session, responsable_id: int, remplacant_id: int) -> tuple[Employe, Employe]:
    if responsable_id == remplacant_id:
        raise HTTPException(status_code=422, detail="Le responsable et son remplaçant doivent être deux personnes différentes.")
    responsable = db.get(Employe, responsable_id)
    remplacant = db.get(Employe, remplacant_id)
    if responsable is None or remplacant is None:
        raise HTTPException(status_code=404, detail="Responsable ou remplaçant introuvable.")
    if responsable.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=422, detail="Le responsable est déjà sorti des effectifs.")
    if remplacant.statut != StatutEmploye.ACTIF:
        raise HTTPException(status_code=422, detail="Le remplaçant doit être un collaborateur actif.")
    return responsable, remplacant


def preparer(db: Session, responsable_id: int, remplacant_id: int) -> dict:
    """Calcule la passation sans modifier la base."""
    responsable, remplacant = _charger(db, responsable_id, remplacant_id)
    equipe = list(db.scalars(select(Employe).where(
        Employe.validateur_id == responsable.id,
        Employe.id.not_in((responsable.id, remplacant.id)),
        Employe.statut != StatutEmploye.SORTI,
    ).order_by(Employe.nom, Employe.prenom)))
    structures = list(db.scalars(select(Departement).where(
        Departement.responsable_id == responsable.id
    ).order_by(Departement.nom)))
    demandes = list(db.scalars(select(Demande).where(
        Demande.validateur_id == responsable.id,
        Demande.statut == StatutDemande.EN_ATTENTE,
    )))

    # Si le remplaçant était sous le responsable, il monte à la place de celui-ci.
    # Si le responsable relevait déjà du remplaçant, la ligne du remplaçant ne change pas.
    nouveau_superieur_id = (
        remplacant.validateur_id if responsable.validateur_id == remplacant.id
        else responsable.validateur_id
    )
    niveau_responsable = responsable.niveau or "collaborateur"
    niveau_remplacant = remplacant.niveau or "collaborateur"
    nouveau_niveau = (
        niveau_responsable
        if RANG_NIVEAU.get(niveau_remplacant, 0) < RANG_NIVEAU.get(niveau_responsable, 0)
        else niveau_remplacant
    )
    changements_profil = []
    if remplacant.validateur_id != nouveau_superieur_id:
        changements_profil.append("supérieur hiérarchique")
    if responsable.departement_id is not None and remplacant.departement_id != responsable.departement_id:
        changements_profil.append("structure d'affectation")
    if remplacant.role == Role.EMPLOYE:
        changements_profil.append("profil Supérieur hiérarchique")
    if nouveau_niveau != niveau_remplacant:
        changements_profil.append(f"niveau {nouveau_niveau}")

    demandes_personnelles = [d for d in demandes if d.employe_id == remplacant.id]
    return {
        "responsable": {"id": responsable.id, "matricule": responsable.matricule, "nom": _nom(responsable)},
        "remplacant": {"id": remplacant.id, "matricule": remplacant.matricule, "nom": _nom(remplacant)},
        "collaborateurs": [{"id": e.id, "matricule": e.matricule, "nom": _nom(e)} for e in equipe],
        "structures": [{"id": d.id, "code": d.code, "nom": d.nom} for d in structures],
        "demandes_en_attente": len(demandes),
        "demandes_personnelles_reorientees": len(demandes_personnelles),
        "changements_profil": changements_profil,
        "nouveau_superieur_id": nouveau_superieur_id,
        "nouveau_niveau": nouveau_niveau,
        "total_changements": len(equipe) + len(structures) + len(demandes) + len(changements_profil),
    }


def appliquer(db: Session, responsable_id: int, remplacant_id: int, acteur: Employe) -> dict:
    """Applique la passation dans la transaction de l'appelant."""
    rapport = preparer(db, responsable_id, remplacant_id)
    responsable, remplacant = _charger(db, responsable_id, remplacant_id)

    # Le remplaçant prend d'abord sa nouvelle place, puis l'équipe est transférée.
    remplacant.validateur_id = rapport["nouveau_superieur_id"]
    if responsable.departement_id is not None:
        remplacant.departement_id = responsable.departement_id
    if remplacant.role == Role.EMPLOYE:
        remplacant.role = Role.VALIDATEUR
    remplacant.niveau = rapport["nouveau_niveau"]

    for membre in db.scalars(select(Employe).where(
        Employe.validateur_id == responsable.id,
        Employe.id.not_in((responsable.id, remplacant.id)),
        Employe.statut != StatutEmploye.SORTI,
    )):
        membre.validateur_id = remplacant.id
    for structure in db.scalars(select(Departement).where(Departement.responsable_id == responsable.id)):
        structure.responsable_id = remplacant.id

    # Le remplaçant ne peut jamais valider sa propre demande.
    secours_id = rapport["nouveau_superieur_id"]
    if secours_id in (None, remplacant.id):
        secours_id = db.scalar(select(Employe.id).where(
            Employe.role.in_(ROLES_RH),
            Employe.id != remplacant.id,
            Employe.statut != StatutEmploye.SORTI,
        ).order_by(Employe.id))
    for demande in db.scalars(select(Demande).where(
        Demande.validateur_id == responsable.id,
        Demande.statut == StatutDemande.EN_ATTENTE,
    )):
        demande.validateur_id = secours_id if demande.employe_id == remplacant.id else remplacant.id

    detail = {
        "responsable": rapport["responsable"],
        "remplacant": rapport["remplacant"],
        "collaborateurs": [e["matricule"] for e in rapport["collaborateurs"]],
        "structures": [d["code"] for d in rapport["structures"]],
        "demandes": rapport["demandes_en_attente"],
        "changements_profil": rapport["changements_profil"],
    }
    db.add(EvenementCarriere(
        employe_id=remplacant.id,
        date_effet=date.today(),
        type_evenement="prise_responsabilite",
        avant=remplacant.poste,
        apres=f"Remplacement de {_nom(responsable)}",
        saisi_par_id=acteur.id,
        commentaire="Transfert de structure, équipe et demandes en attente",
    ))
    db.add(JournalAudit(
        acteur_id=acteur.id,
        action="remplacement_responsable",
        cible=f"{responsable.matricule}→{remplacant.matricule}",
        detail=json.dumps(detail, ensure_ascii=False),
    ))
    notifier(
        db,
        remplacant.id,
        "Nouvelles responsabilités",
        f"Les responsabilités de {_nom(responsable)} vous ont été transférées : "
        f"{len(rapport['structures'])} structure(s), {len(rapport['collaborateurs'])} collaborateur(s) "
        f"et {rapport['demandes_en_attente']} demande(s) en attente.",
        "info",
        "/organigramme",
    )
    return rapport
