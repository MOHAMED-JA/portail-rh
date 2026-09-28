"""Assistant RH du portail, sans IA externe.

Une question en français → une intention (``assistant_comprehension``) → une
réponse calculée à partir de la base, dans le périmètre de consultation de
celui qui la pose (``services/hierarchie.py``). Les actions guidées ne
déposent jamais rien : elles proposent un formulaire pré-rempli, que
l'utilisateur vérifie et soumet lui-même. Aucune question n'est conservée.
"""
from __future__ import annotations

import re
from dataclasses import asdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ROLES_RH, TYPES_AUTORISATION, TYPES_MISSION, Demande, DossierEmploye, Employe, FicheEvaluation, FicheObjectifs,
    Role, StatutDemande, TypeDemande,
)
from app.services import assistant_ia
from app.services import assistant_regles as regles
from app.services import delegation, hierarchie, parametres, sirh, validation_auto
from app.services.assistant_comprehension import Periode, detecter, lire_periode, normaliser
from app.services.assistant_regles import Reponse, date_fr, fr, lien
from app.services.calendrier import compter_jours_conge, feries_dans_periode
from app.services.demandes import (
    heures_autorisation_du_mois, heures_fr, libelle_sous_type, requete_file_validation, solde_courant,
    validateurs_possibles,
)

TYPES_LIBELLES = {TypeDemande.CONGE: "Congé", TypeDemande.AUTORISATION: "Autorisation", TypeDemande.MISSION: "Mission"}
STATUTS = {StatutDemande.EN_ATTENTE: "en attente", StatutDemande.APPROUVEE: "approuvée",
           StatutDemande.REJETEE: "refusée", StatutDemande.ANNULEE: "annulée", StatutDemande.BROUILLON: "brouillon"}
STATUTS_FICHE = {"brouillon": "en cours de rédaction", "soumise": "chez votre supérieur pour validation",
                 "a_corriger": "renvoyée pour correction", "validee": "validée"}
MAX_LIGNES = 12


# ------------------------------------------------------------------ Outils
def _periode_texte(debut: date, fin: date) -> str:
    return f"le {date_fr(debut)}" if debut == fin else f"du {date_fr(debut)} au {date_fr(fin)}"


def _heure(instant: time) -> str:
    return f"{instant.hour}h{instant.minute:02d}" if instant.minute else f"{instant.hour}h"


def _libelle(d: Demande, detaille: bool = True) -> str:
    if not detaille:
        return TYPES_LIBELLES[d.type_demande]
    return f"{TYPES_LIBELLES[d.type_demande]} — {libelle_sous_type(d.type_demande, d.sous_type)}"


def _a_une_equipe(db: Session, u: Employe) -> bool:
    return hierarchie.voit_tout(u) or bool(hierarchie.equipe_ids(db, u.id)) or bool(delegation.titulaires_de(db, u.id))


def suggestions(db: Session, u: Employe) -> list[str]:
    liste = ["Combien de jours de congé me reste-t-il ?", "Où en est ma demande ?", "Qui valide mes congés ?",
             "Poser 3 jours la semaine prochaine", "Autorisation demain de 10h à 11h30", "Prochains jours fériés"]
    if _a_une_equipe(db, u):
        liste[3:3] = ["Qui est absent demain dans mon équipe ?", "Quelles demandes dois-je valider ?"]
    if u.role in ROLES_RH:
        liste.insert(0, "Quelles sont les alertes RH ?")
    return liste


# ------------------------------------------------------------------ Mes informations
def _solde(db, u, t, periode, jour) -> Reponse:
    s = solde_courant(db, u.id, jour.year)
    en_attente = db.scalar(select(func.coalesce(func.sum(Demande.nombre_jours), 0)).where(
        Demande.employe_id == u.id, Demande.type_demande == TypeDemande.CONGE, Demande.sous_type == "annuel",
        Demande.statut == StatutDemande.EN_ATTENTE)) or 0
    details = [f"Acquis {jour.year} : {fr(s.jours_acquis)} j · report : {fr(s.report_anterieur)} j · "
               f"pris : {fr(s.jours_pris)} j."]
    if en_attente:
        details.append(f"{fr(en_attente)} j sont demandés et attendent une validation.")
    details.append(f"+{fr(float(parametres.REGLES.get('acquisitionMensuelle', 2.5)))} j le 1er de chaque mois.")
    return Reponse("solde", f"Il vous reste {fr(s.jours_restants)} jour(s) de congé annuel.", details,
                   [lien("Mes demandes", "/mes-demandes")])


