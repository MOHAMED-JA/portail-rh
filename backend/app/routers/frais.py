"""Notes de frais : saisie, transmission, validation par le supérieur
hiérarchique, remboursement par l'administration RH."""
from __future__ import annotations

import random
import shutil
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import Employe, JournalAudit, LigneFrais, NoteFrais, Role, StatutEmploye, StatutNoteFrais
from app.models import ROLES_RH  # noqa: E402
from app.services.notifications import notifier

router = APIRouter(prefix="/api/frais", tags=["Notes de frais"])
CATEGORIES = {"transport", "repas", "hebergement", "carburant", "divers"}


class LigneSaisie(BaseModel):
    date: date
    categorie: str
    libelle: str | None = None
    montant: float = Field(gt=0, le=100000)


class NotePayload(BaseModel):
    periode: str = Field(min_length=4, max_length=10)
    mission_reference: str | None = None
    lignes: list[LigneSaisie]
    transmettre: bool = False


class MotifPayload(BaseModel):
    motif: str | None = None


def dinars(montant: float) -> str:
    return f"{montant:,.3f}".replace(",", " ").replace(".", ",") + " DT"


def valideurs(db: Session, employe: Employe) -> list[Employe]:
    if employe.validateur_id:
        return [employe.validateur]
    return list(db.scalars(select(Employe).where(
        Employe.role.in_(ROLES_RH), Employe.id != employe.id, Employe.statut != StatutEmploye.SORTI)))


def peut_decider(db: Session, utilisateur: Employe, note: NoteFrais) -> bool:
    if note.employe_id == utilisateur.id:
        return False
    return utilisateur.id in {v.id for v in valideurs(db, note.employe)}


def detail(note: NoteFrais) -> dict:
    e = note.employe
    return {
        "id": note.id, "reference": note.reference, "periode": note.periode,
        "mission_reference": note.mission_reference, "statut": note.statut.value, "total": note.total,
        "employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom},
        "valideur": {"matricule": note.valideur.matricule, "nom": note.valideur.nom, "prenom": note.valideur.prenom} if note.valideur else None,
        "motif_refus": note.motif_refus,
        "justificatifs": [j for j in (note.justificatifs or "").split("|") if j],
        "cree_le": note.cree_le, "transmise_le": note.transmise_le, "decidee_le": note.decidee_le,
        "remboursee_le": note.remboursee_le,
        "lignes": [{"date": l.date_depense, "categorie": l.categorie, "libelle": l.libelle, "montant": l.montant}
                   for l in note.lignes],
    }


def charger(db: Session, note_id: int) -> NoteFrais:
    note = db.get(NoteFrais, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note de frais introuvable")
    return note


def transmettre_note(db: Session, note: NoteFrais) -> None:
    note.statut = StatutNoteFrais.EN_ATTENTE
    note.transmise_le = datetime.utcnow()
    for v in valideurs(db, note.employe):
        notifier(db, v.id, "Note de frais à valider",
                 f"{note.employe.prenom} {note.employe.nom} — {note.reference} ({dinars(note.total)})",
                 "validation", "/notes-de-frais")


@router.get("", summary="Notes visibles : les miennes, celles à valider, toutes pour la RH")
def lister(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(NoteFrais).order_by(NoteFrais.cree_le.desc())
    if utilisateur.role not in ROLES_RH:
        equipe = [e.id for e in db.scalars(select(Employe).where(Employe.validateur_id == utilisateur.id))]
        requete = requete.where(NoteFrais.employe_id.in_([utilisateur.id, *equipe]))
    notes = db.scalars(requete.limit(1000)).all()
    # Les brouillons des autres ne sont pas montrés.
    return [detail(n) for n in notes if n.employe_id == utilisateur.id or n.statut != StatutNoteFrais.BROUILLON]


@router.post("", summary="Créer une note de frais (brouillon ou transmise)")
def creer(payload: NotePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not payload.lignes:
        raise HTTPException(status_code=422, detail="Renseignez au moins une dépense.")
    if any(l.categorie not in CATEGORIES for l in payload.lignes):
        raise HTTPException(status_code=422, detail="Catégorie de dépense inconnue.")
    reference = f"NF-{date.today().year}-{random.randint(10000, 99999)}"
    while db.scalar(select(NoteFrais).where(NoteFrais.reference == reference)):
        reference = f"NF-{date.today().year}-{random.randint(10000, 99999)}"
    note = NoteFrais(reference=reference, employe_id=utilisateur.id, periode=payload.periode,
                     mission_reference=payload.mission_reference or None,
                     total=round(sum(l.montant for l in payload.lignes), 3))
    note.lignes = [LigneFrais(date_depense=l.date, categorie=l.categorie, libelle=(l.libelle or "").strip() or None,
                              montant=round(l.montant, 3)) for l in payload.lignes]
    note.employe = utilisateur
    db.add(note)
    db.flush()
    if payload.transmettre:
        transmettre_note(db, note)
    db.commit()
    db.refresh(note)
    return detail(note)


@router.post("/{note_id}/justificatifs", summary="Joindre un justificatif (PDF, DOC, DOCX)")
def joindre(note_id: int, fichier: UploadFile = File(...), db: Session = Depends(get_db),
            utilisateur: Employe = Depends(utilisateur_courant)):
    note = charger(db, note_id)
    if note.employe_id != utilisateur.id:
        raise HTTPException(status_code=403, detail="Seul l'auteur de la note peut y joindre un justificatif.")
    nom = fichier.filename or ""
    extension = ("." + nom.rsplit(".", 1)[-1].lower()) if "." in nom else ""
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=422, detail="Format non compatible : seuls les fichiers PDF, DOC et DOCX sont acceptés.")
    cible = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / cible).open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)
    liste = [j for j in (note.justificatifs or "").split("|") if j]
    liste.append(f"/fichiers/{cible}::{nom}")
    note.justificatifs = "|".join(liste)
    db.commit()
    return detail(note)


