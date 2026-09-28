"""Pièces jointes : servies une à une, après connexion et contrôle d'accès.

Remplace l'ancien montage statique de ``/fichiers`` qui rendait toute pièce
lisible sans connexion à qui connaissait son nom. Les chemins enregistrés en
base (``/fichiers/<nom>``) restent valables."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import UPLOAD_DIR
from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import Employe
from app.services import televersements

router = APIRouter(tags=["Pièces jointes"])

TYPES = {".pdf": "application/pdf", ".doc": "application/msword",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


@router.get("/fichiers/{nom}", summary="Ouvrir une pièce jointe (connexion et droit d'accès requis)")
def ouvrir(nom: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    # Même réponse pour « inexistante » et « interdite » : le nom d'une pièce
    # d'autrui ne se confirme pas.
    introuvable = HTTPException(status_code=404, detail="Pièce introuvable ou non accessible.")
    if not televersements.NOM_STOCKE.fullmatch(nom):
        raise introuvable
    chemin = UPLOAD_DIR / nom
    if not chemin.is_file() or not televersements.peut_lire(db, utilisateur, nom):
        raise introuvable
    extension = televersements.extension_de(nom)
    return FileResponse(chemin, media_type=TYPES[extension], filename=nom,
                        content_disposition_type="inline" if extension == ".pdf" else "attachment",
                        headers={"Cache-Control": "private, no-store"})


@router.get("/fichiers/{reste:path}", include_in_schema=False)
def hors_pieces(reste: str):
    """Sous-dossiers (« recrutement/… », « ../… ») : jamais servis, et pas
    renvoyés vers l'application non plus."""
    raise HTTPException(status_code=404, detail="Pièce introuvable ou non accessible.")
