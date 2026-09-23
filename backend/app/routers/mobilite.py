"""Offres de postes en interne et candidatures, reliées aux souhaits de
mobilité exprimés lors de l'entretien annuel.

Confidentialité : une candidature n'est visible que du candidat et de la RH ;
le supérieur hiérarchique est informé lorsque le candidat est convoqué en
entretien."""
from __future__ import annotations

from datetime import date, datetime

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import DATA_DIR, EXTENSIONS_AUTORISEES
from app.core.security import admin_requis, hash_password, utilisateur_courant
from app.models import (
    AffectationEmploi, Candidature, CandidatureExterne, Departement, DossierEmploye, Emploi, Employe,
    EvaluationCompetence, FicheEvaluation, JournalAudit, OffreInterne, ROLES_RH, Role, SoldeConge, StatutEmploye,
)
from app.services import hierarchie
from app.services.demandes import administrateurs_rh
from app.services.notifications import notifier

router = APIRouter(prefix="/api/mobilite", tags=["Offres internes et mobilité"])

STATUTS_CANDIDATURE = {"deposee": "Déposée", "etudiee": "À l'étude", "entretien": "Convoqué(e) en entretien",
                       "retenue": "Retenue", "non_retenue": "Non retenue", "retiree": "Retirée", "integree": "Intégrée"}
MOBILITES = {"interne": "Mobilité interne", "fonctionnelle": "Mobilité fonctionnelle", "geographique": "Mobilité géographique"}


def adequation(db: Session, employe: Employe, emploi: Emploi | None) -> int | None:
    """Part des compétences requises par l'emploi visé que le candidat maîtrise
    au niveau attendu (évaluations de son supérieur)."""
    if not emploi or not emploi.exigences:
        return None
    niveaux = {e.competence_id: e.niveau for e in db.scalars(
        select(EvaluationCompetence).where(EvaluationCompetence.employe_id == employe.id))}
    atteintes = sum(1 for x in emploi.exigences if niveaux.get(x.competence_id, 0) >= x.niveau_requis)
    return round(100 * atteintes / len(emploi.exigences))


def _ouverte(o: OffreInterne) -> bool:
    return o.statut == "ouverte" and o.date_limite >= date.today()


def _offre_json(o: OffreInterne, utilisateur: Employe | None = None, rh: bool = False) -> dict:
    ma = next((c for c in o.candidatures if utilisateur and c.employe_id == utilisateur.id), None)
    resultat = {
        "id": o.id, "intitule": o.intitule, "direction": o.departement.nom if o.departement else None,
        "emploi": {"id": o.emploi.id, "intitule": o.emploi.intitule} if o.emploi else None, "lieu": o.lieu,
        "description": o.description, "profil": o.profil, "date_limite": o.date_limite, "statut": o.statut,
        "publication": o.publication,
        "ouverte": _ouverte(o), "publiee_le": o.cree_le,
        "ma_candidature": {"id": ma.id, "statut": ma.statut, "statut_libelle": STATUTS_CANDIDATURE[ma.statut]} if ma else None,
    }
    if rh:
        resultat["candidatures"] = sum(1 for c in o.candidatures if c.statut != "retiree")
        resultat["candidatures_externes"] = sum(1 for c in o.candidatures_externes if c.statut != "retiree")
    return resultat


# ------------------------------------------------------------------ Offres
class OffrePayload(BaseModel):
    intitule: str = Field(min_length=3, max_length=160)
    departement_id: int | None = None
    emploi_id: int | None = None
    lieu: str | None = None
    description: str = Field(min_length=10)
    profil: str | None = None
    date_limite: date
    publication: str = Field(default="interne", pattern="^(interne|externe)$")