@router.post("/{note_id}/transmettre", summary="Transmettre un brouillon au supérieur")
def transmettre(note_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    note = charger(db, note_id)
    if note.employe_id != utilisateur.id or note.statut != StatutNoteFrais.BROUILLON:
        raise HTTPException(status_code=403, detail="Seul un brouillon de l'auteur peut être transmis.")
    transmettre_note(db, note)
    db.commit()
    return detail(note)


@router.delete("/{note_id}", status_code=204, summary="Supprimer un brouillon")
def supprimer(note_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    note = charger(db, note_id)
    if note.employe_id != utilisateur.id or note.statut != StatutNoteFrais.BROUILLON:
        raise HTTPException(status_code=403, detail="Seul un brouillon de l'auteur peut être supprimé.")
    db.delete(note)
    db.commit()


def _decider(db: Session, utilisateur: Employe, note_id: int, approuve: bool, motif: str | None) -> dict:
    note = charger(db, note_id)
    if note.statut != StatutNoteFrais.EN_ATTENTE:
        raise HTTPException(status_code=409, detail="Cette note n'est plus en attente de validation.")
    if not peut_decider(db, utilisateur, note):
        raise HTTPException(status_code=403, detail="Seul le supérieur hiérarchique du collaborateur peut décider.")
    note.statut = StatutNoteFrais.APPROUVEE if approuve else StatutNoteFrais.REJETEE
    note.valideur_id = utilisateur.id
    note.decidee_le = datetime.utcnow()
    note.motif_refus = None if approuve else (motif or "").strip() or None
    notifier(db, note.employe_id,
             "Note de frais approuvée" if approuve else "Note de frais refusée",
             f"{note.reference} · {dinars(note.total)}"
             + (" — transmise à la RH pour remboursement." if approuve else (f" — {note.motif_refus}" if note.motif_refus else "")),
             "succes" if approuve else "alerte", "/notes-de-frais")
    if approuve:
        for admin in db.scalars(select(Employe).where(Employe.role.in_(ROLES_RH), Employe.statut != StatutEmploye.SORTI)):
            if admin.id != utilisateur.id:
                notifier(db, admin.id, "Note de frais à rembourser",
                         f"{note.employe.prenom} {note.employe.nom} — {note.reference} ({dinars(note.total)})",
                         "info", "/notes-de-frais")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="note_frais_" + ("approuvee" if approuve else "refusee"),
                        cible=note.reference, detail=dinars(note.total)))
    db.commit()
    return detail(note)


@router.post("/{note_id}/approuver", summary="Approuver (supérieur hiérarchique)")
def approuver(note_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return _decider(db, utilisateur, note_id, True, None)


@router.post("/{note_id}/rejeter", summary="Refuser (supérieur hiérarchique)")
def rejeter(note_id: int, payload: MotifPayload, db: Session = Depends(get_db),
            utilisateur: Employe = Depends(utilisateur_courant)):
    return _decider(db, utilisateur, note_id, False, payload.motif)


@router.post("/{note_id}/rembourser", summary="Marquer comme remboursée (administration RH)")
def rembourser(note_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    note = charger(db, note_id)
    if note.statut != StatutNoteFrais.APPROUVEE:
        raise HTTPException(status_code=409, detail="Seule une note approuvée peut être remboursée.")
    note.statut = StatutNoteFrais.REMBOURSEE
    note.remboursee_le = datetime.utcnow()
    notifier(db, note.employe_id, "Note de frais remboursée", f"{note.reference} · {dinars(note.total)} mis en paiement.",
             "succes", "/notes-de-frais")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="note_frais_remboursee", cible=note.reference, detail=dinars(note.total)))
    db.commit()
    return detail(note)
