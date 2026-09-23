"""Règles métier des demandes : solde, workflow, transitions de statut."""
from __future__ import annotations

import secrets
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    TYPES_AUTORISATION,
    TYPES_CONGE,
    TYPES_CONGE_DECOMPTES,
    TYPES_MISSION,
    Demande,
    Employe,
    HistoriqueStatut,
    Role,
    SoldeConge,
    StatutDemande,
    TypeDemande,
    WorkflowValidation,
)
from app.models import ROLES_RH  # noqa: E402
from app.services.notifications import notifier

PREFIXES = {TypeDemande.CONGE: "CG", TypeDemande.AUTORISATION: "AU", TypeDemande.MISSION: "MS"}

CATALOGUES = {
    TypeDemande.CONGE: TYPES_CONGE,
    TypeDemande.AUTORISATION: TYPES_AUTORISATION,
    TypeDemande.MISSION: TYPES_MISSION,
}


def libelle_sous_type(type_demande: TypeDemande, code: str) -> str:
    for item in CATALOGUES[type_demande]:
        if item["code"] == code:
            return item["libelle"]
    return code


def valider_sous_type(type_demande: TypeDemande, code: str) -> dict:
    for item in CATALOGUES[type_demande]:
        if item["code"] == code:
            return item
    raise HTTPException(status_code=422, detail="Type de demande inconnu")


def generer_reference(db: Session, type_demande: TypeDemande) -> str:
    prefixe = PREFIXES[type_demande]
    annee = date.today().year
    while True:
        reference = f"{prefixe}-{annee}-{secrets.randbelow(90000) + 10000}"
        if not db.scalar(select(Demande).where(Demande.reference == reference)):
            return reference


def solde_courant(db: Session, employe_id: int, annee: int | None = None) -> SoldeConge:
    annee = annee or date.today().year
    solde = db.scalar(
        select(SoldeConge).where(SoldeConge.employe_id == employe_id, SoldeConge.annee == annee)
    )
    if solde is None:
        solde = SoldeConge(employe_id=employe_id, annee=annee, jours_acquis=0, jours_pris=0)
        db.add(solde)
        db.flush()
    return solde


def decompte_solde(type_demande: TypeDemande, sous_type: str) -> bool:
    return type_demande == TypeDemande.CONGE and sous_type in TYPES_CONGE_DECOMPTES


def niveaux_requis(db: Session, employe: Employe, type_demande: TypeDemande, nombre_jours: float) -> int:
    """Workflow configurable : le niveau dépend du type, du département et
    éventuellement d'un seuil de durée (ex. congé > 10 jours → double validation)."""
    regles = db.scalars(
        select(WorkflowValidation).where(WorkflowValidation.type_demande == type_demande)
    ).all()
    niveaux = 1
    for regle in regles:
        if regle.departement_id and regle.departement_id != employe.departement_id:
            continue
        if regle.seuil_jours is not None and nombre_jours < regle.seuil_jours:
            continue
        niveaux = max(niveaux, regle.niveaux)
    return niveaux


def validateurs_possibles(db: Session, employe: Employe) -> list[Employe]:
    """Chaîne hiérarchique qui décide : N+1, puis N+2 pour les niveaux
    supérieurs. La Direction générale (DG, DGA) n'en fait pas partie : le DGA
    supervise et peut valider, le DG consulte (services/hierarchie.py)."""
    from app.services.hierarchie import est_direction_generale

    chaine: list[Employe] = []
    courant = employe.validateur
    garde = 0
    while courant and garde < 8:
        if courant.id != employe.id and not est_direction_generale(courant):
            chaine.append(courant)
        courant = courant.validateur
        garde += 1
    return chaine


def premier_validateur_rh(db: Session, employe: Employe) -> Employe | None:
    """Sans supérieur opérationnel, l'administration RH décide."""
    admins = administrateurs_rh(db, sauf=employe.id)
    return admins[0] if admins else None


PRIERE_VENDREDI = "priere_vendredi"


def inscription_priere(db: Session, employe_id: int) -> dict | None:
    """Inscription à la prière du vendredi : {"depuis": "AAAA-MM-JJ"} ou None."""
    from app.services import parametres
    return parametres.lire(db, f"priere_vendredi:{employe_id}")


def heures_fr(heures: float) -> str:
    """1.5 → « 1h30 »."""
    minutes = round(heures * 60)
    return f"{minutes // 60}h{minutes % 60:02d}" if minutes % 60 else f"{minutes // 60}h"


