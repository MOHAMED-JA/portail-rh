"""Fiches d'objectifs et fiches d'évaluation annuelles.

Circuit d'une année :

1. Le collaborateur rédige sa fiche d'objectifs, chaque objectif pondéré en
   pourcentage (total : 100 %), puis la soumet à son supérieur hiérarchique.
2. Le supérieur la valide, la modifie avant de la valider, ou la renvoie au
   collaborateur pour correction. L'administration RH la consulte sans
   pouvoir la modifier.
3. Une fois les objectifs validés, le supérieur note chaque objectif sur 20 et
   approuve la fiche d'évaluation ; l'administration RH saisit uniquement la
   note de comportement et valide à son tour.
4. Quand les deux validations sont acquises, la note finale est calculée et le
   collaborateur est notifié avec le détail.

Note des objectifs = Σ(note × pondération) / Σ pondérations — une moyenne
pondérée, donc jamais supérieure à 20. Note finale = PART_OBJECTIFS % de la
note des objectifs + PART_COMPORTEMENT % de la note de comportement, bornée
à 20.
"""
from __future__ import annotations

import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import PART_COMPORTEMENT, PART_OBJECTIFS
from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import (
    Employe,
    FicheEvaluation,
    FicheObjectifs,
    JournalAudit,
    Objectif,
    Role,
    StatutEmploye,
    StatutFicheObjectifs,
)
from app.models import ROLES_RH  # noqa: E402
from app.services import hierarchie
from app.services.hierarchie import sans_fiche_objectifs
from app.services.notifications import notifier

router = APIRouter(prefix="/api/fiches", tags=["Fiches d'objectifs et d'évaluation"])

NOTE_MAX = 20.0
TOLERANCE = 0.01


# ------------------------------------------------------------------ Contrats
class ObjectifSaisie(BaseModel):
    titre: str = Field(min_length=2, max_length=200)
    description: str | None = None
    indicateur: str | None = None
    ponderation: float = Field(gt=0, le=100)


class ObjectifsPayload(BaseModel):
    objectifs: list[ObjectifSaisie]


class CommentairePayload(BaseModel):
    commentaire: str | None = None


class NoteObjectif(BaseModel):
    objectif_id: int
    note: float | None = Field(default=None, ge=0, le=NOTE_MAX)
    commentaire: str | None = None


class NotesPayload(BaseModel):
    notes: list[NoteObjectif]
    appreciation: str | None = None


class ComportementPayload(BaseModel):
    note: float = Field(ge=0, le=NOTE_MAX)
    commentaire: str | None = None


# ------------------------------------------------------------------ Calculs
def fr(valeur: float) -> str:
    """14.8 → « 14,8 » : notation française dans les notifications."""
    return f"{valeur:g}".replace(".", ",")


def arrondir(valeur: float | None) -> float | None:
    return None if valeur is None else round(valeur, 2)


def note_objectifs(objectifs: list[Objectif]) -> float | None:
    """Moyenne des notes pondérée par les objectifs, sur 20."""
    if not objectifs or any(o.note is None for o in objectifs):
        return None
    total_poids = sum(o.ponderation for o in objectifs)
    if total_poids <= 0:
        return None
    return min(NOTE_MAX, sum(o.note * o.ponderation for o in objectifs) / total_poids)


def note_finale(note_obj: float | None, note_comp: float | None) -> float | None:
    if note_obj is None or note_comp is None:
        return None
    return min(NOTE_MAX, (note_obj * PART_OBJECTIFS + note_comp * PART_COMPORTEMENT) / 100)


def verifier_ponderations(objectifs: list) -> None:
    if not objectifs:
        raise HTTPException(status_code=422, detail="Ajoutez au moins un objectif.")
    total = sum(o.ponderation for o in objectifs)
    if abs(total - 100) > TOLERANCE:
        raise HTTPException(
            status_code=422,
            detail=f"La somme des pondérations doit être égale à 100 % (actuellement {total:g} %).",
        )


