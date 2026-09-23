"""Paramètres RH : règles de badgeage et de workflow, types de congé actifs,
jours fériés mobiles. Stockés en base (table « parametres ») et gardés en
mémoire pour les calculs courants (retards, jours ouvrés)."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Parametre, TypeDemande, WorkflowValidation
from app.services import calendrier

REGLES_DEFAUT = {
    # Horaire normal : 8h–12h / 13h–17h, du lundi au vendredi.
    "heureArrivee": "08:00", "heureDepart": "17:00", "pauseDebut": "12:00", "pauseFin": "13:00",
    # Juillet et août : séance unique 8h–14h.
    "moisSeanceUnique": [7, 8], "heureArriveeEte": "08:00", "heureDepartEte": "14:00",
    "toleranceRetard": 5, "dureeJournee": 8,
    # Autorisations d'absence : 1h30 au plus par autorisation, 4h par mois ;
    # au-delà du quota mensuel, la dérogation relève de la RH seule.
    "maxAutorisationHeures": 1.5, "quotaAutorisationMois": 4,
    "seuilDoubleValidation": 10, "reportMax": 5,
    # Congés et autorisations sans réponse : validés d'office après ce délai.
    "delaiReponse": 48, "validationAutomatique": True,
    # Congés acquis au début de chaque mois au titre du mois écoulé.
    "acquisitionMensuelle": 2.5,
    # Au 31/12, le solde reporté ne dépasse pas ce plafond, sauf accord de la RH.
    "plafondReport": 15,
    # Relances quotidiennes par e-mail : ce qui attend une action ressort.
    "relancesActives": True, "relanceDemandeHeures": 24, "relanceFicheJours": 7,
}
REGLES: dict = dict(REGLES_DEFAUT)
TYPES_INACTIFS: set[str] = set()


def lire(db: Session, cle: str, defaut=None):
    ligne = db.get(Parametre, cle)
    return json.loads(ligne.valeur) if ligne else defaut


def ecrire(db: Session, cle: str, valeur) -> None:
    ligne = db.get(Parametre, cle)
    if ligne is None:
        db.add(Parametre(cle=cle, valeur=json.dumps(valeur, ensure_ascii=False)))
    else:
        ligne.valeur = json.dumps(valeur, ensure_ascii=False)


def feries_mobiles(db: Session) -> dict[str, str]:
    """{ "2026-03-20": "Aïd el-Fitr", … } ; valeurs d'origine à défaut."""
    defaut = {d.isoformat(): nom for d, nom in calendrier.FERIES_MOBILES_DEFAUT.items()}
    return lire(db, "feries_mobiles", defaut)


def charger(db: Session) -> None:
    """Recharge le cache mémoire depuis la base (démarrage, après écriture)."""
    REGLES.clear()
    REGLES.update(REGLES_DEFAUT)
    REGLES.update(lire(db, "regles", {}))
    TYPES_INACTIFS.clear()
    TYPES_INACTIFS.update(lire(db, "types_conge_inactifs", []))
    calendrier.FERIES_MOBILES.clear()
    calendrier.FERIES_MOBILES.update({date.fromisoformat(d): nom for d, nom in feries_mobiles(db).items()})


def appliquer_seuil(db: Session, seuil: float) -> None:
    """La double validation des congés suit le seuil saisi par la RH."""
    regle = db.scalar(select(WorkflowValidation).where(
        WorkflowValidation.type_demande == TypeDemande.CONGE, WorkflowValidation.seuil_jours.is_not(None)))
    if regle is None:
        db.add(WorkflowValidation(type_demande=TypeDemande.CONGE, niveaux=2, seuil_jours=seuil))
    else:
        regle.seuil_jours = seuil
