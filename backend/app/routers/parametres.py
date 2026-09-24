"""Paramètres RH (règles, types de congé, jours fériés), préférences de
l'utilisateur et demandes de correction de profil."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis, utilisateur_courant
from app.models import TYPES_CONGE, Employe, JournalAudit, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402
from app.services import parametres
from app.services.notifications import notifier

router = APIRouter(prefix="/api/parametres", tags=["Paramètres RH"])


HEURE = r"^\d{2}:\d{2}$"


class ReglesPayload(BaseModel):
    heureArrivee: str = Field(pattern=HEURE)
    heureDepart: str = Field(default="17:00", pattern=HEURE)
    pauseDebut: str = Field(default="12:00", pattern=HEURE)
    pauseFin: str = Field(default="13:00", pattern=HEURE)
    moisSeanceUnique: list[int] = [7, 8]
    heureArriveeEte: str = Field(default="08:00", pattern=HEURE)
    heureDepartEte: str = Field(default="14:00", pattern=HEURE)
    maxAutorisationHeures: float = Field(default=1.5, gt=0, le=8)
    quotaAutorisationMois: float = Field(default=4, gt=0, le=40)
    toleranceRetard: int = Field(ge=0, le=60)
    dureeJournee: float = Field(ge=4, le=12)
    seuilDoubleValidation: float = Field(ge=1, le=60)
    reportMax: float = Field(ge=0, le=30)
    delaiReponse: int = Field(ge=1, le=336)
    validationAutomatique: bool = True
    acquisitionMensuelle: float = Field(default=2.5, ge=0, le=5)
    plafondReport: float = Field(default=15, ge=0, le=60)
    relancesActives: bool = True
    relanceDemandeHeures: int = Field(default=24, ge=1, le=168)
    relanceFicheJours: int = Field(default=7, ge=1, le=90)


class TypesPayload(BaseModel):
    inactifs: list[str]


class FeriePayload(BaseModel):
    date: date
    nom: str = Field(min_length=2, max_length=80)


class CorrectionPayload(BaseModel):
    message: str = Field(min_length=5, max_length=1000)


def etat(db: Session) -> dict:
    return {
        "regles": dict(parametres.REGLES),
        "types_conge_inactifs": sorted(parametres.TYPES_INACTIFS),
        "feries_mobiles": [{"date": d, "nom": n} for d, n in sorted(parametres.feries_mobiles(db).items())],
    }


@router.get("", summary="Paramètres RH en vigueur")
def lire(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return etat(db)


@router.put("/regles", summary="Règles de workflow et de badgeage (administration RH)")
def regles(payload: ReglesPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    parametres.ecrire(db, "regles", payload.model_dump())
    parametres.appliquer_seuil(db, payload.seuilDoubleValidation)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="regles_rh", cible="Workflow & badgeage",
                        detail=f"double validation ≥ {payload.seuilDoubleValidation:g} j · tolérance {payload.toleranceRetard} min"))
    db.commit()
    parametres.charger(db)
    return etat(db)


@router.put("/types-conge", summary="Types de congé proposés (administration RH)")
def types(payload: TypesPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    connus = {t["code"] for t in TYPES_CONGE}
    inactifs = sorted(set(payload.inactifs) & connus - {"annuel"})
    parametres.ecrire(db, "types_conge_inactifs", inactifs)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="types_conge", cible="Types de demandes",
                        detail=", ".join(inactifs) or "tous actifs"))
    db.commit()
    parametres.charger(db)
    return etat(db)


@router.post("/feries", summary="Ajouter un jour férié mobile (administration RH)")
def ajouter_ferie(payload: FeriePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    liste = parametres.feries_mobiles(db)
    liste[payload.date.isoformat()] = payload.nom.strip()
    parametres.ecrire(db, "feries_mobiles", liste)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="jour_ferie_ajoute", cible=payload.date.isoformat(), detail=payload.nom))
    db.commit()
    parametres.charger(db)
    return etat(db)


@router.delete("/feries/{jour}", summary="Retirer un jour férié mobile (administration RH)")
def retirer_ferie(jour: date, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    liste = parametres.feries_mobiles(db)
    if liste.pop(jour.isoformat(), None) is None:
        raise HTTPException(status_code=404, detail="Jour férié introuvable")
    parametres.ecrire(db, "feries_mobiles", liste)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="jour_ferie_retire", cible=jour.isoformat()))
    db.commit()
    parametres.charger(db)
    return etat(db)


@router.get("/preferences", summary="Mes préférences de notification")
def lire_preferences(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return parametres.lire(db, f"preferences:{utilisateur.id}",
                           {"validation": True, "planning": True, "anomalies": True, "formations": False})


@router.put("/preferences", summary="Enregistrer mes préférences de notification")
def ecrire_preferences(payload: dict[str, bool], db: Session = Depends(get_db),
                       utilisateur: Employe = Depends(utilisateur_courant)):
    parametres.ecrire(db, f"preferences:{utilisateur.id}", payload)
    db.commit()
    return payload


@router.post("/correction", summary="Demander à la RH une correction de ses informations")
def correction(payload: CorrectionPayload, db: Session = Depends(get_db),
               utilisateur: Employe = Depends(utilisateur_courant)):
    admins = db.scalars(select(Employe).where(Employe.role.in_(ROLES_RH), Employe.statut != StatutEmploye.SORTI)).all()
    for admin in admins:
        if admin.id != utilisateur.id:
            notifier(db, admin.id, "Demande de correction de profil",
                     f"{utilisateur.prenom} {utilisateur.nom} ({utilisateur.matricule}) : {payload.message}",
                     "validation", "/administration")
    db.add(JournalAudit(acteur_id=utilisateur.id, action="demande_correction", cible=utilisateur.matricule,
                        detail=payload.message))
    db.commit()
    return {"statut": "ok", "destinataires": len(admins)}


# ------------------------------------------------------------------ Messagerie
class MessageriePayload(BaseModel):
    actif: bool = False
    serveur: str = ""
    port: int = Field(default=587, ge=1, le=65535)
    securite: str = Field(default="starttls", pattern="^(starttls|ssl|aucune)$")
    utilisateur: str = ""
    mot_de_passe: str = ""
    expediteur: str = ""
    url_application: str = "http://127.0.0.1:8100"


class TestPayload(BaseModel):
    destinataire: str = Field(min_length=5)


MASQUE = "••••••••"


@router.get("/messagerie", summary="Configuration de la messagerie (administration RH)")
def lire_messagerie(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    from app.services import emails
    config = emails.configuration(db)
    return {**config, "mot_de_passe": MASQUE if config.get("mot_de_passe") else ""}


@router.put("/messagerie", summary="Enregistrer la configuration de la messagerie")
def ecrire_messagerie(payload: MessageriePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    from app.services import emails
    donnees = payload.model_dump()
    if donnees["mot_de_passe"] == MASQUE:
        donnees["mot_de_passe"] = emails.configuration(db).get("mot_de_passe", "")
    parametres.ecrire(db, "messagerie", donnees)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="messagerie", cible=donnees["serveur"] or "—",
                        detail="activée" if donnees["actif"] else "désactivée"))
    db.commit()
    return lire_messagerie(db, utilisateur)


@router.post("/messagerie/test", summary="Envoyer un e-mail de test")
def tester_messagerie(payload: TestPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    from app.services import emails
    config = emails.configuration(db)
    if not config["serveur"]:
        raise HTTPException(status_code=422, detail="Renseignez d'abord le serveur de messagerie.")
    try:
        emails.envoyer_maintenant(config, payload.destinataire, "Test — Portail RH Veltaris",
                                  emails._page("Test de messagerie", "<p>La messagerie du portail RH fonctionne.</p>"))
    except Exception as souci:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Échec d'envoi : {type(souci).__name__} — {souci}")
    return {"statut": "envoye"}


@router.get("/emails", summary="Derniers e-mails du portail (administration RH)")
def derniers_emails(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    from app.models import EmailSortant
    lignes = db.scalars(select(EmailSortant).order_by(EmailSortant.id.desc()).limit(40)).all()
    return [{"destinataire": m.destinataire, "sujet": m.sujet, "statut": m.statut, "erreur": m.erreur,
             "cree_le": m.cree_le, "envoye_le": m.envoye_le} for m in lignes]
