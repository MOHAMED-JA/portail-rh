"""Prévisions RH sur 12 mois, par pôle ou direction : absentéisme, congés,
taux de présence, départs et besoins d'effectif.

Le portail a peu d'historique : chaque calcul utilise le constaté dès qu'il
est suffisant, sinon un repère réglable par l'administrateur RH, et le dit
(``source`` : « constaté » ou « repère »). Ce sont des ordres de grandeur pour
anticiper, jamais des décisions ; aucun score individuel n'est produit."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Demande, Departement, DossierEmploye, Employe, OffreInterne, Pointage, SoldeConge, StatutDemande, StatutEmploye,
    TypeDemande,
)
from app.services import parametres
from app.services.calendrier import jours_ouvres

CLE_HYPOTHESES = "previsions_hypotheses"
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]

# Repères par défaut, à valider par la RH (Prévisions RH → Hypothèses).
HYPOTHESES_DEFAUT = {
    "taux_absenteisme": 3.0,     # % des jours ouvrés perdus en absences non planifiées
    "taux_depart": 5.0,          # % de départs volontaires par an
    "seuil_presence": 85,        # alerte sous ce taux de présence mensuel
    # Profils saisonniers (moyenne 1) : absences plus fréquentes l'hiver,
    # congés concentrés l'été et en fin d'année.
    "saison_absences": [1.25, 1.2, 1.1, 1.0, 0.9, 0.85, 0.8, 0.8, 0.9, 1.0, 1.1, 1.1],
    "saison_conges": [0.6, 0.6, 0.8, 0.9, 0.8, 1.0, 1.9, 2.1, 0.9, 0.7, 0.7, 1.0],
    "effectifs_cibles": {},       # code de structure → effectif souhaité
}
MOIS_POUR_TAUX = 6        # historique minimal pour un taux constaté d'absentéisme
MOIS_POUR_DEPARTS = 12    # et pour un taux constaté de départ


def hypotheses(db: Session) -> dict:
    enregistrees = parametres.lire(db, CLE_HYPOTHESES, {}) or {}
    return {**HYPOTHESES_DEFAUT, **enregistrees}


def _mois_suivants(depart: date, n: int) -> list[date]:
    total = depart.year * 12 + depart.month - 1
    return [date(t // 12, t % 12 + 1, 1) for t in range(total, total + n)]


def _fin_de_mois(jour: date) -> date:
    suivant = date(jour.year + (jour.month == 12), jour.month % 12 + 1, 1)
    return suivant - timedelta(days=1)


# ------------------------------------------------------------------ Regroupement
def structures(db: Session) -> dict[int, Departement]:
    return {d.id: d for d in db.scalars(select(Departement))}


def unite_de(e: Employe, deps: dict[int, Departement]) -> Departement | None:
    return unite_de_structure(e.departement_id, deps)


def unite_de_structure(dep_id: int | None, deps: dict[int, Departement]) -> Departement | None:
    """Pôle ou direction de rattachement : le niveau placé sous la Direction
    générale, ou sous la Direction générale déléguée quand celle-ci regroupe
    les pôles (son responsable est au niveau « dga »)."""
    chaine, d, vus = [], deps.get(dep_id), set()
    while d is not None and d.id not in vus:
        vus.add(d.id)
        chaine.append(d)
        d = deps.get(d.parent_id)
    chaine.reverse()  # du sommet vers la structure de la personne
    if not chaine:
        return None
    if len(chaine) >= 2 and chaine[1].responsable is not None and chaine[1].responsable.niveau == "dga":
        return chaine[2] if len(chaine) >= 3 else chaine[1]
    return chaine[1] if len(chaine) >= 2 else chaine[0]


# ------------------------------------------------------------------ Historique
def mois_d_historique(db: Session, jour: date) -> int:
    """Ancienneté des données d'activité (demandes, pointages), en mois."""
    premiers = [db.scalar(select(func.min(Demande.date_debut))), db.scalar(select(func.min(Pointage.date_jour)))]
    premiers = [p for p in premiers if p]
    if not premiers:
        return 0
    debut = min(premiers)
    return max(0, (jour.year - debut.year) * 12 + jour.month - debut.month)


def taux_absenteisme_constate(db: Session, actifs: list[Employe], jour: date) -> float | None:
    from app.routers.analyses import episodes_absence

    debut = jour - timedelta(days=365)
    capacite = len(actifs) * len(jours_ouvres(debut, jour))
    if not capacite:
        return None
    perdus = sum(x[2] for e in actifs for x in episodes_absence(db, e, debut, jour))
    return round(100 * perdus / capacite, 2)


