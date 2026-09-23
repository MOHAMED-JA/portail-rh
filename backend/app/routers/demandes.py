"""Demandes de congé, d'autorisation et de mission + file de validation."""
from __future__ import annotations

import shutil
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import EXTENSIONS_AUTORISEES, UPLOAD_DIR
from app.core.database import get_db
from app.core.security import utilisateur_courant, valideur_ou_suppleant
from app.models import (
    TYPES_AUTORISATION,
    TYPES_CONGE,
    TYPES_MISSION,
    Demande,
    Employe,
    Role,
    StatutDemande,
    TypeDemande,
)
from app.models import ROLES_RH  # noqa: E402
from app.schemas import (
    AutorisationPayload,
    CongePayload,
    DecisionPayload,
    DemandeDetail,
    MissionPayload,
    SimulationConge,
)
from app.services import demandes as svc
from app.services.calendrier import compter_jours_conge, compter_jours, feries_dans_periode

router = APIRouter(prefix="/api/demandes", tags=["Demandes"])


def detail(demande: Demande) -> DemandeDetail:
    sortie = DemandeDetail.model_validate(demande)
    sortie.sous_type_libelle = svc.libelle_sous_type(demande.type_demande, demande.sous_type)
    from app.services import validation_auto

    if (demande.statut == StatutDemande.EN_ATTENTE and demande.type_demande in validation_auto.TYPES_CONCERNES
            and parametres_actifs()):
        from sqlalchemy.orm import object_session
        session = object_session(demande)
        if session is not None:
            sortie.validation_auto_le = validation_auto.echeance(session, demande)
    return sortie


def parametres_actifs() -> bool:
    from app.services.parametres import REGLES
    return bool(REGLES.get("validationAutomatique", True))


def _equipe_ids(db: Session, utilisateur: Employe) -> list[int]:
    """Toute la ligne hiérarchique de l'utilisateur (tout le personnel pour
    la Direction générale)."""
    from app.services import hierarchie

    return list(hierarchie.perimetre_ids(db, utilisateur))


# ------------------------------------------------------------------ Référentiel
@router.get("/types", summary="Catalogue des types de demandes")
def types_demandes():
    return {
        "conge": TYPES_CONGE,
        "autorisation": TYPES_AUTORISATION,
        "mission": TYPES_MISSION,
    }