def heures_autorisation_du_mois(db: Session, employe_id: int, jour: date) -> float:
    """Heures d'autorisation déjà demandées (en attente ou accordées) dans le mois."""
    debut = jour.replace(day=1)
    fin = (debut.replace(year=debut.year + 1, month=1) if debut.month == 12 else debut.replace(month=debut.month + 1))
    demandes = db.scalars(select(Demande).where(
        Demande.employe_id == employe_id, Demande.type_demande == TypeDemande.AUTORISATION,
        Demande.statut.in_([StatutDemande.EN_ATTENTE, StatutDemande.APPROUVEE]),
        Demande.sous_type != PRIERE_VENDREDI,   # hors quota : autorisation permanente
        Demande.date_debut >= debut, Demande.date_debut < fin)).all()
    return round(sum(d.duree_heures or 0 for d in demandes), 2)


def administrateurs_rh(db: Session, sauf: int | None = None) -> list[Employe]:
    from app.models import Role, StatutEmploye
    return [e for e in db.scalars(select(Employe).where(Employe.role.in_(ROLES_RH), Employe.statut != StatutEmploye.SORTI))
            if e.id != sauf]


def journaliser(db: Session, demande: Demande, statut: StatutDemande, acteur_id: int | None, commentaire: str | None = None) -> None:
    db.add(
        HistoriqueStatut(
            demande_id=demande.id,
            statut=statut,
            acteur_id=acteur_id,
            commentaire=commentaire,
            horodatage=datetime.utcnow(),
        )
    )


def creer_demande(
    db: Session,
    employe: Employe,
    type_demande: TypeDemande,
    sous_type: str,
    **champs,
) -> Demande:
    valider_sous_type(type_demande, sous_type)
    nombre_jours = champs.get("nombre_jours", 0) or 0
    sans_accord = bool(champs.pop("sans_accord", False))

    solde_insuffisant = False
    if decompte_solde(type_demande, sous_type):
        solde = solde_courant(db, employe.id, champs["date_debut"].year)
        if nombre_jours > solde.jours_restants:
            solde_insuffisant = True

    chaine = validateurs_possibles(db, employe)
    validateur = chaine[0] if chaine else premier_validateur_rh(db, employe)
    derogation = bool(champs.get("derogation_rh"))
    if sans_accord:
        return _creer_sans_accord(db, employe, type_demande, sous_type, validateur, champs)
    if derogation:
        # Quota mensuel dépassé : la dérogation est accordée par la RH seule.
        admins = administrateurs_rh(db, sauf=employe.id)
        validateur = admins[0] if admins else None
    if solde_insuffisant:
        admins = administrateurs_rh(db, sauf=employe.id)
        validateur = admins[0] if admins else None

    demande = Demande(
        reference=generer_reference(db, type_demande),
        type_demande=type_demande,
        sous_type=sous_type,
        solde_insuffisant=solde_insuffisant,
        employe_id=employe.id,
        statut=StatutDemande.EN_ATTENTE,
        validateur_id=validateur.id if validateur else None,
        niveau_courant=1,
        niveaux_requis=1 if derogation else niveaux_requis(db, employe, type_demande, nombre_jours),
        cree_le=datetime.utcnow(),
        **champs,
    )
    db.add(demande)
    db.flush()

    journaliser(db, demande, StatutDemande.EN_ATTENTE, employe.id,
                "Demande soumise — solde insuffisant, décision RH" if solde_insuffisant else ("Demande soumise — dérogation au quota mensuel, décision RH" if derogation else "Demande soumise"))

    from app.services import emails

    destinataires = administrateurs_rh(db, sauf=employe.id) if (derogation or solde_insuffisant) else ([validateur] if validateur else [])
    for destinataire in destinataires:
        notifier(
            db,
            destinataire.id,
            "Congé à valider — solde insuffisant" if solde_insuffisant else ("Dérogation à valider (quota d'autorisations dépassé)" if derogation else "Nouvelle demande à valider"),
            f"{employe.prenom} {employe.nom} — {libelle_sous_type(type_demande, sous_type)} "
            f"({demande.reference})",
            type_notif="validation",
            lien="/validation",
        )
        emails.demande_a_valider(db, demande, destinataire, derogation)
        # Remplaçant déclaré : prévenu en même temps que le titulaire, sinon la
        # demande attendrait un retour d'absence.
        from app.services import delegation as _delegation

        remplacant = _delegation.suppleant_de(db, destinataire.id)
        if remplacant is not None and remplacant.id != employe.id:
            notifier(db, remplacant.id, "Demande à valider (remplacement)",
                     f"{employe.prenom} {employe.nom} — {libelle_sous_type(type_demande, sous_type)} "
                     f"({demande.reference}). Vous décidez à la place de {destinataire.nom_complet}.",
                     type_notif="validation", lien="/validation")
            emails.demande_a_valider(db, demande, remplacant, derogation)
    # Le DGA est informé de toute demande de sa ligne ; il peut la valider tant
    # que le supérieur hiérarchique ne l'a pas fait.
    from app.services.hierarchie import dga_de

    dga = dga_de(employe)
    if dga and not derogation and dga.id not in {d.id for d in destinataires} and dga.id != employe.id:
        notifier(db, dga.id, "Nouvelle demande dans votre périmètre",
                 f"{employe.prenom} {employe.nom} — {libelle_sous_type(type_demande, sous_type)} ({demande.reference}). "
                 f"Décision attendue du supérieur hiérarchique ; vous pouvez la valider à défaut.",
                 type_notif="info", lien="/validation")
    db.commit()
    db.refresh(demande)
    return demande