@router.get("/offres", summary="Offres de postes en interne")
def offres(toutes: bool = False, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    rh = utilisateur.role in ROLES_RH
    liste = db.scalars(select(OffreInterne).order_by(OffreInterne.cree_le.desc())).all()
    if not (rh and toutes):
        liste = [o for o in liste if o.publication == "interne" and (_ouverte(o) or any(c.employe_id == utilisateur.id for c in o.candidatures))]
    return [_offre_json(o, utilisateur, rh) for o in liste]


@router.post("/offres", status_code=201, summary="Publier une offre (RH)")
def publier(payload: OffrePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    if payload.date_limite < date.today():
        raise HTTPException(status_code=422, detail="La date limite de candidature est déjà passée.")
    if payload.departement_id and not db.get(Departement, payload.departement_id):
        raise HTTPException(status_code=404, detail="Direction introuvable")
    if payload.emploi_id and not db.get(Emploi, payload.emploi_id):
        raise HTTPException(status_code=404, detail="Emploi introuvable")
    o = OffreInterne(**payload.model_dump(), cree_par_id=utilisateur.id)
    db.add(o)
    db.flush()
    # Les collaborateurs qui ont exprimé un souhait de mobilité sont prévenus.
    interesses = set(db.scalars(select(FicheEvaluation.employe_id).where(
        FicheEvaluation.annee.in_([date.today().year, date.today().year - 1]),
        FicheEvaluation.mobilite_type.in_(list(MOBILITES)))))
    for identifiant in interesses:
        e = db.get(Employe, identifiant)
        if e and e.statut != StatutEmploye.SORTI:
            notifier(db, identifiant, "Offre interne : " + o.intitule,
                     f"Vous avez exprimé un souhait de mobilité : cette offre peut vous intéresser (candidature jusqu'au "
                     f"{o.date_limite:%d/%m/%Y}).", "info", "/mobilite")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="offre_publiee", cible=o.intitule,
                        detail=f"{len(interesses)} collaborateur(s) prévenu(s)"))
    db.commit()
    return {**_offre_json(o, utilisateur, True), "prevenus": len(interesses)}


