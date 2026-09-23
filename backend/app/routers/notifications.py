"""Centre de notifications + canal WebSocket temps réel."""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.security import employe_depuis_token, utilisateur_courant
from app.models import Employe, Notification
from app.schemas import NotificationDetail
from app.services.notifications import gestionnaire_ws

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("", response_model=list[NotificationDetail], summary="Mes notifications")
def lister(
    non_lues: bool = False,
    limite: int = 50,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    requete = select(Notification).where(Notification.destinataire_id == utilisateur.id)
    if non_lues:
        requete = requete.where(Notification.lu.is_(False))
    return list(db.scalars(requete.order_by(Notification.horodatage.desc()).limit(limite)))


@router.post("/{notification_id}/lu", response_model=NotificationDetail, summary="Marquer comme lue")
def marquer_lue(
    notification_id: int,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    notif = db.get(Notification, notification_id)
    if not notif or notif.destinataire_id != utilisateur.id:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    notif.lu = True
    db.commit()
    db.refresh(notif)
    return notif


@router.post("/tout-lu", summary="Tout marquer comme lu")
def tout_marquer(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    db.execute(
        update(Notification)
        .where(Notification.destinataire_id == utilisateur.id, Notification.lu.is_(False))
        .values(lu=True)
    )
    db.commit()
    return {"statut": "ok"}


@router.websocket("/ws")
async def flux_temps_reel(websocket: WebSocket, token: str = ""):
    """Canal poussé : le front reçoit les validations/refus sans rafraîchir.

    Le token JWT passe en query string (les WebSockets navigateur ne portent
    pas d'en-tête Authorization).
    """
    db = SessionLocal()
    try:
        employe = employe_depuis_token(token, db) if token else None
    finally:
        db.close()

    if not employe:
        await websocket.close(code=4401)
        return

    await gestionnaire_ws.connecter(employe.id, websocket)
    try:
        while True:
            await websocket.receive_text()  # ping applicatif du client
    except WebSocketDisconnect:
        gestionnaire_ws.deconnecter(employe.id, websocket)
    except Exception:
        gestionnaire_ws.deconnecter(employe.id, websocket)