@router.get("/simulation-conge", response_model=SimulationConge, summary="Simuler l'impact sur le solde")
def simuler(
    date_debut: date,
    date_fin: date,
    sous_type: str = "annuel",
    demi_journee: str | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    if date_fin < date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")

    nombre = compter_jours_conge(date_debut, date_fin, demi_journee)
    solde = svc.solde_courant(db, utilisateur.id, date_debut.year)
    decompte = svc.decompte_solde(TypeDemande.CONGE, sous_type)
    restants_apres = solde.jours_restants - nombre if decompte else solde.jours_restants

    message = None
    if nombre == 0:
        message = "La période sélectionnée ne contient aucun jour ouvré."
    elif decompte and restants_apres < 0:
        message = (
            f"Dépassement de {abs(round(restants_apres, 1))} jour(s) sur votre solde. "
            "La demande reste possible et sera transmise à la RH pour validation."
        )
    elif not decompte:
        message = "Ce type de congé ne se déduit pas du solde annuel."

    return SimulationConge(
        nombre_jours=nombre,
        jours_restants_avant=solde.jours_restants,
        jours_restants_apres=round(restants_apres, 2),
        depassement=bool(decompte and restants_apres < 0),
        decompte_solde=decompte,
        jours_feries=feries_dans_periode(date_debut, date_fin),
        message=message,
    )


# --------------------------------------------------------------------- Dépôt
@router.post("/conge", response_model=DemandeDetail, status_code=201, summary="Déposer une demande de congé")
def demander_conge(
    payload: CongePayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    if payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    nombre = compter_jours_conge(payload.date_debut, payload.date_fin, payload.demi_journee)
    if nombre <= 0:
        raise HTTPException(status_code=422, detail="Aucun jour décompté dans la période choisie (week-end ou jours fériés)")

    regle = svc.valider_sous_type(TypeDemande.CONGE, payload.sous_type)
    from app.services.parametres import TYPES_INACTIFS
    if payload.sous_type in TYPES_INACTIFS:
        raise HTTPException(status_code=422, detail="Ce type de congé a été désactivé par la direction RH.")
    if regle.get("jours_max") and nombre > regle["jours_max"]:
        raise HTTPException(
            status_code=422,
            detail=f"« {regle['libelle'] } » est limité à {regle['jours_max']} jour(s).",
        )

    demande = svc.creer_demande(
        db,
        utilisateur,
        TypeDemande.CONGE,
        payload.sous_type,
        date_debut=payload.date_debut,
        date_fin=payload.date_fin,
        demi_journee=payload.demi_journee,
        nombre_jours=nombre,
        commentaire=payload.commentaire,
        piece_jointe=payload.piece_jointe,
    )
    return detail(demande)


@router.post("/autorisation", response_model=DemandeDetail, status_code=201, summary="Déposer une autorisation")
def demander_autorisation(
    payload: AutorisationPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    if payload.heure_fin <= payload.heure_debut:
        raise HTTPException(status_code=422, detail="L'heure de fin doit suivre l'heure de début")
    duree = (
        payload.heure_fin.hour * 60 + payload.heure_fin.minute
        - payload.heure_debut.hour * 60 - payload.heure_debut.minute
    ) / 60
    from app.services.parametres import REGLES

    if payload.sous_type == svc.PRIERE_VENDREDI:
        return _prier_le_vendredi(db, utilisateur, payload)
    maximum = float(REGLES.get("maxAutorisationHeures", 1.5))
    if duree > maximum + 1e-9:
        raise HTTPException(status_code=422, detail=(
            f"Une autorisation ne peut pas dépasser {svc.heures_fr(maximum)} "
            f"(demandé : {svc.heures_fr(duree)})."))
    deja = svc.heures_autorisation_du_mois(db, utilisateur.id, payload.date_debut)
    derogation = deja + duree > float(REGLES.get("quotaAutorisationMois", 4)) + 1e-9

    demande = svc.creer_demande(
        db,
        utilisateur,
        TypeDemande.AUTORISATION,
        payload.sous_type,
        date_debut=payload.date_debut,
        date_fin=payload.date_debut,
        heure_debut=payload.heure_debut,
        heure_fin=payload.heure_fin,
        duree_heures=round(duree, 2),
        nombre_jours=0,
        commentaire=payload.commentaire,
        derogation_rh=derogation,
    )
    return detail(demande)


def _prier_le_vendredi(db: Session, utilisateur: Employe, payload: AutorisationPayload):
    """Prière du vendredi : 13h–14h, accordée d'office puis valable chaque vendredi."""
    from datetime import time as heure

    inscription = svc.inscription_priere(db, utilisateur.id)
    if inscription:
        raise HTTPException(status_code=409, detail=(
            f"Vous êtes déjà autorisé(e) chaque vendredi de 13h à 14h (depuis le "
            f"{date.fromisoformat(inscription['depuis']):%d/%m/%Y}) : aucune nouvelle demande n'est nécessaire."))
    if payload.date_debut.weekday() != 4:
        raise HTTPException(status_code=422, detail="La prière du vendredi se demande pour un vendredi.")
    demande = svc.creer_demande(
        db, utilisateur, TypeDemande.AUTORISATION, svc.PRIERE_VENDREDI,
        date_debut=payload.date_debut, date_fin=payload.date_debut, heure_debut=heure(13, 0), heure_fin=heure(14, 0),
        duree_heures=1.0, nombre_jours=0, commentaire=payload.commentaire, sans_accord=True,
    )
    return detail(demande)


@router.get("/priere-vendredi", summary="Mon inscription à la prière du vendredi")
def ma_priere(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return svc.inscription_priere(db, utilisateur.id) or {}


@router.post("/mission", response_model=DemandeDetail, status_code=201, summary="Déposer un ordre de mission")
def demander_mission(
    payload: MissionPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    if payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    nombre = compter_jours(payload.date_debut, payload.date_fin)

    demande = svc.creer_demande(
        db,
        utilisateur,
        TypeDemande.MISSION,
        payload.sous_type,
        date_debut=payload.date_debut,
        date_fin=payload.date_fin,
        nombre_jours=nombre,
        commentaire=payload.commentaire,
    )
    return detail(demande)


@router.post("/piece-jointe", summary="Téléverser un justificatif")
def televerser(fichier: UploadFile = File(...), utilisateur: Employe = Depends(utilisateur_courant)):
    nom_fichier = fichier.filename or ""
    extension = ("." + nom_fichier.rsplit(".", 1)[-1].lower()) if "." in nom_fichier else ""
    if extension not in EXTENSIONS_AUTORISEES:
        raise HTTPException(
            status_code=422,
            detail="Format non compatible : seuls les fichiers PDF, DOC et DOCX sont acceptés.",
        )
    nom = f"{uuid.uuid4().hex}{extension}"
    with (UPLOAD_DIR / nom).open("wb") as cible:
        shutil.copyfileobj(fichier.file, cible)
    return {"chemin": f"/fichiers/{nom}", "nom_original": fichier.filename}


# ------------------------------------------------------------------ Consultation
@router.get("", response_model=list[DemandeDetail], summary="Mes demandes")
def mes_demandes(
    type_demande: TypeDemande | None = None,
    statut: StatutDemande | None = None,
    recherche: str | None = None,
    annee: int | None = None,
    limite: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    requete = select(Demande).where(Demande.employe_id == utilisateur.id)
    if type_demande:
        requete = requete.where(Demande.type_demande == type_demande)
    if statut:
        requete = requete.where(Demande.statut == statut)
    if annee:
        requete = requete.where(Demande.date_debut >= date(annee, 1, 1), Demande.date_debut <= date(annee, 12, 31))
    if recherche:
        motif = f"%{recherche.lower()}%"
        requete = requete.where(
            or_(Demande.reference.ilike(motif), Demande.commentaire.ilike(motif), Demande.sous_type.ilike(motif))
        )
    requete = requete.order_by(Demande.cree_le.desc()).limit(limite).offset(offset)
    return [detail(d) for d in db.scalars(requete)]


@router.get("/a-valider", response_model=list[DemandeDetail], summary="File de validation")
def file_validation(
    type_demande: TypeDemande | None = None,
    departement_id: int | None = None,
    inclure_traitees: bool = False,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_ou_suppleant),
):
    from app.services import hierarchie

    requete = select(Demande)
    if utilisateur.role in ROLES_RH:
        pass  # l'admin RH voit toute l'entreprise
    elif hierarchie.est_direction_generale(utilisateur) and not hierarchie.supervise_les_demandes(utilisateur):
        # Directeur Général : consultation (historique de l'équipe), pas de file de décision.
        requete = requete.where(Demande.validateur_id == utilisateur.id)
    else:
        from app.services import delegation

        ids = _equipe_ids(db, utilisateur)
        # Remplacement déclaré : la file du titulaire s'ajoute à la sienne.
        titulaires = delegation.titulaires_de(db, utilisateur.id)
        requete = requete.where(
            or_(Demande.validateur_id == utilisateur.id,
                Demande.employe_id.in_(ids or [-1]),
                Demande.validateur_id.in_(titulaires or [-1]))
        ).where(Demande.derogation_rh.is_(False))
    if not inclure_traitees:
        requete = requete.where(Demande.statut == StatutDemande.EN_ATTENTE)
    if type_demande:
        requete = requete.where(Demande.type_demande == type_demande)
    if departement_id:
        requete = requete.join(Employe, Employe.id == Demande.employe_id).where(
            Employe.departement_id == departement_id
        )
    requete = requete.order_by(Demande.cree_le.asc()).limit(300)
    return [detail(d) for d in db.scalars(requete)]


@router.get("/equipe", response_model=list[DemandeDetail], summary="Historique des demandes de l'équipe")
def demandes_equipe(
    db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_ou_suppleant)
):
    if utilisateur.role in ROLES_RH:
        requete = select(Demande)
    else:
        ids = _equipe_ids(db, utilisateur)
        requete = select(Demande).where(Demande.employe_id.in_(ids or [-1]))
    return [detail(d) for d in db.scalars(requete.order_by(Demande.cree_le.desc()).limit(300))]


@router.get("/{demande_id}", response_model=DemandeDetail, summary="Détail d'une demande")
def lire_demande(
    demande_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    demande = db.get(Demande, demande_id)
    if not demande:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    autorise = (
        demande.employe_id == utilisateur.id
        or demande.validateur_id == utilisateur.id
        or utilisateur.role in ROLES_RH
        or demande.employe_id in _equipe_ids(db, utilisateur)
    )
    if not autorise:
        raise HTTPException(status_code=403, detail="Accès non autorisé à cette demande")
    return detail(demande)


# -------------------------------------------------------------------- Décisions
def _charger_pour_decision(db: Session, demande_id: int, utilisateur: Employe) -> Demande:
    demande = db.get(Demande, demande_id)
    if not demande:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if demande.derogation_rh and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Dérogation au quota d'autorisations : décision réservée à la direction RH.")
    if utilisateur.role not in ROLES_RH and demande.validateur_id != utilisateur.id:
        from app.services import delegation, hierarchie

        if hierarchie.est_direction_generale(utilisateur) and not hierarchie.supervise_les_demandes(utilisateur):
            raise HTTPException(status_code=403, detail="Le Directeur Général consulte les demandes sans les valider.")
        remplace_le_valideur = (demande.validateur_id is not None
                                and delegation.remplace(db, utilisateur.id, demande.validateur_id))
        if not remplace_le_valideur and demande.employe_id not in _equipe_ids(db, utilisateur):
            raise HTTPException(status_code=403, detail="Vous n'êtes pas validateur de cette demande")
    if demande.employe_id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas valider votre propre demande")
    return demande


@router.post("/{demande_id}/approuver", response_model=DemandeDetail, summary="Approuver")
def approuver(
    demande_id: int,
    payload: DecisionPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_ou_suppleant),
):
    demande = _charger_pour_decision(db, demande_id, utilisateur)
    return detail(svc.appliquer_decision(db, demande, utilisateur, True, payload.commentaire, payload.signature))


@router.post("/{demande_id}/rejeter", response_model=DemandeDetail, summary="Rejeter")
def rejeter(
    demande_id: int,
    payload: DecisionPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_ou_suppleant),
):
    if not payload.commentaire:
        raise HTTPException(status_code=422, detail="Un motif de refus est obligatoire")
    demande = _charger_pour_decision(db, demande_id, utilisateur)
    return detail(svc.appliquer_decision(db, demande, utilisateur, False, payload.commentaire))


@router.post("/{demande_id}/annuler", response_model=DemandeDetail, summary="Annuler sa demande")
def annuler(
    demande_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    demande = db.get(Demande, demande_id)
    if not demande:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if demande.employe_id != utilisateur.id and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Seul le demandeur peut annuler sa demande")
    return detail(svc.annuler_demande(db, demande, utilisateur))
