"""Administration RH : employés, départements, soldes, organigramme, audit, imports."""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis, hash_password, utilisateur_courant, valideur_requis
from app.models import (
    Anomalie,
    CodePresence,
    Demande,
    Departement,
    Employe,
    JournalAudit,
    Pointage,
    Role,
    SoldeConge,
    StatutDemande,
    StatutEmploye,
)
from app.models import ROLES_RH  # noqa: E402
from app.schemas import (
    AuditItem,
    DepartementDetail,
    DepartementPayload,
    EmployeDetail,
    EmployeMAJ,
    EmployePayload,
    SoldeDetail,
    SoldePayload,
)
from app.routers.presences import synchroniser_anomalies
from app.services.calendrier import est_ouvre
from app.services.demandes import solde_courant

router = APIRouter(prefix="/api/administration", tags=["Administration RH"])


def _tracer(db: Session, acteur: Employe, action: str, cible: str | None = None, detail: str | None = None) -> None:
    db.add(JournalAudit(acteur_id=acteur.id, action=action, cible=cible, detail=detail))


def signaler_fiches_en_attente(db: Session, employe: Employe) -> None:
    """Nouveau supérieur hiérarchique : il est prévenu des fiches du
    collaborateur qui attendent déjà une décision."""
    from app.models import FicheObjectifs, StatutFicheObjectifs
    from app.services.notifications import notifier

    fiche = db.scalar(select(FicheObjectifs).where(
        FicheObjectifs.employe_id == employe.id,
        FicheObjectifs.annee == date.today().year,
        FicheObjectifs.statut == StatutFicheObjectifs.SOUMISE,
    ))
    if fiche:
        notifier(db, employe.validateur_id, "Fiche d'objectifs à valider",
                 f"{employe.prenom} {employe.nom} a soumis sa fiche d'objectifs {fiche.annee} "
                 f"({len(fiche.objectifs)} objectif(s)).", "validation", "/fiche-objectifs")


def _garde_roles(utilisateur: Employe, cible: Employe | None, role_demande: Role | None) -> None:
    """Le gestionnaire RH gère les profils, mais seul l'administrateur attribue
    un rôle RH ou modifie un compte RH (pas d'élévation de ses propres droits)."""
    if utilisateur.role == Role.ADMIN_RH:
        return
    if role_demande in ROLES_RH:
        raise HTTPException(status_code=403, detail="Seul l'administrateur RH attribue les rôles RH.")
    if cible is not None and cible.role in ROLES_RH:
        raise HTTPException(status_code=403, detail="Seul l'administrateur RH modifie un compte RH.")


# ------------------------------------------------------------------- Employés
@router.get("/employes", response_model=list[EmployeDetail], summary="Liste des employés")
def lister_employes(
    recherche: str | None = None,
    departement_id: int | None = None,
    statut: StatutEmploye | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_requis),
):
    requete = select(Employe)
    if utilisateur.role not in ROLES_RH:
        from app.services.hierarchie import perimetre_ids
        requete = requete.where(Employe.id.in_(perimetre_ids(db, utilisateur)))
    if recherche:
        motif = f"%{recherche.lower()}%"
        requete = requete.where(
            func.lower(Employe.nom).like(motif)
            | func.lower(Employe.prenom).like(motif)
            | func.lower(Employe.matricule).like(motif)
        )
    if departement_id:
        requete = requete.where(Employe.departement_id == departement_id)
    if statut:
        requete = requete.where(Employe.statut == statut)
    return list(db.scalars(requete.order_by(Employe.nom, Employe.prenom).limit(500)))


