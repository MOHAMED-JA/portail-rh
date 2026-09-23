"""Services SIRH : report des congés, alertes RH, parcours d'arrivée et de
départ, sauvegardes quotidiennes."""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import DATA_DIR, DATABASE_URL
from app.models import (
    AccordReport,
    ClotureConges,
    DossierEmploye,
    Employe,
    JournalAudit,
    ParcoursRH,
    Role,
    SoldeConge,
    StatutEmploye,
    TacheParcours,
)
from app.services import parametres
from app.services.demandes import administrateurs_rh
from app.services.notifications import notifier


def fr(n: float) -> str:
    return f"{n:g}".replace(".", ",")


def plafond_report() -> float:
    return float(parametres.REGLES.get("plafondReport", 15))


# --------------------------------------------------------------------------
# Report des congés : au 31/12, pas plus de 15 jours, sauf accord de la RH
# --------------------------------------------------------------------------
def situation_report(db: Session, annee: int) -> list[dict]:
    """Collaborateurs dont le solde de l'exercice dépasse le plafond de report."""
    plafond = plafond_report()
    accords = {a.employe_id: a for a in db.scalars(select(AccordReport).where(AccordReport.annee == annee))}
    lignes = []
    soldes = db.scalars(select(SoldeConge).join(Employe, Employe.id == SoldeConge.employe_id).where(
        SoldeConge.annee == annee, Employe.statut != StatutEmploye.SORTI))
    for solde in soldes:
        restant = solde.jours_restants
        if restant <= plafond:
            continue
        accord = accords.get(solde.employe_id)
        supplement = min(accord.jours_supplementaires, restant - plafond) if accord else 0
        e = solde.employe
        lignes.append({
            "employe": {"id": e.id, "matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
                        "departement": e.departement.code if e.departement else None},
            "solde": restant, "excedent": round(restant - plafond, 2),
            "accord": {"jours": accord.jours_supplementaires, "motif": accord.motif,
                       "le": accord.accorde_le} if accord else None,
            "reporte_prevu": round(plafond + supplement, 2), "perdu_prevu": round(restant - plafond - supplement, 2),
        })
    return sorted(lignes, key=lambda l: -l["excedent"])


def notifier_excedents(db: Session, annee: int, rappel: str = "") -> int:
    """Prévient chaque collaborateur concerné (et la RH) avant la clôture."""
    lignes = situation_report(db, annee)
    plafond = plafond_report()
    for l in lignes:
        if l["accord"]:
            continue
        notifier(db, l["employe"]["id"], "Congés : risque de perte au 31/12",
                 f"{rappel}Votre solde {annee} est de {fr(l['solde'])} jours. Au 31 décembre, seuls {fr(plafond)} jours "
                 f"sont reportés : {fr(l['excedent'])} jour(s) seront perdus, sauf accord de la direction RH. "
                 "Posez vos congés ou adressez une demande de report à la RH.", "alerte", "/mes-demandes")
    if lignes:
        for admin in administrateurs_rh(db):
            notifier(db, admin.id, "Report des congés à arbitrer",
                     f"{len(lignes)} collaborateur(s) dépassent {fr(plafond)} jours pour {annee}.", "validation",
                     "/administration")
    db.commit()
    return len(lignes)


def cloturer(db: Session, annee: int) -> list[dict]:
    """Clôture de l'exercice : report plafonné (+ accord RH), le reste est perdu."""
    plafond = plafond_report()
    accords = {a.employe_id: a for a in db.scalars(select(AccordReport).where(AccordReport.annee == annee))}
    resultats = []
    for solde in db.scalars(select(SoldeConge).where(SoldeConge.annee == annee)).all():
        if db.scalar(select(ClotureConges.id).where(ClotureConges.employe_id == solde.employe_id,
                                                    ClotureConges.annee == annee)):
            continue
        restant = max(0.0, solde.jours_restants)
        accord = accords.get(solde.employe_id)
        reporte = min(restant, plafond + (accord.jours_supplementaires if accord else 0))
        perdu = round(restant - reporte, 2)
        suivant = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == solde.employe_id,
                                                     SoldeConge.annee == annee + 1))
        if suivant is None:
            suivant = SoldeConge(employe_id=solde.employe_id, annee=annee + 1, jours_acquis=0, jours_pris=0)
            db.add(suivant)
        suivant.report_anterieur = round(reporte, 2)
        db.add(ClotureConges(employe_id=solde.employe_id, annee=annee, solde_final=restant,
                             reporte=round(reporte, 2), perdu=perdu))
        if solde.employe.statut != StatutEmploye.SORTI and (reporte or perdu):
            notifier(db, solde.employe_id, f"Clôture des congés {annee}",
                     f"{fr(reporte)} jour(s) reporté(s) sur {annee + 1}"
                     + (f", {fr(perdu)} jour(s) perdu(s) (au-delà de {fr(plafond)} jours sans accord RH)." if perdu else "."),
                     "alerte" if perdu else "info", "/mes-demandes")
        resultats.append({"employe_id": solde.employe_id, "reporte": reporte, "perdu": perdu})
    db.add(JournalAudit(action="cloture_conges", cible=str(annee), detail=f"{len(resultats)} solde(s) clôturé(s)"))
    db.commit()
    return resultats