def _creer_sans_accord(db: Session, employe: Employe, type_demande: TypeDemande, sous_type: str,
                       validateur: Employe | None, champs: dict) -> Demande:
    """Prière du vendredi : l'autorisation est accordée d'office et inscrite
    comme permanente — chaque vendredi, 13h–14h, sans nouvelle demande."""
    from app.services import parametres

    demande = Demande(reference=generer_reference(db, type_demande), type_demande=type_demande, sous_type=sous_type,
                      employe_id=employe.id, statut=StatutDemande.APPROUVEE, validateur_id=None,
                      date_validation=datetime.utcnow(), niveau_courant=1, niveaux_requis=1,
                      cree_le=datetime.utcnow(), **champs)
    db.add(demande)
    db.flush()
    journaliser(db, demande, StatutDemande.APPROUVEE, employe.id,
                "Prière du vendredi : autorisation permanente (chaque vendredi 13h–14h), sans accord")
    parametres.ecrire(db, f"priere_vendredi:{employe.id}", {"depuis": champs["date_debut"].isoformat(),
                                                           "reference": demande.reference})
    if validateur:
        notifier(db, validateur.id, "Prière du vendredi",
                 f"{employe.prenom} {employe.nom} sort désormais chaque vendredi de 13h à 14h (autorisation sans accord).",
                 type_notif="info", lien="/validation")
    notifier(db, employe.id, "Prière du vendredi enregistrée",
             "Vous êtes autorisé(e) chaque vendredi de 13h à 14h, sans nouvelle demande.", type_notif="succes",
             lien="/mes-demandes")
    from app.services import pointage
    pointage.recalculer(db, employe.id, champs["date_debut"])
    db.commit()
    db.refresh(demande)
    return demande