@router.post("/employes", response_model=EmployeDetail, status_code=201, summary="Créer un employé")
def creer_employe(
    payload: EmployePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)
):
    if db.scalar(select(Employe).where(Employe.matricule == payload.matricule.upper())):
        raise HTTPException(status_code=409, detail="Ce matricule existe déjà")
    _garde_roles(utilisateur, None, payload.role)
    from app.services import hierarchie

    hierarchie.verifier_niveau(payload.niveau)
    hierarchie.verifier_rattachement(db, None, payload.validateur_id)
    hierarchie.verifier_departement(db, payload.departement_id)

    employe = Employe(
        niveau=payload.niveau,
        matricule=payload.matricule.upper(),
        nom=payload.nom,
        prenom=payload.prenom,
        email=payload.email,
        telephone=payload.telephone,
        poste=payload.poste,
        date_entree=payload.date_entree,
        departement_id=payload.departement_id,
        validateur_id=payload.validateur_id,
        role=payload.role,
        statut=payload.statut,
        mot_de_passe_hash=hash_password(payload.mot_de_passe or "demo2026"),
    )
    db.add(employe)
    db.flush()
    db.add(
        SoldeConge(
            employe_id=employe.id,
            annee=date.today().year,
            jours_acquis=payload.jours_acquis if payload.jours_acquis is not None else 21,
        )
    )
    _tracer(db, utilisateur, "creation_employe", employe.matricule, f"{employe.prenom} {employe.nom}")
    # Dossier, historique de carrière et parcours d'arrivée
    from app.models import DossierEmploye
    from app.routers.sirh import ajouter_evenement
    from app.services import sirh

    db.add(DossierEmploye(employe_id=employe.id))
    ajouter_evenement(db, employe, "embauche", None, employe.poste, utilisateur.id, employe.date_entree or date.today())
    sirh.creer_parcours(db, employe, "arrivee", employe.date_entree or date.today())
    db.commit()
    db.refresh(employe)
    return employe


@router.put("/employes/{employe_id}", response_model=EmployeDetail, summary="Modifier un employé")
def modifier_employe(
    employe_id: int,
    payload: EmployeMAJ,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(admin_requis),
):
    employe = db.get(Employe, employe_id)
    if not employe:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    donnees = payload.model_dump(exclude_unset=True)
    _garde_roles(utilisateur, employe, donnees.get("role"))
    from app.services import hierarchie

    if "validateur_id" in donnees:
        hierarchie.verifier_rattachement(db, employe.id, donnees["validateur_id"])
    if "departement_id" in donnees:
        hierarchie.verifier_departement(db, donnees["departement_id"])
    mot_de_passe = donnees.pop("mot_de_passe", None)
    avant = {"poste": employe.poste, "departement": employe.departement.nom if employe.departement else None}
    if mot_de_passe:
        if len(mot_de_passe) < 6:
            raise HTTPException(status_code=422, detail="Le mot de passe doit contenir au moins 6 caractères.")
        employe.mot_de_passe_hash = hash_password(mot_de_passe)
        employe.doit_changer_mdp = True
        employe.echecs_connexion = 0
        employe.bloque_jusqu = None
        _tracer(db, utilisateur, "reinitialisation_mot_de_passe", employe.matricule)
        notifier_mdp = True
    else:
        notifier_mdp = False
    if "niveau" in donnees:
        from app.services import hierarchie

        hierarchie.verifier_niveau(donnees["niveau"])
    for champ, valeur in donnees.items():
        setattr(employe, champ, valeur)
    if employe.validateur_id == employe.id:
        raise HTTPException(status_code=422, detail="Un employé ne peut pas être son propre validateur")
    # Historique de carrière : changement de poste, mutation de direction.
    from app.routers.sirh import ajouter_evenement

    db.flush()
    db.refresh(employe)
    if "poste" in donnees and donnees["poste"] and donnees["poste"] != avant["poste"]:
        ajouter_evenement(db, employe, "changement_poste", avant["poste"], employe.poste, utilisateur.id)
    apres_dept = employe.departement.nom if employe.departement else None
    if "departement_id" in donnees and apres_dept != avant["departement"]:
        ajouter_evenement(db, employe, "mutation", avant["departement"], apres_dept, utilisateur.id)
    # Changement d'organisation (département, profil, supérieur) : silencieux.
    # Le nouveau supérieur voit les fiches en attente grâce à ses compteurs.
    _tracer(db, utilisateur, "modification_employe", employe.matricule, ", ".join(donnees.keys()))
    if notifier_mdp:
        from app.services.notifications import notifier
        notifier(db, employe.id, "Mot de passe réinitialisé",
                 "L'administration RH a défini un nouveau mot de passe pour votre compte. "
                 "Changez-le depuis « Mon profil ».", "alerte", "/profil")
    db.commit()
    db.refresh(employe)
    return employe


