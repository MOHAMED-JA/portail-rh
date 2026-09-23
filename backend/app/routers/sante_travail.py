"""Accidents du travail, de trajet et maladies professionnelles : déclaration,
transmission à la CNAM, suivi médical, reprise ; statistiques.

Accès : RH et intéressé (tout) ; ligne hiérarchique (faits et dates, sans les
données médicales) ; Direction générale (statistiques)."""
from __future__ import annotations

import shutil
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis, utilisateur_courant
from app.models import ROLES_RH, AccidentTravail, Employe, JournalAudit, Pointage, StatutEmploye, SuiviAccident
from app.services import hierarchie, parametres
from app.services.calendrier import est_ouvre
from app.services.demandes import administrateurs_rh
from app.services.notifications import notifier

router = APIRouter(prefix="/api/sante-travail", tags=["Accidents du travail"])

TYPES = {"travail": "Accident du travail", "trajet": "Accident de trajet", "maladie_professionnelle": "Maladie professionnelle"}
TYPES_SUIVI = {"certificat_initial": "Certificat médical initial", "prolongation": "Prolongation d'arrêt",
               "visite_reprise": "Visite de reprise", "consolidation": "Consolidation / guérison", "autre": "Autre"}
STATUTS = {"declare": "Déclaré — à transmettre", "transmis": "Transmis à la CNAM", "clos": "Clos"}


def delai_declaration(db: Session) -> int:
    """Jours ouvrables pour transmettre la déclaration (par défaut 2 ; à faire
    valider par la direction juridique)."""
    return int(parametres.lire(db, "delai_declaration_at", 2) or 2)


def _echeance(debut: date, jours_ouvrables: int) -> date:
    jour, restants = debut, jours_ouvrables
    while restants > 0:
        jour += timedelta(days=1)
        if est_ouvre(jour):
            restants -= 1
    return jour


def _acces(db: Session, u: Employe, a: AccidentTravail) -> str:
    """complet (RH, intéressé) · ligne (supérieurs, sans médical) · refus."""
    if u.role in ROLES_RH or u.id == a.employe_id:
        return "complet"
    if hierarchie.peut_consulter(db, u, a.employe) and not hierarchie.est_direction_generale(u):
        return "ligne"
    raise HTTPException(status_code=403, detail="Déclaration hors de votre périmètre.")


def _json(db: Session, a: AccidentTravail, acces: str) -> dict:
    echeance = _echeance(a.declare_le.date(), delai_declaration(db))
    jours_arret = ((a.fin_arret or a.date_reprise or date.today()) - a.debut_arret).days + 1 if a.arret and a.debut_arret else 0
    r = {"id": a.id, "type": a.type_accident, "type_libelle": TYPES[a.type_accident],
         "employe": {"matricule": a.employe.matricule, "nom": a.employe.nom, "prenom": a.employe.prenom, "poste": a.employe.poste},
         "date_accident": a.date_accident, "heure": a.heure.strftime("%H:%M") if a.heure else None, "lieu": a.lieu,
         "circonstances": a.circonstances, "temoins": a.temoins, "arret": a.arret, "debut_arret": a.debut_arret,
         "fin_arret": a.fin_arret, "date_reprise": a.date_reprise, "jours_arret": jours_arret, "statut": a.statut,
         "statut_libelle": STATUTS[a.statut], "reference_cnam": a.reference_cnam, "transmis_le": a.transmis_le,
         "declare_le": a.declare_le, "declare_par": f"{a.declare_par.prenom} {a.declare_par.nom}" if a.declare_par else None,
         "echeance_transmission": echeance, "en_retard": a.statut == "declare" and date.today() > echeance,
         "acces": acces}
    if acces == "complet":
        r["lesions"] = a.lesions
        r["suivis"] = [{"id": s.id, "date": s.date_suivi, "type": s.type_suivi, "type_libelle": TYPES_SUIVI[s.type_suivi],
                        "jours_arret": s.jours_arret, "commentaire": s.commentaire, "piece_jointe": s.piece_jointe} for s in a.suivis]
    return r


class DeclarationPayload(BaseModel):
    matricule: str | None = None           # absent : déclaration pour soi-même
    type_accident: str = Field(pattern="^(travail|trajet|maladie_professionnelle)$")
    date_accident: date
    heure: time | None = None
    lieu: str | None = Field(default=None, max_length=160)
    circonstances: str = Field(min_length=5, max_length=4000)
    temoins: str | None = Field(default=None, max_length=1000)
    lesions: str | None = Field(default=None, max_length=2000)
    arret: bool = False
    debut_arret: date | None = None
    fin_arret: date | None = None


