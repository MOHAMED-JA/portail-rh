"""Moteur de pointage : des passages bruts de badge à la journée calculée.

Règles Veltaris :
- semaine du lundi au vendredi ; samedi et dimanche sont des repos ;
- horaire normal 8h–12h / 13h–17h ; en juillet et août, séance unique 8h–14h ;
- chaque passage (entrée ou sortie) est conservé et affiché tel quel ;
- les heures de référence sont la première entrée et la dernière sortie ;
- ne pas badger entre 12h et 13h n'est pas une anomalie (la pause d'une heure
  est alors déduite) ;
- un nombre de passages impair dans une journée terminée est une anomalie :
  une entrée ou une sortie manque ;
- retard au-delà de la tolérance, départ avant l'heure de fin ; une
  autorisation approuvée couvrant le créneau les excuse.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Anomalie,
    CodePresence,
    Demande,
    PassageBadge,
    Pointage,
    StatutAnomalie,
    StatutDemande,
    TypeAnomalie,
    TypeDemande,
)
from app.services import parametres
from app.services.calendrier import est_ouvre

LIBELLES = {
    TypeAnomalie.ENTREE_MANQUANTE: "Entrée manquante",
    TypeAnomalie.SORTIE_MANQUANTE: "Sortie manquante",
    TypeAnomalie.RETARD: "Retard",
    TypeAnomalie.DEPART_ANTICIPE: "Départ anticipé",
    TypeAnomalie.ABSENCE_NON_JUSTIFIEE: "Absence non justifiée",
    TypeAnomalie.POINTAGE_IMPAIR: "Nombre de pointages impair (entrée ou sortie manquante)",
}


def _heure(texte: str) -> time:
    h, m = (int(x) for x in str(texte).split(":")[:2])
    return time(h, m)


def _minutes(t: time | datetime) -> int:
    return t.hour * 60 + t.minute


@dataclass
class Horaire:
    ouvre: bool
    debut: time
    fin: time
    pause: tuple[time, time] | None
    heures_prevues: float


def horaire_du_jour(jour: date) -> Horaire:
    r = parametres.REGLES
    ete = jour.month in set(r.get("moisSeanceUnique", [7, 8]))
    if ete:
        debut, fin, pause = _heure(r.get("heureArriveeEte", "08:00")), _heure(r.get("heureDepartEte", "14:00")), None
    else:
        debut, fin = _heure(r.get("heureArrivee", "08:00")), _heure(r.get("heureDepart", "17:00"))
        pause = (_heure(r.get("pauseDebut", "12:00")), _heure(r.get("pauseFin", "13:00")))
    duree = _minutes(fin) - _minutes(debut) - ((_minutes(pause[1]) - _minutes(pause[0])) if pause else 0)
    ouvre = est_ouvre(jour)
    return Horaire(ouvre, debut, fin, pause, round(duree / 60, 2) if ouvre else 0.0)


def journee_terminee(jour: date, horaire: Horaire, maintenant: datetime | None = None) -> bool:
    maintenant = maintenant or datetime.now()
    if jour < maintenant.date():
        return True
    if jour > maintenant.date():
        return False
    return _minutes(maintenant) >= _minutes(horaire.fin) + 60


@dataclass
class Creneau:
    heure_debut: time
    heure_fin: time


def priere_du_jour(db: Session, employe_id: int, jour: date) -> Creneau | None:
    """Vendredi 13h–14h pour un collaborateur inscrit à la prière du vendredi."""
    if jour.weekday() != 4:
        return None
    inscription = parametres.lire(db, f"priere_vendredi:{employe_id}")
    if not inscription or jour < date.fromisoformat(inscription["depuis"]):
        return None
    return Creneau(time(13, 0), time(14, 0))


def _autorisations(db: Session, employe_id: int, jour: date) -> list:
    accordees = list(db.scalars(select(Demande).where(
        Demande.employe_id == employe_id, Demande.type_demande == TypeDemande.AUTORISATION,
        Demande.statut == StatutDemande.APPROUVEE, Demande.date_debut == jour)))
    priere = priere_du_jour(db, employe_id, jour)
    return accordees + ([priere] if priere else [])


def passages_du_jour(db: Session, employe_id: int, jour: date) -> list[PassageBadge]:
    debut = datetime.combine(jour, time.min)
    return list(db.scalars(select(PassageBadge).where(
        PassageBadge.employe_id == employe_id, PassageBadge.horodatage >= debut,
        PassageBadge.horodatage < debut + timedelta(days=1)).order_by(PassageBadge.horodatage)))


def _migrer_colonnes(db: Session, pointage: Pointage) -> None:
    """Pointage ancien (quatre colonnes, sans passage) : ses heures deviennent
    des passages, une seule fois."""
    for valeur in (pointage.entree1, pointage.sortie1, pointage.entree2, pointage.sortie2):
        if valeur is not None:
            db.add(PassageBadge(employe_id=pointage.employe_id, horodatage=datetime.combine(pointage.date_jour, valeur),
                                source="import"))
    db.flush()


def recalculer(db: Session, employe_id: int, jour: date, maintenant: datetime | None = None) -> Pointage | None:
    """Recalcule la journée à partir des passages et régénère ses anomalies."""
    pointage = db.scalar(select(Pointage).where(Pointage.employe_id == employe_id, Pointage.date_jour == jour))
    passages = passages_du_jour(db, employe_id, jour)
    if pointage is not None and not passages and any(
            (pointage.entree1, pointage.sortie1, pointage.entree2, pointage.sortie2)):
        _migrer_colonnes(db, pointage)
        passages = passages_du_jour(db, employe_id, jour)
    if not passages and pointage is None:
        return None

    horaire = horaire_du_jour(jour)
    priere = priere_du_jour(db, employe_id, jour)
    if priere and horaire.ouvre:
        # L'heure de prière autorisée est retirée des heures attendues.
        chevauchement = max(0, min(_minutes(priere.heure_fin), _minutes(horaire.fin))
                            - max(_minutes(priere.heure_debut), _minutes(horaire.debut)))
        if horaire.pause:
            chevauchement -= max(0, min(_minutes(priere.heure_fin), _minutes(horaire.pause[1]))
                                 - max(_minutes(priere.heure_debut), _minutes(horaire.pause[0])))
        horaire.heures_prevues = round(horaire.heures_prevues - max(0, chevauchement) / 60, 2)
    if pointage is None:
        pointage = Pointage(employe_id=employe_id, date_jour=jour)
        db.add(pointage)
    heures = [p.horodatage.time().replace(second=0, microsecond=0) for p in passages]
    n = len(heures)
    pointage.heures_prevues = horaire.heures_prevues
    # Colonnes de synthèse : première entrée, dernière sortie, pause éventuelle.
    pointage.entree1 = heures[0] if n else None
    pointage.sortie2 = heures[-1] if n >= 2 else None
    pointage.sortie1 = heures[1] if n >= 4 else None
    pointage.entree2 = heures[2] if n >= 4 else None
    if n and pointage.code_presence in (CodePresence.ABSENT, None):
        pointage.code_presence = CodePresence.PRESENT

    # Heures travaillées : somme des paires entrée → sortie.
    total = 0
    for i in range(0, n - 1, 2):
        total += max(0, _minutes(heures[i + 1]) - _minutes(heures[i]))
    # Deux passages seulement qui encadrent la pause : elle est déduite.
    if n == 2 and horaire.pause and _minutes(heures[0]) <= _minutes(horaire.pause[0]) \
            and _minutes(heures[1]) >= _minutes(horaire.pause[1]):
        total -= _minutes(horaire.pause[1]) - _minutes(horaire.pause[0])
    pointage.heures_travaillees = round(max(0, total) / 60, 2)

    detectees: list[TypeAnomalie] = []
    autorisations = _autorisations(db, employe_id, jour)
    tolerance = int(parametres.REGLES.get("toleranceRetard", 5))
    if n and horaire.ouvre and pointage.code_presence == CodePresence.PRESENT:
        retard = _minutes(heures[0]) - _minutes(horaire.debut)
        excuse = any(a.heure_debut and a.heure_fin and _minutes(a.heure_debut) <= _minutes(horaire.debut) + tolerance
                     and _minutes(a.heure_fin) >= _minutes(heures[0]) for a in autorisations)
        pointage.retard_minutes = max(0, retard) if retard > tolerance and not excuse else 0
        if pointage.retard_minutes:
            detectees.append(TypeAnomalie.RETARD)
    else:
        pointage.retard_minutes = 0

    if n and horaire.ouvre and journee_terminee(jour, horaire, maintenant):
        if n % 2 == 1:
            detectees.append(TypeAnomalie.POINTAGE_IMPAIR)
        elif _minutes(heures[-1]) < _minutes(horaire.fin):
            excuse = any(a.heure_debut and a.heure_fin and _minutes(a.heure_debut) <= _minutes(heures[-1])
                         and _minutes(a.heure_fin) >= _minutes(horaire.fin) - tolerance for a in autorisations)
            if not excuse:
                detectees.append(TypeAnomalie.DEPART_ANTICIPE)

    db.flush()
    synchroniser(db, pointage, detectees)
    return pointage


def synchroniser(db: Session, pointage: Pointage, detectees: list[TypeAnomalie]) -> None:
    existantes = db.scalars(select(Anomalie).where(
        Anomalie.employe_id == pointage.employe_id, Anomalie.date_jour == pointage.date_jour)).all()
    for anomalie in existantes:
        if anomalie.type_anomalie not in detectees and anomalie.statut == StatutAnomalie.OUVERTE:
            db.delete(anomalie)
    deja = {a.type_anomalie for a in existantes}
    for type_anomalie in detectees:
        if type_anomalie not in deja:
            db.add(Anomalie(employe_id=pointage.employe_id, pointage_id=pointage.id, date_jour=pointage.date_jour,
                            type_anomalie=type_anomalie, detail=LIBELLES[type_anomalie]))


def enregistrer_passage(db: Session, employe_id: int, horodatage: datetime, source: str,
                        terminal: str | None = None) -> bool:
    """Ajoute un passage (sans doublon) ; renvoie False s'il existait déjà."""
    horodatage = horodatage.replace(microsecond=0)
    existe = db.scalar(select(PassageBadge.id).where(
        PassageBadge.employe_id == employe_id, PassageBadge.horodatage == horodatage))
    if existe:
        return False
    db.add(PassageBadge(employe_id=employe_id, horodatage=horodatage, source=source, terminal=terminal))
    db.flush()
    return True


def recalculer_recents(db: Session, jours: int = 2) -> int:
    """Tâche périodique : clôture les journées récentes (anomalies de fin de
    journée : pointage impair, départ anticipé)."""
    limite = date.today() - timedelta(days=jours)
    pointages = db.scalars(select(Pointage).where(Pointage.date_jour >= limite)).all()
    for p in pointages:
        recalculer(db, p.employe_id, p.date_jour)
    db.commit()
    return len(pointages)
