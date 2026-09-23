"""Calcul des jours ouvrés et jours fériés (calendrier tunisien)."""
from datetime import date, timedelta

# Fériés à date fixe (jour, mois) — fêtes civiles tunisiennes.
FERIES_FIXES = {
    (1, 1): "Nouvel An",
    (14, 1): "Fête de la Révolution",
    (20, 3): "Fête de l'Indépendance",
    (9, 4): "Jour des Martyrs",
    (1, 5): "Fête du Travail",
    (25, 7): "Fête de la République",
    (13, 8): "Fête de la Femme",
    (15, 10): "Fête de l'Évacuation",
    (17, 12): "Fête de la Révolution et de la Jeunesse",
}

# Fêtes religieuses (calendrier lunaire) — saisies par l'administration RH.
FERIES_MOBILES: dict[date, str] = {
    date(2026, 3, 20): "Aïd el-Fitr",
    date(2026, 3, 21): "Aïd el-Fitr (2ᵉ jour)",
    date(2026, 5, 27): "Aïd el-Idha",
    date(2026, 5, 28): "Aïd el-Idha (2ᵉ jour)",
    date(2026, 6, 16): "Ras el-Am el-Hejri",
    date(2026, 8, 25): "Mouled",
}
# Valeurs d'origine : la liste en vigueur est chargée depuis les paramètres RH.
FERIES_MOBILES_DEFAUT = dict(FERIES_MOBILES)


def est_ferie(jour: date) -> str | None:
    if (jour.day, jour.month) in FERIES_FIXES:
        return FERIES_FIXES[(jour.day, jour.month)]
    return FERIES_MOBILES.get(jour)


def est_ouvre(jour: date) -> bool:
    """Semaine de travail du lundi au vendredi, hors jours fériés."""
    return jour.weekday() < 5 and est_ferie(jour) is None


def jours_ouvres(debut: date, fin: date) -> list[date]:
    jours: list[date] = []
    courant = debut
    while courant <= fin:
        if est_ouvre(courant):
            jours.append(courant)
        courant += timedelta(days=1)
    return jours


def compter_jours(debut: date, fin: date, demi_journee: str | None = None) -> float:
    """Nombre de jours ouvrés décomptés, demi-journée incluse."""
    nb = float(len(jours_ouvres(debut, fin)))
    if demi_journee and debut == fin and nb == 1:
        return 0.5
    if demi_journee and nb >= 1:
        return nb - 0.5
    return nb


def compter_jours_conge(debut: date, fin: date, demi_journee: str | None = None) -> float:
    """Décompte d'un congé selon la règle Veltaris :
    - les samedis et dimanches en début ou en fin de période ne comptent pas
      (congé du lundi au vendredi, retour le lundi : 5 jours) ;
    - ceux compris à l'intérieur de la période comptent (deux semaines du
      lundi au vendredi suivant : 12 jours, week-end intermédiaire inclus) ;
    - les jours fériés ne sont jamais décomptés."""
    while debut <= fin and debut.weekday() >= 5:
        debut += timedelta(days=1)
    while fin >= debut and fin.weekday() >= 5:
        fin -= timedelta(days=1)
    if fin < debut:
        return 0.0
    nb = 0
    courant = debut
    while courant <= fin:
        if est_ferie(courant) is None:
            nb += 1
        courant += timedelta(days=1)
    if demi_journee and nb >= 1:
        return 0.5 if nb == 1 else nb - 0.5
    return float(nb)


def feries_dans_periode(debut: date, fin: date) -> list[str]:
    resultats = []
    courant = debut
    while courant <= fin:
        libelle = est_ferie(courant)
        if libelle and courant.weekday() < 5:
            resultats.append(f"{courant.strftime('%d/%m')} — {libelle}")
        courant += timedelta(days=1)
    return resultats


def code_semaine(jour: date) -> str:
    annee, semaine, _ = jour.isocalendar()
    return f"{annee}-W{semaine:02d}"


def lundi_de_semaine(code: str) -> date:
    """« 2026-W38 » → date du lundi correspondant."""
    annee, semaine = code.split("-W")
    return date.fromisocalendar(int(annee), int(semaine), 1)
