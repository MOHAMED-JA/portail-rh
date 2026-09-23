"""Compétences (référentiel, emplois, évaluations, écarts → formations) et
postes clés avec plans de succession."""
from __future__ import annotations

import unicodedata
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, utilisateur_courant
from app.models import (
    ROLES_RH, AffectationEmploi, Competence, DossierEmploye, Emploi, Employe, EvaluationCompetence, ExigenceEmploi,
    Formation, JournalAudit, PosteCle, StatutEmploye, Successeur,
)
from app.services import hierarchie

router = APIRouter(prefix="/api/talents", tags=["Compétences et succession"])

NIVEAUX = {1: "Notions", 2: "Pratique", 3: "Maîtrise", 4: "Expert"}
PREPARATIONS = {"immediat": "Prêt maintenant", "1_2_ans": "Prêt dans 1 à 2 ans", "3_ans": "Prêt dans 3 ans ou plus"}
CRITICITES = {1: "Modérée", 2: "Forte", 3: "Vitale"}

REFERENTIEL_INITIAL = [
    ("Souscription IARD", "Technique assurance"), ("Gestion des sinistres", "Technique assurance"),
    ("Assurance vie et épargne", "Technique assurance"), ("Tarification et actuariat", "Technique assurance"),
    ("Réassurance", "Technique assurance"), ("Réglementation des assurances", "Conformité"),
    ("Lutte anti-blanchiment (LAB/FT)", "Conformité"), ("Contrôle interne et audit", "Conformité"),
    ("Recouvrement", "Finance"), ("Comptabilité des assurances", "Finance"), ("Relation client", "Relationnel"),
    ("Négociation", "Relationnel"), ("Management d'équipe", "Management"), ("Conduite de projet", "Management"),
    ("Excel et outils bureautiques", "Bureautique"), ("Communication écrite", "Relationnel"),
    ("Cybersécurité", "Sécurité"),
]


def initialiser_referentiel(db: Session) -> None:
    if db.scalar(select(Competence.id).limit(1)) is None:
        db.add_all(Competence(nom=n, domaine=d) for n, d in REFERENTIEL_INITIAL)
        db.commit()


def _sans_accents(texte: str) -> str:
    return unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode().lower()


def _employe(db: Session, matricule: str) -> Employe:
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    return e


def _peut_evaluer(u: Employe, e: Employe) -> bool:
    """Le supérieur hiérarchique direct (hors Direction générale) ou la RH."""
    return u.id != e.id and (u.role in ROLES_RH or (hierarchie.superieur_operationnel(e) is not None and e.validateur_id == u.id))


def _tracer(db: Session, u: Employe, action: str, cible: str, detail: str | None = None) -> None:
    db.add(JournalAudit(acteur_id=u.id, action=action, cible=cible, detail=detail))


# ------------------------------------------------------------------ Référentiel
class CompetencePayload(BaseModel):
    nom: str = Field(min_length=2, max_length=120)
    domaine: str = Field(min_length=2, max_length=60)
    description: str | None = None


def _competence_json(c: Competence) -> dict:
    return {"id": c.id, "nom": c.nom, "domaine": c.domaine, "description": c.description, "active": c.active}