@router.post("/accidents", status_code=201, summary="Déclarer un accident (intéressé, supérieur ou RH)")
def declarer(payload: DeclarationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    victime = utilisateur
    if payload.matricule and payload.matricule.strip().upper() != utilisateur.matricule:
        victime = db.scalar(select(Employe).where(Employe.matricule == payload.matricule.strip().upper()))
        if not victime:
            raise HTTPException(status_code=404, detail="Collaborateur introuvable")
        if utilisateur.role not in ROLES_RH and victime.id not in hierarchie.equipe_ids(db, utilisateur.id):
            raise HTTPException(status_code=403, detail="Vous ne pouvez déclarer que pour vous-même ou votre équipe.")
    if payload.date_accident > date.today():
        raise HTTPException(status_code=422, detail="La date de l'accident ne peut pas être dans le futur.")
    if payload.arret and not payload.debut_arret:
        raise HTTPException(status_code=422, detail="Indiquez la date de début de l'arrêt de travail.")
    a = AccidentTravail(employe_id=victime.id, declare_par_id=utilisateur.id,
                        **payload.model_dump(exclude={"matricule"}))
    db.add(a)
    db.flush()
    delai = delai_declaration(db)
    for rh in administrateurs_rh(db, sauf=utilisateur.id):
        notifier(db, rh.id, f"{TYPES[a.type_accident]} déclaré",
                 f"{victime.prenom} {victime.nom} — {a.date_accident:%d/%m/%Y}. Transmission à la CNAM sous {delai} jour(s) ouvrable(s).",
                 "alerte", "/sante-travail")
    chef = hierarchie.superieur_operationnel(victime)
    if chef and chef.id != utilisateur.id:
        notifier(db, chef.id, "Accident d'un collaborateur", f"{victime.prenom} {victime.nom} — {TYPES[a.type_accident].lower()} "
                 f"du {a.date_accident:%d/%m/%Y}.", "alerte", "/sante-travail")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="accident_declare", cible=victime.matricule, detail=TYPES[a.type_accident]))
    db.commit()
    return _json(db, a, "complet" if utilisateur.role in ROLES_RH or utilisateur.id == victime.id else "ligne")


