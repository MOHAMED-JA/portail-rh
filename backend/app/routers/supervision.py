"""Tableau de supervision réservé à l'administrateur RH."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import administrateur_requis
from app.models import Employe, EtatTache, IncidentTechnique, JournalAudit
from app.services import secours, supervision

router = APIRouter(prefix="/api/supervision", tags=["Supervision"])


def _date(valeur):
    return valeur.isoformat() if valeur else None


@router.get("", summary="Erreurs, tâches automatiques et état des sauvegardes")
def tableau(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    taches = list(db.scalars(select(EtatTache).order_by(EtatTache.nom)))
    incidents = list(db.scalars(select(IncidentTechnique).order_by(
        IncidentTechnique.resolu_le.is_not(None), IncidentTechnique.derniere_le.desc()).limit(100)))
    return {
        "genere_le": datetime.utcnow().isoformat(),
        "taches": [{
            "nom": t.nom, "statut": t.statut, "derniere_execution": _date(t.derniere_execution),
            "dernier_succes": _date(t.dernier_succes), "dernier_echec": _date(t.dernier_echec),
            "duree_ms": t.duree_ms, "detail": t.detail, "executions": t.executions, "echecs": t.echecs,
        } for t in taches],
        "incidents": [{
            "id": i.id, "source": i.source, "type_erreur": i.type_erreur, "message": i.message,
            "occurrences": i.occurrences, "premiere_le": _date(i.premiere_le), "derniere_le": _date(i.derniere_le),
            "resolu_le": _date(i.resolu_le),
        } for i in incidents],
        "incidents_ouverts": sum(1 for i in incidents if not i.resolu_le),
        "sauvegardes": supervision.etat_sauvegardes(),
        "secours": secours.etat(),
    }


@router.post("/incidents/{incident_id}/resoudre", summary="Classer un incident comme résolu")
def resoudre(incident_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    incident = db.get(IncidentTechnique, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident introuvable.")
    incident.resolu_le = datetime.utcnow()
    incident.resolu_par_id = utilisateur.id
    db.add(JournalAudit(acteur_id=utilisateur.id, action="incident_resolu", cible=str(incident.id),
                        detail=f"{incident.source} — {incident.type_erreur}"))
    db.commit()
    return {"statut": "resolu", "id": incident.id, "resolu_le": incident.resolu_le}


@router.post("/sauvegardes/controler", summary="Vérifier l'intégrité des sauvegardes SQLite")
def controler_sauvegardes(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    resultat = supervision.etat_sauvegardes()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="controle_sauvegardes",
                        cible=resultat["statut"], detail=f"Mode {resultat['mode']}"))
    db.commit()
    return resultat


@router.post("/secours", summary="Créer une copie de secours hors OneDrive et la restaurer à blanc")
def copie_de_secours(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    if secours.base_sqlite() is None:
        raise HTTPException(status_code=409, detail="Base PostgreSQL : la copie de secours relève de la DSI.")
    try:
        rapport = secours.sauvegarder_et_controler()
    except OSError as erreur:
        supervision.enregistrer_erreur("copie_de_secours", erreur)
        raise HTTPException(status_code=500, detail=f"Copie de secours impossible : {erreur}") from erreur
    db.add(JournalAudit(acteur_id=utilisateur.id, action="copie_de_secours",
                        cible=rapport["archive"], detail=f"Test de restauration : {rapport['statut']}"))
    db.commit()
    return {**secours.etat(), "rapport": rapport}
