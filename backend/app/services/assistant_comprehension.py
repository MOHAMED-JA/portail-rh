"""Assistant RH — compréhension des questions, sans IA externe.

Normalisation du français (minuscules, sans accents), lecture des dates
(« demain », « lundi prochain », « du 12 au 14 octobre », « 3 jours la
semaine prochaine »…), des heures (« de 10h à 11h30 ») et de l'intention.
Tout est déterministe : même question, même réponse, et aucune donnée ne
quitte le portail. Les réponses sont construites par ``services/assistant.py``.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, time, timedelta

from app.services.calendrier import est_ouvre

MOIS = {"janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
        "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12}
JOURS = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "vendredi": 4, "samedi": 5, "dimanche": 6}
NOMBRES = {"un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6, "sept": 7, "huit": 8,
           "neuf": 9, "dix": 10, "quinze": 15, "vingt": 20}
_NOM_MOIS = "|".join(MOIS)
_NOM_JOUR = "|".join(JOURS)
_NOMBRE = r"\d{1,2}|" + "|".join(NOMBRES)


def normaliser(texte: str) -> str:
    """« Où en est ma demande ? » → « ou en est ma demande »."""
    t = unicodedata.normalize("NFD", (texte or "").lower().replace("’", "'").replace("œ", "oe"))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9'/:+\-\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------------------ Périodes
@dataclass(frozen=True)
class Periode:
    debut: date
    fin: date
    demi_journee: str | None = None      # « matin », « apres_midi »
    heure_debut: time | None = None
    heure_fin: time | None = None


def _nombre(mot: str) -> int:
    return int(mot) if mot.isdigit() else NOMBRES[mot]


def _date_sure(annee: int, mois: int, jour: int) -> date | None:
    try:
        return date(annee, mois, jour)
    except ValueError:
        return None


def _sans_annee(jour: int, mois: int, aujourdhui: date) -> date | None:
    """Date sans année : la prochaine occurrence (une date passée de plus
    d'un mois désigne l'an prochain)."""
    candidate = _date_sure(aujourdhui.year, mois, jour)
    if candidate and candidate < aujourdhui - timedelta(days=31):
        candidate = _date_sure(aujourdhui.year + 1, mois, jour)
    return candidate


def lundi_suivant(aujourdhui: date) -> date:
    return aujourdhui + timedelta(days=(7 - aujourdhui.weekday()) or 7)


def ajouter_jours_ouvres(debut: date, nombre: int) -> date:
    """Date du n-ième jour ouvré en partant de ``debut`` (compris s'il est ouvré)."""
    courant = debut
    while not est_ouvre(courant):
        courant += timedelta(days=1)
    compte = 1
    while compte < nombre:
        courant += timedelta(days=1)
        if est_ouvre(courant):
            compte += 1
    return courant


def _dates_citees(t: str, aujourdhui: date) -> list[tuple[int, date]]:
    """(position, date) de chaque date écrite dans la question, dans l'ordre."""
    trouvees: list[tuple[int, date]] = []

    def ajouter(position: int, valeur: date | None) -> None:
        if valeur:
            trouvees.append((position, valeur))

    # « du 12 au 14 octobre » : le premier jour emprunte le mois du second.
    for m in re.finditer(rf"\b(\d{{1,2}})(?:er)? (?:au|a|et) (?:le )?(\d{{1,2}})(?:er)? ({_NOM_MOIS})(?: (\d{{4}}))?", t):
        mois = MOIS[m.group(3)]
        if m.group(4):
            premier = _date_sure(int(m.group(4)), mois, int(m.group(1)))
            second = _date_sure(int(m.group(4)), mois, int(m.group(2)))
        else:
            premier, second = _sans_annee(int(m.group(1)), mois, aujourdhui), _sans_annee(int(m.group(2)), mois, aujourdhui)
        ajouter(m.start(1), premier)
        ajouter(m.start(2), second)
    deja = {p for p, _ in trouvees}
    for m in re.finditer(rf"\b(\d{{1,2}})(?:er)? ({_NOM_MOIS})(?: (\d{{4}}))?", t):
        if m.start(1) in deja:
            continue
        mois, jour = MOIS[m.group(2)], int(m.group(1))
        ajouter(m.start(), _date_sure(int(m.group(3)), mois, jour) if m.group(3) else _sans_annee(jour, mois, aujourdhui))
    for m in re.finditer(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", t):
        ajouter(m.start(), _date_sure(int(m.group(1)), int(m.group(2)), int(m.group(3))))
    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", t):
        jour, mois = int(m.group(1)), int(m.group(2))
        if m.group(3):
            annee = int(m.group(3))
            ajouter(m.start(), _date_sure(annee + 2000 if annee < 100 else annee, mois, jour))
        else:
            ajouter(m.start(), _sans_annee(jour, mois, aujourdhui) if 1 <= mois <= 12 else None)
    for m in re.finditer(r"\b(aujourd'hui|aujourdhui|apres-demain|apres demain|demain)\b", t):
        mot = m.group(1)
        decalage = 0 if mot.startswith("aujourd") else 2 if mot.startswith("apres") else 1
        ajouter(m.start(), aujourdhui + timedelta(days=decalage))
    for m in re.finditer(rf"\b({_NOM_JOUR})( prochain| de la semaine prochaine)?\b", t):
        ecart = (JOURS[m.group(1)] - aujourdhui.weekday()) % 7 or 7
        if m.group(2) == " de la semaine prochaine":
            cible = lundi_suivant(aujourdhui) + timedelta(days=JOURS[m.group(1)])
        else:
            cible = aujourdhui + timedelta(days=ecart)
        ajouter(m.start(), cible)
    return sorted(trouvees, key=lambda x: x[0])


def _duree_jours(t: str) -> int | None:
    m = re.search(rf"\b({_NOMBRE}) (jours?|journees?|semaines?)\b", t)
    if not m:
        return 5 if re.search(r"\bune semaine\b", t) else None
    nombre = _nombre(m.group(1))
    return nombre * 5 if m.group(2).startswith("semaine") else nombre


def _heures(t: str) -> tuple[time | None, time | None]:
    """« de 10h à 11h30 », « 10h-11h », « à 14h pendant 1h30 »."""
    duree = re.search(r"\bpendant (\d{1,2}) ?h ?(\d{2})?\b|\bpendant (\d{1,2}) heures?\b", t)
    reste = t[:duree.start()] + t[duree.end():] if duree else t
    instants = []
    for m in re.finditer(r"\b(\d{1,2}) ?(?:h|:) ?(\d{2})?\b", reste):
        heure, minute = int(m.group(1)), int(m.group(2) or 0)
        if heure <= 23 and minute <= 59:
            instants.append(time(heure, minute))
    debut = instants[0] if instants else None
    fin = instants[1] if len(instants) > 1 else None
    if debut and not fin and duree:
        minutes = int(duree.group(1) or duree.group(3)) * 60 + int(duree.group(2) or 0)
        total = debut.hour * 60 + debut.minute + minutes
        fin = time(min(total // 60, 23), total % 60) if total < 24 * 60 else None
    return debut, fin


def lire_periode(t: str, aujourdhui: date) -> Periode | None:
    """Période citée dans une question normalisée, ou None s'il n'y en a pas."""
    dates = [d for _, d in _dates_citees(t, aujourdhui)]
    duree = _duree_jours(t)
    demi = "apres_midi" if re.search(r"\bapres-midi\b|\bapres midi\b", t) else \
        "matin" if re.search(r"\bmatin(ee)?\b|\bdemi-journee\b|\bdemi journee\b", t) else None
    heure_debut, heure_fin = _heures(t)
    if len(dates) >= 2:
        debut, fin = dates[0], dates[1]
        if fin < debut:
            fin = _date_sure(fin.year + 1, fin.month, fin.day) or fin
    elif dates:
        debut = dates[0]
        fin = ajouter_jours_ouvres(debut, duree) if duree else debut
    elif re.search(r"\bsemaine prochaine\b", t):
        debut = lundi_suivant(aujourdhui)
        fin = ajouter_jours_ouvres(debut, duree) if duree else debut + timedelta(days=4)
    elif re.search(r"\bcette semaine\b", t):
        debut = aujourdhui
        fin = aujourdhui + timedelta(days=max(0, 4 - aujourdhui.weekday()))
    elif duree:
        debut = ajouter_jours_ouvres(aujourdhui + timedelta(days=1), 1)
        fin = ajouter_jours_ouvres(debut, duree)
    else:
        return None
    if fin < debut:
        debut, fin = fin, debut
    return Periode(debut, fin, demi, heure_debut, heure_fin)


# ------------------------------------------------------------------ Intentions
VERBE_ACTION = r"\b(poser|prendre|deposer|demander|reserver|planifier|je veux|je voudrais|j'aimerais|je souhaite|" \
               r"besoin d'une?|m'absenter|partir)\b"
QUESTION_CHIFFREE = r"\b(combien|reste|restant|solde|quota|maximum|max|regle|droit)\b"

# (intention, [(motif, poids), …]) — l'ordre départage les égalités : actions,
# équipe, informations personnelles, règles, puis aide.
INTENTIONS: list[tuple[str, list[tuple[str, int]]]] = [
    ("action_conge", [(VERBE_ACTION, 2), (r"\b(conges?|vacances|jours?|journees?|repos)\b", 2),
                      (r"\bconges? (du|le|a partir)\b", 2), (QUESTION_CHIFFREE, -4), (r"\bmission|teletravail\b", -3),
                      (r"\bautorisation\b", -3), (r"\b(perdre|perdus?|report|plafond|absents?|equipe)\b", -4)]),
    ("action_autorisation", [(VERBE_ACTION, 1), (r"\b(autorisation|m'absenter|sortir|sortie)\b", 2),
                             (r"\b\d{1,2} ?h", 2), (QUESTION_CHIFFREE, -4)]),
    ("action_mission", [(VERBE_ACTION, 2), (r"\b(mission|teletravail|deplacement|ordre de mission)\b", 2),
                        (r"\b(regle|comment|qu'est-ce)\b", -3)]),
    ("absents", [(r"\babsents?\b|\bqui (est|sera|seront) (en conge|absent|en mission|la)\b|\bqui manque\b", 4),
                 (r"\b(equipe|service|direction|collaborateurs?)\b", 1)]),
    ("a_valider", [(r"\b(a valider|a traiter|a approuver|valider|approuver|ma validation)\b", 2),
                   (r"\b(demandes?|file|attente|equipe|dossiers?)\b", 2), (r"\bqui (valide|approuve)\b", -5),
                   (r"\bvalidation automatique\b", -5)]),
    ("alertes", [(r"\balertes?\b", 4), (r"\bfin (d'essai|de periode d'essai|de contrat|de cdd)\b|\bretraites?\b", 3)]),
    ("solde", [(r"\bsolde\b", 4), (r"\bcombien de (jours|conges?)\b", 3), (r"\b(il me )?reste\b", 2),
               (r"\bconges?\b", 1), (r"\bpar mois\b|\bacqui|\bautorisation", -3)]),
    ("mes_demandes", [(r"\bma demande\b|\bmes demandes\b", 4), (r"\bou en est\b|\bstatut\b|\bsuivi\b|\bavancement\b", 2),
                      (r"\ben attente\b", 1), (r"\bvalider\b|\bequipe\b", -3)]),
    ("mon_validateur", [(r"\bqui (valide|approuve|signe|decide|traite)\b", 4),
                        (r"\bmon (superieur|responsable|chef|manager|n\+1|valideur)\b", 4)]),
    ("visite_medicale", [(r"\bvisite medicale\b|\bmedecin(e)? du travail\b|\baptitude\b", 4)]),
    ("fiche_objectifs", [(r"\bfiches? d'objectifs?\b|\bmes objectifs\b|\bobjectifs\b", 3),
                         (r"\bevaluation\b|\bentretien annuel\b", 3)]),
    ("report", [(r"\breport\b|\breporter\b|\b31 decembre\b|\b31/12\b|\bperdre\b|\bperdus?\b|\bplafond\b", 3),
                (r"\bconges?|jours\b", 1)]),
    ("regle_autorisation", [(r"\bautorisations?\b", 2),
                            (r"\b(combien|duree|maximum|max|quota|par mois|regle|droit|heures|reste)\b", 2)]),
    ("regle_horaires", [(r"\bhoraires?\b|\ba quelle heure\b|\bheure d'arrivee\b|\bheure de (depart|sortie)\b", 3),
                        (r"\bseance unique\b|\bete\b|\bjuillet\b|\baout\b|\bretard\b", 2)]),
    ("regle_exceptionnels", [(r"\b(mariage|naissance|deces|circoncision|paternite|paternel|prenatal|maternite|"
                              r"exceptionnels?|maladie|sans solde)\b", 3), (r"\b(combien|droit|jours)\b", 1)]),
    ("regle_acquisition", [(r"\bacqui(s|ert|erent|sition)\b|\bpar mois\b|\bchaque mois\b|\bcumul", 3),
                           (r"\bconges?|jours\b", 1)]),
    ("regle_validation_auto", [(r"\b48 ?h|\b48 heures\b|\bvalidation automatique\b|\bsans reponse\b|"
                                r"\bpas (de )?reponse\b|\bne (me )?repond pas\b", 4)]),
    ("regle_double_validation", [(r"\bdouble validation\b|\bdeux validations\b|\bplus de 10 jours\b|\bdeux niveaux\b", 4)]),
    ("jours_feries", [(r"\bferies?\b|\bfetes?\b|\baid\b|\bmouled\b", 4)]),
    ("regle_pieces", [(r"\bjustificatifs?\b|\bpieces? jointes?\b|\bformats?\b|\bpdf\b|\bdocx?\b", 3)]),
    ("regle_mot_de_passe", [(r"\bmot de passe\b|\bdouble authentification\b|\bcodes? de secours\b|\bbloque\b", 4)]),
    ("regle_priere", [(r"\bpriere\b", 4)]),
    ("aide", [(r"\baide\b|\bque (sais|peux)-tu\b|\bque sais tu\b|\bbonjour\b|\bsalut\b|\bmerci\b|\bcomment ca marche\b", 3)]),
]
SEUIL = 3
BONUS_PERIODE = {"action_conge": 2, "action_autorisation": 1, "action_mission": 2, "absents": 1}


def detecter(t: str, avec_periode: bool = False) -> str | None:
    """Intention la plus probable, ou None en dessous du seuil de confiance."""
    meilleure, meilleur_score = None, SEUIL - 1
    for nom, motifs in INTENTIONS:
        score = sum(poids for motif, poids in motifs if re.search(motif, t))
        if avec_periode:
            score += BONUS_PERIODE.get(nom, 0)
        if score > meilleur_score:
            meilleure, meilleur_score = nom, score
    return meilleure