@router.get("/accidents", summary="Déclarations visibles (RH : toutes ; supérieur : sa ligne ; soi)")
def lister(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(AccidentTravail).order_by(AccidentTravail.date_accident.desc())
    if utilisateur.role not in ROLES_RH:
        ids = {utilisateur.id} if hierarchie.est_direction_generale(utilisateur) else {utilisateur.id, *hierarchie.equipe_ids(db, utilisateur.id)}
        requete = requete.where(AccidentTravail.employe_id.in_(ids))
    return [_json(db, a, _acces(db, utilisateur, a)) for a in db.scalars(requete.limit(300))]


def _charger(db: Session, accident_id: int) -> AccidentTravail:
    a = db.get(AccidentTravail, accident_id)
    if not a:
        raise HTTPException(status_code=404, detail="Déclaration introuvable")
    return a


@router.get("/accidents/{accident_id}", summary="Détail d'une déclaration")
def detail(accident_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    a = _charger(db, accident_id)
    return _json(db, a, _acces(db, utilisateur, a))


class TransmissionPayload(BaseModel):
    reference_cnam: str = Field(min_length=2, max_length=60)
    transmis_le: date | None = None


@router.post("/accidents/{accident_id}/transmettre", summary="Enregistrer la transmission à la CNAM (RH)")
def transmettre(accident_id: int, payload: TransmissionPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    a = _charger(db, accident_id)
    a.reference_cnam, a.transmis_le = payload.reference_cnam.strip(), payload.transmis_le or date.today()
    if a.statut == "declare":
        a.statut = "transmis"
    db.add(JournalAudit(acteur_id=utilisateur.id, action="accident_transmis", cible=a.employe.matricule, detail=a.reference_cnam))
    db.commit()
    return _json(db, a, "complet")


class SuiviPayload(BaseModel):
    date_suivi: date
    type_suivi: str = Field(pattern="^(certificat_initial|prolongation|visite_reprise|consolidation|autre)$")
    jours_arret: int | None = Field(default=None, ge=0, le=730)
    commentaire: str | None = Field(default=None, max_length=2000)


@router.post("/accidents/{accident_id}/suivi", summary="Ajouter un élément de suivi médical (RH)")
def suivre(accident_id: int, payload: SuiviPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    a = _charger(db, accident_id)
    a.suivis.append(SuiviAccident(saisi_par_id=utilisateur.id, **payload.model_dump()))
    # Une prolongation repousse la fin de l'arrêt.
    if payload.jours_arret and payload.type_suivi in ("certificat_initial", "prolongation"):
        a.arret = True
        a.debut_arret = a.debut_arret or payload.date_suivi
        a.fin_arret = max(a.fin_arret or payload.date_suivi, payload.date_suivi + timedelta(days=payload.jours_arret - 1))
    db.add(JournalAudit(acteur_id=utilisateur.id, action="accident_suivi", cible=a.employe.matricule, detail=TYPES_SUIVI[payload.type_suivi]))
    db.commit()
    return _json(db, a, "complet")


@router.post("/suivis/{suivi_id}/piece", summary="Joindre un certificat (PDF, DOC, DOCX) (RH)")
def joindre(suivi_id: int, fichier: UploadFile = File(...), db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = db.get(SuiviAccident, suivi_id)
    if not s:
        raise HTTPException(status_code=404, detail="Suivi introuvable")
    extension = Path(fichier.filename or "").suffix.lower()
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=415, detail="Format non compatible : PDF, DOC ou DOCX uniquement.")
    cible = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / cible).open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)
    s.piece_jointe = f"/fichiers/{cible}"
    db.commit()
    return {"piece_jointe": s.piece_jointe}


class ReprisePayload(BaseModel):
    date_reprise: date


@router.post("/accidents/{accident_id}/cloturer", summary="Reprise du travail : clore le dossier (RH)")
def cloturer(accident_id: int, payload: ReprisePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    a = _charger(db, accident_id)
    if payload.date_reprise < a.date_accident:
        raise HTTPException(status_code=422, detail="La reprise ne peut pas précéder l'accident.")
    a.date_reprise, a.statut = payload.date_reprise, "clos"
    if a.arret and (not a.fin_arret or a.fin_arret >= payload.date_reprise):
        a.fin_arret = payload.date_reprise - timedelta(days=1)
    notifier(db, a.employe_id, "Dossier d'accident clos", f"Reprise enregistrée le {payload.date_reprise:%d/%m/%Y}.", "info", "/sante-travail")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="accident_clos", cible=a.employe.matricule))
    db.commit()
    return _json(db, a, "complet")


@router.get("/statistiques", summary="Statistiques accidents du travail (RH, Direction générale)")
def statistiques(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not hierarchie.voit_tout(utilisateur):
        raise HTTPException(status_code=403, detail="Réservé à la RH et à la Direction générale.")
    annee = annee or date.today().year
    debut, fin = date(annee, 1, 1), date(annee, 12, 31)
    accidents = db.scalars(select(AccidentTravail).where(AccidentTravail.date_accident.between(debut, fin))).all()
    jours = 0
    for a in accidents:
        if a.arret and a.debut_arret:
            jours += ((min(a.fin_arret or date.today(), fin)) - max(a.debut_arret, debut)).days + 1
    heures = db.scalar(select(func.sum(Pointage.heures_travaillees)).where(Pointage.date_jour.between(debut, fin))) or 0
    avec_arret = sum(1 for a in accidents if a.arret)
    effectif = db.scalar(select(func.count(Employe.id)).where(Employe.statut != StatutEmploye.SORTI)) or 0
    return {
        "annee": annee, "accidents": len(accidents), "avec_arret": avec_arret, "jours_arret": jours,
        "par_type": {TYPES[t]: sum(1 for a in accidents if a.type_accident == t) for t in TYPES},
        "en_retard": sum(1 for a in accidents if _json(db, a, "ligne")["en_retard"]),
        "heures_travaillees": round(heures),
        # Taux de fréquence (accidents avec arrêt par million d'heures) et de
        # gravité (jours perdus par millier d'heures) : calculés sur les heures pointées.
        # Non significatifs tant que les pointages couvrent moins de 1 000 heures.
        "taux_frequence": round(avec_arret * 1_000_000 / heures, 2) if heures >= 1000 else None,
        "taux_gravite": round(jours * 1000 / heures, 2) if heures >= 1000 else None,
        "effectif": effectif, "delai_declaration": delai_declaration(db),
    }


class DelaiPayload(BaseModel):
    jours_ouvrables: int = Field(ge=1, le=30)


@router.put("/delai", summary="Délai de transmission à la CNAM, en jours ouvrables (administrateur)")
def modifier_delai(payload: DelaiPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    parametres.ecrire(db, "delai_declaration_at", payload.jours_ouvrables)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="delai_declaration_at", cible=str(payload.jours_ouvrables)))
    db.commit()
    return {"delai": payload.jours_ouvrables}