def appliquer_decision(
    db: Session,
    demande: Demande,
    acteur: Employe,
    approuve: bool,
    commentaire: str | None = None,
    signature: str | None = None,
    automatique: bool = False,
) -> Demande:
    if demande.statut != StatutDemande.EN_ATTENTE:
        raise HTTPException(status_code=409, detail="Cette demande a déjà été traitée")

    libelle = libelle_sous_type(demande.type_demande, demande.sous_type)

    if not approuve:
        demande.statut = StatutDemande.REJETEE
        demande.motif_refus = commentaire
        demande.date_validation = datetime.utcnow()
        demande.validateur_id = acteur.id
        journaliser(db, demande, StatutDemande.REJETEE, acteur.id, commentaire or "Demande rejetée")
        notifier(
            db,
            demande.employe_id,
            "Demande refusée",
            f"{libelle} ({demande.reference}) — motif : {commentaire or 'non précisé'}",
            type_notif="alerte",
            lien="/mes-demandes",
        )
        from app.services import emails
        emails.decision(db, demande, acteur, approuve=False, motif=commentaire)
        db.commit()
        db.refresh(demande)
        return demande

    # Validation multi-niveaux : on ne clôture qu'au dernier niveau.
    suivant = None
    if demande.niveau_courant < demande.niveaux_requis:
        chaine = validateurs_possibles(db, demande.employe)
        suivant = chaine[demande.niveau_courant] if len(chaine) > demande.niveau_courant else None
        # Pas de N+2 opérationnel : second niveau par l'administration RH, sauf
        # si c'est elle qui vient de valider (la demande est alors approuvée).
        if suivant is None and acteur.role not in ROLES_RH:
            suivant = premier_validateur_rh(db, demande.employe)
    if suivant is not None and suivant.id != acteur.id:
        demande.niveau_courant += 1
        demande.validateur_id = suivant.id
        journaliser(
            db,
            demande,
            StatutDemande.EN_ATTENTE,
            None if automatique else acteur.id,
            f"Validation niveau {demande.niveau_courant - 1} accordée"
            + (" automatiquement (sans réponse dans le délai)" if automatique else ""),
        )
        notifier(
            db,
            suivant.id,
            "Demande à valider (niveau 2)",
            f"{demande.employe.prenom} {demande.employe.nom} — {libelle} ({demande.reference})",
            type_notif="validation",
            lien="/validation",
        )
        from app.services import emails
        emails.demande_a_valider(db, demande, suivant, False)
        notifier(
            db,
            demande.employe_id,
            "Demande validée au niveau 1",
            f"{libelle} ({demande.reference}) attend la validation finale.",
            type_notif="info",
            lien="/mes-demandes",
        )
        db.commit()
        db.refresh(demande)
        return demande

    demande.statut = StatutDemande.APPROUVEE
    demande.date_validation = datetime.utcnow()
    demande.validateur_id = acteur.id
    demande.signature = signature

    # Le solde n'est décrémenté qu'à l'approbation finale.
    if decompte_solde(demande.type_demande, demande.sous_type):
        solde = solde_courant(db, demande.employe_id, demande.date_debut.year)
        solde.jours_pris = round(solde.jours_pris + demande.nombre_jours, 2)

    journaliser(db, demande, StatutDemande.APPROUVEE, None if automatique else acteur.id,
                commentaire or "Demande approuvée")
    notifier(
        db,
        demande.employe_id,
        "Demande validée automatiquement" if automatique else "Demande approuvée",
        f"{libelle} ({demande.reference}) du {demande.date_debut:%d/%m/%Y} au {demande.date_fin:%d/%m/%Y}"
        + (" — sans réponse dans le délai réglementaire." if automatique else "."),
        type_notif="succes",
        lien="/mes-demandes",
    )
    from app.services import emails
    emails.decision(db, demande, acteur, approuve=True, motif=commentaire, automatique=automatique)
    # Une autorisation accordée peut excuser un retard ou un départ du jour.
    if demande.type_demande == TypeDemande.AUTORISATION:
        from app.services import pointage
        pointage.recalculer(db, demande.employe_id, demande.date_debut)
    db.commit()
    db.refresh(demande)
    return demande


def annuler_demande(db: Session, demande: Demande, acteur: Employe) -> Demande:
    if demande.statut not in (StatutDemande.EN_ATTENTE, StatutDemande.APPROUVEE):
        raise HTTPException(status_code=409, detail="Cette demande ne peut plus être annulée")
    if demande.statut == StatutDemande.APPROUVEE and decompte_solde(demande.type_demande, demande.sous_type):
        solde = solde_courant(db, demande.employe_id, demande.date_debut.year)
        solde.jours_pris = max(0.0, round(solde.jours_pris - demande.nombre_jours, 2))

    demande.statut = StatutDemande.ANNULEE
    journaliser(db, demande, StatutDemande.ANNULEE, acteur.id, "Demande annulée")
    if demande.sous_type == PRIERE_VENDREDI:
        # Annuler la demande d'origine met fin à l'autorisation permanente.
        inscription = inscription_priere(db, demande.employe_id)
        if inscription and inscription.get("reference") == demande.reference:
            from app.models import Parametre
            ligne = db.get(Parametre, f"priere_vendredi:{demande.employe_id}")
            if ligne:
                db.delete(ligne)
    if demande.validateur_id:
        notifier(
            db,
            demande.validateur_id,
            "Demande annulée",
            f"{demande.employe.prenom} {demande.employe.nom} a annulé {demande.reference}.",
            type_notif="info",
            lien="/validation",
        )
    db.commit()
    db.refresh(demande)
    return demande


def serialiser(demande: Demande) -> dict:
    """Ajoute le libellé lisible du sous-type au schéma de sortie."""
    return {"sous_type_libelle": libelle_sous_type(demande.type_demande, demande.sous_type)}
