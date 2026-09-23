"""Générateur de documents RH : attestations, certificats, ordres de mission.

Chaque document est numéroté (ATT-2026-00001…), porte un QR code et un code de
vérification, et entre au registre avec l'empreinte SHA-256 du PDF. Le PDF est
rangé hors de l'espace public ``/fichiers`` (il peut contenir un salaire) :
seuls la RH et l'intéressé le téléchargent. Un document n'est jamais supprimé ;
il peut être annulé, ce que la page de vérification affiche.

Aucune donnée n'est inventée : un champ requis absent bloque l'émission.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import date, datetime
from html import escape

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import DATA_DIR
from app.models import DemandeDocument, DocumentEmis, Employe, StatutEmploye
from app.services import remuneration
from app.services.demandes import solde_courant
from app.services.documents import EnteteDocument, bloc_verification, fiche_cle_valeur, generer_pdf, paragraphe, tableau_donnees
from app.services.notifications import notifier

DOSSIER = DATA_DIR / "documents_emis"
SIGNATAIRE = "Directeur des Ressources Humaines"
MOTIF = {"cle": "motif", "libelle": "Délivré pour (facultatif)", "type": "texte", "requis": False}
TYPES: dict[str, dict] = {
    "attestation_travail": {"libelle": "Attestation de travail", "prefixe": "ATT", "champs": [MOTIF]},
    "certificat_travail": {"libelle": "Certificat de travail", "prefixe": "CRT", "champs": [MOTIF]},
    "attestation_salaire": {"libelle": "Attestation de salaire", "prefixe": "SAL", "champs": [
        {"cle": "salaire_brut", "libelle": "Salaire brut mensuel (DT)", "type": "nombre", "requis": True},
        {"cle": "salaire_net", "libelle": "Salaire net mensuel (DT)", "type": "nombre", "requis": False}, MOTIF]},
    "domiciliation_salaire": {"libelle": "Attestation de domiciliation de salaire", "prefixe": "DOM", "champs": [
        {"cle": "banque", "libelle": "Banque", "type": "texte", "requis": True},
        {"cle": "rib", "libelle": "RIB (20 chiffres)", "type": "texte", "requis": True}]},
    "attestation_conges": {"libelle": "Attestation de congés", "prefixe": "CNG", "champs": [MOTIF]},
    "ordre_mission": {"libelle": "Ordre de mission", "prefixe": "OM", "champs": [
        {"cle": "destination", "libelle": "Destination", "type": "texte", "requis": True},
        {"cle": "objet", "libelle": "Objet de la mission", "type": "texte", "requis": True},
        {"cle": "date_debut", "libelle": "Du", "type": "date", "requis": True},
        {"cle": "date_fin", "libelle": "Au", "type": "date", "requis": True},
        {"cle": "transport", "libelle": "Moyen de transport", "type": "texte", "requis": False}]},
}


def dinars(valeur: float) -> str:
    return f"{valeur:,.3f}".replace(",", " ").replace(".", ",") + " DT"


def _nom(e: Employe) -> str:
    return escape(f"{e.prenom} {e.nom}")


def pre_remplissage(db: Session, e: Employe, type_document: str) -> dict:
    """Valeurs connues du portail, que la RH peut corriger avant d'émettre."""
    r = remuneration.lire(db, e.id)
    valeurs: dict = {}
    if type_document == "attestation_salaire" and r:
        valeurs["salaire_brut"] = round(remuneration.mensuel_brut(r), 3)
        if r["salaire_net"] is not None:
            valeurs["salaire_net"] = r["salaire_net"]
    if type_document == "domiciliation_salaire" and r:
        valeurs.update({k: r[k] for k in ("banque", "rib") if r[k]})
    return valeurs


def _normaliser(type_document: str, champs: dict) -> dict:
    valeurs = {}
    for champ in TYPES[type_document]["champs"]:
        brut = champs.get(champ["cle"])
        brut = brut.strip() if isinstance(brut, str) else brut
        if brut in (None, ""):
            if champ["requis"]:
                raise HTTPException(status_code=422, detail=f"Champ requis : {champ['libelle']}.")
            continue
        if champ["type"] == "nombre":
            try:
                nombre = float(str(brut).replace(",", ".").replace(" ", ""))
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{champ['libelle']} : montant invalide.") from None
            if nombre <= 0:
                raise HTTPException(status_code=422, detail=f"{champ['libelle']} : le montant doit être positif.")
            valeurs[champ["cle"]] = nombre
        elif champ["type"] == "date":
            try:
                valeurs[champ["cle"]] = date.fromisoformat(str(brut)).isoformat()
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{champ['libelle']} : date invalide.") from None
        else:
            valeurs[champ["cle"]] = str(brut)[:200]
    if type_document == "domiciliation_salaire":
        rib = re.sub(r"\D", "", valeurs["rib"])
        if len(rib) != 20:
            raise HTTPException(status_code=422, detail="Le RIB doit comporter 20 chiffres.")
        valeurs["rib"] = rib
    if type_document == "ordre_mission" and valeurs["date_fin"] < valeurs["date_debut"]:
        raise HTTPException(status_code=422, detail="La mission se termine avant de commencer.")
    return valeurs


