"""Pointages, vue mensuelle agrégée et anomalies."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant, valideur_requis
from app.models import (
    Anomalie,
    CodePresence,
    Employe,
    Pointage,
    Role,
    StatutAnomalie,
    StatutEmploye,
    TypeAnomalie,
)
from app.models import ROLES_RH  # noqa: E402
from app.schemas import AnomalieDetail, PointageDetail, PointagePayload
from app.services import parametres
from app.services.calendrier import est_ouvre

router = APIRouter(prefix="/api/presences", tags=["Présences"])

HEURE_ARRIVEE_THEORIQUE = time(8, 30)
from app.services.pointage import LIBELLES as LIBELLES_ANOMALIES  # noqa: E402


def _minutes(valeur: time | None) -> int | None:
    return None if valeur is None else valeur.hour * 60 + valeur.minute


def calculer_pointage(pointage: Pointage) -> list[TypeAnomalie]:
    """Recalcule heures travaillées / retard et renvoie les anomalies détectées.

    Badgeage en 2 fois par demi-journée : toute entrée ou sortie manquante
    sur une demi-journée entamée génère une anomalie.
    """
    anomalies: list[TypeAnomalie] = []
    total = 0

    for entree, sortie in ((pointage.entree1, pointage.sortie1), (pointage.entree2, pointage.sortie2)):
        e, s = _minutes(entree), _minutes(sortie)
        if e is not None and s is not None:
            total += max(0, s - e)
        elif e is not None and s is None:
            anomalies.append(TypeAnomalie.SORTIE_MANQUANTE)
        elif e is None and s is not None:
            anomalies.append(TypeAnomalie.ENTREE_MANQUANTE)

    pointage.heures_travaillees = round(total / 60, 2)

    if pointage.code_presence == CodePresence.PRESENT:
        arrivee = _minutes(pointage.entree1)
        heure, minute = (int(x) for x in str(parametres.REGLES.get("heureArrivee", "08:30")).split(":")[:2])
        theorique = heure * 60 + minute
        tolerance = int(parametres.REGLES.get("toleranceRetard", 5))
        if arrivee is None and pointage.entree2 is None:
            anomalies.append(TypeAnomalie.ABSENCE_NON_JUSTIFIEE)
            pointage.retard_minutes = 0
        elif arrivee is not None and arrivee > theorique:
            pointage.retard_minutes = arrivee - theorique
            if pointage.retard_minutes > tolerance:
                anomalies.append(TypeAnomalie.RETARD)
        else:
            pointage.retard_minutes = 0
        if pointage.heures_travaillees and pointage.heures_travaillees < pointage.heures_prevues - 1:
            anomalies.append(TypeAnomalie.DEPART_ANTICIPE)
    else:
        pointage.retard_minutes = 0

    return anomalies


def synchroniser_anomalies(db: Session, pointage: Pointage) -> list[TypeAnomalie]:
    """Journée saisie en quatre colonnes (correction RH, import) : ses heures
    deviennent des passages, puis le moteur de pointage recalcule tout."""
    from app.services import pointage as moteur

    for p in moteur.passages_du_jour(db, pointage.employe_id, pointage.date_jour):
        db.delete(p)
    db.flush()
    for valeur in (pointage.entree1, pointage.sortie1, pointage.entree2, pointage.sortie2):
        if valeur is not None:
            moteur.enregistrer_passage(db, pointage.employe_id, datetime.combine(pointage.date_jour, valeur), "correction")
    moteur.recalculer(db, pointage.employe_id, pointage.date_jour)
    return []


def _ancienne_synchronisation(db: Session, pointage: Pointage) -> list[TypeAnomalie]:
    detectees = calculer_pointage(pointage)
    existantes = db.scalars(
        select(Anomalie).where(
            Anomalie.employe_id == pointage.employe_id, Anomalie.date_jour == pointage.date_jour
        )
    ).all()
    for anomalie in existantes:
        if anomalie.type_anomalie not in detectees and anomalie.statut == StatutAnomalie.OUVERTE:
            db.delete(anomalie)
    deja = {a.type_anomalie for a in existantes}
    for type_anomalie in detectees:
        if type_anomalie not in deja:
            db.add(
                Anomalie(
                    employe_id=pointage.employe_id,
                    pointage_id=pointage.id,
                    date_jour=pointage.date_jour,
                    type_anomalie=type_anomalie,
                    detail=LIBELLES_ANOMALIES[type_anomalie],
                )
            )
    return detectees


def _perimetre(db: Session, utilisateur: Employe, employe_id: int | None) -> list[int]:
    """Qui l'utilisateur a-t-il le droit de consulter ?"""
    if utilisateur.role in ROLES_RH:
        if employe_id:
            return [employe_id]
        return list(db.scalars(select(Employe.id).where(Employe.statut != StatutEmploye.SORTI)))
    from app.services import hierarchie

    equipe = list(hierarchie.perimetre_ids(db, utilisateur))
    if equipe:
        equipe.append(utilisateur.id)
        if employe_id:
            if employe_id not in equipe:
                raise HTTPException(status_code=403, detail="Employé hors de votre périmètre")
            return [employe_id]
        return equipe
    if employe_id and employe_id != utilisateur.id:
        raise HTTPException(status_code=403, detail="Accès limité à vos propres pointages")
    return [utilisateur.id]