class SortiePayload(BaseModel):
    motif: str
    date_sortie: date
    detail: str | None = Field(default=None, max_length=2000)
    reference: str | None = Field(default=None, max_length=80)


class RemplacementResponsablePayload(BaseModel):
    responsable_id: int
    remplacant_id: int


@router.post("/remplacer-responsable", summary="Prévisualiser ou appliquer le remplacement d'un responsable")
def remplacer_responsable(
    payload: RemplacementResponsablePayload,
    simulation: bool = True,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(administrateur_requis),
):
    from app.services import remplacements, sirh

    rapport = remplacements.preparer(db, payload.responsable_id, payload.remplacant_id)
    if simulation:
        return {**rapport, "simulation": True, "sauvegarde": None}
    sauvegarde = sirh.sauvegarder(force=True) if rapport["total_changements"] else None
    try:
        resultat = remplacements.appliquer(db, payload.responsable_id, payload.remplacant_id, utilisateur)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {**resultat, "simulation": False, "sauvegarde": sauvegarde}


@router.post("/employes/{employe_id}/sortie", summary="Supprimer un profil : sortie des effectifs (retraite, démission…)")
def sortie(
    employe_id: int, payload: SortiePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)
):
    from app.services import sorties

    employe = db.get(Employe, employe_id)
    if not employe:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    if employe.id == utilisateur.id:
        raise HTTPException(status_code=422, detail="Vous ne pouvez pas supprimer votre propre profil.")
    if payload.motif not in sorties.MOTIFS:
        raise HTTPException(status_code=422, detail="Motif de sortie inconnu.")
    if employe.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=409, detail="Ce profil est déjà sorti des effectifs.")
    if employe.role == Role.ADMIN_RH and not db.scalar(select(Employe.id).where(
            Employe.role == Role.ADMIN_RH, Employe.id != employe.id, Employe.statut != StatutEmploye.SORTI)):
        raise HTTPException(status_code=422, detail="Impossible : c'est le dernier administrateur RH.")
    employe.motif_sortie = payload.motif
    employe.date_sortie = payload.date_sortie
    employe.detail_sortie = (payload.detail or "").strip() or None
    employe.reference_sortie = (payload.reference or "").strip() or None
    employe.sortie_saisie_le = datetime.utcnow()
    libelle = sorties.MOTIFS[payload.motif]
    from app.routers.sirh import ajouter_evenement
    from app.services import sirh

    ajouter_evenement(db, employe, "sortie", employe.poste, libelle, utilisateur.id, payload.date_sortie,
                      employe.reference_sortie, employe.detail_sortie)
    sirh.creer_parcours(db, employe, "depart", payload.date_sortie)
    if payload.date_sortie <= date.today():
        bilan = sorties.desactiver(db, employe, utilisateur.id)
        programmee = False
    else:
        bilan, programmee = {}, True
    _tracer(db, utilisateur, "sortie_effectifs_programmee" if programmee else "sortie_effectifs", employe.matricule,
            f"{libelle} au {payload.date_sortie:%d/%m/%Y}" + (f" — réf. {employe.reference_sortie}" if employe.reference_sortie else ""))
    db.commit()
    return {"statut": "programmee" if programmee else "sorti", "motif": libelle,
            "date_sortie": payload.date_sortie, **bilan}


