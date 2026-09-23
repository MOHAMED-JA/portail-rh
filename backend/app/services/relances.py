"""Relances par e-mail : ce qui dort dans le portail doit ressortir.

Une fois par jour, le portail rappelle par courriel ce qui attend une action :

- **demandes en attente** depuis plus de N heures — au valideur, ou à son
  remplaçant déclaré, avec les boutons Valider / Refuser habituels ;
- **fiches d'objectifs** non soumises ou non validées — au collaborateur et à
  son supérieur ;
- **échéances du dossier RH** (visite médicale, fin d'essai, fin de contrat,
  retraite) — à l'administration RH.

Chaque destinataire ne reçoit qu'un seul message par objet et par jour, même si
le bloc quotidien est rejoué. Sans messagerie configurée, les messages sont
tracés avec le statut « non_configure » : le jour où la DSI fournit le relais
SMTP, ils partent sans autre réglage.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Demande, Employe, FicheObjectifs, StatutDemande, StatutEmploye, StatutFicheObjectifs,
)
from app.services import delegation, emails, parametres
from app.services.sirh import administrateurs_rh, alertes

ALERTES_RELANCEES = ("visite_medicale", "fin_essai", "fin_contrat", "retraite")


def _regles(db: Session) -> dict:
    regles = parametres.lire(db, "regles", {}) or {}
    return {
        "actives": regles.get("relancesActives", parametres.REGLES_DEFAUT["relancesActives"]),
        "heures_demande": regles.get("relanceDemandeHeures", parametres.REGLES_DEFAUT["relanceDemandeHeures"]),
        "jours_fiche": regles.get("relanceFicheJours", parametres.REGLES_DEFAUT["relanceFicheJours"]),
    }


def _envoyer(db: Session, destinataire: Employe | None, sujet: str, corps: str) -> bool:
    if destinataire is None or not destinataire.email or destinataire.statut == StatutEmploye.SORTI:
        return False
    emails.mettre_en_file(db, destinataire.email, sujet, emails.gabarit(sujet, corps))
    return True


def _demandes_en_attente(db: Session, heures: int) -> int:
    """Rappel au valideur — ou à son remplaçant du jour, s'il en a déclaré un."""
    limite = datetime.utcnow() - timedelta(hours=heures)
    envoyes = 0
    demandes = db.scalars(select(Demande).where(
        Demande.statut == StatutDemande.EN_ATTENTE,
        Demande.cree_le <= limite,
        Demande.validateur_id.isnot(None)))
    for demande in demandes:
        titulaire = db.get(Employe, demande.validateur_id)
        if titulaire is None:
            continue
        remplacant = delegation.suppleant_de(db, titulaire.id)
        destinataire = remplacant or titulaire
        attente = (datetime.utcnow() - demande.cree_le).days
        pour = ("" if remplacant is None
                else f" Vous décidez à la place de {escape(titulaire.nom_complet)}, absent(e).")
        corps = (f"<p style='font-size:14px'>Une demande attend votre décision depuis "
                 f"<strong>{max(attente, 1)} jour(s)</strong>.{pour}</p>"
                 f"<p style='font-size:13.5px'>{escape(demande.employe.nom_complet)} — "
                 f"{escape(demande.reference)}, du {demande.date_debut:%d/%m/%Y} au "
                 f"{demande.date_fin:%d/%m/%Y}.</p>"
                 "<p style='font-size:12.5px;color:#7C8CA3'>Sans réponse, la demande sera validée "
                 "automatiquement au terme du délai prévu par les règles RH.</p>")
        if _envoyer(db, destinataire, f"Rappel — demande à valider ({demande.reference})", corps):
            envoyes += 1
    return envoyes


