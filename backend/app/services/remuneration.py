"""Rémunération : lecture des montants chiffrés, coûts et réglages.

Les montants sont saisis par la RH (brut mensuel, primes fixes, net) et
chiffrés en base. Aucune valeur n'est jamais supposée : un collaborateur sans
rémunération saisie est « non valorisé » dans les indicateurs.

Réglages (clé ``reglages_remuneration`` des paramètres) :
- ``taux_charges`` : charges patronales en % du brut (à confirmer par la RH) ;
- ``jours_par_mois`` : jours de travail rémunérés par mois (coût d'une journée).
"""
from __future__ import annotations

import math

from sqlalchemy.orm import Session

from app.models import FicheEvaluation, Remuneration, RevueTalent
from app.services import parametres

REGLAGES_DEFAUT = {"taux_charges": 16.57, "jours_par_mois": 22}
SEUILS_PERFORMANCE = (10, 14)   # note /20 : < 10 faible, < 14 conforme, ≥ 14 élevée


def reglages(db: Session) -> dict:
    return {**REGLAGES_DEFAUT, **(parametres.lire(db, "reglages_remuneration", {}) or {})}


def _nombre(valeur: str | None) -> float | None:
    if valeur in (None, ""):
        return None
    try:
        nombre = float(str(valeur).replace(",", ".").replace(" ", ""))
    except ValueError:
        return None
    # « nan » ou « inf » éventuellement enregistrés : traités comme non saisis.
    return nombre if math.isfinite(nombre) else None


MONTANT_MAXIMUM = 1_000_000


def controler(salaire_base: float | None, primes_fixes: float | None, salaire_net: float | None,
              mois_payes: float | None, rib: str | None) -> list[str]:
    """Règles communes à la saisie individuelle et à l'import Excel : montants
    finis, positifs (primes : zéro permis), 1 000 000 DT au plus ; 12 à 16
    mois payés ; RIB de 20 chiffres. Renvoie les problèmes, vide si tout va."""
    problemes = []
    for valeur, libelle, zero_permis in ((salaire_base, "salaire de base", False),
                                         (primes_fixes, "primes fixes", True),
                                         (salaire_net, "salaire net", False)):
        if valeur is None:
            continue
        if not math.isfinite(valeur) or valeur < 0 or (valeur == 0 and not zero_permis) or valeur > MONTANT_MAXIMUM:
            borne = "0" if zero_permis else "plus de 0"
            problemes.append(f"{libelle} hors limites ({borne} à 1 000 000 DT)")
    if mois_payes is not None and not (math.isfinite(mois_payes) and 12 <= mois_payes <= 16):
        problemes.append("mois payés par an : entre 12 et 16")
    if rib and len(rib) != 20:
        problemes.append("le RIB doit comporter 20 chiffres")
    return problemes


def lire(db: Session, employe_id: int) -> dict | None:
    r = db.get(Remuneration, employe_id)
    if r is None or _nombre(r.salaire_base) is None:
        return None
    return {"salaire_base": _nombre(r.salaire_base), "primes_fixes": _nombre(r.primes_fixes) or 0.0,
            "salaire_net": _nombre(r.salaire_net), "mois_payes": r.mois_payes or 12,
            "banque": r.banque, "rib": r.rib, "modifie_le": r.modifie_le}


def mensuel_brut(r: dict) -> float:
    return r["salaire_base"] + r["primes_fixes"]


def annuel_brut(r: dict) -> float:
    return mensuel_brut(r) * r["mois_payes"]


def cout_employeur(r: dict, taux_charges: float) -> float:
    return annuel_brut(r) * (1 + taux_charges / 100)


def cout_journalier(r: dict, regles: dict) -> float:
    return mensuel_brut(r) * (1 + regles["taux_charges"] / 100) / max(1, regles["jours_par_mois"])


def note_de_performance(db: Session, employe_id: int, annee: int) -> float | None:
    """Note finale de l'évaluation finalisée de l'année, sinon de la précédente."""
    for a in (annee, annee - 1):
        ev = db.query(FicheEvaluation).filter_by(employe_id=employe_id, annee=a).first()
        if ev and ev.finalisee_le and ev.note_finale is not None:
            return ev.note_finale
    return None


def niveau_de_note(note: float | None) -> int | None:
    if note is None:
        return None
    return 1 if note < SEUILS_PERFORMANCE[0] else 2 if note < SEUILS_PERFORMANCE[1] else 3


def niveau_performance(db: Session, employe_id: int, annee: int) -> int | None:
    """Performance calibrée en revue des talents, sinon déduite de la note."""
    revue = db.query(RevueTalent).filter_by(employe_id=employe_id, annee=annee).first()
    if revue and revue.performance:
        return revue.performance
    return niveau_de_note(note_de_performance(db, employe_id, annee))
