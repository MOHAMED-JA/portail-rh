"""Assistant RH — réponses sur les règles du portail.

Les valeurs viennent des Paramètres RH (``parametres.REGLES``) et des
catalogues de types : une règle modifiée par la RH est aussitôt reprise par
l'assistant, sans rien réécrire ici."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models import TYPES_CONGE
from app.services import parametres
from app.services.calendrier import est_ferie
from app.services.demandes import heures_autorisation_du_mois, heures_fr

JOURS_SEMAINE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS_NOMS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
             "novembre", "décembre"]


@dataclass
class Reponse:
    intention: str
    texte: str
    details: list[str] = field(default_factory=list)
    liens: list[dict] = field(default_factory=list)
    action: dict | None = None


def fr(nombre: float) -> str:
    """2.5 → « 2,5 » ; 21.0 → « 21 »."""
    return f"{nombre:g}".replace(".", ",")


def date_fr(jour: date, avec_jour: bool = True) -> str:
    texte = jour.strftime("%d/%m/%Y")
    return f"{JOURS_SEMAINE[jour.weekday()]} {texte}" if avec_jour else texte


def lien(libelle: str, route: str) -> dict:
    return {"libelle": libelle, "route": route}


def _r(cle: str):
    return parametres.REGLES.get(cle, parametres.REGLES_DEFAUT.get(cle))


# ------------------------------------------------------------------ Règles
def autorisations(db, utilisateur, aujourdhui: date) -> Reponse:
    maximum, quota = float(_r("maxAutorisationHeures")), float(_r("quotaAutorisationMois"))
    utilisees = heures_autorisation_du_mois(db, utilisateur.id, aujourdhui)
    reste = max(0.0, quota - utilisees)
    return Reponse("regle_autorisation", (
        f"Une autorisation d'absence dure au plus {heures_fr(maximum)}, dans la limite de {heures_fr(quota)} par mois. "
        f"Ce mois-ci, vous en avez demandé {heures_fr(utilisees)} : il vous reste {heures_fr(reste)}."),
        ["Au-delà du quota mensuel, la demande part à la RH, seule à pouvoir accorder une dérogation.",
         "La prière du vendredi (13h–14h) est une autorisation permanente, hors quota."],
        [lien("Mes demandes", "/mes-demandes")])


def horaires(db, utilisateur, aujourdhui: date) -> Reponse:
    ete = ", ".join(MOIS_NOMS[m - 1] for m in _r("moisSeanceUnique"))
    return Reponse("regle_horaires", (
        f"Horaire normal : {_r('heureArrivee')}–{_r('pauseDebut')} et {_r('pauseFin')}–{_r('heureDepart')}, "
        f"du lundi au vendredi. En {ete} : séance unique {_r('heureArriveeEte')}–{_r('heureDepartEte')}."),
        [f"Tolérance de retard : {_r('toleranceRetard')} minutes.",
         "Le pointage retient la première entrée et la dernière sortie ; un nombre impair de passages signale une anomalie."],
        [lien("Présences", "/presences")])


MOTS_EXCEPTIONNELS = [
    (r"mariage.*\b(enfant|fils|fille)\b|\b(enfant|fils|fille)\b.*mariage", "mariage_enfant"),
    (r"mariage", "mariage_employe"),
    (r"naissance", "naissance"),
    (r"deces.*\b(pere|mere|parent)", "deces_parent"),
    (r"deces.*\b(conjoint|epou|mari|femme|enfant|fils|fille)", "deces_conjoint_enfant"),
    (r"deces.*\b(frere|soeur)", "deces_frere"),
    (r"deces.*\bgrand", "deces_grand_parent"),
    (r"circoncision", "circoncision"),
    (r"paternite|paternel", "paternel"),
    (r"prenatal|maternite|grossesse", "prenatal"),
    (r"maladie", "maladie"),
    (r"sans solde", "sans_solde"),
]


def sous_type_conge(texte: str) -> str | None:
    for motif, code in MOTS_EXCEPTIONNELS:
        if re.search(motif, texte):
            return code
    return None


def _ligne_type(t: dict) -> str:
    duree = f"{t['jours_max']} jour(s) au plus" if t.get("jours_max") else "durée selon la situation"
    return f"{t['libelle']} : {duree}{' — justificatif demandé' if t.get('justificatif') else ''}."


def conges_exceptionnels(db, utilisateur, aujourdhui: date, texte: str = "") -> Reponse:
    actifs = [t for t in TYPES_CONGE if t["code"] not in parametres.TYPES_INACTIFS and t["code"] != "annuel"]
    code = sous_type_conge(texte)
    choisi = next((t for t in actifs if t["code"] == code), None)
    if choisi:
        return Reponse("regle_exceptionnels", _ligne_type(choisi),
                       ["Ces jours ne sont pas pris sur le solde de congé annuel."
                        if choisi["code"] not in ("sans_solde",) else "Le congé sans solde n'est pas rémunéré."],
                       [lien("Mes demandes", "/mes-demandes")])
    return Reponse("regle_exceptionnels", "Congés exceptionnels et particuliers prévus par le portail :",
                   [_ligne_type(t) for t in actifs], [lien("Mes demandes", "/mes-demandes")])


def acquisition(db, utilisateur, aujourdhui: date) -> Reponse:
    mensuel = float(_r("acquisitionMensuelle"))
    return Reponse("regle_acquisition", (
        f"Chaque collaborateur actif acquiert {fr(mensuel)} jours de congé le 1er de chaque mois, au titre du mois "
        f"écoulé, soit {fr(mensuel * 12)} jours par an."),
        [f"Au 31 décembre, le report est plafonné à {fr(float(_r('plafondReport')))} jours, sauf accord de la RH."],
        [lien("Mes demandes", "/mes-demandes")])


def validation_automatique(db, utilisateur, aujourdhui: date) -> Reponse:
    delai = float(_r("delaiReponse"))
    if not _r("validationAutomatique"):
        return Reponse("regle_validation_auto", "La validation automatique est désactivée par la RH : "
                       "une demande attend la décision de son valideur.")
    return Reponse("regle_validation_auto", (
        f"Un congé ou une autorisation sans réponse pendant {fr(delai)} heures est validé d'office, à chaque niveau "
        f"de validation."),
        ["Exception : un congé annuel qui dépasserait votre solde n'est jamais validé d'office ; la RH décide.",
         "Le valideur et le demandeur sont prévenus."])


def double_validation(db, utilisateur, aujourdhui: date) -> Reponse:
    seuil = _r("seuilDoubleValidation")
    return Reponse("regle_double_validation", (
        f"Un congé de plus de {seuil} jours demande deux validations : votre supérieur, puis le suivant dans "
        f"votre ligne hiérarchique."),
        ["La Direction générale ne valide jamais en premier ; sans supérieur opérationnel, la RH décide."])


def jours_feries(db, utilisateur, aujourdhui: date) -> Reponse:
    prochains = []
    jour = aujourdhui
    while len(prochains) < 8 and jour <= aujourdhui + timedelta(days=366):
        nom = est_ferie(jour)
        if nom:
            prochains.append(f"{date_fr(jour)} : {nom}")
        jour += timedelta(days=1)
    return Reponse("jours_feries", "Prochains jours fériés (non décomptés des congés) :", prochains,
                   [lien("Calendrier", "/calendrier")])


def pieces(db, utilisateur, aujourdhui: date) -> Reponse:
    return Reponse("regle_pieces", "Justificatifs acceptés : PDF, DOC ou DOCX, 10 Mo au maximum.",
                   ["Le contenu est vérifié : un fichier simplement renommé en « .pdf » est refusé.",
                    "Une pièce n'est visible que de vous, de votre ligne hiérarchique et de la RH."])


def mot_de_passe(db, utilisateur, aujourdhui: date) -> Reponse:
    return Reponse("regle_mot_de_passe", "Changez votre mot de passe dans Mon profil → Sécurité.",
                   ["Au moins 8 caractères, avec des lettres et des chiffres.",
                    "Après 5 essais manqués, le compte est bloqué 15 minutes ; « Mot de passe oublié ? », sous le "
                    "formulaire de connexion, reste utilisable pendant le blocage.",
                    "Changer son mot de passe ferme vos sessions ouvertes sur d'autres postes."],
                   [lien("Mon profil", "/profil")])


def priere(db, utilisateur, aujourdhui: date) -> Reponse:
    return Reponse("regle_priere", (
        "La prière du vendredi (13h–14h) se demande une fois, comme une autorisation permanente : elle ne compte "
        "pas dans le quota mensuel d'autorisations."), [], [lien("Mes demandes", "/mes-demandes")])