def _to_detail(db: Session, pointage: Pointage) -> PointageDetail:
    sortie = PointageDetail.model_validate(pointage)
    anomalies = db.scalars(
        select(Anomalie).where(
            Anomalie.employe_id == pointage.employe_id, Anomalie.date_jour == pointage.date_jour
        )
    ).all()
    sortie.anomalies = [LIBELLES_ANOMALIES[a.type_anomalie] for a in anomalies]
    from app.services.pointage import passages_du_jour
    sortie.passages = [f"{p.horodatage:%H:%M}" for p in passages_du_jour(db, pointage.employe_id, pointage.date_jour)]
    return sortie


@router.get("/pointages", response_model=list[PointageDetail], summary="Pointages quotidiens")
def pointages(
    debut: date | None = None,
    fin: date | None = None,
    employe_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    aujourdhui = date.today()
    debut = debut or aujourdhui.replace(day=1)
    fin = fin or aujourdhui
    ids = _perimetre(db, utilisateur, employe_id)

    lignes = db.scalars(
        select(Pointage)
        .where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut, Pointage.date_jour <= fin)
        .order_by(Pointage.date_jour.desc(), Pointage.employe_id)
        .limit(6000)  # un exercice complet pour tout l'effectif
    ).all()
    return [_to_detail(db, p) for p in lignes]


