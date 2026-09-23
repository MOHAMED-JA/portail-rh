"""Analyses RH : indice de Bradford, indicateur de risque de départ par
service, charge en période de congés.

Ce sont des indicateurs d'alerte, pas des jugements : ils servent à ouvrir
un échange, jamais à décider seuls. Détail nominatif du Bradford et du risque
de départ : RH uniquement ; agrégats par direction : RH et Direction générale ;
charge en période de congés : supérieurs (leur ligne), RH et Direction générale."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import (
    ROLES_RH, Anomalie, Candidature, CandidatureExterne, Demande, Employe, FicheEvaluation, InscriptionFormation,
    OffreInterne, PosteCle, SoldeConge,
    StatutAnomalie, StatutDemande, StatutEmploye, TypeAnomalie, TypeDemande,
)
from app.services import hierarchie
from app.services.calendrier import compter_jours_conge, est_ouvre, jours_ouvres

router = APIRouter(prefix="/api/analyses", tags=["Analyses RH"])

ABSENCES_BRADFORD = ("maladie", "prenatal")
# Repères usuels de l'indice de Bradford, à adapter par la RH.
SEUILS_BRADFORD = [(400, "tres_eleve", "Très élevé"), (125, "eleve", "Élevé"), (50, "surveiller", "À surveiller"), (0, "faible", "Faible")]


def _actifs(db: Session, ids: set[int] | None = None) -> list[Employe]:
    requete = select(Employe).where(Employe.statut != StatutEmploye.SORTI)
    if ids is not None:
        requete = requete.where(Employe.id.in_(ids or {-1}))
    return list(db.scalars(requete.order_by(Employe.nom, Employe.prenom)))


def _direction(e: Employe) -> str:
    return e.departement.nom if e.departement else "Non affecté"


# ------------------------------------------------------------------ Bradford
def episodes_absence(db: Session, e: Employe, debut: date, fin: date) -> list[tuple[date, date, float]]:
    """Épisodes d'absence non planifiée : congés maladie approuvés et absences
    injustifiées (jours consécutifs fusionnés en un seul épisode)."""
    episodes = []
    for d in db.scalars(select(Demande).where(Demande.employe_id == e.id, Demande.statut == StatutDemande.APPROUVEE,
                                              Demande.type_demande == TypeDemande.CONGE, Demande.sous_type.in_(ABSENCES_BRADFORD),
                                              Demande.date_fin >= debut, Demande.date_debut <= fin)):
        a, b = max(d.date_debut, debut), min(d.date_fin, fin)
        episodes.append((a, b, compter_jours_conge(a, b) or 1))
    jours = sorted({x.date_jour for x in db.scalars(select(Anomalie).where(
        Anomalie.employe_id == e.id, Anomalie.type_anomalie == TypeAnomalie.ABSENCE_NON_JUSTIFIEE,
        Anomalie.statut != StatutAnomalie.JUSTIFIEE, Anomalie.date_jour.between(debut, fin)))})
    courant = None
    for j in jours:
        if courant and (j - courant[1]).days <= 3 and all(not est_ouvre(courant[1] + timedelta(days=k)) for k in range(1, (j - courant[1]).days)):
            courant = (courant[0], j, courant[2] + 1)
        else:
            if courant:
                episodes.append(courant)
            courant = (j, j, 1)
    if courant:
        episodes.append(courant)
    return episodes


def bradford(db: Session, e: Employe, fin: date | None = None) -> dict:
    fin = fin or date.today()
    debut = fin - timedelta(weeks=52)
    ep = episodes_absence(db, e, debut, fin)
    s, d = len(ep), sum(x[2] for x in ep)
    indice = s * s * d
    niveau, libelle = next((n, l) for seuil, n, l in SEUILS_BRADFORD if indice >= seuil)
    return {"episodes": s, "jours": d, "indice": round(indice), "niveau": niveau, "niveau_libelle": libelle}


@router.get("/bradford", summary="Indice de Bradford (52 semaines) — détail RH, agrégats RH et DG")
def indice_bradford(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    rh = utilisateur.role in ROLES_RH
    lignes, par_direction = [], {}
    for e in _actifs(db):
        b = bradford(db, e)
        agg = par_direction.setdefault(_direction(e), {"direction": _direction(e), "effectif": 0, "episodes": 0, "jours": 0, "a_surveiller": 0})
        agg["effectif"] += 1
        agg["episodes"] += b["episodes"]
        agg["jours"] += b["jours"]
        agg["a_surveiller"] += b["niveau"] != "faible"
        if rh and b["episodes"]:
            lignes.append({"employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                                       "direction": _direction(e)}, **b})
    lignes.sort(key=lambda l: -l["indice"])
    return {"seuils": [{"seuil": s, "niveau": n, "libelle": l} for s, n, l in SEUILS_BRADFORD],
            "par_direction": sorted(par_direction.values(), key=lambda a: -a["a_surveiller"]),
            "collaborateurs": lignes if rh else None}


# ------------------------------------------------------------------ Risque de départ
FACTEURS = {
    "anciennete": (15, "Moins de 2 ans d'ancienneté"),
    "mobilite": (20, "Souhait de mobilité exprimé"),
    "candidature": (10, "Candidature interne en cours"),
    "absences": (15, "Absences non planifiées en hausse (Bradford)"),
    "evaluation": (15, "Dernière évaluation inférieure à 10/20"),
    "formation": (10, "Aucune formation depuis 12 mois"),
    "conges": (15, "Plus de 30 jours de congés non pris"),
}


def risque_depart(db: Session, e: Employe) -> dict:
    aujourd_hui = date.today()
    motifs = []
    if e.date_entree and (aujourd_hui - e.date_entree).days < 730:
        motifs.append("anciennete")
    ev = db.scalar(select(FicheEvaluation).where(FicheEvaluation.employe_id == e.id).order_by(FicheEvaluation.annee.desc()).limit(1))
    if ev and ev.mobilite_type in ("interne", "fonctionnelle", "geographique"):
        motifs.append("mobilite")
    if ev and ev.finalisee_le and ev.note_finale is not None and ev.note_finale < 10:
        motifs.append("evaluation")
    if db.scalar(select(Candidature.id).where(Candidature.employe_id == e.id, Candidature.statut.in_(["deposee", "etudiee", "entretien"])).limit(1)):
        motifs.append("candidature")
    if bradford(db, e)["niveau"] in ("eleve", "tres_eleve"):
        motifs.append("absences")
    if not db.scalar(select(InscriptionFormation.id).where(InscriptionFormation.employe_id == e.id,
                                                           InscriptionFormation.inscrit_le >= aujourd_hui - timedelta(days=365)).limit(1)):
        motifs.append("formation")
    solde = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == e.id, SoldeConge.annee == aujourd_hui.year))
    if solde and solde.jours_restants > 30:
        motifs.append("conges")
    score = min(100, sum(FACTEURS[m][0] for m in motifs))
    niveau = "eleve" if score >= 45 else "moyen" if score >= 25 else "faible"
    return {"score": score, "niveau": niveau, "motifs": [FACTEURS[m][1] for m in motifs]}


@router.get("/risque-depart", summary="Indicateur de risque de départ — détail RH, agrégats RH et DG")
def indicateur_depart(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    rh = utilisateur.role in ROLES_RH
    from app.routers.talents import _retraite

    lignes, par_direction, retraites = [], {}, []
    for e in _actifs(db):
        r = risque_depart(db, e)
        agg = par_direction.setdefault(_direction(e), {"direction": _direction(e), "effectif": 0, "score_moyen": 0, "eleve": 0, "moyen": 0})
        agg["effectif"] += 1
        agg["score_moyen"] += r["score"]
        agg[r["niveau"]] = agg.get(r["niveau"], 0) + 1
        if rh and r["niveau"] != "faible":
            lignes.append({"employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                                       "direction": _direction(e)}, **r})
        d = _retraite(db, e)
        if d and d <= date.today() + timedelta(days=365):
            retraites.append({"employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                                          "direction": _direction(e)}, "date": d})
    for a in par_direction.values():
        a["score_moyen"] = round(a["score_moyen"] / a["effectif"])
    return {"facteurs": [{"poids": p, "libelle": l} for p, l in FACTEURS.values()],
            "par_direction": sorted(par_direction.values(), key=lambda a: (-a["eleve"], -a["score_moyen"])),
            "collaborateurs": sorted(lignes, key=lambda l: -l["score"]) if rh else None,
            "retraites_12_mois": sorted(retraites, key=lambda r: r["date"])}


@router.get("/planification-effectifs", summary="Pilotage prévisionnel des effectifs (RH et Direction générale)")
def planification_effectifs(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    """Synthèse d'anticipation ; elle ne contient pas d'indicateur individuel de risque."""
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    from app.routers.talents import _poste_json, _retraite

    horizon = date.today() + timedelta(days=365)
    retraites, par_direction = [], {}
    for e in _actifs(db):
        direction = _direction(e)
        agregat = par_direction.setdefault(direction, {"direction": direction, "effectif": 0, "retraites_12_mois": 0})
        agregat["effectif"] += 1
        retraite = _retraite(db, e)
        if retraite and date.today() <= retraite <= horizon:
            agregat["retraites_12_mois"] += 1
            retraites.append({"employe": f"{e.prenom} {e.nom}", "poste": e.poste, "direction": direction, "date": retraite})
    postes = [_poste_json(db, p) for p in db.scalars(select(PosteCle))]
    critiques = [p for p in postes if p["risque"] == "eleve"]
    offres = db.scalars(select(OffreInterne).where(OffreInterne.publication == "externe", OffreInterne.statut == "ouverte")).all()
    candidatures = [c for c in db.scalars(select(CandidatureExterne)) if c.statut in ("deposee", "etudiee", "entretien", "retenue")]
    return {"effectif": sum(x["effectif"] for x in par_direction.values()),
            "retraites_12_mois": sorted(retraites, key=lambda r: r["date"]),
            "postes_cles_critiques": sorted(critiques, key=lambda p: (-p["criticite"], p["intitule"])),
            "recrutement_externe": {"offres_ouvertes": len(offres), "candidatures_en_cours": len(candidatures)},
            "par_direction": sorted(par_direction.values(), key=lambda x: (-x["retraites_12_mois"], -x["effectif"]))}


# ------------------------------------------------------------------ Charge en période de congés
@router.get("/charge-conges", summary="Absents prévus et taux de présence des 12 prochaines semaines")
def charge_conges(semaines: int = 12, seuil: int = 70, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    ids = hierarchie.perimetre_ids(db, utilisateur)
    if not ids:
        raise HTTPException(status_code=403, detail="Aucun collaborateur dans votre périmètre.")
    employes = _actifs(db, ids)
    semaines = max(1, min(semaines, 26))
    lundi = date.today() - timedelta(days=date.today().weekday())
    fin = lundi + timedelta(weeks=semaines) - timedelta(days=1)
    demandes = db.scalars(select(Demande).where(Demande.employe_id.in_([e.id for e in employes] or [-1]),
                                                Demande.statut.in_([StatutDemande.APPROUVEE, StatutDemande.EN_ATTENTE]),
                                                Demande.type_demande.in_([TypeDemande.CONGE, TypeDemande.MISSION]),
                                                Demande.date_fin >= lundi, Demande.date_debut <= fin)).all()
    directions = sorted({_direction(e) for e in employes})
    par_id = {e.id: e for e in employes}
    resultats = []
    for n in range(semaines):
        debut_s = lundi + timedelta(weeks=n)
        ouvres = jours_ouvres(debut_s, debut_s + timedelta(days=4))
        ligne = {"semaine": debut_s, "jours_ouvres": len(ouvres), "directions": {}}
        for dir_ in directions:
            membres = [e for e in employes if _direction(e) == dir_]
            absents_confirmes, absents_prevus, jours_absence = set(), set(), 0
            for d in demandes:
                e = par_id.get(d.employe_id)
                if not e or _direction(e) != dir_:
                    continue
                jours = sum(1 for j in ouvres if d.date_debut <= j <= d.date_fin)
                if jours:
                    jours_absence += jours
                    (absents_confirmes if d.statut == StatutDemande.APPROUVEE else absents_prevus).add(e.id)
            capacite = len(membres) * len(ouvres)
            presence = round(100 * (capacite - jours_absence) / capacite) if capacite else 100
            ligne["directions"][dir_] = {"effectif": len(membres), "absents": len(absents_confirmes),
                                         "en_attente": len(absents_prevus - absents_confirmes), "presence": presence,
                                         "alerte": presence < seuil}
        resultats.append(ligne)
    # Congés restant à poser d'ici au 31 décembre.
    restants = {}
    ouvres_restants = len(jours_ouvres(date.today(), date(date.today().year, 12, 31)))
    for e in employes:
        s = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == e.id, SoldeConge.annee == date.today().year))
        r = restants.setdefault(_direction(e), {"direction": _direction(e), "jours": 0.0, "effectif": 0})
        r["jours"] += max(0.0, s.jours_restants) if s else 0
        r["effectif"] += 1
    for r in restants.values():
        r["jours"] = round(r["jours"], 1)
        # Part de la capacité restante de l'année que représenteraient ces congés.
        r["part_capacite"] = round(100 * r["jours"] / (r["effectif"] * ouvres_restants)) if ouvres_restants else None
    return {"seuil": seuil, "directions": directions, "semaines": resultats,
            "restant_a_poser": sorted(restants.values(), key=lambda r: -(r["part_capacite"] or 0)),
            "jours_ouvres_restants": ouvres_restants}