def _mes_demandes(db, u, t, periode, jour) -> Reponse:
    demandes = db.scalars(select(Demande).where(
        Demande.employe_id == u.id,
        (Demande.statut == StatutDemande.EN_ATTENTE)
        | ((Demande.statut == StatutDemande.APPROUVEE) & (Demande.date_fin >= jour))
    ).order_by(Demande.date_debut).limit(MAX_LIGNES)).all()
    if not demandes:
        return Reponse("mes_demandes", "Vous n'avez aucune demande en attente ni à venir.", [],
                       [lien("Mes demandes", "/mes-demandes")])
    lignes = []
    for d in demandes:
        ligne = f"{d.reference} · {_libelle(d)} {_periode_texte(d.date_debut, d.date_fin)} : {STATUTS[d.statut]}"
        if d.statut == StatutDemande.EN_ATTENTE:
            ligne += f", chez {d.validateur.nom_complet}" if d.validateur else ", chez l'administration RH"
            if d.type_demande in validation_auto.TYPES_CONCERNES and parametres.REGLES.get("validationAutomatique", True):
                ligne += f" (validée d'office le {validation_auto.echeance(db, d):%d/%m} sans réponse)"
        lignes.append(ligne + ".")
    attente = sum(1 for d in demandes if d.statut == StatutDemande.EN_ATTENTE)
    return Reponse("mes_demandes", f"{attente} demande(s) en attente, {len(demandes) - attente} accordée(s) à venir.",
                   lignes, [lien("Mes demandes", "/mes-demandes")])


def _mon_validateur(db, u, t, periode, jour) -> Reponse:
    chaine = validateurs_possibles(db, u)
    if not chaine:
        chef = u.validateur
        if chef and hierarchie.est_direction_generale(chef):
            details = [f"{chef.nom_complet} peut aussi les valider tant que la RH ne l'a pas fait."] \
                if hierarchie.supervise_les_demandes(chef) else []
            return Reponse("mon_validateur", f"Votre supérieur, {chef.nom_complet}, fait partie de la Direction "
                           "générale, qui ne valide jamais en premier : l'administration RH décide de vos demandes.",
                           details)
        return Reponse("mon_validateur", "Vous n'avez pas de supérieur opérationnel : l'administration RH décide "
                       "de vos demandes.")
    premier = chaine[0]
    details = []
    if len(chaine) > 1:
        details.append(f"Au-delà de {parametres.REGLES.get('seuilDoubleValidation', 10)} jours de congé, "
                       f"{chaine[1].nom_complet} valide en second.")
    suppleant = delegation.suppleant_de(db, premier.id, jour)
    if suppleant:
        details.append(f"En ce moment, {suppleant.nom_complet} le remplace pour les validations.")
    return Reponse("mon_validateur", f"Vos demandes sont validées par {premier.nom_complet} ({premier.poste}).", details)


def _visite(db, u, t, periode, jour) -> Reponse:
    d = db.get(DossierEmploye, u.id)
    if not d or not d.visite_medicale_le:
        return Reponse("visite_medicale", "Aucune visite médicale n'est enregistrée dans votre dossier : "
                       "la RH la renseigne après chaque visite.", [], [lien("Mon profil", "/profil")])
    prochaine = d.visite_medicale_le + timedelta(days=30 * (d.visite_periodicite_mois or 12))
    etat = " — échéance dépassée, la RH va vous convoquer" if prochaine < jour else ""
    return Reponse("visite_medicale", f"Prochaine visite médicale prévue vers le {date_fr(prochaine)}{etat}.",
                   [f"Dernière visite : {date_fr(d.visite_medicale_le)} (tous les {d.visite_periodicite_mois or 12} mois)."],
                   [lien("Mon profil", "/profil")])


