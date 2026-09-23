"""Entretiens de sortie et analyse des départs.

Chaque départ peut donner lieu à un entretien structuré, avec des motifs
codifiés : l'analyse dit alors *pourquoi* on part, pas seulement combien.
Saisie et détail nominatif : RH. Agrégats (taux de départ, motifs) : RH et
Direction générale. Les appréciations libres sont chiffrées en base."""
from __future__ import annotations

import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import ROLES_RH, Employe, EntretienSortie, JournalAudit, StatutEmploye
from app.services import hierarchie
from app.services.sorties import MOTIFS as MOTIFS_SORTIE

router = APIRouter(prefix="/api/departs", tags=["Départs et entretiens de sortie"])

MOTIFS_DEPART = {
    "remuneration": "Rémunération et avantages",
    "evolution": "Manque de perspectives d'évolution",
    "management": "Relation avec le management",
    "charge": "Charge de travail",
    "conditions": "Conditions et organisation du travail",
    "reconnaissance": "Manque de reconnaissance",
    "formation": "Manque de formation",
    "ambiance": "Ambiance et relations de travail",
    "projet_personnel": "Projet personnel ou reconversion",
    "familial": "Raisons familiales ou géographiques",
    "sante": "Santé",
    "retraite": "Retraite",
    "fin_contrat": "Fin de contrat",
    "decision_employeur": "Décision de l'employeur",
    "autre": "Autre",
}
VOLONTAIRES = {"demission", "rupture_conventionnelle"}


class EntretienPayload(BaseModel):
    date_entretien: date
    motif_principal: str
    motifs_secondaires: list[str] = Field(default_factory=list, max_length=5)
    recommanderait: int | None = Field(default=None, ge=0, le=10)
    reviendrait: bool | None = None
    depart_regrette: bool | None = None
    points_forts: str | None = Field(default=None, max_length=4000)
    axes_amelioration: str | None = Field(default=None, max_length=4000)


def _mini(e: Employe) -> dict:
    return {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
            "direction": e.departement.nom if e.departement else "Non affecté"}


def _entretien_json(x: EntretienSortie | None) -> dict | None:
    if x is None:
        return None
    return {"date_entretien": x.date_entretien, "motif_principal": x.motif_principal,
            "motif_libelle": MOTIFS_DEPART.get(x.motif_principal, x.motif_principal),
            "motifs_secondaires": json.loads(x.motifs_secondaires or "[]"), "recommanderait": x.recommanderait,
            "reviendrait": x.reviendrait, "depart_regrette": x.depart_regrette,
            "points_forts": x.points_forts, "axes_amelioration": x.axes_amelioration}


def _sortis(db: Session, depuis: date) -> list[Employe]:
    """Départs de personnel. Un compte technique retiré du service (motif hors de
    la liste des motifs de sortie, comme l'ancien compte partagé ADMINRH) n'est
    pas un départ : il fausserait le taux."""
    return [e for e in db.scalars(select(Employe).where(
        Employe.statut == StatutEmploye.SORTI, Employe.date_sortie.isnot(None),
        Employe.date_sortie >= depuis).order_by(Employe.date_sortie.desc()))
        if e.motif_sortie is None or e.motif_sortie in MOTIFS_SORTIE]