@router.get("/competences", summary="Référentiel des compétences")
def competences(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    initialiser_referentiel(db)
    return [_competence_json(c) for c in db.scalars(select(Competence).where(Competence.active.is_(True))
                                                    .order_by(Competence.domaine, Competence.nom))]


@router.post("/competences", status_code=201, summary="Ajouter une compétence (RH)")
def ajouter_competence(payload: CompetencePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    existante = db.scalar(select(Competence).where(Competence.nom == payload.nom.strip()))
    if existante and existante.active:
        raise HTTPException(status_code=409, detail="Cette compétence existe déjà.")
    c = existante or Competence(nom=payload.nom.strip(), domaine=payload.domaine.strip())
    c.domaine, c.description, c.active = payload.domaine.strip(), payload.description, True
    db.add(c)
    _tracer(db, utilisateur, "competence_ajoutee", c.nom)
    db.commit()
    return _competence_json(c)


@router.delete("/competences/{competence_id}", status_code=204, summary="Retirer une compétence (RH)")
def retirer_competence(competence_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    c = db.get(Competence, competence_id)
    if not c:
        raise HTTPException(status_code=404, detail="Compétence introuvable")
    c.active = False   # l'historique des évaluations est conservé
    _tracer(db, utilisateur, "competence_retiree", c.nom)
    db.commit()


class ExigencePayload(BaseModel):
    competence_id: int
    niveau_requis: int = Field(ge=1, le=4)


class EmploiPayload(BaseModel):
    intitule: str = Field(min_length=2, max_length=120)
    famille: str | None = None
    description: str | None = None
    exigences: list[ExigencePayload] = []


def _emploi_json(db: Session, e: Emploi) -> dict:
    occupants = db.scalar(select(AffectationEmploi.employe_id).where(AffectationEmploi.emploi_id == e.id).limit(1))
    return {"id": e.id, "intitule": e.intitule, "famille": e.famille, "description": e.description,
            "exigences": [{"competence_id": x.competence_id, "competence": x.competence.nom, "domaine": x.competence.domaine,
                           "niveau_requis": x.niveau_requis} for x in sorted(e.exigences, key=lambda x: x.competence.nom)],
            "occupe": occupants is not None}


@router.get("/emplois", summary="Emplois de référence et compétences requises")
def emplois(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return [_emploi_json(db, e) for e in db.scalars(select(Emploi).where(Emploi.actif.is_(True)).order_by(Emploi.intitule))]


def _appliquer_exigences(db: Session, emploi: Emploi, exigences: list[ExigencePayload]) -> None:
    emploi.exigences.clear()
    db.flush()
    vues = set()
    for x in exigences:
        if x.competence_id in vues or not db.get(Competence, x.competence_id):
            continue
        vues.add(x.competence_id)
        emploi.exigences.append(ExigenceEmploi(competence_id=x.competence_id, niveau_requis=x.niveau_requis))


@router.post("/emplois", status_code=201, summary="Créer un emploi de référence (RH)")
def creer_emploi(payload: EmploiPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    if db.scalar(select(Emploi).where(Emploi.intitule == payload.intitule.strip(), Emploi.actif.is_(True))):
        raise HTTPException(status_code=409, detail="Cet emploi existe déjà.")
    e = Emploi(intitule=payload.intitule.strip(), famille=payload.famille, description=payload.description)
    db.add(e)
    db.flush()
    _appliquer_exigences(db, e, payload.exigences)
    _tracer(db, utilisateur, "emploi_cree", e.intitule)
    db.commit()
    return _emploi_json(db, e)


@router.put("/emplois/{emploi_id}", summary="Modifier un emploi et ses exigences (RH)")
def modifier_emploi(emploi_id: int, payload: EmploiPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    e = db.get(Emploi, emploi_id)
    if not e:
        raise HTTPException(status_code=404, detail="Emploi introuvable")
    e.intitule, e.famille, e.description = payload.intitule.strip(), payload.famille, payload.description
    _appliquer_exigences(db, e, payload.exigences)
    _tracer(db, utilisateur, "emploi_modifie", e.intitule)
    db.commit()
    return _emploi_json(db, e)


class AffectationPayload(BaseModel):
    emploi_id: int | None


@router.put("/affectation/{matricule}", summary="Rattacher un collaborateur à un emploi de référence (RH)")
def affecter(matricule: str, payload: AffectationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    e = _employe(db, matricule)
    a = db.get(AffectationEmploi, e.id)
    if payload.emploi_id is None:
        if a:
            db.delete(a)
    else:
        if not db.get(Emploi, payload.emploi_id):
            raise HTTPException(status_code=404, detail="Emploi introuvable")
        if a is None:
            db.add(AffectationEmploi(employe_id=e.id, emploi_id=payload.emploi_id))
        else:
            a.emploi_id = payload.emploi_id
    _tracer(db, utilisateur, "emploi_affecte", e.matricule, str(payload.emploi_id))
    db.commit()
    return profil(e.matricule, db, utilisateur)


# ------------------------------------------------------------------ Évaluation et écarts
def _formations_pour(db: Session, competence: Competence) -> list[dict]:
    """Sessions à venir dont le titre ou le thème évoque la compétence."""
    mots = [m for m in _sans_accents(competence.nom).replace("(", " ").replace(")", " ").split() if len(m) > 3]
    domaine = _sans_accents(competence.domaine)
    resultats = []
    for f in db.scalars(select(Formation).where(Formation.active.is_(True), Formation.date_debut >= date.today())):
        texte = _sans_accents(f"{f.titre} {f.theme} {f.description or ''}")
        if any(m in texte for m in mots) or (domaine and domaine.split()[0] in texte):
            resultats.append({"id": f.id, "titre": f.titre, "debut": f.date_debut})
    return resultats[:3]


def _profil(db: Session, e: Employe) -> dict:
    a = db.get(AffectationEmploi, e.id)
    evaluations = {x.competence_id: x for x in db.scalars(select(EvaluationCompetence).where(EvaluationCompetence.employe_id == e.id))}
    lignes = []
    exigences = a.emploi.exigences if a else []
    for x in sorted(exigences, key=lambda x: (x.competence.domaine, x.competence.nom)):
        ev = evaluations.get(x.competence_id)
        acquis = ev.niveau if ev else 0
        ecart = max(0, x.niveau_requis - acquis)
        lignes.append({"competence_id": x.competence_id, "competence": x.competence.nom, "domaine": x.competence.domaine,
                       "requis": x.niveau_requis, "acquis": acquis, "ecart": ecart,
                       "evalue_le": ev.evalue_le if ev else None, "commentaire": ev.commentaire if ev else None,
                       "formations": _formations_pour(db, x.competence) if ecart else []})
    requis = {x.competence_id for x in exigences}
    autres = [{"competence_id": ev.competence_id, "competence": ev.competence.nom, "domaine": ev.competence.domaine,
               "acquis": ev.niveau} for cid, ev in evaluations.items() if cid not in requis]
    couvertes = sum(1 for l in lignes if l["ecart"] == 0)
    return {"employe": {"matricule": e.matricule, "nom": e.nom, "prenom": e.prenom, "poste": e.poste},
            "emploi": {"id": a.emploi.id, "intitule": a.emploi.intitule} if a else None,
            "competences": lignes, "autres": autres,
            "couverture": round(100 * couvertes / len(lignes)) if lignes else None,
            "ecarts": sum(1 for l in lignes if l["ecart"])}


@router.get("/profil/{matricule}", summary="Compétences requises, acquises et écarts d'un collaborateur")
def profil(matricule: str, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    e = _employe(db, matricule)
    if not hierarchie.peut_consulter(db, utilisateur, e):
        raise HTTPException(status_code=403, detail="Ce collaborateur n'est pas dans votre périmètre.")
    return {**_profil(db, e), "peut_evaluer": _peut_evaluer(utilisateur, e)}


class NotePayload(BaseModel):
    competence_id: int
    niveau: int = Field(ge=0, le=4)
    commentaire: str | None = Field(default=None, max_length=500)


class EvaluationPayload(BaseModel):
    evaluations: list[NotePayload]


@router.put("/evaluation/{matricule}", summary="Évaluer les compétences (supérieur direct ou RH)")
def evaluer(matricule: str, payload: EvaluationPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    e = _employe(db, matricule)
    if not _peut_evaluer(utilisateur, e):
        raise HTTPException(status_code=403, detail="Réservé au supérieur hiérarchique direct et à la RH.")
    for n in payload.evaluations:
        if not db.get(Competence, n.competence_id):
            raise HTTPException(status_code=404, detail="Compétence introuvable")
        ev = db.scalar(select(EvaluationCompetence).where(EvaluationCompetence.employe_id == e.id,
                                                          EvaluationCompetence.competence_id == n.competence_id))
        if n.niveau == 0:
            if ev:
                db.delete(ev)
            continue
        if ev is None:
            ev = EvaluationCompetence(employe_id=e.id, competence_id=n.competence_id, niveau=n.niveau)
            db.add(ev)
        ev.niveau, ev.commentaire = n.niveau, (n.commentaire or "").strip() or None
        ev.evalue_par_id, ev.evalue_le = utilisateur.id, datetime.utcnow()
    _tracer(db, utilisateur, "competences_evaluees", e.matricule, f"{len(payload.evaluations)} compétence(s)")
    db.commit()
    return {**_profil(db, e), "peut_evaluer": True}


@router.get("/equipe", summary="Écarts de compétences de la ligne hiérarchique (tout le personnel pour la RH et la DG)")
def equipe(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    ids = hierarchie.perimetre_ids(db, utilisateur)
    if not ids:
        raise HTTPException(status_code=403, detail="Aucun collaborateur dans votre périmètre.")
    lignes, manques = [], {}
    for e in db.scalars(select(Employe).where(Employe.id.in_(ids)).order_by(Employe.nom, Employe.prenom)):
        p = _profil(db, e)
        for l in p["competences"]:
            if l["ecart"]:
                manques.setdefault(l["competence"], {"competence": l["competence"], "domaine": l["domaine"], "personnes": 0})
                manques[l["competence"]]["personnes"] += 1
        lignes.append({"employe": p["employe"], "emploi": p["emploi"]["intitule"] if p["emploi"] else None,
                       "couverture": p["couverture"], "ecarts": p["ecarts"], "peut_evaluer": _peut_evaluer(utilisateur, e)})
    return {"lignes": lignes, "besoins": sorted(manques.values(), key=lambda m: -m["personnes"])[:15],
            "sans_emploi": sum(1 for l in lignes if not l["emploi"])}


# ------------------------------------------------------------------ Postes clés et succession
def _succession_autorisee(u: Employe) -> None:
    if not hierarchie.voit_tout(u):
        raise HTTPException(status_code=403, detail="Plans de succession : RH et Direction générale uniquement.")


def _retraite(db: Session, e: Employe | None) -> date | None:
    d = db.get(DossierEmploye, e.id) if e else None
    if not d or not d.date_naissance:
        return None
    from app.services import sirh

    try:
        return d.date_naissance.replace(year=d.date_naissance.year + sirh.AGE_RETRAITE)
    except ValueError:
        return date(d.date_naissance.year + sirh.AGE_RETRAITE, 3, 1)


def _poste_json(db: Session, p: PosteCle) -> dict:
    retraite = _retraite(db, p.titulaire)
    mois_retraite = ((retraite.year - date.today().year) * 12 + retraite.month - date.today().month) if retraite else None
    prets = [s for s in p.successeurs if s.preparation == "immediat"]
    if not p.successeurs:
        risque = "eleve"
    elif prets:
        risque = "faible"
    elif p.criticite == 3 or (mois_retraite is not None and mois_retraite <= 24):
        risque = "eleve"
    else:
        risque = "moyen"
    motifs = []
    if not p.titulaire:
        motifs.append("poste vacant")
    if mois_retraite is not None and mois_retraite <= 24:
        motifs.append(f"départ en retraite dans {max(0, mois_retraite)} mois")
    if not p.successeurs:
        motifs.append("aucun successeur identifié")
    elif not prets:
        motifs.append("aucun successeur prêt immédiatement")
    return {"id": p.id, "intitule": p.intitule, "criticite": p.criticite, "criticite_libelle": CRITICITES.get(p.criticite),
            "notes": p.notes, "risque": risque, "motifs": motifs, "retraite_titulaire": retraite,
            "titulaire": {"matricule": p.titulaire.matricule, "nom": p.titulaire.nom, "prenom": p.titulaire.prenom,
                          "poste": p.titulaire.poste} if p.titulaire else None,
            "successeurs": [{"id": s.id, "matricule": s.employe.matricule, "nom": s.employe.nom, "prenom": s.employe.prenom,
                             "poste": s.employe.poste, "preparation": s.preparation,
                             "preparation_libelle": PREPARATIONS[s.preparation], "commentaire": s.commentaire}
                            for s in sorted(p.successeurs, key=lambda s: list(PREPARATIONS).index(s.preparation))]}


@router.get("/postes-cles", summary="Postes clés et plans de succession (RH, Direction générale)")
def postes_cles(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    _succession_autorisee(utilisateur)
    postes = [_poste_json(db, p) for p in db.scalars(select(PosteCle).order_by(PosteCle.criticite.desc(), PosteCle.intitule))]
    ordre = {"eleve": 0, "moyen": 1, "faible": 2}
    return sorted(postes, key=lambda p: (ordre[p["risque"]], -p["criticite"]))


class PostePayload(BaseModel):
    intitule: str = Field(min_length=2, max_length=160)
    titulaire: str | None = None          # matricule
    criticite: int = Field(default=2, ge=1, le=3)
    notes: str | None = None


def _appliquer_poste(db: Session, p: PosteCle, payload: PostePayload) -> None:
    p.intitule, p.criticite, p.notes = payload.intitule.strip(), payload.criticite, payload.notes
    p.titulaire_id = _employe(db, payload.titulaire).id if payload.titulaire else None


@router.post("/postes-cles", status_code=201, summary="Déclarer un poste clé (RH)")
def creer_poste(payload: PostePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = PosteCle()
    _appliquer_poste(db, p, payload)
    db.add(p)
    _tracer(db, utilisateur, "poste_cle_cree", p.intitule)
    db.commit()
    return _poste_json(db, p)


@router.put("/postes-cles/{poste_id}", summary="Modifier un poste clé (RH)")
def modifier_poste(poste_id: int, payload: PostePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = db.get(PosteCle, poste_id)
    if not p:
        raise HTTPException(status_code=404, detail="Poste clé introuvable")
    _appliquer_poste(db, p, payload)
    _tracer(db, utilisateur, "poste_cle_modifie", p.intitule)
    db.commit()
    return _poste_json(db, p)


@router.delete("/postes-cles/{poste_id}", status_code=204, summary="Supprimer un poste clé (RH)")
def supprimer_poste(poste_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = db.get(PosteCle, poste_id)
    if not p:
        raise HTTPException(status_code=404, detail="Poste clé introuvable")
    _tracer(db, utilisateur, "poste_cle_supprime", p.intitule)
    db.delete(p)
    db.commit()


class SuccesseurPayload(BaseModel):
    matricule: str
    preparation: str = Field(pattern="^(immediat|1_2_ans|3_ans)$")
    commentaire: str | None = None


@router.post("/postes-cles/{poste_id}/successeurs", summary="Ajouter ou mettre à jour un successeur (RH)")
def ajouter_successeur(poste_id: int, payload: SuccesseurPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = db.get(PosteCle, poste_id)
    if not p:
        raise HTTPException(status_code=404, detail="Poste clé introuvable")
    e = _employe(db, payload.matricule)
    if e.id == p.titulaire_id:
        raise HTTPException(status_code=422, detail="Le titulaire ne peut pas être son propre successeur.")
    if e.statut == StatutEmploye.SORTI:
        raise HTTPException(status_code=422, detail="Ce collaborateur a quitté l'entreprise.")
    s = next((x for x in p.successeurs if x.employe_id == e.id), None)
    if s is None:
        s = Successeur(employe_id=e.id, preparation=payload.preparation)
        p.successeurs.append(s)
    s.preparation, s.commentaire = payload.preparation, payload.commentaire
    _tracer(db, utilisateur, "successeur_designe", p.intitule, e.matricule)
    db.commit()
    return _poste_json(db, p)


@router.delete("/postes-cles/{poste_id}/successeurs/{successeur_id}", summary="Retirer un successeur (RH)")
def retirer_successeur(poste_id: int, successeur_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    s = db.get(Successeur, successeur_id)
    if not s or s.poste_id != poste_id:
        raise HTTPException(status_code=404, detail="Successeur introuvable")
    p = s.poste
    db.delete(s)
    db.commit()
    db.refresh(p)
    return _poste_json(db, p)
