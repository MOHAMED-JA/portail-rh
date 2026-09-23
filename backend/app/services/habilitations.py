"""Formations et habilitations obligatoires : qui doit quoi, jusqu'à quand.

Le référentiel (tenu par la RH) dit quelle habilitation est exigée, de qui
(tout le personnel, certaines structures ou certains niveaux) et tous les
combien de mois elle se renouvelle. Chaque obtention est conservée : la plus
récente fait foi.

Statuts d'un collaborateur pour une habilitation exigée :
- ``conforme`` : obtenue et valide au-delà de 60 jours ;
- ``a_renouveler`` : expire dans les 60 jours ;
- ``expiree`` : date d'expiration dépassée ;
- ``manquante`` : jamais obtenue.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Departement, Employe, Habilitation, HabilitationCollaborateur, StatutEmploye
from app.services import hierarchie
from app.services.notifications import notifier

CATEGORIES = {
    "formation_reglementaire": "Formation réglementaire",
    "agrement": "Agrément",
    "certification": "Certification",
    "autre": "Autre exigence",
}
POPULATIONS = {"tous": "Tout le personnel", "departements": "Structures désignées", "niveaux": "Niveaux désignés"}
STATUTS = {"conforme": "Conforme", "a_renouveler": "À renouveler", "expiree": "Expirée", "manquante": "Manquante"}
SEUIL_RENOUVELLEMENT = 60
SEUILS_RELANCE = (60, 30, 0)


def ajouter_mois(jour: date, mois: int) -> date:
    annee, rang = divmod(jour.month - 1 + mois, 12)
    annee += jour.year
    for d in (jour.day, 30, 29, 28):
        try:
            return date(annee, rang + 1, d)
        except ValueError:
            continue
    return date(annee, rang + 1, 28)


def cibles(h: Habilitation) -> list:
    try:
        return json.loads(h.cibles or "[]")
    except ValueError:
        return []


def _descendants(db: Session) -> dict[int, set[int]]:
    """Structure → elle-même et toutes ses sous-structures."""
    enfants: dict[int, list[int]] = {}
    for identifiant, parent in db.execute(select(Departement.id, Departement.parent_id)).all():
        if parent is not None:
            enfants.setdefault(parent, []).append(identifiant)
    resultat: dict[int, set[int]] = {}
    for identifiant, _ in db.execute(select(Departement.id, Departement.parent_id)).all():
        vus, a_traiter = {identifiant}, list(enfants.get(identifiant, []))
        while a_traiter:
            courant = a_traiter.pop()
            if courant not in vus:
                vus.add(courant)
                a_traiter.extend(enfants.get(courant, []))
        resultat[identifiant] = vus
    return resultat


def concerne(h: Habilitation, e: Employe, arbre: dict[int, set[int]]) -> bool:
    if h.population == "tous":
        return True
    if h.population == "niveaux":
        return (e.niveau or "collaborateur") in cibles(h)
    if h.population == "departements":
        return any(e.departement_id in arbre.get(int(c), {int(c)}) for c in cibles(h))
    return False


def statut(ligne: HabilitationCollaborateur | None, aujourdhui: date | None = None) -> str:
    aujourdhui = aujourdhui or date.today()
    if ligne is None:
        return "manquante"
    if ligne.expire_le is None:
        return "conforme"
    if ligne.expire_le < aujourdhui:
        return "expiree"
    if ligne.expire_le <= aujourdhui + timedelta(days=SEUIL_RENOUVELLEMENT):
        return "a_renouveler"
    return "conforme"


def dernieres(db: Session) -> dict[tuple[int, int], HabilitationCollaborateur]:
    """Obtention la plus récente par (habilitation, collaborateur)."""
    resultat: dict[tuple[int, int], HabilitationCollaborateur] = {}
    for ligne in db.scalars(select(HabilitationCollaborateur).order_by(
            HabilitationCollaborateur.obtenue_le, HabilitationCollaborateur.id)):
        resultat[(ligne.habilitation_id, ligne.employe_id)] = ligne
    return resultat


def situation(db: Session, employes: list[Employe] | None = None, aujourdhui: date | None = None) -> list[dict]:
    """Une ligne par couple (collaborateur, habilitation exigée)."""
    if employes is None:
        employes = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)))
    exigences = list(db.scalars(select(Habilitation).where(Habilitation.actif.is_(True)).order_by(Habilitation.intitule)))
    if not exigences:
        return []
    arbre, obtenues = _descendants(db), dernieres(db)
    lignes = []
    for e in employes:
        for h in exigences:
            if not concerne(h, e, arbre):
                continue
            ligne = obtenues.get((h.id, e.id))
            lignes.append({"employe": e, "habilitation": h, "obtention": ligne, "statut": statut(ligne, aujourdhui)})
    return lignes


def expiration(h: Habilitation, obtenue_le: date, expire_le: date | None) -> date | None:
    if expire_le:
        return expire_le
    return ajouter_mois(obtenue_le, h.periodicite_mois) if h.periodicite_mois else None


def relancer(db: Session, aujourdhui: date | None = None) -> dict:
    """Préviens le collaborateur et son N+1 à 60 j, 30 j et à l'expiration ;
    chaque seuil n'est signalé qu'une fois par obtention."""
    aujourdhui = aujourdhui or date.today()
    envoyees = 0
    for l in situation(db, aujourdhui=aujourdhui):
        ligne, e, h = l["obtention"], l["employe"], l["habilitation"]
        if ligne is None or ligne.expire_le is None or l["statut"] not in ("a_renouveler", "expiree"):
            continue
        jours = (ligne.expire_le - aujourdhui).days
        seuil = min(s for s in SEUILS_RELANCE if jours <= s) if jours <= SEUILS_RELANCE[0] else None
        if seuil is None or (ligne.relance_seuil is not None and ligne.relance_seuil <= seuil):
            continue
        ligne.relance_seuil = seuil
        if jours < 0:
            titre, message = "Habilitation expirée", f"« {h.intitule} » a expiré le {ligne.expire_le:%d/%m/%Y}."
        else:
            titre, message = "Habilitation à renouveler", f"« {h.intitule} » expire le {ligne.expire_le:%d/%m/%Y} (dans {jours} j)."
        notifier(db, e.id, titre, message + " Rapprochez-vous de la RH pour la session de renouvellement.",
                 "alerte", "/habilitations")
        chef = hierarchie.superieur_operationnel(e)
        if chef:
            notifier(db, chef.id, titre + " dans votre équipe", f"{e.prenom} {e.nom} : {message}", "alerte", "/habilitations")
        envoyees += 1
    return {"relances": envoyees}
