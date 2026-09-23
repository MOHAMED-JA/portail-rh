"""Formations et habilitations obligatoires : référentiel, obtentions,
tableau de conformité et échéances.

Référentiel et saisies : personnel RH. Tableau de conformité : RH et
Direction générale (tout le personnel), supérieurs (leur ligne). Chacun
consulte sa propre situation."""
from __future__ import annotations

import json
import shutil
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import ROLES_RH, Employe, Habilitation, HabilitationCollaborateur, JournalAudit, StatutEmploye
from app.services import habilitations as svc
from app.services import hierarchie
from app.services.notifications import notifier

router = APIRouter(prefix="/api/habilitations", tags=["Habilitations obligatoires"])


class HabilitationPayload(BaseModel):
    intitule: str = Field(min_length=3, max_length=160)
    categorie: str = "formation_reglementaire"
    organisme: str | None = Field(default=None, max_length=120)
    periodicite_mois: int | None = Field(default=None, ge=1, le=120)
    population: str = "tous"
    cibles: list[str | int] = Field(default_factory=list)
    description: str | None = Field(default=None, max_length=2000)
    actif: bool = True


class ObtentionPayload(BaseModel):
    habilitation_id: int
    obtenue_le: date
    expire_le: date | None = None
    reference: str | None = Field(default=None, max_length=80)


def _mini(e: Employe) -> dict:
    return {"id": e.id, "matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
            "direction": e.departement.nom if e.departement else "Non affecté"}


def _habilitation_json(h: Habilitation) -> dict:
    return {"id": h.id, "intitule": h.intitule, "categorie": h.categorie,
            "categorie_libelle": svc.CATEGORIES.get(h.categorie, h.categorie), "organisme": h.organisme,
            "periodicite_mois": h.periodicite_mois, "population": h.population,
            "population_libelle": svc.POPULATIONS.get(h.population, h.population), "cibles": svc.cibles(h),
            "description": h.description, "actif": h.actif}


def _obtention_json(o: HabilitationCollaborateur | None) -> dict | None:
    if o is None:
        return None
    return {"id": o.id, "obtenue_le": o.obtenue_le, "expire_le": o.expire_le, "reference": o.reference,
            "justificatif": o.justificatif, "saisi_le": o.saisi_le}


def _ligne_json(l: dict) -> dict:
    return {"employe": _mini(l["employe"]), "habilitation": {"id": l["habilitation"].id, "intitule": l["habilitation"].intitule},
            "statut": l["statut"], "statut_libelle": svc.STATUTS[l["statut"]], "obtention": _obtention_json(l["obtention"])}


def _verifier(payload: HabilitationPayload) -> None:
    if payload.categorie not in svc.CATEGORIES:
        raise HTTPException(status_code=422, detail="Catégorie inconnue.")
    if payload.population not in svc.POPULATIONS:
        raise HTTPException(status_code=422, detail="Population visée inconnue.")
    if payload.population != "tous" and not payload.cibles:
        raise HTTPException(status_code=422, detail="Désignez au moins une structure ou un niveau.")
    if payload.population == "niveaux" and any(str(c) not in hierarchie.LIBELLES_NIVEAUX for c in payload.cibles):
        raise HTTPException(status_code=422, detail="Niveau hiérarchique inconnu.")


def _appliquer(h: Habilitation, payload: HabilitationPayload) -> None:
    h.intitule = payload.intitule.strip()
    h.categorie = payload.categorie
    h.organisme = (payload.organisme or "").strip() or None
    h.periodicite_mois = payload.periodicite_mois
    h.population = payload.population
    valeurs = [] if payload.population == "tous" else (
        [int(c) for c in payload.cibles] if payload.population == "departements" else [str(c) for c in payload.cibles])
    h.cibles = json.dumps(valeurs)
    h.description = (payload.description or "").strip() or None
    h.actif = payload.actif