# ------------------------------------------------------------------ Accès
def superieur_de(db: Session, employe: Employe) -> list[Employe]:
    """Supérieur hiérarchique : le validateur N+1. À défaut, l'administration
    RH en tient lieu."""
    if hierarchie.superieur_operationnel(employe):
        return [employe.validateur]
    # Sans supérieur opérationnel (rattachement à la seule Direction générale,
    # qui consulte sans valider) : l'administration RH en tient lieu.
    return list(db.scalars(
        select(Employe).where(
            Employe.role.in_(ROLES_RH), Employe.id != employe.id, Employe.statut != StatutEmploye.SORTI
        )
    ))


def est_superieur(db: Session, utilisateur: Employe, employe: Employe) -> bool:
    """Supérieur qui agit sur la fiche : le N+1 opérationnel, ou l'administration
    RH à défaut. La Direction générale consulte seulement."""
    if utilisateur.id == employe.id or hierarchie.est_direction_generale(utilisateur):
        return False
    if hierarchie.superieur_operationnel(employe):
        return employe.validateur_id == utilisateur.id
    return utilisateur.role in ROLES_RH


def est_rh(utilisateur: Employe, employe: Employe) -> bool:
    return utilisateur.role in ROLES_RH and utilisateur.id != employe.id


def charger_employe(db: Session, matricule: str) -> Employe:
    employe = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not employe:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    if sans_fiche_objectifs(employe):
        raise HTTPException(status_code=409, detail=(
            "Le Directeur général n'a pas de fiche d'objectifs : il n'a pas de supérieur hiérarchique."))
    return employe


def fiche_verrouillee(db: Session, employe: Employe, annee: int | None = None) -> bool:
    """Évaluation validée par le supérieur et par la RH : le détail n'est plus
    consultable que par l'administration RH (et par l'intéressé)."""
    ev = db.scalar(select(FicheEvaluation).where(
        FicheEvaluation.employe_id == employe.id, FicheEvaluation.annee == annee_courante(annee)))
    return bool(ev and ev.finalisee_le)


def verifier_acces(db: Session, utilisateur: Employe, employe: Employe, annee: int | None = None) -> None:
    from app.services import hierarchie

    # RH et Direction générale (DG, DGA) consultent toutes les fiches, y
    # compris finalisées ; la Direction générale n'y a aucun droit d'action.
    if utilisateur.id == employe.id or utilisateur.role in ROLES_RH or hierarchie.est_direction_generale(utilisateur):
        return
    from app.services import hierarchie

    # Supérieur direct (qui agit sur la fiche), supérieurs indirects et
    # Direction générale (lecture seule) : même règle de confidentialité.
    if est_superieur(db, utilisateur, employe) or hierarchie.peut_consulter(db, utilisateur, employe):
        if fiche_verrouillee(db, employe, annee):
            raise HTTPException(status_code=403, detail=(
                "Fiche validée : son détail n'est consultable que par l'administration RH et la Direction générale."))
        return
    raise HTTPException(status_code=403, detail="Cette fiche n'est pas dans votre périmètre")


def fiche_objectifs(db: Session, employe: Employe, annee: int) -> FicheObjectifs:
    fiche = db.scalar(select(FicheObjectifs).where(
        FicheObjectifs.employe_id == employe.id, FicheObjectifs.annee == annee
    ))
    if not fiche:
        fiche = FicheObjectifs(employe_id=employe.id, annee=annee)
        db.add(fiche)
        db.flush()
    return fiche


def fiche_evaluation(db: Session, employe: Employe, annee: int) -> FicheEvaluation:
    fiche = db.scalar(select(FicheEvaluation).where(
        FicheEvaluation.employe_id == employe.id, FicheEvaluation.annee == annee
    ))
    if not fiche:
        fiche = FicheEvaluation(employe_id=employe.id, annee=annee)
        db.add(fiche)
        db.flush()
    return fiche


# ------------------------------------------------------------------ Sérialisation
def mini(e: Employe | None) -> dict | None:
    if e is None:
        return None
    return {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste}