@router.post("/offres/{offre_id}/cloturer", summary="Clôturer une offre (RH)")
def cloturer(offre_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    o = db.get(OffreInterne, offre_id)
    if not o:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    retenue = any(c.statut == "retenue" for c in o.candidatures)
    o.statut = "pourvue" if retenue else "cloturee"
    for c in o.candidatures:
        if c.statut in ("deposee", "etudiee", "entretien"):
            c.statut = "non_retenue"
            notifier(db, c.employe_id, "Candidature : " + o.intitule,
                     "L'offre est clôturée ; votre candidature n'a pas été retenue. Merci de votre intérêt.", "info", "/mobilite")
    db.add(JournalAudit(acteur_id=utilisateur.id, action=f"offre_{o.statut}", cible=o.intitule))
    db.commit()
    return _offre_json(o, utilisateur, True)


# ------------------------------------------------------------------ Candidatures
class CandidaturePayload(BaseModel):
    motivation: str | None = Field(default=None, max_length=3000)


@router.post("/offres/{offre_id}/candidater", status_code=201, summary="Postuler")
def candidater(offre_id: int, payload: CandidaturePayload, db: Session = Depends(get_db),
               utilisateur: Employe = Depends(utilisateur_courant)):
    o = db.get(OffreInterne, offre_id)
    if not o or not _ouverte(o):
        raise HTTPException(status_code=409, detail="Cette offre n'accepte plus de candidatures.")
    c = next((x for x in o.candidatures if x.employe_id == utilisateur.id), None)
    if c and c.statut != "retiree":
        raise HTTPException(status_code=409, detail="Vous avez déjà postulé à cette offre.")
    if c is None:
        c = Candidature(employe_id=utilisateur.id)
        o.candidatures.append(c)
    c.statut, c.motivation = "deposee", (payload.motivation or "").strip() or None
    for rh in administrateurs_rh(db, sauf=utilisateur.id):
        notifier(db, rh.id, "Nouvelle candidature interne", f"{utilisateur.prenom} {utilisateur.nom} — {o.intitule}",
                 "validation", "/mobilite")
    db.commit()
    return _offre_json(o, utilisateur)


@router.post("/candidatures/{candidature_id}/retirer", summary="Retirer sa candidature")
def retirer(candidature_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    c = db.get(Candidature, candidature_id)
    if not c or c.employe_id != utilisateur.id:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    if c.statut not in ("deposee", "etudiee", "entretien"):
        raise HTTPException(status_code=409, detail="Cette candidature ne peut plus être retirée.")
    c.statut = "retiree"
    db.commit()
    return {"statut": "retiree"}


@router.get("/offres/{offre_id}/candidatures", summary="Candidatures d'une offre (RH)")
def candidatures(offre_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    o = db.get(OffreInterne, offre_id)
    if not o:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    lignes = []
    for c in sorted(o.candidatures, key=lambda c: c.cree_le):
        e = c.employe
        a = db.get(AffectationEmploi, e.id)
        ev = db.scalar(select(FicheEvaluation).where(FicheEvaluation.employe_id == e.id)
                       .order_by(FicheEvaluation.annee.desc()).limit(1))
        lignes.append({"id": c.id, "statut": c.statut, "statut_libelle": STATUTS_CANDIDATURE[c.statut],
                       "motivation": c.motivation, "commentaire_rh": c.commentaire_rh, "deposee_le": c.cree_le,
                       "employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                                   "direction": e.departement.nom if e.departement else None,
                                   "emploi": a.emploi.intitule if a else None},
                       "mobilite_souhaitee": MOBILITES.get(ev.mobilite_type) if ev else None,
                       "note_derniere_evaluation": ev.note_finale if ev and ev.finalisee_le else None,
                       "adequation": adequation(db, e, o.emploi)})
    return {"offre": _offre_json(o, utilisateur, True), "candidatures": lignes}


class SuiviPayload(BaseModel):
    statut: str = Field(pattern="^(etudiee|entretien|retenue|non_retenue)$")
    commentaire: str | None = Field(default=None, max_length=1000)


@router.post("/candidatures/{candidature_id}/suivi", summary="Faire avancer une candidature (RH)")
def suivre(candidature_id: int, payload: SuiviPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    c = db.get(Candidature, candidature_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    if c.statut == "retiree":
        raise HTTPException(status_code=409, detail="Candidature retirée par le collaborateur.")
    if c.employe_id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas traiter votre propre candidature.")
    c.statut = payload.statut
    c.commentaire_rh = (payload.commentaire or "").strip() or c.commentaire_rh
    o, e = c.offre, c.employe
    messages = {"etudiee": "Votre candidature est à l'étude.", "entretien": "Vous êtes convoqué(e) en entretien ; la RH vous contactera.",
                "retenue": "Félicitations : votre candidature est retenue.", "non_retenue": "Votre candidature n'a pas été retenue."}
    notifier(db, e.id, "Candidature : " + o.intitule, messages[payload.statut] + (f" {c.commentaire_rh}" if c.commentaire_rh else ""),
             "succes" if payload.statut == "retenue" else "info", "/mobilite")
    chef = hierarchie.superieur_operationnel(e)
    if payload.statut in ("entretien", "retenue") and chef:
        notifier(db, chef.id, "Mobilité interne d'un collaborateur",
                 f"{e.prenom} {e.nom} est {'convoqué(e) en entretien' if payload.statut == 'entretien' else 'retenu(e)'} "
                 f"pour le poste « {o.intitule} ».", "info", "/mobilite")
    db.add(JournalAudit(acteur_id=utilisateur.id, action=f"candidature_{payload.statut}", cible=e.matricule, detail=o.intitule))
    db.commit()
    return {"id": c.id, "statut": c.statut, "statut_libelle": STATUTS_CANDIDATURE[c.statut]}


@router.get("/souhaits", summary="Collaborateurs ayant exprimé un souhait de mobilité (RH)")
def souhaits(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    lignes = {}
    for f in db.scalars(select(FicheEvaluation).where(FicheEvaluation.mobilite_type.in_(list(MOBILITES)))
                        .order_by(FicheEvaluation.annee)):
        e = f.employe
        if e.statut == StatutEmploye.SORTI:
            continue
        lignes[e.id] = {"employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste},
                        "annee": f.annee, "mobilite": MOBILITES[f.mobilite_type], "detail": f.mobilite_detail}
    return sorted(lignes.values(), key=lambda l: (l["employe"]["nom"], l["employe"]["prenom"]))


# ------------------------------------------------------------------ Recrutement externe
def _offre_externe_json(offre: OffreInterne) -> dict:
    return {"id": offre.id, "intitule": offre.intitule, "direction": offre.departement.nom if offre.departement else None,
            "lieu": offre.lieu, "description": offre.description, "profil": offre.profil,
            "date_limite": offre.date_limite}


@router.get("/recrutement/offres", summary="Offres externes ouvertes (publication publique)")
def offres_externes_publiques(db: Session = Depends(get_db)):
    """Route volontairement limitée aux offres publiées : aucun nom de salarié ni CV."""
    offres = db.scalars(select(OffreInterne).where(OffreInterne.publication == "externe").order_by(
        OffreInterne.cree_le.desc())).all()
    return [_offre_externe_json(o) for o in offres if _ouverte(o)]


def _repertoire_cv() -> Path:
    # /fichiers expose UPLOAD_DIR sans authentification ; les CV restent dans
    # un répertoire privé et passent uniquement par la route protégée RH.
    repertoire = DATA_DIR / "cv_recrutement_prive"
    repertoire.mkdir(parents=True, exist_ok=True)
    return repertoire


@router.post("/recrutement/offres/{offre_id}/candidater", status_code=201, summary="Déposer une candidature externe")
def candidater_externe(
    offre_id: int,
    nom: str = Form(..., min_length=2, max_length=80),
    prenom: str = Form(..., min_length=2, max_length=80),
    email: str = Form(..., min_length=5, max_length=160),
    telephone: str | None = Form(default=None, max_length=30),
    motivation: str | None = Form(default=None, max_length=3000),
    cv: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    offre = db.get(OffreInterne, offre_id)
    if not offre or offre.publication != "externe" or not _ouverte(offre):
        raise HTTPException(status_code=409, detail="Cette offre n'accepte plus de candidatures externes.")
    email_normalise = email.strip().lower()
    if "@" not in email_normalise:
        raise HTTPException(status_code=422, detail="Adresse e-mail invalide.")
    if db.scalar(select(CandidatureExterne).where(CandidatureExterne.offre_id == offre.id,
                                                   CandidatureExterne.email == email_normalise)):
        raise HTTPException(status_code=409, detail="Une candidature existe déjà pour cette adresse et cette offre.")
    extension = Path(cv.filename or "").suffix.lower()
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=415, detail="CV au format PDF, DOC ou DOCX uniquement.")
    nom_stocke = f"{uuid.uuid4().hex}{extension}"
    chemin = _repertoire_cv() / nom_stocke
    with chemin.open("wb") as sortie:
        shutil.copyfileobj(cv.file, sortie)
    candidature = CandidatureExterne(offre_id=offre.id, nom=nom.strip(), prenom=prenom.strip(), email=email_normalise,
                                     telephone=(telephone or "").strip() or None,
                                     motivation=(motivation or "").strip() or None,
                                     cv_chemin=nom_stocke, cv_nom_original=Path(cv.filename or "CV").name)
    db.add(candidature)
    for rh in administrateurs_rh(db):
        notifier(db, rh.id, "Nouvelle candidature externe", f"{candidature.prenom} {candidature.nom} — {offre.intitule}",
                 "validation", "/mobilite")
    db.commit()
    return {"id": candidature.id, "statut": candidature.statut, "message": "Candidature reçue."}


def _candidature_externe_json(c: CandidatureExterne) -> dict:
    return {"id": c.id, "statut": c.statut, "statut_libelle": STATUTS_CANDIDATURE[c.statut],
            "nom": c.nom, "prenom": c.prenom, "email": c.email, "telephone": c.telephone,
            "motivation": c.motivation, "commentaire_rh": c.commentaire_rh, "cv_nom": c.cv_nom_original,
            "deposee_le": c.cree_le, "integree": c.statut == "integree"}


@router.get("/offres/{offre_id}/candidatures-externes", summary="Candidatures externes d'une offre (RH)")
def candidatures_externes(offre_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    offre = db.get(OffreInterne, offre_id)
    if not offre:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    return {"offre": _offre_json(offre, utilisateur, True), "candidatures": [
        _candidature_externe_json(c) for c in sorted(offre.candidatures_externes, key=lambda x: x.cree_le)
    ]}


@router.get("/candidatures-externes/{candidature_id}/cv", summary="Télécharger le CV d'un candidat externe (RH)")
def telecharger_cv(candidature_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    candidature = db.get(CandidatureExterne, candidature_id)
    chemin = _repertoire_cv() / candidature.cv_chemin if candidature else None
    if not candidature or not chemin or not chemin.is_file():
        raise HTTPException(status_code=404, detail="CV introuvable")
    return FileResponse(chemin, filename=candidature.cv_nom_original)


class SuiviExternePayload(BaseModel):
    statut: str = Field(pattern="^(etudiee|entretien|retenue|non_retenue)$")
    commentaire: str | None = Field(default=None, max_length=1000)


@router.post("/candidatures-externes/{candidature_id}/suivi", summary="Faire avancer une candidature externe (RH)")
def suivre_externe(candidature_id: int, payload: SuiviExternePayload, db: Session = Depends(get_db),
                   utilisateur: Employe = Depends(admin_requis)):
    candidature = db.get(CandidatureExterne, candidature_id)
    if not candidature or candidature.statut == "integree":
        raise HTTPException(status_code=404, detail="Candidature introuvable ou déjà intégrée.")
    candidature.statut = payload.statut
    candidature.commentaire_rh = (payload.commentaire or "").strip() or candidature.commentaire_rh
    db.add(JournalAudit(acteur_id=utilisateur.id, action=f"candidature_externe_{payload.statut}",
                        cible=candidature.email, detail=candidature.offre.intitule))
    db.commit()
    return _candidature_externe_json(candidature)


class IntegrationExternePayload(BaseModel):
    matricule: str = Field(min_length=1, max_length=20)
    poste: str = Field(min_length=2, max_length=120)
    departement_id: int | None = None
    validateur_id: int | None = None
    date_entree: date = Field(default_factory=date.today)
    niveau: str = "collaborateur"
    jours_acquis: float = Field(default=21, ge=0, le=60)


@router.post("/candidatures-externes/{candidature_id}/integrer", summary="Créer le profil et le parcours d'arrivée d'un candidat retenu")
def integrer_externe(candidature_id: int, payload: IntegrationExternePayload, db: Session = Depends(get_db),
                     utilisateur: Employe = Depends(admin_requis)):
    candidature = db.get(CandidatureExterne, candidature_id)
    if not candidature or candidature.statut != "retenue":
        raise HTTPException(status_code=409, detail="Seul un candidat externe retenu peut être intégré.")
    if db.scalar(select(Employe).where(Employe.matricule == payload.matricule.upper())):
        raise HTTPException(status_code=409, detail="Ce matricule existe déjà.")
    from app.services import hierarchie, sirh
    from app.routers.sirh import ajouter_evenement

    hierarchie.verifier_niveau(payload.niveau)
    hierarchie.verifier_rattachement(db, None, payload.validateur_id)
    hierarchie.verifier_departement(db, payload.departement_id)
    employe = Employe(matricule=payload.matricule.upper(), nom=candidature.nom, prenom=candidature.prenom,
                      email=candidature.email, telephone=candidature.telephone, poste=payload.poste,
                      date_entree=payload.date_entree, departement_id=payload.departement_id,
                      validateur_id=payload.validateur_id, niveau=payload.niveau,
                      role=Role.EMPLOYE if payload.niveau == "collaborateur" else Role.VALIDATEUR,
                      statut=StatutEmploye.ACTIF, mot_de_passe_hash=hash_password("demo2026"))
    db.add(employe)
    db.flush()
    db.add_all([DossierEmploye(employe_id=employe.id), SoldeConge(employe_id=employe.id, annee=date.today().year,
                                                                   jours_acquis=payload.jours_acquis)])
    ajouter_evenement(db, employe, "embauche", None, employe.poste, utilisateur.id, payload.date_entree,
                      reference=f"Candidature externe #{candidature.id}", commentaire=candidature.offre.intitule)
    sirh.creer_parcours(db, employe, "arrivee", payload.date_entree)
    candidature.statut = "integree"
    db.add(JournalAudit(acteur_id=utilisateur.id, action="candidat_externe_integre", cible=employe.matricule,
                        detail=f"Candidature #{candidature.id} — {candidature.offre.intitule}"))
    db.commit()
    return {"matricule": employe.matricule, "nom": employe.nom_complet, "parcours_arrivee": True}