def taux_depart_constate(db: Session, actifs: list[Employe], jour: date) -> float:
    from app.routers.departs import VOLONTAIRES, _sortis

    sortis = _sortis(db, jour - timedelta(days=365))
    volontaires = sum(1 for e in sortis if e.motif_sortie in VOLONTAIRES)
    moyen = len(actifs) + len(sortis) / 2
    return round(100 * volontaires / moyen, 2) if moyen else 0.0


# ------------------------------------------------------------------ Calcul
def calculer(db: Session, rh: bool, aujourdhui: date | None = None) -> dict:
    jour = aujourdhui or date.today()
    h = hypotheses(db)
    regles = parametres.REGLES
    acquisition = float(regles.get("acquisitionMensuelle", 2.5))
    plafond_report = float(regles.get("plafondReport", 15))
    deps = structures(db)
    actifs = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)
                             .order_by(Employe.prenom, Employe.nom)))
    dossiers = {d.employe_id: d for d in db.scalars(select(DossierEmploye))}
    historique = mois_d_historique(db, jour)

    constate = taux_absenteisme_constate(db, actifs, jour) if historique >= MOIS_POUR_TAUX else None
    taux_abs = constate if constate is not None else float(h["taux_absenteisme"])
    taux_dep = taux_depart_constate(db, actifs, jour) if historique >= MOIS_POUR_DEPARTS else float(h["taux_depart"])

    mois = _mois_suivants(date(jour.year, jour.month, 1), 13)[1:]   # les 12 mois suivants
    horizon = _fin_de_mois(mois[-1])
    ouvres = {m: len(jours_ouvres(m, _fin_de_mois(m))) for m in mois}
    mois_restants_annee = [m for m in mois if m.year == jour.year]

    groupes: dict[str, dict] = {}
    for e in actifs:
        u = unite_de(e, deps)
        cle, nom = (u.code, u.nom) if u else ("-", "Non affecté")
        groupes.setdefault(cle, {"code": cle, "unite": nom, "membres": []})["membres"].append(e)

    demandes = db.scalars(select(Demande).where(
        Demande.type_demande == TypeDemande.CONGE,
        Demande.statut.in_([StatutDemande.APPROUVEE, StatutDemande.EN_ATTENTE]),
        Demande.date_fin >= mois[0], Demande.date_debut <= horizon)).all()
    soldes = {s.employe_id: s for s in db.scalars(select(SoldeConge).where(SoldeConge.annee == jour.year))}
    offres = db.scalars(select(OffreInterne).where(OffreInterne.publication == "externe",
                                                   OffreInterne.statut == "ouverte")).all()

    resultats, departs_nominatifs = [], []
    total = {m: {"capacite": 0, "absences": 0.0, "conges": 0.0} for m in mois}
    for g in sorted(groupes.values(), key=lambda x: x["unite"]):
        membres = g["membres"]
        ids = {e.id for e in membres}
        effectif = len(membres)
        # Congés restant à poser cette année au-delà du report autorisé : ils
        # seront pris ou perdus avant le 31 décembre.
        a_poser = sum(max(0.0, (soldes[e.id].jours_restants if e.id in soldes else 0.0)
                          + acquisition * len(mois_restants_annee) - plafond_report) for e in membres)
        lignes_mois = []
        for m in mois:
            capacite = effectif * ouvres[m]
            deposes = sum(sum(1 for j in jours_ouvres(max(d.date_debut, m), min(d.date_fin, _fin_de_mois(m))))
                          for d in demandes if d.employe_id in ids and d.date_debut <= _fin_de_mois(m) and d.date_fin >= m)
            attendus = effectif * acquisition * h["saison_conges"][m.month - 1]
            if m.year == jour.year and mois_restants_annee:
                attendus = max(attendus, a_poser / len(mois_restants_annee))
            conges = max(float(deposes), attendus)
            absences = capacite * taux_abs / 100 * h["saison_absences"][m.month - 1]
            presence = round(100 * (1 - (conges + absences) / capacite), 1) if capacite else None
            total[m]["capacite"] += capacite
            total[m]["absences"] += absences
            total[m]["conges"] += conges
            lignes_mois.append({"mois": m, "jours_ouvres": ouvres[m], "absences": round(absences, 1),
                                "conges": round(conges, 1), "conges_deposes": deposes, "presence": presence,
                                "alerte": presence is not None and presence < h["seuil_presence"]})
        # Départs connus dans l'horizon : sortie programmée, fin de contrat, retraite.
        certains = []
        for e in membres:
            motif, quand = None, None
            dossier = dossiers.get(e.id)
            if e.date_sortie and jour < e.date_sortie <= horizon:
                motif, quand = "Sortie programmée", e.date_sortie
            elif dossier and dossier.date_fin_contrat and (dossier.type_contrat or "").upper() != "CDI" \
                    and jour < dossier.date_fin_contrat <= horizon:
                motif, quand = "Fin de contrat", dossier.date_fin_contrat
            elif dossier and dossier.date_naissance:
                from app.routers.talents import _retraite

                retraite = _retraite(db, e)
                if retraite and jour < retraite <= horizon:
                    motif, quand = "Retraite", retraite
            if motif:
                certains.append(motif)
                if rh:
                    departs_nominatifs.append({"employe": f"{e.prenom} {e.nom}", "matricule": e.matricule,
                                               "unite": g["unite"], "motif": motif, "date": quand})
        probables = round(effectif * taux_dep / 100, 1)
        recrutements = sum(1 for o in offres if getattr(unite_de_structure(o.departement_id, deps), "code", None) == g["code"])
        projete = round(effectif - len(certains) - probables + recrutements, 1)
        cible = h["effectifs_cibles"].get(g["code"])
        resultats.append({
            "code": g["code"], "unite": g["unite"], "effectif": effectif,
            "departs_certains": len(certains), "departs_probables": probables, "recrutements_en_cours": recrutements,
            "effectif_projete": projete, "effectif_cible": cible,
            "besoin": (round(cible - projete, 1) if cible is not None else None),
            "conges_a_poser_avant_31_12": round(a_poser, 1),
            "presence_minimale": min((l["presence"] for l in lignes_mois if l["presence"] is not None), default=None),
            "mois": lignes_mois,
        })

    ensemble = [{"mois": m, "presence": round(100 * (1 - (t["absences"] + t["conges"]) / t["capacite"]), 1) if t["capacite"] else None,
                 "absences": round(t["absences"], 1), "conges": round(t["conges"], 1)} for m, t in total.items()]
    nb = len(actifs) or 1
    renseignes = {
        "date_naissance": sum(1 for e in actifs if dossiers.get(e.id) and dossiers[e.id].date_naissance),
        "type_contrat": sum(1 for e in actifs if dossiers.get(e.id) and dossiers[e.id].type_contrat),
        "date_entree": sum(1 for e in actifs if e.date_entree),
    }
    part = round(100 * sum(renseignes.values()) / (3 * nb))
    manques = []
    if renseignes["date_naissance"] < nb:
        manques.append(f"{nb - renseignes['date_naissance']} date(s) de naissance manquante(s) : retraites non prévues.")
    if renseignes["type_contrat"] < nb:
        manques.append(f"{nb - renseignes['type_contrat']} type(s) de contrat manquant(s) : fins de CDD non prévues.")
    if historique < MOIS_POUR_TAUX:
        manques.append(f"{historique} mois d'activité enregistrée : l'absentéisme repose sur le repère "
                       f"de {h['taux_absenteisme']:g} % tant qu'il n'y a pas {MOIS_POUR_TAUX} mois d'historique.")
    if historique < MOIS_POUR_DEPARTS:
        manques.append(f"Taux de départ : repère de {h['taux_depart']:g} % par an tant qu'il n'y a pas "
                       f"{MOIS_POUR_DEPARTS} mois d'historique.")
    return {
        "calcule_le": jour, "horizon": {"debut": mois[0], "fin": horizon},
        "mois": [{"mois": m, "libelle": f"{MOIS[m.month - 1]} {m.year}"} for m in mois],
        "effectif": len(actifs),
        "taux": {"absenteisme": taux_abs, "absenteisme_source": "constaté" if constate is not None else "repère",
                 "depart": taux_dep, "depart_source": "constaté" if historique >= MOIS_POUR_DEPARTS else "repère"},
        "seuil_presence": h["seuil_presence"],
        "ensemble": ensemble,
        "unites": resultats,
        "departs_nominatifs": sorted(departs_nominatifs, key=lambda x: x["date"]) if rh else None,
        "fiabilite": {"mois_historique": historique, "renseignes": renseignes, "effectif": len(actifs),
                      "completude": part, "niveau": "bonne" if part >= 80 and historique >= MOIS_POUR_DEPARTS
                      else "moyenne" if part >= 50 or historique >= MOIS_POUR_TAUX else "faible",
                      "a_completer": manques},
        "hypotheses": h,
    }
