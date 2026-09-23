"""Formations : catalogue des sessions (géré par l'administration RH) et
inscriptions des collaborateurs."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import Employe, Formation, InscriptionFormation, JournalAudit
from app.services.notifications import notifier

router = APIRouter(prefix="/api/formations", tags=["Formations"])

CATALOGUE_INITIAL = [
    ("Solvabilité II — fondamentaux", "Technique", 2, "Contrôle prudentiel, provisionnement et reporting réglementaire.", "Centre de formation Charguia", "IFID", 14),
    ("Lutte anti-blanchiment (LAB/FT)", "Conformité", 1, "Obligation annuelle CGA — vigilance, déclaration de soupçon.", "Siège — Tunis", "Interne — DRH", 20),
    ("Souscription IARD entreprises", "Technique", 3, "Analyse de risque industriel et tarification.", "Siège — Tunis", "Cabinet Actuaris", 12),
    ("Excel avancé pour la gestion", "Bureautique", 2, "Tableaux croisés, Power Query, tableaux de bord.", "À distance", "CFPA Tunis", 16),
    ("Relation client difficile", "Relationnel", 2, "Gestion des réclamations et désamorçage de conflit.", "Agence Lac 2", "Interne — DRH", 12),
    ("Cybersécurité — bonnes pratiques", "Sécurité", 1, "Hameçonnage, mots de passe, données personnelles.", "À distance", "Interne — DSI", 25),
    ("Management d'équipe de proximité", "Management", 3, "Animation, délégation, entretiens de recadrage.", "Hôtel Laico Tunis", "IFID", 10),
    ("Assurance vie et épargne retraite", "Technique", 2, "Produits, fiscalité tunisienne et conseil patrimonial.", "Centre de formation Charguia", "Cabinet Actuaris", 14),
]


def initialiser_catalogue(db: Session) -> None:
    """Premier démarrage : un catalogue de sessions à venir, que la RH
    complète ou modifie ensuite."""
    if db.scalar(select(Formation.id).limit(1)) is not None:
        return
    depart = date.today() + timedelta(days=14)
    for i, (titre, theme, jours, description, lieu, formateur, places) in enumerate(CATALOGUE_INITIAL):
        debut = depart + timedelta(days=9 * i)
        while debut.weekday() >= 5:
            debut += timedelta(days=1)
        db.add(Formation(titre=titre, theme=theme, description=description, date_debut=debut,
                         date_fin=debut + timedelta(days=jours - 1), lieu=lieu, formateur=formateur, places=places))
    db.commit()


class FormationPayload(BaseModel):
    titre: str = Field(min_length=3, max_length=160)
    theme: str = Field(min_length=2, max_length=40)
    description: str | None = None
    date_debut: date
    date_fin: date
    lieu: str = Field(min_length=2, max_length=120)
    formateur: str | None = None
    places: int = Field(ge=1, le=500)
    cout: float = Field(default=0, ge=0)


def detail(f: Formation) -> dict:
    return {
        "id": f.id, "titre": f.titre, "theme": f.theme, "description": f.description,
        "debut": f.date_debut, "fin": f.date_fin, "jours": (f.date_fin - f.date_debut).days + 1,
        "lieu": f.lieu, "formateur": f.formateur, "places": f.places, "cout": f.cout or 0,
        "inscrits": [i.employe.matricule for i in f.inscriptions],
    }


@router.get("", summary="Catalogue des formations")
def lister(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return [detail(f) for f in db.scalars(select(Formation).where(Formation.active.is_(True)).order_by(Formation.date_debut))]


@router.post("", summary="Créer une session (administration RH)")
def creer(payload: FormationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    if payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début.")
    f = Formation(**{k: v for k, v in payload.model_dump().items()})
    db.add(f)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="formation_creee", cible=payload.titre))
    db.commit()
    db.refresh(f)
    return detail(f)


@router.delete("/{formation_id}", status_code=204, summary="Retirer une session (administration RH)")
def retirer(formation_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    f = db.get(Formation, formation_id)
    if not f:
        raise HTTPException(status_code=404, detail="Formation introuvable")
    for inscription in f.inscriptions:
        notifier(db, inscription.employe_id, "Formation annulée",
                 f"« {f.titre} » du {f.date_debut:%d/%m/%Y} est annulée.", "alerte", "/formations")
    f.active = False
    db.add(JournalAudit(acteur_id=utilisateur.id, action="formation_retiree", cible=f.titre))
    db.commit()


@router.post("/{formation_id}/inscription", summary="S'inscrire")
def inscrire(formation_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    f = db.get(Formation, formation_id)
    if not f or not f.active:
        raise HTTPException(status_code=404, detail="Formation introuvable")
    if f.date_fin < date.today():
        raise HTTPException(status_code=409, detail="Cette session est terminée.")
    if any(i.employe_id == utilisateur.id for i in f.inscriptions):
        return detail(f)
    if len(f.inscriptions) >= f.places:
        raise HTTPException(status_code=409, detail="Session complète : aucune place disponible.")
    f.inscriptions.append(InscriptionFormation(employe_id=utilisateur.id))
    if utilisateur.validateur_id:
        notifier(db, utilisateur.validateur_id, "Inscription à une formation",
                 f"{utilisateur.prenom} {utilisateur.nom} s'est inscrit à « {f.titre} » ({f.date_debut:%d/%m/%Y}).",
                 "info", "/formations")
    db.commit()
    db.refresh(f)
    return detail(f)


@router.delete("/{formation_id}/inscription", summary="Se désinscrire")
def desinscrire(formation_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    f = db.get(Formation, formation_id)
    if not f:
        raise HTTPException(status_code=404, detail="Formation introuvable")
    for inscription in list(f.inscriptions):
        if inscription.employe_id == utilisateur.id:
            f.inscriptions.remove(inscription)
    db.commit()
    db.refresh(f)
    return detail(f)
