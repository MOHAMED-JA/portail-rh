"""Tableau de bord de l'équipe : pointages, présences, absences, fiches
d'objectifs et d'évaluation de toute la ligne hiérarchique du supérieur
(tout le personnel pour la Direction générale et la RH).

Aucune information confidentielle : ni paie, ni dossier personnel. La note
finale des évaluations finalisées n'est donnée qu'à la RH et à la Direction
générale (consultation seule).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import (
    Anomalie, CodePresence, Demande, DossierEmploye, Employe, FicheEvaluation, FicheObjectifs, Pointage,
    SoldeConge, StatutAnomalie, StatutDemande, TypeAnomalie, TypeDemande,
)
from app.services import hierarchie
from app.services.calendrier import compter_jours_conge, est_ouvre

router = APIRouter(prefix="/api/pilotage", tags=["Tableau de bord équipe"])

# Absences approuvées, regroupées pour la lecture du manager.
FAMILLES_ABSENCE = {
    "maladie": "maladie", "prenatal": "maladie",
    "sans_solde": "sans_solde",
    "suspension": "suspension", "mise_a_pied": "suspension",
}
LIBELLES_FAMILLES = {"conge": "Congés", "maladie": "Maladie", "sans_solde": "Sans solde",
                     "suspension": "Suspension / mise à pied", "mission": "Missions",
                     "injustifiee": "Absences injustifiées"}


def _mois(mois: str | None) -> tuple[date, date]:
    try:
        debut = datetime.strptime(mois, "%Y-%m").date() if mois else date.today().replace(day=1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Mois attendu au format AAAA-MM.")
    fin = (debut.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return debut, fin


def _jours_dans(d: Demande, debut: date, fin: date) -> float:
    a, b = max(d.date_debut, debut), min(d.date_fin, fin)
    if b < a:
        return 0.0
    if d.date_debut == d.date_fin and d.nombre_jours and d.nombre_jours < 1:
        return d.nombre_jours  # demi-journée
    return compter_jours_conge(a, b)


def _heure_arrivee() -> time:
    from app.services.parametres import REGLES

    h, m = (REGLES.get("heureArrivee") or "08:00").split(":")
    return time(int(h), int(m))


def _situation_du_jour(e: Employe, pointage: Pointage | None, demandes: list[Demande], jour: date) -> str:
    for d in demandes:
        if d.statut == StatutDemande.APPROUVEE and d.date_debut <= jour <= d.date_fin:
            if d.type_demande == TypeDemande.CONGE:
                return "maladie" if FAMILLES_ABSENCE.get(d.sous_type) == "maladie" else "conge"
            if d.type_demande == TypeDemande.MISSION:
                return "mission"
    if not est_ouvre(jour):
        return "repos"
    if pointage and (pointage.entree1 or pointage.heures_travaillees):
        return "present"
    if jour == date.today() and datetime.now().time() < _heure_arrivee():
        return "attendu"
    return "non_pointe"


def _statut_fiches(db: Session, e: Employe, annee: int) -> tuple[str, str, float | None]:
    from app.routers.fiches import statut_evaluation

    obj = db.scalar(select(FicheObjectifs).where(FicheObjectifs.employe_id == e.id, FicheObjectifs.annee == annee))
    ev = db.scalar(select(FicheEvaluation).where(FicheEvaluation.employe_id == e.id, FicheEvaluation.annee == annee))
    statut_obj = obj.statut.value if obj else "brouillon"
    if obj and ev:
        statut_ev = statut_evaluation(obj, ev)
    else:
        statut_ev = "a_evaluer" if statut_obj == "validee" else "non_ouverte"
    note = ev.note_finale if ev and ev.finalisee_le else None
    return statut_obj, statut_ev, note


def _employes(db: Session, utilisateur: Employe) -> list[Employe]:
    ids = hierarchie.perimetre_ids(db, utilisateur)
    if not ids:
        raise HTTPException(status_code=403, detail="Aucun collaborateur dans votre périmètre.")
    return list(db.scalars(select(Employe).where(Employe.id.in_(ids)).order_by(Employe.nom, Employe.prenom)))


def _ligne(db: Session, e: Employe, debut: date, fin: date, pointages: list[Pointage], anomalies: list[Anomalie],
           demandes: list[Demande], grade: str | None, voir_notes: bool = False) -> dict:
    jour = date.today()
    fin_ecoulee = min(fin, jour)
    absences = {k: 0.0 for k in LIBELLES_FAMILLES}
    autorisations_h = 0.0
    en_attente = 0
    for d in demandes:
        if d.statut == StatutDemande.EN_ATTENTE:
            en_attente += 1
        if d.statut != StatutDemande.APPROUVEE:
            continue
        if d.type_demande == TypeDemande.CONGE:
            absences[FAMILLES_ABSENCE.get(d.sous_type, "conge")] += _jours_dans(d, debut, fin)
        elif d.type_demande == TypeDemande.MISSION:
            absences["mission"] += _jours_dans(d, debut, fin)
        elif d.type_demande == TypeDemande.AUTORISATION and debut <= d.date_debut <= fin:
            autorisations_h += d.duree_heures or 0
    injustifiees = [a for a in anomalies if a.type_anomalie == TypeAnomalie.ABSENCE_NON_JUSTIFIEE
                    and a.statut != StatutAnomalie.JUSTIFIEE]
    absences["injustifiee"] = float(len(injustifiees))
    retards = [p for p in pointages if (p.retard_minutes or 0) > 0]
    jours_ouvres = sum(1 for i in range((fin_ecoulee - debut).days + 1) if est_ouvre(debut + timedelta(days=i))) \
        if fin_ecoulee >= debut else 0
    pointage_du_jour = next((p for p in pointages if p.date_jour == jour), None)
    solde = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == e.id, SoldeConge.annee == jour.year))
    statut_obj, statut_ev, note = _statut_fiches(db, e, debut.year)
    ligne = {
        "employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                    "departement": e.departement.nom if e.departement else None,
                    "niveau": e.niveau or "collaborateur", "grade": grade,
                    "superieur": f"{e.validateur.prenom} {e.validateur.nom}" if e.validateur else None},
        "aujourdhui": _situation_du_jour(e, pointage_du_jour, demandes, jour) if debut <= jour <= fin else None,
        "jours_ouvres": jours_ouvres,
        "jours_presents": sum(1 for p in pointages if p.code_presence == CodePresence.PRESENT and (p.heures_travaillees or 0) > 0),
        "heures_travaillees": round(sum(p.heures_travaillees or 0 for p in pointages), 1),
        "heures_prevues": round(sum(p.heures_prevues or 0 for p in pointages if p.code_presence == CodePresence.PRESENT), 1),
        "retards": len(retards),
        "retard_minutes": sum(p.retard_minutes or 0 for p in retards),
        "absences": {k: round(v, 1) for k, v in absences.items()},
        "autorisations_heures": round(autorisations_h, 2),
        "anomalies_ouvertes": sum(1 for a in anomalies if a.statut == StatutAnomalie.OUVERTE),
        "demandes_en_attente": en_attente,
        "solde_conges": solde.jours_restants if solde else None,
        "objectifs": statut_obj,
        "evaluation": statut_ev,
    }
    # Note finale d'une évaluation finalisée : RH et Direction générale seulement.
    if voir_notes:
        ligne["note_finale"] = note
    return ligne


def _donnees(db: Session, ids: list[int], debut: date, fin: date):
    pointages, anomalies, demandes = {}, {}, {}
    if not ids:
        return pointages, anomalies, demandes
    for p in db.scalars(select(Pointage).where(Pointage.employe_id.in_(ids), Pointage.date_jour.between(debut, fin))):
        pointages.setdefault(p.employe_id, []).append(p)
    for a in db.scalars(select(Anomalie).where(Anomalie.employe_id.in_(ids), Anomalie.date_jour.between(debut, fin))):
        anomalies.setdefault(a.employe_id, []).append(a)
    for d in db.scalars(select(Demande).where(Demande.employe_id.in_(ids), Demande.date_debut <= fin,
                                              Demande.date_fin >= debut)):
        demandes.setdefault(d.employe_id, []).append(d)
    return pointages, anomalies, demandes


@router.get("/equipe", summary="Tableau de bord de l'équipe (ligne hiérarchique)")
def equipe(mois: str | None = None, departement: str | None = None, niveau: str | None = None,
           db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    debut, fin = _mois(mois)
    employes = _employes(db, utilisateur)
    if departement:
        employes = [e for e in employes if e.departement and e.departement.nom == departement]
    if niveau:
        employes = [e for e in employes if (e.niveau or "collaborateur") == niveau]
    ids = [e.id for e in employes]
    pointages, anomalies, demandes = _donnees(db, ids, debut, fin)
    grades = {d.employe_id: d.grade for d in db.scalars(select(DossierEmploye).where(DossierEmploye.employe_id.in_(ids or [-1])))}
    voir_notes = hierarchie.voit_tout(utilisateur)
    lignes = [_ligne(db, e, debut, fin, pointages.get(e.id, []), anomalies.get(e.id, []), demandes.get(e.id, []),
                     grades.get(e.id), voir_notes) for e in employes]

    jours_theoriques = sum(l["jours_ouvres"] for l in lignes)
    jours_absence = sum(l["absences"][k] for l in lignes for k in ("maladie", "sans_solde", "suspension", "injustifiee"))
    situations = {}
    for l in lignes:
        if l["aujourdhui"]:
            situations[l["aujourdhui"]] = situations.get(l["aujourdhui"], 0) + 1
    tous = hierarchie.perimetre_ids(db, utilisateur)
    return {
        "mois": debut.strftime("%Y-%m"),
        "portee": "entreprise" if voir_notes else "ligne",
        "notes_visibles": voir_notes,
        "effectif": len(lignes),
        "aujourdhui": situations,
        "indicateurs": {
            "heures_travaillees": round(sum(l["heures_travaillees"] for l in lignes), 1),
            "heures_prevues": round(sum(l["heures_prevues"] for l in lignes), 1),
            "retards": sum(l["retards"] for l in lignes),
            "retard_minutes": sum(l["retard_minutes"] for l in lignes),
            "anomalies_ouvertes": sum(l["anomalies_ouvertes"] for l in lignes),
            "demandes_en_attente": sum(l["demandes_en_attente"] for l in lignes),
            "taux_absenteisme": round(100 * jours_absence / jours_theoriques, 2) if jours_theoriques else 0,
            "objectifs_valides": sum(1 for l in lignes if l["objectifs"] == "validee"),
            "evaluations_finalisees": sum(1 for l in lignes if l["evaluation"] == "finalisee"),
        },
        "absences": {LIBELLES_FAMILLES[k]: round(sum(l["absences"][k] for l in lignes), 1) for k in LIBELLES_FAMILLES},
        "filtres": {
            "departements": sorted({e.departement.nom for e in db.scalars(select(Employe).where(Employe.id.in_(tous or {-1})))
                                    if e.departement}),
            "niveaux": [{"code": c, "libelle": l} for c, l in hierarchie.NIVEAUX],
        },
        "lignes": lignes,
    }


@router.get("/collaborateur/{matricule}", summary="Détail du mois pour un collaborateur de la ligne")
def collaborateur(matricule: str, mois: str | None = None, db: Session = Depends(get_db),
                  utilisateur: Employe = Depends(utilisateur_courant)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    if not hierarchie.peut_consulter(db, utilisateur, e):
        raise HTTPException(status_code=403, detail="Ce collaborateur n'est pas dans votre périmètre.")
    debut, fin = _mois(mois)
    pointages, anomalies, demandes = _donnees(db, [e.id], debut, fin)
    dossier = db.get(DossierEmploye, e.id)
    ligne = _ligne(db, e, debut, fin, pointages.get(e.id, []), anomalies.get(e.id, []), demandes.get(e.id, []),
                   dossier.grade if dossier else None, hierarchie.voit_tout(utilisateur))
    fmt = lambda h: h.strftime("%H:%M") if h else None  # noqa: E731
    from app.models import TYPES_AUTORISATION, TYPES_CONGE, TYPES_MISSION

    libelles = {TypeDemande.CONGE: {t["code"]: t["libelle"] for t in TYPES_CONGE},
                TypeDemande.AUTORISATION: {t["code"]: t["libelle"] for t in TYPES_AUTORISATION},
                TypeDemande.MISSION: {t["code"]: t["libelle"] for t in TYPES_MISSION}}
    return {
        **ligne,
        "pointages": [{"jour": p.date_jour, "entree1": fmt(p.entree1), "sortie1": fmt(p.sortie1), "entree2": fmt(p.entree2),
                       "sortie2": fmt(p.sortie2), "heures": p.heures_travaillees, "retard": p.retard_minutes,
                       "code": p.code_presence.value} for p in sorted(pointages.get(e.id, []), key=lambda p: p.date_jour)],
        "anomalies": [{"jour": a.date_jour, "type": a.type_anomalie.value, "detail": a.detail, "statut": a.statut.value}
                      for a in sorted(anomalies.get(e.id, []), key=lambda a: a.date_jour)],
        "demandes": [{"reference": d.reference, "type": d.type_demande.value,
                      "libelle": libelles[d.type_demande].get(d.sous_type, d.sous_type), "du": d.date_debut, "au": d.date_fin,
                      "jours": d.nombre_jours, "heures": d.duree_heures, "statut": d.statut.value}
                     for d in sorted(demandes.get(e.id, []), key=lambda d: d.date_debut)],
    }
