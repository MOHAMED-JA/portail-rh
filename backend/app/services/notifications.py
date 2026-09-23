"""Notifications persistées + diffusion temps réel par WebSocket."""
import asyncio
import json
from datetime import datetime

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.models import Notification


class GestionnaireWS:
    """Garde une liste de sockets ouverts par employé."""

    def __init__(self) -> None:
        self._connexions: dict[int, list[WebSocket]] = {}

    async def connecter(self, employe_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._connexions.setdefault(employe_id, []).append(ws)

    def deconnecter(self, employe_id: int, ws: WebSocket) -> None:
        sockets = self._connexions.get(employe_id, [])
        if ws in sockets:
            sockets.remove(ws)
        if not sockets:
            self._connexions.pop(employe_id, None)

    async def envoyer(self, employe_id: int, charge: dict) -> None:
        message = json.dumps(charge, default=str)
        for ws in list(self._connexions.get(employe_id, [])):
            try:
                await ws.send_text(message)
            except Exception:
                self.deconnecter(employe_id, ws)


gestionnaire_ws = GestionnaireWS()


def notifier(
    db: Session,
    destinataire_id: int,
    titre: str,
    message: str,
    type_notif: str = "info",
    lien: str | None = None,
) -> Notification:
    """Crée la notification en base et la pousse en temps réel si le
    destinataire a un onglet ouvert. Le commit reste à la charge de l'appelant."""
    notif = Notification(
        destinataire_id=destinataire_id,
        titre=titre,
        message=message,
        type_notif=type_notif,
        lien=lien,
        horodatage=datetime.utcnow(),
    )
    db.add(notif)
    db.flush()

    charge = {
        "evenement": "notification",
        "id": notif.id,
        "titre": titre,
        "message": message,
        "type_notif": type_notif,
        "lien": lien,
        "horodatage": notif.horodatage.isoformat(),
    }
    try:
        boucle = asyncio.get_running_loop()
        boucle.create_task(gestionnaire_ws.envoyer(destinataire_id, charge))
    except RuntimeError:
        # Appel hors boucle asyncio (script de seed) : la notification reste en base.
        pass
    return notif