def taches_report(db: Session, aujourdhui: date | None = None) -> None:
    """Calendrier automatique : alerte le 1er et le 15 décembre, clôture le 1er janvier."""
    aujourdhui = aujourdhui or date.today()
    if aujourdhui.month == 12 and aujourdhui.day >= 1:
        for jour, rappel in ((1, ""), (15, "Rappel : ")):
            cle = f"report_alerte:{aujourdhui.year}-12-{jour:02d}"
            if aujourdhui.day >= jour and not parametres.lire(db, cle):
                notifier_excedents(db, aujourdhui.year, rappel)
                parametres.ecrire(db, cle, True)
                db.commit()
    annee_close = aujourdhui.year - 1
    cle = f"cloture_conges:{annee_close}"
    if not parametres.lire(db, cle) and db.scalar(select(SoldeConge.id).where(SoldeConge.annee == annee_close)):
        if aujourdhui >= date(aujourdhui.year, 1, 1):
            cloturer(db, annee_close)
            parametres.ecrire(db, cle, datetime.now().isoformat(timespec="seconds"))
            db.commit()


# --------------------------------------------------------------------------
# Alertes RH automatiques
# --------------------------------------------------------------------------
AGE_RETRAITE = 60


def _anniversaire(d: date, annee: int) -> date:
    try:
        return d.replace(year=annee)
    except ValueError:   # 29 février
        return date(annee, 3, 1)


def alertes(db: Session, aujourdhui: date | None = None) -> list[dict]:
    aujourdhui = aujourdhui or date.today()
    resultats = []
    employes = db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)).all()
    dossiers = {d.employe_id: d for d in db.scalars(select(DossierEmploye))}

    def ajouter(e, type_alerte, echeance, message, niveau):
        resultats.append({"employe": {"id": e.id, "matricule": e.matricule, "nom": e.nom, "prenom": e.prenom,
                                      "poste": e.poste, "departement": e.departement.code if e.departement else None},
                          "type": type_alerte, "echeance": echeance, "jours": (echeance - aujourdhui).days,
                          "message": message, "niveau": niveau})

    for e in employes:
        d = dossiers.get(e.id)
        if d and d.date_fin_essai and -7 <= (d.date_fin_essai - aujourdhui).days <= 15:
            ajouter(e, "fin_essai", d.date_fin_essai, "Fin de période d'essai : confirmer ou non l'engagement.", "alerte")
        if d and d.date_fin_contrat and d.type_contrat and d.type_contrat.upper() != "CDI" \
                and -7 <= (d.date_fin_contrat - aujourdhui).days <= 30:
            ajouter(e, "fin_contrat", d.date_fin_contrat, f"Fin de {d.type_contrat} : renouveler, titulariser ou préparer le départ.", "alerte")
        if d and d.date_naissance:
            retraite = _anniversaire(d.date_naissance, d.date_naissance.year + AGE_RETRAITE)
            if 0 <= (retraite - aujourdhui).days <= 180:
                ajouter(e, "retraite", retraite, f"Départ à la retraite ({AGE_RETRAITE} ans) : préparer le dossier et la succession.", "info")
        if d and d.visite_medicale_le:
            prochaine = d.visite_medicale_le + timedelta(days=30 * (d.visite_periodicite_mois or 12))
            if (prochaine - aujourdhui).days <= 30:
                ajouter(e, "visite_medicale", prochaine, "Visite médicale du travail à renouveler.",
                        "alerte" if prochaine < aujourdhui else "info")
        if e.date_entree:
            anniversaire = _anniversaire(e.date_entree, aujourdhui.year)
            annees = aujourdhui.year - e.date_entree.year
            if annees >= 1 and 0 <= (anniversaire - aujourdhui).days <= 7:
                ajouter(e, "anciennete", anniversaire, f"{annees} an(s) d'ancienneté.", "info")
    return sorted(resultats, key=lambda a: a["jours"])


def notifier_alertes(db: Session) -> int:
    """Chaque alerte n'est notifiée qu'une fois (RH, et manager pour essai / CDD)."""
    envoyees = set(parametres.lire(db, "alertes_envoyees", []) or [])
    nouvelles = 0
    admins = administrateurs_rh(db)
    for a in alertes(db):
        cle = f"{a['type']}:{a['employe']['id']}:{a['echeance']}"
        if cle in envoyees:
            continue
        titre = {"fin_essai": "Fin de période d'essai", "fin_contrat": "Fin de contrat", "retraite": "Départ à la retraite",
                 "visite_medicale": "Visite médicale", "anciennete": "Anniversaire d'ancienneté"}[a["type"]]
        message = f"{a['employe']['prenom']} {a['employe']['nom']} — {a['echeance']:%d/%m/%Y} : {a['message']}"
        for admin in admins:
            notifier(db, admin.id, titre, message, a["niveau"], "/administration")
        if a["type"] in ("fin_essai", "fin_contrat"):
            e = db.get(Employe, a["employe"]["id"])
            if e and e.validateur_id and e.validateur_id not in {x.id for x in admins}:
                notifier(db, e.validateur_id, titre, message, a["niveau"], "/organigramme")
        envoyees.add(cle)
        nouvelles += 1
    parametres.ecrire(db, "alertes_envoyees", sorted(envoyees)[-2000:])
    db.commit()
    return nouvelles


