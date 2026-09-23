"""Ligne hiérarchique de Veltaris et périmètre de consultation.

Qui voit qui :
- l'administration RH voit tout, y compris les informations confidentielles ;
- le Directeur Général et le Directeur Général Adjoint voient toutes les
  informations non confidentielles de tout le personnel, ainsi que les
  évaluations finalisées et leurs notes (consultation seule, jamais d'action) ;
- tout supérieur hiérarchique voit les informations non confidentielles de
  toute sa ligne (collaborateurs directs et indirects) ;
- chacun voit ses propres informations.

Sont confidentiels (RH et intéressé uniquement) : paie, dossier personnel
(naissance, santé, personne à prévenir), demandes de documents. Le détail et
les notes des évaluations finalisées : RH, Direction générale et intéressé.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Departement, Employe, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402

# Du plus bas au plus haut.
NIVEAUX = [
    ("collaborateur", "Collaborateur"),
    ("middle_manager", "Middle Manager"),
    ("manager", "Manager"),
    ("top_manager", "Top Manager"),
    ("directeur_pole", "Directeur Pôle"),
    ("dga", "Directeur Général Adjoint"),
    ("dg", "Directeur Général"),
]
LIBELLES_NIVEAUX = dict(NIVEAUX)
DIRECTION_GENERALE = {"dg", "dga"}

# Grades, du plus bas au plus haut.
GRADES = [
    "Chef section", "Sous chef service", "Chef service adjoint", "Chef service", "Chef service principal",
    "Chef division", "Sous directeur", "Directeur adjoint", "Directeur", "Directeur central",
]


def verifier_niveau(niveau: str | None) -> None:
    if niveau is not None and niveau not in LIBELLES_NIVEAUX:
        raise HTTPException(status_code=422, detail="Niveau hiérarchique inconnu.")


def verifier_rattachement(db: Session, identifiant: int | None, parent_id: int | None,
                         structure: bool = False) -> None:
    """Refuse les références absentes et les cycles, quelle que soit leur profondeur."""
    modele = Departement if structure else Employe
    vus = {identifiant} if identifiant is not None else set()
    while parent_id is not None:
        if parent_id in vus:
            raise HTTPException(status_code=422, detail="Ce rattachement crée une boucle hiérarchique.")
        vus.add(parent_id)
        parent = db.get(modele, parent_id)
        if parent is None:
            raise HTTPException(status_code=422, detail="Structure parente ou supérieur introuvable.")
        if not structure and parent.statut == StatutEmploye.SORTI:
            raise HTTPException(status_code=422, detail="Un collaborateur sorti ne peut pas être supérieur.")
        parent_id = parent.parent_id if structure else parent.validateur_id


def verifier_departement(db: Session, departement_id: int | None) -> None:
    if departement_id is not None and db.get(Departement, departement_id) is None:
        raise HTTPException(status_code=422, detail="Département introuvable.")


def est_direction_generale(employe: Employe) -> bool:
    return (employe.niveau or "collaborateur") in DIRECTION_GENERALE


def sans_fiche_objectifs(employe: Employe) -> bool:
    """Le Directeur général n'a pas de supérieur hiérarchique : ni fiche
    d'objectifs, ni fiche d'évaluation."""
    return (employe.niveau or "collaborateur") == "dg"


def voit_tout(employe: Employe) -> bool:
    """Administration RH ou Direction générale : tout le personnel."""
    return employe.role in ROLES_RH or est_direction_generale(employe)


def equipe_ids(db: Session, chef_id: int) -> set[int]:
    """Collaborateurs directs et indirects (toute la ligne hiérarchique)."""
    liens = db.execute(select(Employe.id, Employe.validateur_id).where(Employe.statut != StatutEmploye.SORTI)).all()
    enfants: dict[int, list[int]] = {}
    for identifiant, chef in liens:
        if chef is not None and chef != identifiant:
            enfants.setdefault(chef, []).append(identifiant)
    vus: set[int] = set()
    a_traiter = list(enfants.get(chef_id, []))
    while a_traiter:
        courant = a_traiter.pop()
        if courant in vus or courant == chef_id:
            continue  # garde-fou contre une boucle de rattachement
        vus.add(courant)
        a_traiter.extend(enfants.get(courant, []))
    return vus


def perimetre_ids(db: Session, utilisateur: Employe) -> set[int]:
    """Personnes dont l'utilisateur peut consulter les informations non
    confidentielles (lui-même exclu)."""
    if voit_tout(utilisateur):
        ids = set(db.scalars(select(Employe.id).where(Employe.statut != StatutEmploye.SORTI)))
        ids.discard(utilisateur.id)
        return ids
    return equipe_ids(db, utilisateur.id)


def peut_consulter(db: Session, utilisateur: Employe, employe: Employe) -> bool:
    if utilisateur.id == employe.id or voit_tout(utilisateur):
        return True
    return employe.id in equipe_ids(db, utilisateur.id)


# --------------------------------------------------------------------------
# Rôle de la Direction générale dans les circuits de validation
# --------------------------------------------------------------------------
# Le DG et le DGA ne sont jamais validateurs de premier niveau : le supérieur
# hiérarchique décide. Le DGA est informé des demandes de sa ligne et peut les
# valider tant que le supérieur ne l'a pas fait ; le DG consulte seulement.
# Fiches d'objectifs et d'évaluation : consultation seule pour tous deux.
def superieur_operationnel(employe: Employe) -> Employe | None:
    """N+1 qui décide (hors Direction générale) ; None si le collaborateur ne
    relève que de la Direction générale (l'administration RH décide alors)."""
    chef = employe.validateur
    if chef is None or chef.id == employe.id or est_direction_generale(chef):
        return None
    return chef


def supervise_les_demandes(utilisateur: Employe) -> bool:
    return (utilisateur.niveau or "") == "dga"


def dga_de(employe: Employe) -> Employe | None:
    """Directeur Général Adjoint de la ligne du collaborateur."""
    courant, garde = employe.validateur, 0
    while courant is not None and garde < 20:
        if (courant.niveau or "") == "dga" and courant.id != employe.id:
            return courant
        courant, garde = courant.validateur, garde + 1
    return None