@router.get("/mensuel", summary="Agrégat mensuel par employé")
def mensuel(
    annee: int = Query(default=date.today().year),
    mois: int = Query(default=date.today().month, ge=1, le=12),
    employe_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    ids = _perimetre(db, utilisateur, employe_id)
    dernier_jour = monthrange(annee, mois)[1]
    debut, fin = date(annee, mois, 1), date(annee, mois, dernier_jour)

    lignes = db.scalars(
        select(Pointage).where(
            Pointage.employe_id.in_(ids), Pointage.date_jour >= debut, Pointage.date_jour <= fin
        )
    ).all()

    resultats: dict[int, dict] = {}
    for p in lignes:
        bloc = resultats.setdefault(
            p.employe_id,
            {
                "employe_id": p.employe_id,
                "nom": "",
                "matricule": "",
                "departement": None,
                "jours_travailles": 0,
                "jours_absence": 0,
                "jours_conge": 0,
                "heures_travaillees": 0.0,
                "heures_prevues": 0.0,
                "retards": 0,
                "minutes_retard": 0,
                "serie": [0.0] * dernier_jour,
            },
        )
        bloc["heures_travaillees"] += p.heures_travaillees
        bloc["heures_prevues"] += p.heures_prevues
        bloc["serie"][p.date_jour.day - 1] = round(p.heures_travaillees, 2)
        if p.code_presence == CodePresence.PRESENT:
            bloc["jours_travailles"] += 1
        elif p.code_presence == CodePresence.ABSENT:
            bloc["jours_absence"] += 1
        elif p.code_presence == CodePresence.CONGE:
            bloc["jours_conge"] += 1
        if p.retard_minutes > 0:
            bloc["retards"] += 1
            bloc["minutes_retard"] += p.retard_minutes

    for employe_id_cle, bloc in resultats.items():
        employe = db.get(Employe, employe_id_cle)
        if employe:
            bloc["nom"] = f"{employe.prenom} {employe.nom}"
            bloc["matricule"] = employe.matricule
            bloc["departement"] = employe.departement.nom if employe.departement else None
        bloc["heures_travaillees"] = round(bloc["heures_travaillees"], 1)
        bloc["heures_prevues"] = round(bloc["heures_prevues"], 1)
        bloc["heures_supp"] = round(max(0.0, bloc["heures_travaillees"] - bloc["heures_prevues"]), 1)

    return {
        "annee": annee,
        "mois": mois,
        "jours_du_mois": dernier_jour,
        "lignes": sorted(resultats.values(), key=lambda b: b["nom"]),
    }


@router.get("/anomalies", response_model=list[AnomalieDetail], summary="Liste des anomalies")
def anomalies(
    statut: StatutAnomalie | None = StatutAnomalie.OUVERTE,
    employe_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    ids = _perimetre(db, utilisateur, employe_id)
    requete = select(Anomalie).where(Anomalie.employe_id.in_(ids))
    if statut:
        requete = requete.where(Anomalie.statut == statut)
    lignes = db.scalars(requete.order_by(Anomalie.date_jour.desc()).limit(400)).all()
    sorties = []
    for a in lignes:
        sortie = AnomalieDetail.model_validate(a)
        sortie.type_anomalie = LIBELLES_ANOMALIES[a.type_anomalie]
        sorties.append(sortie)
    return sorties


@router.get("/anomalies/compteur", summary="Compteur d'anomalies ouvertes")
def compteur_anomalies(
    db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    ids = _perimetre(db, utilisateur, None)
    total = db.scalar(
        select(func.count(Anomalie.id)).where(
            Anomalie.employe_id.in_(ids), Anomalie.statut == StatutAnomalie.OUVERTE
        )
    )
    return {"total": total or 0}


@router.post("/anomalies/{anomalie_id}/justifier", response_model=AnomalieDetail, summary="Justifier une anomalie")
def justifier(
    anomalie_id: int,
    justification: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    anomalie = db.get(Anomalie, anomalie_id)
    if not anomalie:
        raise HTTPException(status_code=404, detail="Anomalie introuvable")
    if anomalie.employe_id != utilisateur.id:
        raise HTTPException(status_code=403, detail=(
            "Seul le collaborateur concerné justifie son anomalie : pour les autres, c'est un indicateur."))
    anomalie.justification = justification
    anomalie.statut = StatutAnomalie.JUSTIFIEE
    db.commit()
    db.refresh(anomalie)
    sortie = AnomalieDetail.model_validate(anomalie)
    sortie.type_anomalie = LIBELLES_ANOMALIES[anomalie.type_anomalie]
    return sortie


@router.put("/pointages", response_model=PointageDetail, summary="Saisir / corriger un pointage (RH)")
def enregistrer_pointage(
    payload: PointagePayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_requis),
):
    pointage = db.scalar(
        select(Pointage).where(
            Pointage.employe_id == payload.employe_id, Pointage.date_jour == payload.date_jour
        )
    )
    if not pointage:
        pointage = Pointage(
            employe_id=payload.employe_id,
            date_jour=payload.date_jour,
            heures_prevues=float(parametres.REGLES.get("dureeJournee", 8)) if est_ouvre(payload.date_jour) else 0.0,
        )
        db.add(pointage)

    pointage.entree1 = payload.entree1
    pointage.sortie1 = payload.sortie1
    pointage.entree2 = payload.entree2
    pointage.sortie2 = payload.sortie2
    pointage.code_presence = payload.code_presence
    db.flush()
    synchroniser_anomalies(db, pointage)
    db.commit()
    db.refresh(pointage)
    return _to_detail(db, pointage)


@router.post("/badger", response_model=PointageDetail, summary="Badger (entrée ou sortie)")
def badger(
    db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    """Chaque badgeage est un passage horodaté ; la journée est recalculée et
    l'heure s'affiche immédiatement."""
    from app.services import pointage as moteur

    maintenant = datetime.now().replace(microsecond=0)
    if not moteur.enregistrer_passage(db, utilisateur.id, maintenant, "portail"):
        raise HTTPException(status_code=409, detail="Passage déjà enregistré à cette seconde.")
    pointage = moteur.recalculer(db, utilisateur.id, maintenant.date())
    db.commit()
    db.refresh(pointage)
    return _to_detail(db, pointage)