def statut_evaluation(obj: FicheObjectifs, ev: FicheEvaluation) -> str:
    if obj.statut != StatutFicheObjectifs.VALIDEE:
        return "non_ouverte"
    if ev.finalisee_le:
        return "finalisee"
    if ev.valide_superieur_le and ev.valide_rh_le is None:
        return "attente_rh"
    if ev.valide_rh_le and ev.valide_superieur_le is None:
        return "attente_superieur"
    if any(o.note is not None for o in obj.objectifs) or ev.note_comportement is not None:
        return "en_cours"
    return "a_evaluer"


def droits(db: Session, utilisateur: Employe, employe: Employe, obj: FicheObjectifs, ev: FicheEvaluation) -> dict:
    proprietaire = utilisateur.id == employe.id
    superieur = est_superieur(db, utilisateur, employe)
    rh = est_rh(utilisateur, employe)
    ouverte = obj.statut == StatutFicheObjectifs.VALIDEE
    evaluation_entamee = ev.valide_superieur_le is not None or any(o.note is not None for o in obj.objectifs)
    return {
        "proprietaire": proprietaire,
        "superieur": superieur,
        "rh": rh,
        "modifier_objectifs": (
            (proprietaire and obj.statut in (StatutFicheObjectifs.BROUILLON, StatutFicheObjectifs.A_CORRIGER))
            or (superieur and (obj.statut == StatutFicheObjectifs.SOUMISE
                               or (obj.statut == StatutFicheObjectifs.VALIDEE and not evaluation_entamee)))
        ),
        "soumettre": proprietaire and obj.statut in (StatutFicheObjectifs.BROUILLON, StatutFicheObjectifs.A_CORRIGER),
        "valider_objectifs": superieur and obj.statut == StatutFicheObjectifs.SOUMISE,
        "renvoyer_objectifs": superieur and obj.statut == StatutFicheObjectifs.SOUMISE,
        "noter": superieur and ouverte and ev.valide_superieur_le is None,
        "approuver_evaluation": superieur and ouverte and ev.valide_superieur_le is None,
        "noter_comportement": rh and ouverte and ev.valide_rh_le is None,
        "valider_rh": rh and ouverte and ev.valide_rh_le is None,
        # Le collaborateur ne découvre ses notes qu'une fois l'évaluation
        # validée par son supérieur et par la RH.
        "voir_notes": (not proprietaire) or ev.finalisee_le is not None,
    }


def serialiser(db: Session, utilisateur: Employe, employe: Employe, annee: int) -> dict:
    obj = fiche_objectifs(db, employe, annee)
    ev = fiche_evaluation(db, employe, annee)
    d = droits(db, utilisateur, employe, obj, ev)
    voir = d["voir_notes"]
    superieurs = superieur_de(db, employe)
    return {
        "annee": annee,
        "employe": {**mini(employe), "departement": employe.departement.code if employe.departement else None},
        "superieur": mini(superieurs[0]) if len(superieurs) == 1 else None,
        "ponderation_finale": {"objectifs": PART_OBJECTIFS, "comportement": PART_COMPORTEMENT},
        "objectifs": {
            "statut": obj.statut.value,
            "commentaire_superieur": obj.commentaire_superieur,
            "soumise_le": obj.soumise_le,
            "validee_le": obj.validee_le,
            "validee_par": mini(obj.validee_par),
            "modifiee_par_superieur": obj.modifiee_par_superieur,
            "total_ponderation": round(sum(o.ponderation for o in obj.objectifs), 2),
            "liste": [
                {
                    "id": o.id, "titre": o.titre, "description": o.description, "indicateur": o.indicateur,
                    "ponderation": o.ponderation,
                    "note": o.note if voir else None,
                    "commentaire": o.commentaire_note if voir else None,
                }
                for o in obj.objectifs
            ],
        },
        "evaluation": {
            "statut": statut_evaluation(obj, ev),
            "appreciation": ev.appreciation_superieur if voir else None,
            "note_objectifs": arrondir(note_objectifs(obj.objectifs)) if voir else None,
            "note_comportement": ev.note_comportement if voir else None,
            "commentaire_comportement": ev.commentaire_comportement if voir else None,
            "valide_superieur_le": ev.valide_superieur_le,
            "superieur": mini(ev.superieur),
            "valide_rh_le": ev.valide_rh_le,
            "rh": mini(ev.rh),
            "note_finale": ev.note_finale if voir else None,
            "finalisee_le": ev.finalisee_le,
            "formations_souhaitees": json.loads(ev.formations_souhaitees or "[]"),
            "plan_developpement": ev.plan_developpement,
            "mobilite_type": ev.mobilite_type,
            "mobilite_detail": ev.mobilite_detail,
            "pris_connaissance_le": ev.pris_connaissance_le,
            "commentaire_collaborateur": ev.commentaire_collaborateur,
        },
        "droits": d,
    }


