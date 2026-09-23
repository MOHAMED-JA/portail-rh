"""Authentification : matricule + mot de passe, puis code de double
authentification (TOTP) lorsque le compte l'a activée. Chaque tentative est
inscrite dans l'historique des connexions."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    creer_jeton_etape, creer_token, hash_password, lire_jeton_etape, utilisateur_courant, verify_password,
)
from app.models import Connexion, Employe, JournalAudit, StatutEmploye
from app.schemas import EmployeDetail, LoginPayload, TokenReponse
from app.services import totp

router = APIRouter(prefix="/api/auth", tags=["Authentification"])


ESSAIS_MAX = 5
BLOCAGE_MINUTES = 15


def journaliser_connexion(db: Session, request: Request | None, matricule: str, employe: Employe | None,
                          resultat: str, double_auth: bool = False) -> None:
    ip = navigateur = None
    if request is not None:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else None)
        navigateur = (request.headers.get("user-agent") or "")[:255] or None
    db.add(Connexion(employe_id=employe.id if employe else None, matricule=(matricule or "")[:40], adresse_ip=ip,
                     navigateur=navigateur, resultat=resultat, double_auth=double_auth))


def _echec(db: Session, request: Request | None, employe: Employe, motif: str, message: str) -> None:
    """Échec (mot de passe ou code) : compteur commun, blocage après 5 échecs."""
    maintenant = datetime.utcnow()
    employe.echecs_connexion = (employe.echecs_connexion or 0) + 1
    if employe.echecs_connexion >= ESSAIS_MAX:
        employe.bloque_jusqu = maintenant + timedelta(minutes=BLOCAGE_MINUTES)
        employe.echecs_connexion = 0
        db.add(JournalAudit(acteur_id=employe.id, action="compte_bloque", cible=employe.matricule,
                            detail=f"{ESSAIS_MAX} échecs de connexion"))
        journaliser_connexion(db, request, employe.matricule, employe, "bloque")
        db.commit()
        raise HTTPException(status_code=423, detail=f"Trop de tentatives : compte bloqué pendant {BLOCAGE_MINUTES} minutes.")
    journaliser_connexion(db, request, employe.matricule, employe, motif)
    db.commit()
    restants = ESSAIS_MAX - employe.echecs_connexion
    raise HTTPException(status_code=401, detail=f"{message} — {restants} essai(s) restant(s) avant blocage.")


def _verifier_blocage(db: Session, request: Request | None, employe: Employe) -> None:
    maintenant = datetime.utcnow()
    if employe.bloque_jusqu and employe.bloque_jusqu > maintenant:
        reste = int((employe.bloque_jusqu - maintenant).total_seconds() // 60) + 1
        journaliser_connexion(db, request, employe.matricule, employe, "bloque")
        db.commit()
        raise HTTPException(status_code=423, detail=(
            f"Compte bloqué après {ESSAIS_MAX} tentatives échouées : réessayez dans {reste} minute(s) "
            "ou utilisez « Mot de passe oublié » — la réinitialisation reste possible pendant le blocage."))


def _authentifier(db: Session, matricule: str, mot_de_passe: str, request: Request | None = None) -> Employe:
    """Contrôle du mot de passe, avec blocage temporaire après 5 échecs."""
    employe = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not employe:
        journaliser_connexion(db, request, matricule, None, "inconnu")
        db.commit()
        raise HTTPException(status_code=401, detail="Matricule ou mot de passe incorrect")
    _verifier_blocage(db, request, employe)
    if not verify_password(mot_de_passe, employe.mot_de_passe_hash):
        _echec(db, request, employe, "mot_de_passe", "Matricule ou mot de passe incorrect")
    if employe.statut == StatutEmploye.SORTI:
        journaliser_connexion(db, request, employe.matricule, employe, "compte_inactif")
        db.commit()
        raise HTTPException(status_code=403, detail="Ce compte n'est plus actif")
    return employe


def _ouvrir_session(db: Session, request: Request | None, employe: Employe, double_auth: bool = False) -> TokenReponse:
    employe.echecs_connexion = 0
    employe.bloque_jusqu = None
    journaliser_connexion(db, request, employe.matricule, employe, "succes", double_auth)
    db.commit()
    return TokenReponse(access_token=creer_token(employe), utilisateur=EmployeDetail.model_validate(employe))


def _connexion(db: Session, request: Request | None, matricule: str, mot_de_passe: str) -> TokenReponse:
    employe = _authentifier(db, matricule, mot_de_passe, request)
    if employe.totp_active:
        # Mot de passe correct : le code du téléphone est encore attendu.
        db.commit()
        return TokenReponse(etape="code_2fa", jeton_etape=creer_jeton_etape(employe))
    return _ouvrir_session(db, request, employe)


@router.post("/login", response_model=TokenReponse, summary="Connexion (JSON)")
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    return _connexion(db, request, payload.matricule, payload.mot_de_passe)


@router.post("/token", response_model=TokenReponse, include_in_schema=False)
def login_form(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Variante formulaire, utilisée par le bouton « Authorize » de Swagger."""
    return _connexion(db, request, form.username, form.password)


@router.get("/moi", response_model=EmployeDetail, summary="Profil de l'utilisateur connecté")
def profil(utilisateur: Employe = Depends(utilisateur_courant)):
    return utilisateur


FACILES = {"demo2026", "demo20262026", "motdepasse", "password1", "azerty123", "12345678"}


