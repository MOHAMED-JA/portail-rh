"""Assistant RH : une question en français, une réponse calculée à partir des
données du portail (``services/assistant.py``). Aucune IA externe, aucune
question conservée, rien n'est écrit en base : une action guidée renvoie un
formulaire pré-rempli, que l'utilisateur soumet lui-même."""
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import Employe
from app.services import assistant

router = APIRouter(prefix="/api/assistant", tags=["Assistant RH"])


class QuestionPayload(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class LienAssistant(BaseModel):
    libelle: str
    route: str


class ReponseAssistant(BaseModel):
    intention: str
    texte: str
    details: list[str]
    liens: list[LienAssistant]
    action: dict | None
    suggestions: list[str]
    le: datetime


@router.post("", response_model=ReponseAssistant, summary="Poser une question à l'assistant RH")
def poser(payload: QuestionPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return assistant.repondre(db, utilisateur, payload.question)


@router.get("/suggestions", summary="Questions suggérées selon le profil")
def suggestions(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return {"prenom": utilisateur.prenom, "suggestions": assistant.suggestions(db, utilisateur)}
