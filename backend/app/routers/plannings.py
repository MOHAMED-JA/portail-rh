"""Plannings hebdomadaires (lecture employé, édition drag & drop côté RH)."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant, valideur_requis
from app.models import Employe, Planning, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402
from app.schemas import PlanningDetail, PlanningPayload
from app.services.calendrier import code_semaine, est_ferie, lundi_de_semaine

router = APIRouter(prefix="/api/plannings", tags=["Plannings"])

POSTES = [
    {"code": "siege", "libelle": "Siège", "couleur": "#2B63C9"},
    {"code": "agence", "libelle": "Agence", "couleur": "#0E9F6E"},
    {"code": "teletravail", "libelle": "Télétravail", "couleur": "#8B5CF6"},
    {"code": "astreinte", "libelle": "Astreinte", "couleur": "#D9A441"},
    {"code": "terrain", "libelle": "Terrain", "couleur": "#E07A5F"},
    {"code": "formation", "libelle": "Formation", "couleur": "#3AA9D6"},
]


def _perimetre(db: Session, utilisateur: Employe, departement_id: int | None) -> list[Employe]:
    if utilisateur.role in ROLES_RH:
        requete = select(Employe).where(Employe.statut != StatutEmploye.SORTI)
        if departement_id:
            requete = requete.where(Employe.departement_id == departement_id)
        return list(db.scalars(requete.order_by(Employe.nom)))
    from app.services import hierarchie

    ids = hierarchie.perimetre_ids(db, utilisateur)
    if ids:
        requete = select(Employe).where(Employe.id.in_(ids))
        if departement_id:
            requete = requete.where(Employe.departement_id == departement_id)
        return [utilisateur, *db.scalars(requete.order_by(Employe.nom))]
    return [utilisateur]


@router.get("/postes", summary="Catalogue des postes de planning")
def postes():
    return POSTES


@router.get("/semaine", summary="Planning d'une semaine")
def planning_semaine(
    semaine: str | None = None,
    departement_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    semaine = semaine or code_semaine(date.today())
    try:
        lundi = lundi_de_semaine(semaine)
    except (ValueError, IndexError):
        raise HTTPException(status_code=422, detail="Code semaine invalide (format attendu : 2026-W38)")

    employes = _perimetre(db, utilisateur, departement_id)
    ids = [e.id for e in employes] or [-1]
    lignes = db.scalars(
        select(Planning).where(Planning.employe_id.in_(ids), Planning.semaine == semaine)
    ).all()

    jours = []
    for offset in range(7):
        jour = lundi + timedelta(days=offset)
        jours.append(
            {
                "date": jour.isoformat(),
                "libelle": ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"][offset],
                "ferie": est_ferie(jour),
                "weekend": offset >= 5,
            }
        )

    return {
        "semaine": semaine,
        "lundi": lundi.isoformat(),
        "jours": jours,
        "employes": [
            {
                "id": e.id,
                "matricule": e.matricule,
                "nom": f"{e.prenom} {e.nom}",
                "poste": e.poste,
                "departement": e.departement.nom if e.departement else None,
            }
            for e in employes
        ],
        "creneaux": [
            {
                "id": p.id,
                "employe_id": p.employe_id,
                "date": p.date_jour.isoformat(),
                "poste": p.poste,
                "heure_debut": p.heure_debut.strftime("%H:%M"),
                "heure_fin": p.heure_fin.strftime("%H:%M"),
                "note": p.note,
            }
            for p in lignes
        ],
    }


@router.put("/creneau", response_model=PlanningDetail, summary="Créer ou déplacer un créneau (RH)")
def enregistrer_creneau(
    payload: PlanningPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_requis),
):
    creneau = db.scalar(
        select(Planning).where(
            Planning.employe_id == payload.employe_id, Planning.date_jour == payload.date_jour
        )
    )
    if not creneau:
        creneau = Planning(
            employe_id=payload.employe_id,
            date_jour=payload.date_jour,
            semaine=code_semaine(payload.date_jour),
        )
        db.add(creneau)
    creneau.poste = payload.poste
    creneau.heure_debut = payload.heure_debut
    creneau.heure_fin = payload.heure_fin
    creneau.note = payload.note
    creneau.semaine = code_semaine(payload.date_jour)
    if payload.employe_id != utilisateur.id:
        from app.services.notifications import notifier
        notifier(db, payload.employe_id, "Planning mis à jour",
                 f"{payload.poste.capitalize()} le {payload.date_jour:%d/%m/%Y} "
                 f"({payload.heure_debut:%H:%M}–{payload.heure_fin:%H:%M}).", "info", "/plannings")
    db.commit()
    db.refresh(creneau)
    return creneau


@router.delete("/creneau/{creneau_id}", status_code=204, summary="Supprimer un créneau (RH)")
def supprimer_creneau(
    creneau_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_requis)
):
    creneau = db.get(Planning, creneau_id)
    if not creneau:
        raise HTTPException(status_code=404, detail="Créneau introuvable")
    db.delete(creneau)
    db.commit()


@router.post("/dupliquer", summary="Dupliquer une semaine vers la suivante (RH)")
def dupliquer_semaine(
    source: str,
    cible: str,
    departement_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_requis),
):
    lundi_source, lundi_cible = lundi_de_semaine(source), lundi_de_semaine(cible)
    employes = _perimetre(db, utilisateur, departement_id)
    ids = [e.id for e in employes] or [-1]
    creneaux = db.scalars(
        select(Planning).where(Planning.employe_id.in_(ids), Planning.semaine == source)
    ).all()
    if not creneaux:
        raise HTTPException(status_code=404, detail="La semaine source est vide")

    ecart = (lundi_cible - lundi_source).days
    crees = 0
    for c in creneaux:
        nouvelle_date = c.date_jour + timedelta(days=ecart)
        existant = db.scalar(
            select(Planning).where(
                Planning.employe_id == c.employe_id, Planning.date_jour == nouvelle_date
            )
        )
        if existant:
            continue
        db.add(
            Planning(
                employe_id=c.employe_id,
                date_jour=nouvelle_date,
                semaine=cible,
                poste=c.poste,
                heure_debut=c.heure_debut,
                heure_fin=c.heure_fin,
                note=c.note,
            )
        )
        crees += 1
    db.commit()
    return {"crees": crees, "semaine": cible}