def tracer(db: Session, acteur: Employe, action: str, employe: Employe, detail: str | None = None) -> None:
    db.add(JournalAudit(acteur_id=acteur.id, action=action, cible=employe.matricule, detail=detail))


def annee_courante(annee: int | None) -> int:
    return annee or date.today().year


# ------------------------------------------------------------------ Consultation
@router.get("", summary="Fiches visibles : les siennes, celles de l'équipe, toutes pour la RH")
def lister(
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    requete = select(Employe).where(Employe.statut != StatutEmploye.SORTI, Employe.id != utilisateur.id)
    if utilisateur.role not in ROLES_RH:
        from app.services import hierarchie

        requete = requete.where(Employe.id.in_(hierarchie.perimetre_ids(db, utilisateur) or {-1}))
    resultats = []
    for employe in db.scalars(requete.order_by(Employe.nom, Employe.prenom)):
        if sans_fiche_objectifs(employe):
            continue
        obj = db.scalar(select(FicheObjectifs).where(
            FicheObjectifs.employe_id == employe.id, FicheObjectifs.annee == annee))
        ev = db.scalar(select(FicheEvaluation).where(
            FicheEvaluation.employe_id == employe.id, FicheEvaluation.annee == annee))
        statut_obj = obj.statut.value if obj else "brouillon"
        rh = utilisateur.role in ROLES_RH or hierarchie.est_direction_generale(utilisateur)
        resultats.append({
            "employe": {**mini(employe), "departement": employe.departement.code if employe.departement else None},
            "superieur_direct": est_superieur(db, utilisateur, employe),
            "statut_objectifs": statut_obj,
            "nombre_objectifs": len(obj.objectifs) if obj else 0,
            "statut_evaluation": statut_evaluation(obj, ev) if obj and ev else (
                "a_evaluer" if statut_obj == "validee" else "non_ouverte"),
            "note_finale": ev.note_finale if ev and rh else None,
            "verrouillee": bool(ev and ev.finalisee_le) and not rh,
        })
    return resultats


# ------------------------------------------------------------------ Suivi RH
def _suivi(db: Session, annee: int) -> list[dict]:
    """Par responsable : fiches en attente de sa décision et fiches traitées."""
    employes = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI)))
    admins = [e for e in employes if e.role in ROLES_RH]
    fiches_obj = {f.employe_id: f for f in db.scalars(select(FicheObjectifs).where(FicheObjectifs.annee == annee))}
    fiches_ev = {f.employe_id: f for f in db.scalars(select(FicheEvaluation).where(FicheEvaluation.annee == annee))}
    par_responsable: dict[int, dict] = {}
    for e in employes:
        if sans_fiche_objectifs(e):
            continue
        responsable = e.validateur if e.validateur_id else (admins[0] if admins and admins[0].id != e.id else None)
        if responsable is None:
            continue
        ligne = par_responsable.setdefault(responsable.id, {
            "responsable": {**mini(responsable), "departement": responsable.departement.code if responsable.departement else None,
                            "role": responsable.role.value},
            "equipe": 0, "brouillons": 0, "objectifs_a_valider": 0, "objectifs_valides": 0,
            "evaluations_a_approuver": 0, "evaluations_approuvees": 0, "evaluations_finalisees": 0,
            "collaborateurs": [],
        })
        obj, ev = fiches_obj.get(e.id), fiches_ev.get(e.id)
        statut_obj = obj.statut.value if obj else "brouillon"
        statut_ev = statut_evaluation(obj, ev) if obj and ev else ("a_evaluer" if statut_obj == "validee" else "non_ouverte")
        ligne["equipe"] += 1
        ligne["brouillons"] += statut_obj in ("brouillon", "a_corriger")
        ligne["objectifs_a_valider"] += statut_obj == "soumise"
        ligne["objectifs_valides"] += statut_obj == "validee"
        attend_superieur = statut_obj == "validee" and not (ev and ev.valide_superieur_le)
        ligne["evaluations_a_approuver"] += attend_superieur
        ligne["evaluations_approuvees"] += bool(ev and ev.valide_superieur_le)
        ligne["evaluations_finalisees"] += bool(ev and ev.finalisee_le)
        ligne["collaborateurs"].append({
            "employe": {**mini(e), "departement": e.departement.code if e.departement else None},
            "statut_objectifs": statut_obj, "statut_evaluation": statut_ev,
            "note_finale": ev.note_finale if ev else None,
        })
    lignes = list(par_responsable.values())
    for l in lignes:
        l["en_retard"] = l["objectifs_a_valider"] + l["evaluations_a_approuver"]
        l["a_jour"] = l["en_retard"] == 0
    return sorted(lignes, key=lambda l: (-l["en_retard"], l["responsable"]["nom"]))