# ------------------------------------------------------------------ Référentiel
@router.get("", summary="Référentiel des habilitations obligatoires")
def referentiel(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return {"categories": svc.CATEGORIES, "populations": svc.POPULATIONS, "statuts": svc.STATUTS,
            "niveaux": dict(hierarchie.NIVEAUX),
            "habilitations": [_habilitation_json(h) for h in db.scalars(select(Habilitation).order_by(
                Habilitation.actif.desc(), Habilitation.intitule))]}


@router.post("", summary="Ajouter une habilitation au référentiel (RH)")
def creer(payload: HabilitationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    _verifier(payload)
    h = Habilitation()
    _appliquer(h, payload)
    db.add(h)
    db.flush()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="habilitation_creee", cible=str(h.id), detail=h.intitule))
    db.commit()
    return _habilitation_json(h)


@router.put("/{habilitation_id}", summary="Modifier une habilitation (RH)")
def modifier(habilitation_id: int, payload: HabilitationPayload, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(admin_requis)):
    h = db.get(Habilitation, habilitation_id)
    if not h:
        raise HTTPException(status_code=404, detail="Habilitation introuvable.")
    _verifier(payload)
    _appliquer(h, payload)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="habilitation_modifiee", cible=str(h.id), detail=h.intitule))
    db.commit()
    return _habilitation_json(h)


@router.delete("/{habilitation_id}", summary="Retirer une habilitation (RH) — désactivée si déjà suivie")
def retirer(habilitation_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    h = db.get(Habilitation, habilitation_id)
    if not h:
        raise HTTPException(status_code=404, detail="Habilitation introuvable.")
    suivie = db.scalar(select(func.count(HabilitationCollaborateur.id)).where(
        HabilitationCollaborateur.habilitation_id == h.id))
    if suivie:
        h.actif = False   # l'historique des obtentions reste consultable
        action = "habilitation_desactivee"
    else:
        db.delete(h)
        action = "habilitation_supprimee"
    db.add(JournalAudit(acteur_id=utilisateur.id, action=action, cible=str(habilitation_id), detail=h.intitule))
    db.commit()
    return {"statut": "desactivee" if suivie else "supprimee"}


# ------------------------------------------------------------------ Conformité
@router.get("/conformite", summary="Tableau de conformité (RH et DG : tout ; supérieur : sa ligne)")
def conformite(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if hierarchie.voit_tout(utilisateur):
        employes = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)))
    else:
        ids = hierarchie.equipe_ids(db, utilisateur.id)
        if not ids:
            raise HTTPException(status_code=403, detail="Réservé à la RH, à la Direction générale et aux supérieurs.")
        employes = list(db.scalars(select(Employe).where(Employe.id.in_(ids))))
    lignes = svc.situation(db, employes)
    par_direction: dict[str, dict] = {}
    par_habilitation: dict[int, dict] = {}
    for l in lignes:
        direction = l["employe"].departement.nom if l["employe"].departement else "Non affecté"
        for cle, cumul in ((direction, par_direction), (l["habilitation"].id, par_habilitation)):
            a = cumul.setdefault(cle, {"exigees": 0, "conforme": 0, "a_renouveler": 0, "expiree": 0, "manquante": 0})
            a["exigees"] += 1
            a[l["statut"]] += 1
    for cle, a in par_direction.items():
        a["direction"] = cle
    for cle, a in par_habilitation.items():
        a["intitule"] = db.get(Habilitation, cle).intitule
    for a in [*par_direction.values(), *par_habilitation.values()]:
        a["taux"] = round(100 * (a["conforme"] + a["a_renouveler"]) / a["exigees"]) if a["exigees"] else None
    total = len(lignes)
    valides = sum(1 for l in lignes if l["statut"] in ("conforme", "a_renouveler"))
    return {
        "taux_global": round(100 * valides / total) if total else None,
        "exigences": total,
        "compteurs": {s: sum(1 for l in lignes if l["statut"] == s) for s in svc.STATUTS},
        "par_direction": sorted(par_direction.values(), key=lambda a: (a["taux"] if a["taux"] is not None else 101, a["direction"])),
        "par_habilitation": sorted(par_habilitation.values(), key=lambda a: a["intitule"]),
        "a_traiter": [_ligne_json(l) for l in sorted(
            (l for l in lignes if l["statut"] != "conforme"),
            key=lambda l: (["expiree", "manquante", "a_renouveler"].index(l["statut"]), l["employe"].nom))],
        "peut_saisir": utilisateur.role in ROLES_RH,
    }