@router.post("/employes/{employe_id}/reintegrer", summary="Réintégrer un profil sorti ou annuler une sortie programmée")
def reintegrer(employe_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    employe = db.get(Employe, employe_id)
    if not employe:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    employe.statut = StatutEmploye.ACTIF
    ancien = employe.motif_sortie
    employe.motif_sortie = employe.date_sortie = employe.detail_sortie = employe.reference_sortie = None
    employe.sortie_saisie_le = None
    _tracer(db, utilisateur, "reintegration", employe.matricule, f"motif précédent : {ancien or '—'}")
    db.commit()
    return {"statut": "actif"}


@router.get("/sorties", summary="Profils sortis et sorties programmées")
def liste_sorties(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    from app.services import sorties

    lignes = db.scalars(select(Employe).where(
        (Employe.statut == StatutEmploye.SORTI) | Employe.date_sortie.is_not(None)).order_by(Employe.date_sortie.desc())).all()
    return [{
        "id": e.id, "matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste,
        "departement": e.departement.code if e.departement else None,
        "statut": "sorti" if e.statut == StatutEmploye.SORTI else "programmee",
        "motif": e.motif_sortie, "motif_libelle": sorties.MOTIFS.get(e.motif_sortie, "Sortie (annuaire)"),
        "date_sortie": e.date_sortie, "detail": e.detail_sortie, "reference": e.reference_sortie,
    } for e in lignes]

@router.get("/employes/{employe_id}/soldes", response_model=list[SoldeDetail], summary="Soldes d'un employé")
def soldes_employe(
    employe_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_requis)
):
    from app.services.hierarchie import peut_consulter
    employe = db.get(Employe, employe_id)
    if employe is None:
        raise HTTPException(status_code=404, detail="Employé introuvable")
    if not peut_consulter(db, utilisateur, employe):
        raise HTTPException(status_code=403, detail="Ce collaborateur est hors de votre périmètre.")
    return list(
        db.scalars(
            select(SoldeConge).where(SoldeConge.employe_id == employe_id).order_by(SoldeConge.annee.desc())
        )
    )


@router.put("/employes/{employe_id}/soldes", response_model=SoldeDetail, summary="Ajuster un solde")
def ajuster_solde(
    employe_id: int,
    payload: SoldePayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(admin_requis),
):
    solde = solde_courant(db, employe_id, payload.annee)
    solde.jours_acquis = payload.jours_acquis
    solde.report_anterieur = payload.report_anterieur
    if payload.jours_pris is not None:
        solde.jours_pris = payload.jours_pris
    _tracer(db, utilisateur, "ajustement_solde", str(employe_id), f"{payload.annee} : {payload.jours_acquis} j")
    db.commit()
    db.refresh(solde)
    return solde


@router.get("/annuaire", summary="Annuaire accessible à tous les collaborateurs")
def annuaire(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    """Vue allégée de l'effectif : pas de solde ni de rôle, donc consultable
    par tout collaborateur connecté."""
    employes = db.scalars(
        select(Employe).where(Employe.statut != StatutEmploye.SORTI).order_by(Employe.nom, Employe.prenom)
    ).all()
    return [
        {
            "id": e.id,
            "matricule": e.matricule,
            "nom": e.nom,
            "prenom": e.prenom,
            "poste": e.poste,
            "email": e.email,
            "telephone": e.telephone,
            "date_entree": e.date_entree.isoformat() if e.date_entree else None,
            "role": e.role.value,
            "niveau": e.niveau or "collaborateur",
            "departement": e.departement.code if e.departement else None,
            "validateur": e.validateur.matricule if e.validateur else None,
        }
        for e in employes
    ]


@router.get("/soldes", summary="Soldes de congés de tout l'effectif")
def soldes_effectif(
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(valideur_requis),
):
    """Évite une requête par collaborateur pour alimenter les tableaux RH."""
    annee = annee or date.today().year
    from app.services.hierarchie import perimetre_ids
    ids = perimetre_ids(db, utilisateur) | {utilisateur.id}
    lignes = db.execute(
        select(Employe.matricule, SoldeConge)
        .join(SoldeConge, SoldeConge.employe_id == Employe.id)
        .where(SoldeConge.annee == annee, Employe.id.in_(ids))
    ).all()
    return {
        matricule: {
            "annee": solde.annee,
            "jours_acquis": solde.jours_acquis,
            "jours_pris": solde.jours_pris,
            "report_anterieur": solde.report_anterieur,
            "jours_restants": solde.jours_restants,
        }
        for matricule, solde in lignes
    }


# --------------------------------------------------------------- Départements
def _verifier_structure(db: Session, payload: DepartementPayload, identifiant: int | None = None) -> None:
    from app.services.hierarchie import verifier_rattachement

    verifier_rattachement(db, identifiant, payload.parent_id, structure=True)
    if payload.responsable_id is not None:
        responsable = db.get(Employe, payload.responsable_id)
        if responsable is None or responsable.statut == StatutEmploye.SORTI:
            raise HTTPException(status_code=422, detail="Responsable introuvable ou sorti des effectifs.")


def _detail_departement(db: Session, departement: Departement) -> DepartementDetail:
    """Le schéma expose le responsable sous forme de libellé : construire le
    détail champ par champ, sinon Pydantic valide la relation ORM elle-même."""
    return DepartementDetail(
        id=departement.id,
        code=departement.code,
        nom=departement.nom,
        couleur=departement.couleur,
        parent_id=departement.parent_id,
        responsable_id=departement.responsable_id,
        effectif=db.scalar(
            select(func.count(Employe.id)).where(
                Employe.departement_id == departement.id, Employe.statut != StatutEmploye.SORTI
            )
        ) or 0,
        responsable=(
            f"{departement.responsable.prenom} {departement.responsable.nom}"
            if departement.responsable else None
        ),
    )


@router.get("/departements", response_model=list[DepartementDetail], summary="Départements")
def lister_departements(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return [
        _detail_departement(db, departement)
        for departement in db.scalars(select(Departement).order_by(Departement.nom))
    ]


@router.post("/departements", response_model=DepartementDetail, status_code=201, summary="Créer un département")
def creer_departement(
    payload: DepartementPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)
):
    if db.scalar(select(Departement).where(Departement.code == payload.code.upper())):
        raise HTTPException(status_code=409, detail="Ce code département existe déjà")
    _verifier_structure(db, payload)
    departement = Departement(
        code=payload.code.upper(),
        nom=payload.nom,
        couleur=payload.couleur,
        responsable_id=payload.responsable_id,
        parent_id=payload.parent_id,
    )
    db.add(departement)
    _tracer(db, utilisateur, "creation_departement", payload.code.upper(), payload.nom)
    db.commit()
    db.refresh(departement)
    return _detail_departement(db, departement)


@router.put("/departements/{departement_id}", response_model=DepartementDetail, summary="Modifier un département")
def modifier_departement(
    departement_id: int,
    payload: DepartementPayload,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(administrateur_requis),
):
    departement = db.get(Departement, departement_id)
    if not departement:
        raise HTTPException(status_code=404, detail="Département introuvable")
    _verifier_structure(db, payload, departement.id)
    doublon = db.scalar(select(Departement).where(Departement.code == payload.code.upper(), Departement.id != departement.id))
    if doublon:
        raise HTTPException(status_code=409, detail="Ce code département existe déjà")
    departement.code = payload.code.upper()
    departement.nom = payload.nom
    departement.couleur = payload.couleur
    departement.responsable_id = payload.responsable_id
    if "parent_id" in payload.model_fields_set:
        departement.parent_id = payload.parent_id
    _tracer(db, utilisateur, "modification_departement", departement.code)
    db.commit()
    db.refresh(departement)
    return _detail_departement(db, departement)


@router.delete("/departements/{departement_id}", status_code=204, summary="Supprimer un département")
def supprimer_departement(
    departement_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)
):
    departement = db.get(Departement, departement_id)
    if not departement:
        raise HTTPException(status_code=404, detail="Département introuvable")
    if db.scalar(select(Departement.id).where(Departement.parent_id == departement.id)):
        raise HTTPException(status_code=409, detail="Cette structure contient encore des sous-structures.")
    effectif = db.scalar(select(func.count(Employe.id)).where(Employe.departement_id == departement_id)) or 0
    if effectif:
        raise HTTPException(status_code=409, detail=f"{effectif} employé(s) sont encore rattachés")
    db.delete(departement)
    _tracer(db, utilisateur, "suppression_departement", departement.code)
    db.commit()


# -------------------------------------------------------------- Organigramme
@router.get("/organigramme", summary="Organigramme interactif")
def organigramme(
    departement_id: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    requete = select(Employe).where(Employe.statut != StatutEmploye.SORTI)
    if departement_id:
        requete = requete.where(Employe.departement_id == departement_id)
    employes = list(db.scalars(requete))

    noeuds = {
        e.id: {
            "id": e.id,
            "matricule": e.matricule,
            "nom": f"{e.prenom} {e.nom}",
            "poste": e.poste,
            "role": e.role.value,
            "niveau": e.niveau or "collaborateur",
            "departement": e.departement.nom if e.departement else None,
            "couleur": e.departement.couleur if e.departement else "#64748B",
            "photo": e.photo,
            "enfants": [],
        }
        for e in employes
    }
    racines = []
    for employe in employes:
        noeud = noeuds[employe.id]
        parent = noeuds.get(employe.validateur_id) if employe.validateur_id else None
        if parent:
            parent["enfants"].append(noeud)
        else:
            racines.append(noeud)
    return {"racines": racines, "effectif": len(employes)}


# --------------------------------------------------------------------- Audit
@router.get("/audit", response_model=list[AuditItem], summary="Journal d'audit")
def journal(limite: int = 100, db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    return list(db.scalars(select(JournalAudit).order_by(JournalAudit.horodatage.desc()).limit(limite)))


# ------------------------------------------------------ Import RH Excel en masse
@router.get("/import-rh/modele.xlsx", summary="Modèle Excel prérempli pour les affectations et dossiers RH")
def modele_import_rh(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    from app.services.import_rh import generer_modele

    tampon = generer_modele(db)
    return StreamingResponse(
        tampon,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="import-rh-affectations-dossiers.xlsx"'},
    )


@router.post("/import-rh", summary="Prévisualiser ou appliquer l'import Excel RH")
async def importer_rh(
    fichier: UploadFile = File(...),
    simulation: bool = True,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(admin_requis),
):
    from app.services import import_rh, sirh

    if not (fichier.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="L'import RH attend le modèle Excel .xlsx.")
    contenu = await fichier.read(import_rh.TAILLE_MAX + 1)
    analyse = import_rh.analyser(db, contenu)
    rapport = analyse.rapport()
    if simulation:
        return rapport
    if analyse.erreurs:
        raise HTTPException(status_code=422, detail="Import refusé : " + " ".join(analyse.erreurs[:5]))
    sauvegarde = sirh.sauvegarder(force=True) if rapport["collaborateurs_modifies"] else None
    try:
        resultat = import_rh.appliquer(db, analyse, utilisateur)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {**resultat, "sauvegarde": sauvegarde}


# ------------------------------------------------------------- Import CSV
@router.post("/import-pointages", summary="Import en masse de pointages (CSV)")
def importer_pointages(
    fichier: UploadFile = File(...),
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(admin_requis),
):
    """Colonnes attendues : matricule;date;entree1;sortie1;entree2;sortie2;code

    Le séparateur (`;` ou `,`) est détecté automatiquement, les heures vides
    sont acceptées (elles produisent alors une anomalie).
    """
    contenu = fichier.file.read().decode("utf-8-sig", errors="replace")
    separateur = ";" if contenu.count(";") >= contenu.count(",") else ","
    lecteur = csv.DictReader(io.StringIO(contenu), delimiter=separateur)

    def _heure(valeur: str | None) -> time | None:
        valeur = (valeur or "").strip()
        if not valeur:
            return None
        for format_heure in ("%H:%M", "%H:%M:%S", "%Hh%M"):
            try:
                return datetime.strptime(valeur, format_heure).time()
            except ValueError:
                continue
        return None

    importes, ignores, erreurs = 0, 0, []
    if lecteur.fieldnames and "horodatage" in [c.strip().lower() for c in lecteur.fieldnames]:
        return _importer_journal_brut(db, utilisateur, lecteur, fichier.filename)
    for index, ligne in enumerate(lecteur, start=2):
        matricule = (ligne.get("matricule") or "").strip().upper()
        employe = db.scalar(select(Employe).where(Employe.matricule == matricule))
        if not employe:
            ignores += 1
            erreurs.append(f"Ligne {index} : matricule « {matricule} » inconnu")
            continue
        try:
            jour = datetime.strptime((ligne.get("date") or "").strip(), "%Y-%m-%d").date()
        except ValueError:
            try:
                jour = datetime.strptime((ligne.get("date") or "").strip(), "%d/%m/%Y").date()
            except ValueError:
                ignores += 1
                erreurs.append(f"Ligne {index} : date illisible")
                continue

        pointage = db.scalar(
            select(Pointage).where(Pointage.employe_id == employe.id, Pointage.date_jour == jour)
        )
        if not pointage:
            pointage = Pointage(
                employe_id=employe.id,
                date_jour=jour,
                heures_prevues=8.0 if est_ouvre(jour) else 0.0,
            )
            db.add(pointage)
            db.flush()

        pointage.entree1 = _heure(ligne.get("entree1"))
        pointage.sortie1 = _heure(ligne.get("sortie1"))
        pointage.entree2 = _heure(ligne.get("entree2"))
        pointage.sortie2 = _heure(ligne.get("sortie2"))
        code = (ligne.get("code") or "present").strip().lower()
        pointage.code_presence = CodePresence(code) if code in CodePresence._value2member_map_ else CodePresence.PRESENT
        synchroniser_anomalies(db, pointage)
        importes += 1

    _tracer(db, utilisateur, "import_pointages", fichier.filename, f"{importes} lignes importées")
    db.commit()
    return {"importes": importes, "ignores": ignores, "erreurs": erreurs[:20]}


def _importer_journal_brut(db: Session, utilisateur: Employe, lecteur, nom_fichier: str | None) -> dict:
    """Journal brut de pointeuse : une ligne par passage (matricule ; horodatage)."""
    from app.services import pointage as moteur

    importes = ignores = 0
    erreurs: list[str] = []
    journees: set[tuple[int, date]] = set()
    for index, ligne in enumerate(lecteur, start=2):
        ligne = {(k or "").strip().lower(): (v or "").strip() for k, v in ligne.items()}
        employe = db.scalar(select(Employe).where(Employe.matricule == ligne.get("matricule", "").upper()))
        horodatage = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
            try:
                horodatage = datetime.strptime(ligne.get("horodatage", ""), fmt)
                break
            except ValueError:
                continue
        if not employe or not horodatage:
            ignores += 1
            erreurs.append(f"Ligne {index} : {'matricule inconnu' if not employe else 'horodatage illisible'}")
            continue
        if moteur.enregistrer_passage(db, employe.id, horodatage, "import", ligne.get("terminal") or None):
            importes += 1
        journees.add((employe.id, horodatage.date()))
    for employe_id, jour in journees:
        moteur.recalculer(db, employe_id, jour)
    _tracer(db, utilisateur, "import_pointages", nom_fichier, f"{importes} passages importés")
    db.commit()
    return {"importes": importes, "ignores": ignores, "erreurs": erreurs[:20]}


# ------------------------------------------------------------------ Synthèse
@router.get("/synthese", summary="Indicateurs consolidés par département")
def synthese(db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    aujourdhui = date.today()
    debut_annee = date(aujourdhui.year, 1, 1)
    lignes = []
    for departement in db.scalars(select(Departement).order_by(Departement.nom)):
        ids = list(
            db.scalars(
                select(Employe.id).where(
                    Employe.departement_id == departement.id, Employe.statut != StatutEmploye.SORTI
                )
            )
        )
        if not ids:
            continue
        pointages = db.scalars(
            select(Pointage).where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut_annee)
        ).all()
        total = len(pointages) or 1
        absences = sum(1 for p in pointages if p.code_presence == CodePresence.ABSENT)
        conges = sum(1 for p in pointages if p.code_presence == CodePresence.CONGE)
        retards = [p.retard_minutes for p in pointages if p.retard_minutes > 0]
        lignes.append(
            {
                "departement": departement.nom,
                "couleur": departement.couleur,
                "effectif": len(ids),
                "taux_absenteisme": round((absences + conges) / total * 100, 1),
                "retard_moyen": round(sum(retards) / len(retards), 1) if retards else 0,
                "anomalies_ouvertes": db.scalar(
                    select(func.count(Anomalie.id)).where(Anomalie.employe_id.in_(ids))
                ) or 0,
                "demandes_en_attente": db.scalar(
                    select(func.count(Demande.id)).where(
                        Demande.employe_id.in_(ids), Demande.statut == StatutDemande.EN_ATTENTE
                    )
                ) or 0,
                "heures_travaillees": round(sum(p.heures_travaillees for p in pointages), 1),
            }
        )
    return {"lignes": lignes, "annee": aujourdhui.year}