@router.get("/suivi/responsables", summary="Suivi des validations par responsable (administration RH)")
def suivi(annee: int | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    return _suivi(db, annee_courante(annee))


class RelancePayload(BaseModel):
    responsables: list[str] | None = None   # matricules ; vide = tous les responsables en retard


@router.post("/suivi/relances", summary="Relancer les responsables qui ont des fiches non validées")
def relancer(payload: RelancePayload, annee: int | None = None, db: Session = Depends(get_db),
             utilisateur: Employe = Depends(admin_requis)):
    annee = annee_courante(annee)
    cibles = set(payload.responsables or [])
    relances = []
    for ligne in _suivi(db, annee):
        r = ligne["responsable"]
        if ligne["a_jour"] or (cibles and r["matricule"] not in cibles):
            continue
        responsable = charger_employe(db, r["matricule"])
        if responsable.id == utilisateur.id:
            continue
        morceaux = []
        if ligne["objectifs_a_valider"]:
            morceaux.append(f"{ligne['objectifs_a_valider']} fiche(s) d'objectifs à valider")
        if ligne["evaluations_a_approuver"]:
            morceaux.append(f"{ligne['evaluations_a_approuver']} fiche(s) d'évaluation à compléter")
        notifier(db, responsable.id, "Rappel de l'administration RH",
                 f"Vous avez {' et '.join(morceaux)} pour l'exercice {annee}. Merci de les traiter.",
                 "alerte", "/fiche-objectifs" if ligne["objectifs_a_valider"] else "/fiche-evaluation")
        relances.append(r["matricule"])
    tracer_relance = JournalAudit(acteur_id=utilisateur.id, action="relance_fiches", cible=f"{len(relances)} responsable(s)",
                                  detail=", ".join(relances) or None)
    db.add(tracer_relance)
    db.commit()
    return {"relances": relances}


@router.get("/{matricule}", summary="Fiche d'objectifs et d'évaluation d'un collaborateur")
def consulter(
    matricule: str,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    employe = charger_employe(db, matricule)
    verifier_acces(db, utilisateur, employe)
    resultat = serialiser(db, utilisateur, employe, annee_courante(annee))
    db.commit()  # fiches créées à la première consultation
    return resultat


# ------------------------------------------------------------------ Objectifs
@router.put("/{matricule}/objectifs", summary="Enregistrer les objectifs et leurs pondérations")
def enregistrer_objectifs(
    matricule: str,
    payload: ObjectifsPayload,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    verifier_acces(db, utilisateur, employe)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    d = droits(db, utilisateur, employe, obj, ev)
    if not d["modifier_objectifs"]:
        if d["rh"] and not d["superieur"]:
            raise HTTPException(status_code=403, detail="L'administration RH consulte la fiche d'objectifs sans pouvoir la modifier.")
        raise HTTPException(status_code=403, detail="La fiche d'objectifs n'est pas modifiable à ce stade.")
    total = sum(o.ponderation for o in payload.objectifs)
    if total > 100 + TOLERANCE:
        raise HTTPException(status_code=422, detail=f"La somme des pondérations dépasse 100 % ({total:g} %).")
    if d["superieur"]:
        # Une fiche modifiée par le supérieur reste validable par lui seul.
        verifier_ponderations(payload.objectifs)
        obj.modifiee_par_superieur = True

    obj.objectifs.clear()
    db.flush()
    for ordre, saisie in enumerate(payload.objectifs):
        obj.objectifs.append(Objectif(
            ordre=ordre, titre=saisie.titre.strip(), description=(saisie.description or "").strip() or None,
            indicateur=(saisie.indicateur or "").strip() or None, ponderation=round(saisie.ponderation, 2),
        ))
    tracer(db, utilisateur, "fiche_objectifs_modifiee", employe, f"{len(payload.objectifs)} objectif(s) — {annee}")
    if d["superieur"] and obj.statut == StatutFicheObjectifs.VALIDEE:
        notifier(db, employe.id, "Objectifs modifiés par votre supérieur",
                 f"{utilisateur.prenom} {utilisateur.nom} a ajusté votre fiche d'objectifs {annee}.",
                 "info", "/fiche-objectifs")
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/objectifs/soumettre", summary="Soumettre la fiche d'objectifs au supérieur")
def soumettre(
    matricule: str,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["soumettre"]:
        raise HTTPException(status_code=403, detail="Seul le collaborateur peut soumettre sa fiche, avant validation.")
    verifier_ponderations(obj.objectifs)
    obj.statut = StatutFicheObjectifs.SOUMISE
    obj.soumise_le = datetime.utcnow()
    for superieur in superieur_de(db, employe):
        notifier(db, superieur.id, "Fiche d'objectifs à valider",
                 f"{employe.prenom} {employe.nom} a soumis sa fiche d'objectifs {annee} "
                 f"({len(obj.objectifs)} objectif(s)).", "validation", "/fiche-objectifs")
    dga = hierarchie.dga_de(employe)
    if dga and dga.id != employe.id:
        notifier(db, dga.id, "Fiche d'objectifs soumise (consultation)",
                 f"{employe.prenom} {employe.nom} a soumis sa fiche d'objectifs {annee}.", "info", "/fiche-objectifs")
    tracer(db, utilisateur, "fiche_objectifs_soumise", employe, str(annee))
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/objectifs/valider", summary="Valider la fiche d'objectifs (supérieur)")
def valider_objectifs(
    matricule: str,
    payload: CommentairePayload,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["valider_objectifs"]:
        raise HTTPException(status_code=403, detail="Seul le supérieur hiérarchique valide une fiche soumise.")
    verifier_ponderations(obj.objectifs)
    obj.statut = StatutFicheObjectifs.VALIDEE
    obj.validee_le = datetime.utcnow()
    obj.validee_par_id = utilisateur.id
    obj.commentaire_superieur = (payload.commentaire or "").strip() or obj.commentaire_superieur
    detail = " (avec modifications)" if obj.modifiee_par_superieur else ""
    notifier(db, employe.id, "Fiche d'objectifs validée",
             f"{utilisateur.prenom} {utilisateur.nom} a validé votre fiche d'objectifs {annee}{detail}.",
             "succes", "/fiche-objectifs")
    tracer(db, utilisateur, "fiche_objectifs_validee", employe, str(annee))
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/objectifs/renvoyer", summary="Renvoyer la fiche au collaborateur pour correction")
def renvoyer_objectifs(
    matricule: str,
    payload: CommentairePayload,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["renvoyer_objectifs"]:
        raise HTTPException(status_code=403, detail="Seul le supérieur hiérarchique peut renvoyer une fiche soumise.")
    commentaire = (payload.commentaire or "").strip()
    if len(commentaire) < 5:
        raise HTTPException(status_code=422, detail="Indiquez au collaborateur ce qu'il doit corriger.")
    obj.statut = StatutFicheObjectifs.A_CORRIGER
    obj.commentaire_superieur = commentaire
    notifier(db, employe.id, "Fiche d'objectifs à corriger", commentaire, "alerte", "/fiche-objectifs")
    tracer(db, utilisateur, "fiche_objectifs_renvoyee", employe, str(annee))
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


# ------------------------------------------------------------------ Évaluation
def finaliser_si_complete(db: Session, employe: Employe, obj: FicheObjectifs, ev: FicheEvaluation) -> None:
    if not (ev.valide_superieur_le and ev.valide_rh_le) or ev.finalisee_le:
        return
    ev.note_objectifs = arrondir(note_objectifs(obj.objectifs))
    ev.note_finale = arrondir(note_finale(ev.note_objectifs, ev.note_comportement))
    ev.finalisee_le = datetime.utcnow()
    lignes = " · ".join(f"{o.titre} ({fr(o.ponderation)} %) : {fr(o.note)}/20" for o in obj.objectifs)
    notifier(
        db, employe.id, f"Fiche d'évaluation {ev.annee} validée",
        f"Votre évaluation a été validée par votre supérieur hiérarchique et par la RH. "
        f"Objectifs : {fr(ev.note_objectifs)}/20 — {lignes}. "
        f"Comportement : {fr(ev.note_comportement)}/20. "
        f"Note finale : {fr(ev.note_finale)}/20 ({PART_OBJECTIFS} % objectifs, {PART_COMPORTEMENT} % comportement).",
        "succes", "/fiche-evaluation",
    )


@router.put("/{matricule}/evaluation/notes", summary="Noter les objectifs (supérieur)")
def noter(
    matricule: str,
    payload: NotesPayload,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    d = droits(db, utilisateur, employe, obj, ev)
    if not d["noter"]:
        if d["rh"] and not d["superieur"]:
            raise HTTPException(status_code=403, detail="L'administration RH saisit uniquement la note de comportement.")
        raise HTTPException(status_code=403, detail="Seul le supérieur hiérarchique note les objectifs, après leur validation.")
    par_id = {o.id: o for o in obj.objectifs}
    for saisie in payload.notes:
        objectif = par_id.get(saisie.objectif_id)
        if objectif is None:
            raise HTTPException(status_code=422, detail="Objectif inconnu dans cette fiche.")
        objectif.note = None if saisie.note is None else round(min(NOTE_MAX, max(0.0, saisie.note)), 2)
        objectif.commentaire_note = (saisie.commentaire or "").strip() or None
    ev.appreciation_superieur = (payload.appreciation or "").strip() or None
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/evaluation/approuver", summary="Approuver la fiche d'évaluation (supérieur)")
def approuver(
    matricule: str,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["approuver_evaluation"]:
        raise HTTPException(status_code=403, detail="Seul le supérieur hiérarchique approuve l'évaluation des objectifs.")
    if any(o.note is None for o in obj.objectifs):
        raise HTTPException(status_code=422, detail="Chaque objectif doit recevoir une note avant approbation.")
    ev.valide_superieur_le = datetime.utcnow()
    ev.superieur_id = utilisateur.id
    ev.note_objectifs = arrondir(note_objectifs(obj.objectifs))
    if ev.valide_rh_le is None:
        rh = db.scalars(select(Employe).where(
            Employe.role.in_(ROLES_RH), Employe.id != employe.id, Employe.statut != StatutEmploye.SORTI))
        for admin in rh:
            notifier(db, admin.id, "Évaluation à compléter",
                     f"Les objectifs de {employe.prenom} {employe.nom} sont notés : saisissez la note de comportement.",
                     "validation", "/fiche-evaluation")
    tracer(db, utilisateur, "evaluation_approuvee_superieur", employe, f"{fr(ev.note_objectifs)}/20")
    finaliser_si_complete(db, employe, obj, ev)
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.put("/{matricule}/evaluation/comportement", summary="Saisir la note de comportement (administration RH)")
def noter_comportement(
    matricule: str,
    payload: ComportementPayload,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["noter_comportement"]:
        raise HTTPException(status_code=403, detail="La note de comportement est saisie par l'administration RH, après validation des objectifs.")
    ev.note_comportement = round(min(NOTE_MAX, max(0.0, payload.note)), 2)
    ev.commentaire_comportement = (payload.commentaire or "").strip() or None
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/evaluation/valider-rh", summary="Valider l'évaluation (administration RH)")
def valider_rh(
    matricule: str,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    obj, ev = fiche_objectifs(db, employe, annee), fiche_evaluation(db, employe, annee)
    if not droits(db, utilisateur, employe, obj, ev)["valider_rh"]:
        raise HTTPException(status_code=403, detail="Seule l'administration RH valide cette étape.")
    if ev.note_comportement is None:
        raise HTTPException(status_code=422, detail="Saisissez la note de comportement avant de valider.")
    ev.valide_rh_le = datetime.utcnow()
    ev.rh_id = utilisateur.id
    tracer(db, utilisateur, "evaluation_validee_rh", employe, f"comportement {fr(ev.note_comportement)}/20")
    finaliser_si_complete(db, employe, obj, ev)
    db.commit()
    return serialiser(db, utilisateur, employe, annee)



# ------------------------------------------------------------------ Entretien annuel
class DeveloppementPayload(BaseModel):
    formations_souhaitees: list[str] = []
    plan_developpement: str | None = None
    mobilite_type: str | None = None      # aucune | interne | geographique | fonctionnelle
    mobilite_detail: str | None = None


class PriseConnaissancePayload(BaseModel):
    commentaire: str | None = None


@router.put("/{matricule}/evaluation/developpement", summary="Développement et mobilité souhaités")
def developpement(matricule: str, payload: DeveloppementPayload, annee: int | None = None,
                  db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    verifier_acces(db, utilisateur, employe, annee)
    ev = fiche_evaluation(db, employe, annee)
    if utilisateur.id != employe.id and not est_superieur(db, utilisateur, employe):
        raise HTTPException(status_code=403, detail="Réservé au collaborateur et à son supérieur hiérarchique.")
    if ev.finalisee_le:
        raise HTTPException(status_code=409, detail="L'évaluation est finalisée : le plan n'est plus modifiable.")
    ev.formations_souhaitees = json.dumps([f.strip() for f in payload.formations_souhaitees if f.strip()][:10], ensure_ascii=False)
    ev.plan_developpement = (payload.plan_developpement or "").strip() or None
    ev.mobilite_type = payload.mobilite_type or None
    ev.mobilite_detail = (payload.mobilite_detail or "").strip() or None
    db.commit()
    return serialiser(db, utilisateur, employe, annee)


@router.post("/{matricule}/evaluation/pris-connaissance", summary="Signature « pris connaissance » du collaborateur")
def pris_connaissance(matricule: str, payload: PriseConnaissancePayload, annee: int | None = None,
                      db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    annee = annee_courante(annee)
    employe = charger_employe(db, matricule)
    if utilisateur.id != employe.id:
        raise HTTPException(status_code=403, detail="Seul le collaborateur signe sa prise de connaissance.")
    ev = fiche_evaluation(db, employe, annee)
    if not ev.finalisee_le:
        raise HTTPException(status_code=409, detail="L'évaluation n'est pas encore validée.")
    ev.pris_connaissance_le = datetime.utcnow()
    ev.commentaire_collaborateur = (payload.commentaire or "").strip() or None
    superieurs = superieur_de(db, employe)
    for s in superieurs:
        notifier(db, s.id, "Évaluation : prise de connaissance signée",
                 f"{employe.prenom} {employe.nom} a signé sa fiche d'évaluation {annee}.", "info", "/fiche-evaluation")
    tracer(db, utilisateur, "evaluation_pris_connaissance", employe, str(annee))
    db.commit()
    return serialiser(db, utilisateur, employe, annee)
