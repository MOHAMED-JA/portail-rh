"""Délégation de validation : qui décide quand le supérieur est absent.

Le suppléant décide **au nom du titulaire**, pendant la seule période déclarée.
Il n'hérite d'aucun autre droit : ni les données confidentielles du titulaire,
ni la faculté de déléguer à son tour. Chaque décision prise à ce titre reste
tracée au nom de la personne qui a cliqué.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DelegationValidation, Employe, StatutEmploye

DUREE_MAX_JOURS = 180


def _aujourdhui(jour: date | None) -> date:
    return jour or date.today()


def delegations_actives(db: Session, jour: date | None = None) -> list[DelegationValidation]:
    j = _aujourdhui(jour)
    return list(db.scalars(select(DelegationValidation).where(
        DelegationValidation.annulee_le.is_(None),
        DelegationValidation.debut <= j,
        DelegationValidation.fin >= j)))


def suppleant_de(db: Session, titulaire_id: int, jour: date | None = None) -> Employe | None:
    """Remplaçant en fonction aujourd'hui pour ce valideur, s'il y en a un."""
    j = _aujourdhui(jour)
    delegation = db.scalar(select(DelegationValidation).where(
        DelegationValidation.titulaire_id == titulaire_id,
        DelegationValidation.annulee_le.is_(None),
        DelegationValidation.debut <= j,
        DelegationValidation.fin >= j).order_by(DelegationValidation.debut.desc()))
    if delegation is None:
        return None
    suppleant = db.get(Employe, delegation.suppleant_id)
    return suppleant if suppleant and suppleant.statut != StatutEmploye.SORTI else None


def titulaires_de(db: Session, suppleant_id: int, jour: date | None = None) -> list[int]:
    """Valideurs que cette personne remplace aujourd'hui."""
    j = _aujourdhui(jour)
    return list(db.scalars(select(DelegationValidation.titulaire_id).where(
        DelegationValidation.suppleant_id == suppleant_id,
        DelegationValidation.annulee_le.is_(None),
        DelegationValidation.debut <= j,
        DelegationValidation.fin >= j)))


def remplace(db: Session, suppleant_id: int, titulaire_id: int, jour: date | None = None) -> bool:
    return titulaire_id in titulaires_de(db, suppleant_id, jour)


def verifier(db: Session, titulaire: Employe, suppleant_id: int, debut: date, fin: date,
             sauf_id: int | None = None) -> Employe:
    """Refuse d'emblée ce qui rendrait la délégation inopérante ou dangereuse."""
    if fin < debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début.")
    if (fin - debut).days > DUREE_MAX_JOURS:
        raise HTTPException(status_code=422, detail=(
            f"Une délégation ne peut pas dépasser {DUREE_MAX_JOURS} jours : au-delà, "
            "c'est le rattachement hiérarchique qu'il faut revoir."))
    if fin < date.today():
        raise HTTPException(status_code=422, detail="Cette période est déjà passée.")

    suppleant = db.get(Employe, suppleant_id)
    if suppleant is None or suppleant.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=422, detail="Remplaçant inconnu ou sorti des effectifs.")
    if suppleant.id == titulaire.id:
        raise HTTPException(status_code=422, detail="On ne se remplace pas soi-même.")

    # Le remplaçant d'un remplaçant : la chaîne deviendrait illisible.
    if titulaires_de(db, titulaire.id) or delegation_future(db, suppleant.id):
        raise HTTPException(status_code=409, detail=(
            "Un remplaçant ne peut pas déléguer à son tour : demandez à la RH."))

    chevauchement = db.scalar(select(DelegationValidation).where(
        DelegationValidation.titulaire_id == titulaire.id,
        DelegationValidation.annulee_le.is_(None),
        DelegationValidation.debut <= fin,
        DelegationValidation.fin >= debut,
        DelegationValidation.id != (sauf_id or -1)))
    if chevauchement is not None:
        raise HTTPException(status_code=409, detail=(
            f"Une délégation couvre déjà du {chevauchement.debut:%d/%m/%Y} au "
            f"{chevauchement.fin:%d/%m/%Y}. Annulez-la d'abord."))
    return suppleant


def delegation_future(db: Session, titulaire_id: int) -> DelegationValidation | None:
    """Délégation en cours ou à venir dont cette personne est le titulaire."""
    return db.scalar(select(DelegationValidation).where(
        DelegationValidation.titulaire_id == titulaire_id,
        DelegationValidation.annulee_le.is_(None),
        DelegationValidation.fin >= date.today()))


def resume(delegation: DelegationValidation) -> dict:
    j = date.today()
    return {
        "id": delegation.id,
        "titulaire": {"id": delegation.titulaire.id, "matricule": delegation.titulaire.matricule,
                      "nom": delegation.titulaire.nom_complet},
        "suppleant": {"id": delegation.suppleant.id, "matricule": delegation.suppleant.matricule,
                      "nom": delegation.suppleant.nom_complet},
        "debut": delegation.debut,
        "fin": delegation.fin,
        "motif": delegation.motif,
        "en_cours": delegation.annulee_le is None and delegation.debut <= j <= delegation.fin,
        "annulee": delegation.annulee_le is not None,
        "cree_par": delegation.cree_par.nom_complet if delegation.cree_par else None,
    }
