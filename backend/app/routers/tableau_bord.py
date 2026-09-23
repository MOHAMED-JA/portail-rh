"""Tableau de bord employé et vue consolidée RH."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant, valideur_requis
from app.models import (
    Anomalie,
    CodePresence,
    Demande,
    Employe,
    Notification,
    Pointage,
    Role,
    StatutAnomalie,
    StatutDemande,
    StatutEmploye,
)
from app.models import ROLES_RH  # noqa: E402
from app.schemas import KPI, InsightRH, SerieMensuelle, SoldeDetail, TableauBord
from app.routers.demandes import detail as detail_demande
from app.services.demandes import solde_courant

router = APIRouter(prefix="/api/tableau-bord", tags=["Tableau de bord"])

MOIS_COURTS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]


def _series_mensuelles(db: Session, employe_ids: list[int], annee: int) -> SerieMensuelle:
    travaillees = [0.0] * 12
    prevues = [0.0] * 12
    pointages = db.scalars(
        select(Pointage).where(
            Pointage.employe_id.in_(employe_ids),
            Pointage.date_jour >= date(annee, 1, 1),
            Pointage.date_jour <= date(annee, 12, 31),
        )
    ).all()
    for p in pointages:
        index = p.date_jour.month - 1
        travaillees[index] += p.heures_travaillees
        prevues[index] += p.heures_prevues
    supp = [round(max(0.0, t - p), 1) for t, p in zip(travaillees, prevues)]
    return SerieMensuelle(
        mois=MOIS_COURTS,
        heures_travaillees=[round(v, 1) for v in travaillees],
        heures_prevues=[round(v, 1) for v in prevues],
        heures_supp=supp,
    )


def _mois_precedent_ratio(valeur_mois: float, valeur_precedent: float) -> float | None:
    if valeur_precedent == 0:
        return None
    return round((valeur_mois - valeur_precedent) / valeur_precedent * 100, 1)


@router.get("", response_model=TableauBord, summary="Tableau de bord personnel")
def tableau_bord(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    aujourdhui = date.today()
    annee = aujourdhui.year
    debut_mois = aujourdhui.replace(day=1)
    debut_mois_precedent = (debut_mois - timedelta(days=1)).replace(day=1)

    solde = solde_courant(db, utilisateur.id, annee)
    db.commit()

    pointages_annee = db.scalars(
        select(Pointage).where(
            Pointage.employe_id == utilisateur.id,
            Pointage.date_jour >= date(annee, 1, 1),
        )
    ).all()
    pointages_mois = [p for p in pointages_annee if p.date_jour >= debut_mois]
    pointages_mois_precedent = [
        p for p in pointages_annee if debut_mois_precedent <= p.date_jour < debut_mois
    ]

    heures_mois = sum(p.heures_travaillees for p in pointages_mois)
    heures_mois_precedent = sum(p.heures_travaillees for p in pointages_mois_precedent)
    prevues_mois = sum(p.heures_prevues for p in pointages_mois)
    retards_mois = sum(1 for p in pointages_mois if p.retard_minutes > 0)
    retards_precedent = sum(1 for p in pointages_mois_precedent if p.retard_minutes > 0)
    minutes_retard = sum(p.retard_minutes for p in pointages_mois)

    anomalies_ouvertes = db.scalar(
        select(func.count(Anomalie.id)).where(
            Anomalie.employe_id == utilisateur.id, Anomalie.statut == StatutAnomalie.OUVERTE
        )
    ) or 0

    absences = sum(1 for p in pointages_annee if p.code_presence == CodePresence.ABSENT)
    conges = sum(1 for p in pointages_annee if p.code_presence == CodePresence.CONGE)
    presents = sum(1 for p in pointages_annee if p.code_presence in (CodePresence.PRESENT, CodePresence.MISSION))

    ponctuels = sum(1 for p in pointages_annee if p.retard_minutes == 0 and p.code_presence == CodePresence.PRESENT)
    en_retard = sum(1 for p in pointages_annee if p.retard_minutes > 0)
    anomalies_annee = db.scalar(
        select(func.count(Anomalie.id)).where(
            Anomalie.employe_id == utilisateur.id, Anomalie.date_jour >= date(annee, 1, 1)
        )
    ) or 0

    dernieres = db.scalars(
        select(Demande).where(Demande.employe_id == utilisateur.id).order_by(Demande.cree_le.desc()).limit(5)
    ).all()

    non_lues = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.destinataire_id == utilisateur.id, Notification.lu.is_(False)
        )
    ) or 0

    kpis = {
        "solde": KPI(
            valeur=solde.jours_restants,
            libelle="Solde de congés",
            unite="j",
            detail=f"{solde.jours_pris} j pris sur {round(solde.jours_acquis + solde.report_anterieur, 1)} j acquis",
        ),
        "absences": KPI(
            valeur=absences + conges,
            libelle="Absences cumulées",
            unite="j",
            detail=f"{anomalies_ouvertes} anomalie(s) ouverte(s)",
        ),
        "heures": KPI(
            valeur=round(heures_mois, 1),
            libelle="Heures travaillées (mois)",
            unite="h",
            variation=_mois_precedent_ratio(heures_mois, heures_mois_precedent),
            detail=f"{round(prevues_mois, 1)} h prévues",
        ),
        "retards": KPI(
            valeur=retards_mois,
            libelle="Retards du mois",
            unite="",
            variation=_mois_precedent_ratio(retards_mois, retards_precedent),
            detail=f"{minutes_retard} min cumulées · {round(max(0.0, heures_mois - prevues_mois), 1)} h supp.",
        ),
    }

    return TableauBord(
        solde=SoldeDetail.model_validate(solde),
        kpis=kpis,
        repartition_absences={"Présent": presents, "Congé": conges, "Absent": absences},
        repartition_retards={"Ponctuel": ponctuels, "Retard": en_retard, "Anomalie": anomalies_annee},
        series=_series_mensuelles(db, [utilisateur.id], annee),
        dernieres_demandes=[detail_demande(d) for d in dernieres],
        notifications_non_lues=non_lues,
    )


@router.get("/consolide", summary="Vue consolidée multi-équipes (validateur / RH)")
def consolide(db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_requis)):
    aujourdhui = date.today()
    debut_mois = aujourdhui.replace(day=1)

    if utilisateur.role in ROLES_RH:
        employes = db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)).all()
    else:
        directs = db.scalars(select(Employe).where(Employe.validateur_id == utilisateur.id)).all()
        employes = directs
    ids = [e.id for e in employes] or [-1]

    pointages_mois = db.scalars(
        select(Pointage).where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut_mois)
    ).all()
    jours_total = len(pointages_mois) or 1
    absences = sum(1 for p in pointages_mois if p.code_presence == CodePresence.ABSENT)
    conges = sum(1 for p in pointages_mois if p.code_presence == CodePresence.CONGE)
    retards = [p.retard_minutes for p in pointages_mois if p.retard_minutes > 0]

    en_attente = db.scalar(
        select(func.count(Demande.id)).where(
            Demande.employe_id.in_(ids), Demande.statut == StatutDemande.EN_ATTENTE
        )
    ) or 0
    anomalies = db.scalar(
        select(func.count(Anomalie.id)).where(
            Anomalie.employe_id.in_(ids), Anomalie.statut == StatutAnomalie.OUVERTE
        )
    ) or 0
    conges_en_cours = db.scalar(
        select(func.count(Demande.id)).where(
            Demande.employe_id.in_(ids),
            Demande.statut == StatutDemande.APPROUVEE,
            Demande.date_debut <= aujourdhui,
            Demande.date_fin >= aujourdhui,
        )
    ) or 0

    # Répartition par département
    par_departement: dict[str, dict] = {}
    for employe in employes:
        cle = employe.departement.nom if employe.departement else "Non affecté"
        entree = par_departement.setdefault(cle, {"effectif": 0, "absences": 0, "retards": 0})
        entree["effectif"] += 1
    for p in pointages_mois:
        employe = next((e for e in employes if e.id == p.employe_id), None)
        cle = employe.departement.nom if employe and employe.departement else "Non affecté"
        entree = par_departement.setdefault(cle, {"effectif": 0, "absences": 0, "retards": 0})
        if p.code_presence == CodePresence.ABSENT:
            entree["absences"] += 1
        if p.retard_minutes > 0:
            entree["retards"] += 1

    return {
        "effectif": len(employes),
        "taux_absenteisme": round((absences + conges) / jours_total * 100, 1),
        "retard_moyen_minutes": round(sum(retards) / len(retards), 1) if retards else 0,
        "demandes_en_attente": en_attente,
        "anomalies_ouvertes": anomalies,
        "conges_en_cours": conges_en_cours,
        "par_departement": par_departement,
        "series": _series_mensuelles(db, ids, aujourdhui.year).model_dump(),
    }


@router.get("/insights", response_model=list[InsightRH], summary="Insights intelligents")
def insights(db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_requis)):
    """Détections simples mais utiles : soldes critiques, absentéisme,
    anomalies persistantes, demandes qui dorment dans la file."""
    aujourdhui = date.today()
    resultats: list[InsightRH] = []

    if utilisateur.role in ROLES_RH:
        employes = db.scalars(select(Employe).where(Employe.statut == StatutEmploye.ACTIF)).all()
    else:
        employes = db.scalars(select(Employe).where(Employe.validateur_id == utilisateur.id)).all()
    ids = [e.id for e in employes] or [-1]

    # 1. Soldes proches de zéro ou négatifs
    faibles = []
    for employe in employes:
        solde = solde_courant(db, employe.id, aujourdhui.year)
        if solde.jours_restants <= 2:
            faibles.append(f"{employe.prenom} {employe.nom} ({solde.jours_restants} j)")
    db.commit()
    if faibles:
        resultats.append(
            InsightRH(
                niveau="alerte",
                titre=f"{len(faibles)} collaborateur(s) en fin de solde",
                message=", ".join(faibles[:4]) + ("…" if len(faibles) > 4 else ""),
                action="Vérifier les reports et anticiper les demandes de fin d'année.",
            )
        )

    # 2. Tendance d'absentéisme sur 2 mois
    debut_mois = aujourdhui.replace(day=1)
    debut_precedent = (debut_mois - timedelta(days=1)).replace(day=1)
    pointages = db.scalars(
        select(Pointage).where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut_precedent)
    ).all()
    courant = [p for p in pointages if p.date_jour >= debut_mois]
    precedent = [p for p in pointages if p.date_jour < debut_mois]
    taux = lambda lot: (  # noqa: E731
        sum(1 for p in lot if p.code_presence in (CodePresence.ABSENT, CodePresence.CONGE)) / len(lot) * 100
        if lot else 0
    )
    t_courant, t_precedent = taux(courant), taux(precedent)
    if t_precedent and t_courant > t_precedent * 1.25:
        resultats.append(
            InsightRH(
                niveau="critique",
                titre="Absentéisme en hausse",
                message=f"{round(t_courant, 1)} % ce mois contre {round(t_precedent, 1)} % le mois dernier.",
                action="Analyser les départements concernés dans la vue consolidée.",
            )
        )

    # 3. Demandes en attente depuis plus de 3 jours
    anciennes = db.scalars(
        select(Demande).where(
            Demande.employe_id.in_(ids),
            Demande.statut == StatutDemande.EN_ATTENTE,
            Demande.cree_le <= aujourdhui - timedelta(days=3),
        )
    ).all()
    if anciennes:
        resultats.append(
            InsightRH(
                niveau="alerte",
                titre=f"{len(anciennes)} demande(s) en attente depuis plus de 3 jours",
                message="Le délai de réponse cible est de 48 h.",
                action="Traiter la file de validation.",
            )
        )

    # 4. Anomalies récurrentes
    recurrents = db.execute(
        select(Anomalie.employe_id, func.count(Anomalie.id).label("total"))
        .where(
            Anomalie.employe_id.in_(ids),
            Anomalie.statut == StatutAnomalie.OUVERTE,
            Anomalie.date_jour >= aujourdhui - timedelta(days=30),
        )
        .group_by(Anomalie.employe_id)
        .having(func.count(Anomalie.id) >= 3)
    ).all()
    if recurrents:
        noms = []
        for employe_id, total in recurrents:
            employe = db.get(Employe, employe_id)
            if employe:
                noms.append(f"{employe.prenom} {employe.nom} ({total})")
        resultats.append(
            InsightRH(
                niveau="info",
                titre="Anomalies de pointage récurrentes",
                message=", ".join(noms),
                action="Rappeler la procédure de badgeage en 2 fois par demi-journée.",
            )
        )

    if not resultats:
        resultats.append(
            InsightRH(
                niveau="info",
                titre="Aucun signal faible détecté",
                message="Soldes, absentéisme et file de validation sont dans les seuils attendus.",
            )
        )
    return resultats