def _fiche(db, u, t, periode, jour) -> Reponse:
    if hierarchie.sans_fiche_objectifs(u):
        return Reponse("fiche_objectifs", "Le Directeur général n'a ni fiche d'objectifs ni fiche d'évaluation.")
    objectifs = db.scalar(select(FicheObjectifs).where(FicheObjectifs.employe_id == u.id, FicheObjectifs.annee == jour.year))
    texte = (f"Votre fiche d'objectifs {jour.year} est {STATUTS_FICHE.get(objectifs.statut.value, objectifs.statut.value)}."
             if objectifs else f"Votre fiche d'objectifs {jour.year} n'est pas encore commencée.")
    details = []
    evaluation = db.scalar(select(FicheEvaluation).where(FicheEvaluation.employe_id == u.id,
                                                         FicheEvaluation.annee == jour.year))
    if evaluation:
        details.append("Évaluation finalisée (supérieur puis RH)." if evaluation.valide_rh_le
                       else "Évaluation validée par votre supérieur, en attente de la RH."
                       if evaluation.valide_superieur_le else "Évaluation en cours.")
    return Reponse("fiche_objectifs", texte, details, [lien("Entretiens & objectifs", "/entretiens")])


def _report(db, u, t, periode, jour) -> Reponse:
    s = solde_courant(db, u.id, jour.year)
    plafond = float(sirh.plafond_report())
    excedent = round(s.jours_restants - plafond, 2)
    if excedent > 0:
        texte = (f"Au 31/12/{jour.year}, {fr(excedent)} j au-delà du plafond de {fr(plafond)} j seraient perdus sans "
                 f"accord de la RH : posez-les avant la fin de l'année ou demandez un report.")
    else:
        texte = f"Votre solde ({fr(s.jours_restants)} j) est sous le plafond de report ({fr(plafond)} j) : rien n'est perdu."
    return Reponse("report", texte, ["La RH prévient les personnes concernées le 1er et le 15 décembre."],
                   [lien("Mes demandes", "/mes-demandes")])


# ------------------------------------------------------------------ Équipe et RH
def _absents(db, u, t, periode, jour) -> Reponse:
    if not _a_une_equipe(db, u):
        return Reponse("absents", "Vous n'avez pas d'équipe rattachée : cette question concerne les responsables et la RH.")
    debut, fin = (periode.debut, periode.fin) if periode else (jour, jour)
    ids = hierarchie.perimetre_ids(db, u)
    demandes = db.scalars(select(Demande).where(
        Demande.employe_id.in_(ids or [-1]), Demande.statut == StatutDemande.APPROUVEE,
        Demande.date_debut <= fin, Demande.date_fin >= debut).order_by(Demande.date_debut)).all()
    detaille = u.role in ROLES_RH     # le motif précis (maladie…) reste à la RH
    lignes = [f"{d.employe.nom_complet} — {_libelle(d, detaille)} {_periode_texte(d.date_debut, d.date_fin)}"
              + (f" de {_heure(d.heure_debut)} à {_heure(d.heure_fin)}" if d.heure_debut and d.heure_fin else "")
              for d in demandes]
    quand = _periode_texte(debut, fin)
    if not lignes:
        return Reponse("absents", f"Personne n'est absent {quand} dans votre périmètre (demandes accordées).",
                       [], [lien("Calendrier", "/calendrier")])
    personnes = len({d.employe_id for d in demandes})
    reste = [f"… et {len(lignes) - MAX_LIGNES} autre(s)."] if len(lignes) > MAX_LIGNES else []
    return Reponse("absents", f"{personnes} personne(s) absente(s) {quand} (demandes accordées) :",
                   lignes[:MAX_LIGNES] + reste, [lien("Calendrier", "/calendrier")])


def _a_valider(db, u, t, periode, jour) -> Reponse:
    if not (u.role in (Role.VALIDATEUR, *ROLES_RH) or delegation.titulaires_de(db, u.id)):
        return Reponse("a_valider", "Vous n'avez pas de file de validation : vos demandes sont validées par votre "
                       "supérieur.")
    demandes = db.scalars(requete_file_validation(db, u).where(Demande.statut == StatutDemande.EN_ATTENTE)
                          .order_by(Demande.cree_le.asc()).limit(300)).all()
    if not demandes:
        return Reponse("a_valider", "Aucune demande n'attend votre décision.", [], [lien("Validation", "/validation")])
    lignes = [f"{d.reference} · {d.employe.nom_complet} — {_libelle(d, u.role in ROLES_RH)} "
              f"{_periode_texte(d.date_debut, d.date_fin)} (déposée le {d.cree_le:%d/%m})" for d in demandes[:MAX_LIGNES]]
    return Reponse("a_valider", f"{len(demandes)} demande(s) attendent votre décision, les plus anciennes d'abord :",
                   lignes, [lien("Validation", "/validation")])


