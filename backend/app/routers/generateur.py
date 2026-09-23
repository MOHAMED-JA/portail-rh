"""Générateur de documents RH : émission, registre, annulation et vérification.

Émission, registre et annulation : personnel RH. Téléchargement : RH et
intéressé. Vérification par code ou QR code : publique, sans donnée sensible
(type, numéro, date, titulaire, validité)."""
from __future__ import annotations

import json
from datetime import datetime
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import ROLES_RH, DemandeDocument, DocumentEmis, Employe, JournalAudit
from app.services import generateur as svc
from app.services.notifications import notifier

router = APIRouter(prefix="/api/generateur", tags=["Générateur de documents"])


class GenerationPayload(BaseModel):
    matricule: str
    type_document: str
    champs: dict = Field(default_factory=dict)
    demande_id: int | None = None


class AnnulationPayload(BaseModel):
    motif: str = Field(min_length=3, max_length=255)


def _employe(db: Session, matricule: str) -> Employe:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")
    return e


def _json(d: DocumentEmis, avec_donnees: bool = False) -> dict:
    resultat = {
        "id": d.id, "numero": d.numero, "type": d.type_document,
        "libelle": svc.TYPES.get(d.type_document, {}).get("libelle", d.type_document),
        "employe": {"matricule": d.employe.matricule, "nom": d.employe.nom, "prenom": d.employe.prenom},
        "emis_le": d.emis_le, "emis_par": f"{d.emis_par.prenom} {d.emis_par.nom}" if d.emis_par else None,
        "code": d.code_verification, "annule_le": d.annule_le, "motif_annulation": d.motif_annulation,
        "demande_id": d.demande_id,
    }
    if avec_donnees:
        resultat["donnees"] = json.loads(d.donnees or "{}")
    return resultat


@router.get("/types", summary="Types de documents et champs à renseigner (RH)")
def types(utilisateur: Employe = Depends(admin_requis)):
    return [{"type": k, "libelle": v["libelle"], "champs": v["champs"]} for k, v in svc.TYPES.items()]


@router.get("/pre-remplissage/{matricule}", summary="Valeurs connues pour un document (RH)")
def pre_remplissage(matricule: str, type_document: str, db: Session = Depends(get_db),
                    utilisateur: Employe = Depends(admin_requis)):
    if type_document not in svc.TYPES:
        raise HTTPException(status_code=422, detail="Type de document inconnu.")
    return svc.pre_remplissage(db, _employe(db, matricule), type_document)


@router.post("/generer", summary="Émettre un document numéroté avec QR code (RH)")
def generer(payload: GenerationPayload, requete: Request, db: Session = Depends(get_db),
            utilisateur: Employe = Depends(admin_requis)):
    e = _employe(db, payload.matricule)
    demande = None
    if payload.demande_id is not None:
        demande = db.get(DemandeDocument, payload.demande_id)
        if not demande or demande.employe_id != e.id:
            raise HTTPException(status_code=404, detail="Demande de document introuvable pour ce collaborateur.")
    document = svc.generer(db, payload.type_document, e, payload.champs, utilisateur, str(requete.base_url), demande)
    db.add(JournalAudit(acteur_id=utilisateur.id, action="document_emis", cible=e.matricule,
                        detail=f"{document.numero} — {svc.TYPES[payload.type_document]['libelle']}"))
    db.commit()
    return _json(document)


@router.get("/registre", summary="Registre des documents émis (RH)")
def registre(q: str | None = None, type_document: str | None = None, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(admin_requis)):
    requete = select(DocumentEmis).join(Employe, Employe.id == DocumentEmis.employe_id).order_by(DocumentEmis.emis_le.desc())
    if type_document:
        requete = requete.where(DocumentEmis.type_document == type_document)
    if q and q.strip():
        motif = f"%{q.strip()}%"
        requete = requete.where(or_(DocumentEmis.numero.ilike(motif), Employe.nom.ilike(motif),
                                    Employe.prenom.ilike(motif), Employe.matricule.ilike(motif)))
    return [_json(d) for d in db.scalars(requete.limit(500))]


