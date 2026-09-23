"""Revue des talents : grille performance × potentiel (9 cases) et calibration.

- Performance : note finale de l'évaluation finalisée (< 10 faible, < 14
  conforme, ≥ 14 élevée), que la RH peut ajuster en calibration.
- Potentiel : proposé par le N+1 opérationnel, arrêté par la RH en calibration.

Grille : RH (calibration) et Direction générale (lecture). Le supérieur ne voit
que ses propositions de potentiel pour ses collaborateurs directs : la grille
révèle les notes, qui restent réservées à la RH, à la DG et à l'intéressé."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import ROLES_RH, Employe, JournalAudit, PosteCle, RevueTalent, StatutEmploye, Successeur
from app.services import hierarchie, remuneration

router = APIRouter(prefix="/api/revue-talents", tags=["Revue des talents"])

NIVEAUX = {1: "Faible", 2: "Moyen", 3: "Élevé"}
CASES = {
    (3, 3): ("Talent clé", "Préparer à des responsabilités plus larges ; plan de succession."),
    (2, 3): ("Talent émergent", "Accompagner vers la pleine performance : mentorat, objectifs ambitieux."),
    (1, 3): ("Potentiel à révéler", "Comprendre l'écart : poste, management, conditions de travail."),
    (3, 2): ("Performant à fort impact", "Élargir le périmètre ; fidéliser."),
    (2, 2): ("Pilier", "Développer dans le poste ; reconnaître la contribution."),
    (1, 2): ("À accompagner", "Plan de progrès précis, suivi rapproché."),
    (3, 1): ("Expert confirmé", "Valoriser l'expertise ; transmission des savoirs."),
    (2, 1): ("Contributeur fiable", "Maintenir l'engagement ; formation dans le poste."),
    (1, 1): ("Performance insuffisante", "Plan d'amélioration formalisé, ou réorientation."),
}


class PotentielPayload(BaseModel):
    annee: int = Field(default_factory=lambda: date.today().year)
    potentiel: int = Field(ge=1, le=3)
    commentaire: str | None = Field(default=None, max_length=2000)


class CalibrationPayload(BaseModel):
    annee: int = Field(default_factory=lambda: date.today().year)
    performance: int | None = Field(default=None, ge=1, le=3)
    potentiel: int | None = Field(default=None, ge=1, le=3)
    commentaire: str | None = Field(default=None, max_length=2000)


def _employe(db: Session, matricule: str) -> Employe:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")
    return e


def _revue(db: Session, e: Employe, annee: int) -> RevueTalent:
    r = db.scalar(select(RevueTalent).where(RevueTalent.employe_id == e.id, RevueTalent.annee == annee))
    if r is None:
        r = RevueTalent(employe_id=e.id, annee=annee)
        db.add(r)
        db.flush()
    return r


def _mini(e: Employe) -> dict:
    return {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
            "direction": e.departement.nom if e.departement else "Non affecté"}


def _concernes(db: Session) -> list[Employe]:
    """Tout le personnel actif, sauf le Directeur général (sans supérieur ni évaluation)."""
    return [e for e in db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)
                                  .order_by(Employe.nom, Employe.prenom)) if (e.niveau or "") != "dg"]


@router.get("", summary="Grille performance × potentiel (RH ; Direction générale en lecture)")
def grille(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    annee = annee or date.today().year
    revues = {r.employe_id: r for r in db.scalars(select(RevueTalent).where(RevueTalent.annee == annee))}
    successeurs = {s.employe_id for s in db.scalars(select(Successeur))}
    titulaires = {p.titulaire_id for p in db.scalars(select(PosteCle)) if p.titulaire_id}
    cases = {f"{p}-{q}": [] for p, q in CASES}
    non_positionnes = []
    for e in _concernes(db):
        r = revues.get(e.id)
        note = remuneration.note_de_performance(db, e.id, annee)
        perf_auto = remuneration.niveau_de_note(note)
        performance = (r.performance if r and r.performance else perf_auto)
        potentiel = (r.potentiel if r and r.potentiel else (r.potentiel_propose if r else None))
        fiche = {**_mini(e), "note": note, "performance_auto": perf_auto, "performance": performance,
                 "potentiel": potentiel, "potentiel_propose": r.potentiel_propose if r else None,
                 "commentaire_superieur": r.commentaire_superieur if r else None,
                 "commentaire_calibration": r.commentaire_calibration if r else None,
                 "calibre": bool(r and r.calibre_le), "successeur": e.id in successeurs,
                 "titulaire_poste_cle": e.id in titulaires}
        if performance and potentiel:
            cases[f"{performance}-{potentiel}"].append(fiche)
        else:
            manque = [m for m, ok in (("évaluation finalisée", performance), ("potentiel", potentiel)) if not ok]
            non_positionnes.append({**fiche, "manque": manque})
    return {
        "annee": annee, "niveaux": NIVEAUX, "peut_calibrer": utilisateur.role in ROLES_RH,
        "cases": [{"cle": f"{p}-{q}", "performance": p, "potentiel": q, "libelle": CASES[(p, q)][0],
                   "action": CASES[(p, q)][1], "collaborateurs": cases[f"{p}-{q}"]} for p, q in CASES],
        "positionnes": sum(len(v) for v in cases.values()),
        "non_positionnes": non_positionnes,
    }


@router.get("/equipe", summary="Mes collaborateurs directs : potentiel proposé (supérieur)")
def equipe(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    annee = annee or date.today().year
    directs = [e for e in db.scalars(select(Employe).where(Employe.validateur_id == utilisateur.id,
                                                            Employe.statut != StatutEmploye.SORTI).order_by(Employe.nom))
               if hierarchie.superieur_operationnel(e) is not None and e.id != utilisateur.id]
    revues = {r.employe_id: r for r in db.scalars(select(RevueTalent).where(RevueTalent.annee == annee))}
    return {"annee": annee, "niveaux": NIVEAUX, "collaborateurs": [
        {**_mini(e), "potentiel_propose": revues[e.id].potentiel_propose if e.id in revues else None,
         "commentaire": revues[e.id].commentaire_superieur if e.id in revues else None} for e in directs]}


@router.put("/{matricule}/potentiel", summary="Proposer le potentiel d'un collaborateur direct (N+1 ou RH)")
def proposer(matricule: str, payload: PotentielPayload, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(utilisateur_courant)):
    e = _employe(db, matricule)
    chef = hierarchie.superieur_operationnel(e)
    if not ((chef and chef.id == utilisateur.id) or utilisateur.role in ROLES_RH) or e.id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Seul le supérieur direct (ou la RH) propose le potentiel.")
    r = _revue(db, e, payload.annee)
    r.potentiel_propose, r.commentaire_superieur = payload.potentiel, (payload.commentaire or "").strip() or None
    r.propose_par_id, r.propose_le = utilisateur.id, datetime.utcnow()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="potentiel_propose", cible=e.matricule,
                        detail=f"{payload.annee} : {NIVEAUX[payload.potentiel]}"))
    db.commit()
    return {"matricule": e.matricule, "potentiel_propose": r.potentiel_propose}


@router.put("/{matricule}/calibrer", summary="Arrêter la position dans la grille (RH)")
def calibrer(matricule: str, payload: CalibrationPayload, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(admin_requis)):
    e = _employe(db, matricule)
    if (e.niveau or "") == "dg":
        raise HTTPException(status_code=422, detail="Le Directeur général n'est pas positionné dans la grille.")
    r = _revue(db, e, payload.annee)
    r.performance, r.potentiel = payload.performance, payload.potentiel
    r.commentaire_calibration = (payload.commentaire or "").strip() or None
    r.calibre_par_id, r.calibre_le = utilisateur.id, datetime.utcnow()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="talent_calibre", cible=e.matricule,
                        detail=f"{payload.annee} : performance {payload.performance or 'auto'}, potentiel {payload.potentiel or '—'}"))
    db.commit()
    return {"matricule": e.matricule, "performance": r.performance, "potentiel": r.potentiel}
