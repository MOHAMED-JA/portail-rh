"""E-mails du portail : demandes à valider (avec boutons Valider / Refuser)
et confirmations envoyées aux demandeurs.

Les messages sont mis en file dans la table « emails_sortants » dans la même
transaction que la demande, puis envoyés par un fil d'exécution de fond : une
panne de messagerie ne bloque jamais le dépôt ni la validation. Sans
messagerie configurée, ils restent tracés avec le statut « non_configure ».
"""
from __future__ import annotations

import smtplib
import ssl
import threading
import time as horloge
from datetime import datetime, timedelta
from email.message import EmailMessage
from html import escape

from jose import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import JWT_ALGORITHM, JWT_SECRET
from app.models import Demande, EmailSortant, Employe, TypeDemande
from app.services import parametres

MESSAGERIE_DEFAUT = {
    "actif": False, "serveur": "", "port": 587, "securite": "starttls",
    "utilisateur": "", "mot_de_passe": "", "expediteur": "",
    "url_application": "http://127.0.0.1:8000",
}
TYPES = {TypeDemande.CONGE: "congé", TypeDemande.AUTORISATION: "autorisation d'absence", TypeDemande.MISSION: "ordre de mission"}


def configuration(db: Session) -> dict:
    return {**MESSAGERIE_DEFAUT, **(parametres.lire(db, "messagerie", {}) or {})}


# ------------------------------------------------------------------ Jetons
def jeton_decision(demande: Demande, valideur: Employe, action: str) -> str:
    charge = {"typ": "decision_email", "d": demande.id, "v": valideur.id, "a": action,
              "exp": datetime.utcnow() + timedelta(days=10)}
    return jwt.encode(charge, JWT_SECRET, algorithm=JWT_ALGORITHM)


