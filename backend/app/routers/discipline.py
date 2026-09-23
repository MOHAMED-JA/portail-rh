"""Dossier disciplinaire : procédures et sanctions. Réservé à la RH ; les faits
et observations sont chiffrés en base. Le collaborateur retrouve les
sanctions qui lui ont été notifiées dans « Mes données » (droit d'accès)."""
from __future__ import annotations

import shutil
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import admin_requis
from app.models import Employe, JournalAudit, Sanction

router = APIRouter(prefix="/api/discipline", tags=["Dossier disciplinaire"])

# Catégories usuelles ; à aligner sur le règlement intérieur et la convention collective.
TYPES = {"avertissement": "Avertissement", "blame": "Blâme", "mise_a_pied": "Mise à pied",
         "mutation_disciplinaire": "Mutation disciplinaire", "retrogradation": "Rétrogradation",
         "licenciement": "Licenciement", "autre": "Autre mesure"}
STATUTS = {"instruction": "En instruction", "notifiee": "Notifiée", "annulee": "Annulée"}


def _json(s: Sanction) -> dict:
    return {"id": s.id, "type": s.type_sanction, "type_libelle": TYPES[s.type_sanction], "date_faits": s.date_faits,
            "faits": s.faits, "date_entretien": s.date_entretien, "date_notification": s.date_notification,
            "jours_mise_a_pied": s.jours_mise_a_pied, "reference": s.reference, "observations": s.observations,
            "piece_jointe": s.piece_jointe, "statut": s.statut, "statut_libelle": STATUTS[s.statut],
            "cree_le": s.cree_le, "cree_par": f"{s.cree_par.prenom} {s.cree_par.nom}" if s.cree_par else None,
            "employe": {"matricule": s.employe.matricule, "nom": s.employe.nom, "prenom": s.employe.prenom,
                        "poste": s.employe.poste}}


def _employe(db: Session, matricule: str) -> Employe:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    return e


def _charger(db: Session, sanction_id: int, u: Employe) -> Sanction:
    s = db.get(Sanction, sanction_id)
    if not s:
        raise HTTPException(status_code=404, detail="Procédure introuvable")
    if s.employe_id == u.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas traiter un dossier vous concernant.")
    return s


class SanctionPayload(BaseModel):
    matricule: str
    type_sanction: str
    date_faits: date
    faits: str = Field(min_length=10, max_length=6000)
    date_entretien: date | None = None
    jours_mise_a_pied: int | None = Field(default=None, ge=1, le=60)
    reference: str | None = Field(default=None, max_length=80)
    observations: str | None = Field(default=None, max_length=4000)


def _verifier(payload: SanctionPayload) -> None:
    if payload.type_sanction not in TYPES:
        raise HTTPException(status_code=422, detail="Type de mesure inconnu")
    if payload.type_sanction == "mise_a_pied" and not payload.jours_mise_a_pied:
        raise HTTPException(status_code=422, detail="Indiquez la durée de la mise à pied.")
    if payload.date_faits > date.today():
        raise HTTPException(status_code=422, detail="La date des faits ne peut pas être dans le futur.")


@router.get("", summary="Procédures disciplinaires (RH)")
def lister(matricule: str | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    requete = select(Sanction).order_by(Sanction.date_faits.desc())
    if matricule:
        requete = requete.where(Sanction.employe_id == _employe(db, matricule).id)
    return [_json(s) for s in db.scalars(requete.limit(500)) if s.employe_id != utilisateur.id]


@router.post("", status_code=201, summary="Ouvrir une procédure (RH)")
def ouvrir(payload: SanctionPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    _verifier(payload)
    e = _employe(db, payload.matricule)
    if e.id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas ouvrir de procédure vous concernant.")
    s = Sanction(employe_id=e.id, cree_par_id=utilisateur.id, **payload.model_dump(exclude={"matricule"}))
    db.add(s)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="discipline_ouverte", cible=e.matricule, detail=TYPES[s.type_sanction]))
    db.commit()
    return _json(s)


@router.put("/{sanction_id}", summary="Compléter une procédure en instruction (RH)")
def modifier(sanction_id: int, payload: SanctionPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = _charger(db, sanction_id, utilisateur)
    if s.statut != "instruction":
        raise HTTPException(status_code=409, detail="Une mesure notifiée ou annulée n'est plus modifiable.")
    _verifier(payload)
    for champ, valeur in payload.model_dump(exclude={"matricule"}).items():
        setattr(s, champ, valeur)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="discipline_modifiee", cible=s.employe.matricule))
    db.commit()
    return _json(s)


class NotificationPayload(BaseModel):
    date_notification: date
    reference: str | None = Field(default=None, max_length=80)


@router.post("/{sanction_id}/notifier", summary="Enregistrer la notification de la mesure (RH)")
def notifier_mesure(sanction_id: int, payload: NotificationPayload, db: Session = Depends(get_db),
                    utilisateur: Employe = Depends(admin_requis)):
    s = _charger(db, sanction_id, utilisateur)
    if s.statut != "instruction":
        raise HTTPException(status_code=409, detail="Cette mesure a déjà été traitée.")
    if payload.date_notification < s.date_faits:
        raise HTTPException(status_code=422, detail="La notification ne peut pas précéder les faits.")
    s.statut, s.date_notification = "notifiee", payload.date_notification
    s.reference = payload.reference or s.reference
    db.add(JournalAudit(acteur_id=utilisateur.id, action="discipline_notifiee", cible=s.employe.matricule, detail=TYPES[s.type_sanction]))
    db.commit()
    return _json(s)


class AnnulationPayload(BaseModel):
    motif: str = Field(min_length=3, max_length=1000)


@router.post("/{sanction_id}/annuler", summary="Annuler une procédure (classement, décision contraire) (RH)")
def annuler(sanction_id: int, payload: AnnulationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = _charger(db, sanction_id, utilisateur)
    if s.statut == "annulee":
        raise HTTPException(status_code=409, detail="Déjà annulée.")
    s.statut = "annulee"
    s.observations = ((s.observations + "\n") if s.observations else "") + f"Annulation : {payload.motif.strip()}"
    db.add(JournalAudit(acteur_id=utilisateur.id, action="discipline_annulee", cible=s.employe.matricule))
    db.commit()
    return _json(s)


@router.post("/{sanction_id}/piece", summary="Joindre une pièce (convocation, décision…) (RH)")
def joindre(sanction_id: int, fichier: UploadFile = File(...), db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = _charger(db, sanction_id, utilisateur)
    extension = Path(fichier.filename or "").suffix.lower()
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=415, detail="Format non compatible : PDF, DOC ou DOCX uniquement.")
    cible = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / cible).open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)
    s.piece_jointe = f"/fichiers/{cible}"
    db.commit()
    return _json(s)


def sanctions_notifiees(db: Session, employe_id: int) -> list[dict]:
    """Pour « Mes données » : mesures notifiées à l'intéressé."""
    return [{"type": TYPES[s.type_sanction], "date_faits": str(s.date_faits), "date_notification": str(s.date_notification),
             "reference": s.reference} for s in db.scalars(select(Sanction).where(
                 Sanction.employe_id == employe_id, Sanction.statut == "notifiee").order_by(Sanction.date_notification))]
