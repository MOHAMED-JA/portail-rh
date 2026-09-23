"""Validation automatique : une demande de congé ou d'autorisation restée
sans réponse pendant le délai réglementaire (48 heures par défaut,
Paramètres RH → « Validation automatique après ») est validée d'office.

- Le délai court depuis le dépôt, ou depuis l'arrivée au niveau suivant en
  cas de double validation : chaque niveau dispose de son propre délai.
- Un congé annuel qui dépasserait le solde restant n'est pas validé d'office :
  la direction RH est prévenue.
- Le demandeur et le valideur sont notifiés (plateforme et e-mail).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Demande, HistoriqueStatut, StatutDemande, TypeDemande
from app.services import demandes as svc
from app.services import parametres
from app.services.notifications import notifier

TYPES_CONCERNES = (TypeDemande.CONGE, TypeDemande.AUTORISATION)


def delai_heures() -> float:
    return float(parametres.REGLES.get("delaiReponse", 48))


def attente_depuis(db: Session, demande: Demande) -> datetime:
    """Début de l'attente au niveau courant : dernière entrée « en attente »."""
    derniere = db.scalar(select(HistoriqueStatut.horodatage).where(
        HistoriqueStatut.demande_id == demande.id, HistoriqueStatut.statut == StatutDemande.EN_ATTENTE,
    ).order_by(HistoriqueStatut.horodatage.desc()).limit(1))
    return derniere or demande.cree_le


def echeance(db: Session, demande: Demande) -> datetime:
    return attente_depuis(db, demande) + timedelta(hours=delai_heures())


def valider_echues(db: Session, maintenant: datetime | None = None) -> list[str]:
    """Valide les demandes échues ; renvoie leurs références."""
    if not parametres.REGLES.get("validationAutomatique", True):
        return []
    maintenant = maintenant or datetime.utcnow()
    validees: list[str] = []
    en_attente = db.scalars(select(Demande).where(
        Demande.statut == StatutDemande.EN_ATTENTE, Demande.type_demande.in_(TYPES_CONCERNES))).all()
    for demande in en_attente:
        if echeance(db, demande) > maintenant:
            continue
        if svc.decompte_solde(demande.type_demande, demande.sous_type):
            solde = svc.solde_courant(db, demande.employe_id, demande.date_debut.year)
            if demande.nombre_jours > solde.jours_restants:
                deja = db.scalar(select(HistoriqueStatut.id).where(
                    HistoriqueStatut.demande_id == demande.id,
                    HistoriqueStatut.commentaire.like("Validation automatique impossible%")))
                if not deja:
                    svc.journaliser(db, demande, StatutDemande.EN_ATTENTE, None,
                                    "Validation automatique impossible : solde insuffisant")
                    for admin in svc.administrateurs_rh(db, sauf=demande.employe_id):
                        notifier(db, admin.id, "Validation automatique impossible",
                                 f"{demande.reference} ({demande.employe.prenom} {demande.employe.nom}) : "
                                 f"solde insuffisant, décision RH requise.", "alerte", "/validation")
                    db.commit()
                continue
        valideur = demande.validateur or (svc.administrateurs_rh(db, sauf=demande.employe_id) or [None])[0]
        if valideur is None:
            continue
        heures = f"{delai_heures():g} h"
        if demande.validateur_id and demande.validateur_id != demande.employe_id:
            notifier(db, demande.validateur_id, "Demande validée automatiquement",
                     f"{demande.reference} ({demande.employe.prenom} {demande.employe.nom}) : sans réponse depuis {heures}.",
                     "info", "/validation")
        svc.appliquer_decision(db, demande, valideur, True,
                               f"Validation automatique : sans réponse depuis {heures}", automatique=True)
        validees.append(demande.reference)
    return validees
