"""Décision depuis l'e-mail : le lien « Valider » ou « Refuser » ouvre une page
de confirmation (un simple clic sur le lien ne décide rien : les antivirus de
messagerie ouvrent parfois les liens automatiquement)."""
from __future__ import annotations

from html import escape

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Demande, Employe, StatutDemande
from app.services import demandes as svc
from app.services import emails

router = APIRouter(prefix="/api/email", tags=["Décision par e-mail"])


def _html(titre: str, contenu: str, couleur: str = "#072241") -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(titre)}</title>
<body style="margin:0;background:#F0F3F9;font-family:Segoe UI,Arial,sans-serif;color:#072241">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 6px 20px rgba(7,34,65,.08)">
<div style="border-bottom:3px solid #D92D20;padding-bottom:12px;font-weight:700">VELTARIS · Portail RH</div>
<h2 style="color:{couleur};font-size:19px">{escape(titre)}</h2>{contenu}</div></body></html>""")


def _contexte(db: Session, jeton: str) -> tuple[dict, Demande, Employe]:
    try:
        charge = emails.lire_jeton(jeton)
    except (JWTError, ValueError):
        raise HTTPException(status_code=400, detail="Ce lien n'est plus valable (expiré ou incorrect).")
    demande, valideur = db.get(Demande, charge["d"]), db.get(Employe, charge["v"])
    if not demande or not valideur:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    return charge, demande, valideur


@router.get("/decision", response_class=HTMLResponse, include_in_schema=False)
def page_decision(jeton: str, db: Session = Depends(get_db)):
    try:
        charge, demande, valideur = _contexte(db, jeton)
    except HTTPException as souci:
        return _html("Lien non valable", f"<p>{escape(souci.detail)}</p>", "#C5241A")
    if demande.statut != StatutDemande.EN_ATTENTE:
        return _html("Demande déjà traitée", f"<p>{escape(demande.reference)} est « {escape(demande.statut.value.replace('_', ' '))} ».</p>")
    approuver = charge["a"] == "approuver"
    champ = "" if approuver else ("<label style='display:block;font-size:13px;font-weight:600;margin:12px 0 6px'>Motif du refus"
                                  "</label><textarea name='motif' required minlength='3' style='width:100%;min-height:80px;"
                                  "border:1px solid #DCE2EC;border-radius:8px;padding:8px;font:inherit'></textarea>")
    return _html(
        f"{'Valider' if approuver else 'Refuser'} la demande {demande.reference}",
        f"<p style='font-size:13.5px'>Décision prise au nom de <strong>{escape(valideur.prenom)} {escape(valideur.nom)}</strong>.</p>"
        f"{emails._resume(demande)}<form method='post' action='/api/email/decision'>"
        f"<input type='hidden' name='jeton' value='{escape(jeton)}'>{champ}"
        f"<button style='margin-top:16px;padding:11px 22px;border:0;border-radius:8px;color:#fff;font-weight:600;font-size:14px;"
        f"cursor:pointer;background:{'#12855A' if approuver else '#C5241A'}'>Confirmer : {'valider' if approuver else 'refuser'}</button></form>",
        "#12855A" if approuver else "#C5241A")


@router.post("/decision", response_class=HTMLResponse, include_in_schema=False)
def appliquer(jeton: str = Form(...), motif: str | None = Form(None), db: Session = Depends(get_db)):
    from app.routers.demandes import _charger_pour_decision

    try:
        charge, demande, valideur = _contexte(db, jeton)
        _charger_pour_decision(db, demande.id, valideur)
        approuver = charge["a"] == "approuver"
        if not approuver and not (motif or "").strip():
            raise HTTPException(status_code=422, detail="Un motif de refus est obligatoire.")
        demande = svc.appliquer_decision(db, demande, valideur, approuver, (motif or "").strip() or None)
    except HTTPException as souci:
        return _html("Décision impossible", f"<p>{escape(str(souci.detail))}</p>", "#C5241A")
    etat = {StatutDemande.APPROUVEE: ("Demande validée", "#12855A"), StatutDemande.REJETEE: ("Demande refusée", "#C5241A")}
    titre, couleur = etat.get(demande.statut, ("Validation enregistrée — en attente du niveau suivant", "#072241"))
    return _html(titre, f"<p>{escape(demande.reference)} — {escape(demande.employe.prenom)} {escape(demande.employe.nom)} "
                        f"a été notifié(e) dans le portail et par e-mail.</p>", couleur)
