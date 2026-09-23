"""SIRH : dossier du collaborateur, carrière, alertes, parcours d'arrivée et
de départ, report des congés, documents demandés, sondages, plan de
formation, bilan social, export de paie, audit, sauvegardes, données
personnelles et calendrier Outlook."""
from __future__ import annotations

import io
import json
import shutil
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis, utilisateur_courant
from app.models import (
    AccordReport,
    Anomalie,
    ClotureConges,
    Demande,
    DemandeDocument,
    DossierEmploye,
    Employe,
    EvaluationFormation,
    EvenementCarriere,
    FicheEvaluation,
    Formation,
    InscriptionFormation,
    JournalAudit,
    NoteFrais,
    ParcoursRH,
    ParticipationSondage,
    Pointage,
    ReponseSondage,
    Role,
    SoldeConge,
    Sondage,
    StatutAnomalie,
    StatutDemande,
    StatutEmploye,
    StatutNoteFrais,
    TacheParcours,
    TypeAnomalie,
    TypeDemande,
)
from app.models import ROLES_RH  # noqa: E402
from app.services import parametres, sirh
from app.services.calendrier import est_ouvre
from app.services.demandes import administrateurs_rh, libelle_sous_type, solde_courant
from app.services.documents import EnteteDocument, generer_excel
from app.services.notifications import notifier

router = APIRouter(prefix="/api/sirh", tags=["SIRH"])


def _employe(db: Session, matricule: str) -> Employe:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    return e


def _nom(e: Employe | None) -> str:
    return f"{e.prenom} {e.nom}" if e else "—"


def _tracer(db: Session, acteur: Employe, action: str, cible: str | None = None, detail: str | None = None):
    db.add(JournalAudit(acteur_id=acteur.id, action=action, cible=cible, detail=detail))


