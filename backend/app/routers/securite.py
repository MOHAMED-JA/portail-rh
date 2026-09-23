"""Sécurité : historique des connexions et double authentification
(administration RH)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import administrateur_requis
from app.models import Connexion, Employe, JournalAudit, Role, StatutEmploye
from app.models import ROLES_RH  # noqa: E402
from app.services.notifications import notifier

router = APIRouter(prefix="/api/securite", tags=["Sécurité"])

LIBELLES_RESULTATS = {
    "succes": "Connexion réussie", "mot_de_passe": "Mot de passe incorrect", "code_2fa": "Code de double authentification incorrect",
    "bloque": "Compte bloqué", "inconnu": "Matricule inconnu", "compte_inactif": "Compte désactivé",
}


@router.get("/connexions", summary="Historique des connexions")
def connexions(matricule: str | None = None, resultat: str | None = None, jours: int = 30,
               db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    depuis = datetime.utcnow() - timedelta(days=max(1, min(jours, 365)))
    requete = select(Connexion).where(Connexion.horodatage >= depuis)
    if matricule:
        requete = requete.where(Connexion.matricule == matricule.strip().upper())
    if resultat:
        requete = requete.where(Connexion.resultat == resultat)
    lignes = db.scalars(requete.order_by(Connexion.horodatage.desc()).limit(500)).all()
    return [{"le": c.horodatage, "matricule": c.matricule,
             "nom": f"{c.employe.prenom} {c.employe.nom}" if c.employe else None,
             "resultat": c.resultat, "libelle": LIBELLES_RESULTATS.get(c.resultat, c.resultat),
             "ip": c.adresse_ip, "navigateur": c.navigateur, "double_auth": c.double_auth} for c in lignes]


@router.get("/etat", summary="Tableau de bord de sécurité")
def etat(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    from app.core import config

    maintenant = datetime.utcnow()
    hier = maintenant - timedelta(hours=24)
    echecs = db.scalar(select(func.count(Connexion.id)).where(Connexion.horodatage >= hier, Connexion.resultat != "succes")) or 0
    reussies = db.scalar(select(func.count(Connexion.id)).where(Connexion.horodatage >= hier, Connexion.resultat == "succes")) or 0
    bloques = db.scalars(select(Employe).where(Employe.bloque_jusqu > maintenant)).all()
    rh = db.scalars(select(Employe).where(Employe.role.in_(ROLES_RH), Employe.statut != StatutEmploye.SORTI)).all()
    actifs = db.scalar(select(func.count(Employe.id)).where(Employe.totp_active.is_(True))) or 0
    return {
        "connexions_24h": reussies,
        "echecs_24h": echecs,
        "comptes_bloques": [{"matricule": e.matricule, "nom": f"{e.prenom} {e.nom}", "jusqu_a": e.bloque_jusqu} for e in bloques],
        "comptes_rh": [{"matricule": e.matricule, "nom": f"{e.prenom} {e.nom}", "double_auth": e.totp_active} for e in rh],
        "double_auth_actives": actifs,
        "double_auth_obligatoire_rh": bool(config.DOUBLE_AUTH_RH and config.MATRICULES_DOUBLE_AUTH),
        "double_auth_matricules_obligatoires": sorted(config.MATRICULES_DOUBLE_AUTH) if config.DOUBLE_AUTH_RH else [],
        "cle_signature": "variable d'environnement" if os.environ.get("PORTAIL_RH_SECRET") else "fichier secret.key",
        "cle_chiffrement": "variable d'environnement" if os.environ.get("PORTAIL_RH_CLE_CHIFFREMENT") else "fichier chiffrement.key",
    }


@router.post("/2fa/{matricule}/reinitialiser", summary="Réinitialiser la double authentification d'un compte (téléphone perdu)")
def reinitialiser(matricule: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    if e.id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Un autre administrateur doit réinitialiser votre double authentification.")
    e.totp_active = False
    e.totp_secret = None
    e.codes_secours = None
    e.bloque_jusqu = None
    e.echecs_connexion = 0
    db.add(JournalAudit(acteur_id=utilisateur.id, action="double_auth_reinitialisee", cible=e.matricule))
    notifier(db, e.id, "Double authentification réinitialisée",
             "L'administration RH a réinitialisé votre double authentification : "
             "vous la configurerez à nouveau à la prochaine connexion.", "alerte", "/profil")
    db.commit()
    return {"statut": "reinitialisee"}
