"""Authentification : hachage des mots de passe, JWT, dépendances de rôle."""
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET
from app.core.database import get_db
from app.models import Employe, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def hash_password(mot_de_passe: str) -> str:
    return pwd_context.hash(mot_de_passe)


def verify_password(clair: str, hache: str) -> bool:
    return pwd_context.verify(clair, hache)


def creer_token(employe: Employe) -> str:
    payload = {
        "sub": str(employe.id),
        "matricule": employe.matricule,
        "role": employe.role.value,
        "exp": datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def creer_jeton_etape(employe: Employe) -> str:
    """Jeton court (5 min) entre le mot de passe et le code de double
    authentification : il ne donne accès à aucune route de l'API."""
    payload = {"sub": str(employe.id), "typ": "2fa", "exp": datetime.utcnow() + timedelta(minutes=5)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def lire_jeton_etape(jeton: str) -> int | None:
    try:
        charge = jwt.decode(jeton, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
    return int(charge["sub"]) if charge.get("typ") == "2fa" else None


def decoder_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def employe_depuis_token(token: str, db: Session) -> Employe | None:
    try:
        payload = decoder_token(token)
    except JWTError:
        return None
    if payload.get("typ") == "2fa":
        return None   # jeton d'étape : pas une session
    return db.get(Employe, int(payload.get("sub", 0)))


CHEMINS_AVANT_CHANGEMENT = {"/api/auth/moi", "/api/auth/mot-de-passe"}
CHEMINS_AVANT_DOUBLE_AUTH = CHEMINS_AVANT_CHANGEMENT | {"/api/auth/2fa/initier", "/api/auth/2fa/activer"}


def double_auth_exigee(employe: Employe) -> bool:
    """Les comptes désignés par la politique RH doivent activer la double
    authentification avant d'utiliser le portail."""
    return employe.double_auth_requise


def utilisateur_courant(
    request: Request, token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Employe:
    erreur = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expirée ou invalide",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise erreur
    employe = employe_depuis_token(token, db)
    if employe is None or employe.statut == StatutEmploye.SORTI:
        raise erreur
    if employe.doit_changer_mdp and request.url.path not in CHEMINS_AVANT_CHANGEMENT:
        raise HTTPException(status_code=403, detail="Changement du mot de passe provisoire requis.")
    if double_auth_exigee(employe) and request.url.path not in CHEMINS_AVANT_DOUBLE_AUTH:
        raise HTTPException(status_code=403, detail="Activation de la double authentification requise pour ce compte.")
    return employe


def exiger_roles(*roles: Role):
    """Fabrique une dépendance qui restreint l'accès à certains rôles."""

    def _verifier(utilisateur: Employe = Depends(utilisateur_courant)) -> Employe:
        if utilisateur.role not in roles:
            raise HTTPException(status_code=403, detail="Accès non autorisé pour votre rôle")
        return utilisateur

    return _verifier


valideur_requis = exiger_roles(Role.VALIDATEUR, *ROLES_RH)


def valideur_ou_suppleant(
    db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
) -> Employe:
    """Valideur, personnel RH — ou remplaçant déclaré d'un valideur absent.

    Le remplaçant n'a pas le rôle « validateur » : sans cette garde, il verrait
    la délégation acceptée et se heurterait quand même à un 403."""
    if utilisateur.role in (Role.VALIDATEUR, *ROLES_RH):
        return utilisateur
    from app.services import delegation

    if delegation.titulaires_de(db, utilisateur.id):
        return utilisateur
    raise HTTPException(status_code=403, detail="Accès non autorisé pour votre rôle")
# Personnel RH (gestionnaire ou administrateur) : opérations RH.
admin_requis = exiger_roles(*ROLES_RH)
# Administrateur RH seul : paramètres, sécurité, rôles, audit, sauvegardes.
administrateur_requis = exiger_roles(Role.ADMIN_RH)