@router.get("/mes-documents", summary="Documents émis à mon nom")
def mes_documents(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return [_json(d) for d in db.scalars(select(DocumentEmis).where(
        DocumentEmis.employe_id == utilisateur.id, DocumentEmis.annule_le.is_(None)).order_by(DocumentEmis.emis_le.desc()))]


@router.get("/{document_id}/pdf", summary="Télécharger un document émis (RH ou intéressé)")
def telecharger(document_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    d = db.get(DocumentEmis, document_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    rh = utilisateur.role in ROLES_RH
    if not rh and (d.employe_id != utilisateur.id or d.annule_le):
        raise HTTPException(status_code=403, detail="Document réservé à l'intéressé et à la RH.")
    chemin = svc.DOSSIER / d.fichier
    if not chemin.is_file():
        raise HTTPException(status_code=404, detail="Fichier du document introuvable sur le serveur.")
    return FileResponse(chemin, media_type="application/pdf", filename=f"RH-{d.numero}.pdf")


@router.post("/{document_id}/annuler", summary="Annuler un document émis (RH)")
def annuler(document_id: int, payload: AnnulationPayload, db: Session = Depends(get_db),
            utilisateur: Employe = Depends(admin_requis)):
    d = db.get(DocumentEmis, document_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    if d.annule_le:
        raise HTTPException(status_code=409, detail="Document déjà annulé.")
    d.annule_le, d.annule_par_id, d.motif_annulation = datetime.utcnow(), utilisateur.id, payload.motif.strip()
    db.add(JournalAudit(acteur_id=utilisateur.id, action="document_annule", cible=d.numero, detail=d.motif_annulation))
    notifier(db, d.employe_id, "Document RH annulé", f"Le document n° {d.numero} a été annulé : {d.motif_annulation}.",
             "alerte", "/documents")
    db.commit()
    return _json(d)


def _verification(db: Session, code: str) -> dict:
    code = code.strip().upper()
    d = db.scalar(select(DocumentEmis).where(DocumentEmis.code_verification == code))
    if not d:
        return {"trouve": False, "code": code}
    return {"trouve": True, "valide": d.annule_le is None, "numero": d.numero,
            "libelle": svc.TYPES.get(d.type_document, {}).get("libelle", d.type_document),
            "titulaire": f"{d.employe.prenom} {d.employe.nom}", "emis_le": d.emis_le.strftime("%d/%m/%Y"),
            "annule_le": d.annule_le.strftime("%d/%m/%Y") if d.annule_le else None, "code": code}


@router.get("/verifier/{code}", summary="Vérifier l'authenticité d'un document (public)")
def verifier(code: str, format: str | None = None, db: Session = Depends(get_db)):
    v = _verification(db, code)
    if format == "json":
        return v
    if not v["trouve"]:
        couleur, titre, detail = "#D92D20", "Document inconnu", "Aucun document émis par Veltaris ne porte ce code."
    elif v["valide"]:
        couleur, titre = "#1E8E5A", "Document authentique"
        detail = f"{escape(v['libelle'])} n° {escape(v['numero'])}, émis le {v['emis_le']} au nom de {escape(v['titulaire'])}."
    else:
        couleur, titre = "#D92D20", "Document annulé"
        detail = f"{escape(v['libelle'])} n° {escape(v['numero'])} a été annulé le {v['annule_le']}. Il n'a plus de valeur."
    return HTMLResponse(f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Vérification d'un document — Veltaris</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#F0F3F9;margin:0;padding:24px;color:#072241">
<main style="max-width:520px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;border-top:5px solid {couleur}">
<p style="font-size:12px;letter-spacing:.08em;color:#7C8CA3;margin:0 0 6px">VELTARIS — DIRECTION DES RESSOURCES HUMAINES</p>
<h1 style="font-size:22px;margin:0 0 12px;color:{couleur}">{titre}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 14px">{detail}</p>
<p style="font-size:12px;color:#7C8CA3;margin:0">Code vérifié : {escape(v['code'])}</p></main></body></html>""")