def valider_force(nouveau: str, matricule: str) -> None:
    """Exigences communes au changement et à la réinitialisation."""
    if len(nouveau) < 8 or not any(c.isdigit() for c in nouveau) or not any(c.isalpha() for c in nouveau):
        raise HTTPException(status_code=422, detail=(
            "Le nouveau mot de passe doit contenir au moins 8 caractères, dont des lettres et des chiffres."))
    if any(facile in nouveau.lower() for facile in FACILES | {matricule.lower()}):
        raise HTTPException(status_code=422, detail="Ce mot de passe est trop facile à deviner.")


class ChangementMotDePasse(BaseModel):
    actuel: str
    nouveau: str


@router.post("/mot-de-passe", summary="Changer son mot de passe")
def changer_mot_de_passe(
    payload: ChangementMotDePasse,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    if not verify_password(payload.actuel, utilisateur.mot_de_passe_hash):
        raise HTTPException(status_code=400, detail="Le mot de passe actuel est incorrect.")
    valider_force(payload.nouveau, utilisateur.matricule)
    if payload.nouveau == payload.actuel:
        raise HTTPException(status_code=422, detail="Le nouveau mot de passe doit être différent de l'actuel.")
    utilisateur.mot_de_passe_hash = hash_password(payload.nouveau)
    utilisateur.doit_changer_mdp = False
    db.add(JournalAudit(acteur_id=utilisateur.id, action="changement_mot_de_passe", cible=utilisateur.matricule))
    db.commit()
    return {"statut": "ok"}


# ------------------------------------------------------------------ Double authentification
class CodePayload(BaseModel):
    code: str


class VerificationPayload(BaseModel):
    jeton_etape: str
    code: str


@router.post("/2fa/verifier", response_model=TokenReponse, summary="Deuxième étape : code du téléphone ou code de secours")
def verifier_code(payload: VerificationPayload, request: Request, db: Session = Depends(get_db)):
    identifiant = lire_jeton_etape(payload.jeton_etape)
    employe = db.get(Employe, identifiant) if identifiant else None
    if employe is None or not employe.totp_active:
        raise HTTPException(status_code=401, detail="Étape de connexion expirée : saisissez à nouveau votre mot de passe.")
    _verifier_blocage(db, request, employe)
    saisi = payload.code.strip()
    if totp.verifier(employe.totp_secret, saisi):
        return _ouvrir_session(db, request, employe, double_auth=True)
    restants = totp.utiliser_code_secours(employe.codes_secours, saisi)
    if restants is not None:
        employe.codes_secours = restants
        db.add(JournalAudit(acteur_id=employe.id, action="code_secours_utilise", cible=employe.matricule))
        return _ouvrir_session(db, request, employe, double_auth=True)
    _echec(db, request, employe, "code_2fa", "Code incorrect")


@router.post("/2fa/initier", summary="Préparer l'activation : clé secrète et QR code")
def initier(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if utilisateur.totp_active:
        raise HTTPException(status_code=409, detail="La double authentification est déjà active.")
    secret = totp.nouveau_secret()
    utilisateur.totp_secret = secret
    db.commit()
    return {"secret": secret, "uri": totp.uri(secret, utilisateur.matricule), "emetteur": totp.EMETTEUR}


@router.post("/2fa/activer", summary="Confirmer l'activation avec un premier code")
def activer(payload: CodePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if utilisateur.totp_active:
        raise HTTPException(status_code=409, detail="La double authentification est déjà active.")
    if not utilisateur.totp_secret or not totp.verifier(utilisateur.totp_secret, payload.code):
        raise HTTPException(status_code=422, detail="Code incorrect : vérifiez l'heure du téléphone et saisissez le code affiché.")
    codes, empreintes = totp.codes_de_secours()
    utilisateur.totp_active = True
    utilisateur.codes_secours = empreintes
    db.add(JournalAudit(acteur_id=utilisateur.id, action="double_auth_activee", cible=utilisateur.matricule))
    db.commit()
    return {"statut": "active", "codes_secours": codes}


@router.post("/2fa/codes-secours", summary="Régénérer ses codes de secours")
def regenerer_codes(payload: CodePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if not utilisateur.totp_active or not totp.verifier(utilisateur.totp_secret, payload.code):
        raise HTTPException(status_code=422, detail="Code incorrect.")
    codes, empreintes = totp.codes_de_secours()
    utilisateur.codes_secours = empreintes
    db.add(JournalAudit(acteur_id=utilisateur.id, action="codes_secours_regeneres", cible=utilisateur.matricule))
    db.commit()
    return {"codes_secours": codes}


@router.post("/2fa/desactiver", summary="Désactiver sa double authentification (hors comptes désignés)")
def desactiver(payload: CodePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    if utilisateur.double_auth_obligatoire:
        raise HTTPException(status_code=403, detail="Obligatoire pour ce compte : demandez une réinitialisation à un autre administrateur.")
    if not utilisateur.totp_active or not totp.verifier(utilisateur.totp_secret, payload.code):
        raise HTTPException(status_code=422, detail="Code incorrect.")
    utilisateur.totp_active = False
    utilisateur.totp_secret = None
    utilisateur.codes_secours = None
    db.add(JournalAudit(acteur_id=utilisateur.id, action="double_auth_desactivee", cible=utilisateur.matricule))
    db.commit()
    return {"statut": "desactivee"}


@router.get("/mes-connexions", summary="Mes dernières connexions")
def mes_connexions(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    lignes = db.scalars(select(Connexion).where(Connexion.employe_id == utilisateur.id)
                        .order_by(Connexion.horodatage.desc()).limit(20))
    return [{"le": c.horodatage, "ip": c.adresse_ip, "navigateur": c.navigateur, "resultat": c.resultat,
             "double_auth": c.double_auth} for c in lignes]