def _contenu(db: Session, type_document: str, e: Employe, v: dict) -> tuple[list, str | None]:
    """Corps du document et observation éventuelle."""
    direction = escape(e.departement.nom) if e.departement else "—"
    poste = escape(e.poste or "—")
    entree = e.date_entree.strftime("%d/%m/%Y") if e.date_entree else None
    motif = f"Délivré(e) pour : {escape(v['motif'])}." if v.get("motif") else None
    # Nom et matricule figurent déjà dans la phrase d'attestation : le document tient sur une page.
    identite = [("Poste occupé", poste), ("Direction", direction)]

    if type_document == "attestation_travail":
        depuis = f" depuis le {entree}" if entree else ""
        return (paragraphe(f"Nous soussignés, <b>Veltaris</b>, attestons que <b>{_nom(e)}</b>, matricule "
                           f"{e.matricule}, fait partie de nos effectifs{depuis} et y occupe à ce jour le poste de "
                           f"<b>{poste}</b>.")
                + fiche_cle_valeur(identite + [("Date d'entrée", entree or "Non renseignée")], "Renseignements")
                + paragraphe("La présente attestation est délivrée à l'intéressé(e), sur sa demande, pour servir et "
                             "valoir ce que de droit."), motif)

    if type_document == "certificat_travail":
        if not entree:
            raise HTTPException(status_code=422, detail="Date d'entrée non renseignée : complétez le dossier avant d'émettre ce certificat.")
        if e.statut == StatutEmploye.SORTI and e.date_sortie:
            periode = f"du {entree} au {e.date_sortie:%d/%m/%Y}"
            phrase = f"a été employé(e) au sein de notre compagnie {periode}, en dernier lieu en qualité de <b>{poste}</b>"
        else:
            periode = f"depuis le {entree}"
            phrase = f"est employé(e) au sein de notre compagnie {periode}, en qualité de <b>{poste}</b>"
        return (paragraphe(f"Nous soussignés, <b>Veltaris</b>, certifions que <b>{_nom(e)}</b>, matricule "
                           f"{e.matricule}, {phrase}.")
                + fiche_cle_valeur(identite + [("Période d'emploi", periode)], "Renseignements")
                + paragraphe("Le présent certificat est délivré pour servir et valoir ce que de droit."), motif)

    if type_document == "attestation_salaire":
        lignes = [("Salaire brut mensuel", dinars(v["salaire_brut"]))]
        if v.get("salaire_net"):
            lignes.append(("Salaire net mensuel", dinars(v["salaire_net"])))
        return (paragraphe(f"Nous soussignés, <b>Veltaris</b>, attestons que <b>{_nom(e)}</b>, matricule "
                           f"{e.matricule}, {'employé(e) depuis le ' + entree + ', ' if entree else ''}perçoit la "
                           f"rémunération mensuelle indiquée ci-dessous.")
                + fiche_cle_valeur(identite, "Collaborateur") + fiche_cle_valeur(lignes, "Rémunération")
                + paragraphe("La présente attestation est délivrée à l'intéressé(e), sur sa demande, pour servir et "
                             "valoir ce que de droit."), motif)

    if type_document == "domiciliation_salaire":
        rib = v["rib"]
        rib_lisible = f"{rib[:2]} {rib[2:5]} {rib[5:18]} {rib[18:]}"
        return (paragraphe(f"Nous soussignés, <b>Veltaris</b>, attestons que le salaire de <b>{_nom(e)}</b>, "
                           f"matricule {e.matricule}, est domicilié au compte ci-dessous. Nous nous engageons à ne pas "
                           f"modifier cette domiciliation sans l'accord écrit de la banque, sauf cessation de fonctions "
                           f"de l'intéressé(e), auquel cas la banque en sera informée.")
                + fiche_cle_valeur(identite, "Collaborateur")
                + fiche_cle_valeur([("Banque", escape(v["banque"])), ("RIB", rib_lisible)], "Domiciliation"), None)

    if type_document == "attestation_conges":
        solde = solde_courant(db, e.id)
        return (paragraphe(f"Nous soussignés, <b>Veltaris</b>, attestons de la situation des congés de "
                           f"<b>{_nom(e)}</b>, matricule {e.matricule}, arrêtée au {date.today():%d/%m/%Y}.")
                + fiche_cle_valeur(identite, "Collaborateur")
                + tableau_donnees(["Exercice", "Jours acquis", "Report antérieur", "Jours pris", "Solde restant"],
                                  [[str(solde.annee), f"{solde.jours_acquis:g} j", f"{solde.report_anterieur:g} j",
                                    f"{solde.jours_pris:g} j", f"{solde.jours_restants:g} j"]],
                                  titre_section="Situation des congés"), motif)

    # Ordre de mission
    du, au = date.fromisoformat(v["date_debut"]), date.fromisoformat(v["date_fin"])
    return (paragraphe(f"La Direction des Ressources Humaines de <b>Veltaris</b> donne ordre à <b>{_nom(e)}</b>, "
                       f"matricule {e.matricule}, de se rendre en mission dans les conditions ci-dessous.")
            + fiche_cle_valeur(identite, "Missionnaire")
            + fiche_cle_valeur([("Destination", escape(v["destination"])), ("Objet", escape(v["objet"])),
                                ("Période", f"du {du:%d/%m/%Y} au {au:%d/%m/%Y} ({(au - du).days + 1} jour(s))"),
                                ("Moyen de transport", escape(v.get("transport") or "À préciser"))], "Mission"), None)


