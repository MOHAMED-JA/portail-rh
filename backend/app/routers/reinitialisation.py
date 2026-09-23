"""Mot de passe oublié : réinitialisation en libre-service.

Personne ne doit rester à la porte du portail. Trois canaux, choisis
automatiquement selon ce dont le compte dispose :

- « totp » — compte avec double authentification (obligatoire seulement pour
  les comptes désignés par la RH, facultative pour les autres) :
  le collaborateur prouve son identité avec le **code de son application**
  d'authentification **et** un **code de secours** à usage unique. Deux objets
  distincts (le téléphone et la feuille de codes) : un téléphone égaré ne suffit
  pas à prendre la main sur un compte RH.
- « email » — lien à usage unique valable 30 minutes, envoyé à l'adresse
  professionnelle, dès que la messagerie est configurée.
- « rh » — à défaut : la demande est déposée et tous les administrateurs RH sont
  prévenus ; ils réinitialisent depuis Administration → Profils.

Un compte bloqué par des tentatives échouées peut toujours passer par ici : la
réinitialisation lève le blocage. Les tentatives de réinitialisation, elles, ne
bloquent jamais le compte ; elles sont seulement plafonnées.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, hash_password
from app.models import (
    DemandeReinitialisation, Employe, JournalAudit, ROLES_RH, StatutEmploye,
)
from app.routers.auth import journaliser_connexion, valider_force
from app.services import emails, notifications, totp

router = APIRouter(prefix="/api/auth/oubli", tags=["Authentification"])

TENTATIVES_MAX = 10          # par matricule et par quart d'heure
FENETRE_MINUTES = 15
VALIDITE_LIEN_MINUTES = 30

MESSAGE_GENERIQUE = ("Si ce matricule existe, la marche à suivre a été engagée. "
                     "Sans nouvelle, contactez la Direction des ressources humaines.")


# ------------------------------------------------------------------ Utilitaires
def _ip(request: Request | None) -> str | None:
    if request is None:
        return None
    entete = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return entete or (request.client.host if request.client else None)


def _compte(db: Session, matricule: str) -> Employe | None:
    employe = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    return employe if employe and employe.statut != StatutEmploye.SORTI else None


def _plafond(db: Session, matricule: str) -> None:
    """Protège des essais en rafale sans jamais bloquer le compte lui-même."""
    depuis = datetime.utcnow() - timedelta(minutes=FENETRE_MINUTES)
    recentes = db.scalar(select(func.count(DemandeReinitialisation.id)).where(
        DemandeReinitialisation.matricule == matricule.strip().upper(),
        DemandeReinitialisation.cree_le >= depuis)) or 0
    if recentes >= TENTATIVES_MAX:
        raise HTTPException(status_code=429, detail=(
            f"Trop de demandes de réinitialisation : patientez {FENETRE_MINUTES} minutes, "
            "ou demandez à la Direction des ressources humaines de le faire pour vous."))


def _tracer(db: Session, request: Request | None, matricule: str, employe: Employe | None,
            canal: str, statut: str, **extra) -> DemandeReinitialisation:
    demande = DemandeReinitialisation(
        employe_id=employe.id if employe else None, matricule=matricule.strip().upper()[:40],
        canal=canal, statut=statut, adresse_ip=_ip(request), **extra)
    db.add(demande)
    return demande


def _prevenir_rh(db: Session, employe: Employe, titre: str, message: str, type_notif: str) -> None:
    for admin in db.scalars(select(Employe).where(Employe.role.in_(ROLES_RH),
                                                  Employe.statut != StatutEmploye.SORTI)):
        if admin.id != employe.id:
            notifications.notifier(db, admin.id, titre, message, type_notif, "/administration")


def _appliquer(db: Session, request: Request | None, employe: Employe, nouveau: str, canal: str) -> None:
    """Pose le nouveau mot de passe et remet le compte en état de servir."""
    valider_force(nouveau, employe.matricule)
    employe.mot_de_passe_hash = hash_password(nouveau)
    employe.doit_changer_mdp = False
    employe.echecs_connexion = 0
    employe.bloque_jusqu = None
    db.add(JournalAudit(acteur_id=employe.id, action="mot_de_passe_reinitialise", cible=employe.matricule,
                        detail=f"Libre-service, canal {canal}"))
    journaliser_connexion(db, request, employe.matricule, employe, "reinitialisation")
    _prevenir_rh(db, employe, "Mot de passe réinitialisé",
                 f"{employe.prenom} {employe.nom} ({employe.matricule}) a réinitialisé son mot de passe "
                 f"lui-même. Si ce n'est pas le cas, vérifiez l'historique des connexions.", "alerte")


# ------------------------------------------------------------------ 1. Demande
class DemandePayload(BaseModel):
    matricule: str


@router.post("", summary="Mot de passe oublié : quelle marche à suivre pour ce matricule")
def demander(payload: DemandePayload, request: Request, db: Session = Depends(get_db)):
    matricule = payload.matricule.strip().upper()
    if not matricule:
        raise HTTPException(status_code=422, detail="Saisissez votre matricule.")
    _plafond(db, matricule)
    employe = _compte(db, matricule)
    if employe is None:
        # Ni confirmation ni démenti : on ne renseigne pas sur les matricules valides.
        _tracer(db, request, matricule, None, "rh", "echec")
        db.commit()
        return {"canal": "rh", "message": MESSAGE_GENERIQUE}

    if employe.totp_active:
        _tracer(db, request, matricule, employe, "totp", "en_attente")
        db.commit()
        return {"canal": "totp", "message": (
            "Votre compte est protégé par la double authentification. Saisissez le code affiché par "
            "votre application, puis l'un de vos codes de secours, et choisissez un nouveau mot de passe.")}

    config = emails.configuration(db)
    if config.get("actif") and employe.email:
        jeton = secrets.token_urlsafe(32)
        _tracer(db, request, matricule, employe, "email", "en_attente",
                jeton_hash=hashlib.sha256(jeton.encode()).hexdigest(),
                expire_le=datetime.utcnow() + timedelta(minutes=VALIDITE_LIEN_MINUTES))
        lien = f"{config['url_application'].rstrip('/')}/#/reinitialisation?jeton={jeton}"
        emails.mettre_en_file(db, employe.email, "Portail RH — réinitialisation de votre mot de passe", emails.gabarit(
            "Réinitialisation de votre mot de passe",
            f"<p style='font-size:14px'>Bonjour {employe.prenom},</p>"
            f"<p style='font-size:14px'>Une réinitialisation a été demandée pour le matricule "
            f"<strong>{employe.matricule}</strong>. Le lien ci-dessous est valable "
            f"{VALIDITE_LIEN_MINUTES} minutes et ne sert qu'une fois.</p>"
            f"<p><a href='{lien}' style='background:#072241;color:#fff;padding:10px 18px;border-radius:8px;"
            f"text-decoration:none;font-weight:600'>Choisir un nouveau mot de passe</a></p>"
            "<p style='font-size:12.5px;color:#7C8CA3'>Vous n'êtes pas à l'origine de cette demande ? "
            "Ignorez ce message et prévenez la Direction des ressources humaines : votre mot de passe "
            "actuel reste valable.</p>"))
        db.commit()
        masque = employe.email[0] + "•••" + employe.email[employe.email.index("@"):]
        return {"canal": "email", "message": (
            f"Un lien de réinitialisation valable {VALIDITE_LIEN_MINUTES} minutes vient d'être envoyé "
            f"à votre adresse professionnelle ({masque}).")}

    demande = _tracer(db, request, matricule, employe, "rh", "en_attente")
    db.flush()
    _prevenir_rh(db, employe, "Mot de passe oublié",
                 f"{employe.prenom} {employe.nom} ({employe.matricule}) ne parvient plus à se connecter et "
                 f"demande un nouveau mot de passe provisoire (Administration → Profils).", "action")
    db.commit()
    return {"canal": "rh", "demande_id": demande.id, "message": (
        "Votre demande a été transmise à la Direction des ressources humaines. Elle vous communiquera "
        "un mot de passe provisoire, que vous changerez dès votre première connexion.")}


# ------------------------------------------------------------------ 2. Par double authentification
class TotpPayload(BaseModel):
    matricule: str
    code: str
    code_secours: str
    nouveau: str = Field(min_length=8)


@router.post("/double-auth", summary="Réinitialiser avec le code de l'application et un code de secours")
def par_double_auth(payload: TotpPayload, request: Request, db: Session = Depends(get_db)):
    matricule = payload.matricule.strip().upper()
    _plafond(db, matricule)
    employe = _compte(db, matricule)
    refus = HTTPException(status_code=401, detail=(
        "Code de l'application ou code de secours incorrect. Chaque code de secours ne sert qu'une fois."))
    if employe is None or not employe.totp_active:
        _tracer(db, request, matricule, employe, "totp", "echec")
        db.commit()
        raise refus
    if not totp.verifier(employe.totp_secret, payload.code.strip()):
        _tracer(db, request, matricule, employe, "totp", "echec")
        db.commit()
        raise refus
    restants = totp.utiliser_code_secours(employe.codes_secours, payload.code_secours.strip())
    if restants is None:
        _tracer(db, request, matricule, employe, "totp", "echec")
        db.commit()
        raise refus
    employe.codes_secours = restants
    _appliquer(db, request, employe, payload.nouveau, "double authentification")
    _tracer(db, request, matricule, employe, "totp", "aboutie", close_le=datetime.utcnow())
    db.commit()
    return {"statut": "ok", "message": (
        "Mot de passe enregistré. Connectez-vous avec vos nouveaux identifiants ; "
        "le code de secours utilisé n'est plus valable.")}


# ------------------------------------------------------------------ 3. Par lien reçu par e-mail
class JetonPayload(BaseModel):
    jeton: str
    nouveau: str = Field(min_length=8)


@router.post("/lien", summary="Réinitialiser avec le lien reçu par e-mail")
def par_lien(payload: JetonPayload, request: Request, db: Session = Depends(get_db)):
    empreinte = hashlib.sha256(payload.jeton.strip().encode()).hexdigest()
    demande = db.scalar(select(DemandeReinitialisation).where(
        DemandeReinitialisation.jeton_hash == empreinte, DemandeReinitialisation.statut == "en_attente"))
    if demande is None or (demande.expire_le and demande.expire_le < datetime.utcnow()):
        raise HTTPException(status_code=410, detail=(
            "Ce lien a expiré ou a déjà servi. Relancez « Mot de passe oublié » depuis l'écran de connexion."))
    employe = db.get(Employe, demande.employe_id)
    if employe is None or employe.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=410, detail="Ce lien n'est plus valable.")
    _appliquer(db, request, employe, payload.nouveau, "lien par e-mail")
    demande.statut, demande.close_le, demande.jeton_hash = "aboutie", datetime.utcnow(), None
    db.commit()
    return {"statut": "ok", "message": "Mot de passe enregistré. Vous pouvez vous connecter."}


# ------------------------------------------------------------------ 4. Côté RH
@router.get("/en-attente", summary="Demandes de réinitialisation à traiter (RH)")
def en_attente(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    lignes = db.scalars(select(DemandeReinitialisation)
                        .where(DemandeReinitialisation.canal == "rh",
                               DemandeReinitialisation.statut == "en_attente",
                               DemandeReinitialisation.employe_id.isnot(None))
                        .order_by(DemandeReinitialisation.cree_le.desc()).limit(50))
    return [{"id": d.id, "le": d.cree_le, "employe": {
        "id": d.employe.id, "matricule": d.employe.matricule,
        "nom": d.employe.nom, "prenom": d.employe.prenom,
        "direction": d.employe.departement.nom if d.employe.departement else "",
    }} for d in lignes if d.employe]


@router.post("/{demande_id}/classer", summary="Classer une demande traitée (RH)")
def classer(demande_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    demande = db.get(DemandeReinitialisation, demande_id)
    if demande is None or demande.statut != "en_attente":
        raise HTTPException(status_code=404, detail="Demande introuvable ou déjà classée.")
    demande.statut, demande.close_le, demande.traitee_par_id = "traitee", datetime.utcnow(), utilisateur.id
    db.add(JournalAudit(acteur_id=utilisateur.id, action="reinitialisation_classee", cible=demande.matricule))
    db.commit()
    return {"statut": "ok"}
