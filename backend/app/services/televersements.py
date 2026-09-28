"""Pièces téléversées : un seul contrôle pour tous les dépôts, un seul droit
de lecture pour toutes les pièces.

Dépôt :
- PDF, DOC et DOCX seulement, vérifiés sur l'extension **et** sur le début du
  contenu (un « .pdf » qui n'est pas un PDF est refusé) ;
- taille plafonnée : la copie s'interrompt dès le plafond dépassé et le
  fichier partiel est supprimé (ni le disque ni OneDrive ne se remplissent) ;
- nom de stockage aléatoire ; l'auteur est enregistré (table ``televersements``).

Lecture (route ``/fichiers/{nom}``, connexion obligatoire) :
- administration RH : toutes les pièces ;
- l'auteur du dépôt ;
- pièces confidentielles (discipline, suivi médical, documents RH remis) :
  l'intéressé seul ;
- pièces d'un circuit de validation (demandes, notes de frais, habilitations) :
  l'intéressé, sa ligne hiérarchique (``hierarchie.peut_consulter``) et le
  suppléant déclaré du valideur.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.models import (
    ROLES_RH, AccidentTravail, Demande, DemandeDocument, Employe, HabilitationCollaborateur, NoteFrais,
    Sanction, SuiviAccident, Televersement,
)
from app.services import delegation, hierarchie

TAILLE_MAX = 10 * 1024 * 1024          # pièces jointes
TAILLE_MAX_CV = 5 * 1024 * 1024        # CV déposés par des candidats externes
BLOC = 64 * 1024
SIGNATURE_DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"   # Word 97-2003
SIGNATURE_DOCX = b"PK\x03\x04"                       # Office Open XML (archive)
# Aucun séparateur de dossier : le nom ne peut désigner qu'un fichier du dossier des pièces.
NOM_STOCKE = re.compile(r"[A-Za-z0-9_-]{8,100}\.(pdf|doc|docx)")


def extension_de(nom: str | None) -> str:
    return Path(nom or "").suffix.lower()


def contenu_conforme(extension: str, debut: bytes) -> bool:
    if extension == ".pdf":
        return b"%PDF-" in debut[:1024]
    if extension == ".doc":
        return debut.startswith(SIGNATURE_DOC)
    if extension == ".docx":
        return debut.startswith(SIGNATURE_DOCX)
    return False


def _megaoctets(taille: int) -> str:
    return f"{taille // (1024 * 1024)} Mo"


def enregistrer(fichier: UploadFile, dossier: Path, taille_max: int | None = None) -> tuple[str, int]:
    """Copie la pièce contrôlée dans ``dossier`` ; renvoie (nom stocké, taille).
    Sans ``taille_max``, le plafond des pièces jointes (TAILLE_MAX) s'applique."""
    taille_max = taille_max or TAILLE_MAX
    extension = extension_de(fichier.filename)
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(status_code=422, detail="Format non compatible : seuls les fichiers PDF, DOC et DOCX sont acceptés.")
    debut = fichier.file.read(BLOC)
    if not contenu_conforme(extension, debut):
        raise HTTPException(status_code=422, detail=(
            f"Le contenu du fichier ne correspond pas à un document {extension[1:].upper()} : "
            "enregistrez-le de nouveau depuis Word ou en PDF."))
    nom = f"{uuid.uuid4().hex}{extension}"
    cible = dossier / nom
    taille = 0
    try:
        with cible.open("wb") as sortie:
            bloc = debut
            while bloc:
                taille += len(bloc)
                if taille > taille_max:
                    raise HTTPException(status_code=413, detail=(
                        f"Fichier trop volumineux : {_megaoctets(taille_max)} au maximum."))
                sortie.write(bloc)
                bloc = fichier.file.read(BLOC)
    except BaseException:
        cible.unlink(missing_ok=True)
        raise
    return nom, taille


def enregistrer_piece(db: Session, fichier: UploadFile, auteur: Employe) -> str:
    """Pièce jointe du portail : renvoie son chemin ``/fichiers/<nom>``.
    L'auteur est enregistré dans la session ``db`` (validée par l'appelant)."""
    nom, taille = enregistrer(fichier, UPLOAD_DIR)
    db.add(Televersement(nom=nom, employe_id=auteur.id, taille=taille))
    return f"/fichiers/{nom}"


def nom_depuis_chemin(chemin: str | None) -> str | None:
    if not chemin or not chemin.startswith("/fichiers/"):
        return None
    nom = chemin[len("/fichiers/"):]
    return nom if NOM_STOCKE.fullmatch(nom) else None


def exiger_auteur(db: Session, chemin: str | None, utilisateur: Employe) -> str | None:
    """Une demande ne peut citer qu'une pièce déposée par son auteur : sinon,
    rattacher la pièce d'un autre à sa propre demande suffirait à la lire."""
    if not chemin:
        return None
    nom = nom_depuis_chemin(chemin)
    auteur = db.scalar(select(Televersement.employe_id).where(Televersement.nom == nom)) if nom else None
    if auteur != utilisateur.id:
        raise HTTPException(status_code=422, detail="Pièce jointe inconnue : déposez de nouveau le justificatif.")
    return chemin


# ------------------------------------------------------------------ Lecture
def _piece_confidentielle_de(db: Session, chemin: str, utilisateur: Employe) -> bool:
    return bool(
        db.scalar(select(Sanction.id).where(Sanction.piece_jointe == chemin, Sanction.employe_id == utilisateur.id))
        or db.scalar(select(SuiviAccident.id).join(AccidentTravail, SuiviAccident.accident_id == AccidentTravail.id)
                     .where(SuiviAccident.piece_jointe == chemin, AccidentTravail.employe_id == utilisateur.id))
        or db.scalar(select(DemandeDocument.id).where(DemandeDocument.fichier == chemin,
                                                      DemandeDocument.employe_id == utilisateur.id)))


def _piece_de_circuit_visible(db: Session, chemin: str, utilisateur: Employe) -> bool:
    titulaires = set(delegation.titulaires_de(db, utilisateur.id))
    for demande in db.scalars(select(Demande).where(Demande.piece_jointe == chemin)):
        if hierarchie.peut_consulter(db, utilisateur, demande.employe) or demande.validateur_id in titulaires:
            return True
    for note in db.scalars(select(NoteFrais).where(NoteFrais.justificatifs.contains(chemin))):
        if hierarchie.peut_consulter(db, utilisateur, note.employe) or note.valideur_id in titulaires:
            return True
    for obtention in db.scalars(select(HabilitationCollaborateur).where(HabilitationCollaborateur.justificatif == chemin)):
        titulaire = db.get(Employe, obtention.employe_id)
        if titulaire and hierarchie.peut_consulter(db, utilisateur, titulaire):
            return True
    return False


def peut_lire(db: Session, utilisateur: Employe, nom: str) -> bool:
    if utilisateur.role in ROLES_RH:
        return True
    if db.scalar(select(Televersement.employe_id).where(Televersement.nom == nom)) == utilisateur.id:
        return True
    chemin = f"/fichiers/{nom}"
    return _piece_confidentielle_de(db, chemin, utilisateur) or _piece_de_circuit_visible(db, chemin, utilisateur)
