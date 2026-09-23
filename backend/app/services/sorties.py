"""Sortie des effectifs : retraite, démission, fin de contrat…

Le profil n'est jamais effacé (l'historique RH, les demandes, les fiches et le
journal restent consultables) : il est désactivé à la date de sortie.
- Date passée ou du jour : désactivation immédiate.
- Date future : sortie programmée, appliquée automatiquement ce jour-là.
À la désactivation :
- le compte ne peut plus se connecter et disparaît de l'annuaire, de
  l'organigramme et des listes ;
- ses demandes en attente sont annulées ;
- ses collaborateurs sont rattachés à son propre supérieur (à défaut, à
  l'administration RH), et les demandes qu'il devait valider leur sont
  transférées.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Demande, Employe, HistoriqueStatut, JournalAudit, Role, StatutDemande, StatutEmploye
from app.models import ROLES_RH  # noqa: E402

MOTIFS = {
    "retraite": "Départ à la retraite",
    "demission": "Démission",
    "fin_contrat": "Fin de contrat",
    "licenciement": "Licenciement",
    "rupture_conventionnelle": "Rupture à l'amiable",
    "mutation": "Mutation / détachement",
    "deces": "Décès",
    "autre": "Autre motif",
}


def successeur(db: Session, employe: Employe) -> Employe | None:
    """Qui reprend l'équipe : le supérieur du partant, sinon un administrateur RH."""
    if employe.validateur and employe.validateur.statut != StatutEmploye.SORTI and employe.validateur_id != employe.id:
        return employe.validateur
    return db.scalar(select(Employe).where(Employe.role.in_(ROLES_RH), Employe.id != employe.id,
                                           Employe.statut != StatutEmploye.SORTI).order_by(Employe.id))


def desactiver(db: Session, employe: Employe, acteur_id: int | None) -> dict:
    reprise = successeur(db, employe)
    equipe = list(db.scalars(select(Employe).where(Employe.validateur_id == employe.id, Employe.id != employe.id)))
    for membre in equipe:
        membre.validateur_id = reprise.id if reprise else None
    a_valider = list(db.scalars(select(Demande).where(Demande.validateur_id == employe.id,
                                                      Demande.statut == StatutDemande.EN_ATTENTE)))
    for demande in a_valider:
        demande.validateur_id = reprise.id if reprise else None
    annulees = list(db.scalars(select(Demande).where(Demande.employe_id == employe.id,
                                                     Demande.statut == StatutDemande.EN_ATTENTE)))
    for demande in annulees:
        demande.statut = StatutDemande.ANNULEE
        db.add(HistoriqueStatut(demande_id=demande.id, statut=StatutDemande.ANNULEE, acteur_id=acteur_id,
                                commentaire=f"Annulée : sortie des effectifs ({MOTIFS.get(employe.motif_sortie, '')})",
                                horodatage=datetime.utcnow()))
    employe.statut = StatutEmploye.SORTI
    return {"equipe_rattachee": len(equipe), "demandes_transferees": len(a_valider), "demandes_annulees": len(annulees),
            "repris_par": f"{reprise.prenom} {reprise.nom}" if reprise else None}


def appliquer_sorties_programmees(db: Session, aujourdhui: date | None = None) -> list[str]:
    aujourdhui = aujourdhui or date.today()
    partants = db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI,
                                                Employe.date_sortie.is_not(None), Employe.date_sortie <= aujourdhui))
    faits = []
    for employe in partants:
        bilan = desactiver(db, employe, None)
        db.add(JournalAudit(action="sortie_effectifs_appliquee", cible=employe.matricule,
                            detail=f"{MOTIFS.get(employe.motif_sortie, employe.motif_sortie)} — {bilan}"))
        faits.append(employe.matricule)
    db.commit()
    return faits