@router.get("", summary="Départs, taux de départ et motifs (RH ; Direction générale en agrégé)")
def analyse(mois: int = 12, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    rh = utilisateur.role in ROLES_RH
    mois = min(max(mois, 1), 60)
    depuis = date.today() - timedelta(days=round(mois * 30.44))
    sortis = _sortis(db, depuis)
    actifs = db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)).all()
    entretiens = {x.employe_id: x for x in db.scalars(select(EntretienSortie))}
    # Sorties programmées : l'entretien se mène idéalement avant le départ.
    programmes = sorted((e for e in actifs if e.date_sortie), key=lambda e: e.date_sortie)
    # Effectif moyen approché : actifs d'aujourd'hui + moitié des départs de la période.
    effectif_moyen = len(actifs) + len(sortis) / 2
    volontaires = [e for e in sortis if e.motif_sortie in VOLONTAIRES]
    precoces = [e for e in sortis if e.date_entree and (e.date_sortie - e.date_entree).days < 365]
    avec_entretien = [entretiens[e.id] for e in sortis if e.id in entretiens]
    motifs: dict[str, int] = {}
    for x in avec_entretien:
        motifs[x.motif_principal] = motifs.get(x.motif_principal, 0) + 1
    notes = [x.recommanderait for x in avec_entretien if x.recommanderait is not None]
    promoteurs, detracteurs = sum(1 for n in notes if n >= 9), sum(1 for n in notes if n <= 6)
    par_direction: dict[str, dict] = {}
    for e in sortis:
        d = e.departement.nom if e.departement else "Non affecté"
        a = par_direction.setdefault(d, {"direction": d, "departs": 0, "volontaires": 0})
        a["departs"] += 1
        a["volontaires"] += e.motif_sortie in VOLONTAIRES
    return {
        "periode_mois": mois, "departs": len(sortis), "effectif_actuel": len(actifs),
        "taux_depart": round(100 * len(sortis) / effectif_moyen, 1) if effectif_moyen else None,
        "taux_depart_volontaire": round(100 * len(volontaires) / effectif_moyen, 1) if effectif_moyen else None,
        "departs_precoces": len(precoces),
        "entretiens_realises": len(avec_entretien),
        "departs_regrettes": sum(1 for x in avec_entretien if x.depart_regrette),
        "recommandation_nette": round(100 * (promoteurs - detracteurs) / len(notes)) if notes else None,
        "par_motif_sortie": [{"motif": k, "libelle": MOTIFS_SORTIE.get(k, k), "nombre": sum(1 for e in sortis if (e.motif_sortie or "autre") == k)}
                             for k in sorted({e.motif_sortie or "autre" for e in sortis})],
        "par_motif_depart": sorted(({"motif": k, "libelle": MOTIFS_DEPART.get(k, k), "nombre": n} for k, n in motifs.items()),
                                   key=lambda m: -m["nombre"]),
        "par_direction": sorted(par_direction.values(), key=lambda a: -a["departs"]),
        "motifs_depart": MOTIFS_DEPART,
        "collaborateurs": [{**_mini(e), "date_sortie": e.date_sortie, "motif_sortie": e.motif_sortie,
                            "motif_sortie_libelle": MOTIFS_SORTIE.get(e.motif_sortie, e.motif_sortie),
                            "date_entree": e.date_entree, "programmee": e.statut != StatutEmploye.SORTI,
                            "entretien": _entretien_json(entretiens.get(e.id))}
                           for e in [*programmes, *sortis]] if rh else None,
    }


@router.put("/{matricule}/entretien", summary="Enregistrer l'entretien de sortie (RH)")
def enregistrer(matricule: str, payload: EntretienPayload, db: Session = Depends(get_db),
                utilisateur: Employe = Depends(admin_requis)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")
    if e.statut != StatutEmploye.SORTI and not e.date_sortie:
        raise HTTPException(status_code=422, detail="Enregistrez d'abord la sortie (ou la sortie programmée) du collaborateur.")
    inconnus = [m for m in [payload.motif_principal, *payload.motifs_secondaires] if m not in MOTIFS_DEPART]
    if inconnus:
        raise HTTPException(status_code=422, detail="Motif de départ inconnu.")
    x = db.scalar(select(EntretienSortie).where(EntretienSortie.employe_id == e.id)) or EntretienSortie(employe_id=e.id)
    x.date_entretien, x.motif_principal = payload.date_entretien, payload.motif_principal
    x.motifs_secondaires = json.dumps([m for m in payload.motifs_secondaires if m != payload.motif_principal])
    x.recommanderait, x.reviendrait, x.depart_regrette = payload.recommanderait, payload.reviendrait, payload.depart_regrette
    x.points_forts = (payload.points_forts or "").strip() or None
    x.axes_amelioration = (payload.axes_amelioration or "").strip() or None
    x.mene_par_id = utilisateur.id
    db.add(x)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="entretien_sortie", cible=e.matricule,
                        detail=MOTIFS_DEPART[payload.motif_principal]))
    db.commit()
    return {"matricule": e.matricule, "entretien": _entretien_json(x)}