def _alertes(db, u, t, periode, jour) -> Reponse:
    if u.role not in ROLES_RH:
        return Reponse("alertes", "Les alertes RH (fins d'essai, de contrat, retraites, visites médicales) sont "
                       "réservées à l'administration RH.")
    alertes = sirh.alertes(db, jour)
    if not alertes:
        return Reponse("alertes", "Aucune alerte RH en ce moment.", [], [lien("Administration", "/administration")])
    lignes = [f"{a['employe']['prenom']} {a['employe']['nom']} — {a['message']} ({a['echeance']:%d/%m/%Y})"
              for a in alertes[:MAX_LIGNES]]
    return Reponse("alertes", f"{len(alertes)} alerte(s) RH, les plus proches d'abord :", lignes,
                   [lien("Administration", "/administration")])


# ------------------------------------------------------------------ Actions guidées
def _sans_date(intention: str, exemple: str) -> Reponse:
    return Reponse(intention, f"Pour quelles dates ? Exemple : « {exemple} ».")


def _action_conge(db, u, t, periode: Periode | None, jour) -> Reponse:
    if not periode:
        return _sans_date("action_conge", "poser du 12 au 14 octobre")
    sous_type = regles.sous_type_conge(t) or "annuel"
    nombre = compter_jours_conge(periode.debut, periode.fin, periode.demi_journee)
    quand = _periode_texte(periode.debut, periode.fin)
    if nombre <= 0:
        return Reponse("action_conge", f"Aucun jour n'est décompté {quand} (week-end ou jour férié).")
    details = []
    if periode.debut < jour:
        details.append("Attention : cette date est déjà passée.")
    feries = feries_dans_periode(periode.debut, periode.fin)
    if feries:
        details.append(f"Jour(s) férié(s) non décompté(s) : {', '.join(feries)}.")
    if sous_type == "annuel":
        restant = solde_courant(db, u.id, periode.debut.year).jours_restants
        details.append(f"Solde après cette demande : {fr(restant - nombre)} j." if nombre <= restant
                       else f"Votre solde ({fr(restant)} j) ne suffit pas : la demande partira à la RH.")
    chaine = validateurs_possibles(db, u)
    details.append(f"Valideur : {chaine[0].nom_complet}." if chaine else "Valideur : l'administration RH.")
    action = {"type": "conge", "sous_type": sous_type, "date_debut": periode.debut.isoformat(),
              "date_fin": periode.fin.isoformat(), "demi_journee": periode.demi_journee}
    return Reponse("action_conge", f"{libelle_sous_type(TypeDemande.CONGE, sous_type)} {quand} : {fr(nombre)} jour(s) "
                   "décompté(s). Vérifiez le formulaire pré-rempli, puis soumettez-le.", details, [], action)


SOUS_TYPES_AUTORISATION = [("formation", "formation"), ("professionnel", r"professionnel|reunion|client"),
                           ("allaitement", "allaitement"), ("mission_inspection", "inspection")]


def _action_autorisation(db, u, t, periode: Periode | None, jour) -> Reponse:
    if not periode:
        return _sans_date("action_autorisation", "autorisation demain de 10h à 11h30")
    sous_type = next((code for code, motif in SOUS_TYPES_AUTORISATION if re.search(motif, t)), "perso")
    details = []
    if periode.heure_debut and periode.heure_fin:
        duree = (periode.heure_fin.hour * 60 + periode.heure_fin.minute
                 - periode.heure_debut.hour * 60 - periode.heure_debut.minute) / 60
        maximum = float(parametres.REGLES.get("maxAutorisationHeures", 1.5))
        if duree > maximum:
            details.append(f"Une autorisation dure au plus {heures_fr(maximum)} : ajustez les heures.")
        quota = float(parametres.REGLES.get("quotaAutorisationMois", 4))
        utilisees = heures_autorisation_du_mois(db, u.id, periode.debut)
        if utilisees + duree > quota:
            details.append(f"Quota mensuel dépassé ({heures_fr(utilisees)} déjà demandées sur {heures_fr(quota)}) : "
                           "la demande partira à la RH.")
        horaire = f" de {_heure(periode.heure_debut)} à {_heure(periode.heure_fin)}"
    else:
        horaire = ""
        details.append("Précisez les heures dans le formulaire (exemple : de 10h à 11h30).")
    action = {"type": "autorisation", "sous_type": sous_type, "date_debut": periode.debut.isoformat(),
              "heure_debut": f"{periode.heure_debut:%H:%M}" if periode.heure_debut else None,
              "heure_fin": f"{periode.heure_fin:%H:%M}" if periode.heure_fin else None}
    libelle = next(x["libelle"] for x in TYPES_AUTORISATION if x["code"] == sous_type)
    return Reponse("action_autorisation", f"Autorisation ({libelle}) le {date_fr(periode.debut)}{horaire}. "
                   "Vérifiez le formulaire pré-rempli, puis soumettez-le.", details, [], action)