def _fiches_en_retard(db: Session, jours: int) -> int:
    """Fiches d'objectifs qui dorment : au collaborateur, ou à son supérieur."""
    annee = date.today().year
    limite = datetime.utcnow() - timedelta(days=jours)
    envoyes = 0
    fiches = db.scalars(select(FicheObjectifs).where(
        FicheObjectifs.annee == annee,
        FicheObjectifs.statut.in_((StatutFicheObjectifs.BROUILLON, StatutFicheObjectifs.A_CORRIGER,
                                   StatutFicheObjectifs.SOUMISE))))
    for fiche in fiches:
        employe = db.get(Employe, fiche.employe_id)
        if employe is not None and (employe.niveau or "") == "dg":
            continue   # le Directeur général n'a pas de fiche d'objectifs
        if employe is None or employe.statut == StatutEmploye.SORTI:
            continue
        if fiche.statut == StatutFicheObjectifs.SOUMISE:
            if fiche.soumise_le is None or fiche.soumise_le > limite:
                continue
            titulaire = employe.validateur
            destinataire = (delegation.suppleant_de(db, titulaire.id) or titulaire) if titulaire else None
            corps = (f"<p style='font-size:14px'>La fiche d'objectifs {annee} de "
                     f"<strong>{escape(employe.nom_complet)}</strong> attend votre validation "
                     f"depuis le {fiche.soumise_le:%d/%m/%Y}.</p>"
                     "<p style='font-size:12.5px;color:#7C8CA3'>Rubrique « Suivi des fiches » du portail.</p>")
            sujet = f"Rappel — fiche d'objectifs à valider ({employe.matricule})"
        else:
            attendu = "à rédiger" if fiche.statut == StatutFicheObjectifs.BROUILLON else "à corriger"
            destinataire = employe
            corps = (f"<p style='font-size:14px'>Bonjour {escape(employe.prenom)},<br>votre fiche "
                     f"d'objectifs {annee} est toujours <strong>{attendu}</strong>.</p>"
                     + (f"<p style='font-size:13.5px'><strong>Commentaire du supérieur :</strong> "
                        f"{escape(fiche.commentaire_superieur)}</p>" if fiche.commentaire_superieur else "")
                     + "<p style='font-size:12.5px;color:#7C8CA3'>Rubrique « Fiche d'objectifs » du portail.</p>")
            sujet = f"Rappel — votre fiche d'objectifs {annee}"
        if _envoyer(db, destinataire, sujet, corps):
            envoyes += 1
    return envoyes


def _echeances_rh(db: Session) -> int:
    """Visites médicales, fins d'essai, fins de contrat, retraites — à la RH."""
    a_traiter = [a for a in alertes(db) if a["type"] in ALERTES_RELANCEES]
    if not a_traiter:
        return 0
    lignes = "".join(
        f"<li style='margin-bottom:6px'><strong>{escape(a['employe']['prenom'])} "
        f"{escape(a['employe']['nom'])}</strong> — {a['echeance']:%d/%m/%Y} : {escape(a['message'])}</li>"
        for a in sorted(a_traiter, key=lambda x: x["echeance"]))
    corps = (f"<p style='font-size:14px'>{len(a_traiter)} échéance(s) du dossier du personnel "
             f"demandent une action.</p><ul style='font-size:13.5px;padding-left:18px'>{lignes}</ul>"
             "<p style='font-size:12.5px;color:#7C8CA3'>Administration → Alertes RH.</p>")
    envoyes = 0
    for admin in administrateurs_rh(db):
        if _envoyer(db, admin, f"Échéances du personnel — {len(a_traiter)} à traiter", corps):
            envoyes += 1
    return envoyes


def relancer(db: Session, jour: date | None = None) -> dict:
    """Bloc quotidien. Rejouer le même jour ne renvoie rien."""
    regles = _regles(db)
    if not regles["actives"]:
        return {"statut": "relances désactivées"}
    cle = f"relances_du_jour:{jour or date.today()}"
    if parametres.lire(db, cle):
        return {"statut": "déjà exécuté aujourd'hui"}

    resultat = {
        "demandes": _demandes_en_attente(db, int(regles["heures_demande"])),
        "fiches": _fiches_en_retard(db, int(regles["jours_fiche"])),
        "echeances_rh": _echeances_rh(db),
    }
    parametres.ecrire(db, cle, True)
    db.commit()
    return resultat