def lire_jeton(jeton: str) -> dict:
    charge = jwt.decode(jeton, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    if charge.get("typ") != "decision_email" or charge.get("a") not in ("approuver", "rejeter"):
        raise ValueError("Jeton invalide")
    return charge


# ------------------------------------------------------------------ Gabarit
def _page(titre: str, contenu: str) -> str:
    return f"""<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#072241">
  <div style="border-bottom:3px solid #D92D20;padding:14px 0;font-weight:700;font-size:18px">VELTARIS · Portail RH</div>
  <h2 style="font-size:17px;margin:18px 0 10px">{escape(titre)}</h2>
  {contenu}
  <p style="font-size:11.5px;color:#7C8CA3;margin-top:26px">Message automatique du portail RH — merci de ne pas y répondre.</p>
</div>"""


gabarit = _page          # utilise par les autres services (reinitialisation...)


def _resume(demande: Demande) -> str:
    from app.services.demandes import heures_fr, libelle_sous_type

    e = demande.employe
    if demande.type_demande == TypeDemande.AUTORISATION and demande.heure_debut:
        periode = (f"le {demande.date_debut:%d/%m/%Y} de {demande.heure_debut:%H:%M} à {demande.heure_fin:%H:%M} "
                   f"({heures_fr(demande.duree_heures or 0)})")
    else:
        periode = f"du {demande.date_debut:%d/%m/%Y} au {demande.date_fin:%d/%m/%Y} ({demande.nombre_jours:g} jour(s))"
    lignes = [("Collaborateur", f"{e.prenom} {e.nom} ({e.matricule})"),
              ("Demande", f"{TYPES[demande.type_demande].capitalize()} — {libelle_sous_type(demande.type_demande, demande.sous_type)}"),
              ("Période", periode), ("Référence", demande.reference)]
    if demande.commentaire:
        lignes.append(("Commentaire", demande.commentaire))
    return "<table style='border-collapse:collapse;font-size:13.5px;width:100%'>" + "".join(
        f"<tr><td style='padding:6px 10px;color:#4A4E56;width:32%'>{escape(a)}</td>"
        f"<td style='padding:6px 10px'><strong>{escape(str(b))}</strong></td></tr>" for a, b in lignes) + "</table>"


def _bouton(url: str, libelle: str, couleur: str) -> str:
    return (f"<a href='{escape(url)}' style='display:inline-block;padding:11px 22px;margin:6px 8px 0 0;border-radius:8px;"
            f"background:{couleur};color:#fff;text-decoration:none;font-weight:600'>{escape(libelle)}</a>")


def mettre_en_file(db: Session, destinataire: str | None, sujet: str, html: str) -> None:
    if not destinataire or "@" not in destinataire:
        return
    db.add(EmailSortant(destinataire=destinataire.strip(), sujet=sujet[:200], corps_html=html))


# ------------------------------------------------------------------ Messages
def demande_a_valider(db: Session, demande: Demande, valideur: Employe, derogation: bool) -> None:
    config = configuration(db)
    base = config["url_application"].rstrip("/")
    approuver = f"{base}/api/email/decision?jeton={jeton_decision(demande, valideur, 'approuver')}"
    refuser = f"{base}/api/email/decision?jeton={jeton_decision(demande, valideur, 'rejeter')}"
    e = demande.employe
    intro = ("Le quota mensuel d'autorisations est dépassé : <strong>la dérogation relève de la direction RH</strong>."
             if derogation else f"{escape(e.prenom)} {escape(e.nom)} vous a adressé une demande.")
    contenu = (f"<p style='font-size:14px'>{intro}</p>{_resume(demande)}"
               f"<div style='margin-top:18px'>{_bouton(approuver, 'Valider', '#12855A')}{_bouton(refuser, 'Refuser', '#C5241A')}</div>"
               f"<p style='font-size:12px;color:#4A4E56'>Vous pouvez aussi décider depuis le portail, rubrique « À valider ».</p>")
    sujet = f"{'Dérogation' if derogation else 'Demande'} à valider — {e.prenom} {e.nom} — {demande.reference}"
    mettre_en_file(db, valideur.email, sujet, _page(sujet, contenu))


def decision(db: Session, demande: Demande, acteur: Employe, approuve: bool, motif: str | None,
             automatique: bool = False) -> None:
    e = demande.employe
    etat = "validée automatiquement" if automatique else ("approuvée" if approuve else "refusée")
    auteur = ("faute de réponse dans le délai de validation" if automatique
              else f"par {escape(acteur.prenom)} {escape(acteur.nom)}")
    contenu = (f"<p style='font-size:14px'>Bonjour {escape(e.prenom)},<br>votre demande a été "
               f"<strong style='color:{'#12855A' if approuve else '#C5241A'}'>{etat}</strong> "
               f"{auteur}.</p>{_resume(demande)}"
               + (f"<p style='font-size:13.5px'><strong>Motif :</strong> {escape(motif)}</p>" if motif and not approuve else ""))
    sujet = f"Votre demande {demande.reference} a été {etat}"
    mettre_en_file(db, e.email, sujet, _page(sujet, contenu))


# ------------------------------------------------------------------ Envoi
def envoyer_maintenant(config: dict, destinataire: str, sujet: str, html: str) -> None:
    message = EmailMessage()
    message["From"] = config["expediteur"] or config["utilisateur"]
    message["To"] = destinataire
    message["Subject"] = sujet
    message.set_content("Ce message est au format HTML : ouvrez-le dans votre messagerie.")
    message.add_alternative(html, subtype="html")
    port = int(config["port"] or 587)
    if config["securite"] == "ssl":
        serveur = smtplib.SMTP_SSL(config["serveur"], port, context=ssl.create_default_context(), timeout=30)
    else:
        serveur = smtplib.SMTP(config["serveur"], port, timeout=30)
        if config["securite"] == "starttls":
            serveur.starttls(context=ssl.create_default_context())
    try:
        if config["utilisateur"]:
            serveur.login(config["utilisateur"], config["mot_de_passe"])
        serveur.send_message(message)
    finally:
        serveur.quit()


def traiter_file(db: Session) -> int:
    config = configuration(db)
    en_file = db.scalars(select(EmailSortant).where(EmailSortant.statut == "en_file").order_by(EmailSortant.id).limit(20)).all()
    for mail in en_file:
        if not (config["actif"] and config["serveur"]):
            mail.statut = "non_configure"
            continue
        mail.tentatives += 1
        try:
            envoyer_maintenant(config, mail.destinataire, mail.sujet, mail.corps_html)
            mail.statut, mail.envoye_le, mail.erreur = "envoye", datetime.utcnow(), None
        except Exception as souci:  # noqa: BLE001 — l'erreur est tracée, le message réessayé
            mail.erreur = f"{type(souci).__name__} : {souci}"[:500]
            if mail.tentatives >= 3:
                mail.statut = "erreur"
    db.commit()
    return len(en_file)


def demarrer_expediteur(fabrique_session) -> None:
    """Fil de fond : vide la file toutes les 20 secondes."""
    from app.services import supervision

    def boucle():
        while True:
            def traiter():
                with fabrique_session() as db:
                    return traiter_file(db)

            # Un succès est consolidé au plus toutes les cinq minutes afin de
            # ne pas écrire en base toutes les vingt secondes. Un échec est
            # toujours enregistré immédiatement.
            supervision.executer("expediteur_emails", traiter, intervalle_succes=300)
            horloge.sleep(20)

    threading.Thread(target=boucle, name="expediteur-emails", daemon=True).start()
