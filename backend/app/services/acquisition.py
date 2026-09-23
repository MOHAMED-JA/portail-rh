"""Acquisition mensuelle des congés : au début de chaque mois, chaque
collaborateur actif reçoit 2,5 jours (Paramètres RH) au titre du mois écoulé.

Le dernier mois crédité est mémorisé (paramètre « acquisition_dernier_mois ») :
le traitement est idempotent et rattrape les mois manqués si le serveur est
resté arrêté. Au premier démarrage, les soldes existants sont considérés à
jour jusqu'au mois précédent (aucun crédit rétroactif).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employe, JournalAudit, StatutEmploye
from app.services import parametres
from app.services.demandes import solde_courant
from app.services.notifications import notifier

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
        "novembre", "décembre"]


def fr(nombre: float) -> str:
    return f"{nombre:g}".replace(".", ",")


def _precedent(annee: int, mois: int) -> tuple[int, int]:
    return (annee - 1, 12) if mois == 1 else (annee, mois - 1)


def _suivant(annee: int, mois: int) -> tuple[int, int]:
    return (annee + 1, 1) if mois == 12 else (annee, mois + 1)


def crediter(db: Session, aujourdhui: date | None = None) -> list[str]:
    """Crédite les mois écoulés non encore crédités ; renvoie leurs libellés."""
    aujourdhui = aujourdhui or date.today()
    dernier_mois_ecoule = _precedent(aujourdhui.year, aujourdhui.month)
    marque = parametres.lire(db, "acquisition_dernier_mois")
    if not marque:
        parametres.ecrire(db, "acquisition_dernier_mois", f"{dernier_mois_ecoule[0]}-{dernier_mois_ecoule[1]:02d}")
        db.commit()
        return []
    annee, mois = (int(x) for x in marque.split("-"))
    jours = float(parametres.REGLES.get("acquisitionMensuelle", 2.5))
    credites: list[str] = []
    while (annee, mois) < dernier_mois_ecoule:
        annee, mois = _suivant(annee, mois)
        libelle = f"{MOIS[mois - 1]} {annee}"
        employes = db.scalars(select(Employe).where(Employe.statut == StatutEmploye.ACTIF)).all()
        for employe in employes:
            solde = solde_courant(db, employe.id, aujourdhui.year)
            solde.jours_acquis = round(solde.jours_acquis + jours, 2)
            notifier(db, employe.id, "Solde de congés crédité",
                     f"+{fr(jours)} jours au titre de {libelle}. Solde disponible : {fr(solde.jours_restants)} jour(s).",
                     "succes", "/mes-demandes")
        db.add(JournalAudit(action="acquisition_conges", cible=libelle,
                            detail=f"+{jours:g} j pour {len(employes)} collaborateur(s)"))
        parametres.ecrire(db, "acquisition_dernier_mois", f"{annee}-{mois:02d}")
        db.commit()
        credites.append(libelle)
    return credites