def _numero(db: Session, prefixe: str) -> str:
    annee = date.today().year
    debut = f"{prefixe}-{annee}-"
    derniers = db.scalars(select(DocumentEmis.numero).where(DocumentEmis.numero.like(f"{debut}%")))
    rang = max((int(n.rsplit("-", 1)[1]) for n in derniers), default=0) + 1
    return f"{debut}{rang:05d}"


def _code() -> str:
    brut = secrets.token_hex(6).upper()
    return f"{brut[:4]}-{brut[4:8]}-{brut[8:]}"


def adresse_verification(base: str, code: str) -> str:
    return f"{base.rstrip('/')}/api/generateur/verifier/{code}"


def _reserver(db: Session, type_document: str, e: Employe, valeurs: dict, emetteur: Employe,
              demande: DemandeDocument | None) -> DocumentEmis:
    """Réserve numéro et code de vérification en base avant toute écriture de
    fichier : deux émissions simultanées ne visent plus le même PDF. Si le
    numéro lu vient d'être pris par une autre émission, la transaction est
    annulée et un nouveau numéro est tiré — generer() doit donc rester la
    première écriture de la requête."""
    prefixe = TYPES[type_document]["prefixe"]
    for _ in range(5):
        numero = _numero(db, prefixe)
        document = DocumentEmis(numero=numero, type_document=type_document, employe_id=e.id,
                                demande_id=demande.id if demande else None, emis_par_id=emetteur.id,
                                emis_le=datetime.utcnow(), code_verification=_code(), empreinte="",
                                fichier=f"{numero}.pdf", donnees=json.dumps(valeurs, ensure_ascii=False))
        db.add(document)
        try:
            db.flush()
            return document
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=409, detail="Numérotation momentanément occupée : relancez l'émission du document.")


def generer(db: Session, type_document: str, e: Employe, champs: dict, emetteur: Employe, base: str,
            demande: DemandeDocument | None = None) -> DocumentEmis:
    if type_document not in TYPES:
        raise HTTPException(status_code=422, detail="Type de document inconnu.")
    definition = TYPES[type_document]
    valeurs = _normaliser(type_document, champs or {})
    contenu, observation = _contenu(db, type_document, e, valeurs)
    document = _reserver(db, type_document, e, valeurs, emetteur, demande)
    numero, code = document.numero, document.code_verification
    contenu += bloc_verification(adresse_verification(base, code), numero, code)
    entete = EnteteDocument(definition["libelle"], sous_titre="Délivré(e) par la Direction des Ressources Humaines",
                            reference=numero, edite_par=f"{emetteur.prenom} {emetteur.nom}")
    pdf = generer_pdf(entete, contenu, observation=observation, signataire=SIGNATAIRE, compact=True).getvalue()

    # Fichier provisoire propre à cette émission, publié d'un seul coup sous
    # le numéro réservé : jamais de PDF à moitié écrit ni écrasé par un autre.
    DOSSIER.mkdir(parents=True, exist_ok=True)
    provisoire = DOSSIER / f"{numero}.{secrets.token_hex(4)}.tmp"
    try:
        provisoire.write_bytes(pdf)
        os.replace(provisoire, DOSSIER / document.fichier)
    finally:
        provisoire.unlink(missing_ok=True)
    document.empreinte = hashlib.sha256(pdf).hexdigest()
    db.flush()
    if demande is not None:
        demande.fichier = f"/api/generateur/{document.id}/pdf"
        demande.statut = "prete"
        demande.traitee_le = datetime.utcnow()
    notifier(db, e.id, "Document RH disponible",
             f"{definition['libelle']} n° {numero} : téléchargeable dans « Mes documents ».", "succes", "/documents")
    return document
