"""Indicateurs clés pour la Direction générale, calculés sur les données du
portail : étendue de l'encadrement, délais de décision des responsables et
valeur des congés non pris.

RH et Direction générale. Le détail nominatif des soldes de congés (coûts
individuels) reste réservé à la RH ; les délais de décision par responsable
sont un indicateur de fonctionnement des circuits, visible des deux."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import ROLES_RH, Demande, Employe, HistoriqueStatut, SoldeConge, StatutDemande, StatutEmploye
from app.services import hierarchie, remuneration
from app.services.sirh import situation_report

router = APIRouter(prefix="/api/indicateurs", tags=["Indicateurs clés"])

ETENDUE_LARGE = 10      # au-delà : encadrement difficile à assurer au quotidien
DELAI_CIBLE_HEURES = 48


def _mini(e: Employe) -> dict:
    return {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
            "niveau": hierarchie.LIBELLES_NIVEAUX.get(e.niveau or "collaborateur", e.niveau),
            "direction": e.departement.nom if e.departement else "Non affecté"}


def _exiger(utilisateur: Employe) -> None:
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")


# ------------------------------------------------------------------ Organisation
def organisation(db: Session) -> dict:
    actifs = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)))
    par_id = {e.id: e for e in actifs}
    directs: dict[int, list[int]] = {}
    for e in actifs:
        if e.validateur_id and e.validateur_id != e.id and e.validateur_id in par_id:
            directs.setdefault(e.validateur_id, []).append(e.id)

    def profondeur(e: Employe) -> int:
        n, courant, vus = 1, e, {e.id}
        while courant.validateur_id and courant.validateur_id in par_id and courant.validateur_id not in vus:
            vus.add(courant.validateur_id)
            courant = par_id[courant.validateur_id]
            n += 1
        return n

    responsables = []
    for chef_id, equipe in directs.items():
        chef = par_id[chef_id]
        alerte = "etendue_large" if len(equipe) > ETENDUE_LARGE else "une_personne" if len(equipe) == 1 else None
        responsables.append({"responsable": _mini(chef), "directs": len(equipe),
                             "ligne": len(hierarchie.equipe_ids(db, chef_id)), "alerte": alerte})
    tailles = [r["directs"] for r in responsables]
    return {
        "effectif": len(actifs), "responsables": len(responsables),
        "taux_encadrement": round(100 * len(responsables) / len(actifs), 1) if actifs else None,
        "moyenne_encadres": round(sum(tailles) / len(tailles), 1) if tailles else None,
        "mediane_encadres": median(tailles) if tailles else None,
        "maximum_encadres": max(tailles) if tailles else None,
        "etendue_large": sum(1 for t in tailles if t > ETENDUE_LARGE),
        "une_personne": sum(1 for t in tailles if t == 1),
        "niveaux_hierarchiques": max((profondeur(e) for e in actifs), default=0),
        "sans_superieur": sum(1 for e in actifs if not e.validateur_id and (e.niveau or "") != "dg"),
        "seuil_etendue": ETENDUE_LARGE,
        "detail": sorted(responsables, key=lambda r: (-r["directs"], r["responsable"]["nom"])),
    }


# ------------------------------------------------------------------ Délais de décision
def decisions(db: Session, jours: int = 365) -> dict:
    depuis = datetime.utcnow() - timedelta(days=jours)
    lignes = db.execute(
        select(HistoriqueStatut, Demande.cree_le)
        .join(Demande, Demande.id == HistoriqueStatut.demande_id)
        .where(HistoriqueStatut.statut.in_((StatutDemande.APPROUVEE, StatutDemande.REJETEE)),
               HistoriqueStatut.horodatage >= depuis, HistoriqueStatut.acteur_id.isnot(None))).all()
    par_valideur: dict[int, dict] = {}
    tous, automatiques = [], 0
    for h, depose_le in lignes:
        auto = (h.commentaire or "").startswith("Validation automatique")
        heures = max(0.0, (h.horodatage - depose_le).total_seconds() / 3600)
        tous.append(heures)
        automatiques += auto
        v = par_valideur.setdefault(h.acteur_id, {"heures": [], "automatiques": 0, "refus": 0})
        v["heures"].append(heures)
        v["automatiques"] += auto
        v["refus"] += h.statut == StatutDemande.REJETEE
    detail = []
    for acteur_id, v in par_valideur.items():
        acteur = db.get(Employe, acteur_id)
        if acteur is None:
            continue
        n = len(v["heures"])
        detail.append({"valideur": _mini(acteur), "decisions": n,
                       "delai_moyen_heures": round(sum(v["heures"]) / n, 1),
                       "delai_median_heures": round(median(v["heures"]), 1),
                       "hors_delai": sum(1 for x in v["heures"] if x > DELAI_CIBLE_HEURES),
                       "automatiques": v["automatiques"], "refus": v["refus"],
                       "taux_automatique": round(100 * v["automatiques"] / n)})
    en_attente = list(db.scalars(select(Demande).where(Demande.statut == StatutDemande.EN_ATTENTE)))
    maintenant = datetime.utcnow()
    return {
        "periode_jours": jours, "decisions": len(tous), "delai_cible_heures": DELAI_CIBLE_HEURES,
        "delai_moyen_heures": round(sum(tous) / len(tous), 1) if tous else None,
        "delai_median_heures": round(median(tous), 1) if tous else None,
        "taux_automatique": round(100 * automatiques / len(tous)) if tous else None,
        "en_attente": len(en_attente),
        "en_attente_hors_delai": sum(1 for d in en_attente if (maintenant - d.cree_le).total_seconds() > DELAI_CIBLE_HEURES * 3600),
        "detail": sorted(detail, key=lambda d: (-d["delai_moyen_heures"], d["valideur"]["nom"])),
    }


# ------------------------------------------------------------------ Congés non pris
def conges_non_pris(db: Session, rh: bool) -> dict:
    annee = date.today().year
    regles = remuneration.reglages(db)
    perdus = {l["employe"]["id"]: l["perdu_prevu"] for l in situation_report(db, annee)}
    par_direction: dict[str, dict] = {}
    lignes = []
    for solde in db.scalars(select(SoldeConge).join(Employe, Employe.id == SoldeConge.employe_id).where(
            SoldeConge.annee == annee, Employe.statut != StatutEmploye.SORTI)):
        e, jours = solde.employe, max(0.0, solde.jours_restants)
        r = remuneration.lire(db, e.id)
        valeur = round(jours * remuneration.cout_journalier(r, regles), 3) if r else None
        direction = e.departement.nom if e.departement else "Non affecté"
        a = par_direction.setdefault(direction, {"direction": direction, "effectif": 0, "jours": 0.0, "valeur": 0.0,
                                                 "non_valorises": 0, "jours_perdus_prevus": 0.0})
        a["effectif"] += 1
        a["jours"] += jours
        a["jours_perdus_prevus"] += perdus.get(e.id, 0)
        if valeur is None:
            a["non_valorises"] += 1
        else:
            a["valeur"] += valeur
        if rh:
            lignes.append({"employe": _mini(e), "jours": jours, "valeur": valeur, "perdu_prevu": perdus.get(e.id, 0)})
    for a in par_direction.values():
        a["jours"], a["valeur"] = round(a["jours"], 1), round(a["valeur"], 3)
        a["jours_perdus_prevus"] = round(a["jours_perdus_prevus"], 1)
    directions = sorted(par_direction.values(), key=lambda a: -a["jours"])
    return {
        "annee": annee, "reglages": regles,
        "jours": round(sum(a["jours"] for a in directions), 1),
        "valeur": round(sum(a["valeur"] for a in directions), 3),
        "non_valorises": sum(a["non_valorises"] for a in directions),
        "jours_perdus_prevus": round(sum(a["jours_perdus_prevus"] for a in directions), 1),
        "par_direction": directions,
        "collaborateurs": sorted(lignes, key=lambda l: -l["jours"])[:30] if rh else None,
    }


@router.get("", summary="Indicateurs clés : encadrement, délais de décision, congés non pris (RH et DG)")
def indicateurs(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    _exiger(utilisateur)
    return {"organisation": organisation(db), "decisions": decisions(db),
            "conges": conges_non_pris(db, utilisateur.role in ROLES_RH)}