# --------------------------------------------------------------------------
# Parcours d'arrivée et de départ
# --------------------------------------------------------------------------
MODELES_PARCOURS = {
    "arrivee": [
        ("Créer le compte du portail RH et remettre le mot de passe provisoire", "RH", 0),
        ("Constituer le dossier (contrat signé, pièce d'identité, diplômes, RIB)", "RH", 3),
        ("Déclarer l'embauche à la CNSS", "RH", 5),
        ("Programmer la visite médicale d'embauche", "RH", 15),
        ("Créer la messagerie et les accès informatiques", "DSI", 0),
        ("Remettre le poste de travail et le matériel", "DSI", 0),
        ("Enregistrer le badge d'accès et de pointage", "DSI", 0),
        ("Accueillir, présenter l'équipe et les missions", "Manager", 0),
        ("Fixer les objectifs de la période d'essai", "Manager", 7),
        ("Inscrire à la formation d'accueil", "RH", 30),
    ],
    "depart": [
        ("Récupérer le matériel (ordinateur, téléphone, clés)", "Manager", 0),
        ("Désactiver le badge d'accès et de pointage", "DSI", 0),
        ("Fermer la messagerie et les accès informatiques", "DSI", 0),
        ("Organiser la passation des dossiers en cours", "Manager", -5),
        ("Conduire l'entretien de sortie", "RH", -2),
        ("Établir le solde de tout compte (congés restants, primes)", "RH", 5),
        ("Remettre le certificat de travail", "RH", 5),
        ("Déclarer la sortie à la CNSS", "RH", 10),
    ],
}


def creer_parcours(db: Session, employe: Employe, type_parcours: str, date_reference: date | None = None) -> ParcoursRH:
    existant = db.scalar(select(ParcoursRH).where(ParcoursRH.employe_id == employe.id,
                                                  ParcoursRH.type_parcours == type_parcours,
                                                  ParcoursRH.termine_le.is_(None)))
    if existant:
        return existant
    reference = date_reference or date.today()
    parcours = ParcoursRH(employe_id=employe.id, type_parcours=type_parcours, date_reference=reference)
    for ordre, (libelle, responsable, decalage) in enumerate(MODELES_PARCOURS[type_parcours]):
        parcours.taches.append(TacheParcours(ordre=ordre, libelle=libelle, responsable=responsable,
                                             echeance=reference + timedelta(days=decalage)))
    db.add(parcours)
    if employe.validateur_id:
        notifier(db, employe.validateur_id, "Arrivée dans votre équipe" if type_parcours == "arrivee" else "Départ dans votre équipe",
                 f"{employe.prenom} {employe.nom} : des tâches vous sont confiées dans le parcours "
                 f"{'d’arrivée' if type_parcours == 'arrivee' else 'de départ'}.", "info", "/administration")
    return parcours


# --------------------------------------------------------------------------
# Sauvegardes quotidiennes de la base
# --------------------------------------------------------------------------
DOSSIER_SAUVEGARDES = DATA_DIR / "sauvegardes"
CONSERVATION = 30


def sauvegarder(force: bool = False) -> str | None:
    """Copie cohérente de la base SQLite (une par jour, 30 conservées)."""
    if not DATABASE_URL.startswith("sqlite:///"):
        return None
    source = DATABASE_URL.replace("sqlite:///", "", 1)
    DOSSIER_SAUVEGARDES.mkdir(parents=True, exist_ok=True)
    maintenant = datetime.now()
    cible = DOSSIER_SAUVEGARDES / (f"portail-{maintenant:%Y%m%d}" + (f"-{maintenant:%H%M%S}" if force else "") + ".db")
    if cible.exists() and not force:
        return cible.name
    with sqlite3.connect(source) as origine, sqlite3.connect(str(cible)) as copie:
        origine.backup(copie)
    anciennes = sorted(DOSSIER_SAUVEGARDES.glob("portail-*.db"))
    for fichier in anciennes[:-CONSERVATION]:
        fichier.unlink(missing_ok=True)
    return cible.name


def liste_sauvegardes() -> list[dict]:
    if not DOSSIER_SAUVEGARDES.exists():
        return []
    return [{"nom": f.name, "taille_ko": round(f.stat().st_size / 1024),
             "le": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="minutes")}
            for f in sorted(DOSSIER_SAUVEGARDES.glob("portail-*.db"), reverse=True)]