def _excel(tampon: io.BytesIO, nom: str) -> StreamingResponse:
    return StreamingResponse(tampon, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{nom}"'})


# ==========================================================================
# Dossier du collaborateur
# ==========================================================================
CHAMPS_DOSSIER = ("date_naissance", "categorie", "grade", "echelon", "type_contrat", "date_fin_contrat",
                  "date_fin_essai", "diplomes", "contact_nom", "contact_lien", "contact_telephone",
                  "visite_medicale_le", "visite_periodicite_mois", "aptitude_medicale", "observations_medicales")


class DossierPayload(BaseModel):
    date_entree: date | None = None
    date_naissance: date | None = None
    categorie: str | None = None
    grade: str | None = None
    echelon: str | None = None
    type_contrat: str | None = None
    date_fin_contrat: date | None = None
    date_fin_essai: date | None = None
    diplomes: str | None = None
    contact_nom: str | None = None
    contact_lien: str | None = None
    contact_telephone: str | None = None
    visite_medicale_le: date | None = None
    visite_periodicite_mois: int = Field(default=12, ge=1, le=60)
    aptitude_medicale: str | None = Field(default=None, max_length=120)
    observations_medicales: str | None = Field(default=None, max_length=4000)


def dossier_de(db: Session, employe: Employe) -> DossierEmploye:
    d = db.get(DossierEmploye, employe.id)
    if d is None:
        d = DossierEmploye(employe_id=employe.id)
        db.add(d)
        db.flush()
    return d


def _dossier_json(employe: Employe, d: DossierEmploye) -> dict:
    prochaine = (d.visite_medicale_le + timedelta(days=30 * (d.visite_periodicite_mois or 12))) if d.visite_medicale_le else None
    retraite = None
    if d.date_naissance:
        try:
            retraite = d.date_naissance.replace(year=d.date_naissance.year + sirh.AGE_RETRAITE)
        except ValueError:
            retraite = date(d.date_naissance.year + sirh.AGE_RETRAITE, 3, 1)
    return {"matricule": employe.matricule, "date_entree": employe.date_entree,
            **{c: getattr(d, c) for c in CHAMPS_DOSSIER},
            **{c: getattr(d, c) for c in CHAMPS_ADRESSE}, "adresse_modifiee_le": d.adresse_modifiee_le,
            "prochaine_visite": prochaine, "date_retraite": retraite}


@router.get("/dossier/{matricule}", summary="Dossier du collaborateur (RH, ou l'intéressé)")
def lire_dossier(matricule: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    employe = _employe(db, matricule)
    if utilisateur.role not in ROLES_RH and utilisateur.id != employe.id:
        raise HTTPException(status_code=403, detail="Dossier réservé à l'intéressé et à la RH")
    d = dossier_de(db, employe)
    db.commit()
    return _dossier_json(employe, d)


@router.put("/dossier/{matricule}", summary="Mettre à jour le dossier (RH)")
def ecrire_dossier(matricule: str, payload: DossierPayload, db: Session = Depends(get_db),
                   utilisateur: Employe = Depends(admin_requis)):
    employe = _employe(db, matricule)
    d = dossier_de(db, employe)
    donnees = payload.model_dump()
    employe.date_entree = donnees.pop("date_entree")
    for champ, valeur in donnees.items():
        setattr(d, champ, valeur.strip() if isinstance(valeur, str) else valeur)
    _tracer(db, utilisateur, "dossier_modifie", employe.matricule)
    db.commit()
    return _dossier_json(employe, d)


# --------------------------------------------------------------------------
# Adresse personnelle : saisie par l'intéressé ; l'administration RH est
# prévenue de chaque modification (ancienne et nouvelle adresse).
# --------------------------------------------------------------------------
CHAMPS_ADRESSE = ("adresse", "code_postal", "ville")


class AdressePayload(BaseModel):
    adresse: str = Field(min_length=5, max_length=255)
    code_postal: str | None = Field(default=None, max_length=10, pattern=r"^[0-9A-Za-z -]*$")
    ville: str = Field(min_length=2, max_length=80)


def _adresse_lisible(d: DossierEmploye) -> str:
    morceaux = [d.adresse, " ".join(x for x in (d.code_postal, d.ville) if x)]
    return ", ".join(m for m in morceaux if m) or "non renseignée"


@router.put("/adresse/{matricule}", summary="Modifier son adresse (l'intéressé, ou la RH)")
def modifier_adresse(matricule: str, payload: AdressePayload, db: Session = Depends(get_db),
                     utilisateur: Employe = Depends(utilisateur_courant)):
    employe = _employe(db, matricule)
    if utilisateur.id != employe.id and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Seul l'intéressé (ou la RH) modifie son adresse.")
    d = dossier_de(db, employe)
    avant = _adresse_lisible(d)
    d.adresse = " ".join(payload.adresse.split())
    d.code_postal = (payload.code_postal or "").strip() or None
    d.ville = " ".join(payload.ville.split())
    apres = _adresse_lisible(d)
    if apres == avant:
        db.commit()
        return _dossier_json(employe, d)
    d.adresse_modifiee_le = datetime.utcnow()
    _tracer(db, utilisateur, "adresse_modifiee", employe.matricule, f"{avant} → {apres}")
    auteur = "par l'intéressé(e)" if utilisateur.id == employe.id else f"par {_nom(utilisateur)}"
    for admin in administrateurs_rh(db, sauf=utilisateur.id):
        notifier(db, admin.id, "Changement d'adresse",
                 f"{_nom(employe)} ({employe.matricule}) — adresse modifiée {auteur}. "
                 f"Ancienne : {avant}. Nouvelle : {apres}.", "info", "/administration")
    db.commit()
    return _dossier_json(employe, d)


# ==========================================================================
# Carrière
# ==========================================================================
TYPES_CARRIERE = {"organisation": "Mise à jour de l'organisation", "embauche": "Embauche", "promotion": "Promotion", "mutation": "Mutation",
                  "changement_poste": "Changement de poste", "grade": "Changement de grade",
                  "echelon": "Avancement d'échelon", "titularisation": "Titularisation",
                  "contrat": "Changement de contrat", "sortie": "Sortie des effectifs", "autre": "Autre"}


class EvenementPayload(BaseModel):
    date_effet: date
    type_evenement: str
    avant: str | None = None
    apres: str | None = None
    reference: str | None = None
    commentaire: str | None = None


def ajouter_evenement(db: Session, employe: Employe, type_evenement: str, avant: str | None, apres: str | None,
                      acteur_id: int | None, date_effet: date | None = None, reference: str | None = None,
                      commentaire: str | None = None) -> None:
    db.add(EvenementCarriere(employe_id=employe.id, date_effet=date_effet or date.today(), type_evenement=type_evenement,
                             avant=avant, apres=apres, reference=reference, commentaire=commentaire, saisi_par_id=acteur_id))


@router.get("/carriere/{matricule}", summary="Historique de carrière")
def carriere(matricule: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    employe = _employe(db, matricule)
    if utilisateur.role not in ROLES_RH and utilisateur.id != employe.id:
        raise HTTPException(status_code=403, detail="Historique réservé à l'intéressé et à la RH")
    lignes = db.scalars(select(EvenementCarriere).where(EvenementCarriere.employe_id == employe.id)
                        .order_by(EvenementCarriere.date_effet.desc(), EvenementCarriere.id.desc())).all()
    return [{"id": x.id, "date_effet": x.date_effet, "type": x.type_evenement,
             "libelle": TYPES_CARRIERE.get(x.type_evenement, x.type_evenement), "avant": x.avant, "apres": x.apres,
             "reference": x.reference, "commentaire": x.commentaire} for x in lignes]


@router.post("/carriere/{matricule}", summary="Ajouter un événement de carrière (RH)")
def ajouter_carriere(matricule: str, payload: EvenementPayload, db: Session = Depends(get_db),
                     utilisateur: Employe = Depends(admin_requis)):
    if payload.type_evenement not in TYPES_CARRIERE:
        raise HTTPException(status_code=422, detail="Type d'événement inconnu")
    employe = _employe(db, matricule)
    ajouter_evenement(db, employe, payload.type_evenement, payload.avant, payload.apres, utilisateur.id,
                      payload.date_effet, payload.reference, payload.commentaire)
    _tracer(db, utilisateur, "carriere", employe.matricule, TYPES_CARRIERE[payload.type_evenement])
    db.commit()
    return carriere(matricule, db, utilisateur)


@router.delete("/carriere/evenement/{evenement_id}", status_code=204, summary="Supprimer un événement (RH)")
def supprimer_carriere(evenement_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    x = db.get(EvenementCarriere, evenement_id)
    if x:
        db.delete(x)
        db.commit()


# ==========================================================================
# Alertes RH
# ==========================================================================
@router.get("/alertes", summary="Alertes RH : essai, CDD, retraite, visite médicale, ancienneté")
def lister_alertes(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    return sirh.alertes(db)


# ==========================================================================
# Parcours d'arrivée et de départ
# ==========================================================================
def _parcours_json(p: ParcoursRH) -> dict:
    faites = sum(1 for t in p.taches if t.fait_le)
    return {"id": p.id, "type": p.type_parcours, "date_reference": p.date_reference, "termine": bool(p.termine_le),
            "employe": {"matricule": p.employe.matricule, "nom": p.employe.nom, "prenom": p.employe.prenom,
                        "poste": p.employe.poste, "manager": p.employe.validateur.matricule if p.employe.validateur else None},
            "avancement": round(100 * faites / len(p.taches)) if p.taches else 100,
            "taches": [{"id": t.id, "libelle": t.libelle, "responsable": t.responsable, "echeance": t.echeance,
                        "fait_le": t.fait_le, "fait_par": _nom(t.fait_par) if t.fait_par else None,
                        "commentaire": t.commentaire} for t in p.taches]}


@router.get("/parcours", summary="Parcours en cours (RH : tous ; manager : son équipe)")
def lister_parcours(inclure_termines: bool = False, db: Session = Depends(get_db),
                    utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(ParcoursRH).order_by(ParcoursRH.date_reference.desc())
    if not inclure_termines:
        requete = requete.where(ParcoursRH.termine_le.is_(None))
    parcours = db.scalars(requete).all()
    if utilisateur.role not in ROLES_RH:
        parcours = [p for p in parcours if p.employe.validateur_id == utilisateur.id]
    return [_parcours_json(p) for p in parcours]


class ParcoursPayload(BaseModel):
    matricule: str
    type_parcours: str = Field(pattern="^(arrivee|depart)$")
    date_reference: date | None = None


@router.post("/parcours", summary="Ouvrir un parcours (RH)")
def ouvrir_parcours(payload: ParcoursPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    employe = _employe(db, payload.matricule)
    p = sirh.creer_parcours(db, employe, payload.type_parcours, payload.date_reference)
    db.commit()
    return _parcours_json(p)


@router.delete("/parcours/{parcours_id}", status_code=204, summary="Supprimer un parcours ouvert par erreur (RH)")
def supprimer_parcours(parcours_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = db.get(ParcoursRH, parcours_id)
    if not p:
        raise HTTPException(status_code=404, detail="Parcours introuvable")
    _tracer(db, utilisateur, "parcours_supprime", p.employe.matricule,
            f"{'Arrivée' if p.type_parcours == 'arrivee' else 'Départ'} du {p.date_reference:%d/%m/%Y}")
    db.delete(p)
    db.commit()


class TachePayload(BaseModel):
    fait: bool
    commentaire: str | None = None


@router.post("/parcours/taches/{tache_id}", summary="Cocher / décocher une tâche (RH ou manager)")
def cocher(tache_id: int, payload: TachePayload, db: Session = Depends(get_db),
           utilisateur: Employe = Depends(utilisateur_courant)):
    t = db.get(TacheParcours, tache_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    if utilisateur.role not in ROLES_RH and t.parcours.employe.validateur_id != utilisateur.id:
        raise HTTPException(status_code=403, detail="Tâche réservée à la RH et au manager")
    t.fait_le = datetime.utcnow() if payload.fait else None
    t.fait_par_id = utilisateur.id if payload.fait else None
    if payload.commentaire is not None:
        t.commentaire = payload.commentaire.strip() or None
    p = t.parcours
    p.termine_le = datetime.utcnow() if all(x.fait_le for x in p.taches) else None
    db.commit()
    return _parcours_json(p)


# ==========================================================================
# Report des congés (plafond 15 jours au 31/12, sauf accord RH)
# ==========================================================================
class AccordPayload(BaseModel):
    matricule: str
    annee: int
    jours: float = Field(gt=0, le=60)
    motif: str | None = None


@router.get("/report", summary="Soldes au-delà du plafond de report (RH)")
def report(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    annee = annee or date.today().year
    clotures = db.scalars(select(ClotureConges).where(ClotureConges.annee == annee - 1)).all()
    return {"annee": annee, "plafond": sirh.plafond_report(), "lignes": sirh.situation_report(db, annee),
            "cloture_precedente": {"annee": annee - 1, "reporte": round(sum(c.reporte for c in clotures), 2),
                                   "perdu": round(sum(c.perdu for c in clotures), 2), "nombre": len(clotures)}}


@router.get("/report/moi", summary="Ma situation de report")
def mon_report(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    annee = date.today().year
    solde = solde_courant(db, utilisateur.id, annee)
    accord = db.scalar(select(AccordReport).where(AccordReport.employe_id == utilisateur.id, AccordReport.annee == annee))
    plafond = sirh.plafond_report()
    db.commit()
    return {"annee": annee, "plafond": plafond, "solde": solde.jours_restants,
            "excedent": max(0, round(solde.jours_restants - plafond, 2)),
            "accord": accord.jours_supplementaires if accord else 0}


@router.post("/report/accord", summary="Accorder un report au-delà du plafond (RH)")
def accorder(payload: AccordPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    employe = _employe(db, payload.matricule)
    accord = db.scalar(select(AccordReport).where(AccordReport.employe_id == employe.id, AccordReport.annee == payload.annee))
    if accord is None:
        accord = AccordReport(employe_id=employe.id, annee=payload.annee, jours_supplementaires=payload.jours)
        db.add(accord)
    accord.jours_supplementaires = payload.jours
    accord.motif = (payload.motif or "").strip() or None
    accord.accorde_par_id = utilisateur.id
    accord.accorde_le = datetime.utcnow()
    notifier(db, employe.id, "Report de congés accordé",
             f"La RH vous accorde le report de {sirh.fr(payload.jours)} jour(s) au-delà de "
             f"{sirh.fr(sirh.plafond_report())} jours sur {payload.annee + 1}.", "succes", "/mes-demandes")
    _tracer(db, utilisateur, "accord_report", employe.matricule, f"{payload.jours:g} j — {payload.annee}")
    db.commit()
    return report(payload.annee, db, utilisateur)


@router.delete("/report/accord/{matricule}/{annee}", summary="Retirer un accord de report (RH)")
def retirer_accord(matricule: str, annee: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    employe = _employe(db, matricule)
    accord = db.scalar(select(AccordReport).where(AccordReport.employe_id == employe.id, AccordReport.annee == annee))
    if accord:
        db.delete(accord)
        _tracer(db, utilisateur, "accord_report_retire", employe.matricule, str(annee))
        db.commit()
    return report(annee, db, utilisateur)


@router.post("/report/notifier", summary="Prévenir maintenant les collaborateurs concernés (RH)")
def prevenir(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    return {"notifies": sirh.notifier_excedents(db, annee or date.today().year)}


# ==========================================================================
# Documents demandés
# ==========================================================================
TYPES_DOCUMENTS = {"attestation_travail": "Attestation de travail", "attestation_salaire": "Attestation de salaire",
                   "certificat_travail": "Certificat de travail", "attestation_conges": "Attestation de congés",
                   "domiciliation_salaire": "Attestation de domiciliation de salaire", "autre": "Autre document"}
STATUTS_DOCUMENTS = {"demandee", "en_cours", "prete", "refusee"}


class DocumentPayload(BaseModel):
    type_document: str
    motif: str | None = None


class TraitementPayload(BaseModel):
    statut: str
    commentaire: str | None = None


def _document_json(d: DemandeDocument) -> dict:
    return {"id": d.id, "type": d.type_document, "libelle": TYPES_DOCUMENTS.get(d.type_document, d.type_document),
            "motif": d.motif, "statut": d.statut, "commentaire_rh": d.commentaire_rh, "fichier": d.fichier,
            "cree_le": d.cree_le, "traitee_le": d.traitee_le,
            "employe": {"matricule": d.employe.matricule, "nom": d.employe.nom, "prenom": d.employe.prenom}}


@router.get("/documents", summary="Demandes de documents (les miennes ; toutes pour la RH)")
def documents(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(DemandeDocument).order_by(DemandeDocument.cree_le.desc())
    if utilisateur.role not in ROLES_RH:
        requete = requete.where(DemandeDocument.employe_id == utilisateur.id)
    return [_document_json(d) for d in db.scalars(requete.limit(500))]


@router.post("/documents", summary="Demander un document RH")
def demander_document(payload: DocumentPayload, db: Session = Depends(get_db),
                      utilisateur: Employe = Depends(utilisateur_courant)):
    if payload.type_document not in TYPES_DOCUMENTS:
        raise HTTPException(status_code=422, detail="Type de document inconnu")
    d = DemandeDocument(employe_id=utilisateur.id, type_document=payload.type_document,
                        motif=(payload.motif or "").strip() or None)
    d.employe = utilisateur
    db.add(d)
    for admin in administrateurs_rh(db, sauf=utilisateur.id):
        notifier(db, admin.id, "Demande de document", f"{_nom(utilisateur)} demande : {TYPES_DOCUMENTS[payload.type_document]}"
                 + (f" ({d.motif})" if d.motif else ""), "validation", "/administration")
    db.commit()
    return _document_json(d)


@router.post("/documents/{document_id}/traiter", summary="Traiter une demande de document (RH)")
def traiter_document(document_id: int, payload: TraitementPayload, db: Session = Depends(get_db),
                     utilisateur: Employe = Depends(admin_requis)):
    d = db.get(DemandeDocument, document_id)
    if not d or payload.statut not in STATUTS_DOCUMENTS:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    d.statut = payload.statut
    d.commentaire_rh = (payload.commentaire or "").strip() or d.commentaire_rh
    d.traitee_le = datetime.utcnow()
    libelle = TYPES_DOCUMENTS.get(d.type_document, d.type_document)
    messages = {"en_cours": f"{libelle} : votre demande est en cours de traitement.",
                "prete": f"{libelle} : votre document est prêt" + (" — téléchargeable dans « Mes documents »." if d.fichier else " — à retirer à la RH."),
                "refusee": f"{libelle} : demande non retenue" + (f" — {d.commentaire_rh}" if d.commentaire_rh else "."),
                "demandee": f"{libelle} : demande enregistrée."}
    notifier(db, d.employe_id, "Suivi de votre demande de document", messages[d.statut],
             "succes" if d.statut == "prete" else "info", "/documents")
    db.commit()
    return _document_json(d)


@router.post("/documents/{document_id}/fichier", summary="Déposer le document prêt (PDF, DOC, DOCX)")
def deposer_document(document_id: int, fichier: UploadFile = File(...), db: Session = Depends(get_db),
                     utilisateur: Employe = Depends(admin_requis)):
    d = db.get(DemandeDocument, document_id)
    if not d:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    nom = fichier.filename or ""
    extension = ("." + nom.rsplit(".", 1)[-1].lower()) if "." in nom else ""
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=422, detail="Format non compatible : PDF, DOC ou DOCX uniquement.")
    cible = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / cible).open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)
    d.fichier = f"/fichiers/{cible}"
    db.commit()
    return traiter_document(document_id, TraitementPayload(statut="prete"), db, utilisateur)


# ==========================================================================
# Sondages et baromètre social
# ==========================================================================
class SondagePayload(BaseModel):
    titre: str = Field(min_length=3, max_length=160)
    description: str | None = None
    questions: list[dict] = Field(min_length=1, max_length=40)
    anonyme: bool = True
    date_fin: date | None = None


class ReponsePayload(BaseModel):
    reponses: list


@router.get("/sondages", summary="Sondages ouverts (et tous pour la RH)")
def sondages(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    requete = select(Sondage).order_by(Sondage.cree_le.desc())
    if utilisateur.role not in ROLES_RH:
        requete = requete.where(Sondage.ouvert.is_(True))
    repondus = set(db.scalars(select(ParticipationSondage.sondage_id).where(ParticipationSondage.employe_id == utilisateur.id)))
    effectif = db.scalar(select(func.count(Employe.id)).where(Employe.statut != StatutEmploye.SORTI)) or 1
    resultat = []
    for s in db.scalars(requete):
        participants = db.scalar(select(func.count(ParticipationSondage.id)).where(ParticipationSondage.sondage_id == s.id))
        resultat.append({"id": s.id, "titre": s.titre, "description": s.description, "questions": json.loads(s.questions),
                         "anonyme": s.anonyme, "ouvert": s.ouvert and (not s.date_fin or s.date_fin >= date.today()),
                         "date_fin": s.date_fin, "a_repondu": s.id in repondus, "participants": participants,
                         "taux": round(100 * participants / effectif)})
    return resultat


@router.post("/sondages", summary="Créer un sondage (RH)")
def creer_sondage(payload: SondagePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    for q in payload.questions:
        if not str(q.get("texte", "")).strip() or q.get("type") not in ("note", "choix", "texte"):
            raise HTTPException(status_code=422, detail="Chaque question a un texte et un type (note, choix, texte).")
    s = Sondage(titre=payload.titre, description=payload.description, questions=json.dumps(payload.questions, ensure_ascii=False),
                anonyme=payload.anonyme, date_fin=payload.date_fin, cree_par_id=utilisateur.id)
    db.add(s)
    db.flush()
    for e in db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)):
        notifier(db, e.id, "Nouveau sondage", f"« {s.titre} »" + (" — réponses anonymes." if s.anonyme else "."),
                 "info", "/sondages")
    _tracer(db, utilisateur, "sondage_cree", s.titre)
    db.commit()
    return {"id": s.id}


@router.post("/sondages/{sondage_id}/reponse", summary="Répondre à un sondage")
def repondre(sondage_id: int, payload: ReponsePayload, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(utilisateur_courant)):
    s = db.get(Sondage, sondage_id)
    if not s or not s.ouvert or (s.date_fin and s.date_fin < date.today()):
        raise HTTPException(status_code=409, detail="Ce sondage est clos.")
    if db.scalar(select(ParticipationSondage.id).where(ParticipationSondage.sondage_id == s.id,
                                                       ParticipationSondage.employe_id == utilisateur.id)):
        raise HTTPException(status_code=409, detail="Vous avez déjà répondu à ce sondage.")
    if len(payload.reponses) != len(json.loads(s.questions)):
        raise HTTPException(status_code=422, detail="Répondez à chaque question.")
    db.add(ParticipationSondage(sondage_id=s.id, employe_id=utilisateur.id))
    db.add(ReponseSondage(sondage_id=s.id, employe_id=None if s.anonyme else utilisateur.id,
                          departement=utilisateur.departement.code if utilisateur.departement else None,
                          reponses=json.dumps(payload.reponses, ensure_ascii=False)))
    db.commit()
    return {"statut": "ok"}


@router.get("/sondages/{sondage_id}/resultats", summary="Résultats agrégés (RH)")
def resultats(sondage_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = db.get(Sondage, sondage_id)
    if not s:
        raise HTTPException(status_code=404, detail="Sondage introuvable")
    questions = json.loads(s.questions)
    reponses = [json.loads(r.reponses) for r in db.scalars(select(ReponseSondage).where(ReponseSondage.sondage_id == s.id))]
    synthese = []
    for i, q in enumerate(questions):
        valeurs = [r[i] for r in reponses if i < len(r) and r[i] not in (None, "")]
        item = {"texte": q["texte"], "type": q["type"], "reponses": len(valeurs)}
        if q["type"] == "note":
            nombres = [float(v) for v in valeurs if str(v).replace(".", "", 1).isdigit()]
            item["moyenne"] = round(sum(nombres) / len(nombres), 2) if nombres else None
            item["repartition"] = {str(n): nombres.count(n) for n in range(1, 6)}
        elif q["type"] == "choix":
            item["repartition"] = {c: valeurs.count(c) for c in q.get("choix", [])}
        else:
            # Anonymat : les commentaires libres sont restitués sans auteur, dans le désordre.
            item["commentaires"] = sorted(str(v) for v in valeurs)
        synthese.append(item)
    return {"titre": s.titre, "anonyme": s.anonyme, "participants": len(reponses), "questions": synthese}


@router.post("/sondages/{sondage_id}/cloturer", summary="Clore un sondage (RH)")
def cloturer_sondage(sondage_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = db.get(Sondage, sondage_id)
    if s:
        s.ouvert = False
        db.commit()
    return {"statut": "clos"}


# ==========================================================================
# Plan de formation : budget, coûts, évaluations, taxe de formation
# ==========================================================================
class BudgetPayload(BaseModel):
    annee: int
    budget: float = Field(ge=0)
    masse_salariale: float = Field(ge=0)
    taux_tfp: float = Field(ge=0, le=5)


class CoutPayload(BaseModel):
    cout: float = Field(ge=0)


class EvaluationFormationPayload(BaseModel):
    moment: str = Field(pattern="^(chaud|froid)$")
    note: int = Field(ge=1, le=5)
    commentaire: str | None = None
    matricule: str | None = None   # à froid : le participant évalué par son manager


@router.get("/plan-formation", summary="Plan de formation annuel (RH)")
def plan_formation(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    annee = annee or date.today().year
    reglages = parametres.lire(db, f"plan_formation:{annee}", {"budget": 0, "masse_salariale": 0, "taux_tfp": 1})
    sessions = db.scalars(select(Formation).where(Formation.date_debut >= date(annee, 1, 1),
                                                  Formation.date_debut <= date(annee, 12, 31))).all()
    lignes, engage, heures = [], 0.0, 0.0
    for f in sessions:
        evals = db.scalars(select(EvaluationFormation).where(EvaluationFormation.formation_id == f.id)).all()
        moyenne = lambda m: (round(sum(e.note for e in evals if e.moment == m) / n, 2)  # noqa: E731
                             if (n := sum(1 for e in evals if e.moment == m)) else None)
        jours = (f.date_fin - f.date_debut).days + 1
        inscrits = len(f.inscriptions)
        if f.active:
            engage += f.cout or 0
            heures += inscrits * jours * 8
        lignes.append({"id": f.id, "titre": f.titre, "theme": f.theme, "organisme": f.formateur, "debut": f.date_debut,
                       "jours": jours, "inscrits": inscrits, "places": f.places, "cout": f.cout or 0, "active": f.active,
                       "evaluation_chaud": moyenne("chaud"), "evaluation_froid": moyenne("froid"),
                       "cout_par_participant": round((f.cout or 0) / inscrits, 3) if inscrits else None})
    # Souhaits exprimés lors des entretiens annuels
    souhaits: dict[str, int] = {}
    for ev in db.scalars(select(FicheEvaluation).where(FicheEvaluation.annee == annee,
                                                        FicheEvaluation.formations_souhaitees.is_not(None))):
        for theme in json.loads(ev.formations_souhaitees or "[]"):
            souhaits[theme] = souhaits.get(theme, 0) + 1
    effectif = db.scalar(select(func.count(Employe.id)).where(Employe.statut != StatutEmploye.SORTI)) or 1
    tfp = round(reglages["masse_salariale"] * reglages["taux_tfp"] / 100, 3)
    return {"annee": annee, **reglages, "engage": round(engage, 3), "reste": round(reglages["budget"] - engage, 3),
            "tfp_due": tfp, "heures_formation": heures, "heures_par_personne": round(heures / effectif, 1),
            "sessions": lignes, "souhaits": dict(sorted(souhaits.items(), key=lambda x: -x[1]))}


@router.put("/plan-formation/budget", summary="Budget, masse salariale et taux de TFP (RH)")
def budget(payload: BudgetPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    parametres.ecrire(db, f"plan_formation:{payload.annee}", {"budget": payload.budget, "masse_salariale": payload.masse_salariale,
                                                              "taux_tfp": payload.taux_tfp})
    _tracer(db, utilisateur, "plan_formation", str(payload.annee), f"budget {payload.budget:g} DT")
    db.commit()
    return plan_formation(payload.annee, db, utilisateur)


@router.put("/formations/{formation_id}/cout", summary="Coût d'une session (RH)")
def cout(formation_id: int, payload: CoutPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    f = db.get(Formation, formation_id)
    if not f:
        raise HTTPException(status_code=404, detail="Formation introuvable")
    f.cout = payload.cout
    db.commit()
    return {"statut": "ok"}


@router.post("/formations/{formation_id}/evaluation", summary="Évaluer une formation (à chaud : participant ; à froid : manager)")
def evaluer_formation(formation_id: int, payload: EvaluationFormationPayload, db: Session = Depends(get_db),
                      utilisateur: Employe = Depends(utilisateur_courant)):
    f = db.get(Formation, formation_id)
    if not f:
        raise HTTPException(status_code=404, detail="Formation introuvable")
    participant = utilisateur if payload.moment == "chaud" else _employe(db, payload.matricule or "")
    if not any(i.employe_id == participant.id for i in f.inscriptions):
        raise HTTPException(status_code=403, detail="Seuls les participants sont évalués.")
    if f.date_fin > date.today():
        raise HTTPException(status_code=409, detail="La formation n'est pas terminée.")
    if payload.moment == "froid":
        if utilisateur.id != participant.validateur_id and utilisateur.role not in ROLES_RH:
            raise HTTPException(status_code=403, detail="L'évaluation à froid revient au manager du participant.")
        if (date.today() - f.date_fin).days < 60:
            raise HTTPException(status_code=409, detail="L'évaluation à froid se fait au moins deux mois après la formation.")
    existante = db.scalar(select(EvaluationFormation).where(EvaluationFormation.formation_id == f.id,
                                                            EvaluationFormation.employe_id == participant.id,
                                                            EvaluationFormation.moment == payload.moment))
    if existante is None:
        existante = EvaluationFormation(formation_id=f.id, employe_id=participant.id, moment=payload.moment, note=payload.note)
        db.add(existante)
    existante.note = payload.note
    existante.commentaire = (payload.commentaire or "").strip() or None
    existante.evalue_par_id = utilisateur.id
    db.commit()
    return {"statut": "ok"}


@router.get("/mes-evaluations-formation", summary="Formations à évaluer (participant et manager)")
def a_evaluer(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    resultat = []
    aujourdhui = date.today()
    for i in db.scalars(select(InscriptionFormation).join(Formation).where(Formation.date_fin <= aujourdhui)):
        f, e = i.formation, i.employe
        faites = {x.moment for x in db.scalars(select(EvaluationFormation).where(
            EvaluationFormation.formation_id == f.id, EvaluationFormation.employe_id == e.id))}
        if e.id == utilisateur.id and "chaud" not in faites:
            resultat.append({"formation_id": f.id, "titre": f.titre, "fin": f.date_fin, "moment": "chaud", "matricule": e.matricule,
                             "participant": _nom(e)})
        if e.validateur_id == utilisateur.id and "froid" not in faites and (aujourdhui - f.date_fin).days >= 60:
            resultat.append({"formation_id": f.id, "titre": f.titre, "fin": f.date_fin, "moment": "froid", "matricule": e.matricule,
                             "participant": _nom(e)})
    return resultat


# ==========================================================================
# Bilan social (tableau de bord de direction)
# ==========================================================================
@router.get("/bilan", summary="Indicateurs du bilan social (RH)")
def bilan(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    annee = annee or date.today().year
    aujourdhui = date.today()
    fin_periode = min(aujourdhui, date(annee, 12, 31))
    actifs = db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)).all()
    dossiers = {d.employe_id: d for d in db.scalars(select(DossierEmploye))}
    effectif = len(actifs)

    par_direction: dict[str, int] = {}
    par_categorie: dict[str, int] = {}
    tranches = {"< 25 ans": 0, "25–34 ans": 0, "35–44 ans": 0, "45–54 ans": 0, "55–59 ans": 0, "60 ans et +": 0, "Non renseigné": 0}
    anciennetes = []
    for e in actifs:
        par_direction[e.departement.nom if e.departement else "Non affecté"] = par_direction.get(
            e.departement.nom if e.departement else "Non affecté", 0) + 1
        d = dossiers.get(e.id)
        categorie = (d.categorie if d and d.categorie else "Non renseignée")
        par_categorie[categorie] = par_categorie.get(categorie, 0) + 1
        if d and d.date_naissance:
            age = aujourdhui.year - d.date_naissance.year - ((aujourdhui.month, aujourdhui.day) < (d.date_naissance.month, d.date_naissance.day))
            cle = ("< 25 ans" if age < 25 else "25–34 ans" if age < 35 else "35–44 ans" if age < 45
                   else "45–54 ans" if age < 55 else "55–59 ans" if age < 60 else "60 ans et +")
            tranches[cle] += 1
        else:
            tranches["Non renseigné"] += 1
        if e.date_entree:
            anciennetes.append((aujourdhui - e.date_entree).days / 365.25)

    # Absentéisme : maladie, sans solde et absences non justifiées / jours théoriques
    jours_ouvres = sum(1 for n in range((fin_periode - date(annee, 1, 1)).days + 1)
                       if est_ouvre(date(annee, 1, 1) + timedelta(days=n)))
    absences = 0.0
    for d in db.scalars(select(Demande).where(Demande.type_demande == TypeDemande.CONGE, Demande.statut == StatutDemande.APPROUVEE,
                                              Demande.sous_type.in_(["maladie", "sans_solde"]),
                                              Demande.date_debut >= date(annee, 1, 1), Demande.date_debut <= fin_periode)):
        absences += d.nombre_jours
    absences += db.scalar(select(func.count(Anomalie.id)).where(
        Anomalie.type_anomalie == TypeAnomalie.ABSENCE_NON_JUSTIFIEE, Anomalie.statut == StatutAnomalie.OUVERTE,
        Anomalie.date_jour >= date(annee, 1, 1))) or 0
    theorique = max(1, effectif * jours_ouvres)

    sorties = db.scalars(select(Employe).where(Employe.statut == StatutEmploye.SORTI, Employe.date_sortie >= date(annee, 1, 1),
                                               Employe.date_sortie <= date(annee, 12, 31))).all()
    entrees = [e for e in actifs if e.date_entree and e.date_entree.year == annee]
    effectif_moyen = max(1, effectif + len(sorties) / 2)
    motifs: dict[str, int] = {}
    for e in sorties:
        motifs[e.motif_sortie or "autre"] = motifs.get(e.motif_sortie or "autre", 0) + 1

    heures_formation = 0
    for f in db.scalars(select(Formation).where(Formation.active.is_(True), Formation.date_fin >= date(annee, 1, 1),
                                                Formation.date_fin <= fin_periode)):
        heures_formation += len(f.inscriptions) * ((f.date_fin - f.date_debut).days + 1) * 8

    soldes = db.scalars(select(SoldeConge).join(Employe, Employe.id == SoldeConge.employe_id).where(
        SoldeConge.annee == annee, Employe.statut != StatutEmploye.SORTI)).all()
    non_pris = round(sum(max(0, s.jours_restants) for s in soldes), 1)
    plafond = sirh.plafond_report()
    return {
        "annee": annee, "effectif": effectif, "entrees": len(entrees), "sorties": len(sorties), "motifs_sortie": motifs,
        "par_direction": dict(sorted(par_direction.items(), key=lambda x: -x[1])),
        "par_categorie": dict(sorted(par_categorie.items(), key=lambda x: -x[1])),
        "pyramide": tranches, "anciennete_moyenne": round(sum(anciennetes) / len(anciennetes), 1) if anciennetes else None,
        "absenteisme": round(100 * absences / theorique, 2), "jours_absence": absences,
        "rotation": round(100 * (len(sorties) + len(entrees)) / 2 / effectif_moyen, 2),
        "heures_formation": heures_formation, "heures_formation_par_personne": round(heures_formation / max(1, effectif), 1),
        "conges_non_pris": non_pris, "conges_au_dela_plafond": sum(1 for s in soldes if s.jours_restants > plafond),
        "dossiers_incomplets": sum(1 for e in actifs if not (dossiers.get(e.id) and dossiers[e.id].date_naissance
                                                               and dossiers[e.id].categorie and e.date_entree)),
    }


# ==========================================================================
# Préparation de la paie (export mensuel)
# ==========================================================================
@router.get("/paie.xlsx", summary="Export mensuel pour la paie (RH)")
def export_paie(mois: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    try:
        annee, numero = (int(x) for x in mois.split("-"))
        debut = date(annee, numero, 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Mois attendu au format AAAA-MM")
    fin = (date(annee + 1, 1, 1) if numero == 12 else date(annee, numero + 1, 1)) - timedelta(days=1)
    ouvres = [debut + timedelta(days=n) for n in range((fin - debut).days + 1) if est_ouvre(debut + timedelta(days=n))]
    lignes = []
    for e in db.scalars(select(Employe).where((Employe.statut != StatutEmploye.SORTI) | (Employe.date_sortie >= debut))
                        .order_by(Employe.nom, Employe.prenom)):
        jours = {"annuel": 0.0, "maladie": 0.0, "sans_solde": 0.0, "autres": 0.0, "mission": 0.0}
        for d in db.scalars(select(Demande).where(Demande.employe_id == e.id, Demande.statut == StatutDemande.APPROUVEE,
                                                  Demande.type_demande.in_([TypeDemande.CONGE, TypeDemande.MISSION]),
                                                  Demande.date_debut <= fin, Demande.date_fin >= debut)):
            n = sum(1 for j in ouvres if d.date_debut <= j <= d.date_fin)
            if d.demi_journee and n:
                n -= 0.5
            cle = "mission" if d.type_demande == TypeDemande.MISSION else (
                d.sous_type if d.sous_type in ("annuel", "maladie", "sans_solde") else "autres")
            jours[cle] += n
        autorisations = sum(d.duree_heures or 0 for d in db.scalars(select(Demande).where(
            Demande.employe_id == e.id, Demande.type_demande == TypeDemande.AUTORISATION, Demande.statut == StatutDemande.APPROUVEE,
            Demande.date_debut >= debut, Demande.date_debut <= fin)))
        pointages = db.scalars(select(Pointage).where(Pointage.employe_id == e.id, Pointage.date_jour >= debut,
                                                      Pointage.date_jour <= fin)).all()
        travaillees = sum(p.heures_travaillees for p in pointages)
        prevues = sum(p.heures_prevues for p in pointages)
        supp = sum(max(0, p.heures_travaillees - p.heures_prevues) for p in pointages if p.heures_prevues)
        retards = [p.retard_minutes for p in pointages if p.retard_minutes]
        injustifiees = db.scalar(select(func.count(Anomalie.id)).where(
            Anomalie.employe_id == e.id, Anomalie.type_anomalie == TypeAnomalie.ABSENCE_NON_JUSTIFIEE,
            Anomalie.statut == StatutAnomalie.OUVERTE, Anomalie.date_jour >= debut, Anomalie.date_jour <= fin)) or 0
        frais = sum(n.total for n in db.scalars(select(NoteFrais).where(
            NoteFrais.employe_id == e.id, NoteFrais.statut == StatutNoteFrais.REMBOURSEE,
            NoteFrais.remboursee_le >= datetime.combine(debut, datetime.min.time()),
            NoteFrais.remboursee_le < datetime.combine(fin + timedelta(days=1), datetime.min.time()))))
        from app.routers.prets import retenues_du_mois

        retenues = retenues_du_mois(db, e.id, debut)
        lignes.append([e.matricule, e.nom, e.prenom, e.departement.nom if e.departement else "", len(ouvres),
                       jours["annuel"], jours["maladie"], jours["sans_solde"], jours["autres"], jours["mission"],
                       round(autorisations, 2), round(travaillees, 2), round(prevues, 2), round(supp, 2),
                       len(retards), sum(retards), injustifiees, round(frais, 3), retenues,
                       f"Sortie le {e.date_sortie:%d/%m/%Y}" if e.date_sortie and debut <= e.date_sortie <= fin else ""])
    colonnes = [("Matricule", 11), ("Nom", 16), ("Prénom", 16), ("Direction", 22), ("Jours ouvrés", 9), ("Congé annuel (j)", 10),
                ("Maladie (j)", 9), ("Sans solde (j)", 9), ("Autres congés (j)", 10), ("Mission (j)", 9), ("Autorisations (h)", 11),
                ("Heures travaillées", 11), ("Heures prévues", 10), ("Heures supp. (h)", 10), ("Retards (nb)", 9),
                ("Retards (min)", 9), ("Absences injustifiées", 11), ("Frais remboursés (DT)", 12),
                ("Retenues avances / prêts (DT)", 13), ("Observation", 18)]
    entete = EnteteDocument("Éléments variables de paie", sous_titre=f"Période : {debut:%m/%Y}", edite_par=_nom(utilisateur))
    _tracer(db, utilisateur, "export_paie", mois)
    db.commit()
    return _excel(generer_excel(entete, colonnes, lignes, "Paie"), f"paie-{mois}.xlsx")


# ==========================================================================
# Journal d'audit exportable, sauvegardes
# ==========================================================================
@router.get("/audit.xlsx", summary="Journal d'audit (Excel)")
def export_audit(debut: date | None = None, fin: date | None = None, db: Session = Depends(get_db),
                 utilisateur: Employe = Depends(administrateur_requis)):
    requete = select(JournalAudit).order_by(JournalAudit.horodatage.desc())
    if debut:
        requete = requete.where(JournalAudit.horodatage >= datetime.combine(debut, datetime.min.time()))
    if fin:
        requete = requete.where(JournalAudit.horodatage < datetime.combine(fin + timedelta(days=1), datetime.min.time()))
    lignes = [[f"{(j.horodatage + timedelta(hours=1)):%d/%m/%Y %H:%M}", _nom(j.acteur) if j.acteur else "Système",
               j.action.replace("_", " "), j.cible or "", j.detail or ""] for j in db.scalars(requete.limit(20000))]
    entete = EnteteDocument("Journal d'audit", sous_titre=f"{len(lignes)} action(s)", edite_par=_nom(utilisateur))
    return _excel(generer_excel(entete, [("Date", 17), ("Auteur", 24), ("Action", 28), ("Cible", 20), ("Détail", 50)],
                                lignes, "Audit"), "journal-audit.xlsx")


@router.get("/sauvegardes", summary="Sauvegardes de la base (RH)")
def sauvegardes(utilisateur: Employe = Depends(administrateur_requis)):
    return {"dossier": "backend/data/sauvegardes", "conservation_jours": sirh.CONSERVATION, "fichiers": sirh.liste_sauvegardes()}


@router.post("/sauvegardes", summary="Sauvegarder maintenant (RH)")
def sauvegarder(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    nom = sirh.sauvegarder(force=True)
    _tracer(db, utilisateur, "sauvegarde_manuelle", nom)
    db.commit()
    return sauvegardes(utilisateur)


# ==========================================================================
# Données personnelles (droit d'accès) et calendrier Outlook
# ==========================================================================
@router.get("/mes-donnees", summary="Toutes mes données (droit d'accès, loi n° 2004-63)")
def mes_donnees(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    e = utilisateur
    d = db.get(DossierEmploye, e.id)
    contenu = {
        "edite_le": datetime.now().isoformat(timespec="seconds"),
        "identite": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "email": e.email, "telephone": e.telephone,
                     "poste": e.poste, "departement": e.departement.nom if e.departement else None,
                     "date_entree": str(e.date_entree) if e.date_entree else None,
                     "superieur": _nom(e.validateur) if e.validateur else None},
        "dossier": {c: (str(getattr(d, c)) if getattr(d, c) is not None else None) for c in CHAMPS_DOSSIER} if d else {},
        "carriere": [{"date": str(x.date_effet), "type": x.type_evenement, "avant": x.avant, "apres": x.apres}
                     for x in db.scalars(select(EvenementCarriere).where(EvenementCarriere.employe_id == e.id))],
        "soldes": [{"annee": s.annee, "acquis": s.jours_acquis, "pris": s.jours_pris, "report": s.report_anterieur}
                   for s in db.scalars(select(SoldeConge).where(SoldeConge.employe_id == e.id))],
        "demandes": [{"reference": x.reference, "type": x.type_demande.value, "motif": libelle_sous_type(x.type_demande, x.sous_type),
                      "du": str(x.date_debut), "au": str(x.date_fin), "statut": x.statut.value}
                     for x in db.scalars(select(Demande).where(Demande.employe_id == e.id))],
        "pointages": [{"jour": str(p.date_jour), "heures": p.heures_travaillees, "retard_min": p.retard_minutes}
                      for p in db.scalars(select(Pointage).where(Pointage.employe_id == e.id))],
        "notes_de_frais": [{"reference": n.reference, "periode": n.periode, "total": n.total, "statut": n.statut.value}
                           for n in db.scalars(select(NoteFrais).where(NoteFrais.employe_id == e.id))],
        **_donnees_complementaires(db, e),
    }
    _tracer(db, utilisateur, "acces_donnees_personnelles", e.matricule)
    db.commit()
    return Response(json.dumps(contenu, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="mes-donnees-{e.matricule}.json"'})


@router.get("/conges.ics", summary="Congés approuvés au format calendrier (Outlook)")
def calendrier_ics(equipe: bool = False, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    ids = [utilisateur.id]
    if equipe:
        ids += list(db.scalars(select(Employe.id).where(Employe.validateur_id == utilisateur.id)))
    demandes = db.scalars(select(Demande).where(Demande.employe_id.in_(ids), Demande.statut == StatutDemande.APPROUVEE,
                                                Demande.type_demande.in_([TypeDemande.CONGE, TypeDemande.MISSION])))
    lignes = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Veltaris//Portail RH//FR", "CALSCALE:GREGORIAN",
              "X-WR-CALNAME:Congés — Portail RH"]
    for d in demandes:
        qui = "" if d.employe_id == utilisateur.id else f"{d.employe.prenom} {d.employe.nom} — "
        lignes += ["BEGIN:VEVENT", f"UID:{d.reference}@portail-rh.veltaris.example", f"DTSTAMP:{datetime.utcnow():%Y%m%dT%H%M%SZ}",
                   f"DTSTART;VALUE=DATE:{d.date_debut:%Y%m%d}", f"DTEND;VALUE=DATE:{(d.date_fin + timedelta(days=1)):%Y%m%d}",
                   f"SUMMARY:{qui}{libelle_sous_type(d.type_demande, d.sous_type)} ({d.reference})", "TRANSP:OPAQUE", "END:VEVENT"]
    lignes.append("END:VCALENDAR")
    return Response("\r\n".join(lignes) + "\r\n", media_type="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="conges.ics"'})



def _donnees_complementaires(db: Session, e: Employe) -> dict:
    """Droit d'accès : avances et prêts, accidents du travail, sanctions notifiées."""
    from app.models import AccidentTravail, Pret
    from app.routers.discipline import sanctions_notifiees

    return {
        "avances_et_prets": [{"type": p.type_pret, "montant": p.montant, "mensualites": p.nb_mensualites, "statut": p.statut,
                              "demande_le": str(p.demande_le.date())}
                             for p in db.scalars(select(Pret).where(Pret.employe_id == e.id))],
        "accidents_du_travail": [{"type": a.type_accident, "date": str(a.date_accident), "lieu": a.lieu,
                                  "circonstances": a.circonstances, "lesions": a.lesions, "statut": a.statut}
                                 for a in db.scalars(select(AccidentTravail).where(AccidentTravail.employe_id == e.id))],
        "sanctions_notifiees": sanctions_notifiees(db, e.id),
    }