SOUS_TYPES_MISSION = [("teletravail", "teletravail"), ("formation", "formation"), ("visite_risque", r"visite|risque"),
                      ("foire", "foire|salon"), ("evenement", "evenement"), ("reunion", "reunion")]


def _action_mission(db, u, t, periode: Periode | None, jour) -> Reponse:
    if not periode:
        return _sans_date("action_mission", "télétravail vendredi prochain")
    sous_type = next((code for code, motif in SOUS_TYPES_MISSION if re.search(motif, t)), None)
    libelle = next((x["libelle"] for x in TYPES_MISSION if x["code"] == sous_type), "Mission")
    action = {"type": "mission", "sous_type": sous_type, "date_debut": periode.debut.isoformat(),
              "date_fin": periode.fin.isoformat()}
    return Reponse("action_mission", f"{libelle} {_periode_texte(periode.debut, periode.fin)}. Vérifiez le "
                   "formulaire pré-rempli (type de mission, commentaire), puis soumettez-le.", [], [], action)


# ------------------------------------------------------------------ Aiguillage
def _aide(db, u, t, periode, jour) -> Reponse:
    return Reponse("aide", f"Bonjour {u.prenom} ! Je réponds à partir des données du portail : votre solde, vos "
                   "demandes, votre valideur, les règles RH, et je prépare vos demandes (vous gardez la main pour "
                   "les soumettre). Quelques exemples ci-dessous.")


def _incompris(db, u, t, periode, jour) -> Reponse:
    return Reponse("incompris", "Je n'ai pas compris cette question. Je réponds sur les congés, autorisations, "
                   "missions, validations, règles RH et votre dossier : essayez l'une des suggestions.")


def _regle(fonction):
    return lambda db, u, t, periode, jour: fonction(db, u, jour)


GESTIONNAIRES = {
    "solde": _solde, "mes_demandes": _mes_demandes, "mon_validateur": _mon_validateur, "visite_medicale": _visite,
    "fiche_objectifs": _fiche, "report": _report, "absents": _absents, "a_valider": _a_valider, "alertes": _alertes,
    "action_conge": _action_conge, "action_autorisation": _action_autorisation, "action_mission": _action_mission,
    "regle_autorisation": _regle(regles.autorisations), "regle_horaires": _regle(regles.horaires),
    "regle_exceptionnels": lambda db, u, t, periode, jour: regles.conges_exceptionnels(db, u, jour, t),
    "regle_acquisition": _regle(regles.acquisition), "regle_validation_auto": _regle(regles.validation_automatique),
    "regle_double_validation": _regle(regles.double_validation), "jours_feries": _regle(regles.jours_feries),
    "regle_pieces": _regle(regles.pieces), "regle_mot_de_passe": _regle(regles.mot_de_passe),
    "regle_priere": _regle(regles.priere), "aide": _aide,
}


def repondre(db: Session, utilisateur: Employe, question: str, aujourdhui: date | None = None) -> dict:
    """Réponse complète à une question : texte, détails, liens, action
    éventuelle et suggestions pour la suite."""
    jour = aujourdhui or date.today()
    texte = normaliser(question)
    periode = lire_periode(texte, jour)
    intention = detecter(texte, periode is not None)
    reponse = GESTIONNAIRES.get(intention, _incompris)(db, utilisateur, texte, periode, jour)
    if reponse.intention == "incompris" and assistant_ia.active():
        # Question hors du moteur local : réponse générale de l'IA, sans données du portail.
        texte_ia = assistant_ia.repondre(question)
        if texte_ia:
            reponse = Reponse("ia", texte_ia, ["Réponse générale produite par l'IA, sans accès à vos données : "
                                             "vérifiez auprès de l'administration RH avant de vous y fier."])
    return {**asdict(reponse), "suggestions": suggestions(db, utilisateur), "le": datetime.utcnow()}