def _situation_de(db: Session, e: Employe) -> dict:
    historique = db.scalars(select(HabilitationCollaborateur).where(HabilitationCollaborateur.employe_id == e.id)
                            .order_by(HabilitationCollaborateur.obtenue_le.desc()))
    return {"employe": _mini(e), "exigences": [_ligne_json(l) for l in svc.situation(db, [e])],
            "historique": [{**_obtention_json(o), "habilitation": o.habilitation.intitule} for o in historique]}


@router.get("/moi", summary="Mes habilitations obligatoires")
def les_miennes(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return _situation_de(db, utilisateur)


@router.get("/collaborateur/{matricule}", summary="Habilitations d'un collaborateur (RH, DG, sa ligne)")
def d_un_collaborateur(matricule: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")
    if not hierarchie.peut_consulter(db, utilisateur, e):
        raise HTTPException(status_code=403, detail="Ce collaborateur n'est pas dans votre périmètre.")
    return _situation_de(db, e)


@router.post("/collaborateur/{matricule}", summary="Enregistrer une obtention ou un renouvellement (RH)")
def enregistrer(matricule: str, payload: ObtentionPayload, db: Session = Depends(get_db),
                utilisateur: Employe = Depends(admin_requis)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    h = db.get(Habilitation, payload.habilitation_id)
    if not e or not h:
        raise HTTPException(status_code=404, detail="Collaborateur ou habilitation introuvable.")
    if payload.obtenue_le > date.today():
        raise HTTPException(status_code=422, detail="La date d'obtention ne peut pas être future.")
    expire = svc.expiration(h, payload.obtenue_le, payload.expire_le)
    if expire and expire <= payload.obtenue_le:
        raise HTTPException(status_code=422, detail="L'expiration doit suivre la date d'obtention.")
    o = HabilitationCollaborateur(habilitation_id=h.id, employe_id=e.id, obtenue_le=payload.obtenue_le,
                                  expire_le=expire, reference=(payload.reference or "").strip() or None,
                                  saisi_par_id=utilisateur.id, saisi_le=datetime.utcnow())
    db.add(o)
    db.flush()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="habilitation_obtenue", cible=e.matricule,
                        detail=f"{h.intitule} — {payload.obtenue_le:%d/%m/%Y}"))
    notifier(db, e.id, "Habilitation enregistrée",
             f"« {h.intitule} » obtenue le {payload.obtenue_le:%d/%m/%Y}"
             + (f", valable jusqu'au {expire:%d/%m/%Y}." if expire else "."), "succes", "/habilitations")
    db.commit()
    return {**_situation_de(db, e), "obtention_id": o.id}


@router.post("/obtention/{obtention_id}/justificatif", summary="Joindre le justificatif (RH) — PDF, DOC, DOCX")
def justificatif(obtention_id: int, fichier: UploadFile = File(...), db: Session = Depends(get_db),
                 utilisateur: Employe = Depends(admin_requis)):
    o = db.get(HabilitationCollaborateur, obtention_id)
    if not o:
        raise HTTPException(status_code=404, detail="Obtention introuvable.")
    nom = fichier.filename or ""
    extension = ("." + nom.rsplit(".", 1)[-1].lower()) if "." in nom else ""
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=422, detail="Format non compatible : PDF, DOC ou DOCX uniquement.")
    cible = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / cible).open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)
    o.justificatif = f"/fichiers/{cible}"
    db.commit()
    return _obtention_json(o)


@router.delete("/obtention/{obtention_id}", summary="Supprimer une saisie erronée (RH)")
def supprimer_obtention(obtention_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    o = db.get(HabilitationCollaborateur, obtention_id)
    if not o:
        raise HTTPException(status_code=404, detail="Obtention introuvable.")
    e = db.get(Employe, o.employe_id)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="habilitation_saisie_supprimee", cible=e.matricule if e else None,
                        detail=f"{o.habilitation.intitule} — {o.obtenue_le:%d/%m/%Y}"))
    db.delete(o)
    db.commit()
    return {"statut": "supprimee"}
