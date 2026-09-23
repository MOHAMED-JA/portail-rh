"""Application atomique d'un plan d'organisation identifié par matricules.

Aucun rapprochement approximatif des noms, aucune création de compte et aucun
changement de mot de passe. L'appelant assure sauvegarde et transaction.
"""
import json
from datetime import date

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Departement, Employe, EvenementCarriere, JournalAudit, Role, ROLES_RH, StatutEmploye
from app.services.hierarchie import verifier_niveau, verifier_rattachement


class StructurePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=20)
    nom: str = Field(min_length=1, max_length=120)
    parent: str | None = None
    responsable: str | None = None
    couleur: str = "#2B63C9"


class AffectationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    matricule: str
    identite: str
    departement: str
    niveau: str
    poste: str = Field(min_length=1, max_length=120)
    superieur: str | None


class PlanOrganisation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference: str
    structures: list[StructurePlan]
    affectations: list[AffectationPlan]


def appliquer_plan(db: Session, plan: PlanOrganisation) -> dict:
    """Valide tout le plan, puis l'applique. Sans commit ; répétition sans effet."""
    employes = {e.matricule: e for e in db.scalars(select(Employe))}
    structures = {d.code: d for d in db.scalars(select(Departement))}
    codes = [s.code for s in plan.structures]
    matricules = [a.matricule for a in plan.affectations]
    if len(codes) != len(set(codes)) or len(matricules) != len(set(matricules)):
        raise ValueError("Le plan contient un code ou un matricule en double.")
    tous_codes = set(codes) | set(structures)
    for s in plan.structures:
        if s.parent is not None and s.parent not in tous_codes:
            raise ValueError(f"Structure parente inconnue : {s.parent}.")
        if s.responsable is not None and (s.responsable not in employes or employes[s.responsable].statut == StatutEmploye.SORTI):
            raise ValueError(f"Responsable inconnu ou sorti : {s.responsable}.")
    for a in plan.affectations:
        e = employes.get(a.matricule)
        if e is None or e.nom_complet != a.identite or e.statut == StatutEmploye.SORTI:
            raise ValueError(f"Identité absente, modifiée ou sortie : {a.matricule} ({a.identite}).")
        if a.departement not in tous_codes:
            raise ValueError(f"Département inconnu : {a.departement}.")
        if a.superieur is not None and (a.superieur not in employes or employes[a.superieur].statut == StatutEmploye.SORTI):
            raise ValueError(f"Supérieur inconnu ou sorti : {a.superieur}.")
        verifier_niveau(a.niveau)

    changements = []

    def tracer(type_cible, cible, avant, apres):
        if avant == apres:
            return
        changements.append({"type": type_cible, "cible": cible, "avant": avant, "apres": apres})
        db.add(JournalAudit(action="mise_a_jour_organisation", cible=cible,
                           detail=json.dumps({"reference": plan.reference, "avant": avant, "apres": apres}, ensure_ascii=False)))

    avant_structures = {}
    for s in plan.structures:
        d = structures.get(s.code)
        avant_structures[s.code] = None if d is None else {
            "nom": d.nom, "parent_id": d.parent_id, "responsable_id": d.responsable_id, "couleur": d.couleur}
        if d is None:
            d = Departement(code=s.code, nom=s.nom, couleur=s.couleur)
            db.add(d)
            structures[s.code] = d
    db.flush()
    for s in plan.structures:
        d = structures[s.code]
        d.nom, d.couleur = s.nom, s.couleur
        d.parent_id = structures[s.parent].id if s.parent else None
        d.responsable_id = employes[s.responsable].id if s.responsable else None
    for s in plan.structures:
        d = structures[s.code]
        verifier_rattachement(db, d.id, d.parent_id, structure=True)
        tracer("structure", d.code, avant_structures[s.code], {
            "nom": d.nom, "parent_id": d.parent_id, "responsable_id": d.responsable_id, "couleur": d.couleur})

    def valeurs(e):
        return {"departement_id": e.departement_id, "validateur_id": e.validateur_id,
                "niveau": e.niveau, "poste": e.poste, "role": e.role.value}

    avant_employes = {a.matricule: valeurs(employes[a.matricule]) for a in plan.affectations}
    def libelle(e):
        dept = next((d.nom for d in structures.values() if d.id == e.departement_id), "Sans département")
        chef = next((p.nom_complet for p in employes.values() if p.id == e.validateur_id), "Aucun supérieur")
        return f"{e.poste} ; {dept} ; N+1 : {chef}"
    avant_libelles = {a.matricule: libelle(employes[a.matricule]) for a in plan.affectations}
    for a in plan.affectations:
        e = employes[a.matricule]
        e.departement_id = structures[a.departement].id
        e.validateur_id = employes[a.superieur].id if a.superieur else None
        e.niveau, e.poste = a.niveau, a.poste
        # Le niveau métier n'enlève jamais les habilitations RH existantes.
        if e.role not in ROLES_RH:
            e.role = Role.EMPLOYE if a.niveau == "collaborateur" else Role.VALIDATEUR
    for a in plan.affectations:
        e = employes[a.matricule]
        verifier_rattachement(db, e.id, e.validateur_id)
        avant, apres = avant_employes[a.matricule], valeurs(e)
        tracer("employe", e.matricule, avant, apres)
        if avant != apres:
            db.add(EvenementCarriere(employe_id=e.id, date_effet=date.today(), type_evenement="organisation",
                                    avant=avant_libelles[a.matricule], apres=libelle(e),
                                    reference=plan.reference, commentaire="Mise à jour de l'organisation demandée par le porteur du projet."))
    db.flush()
    non_affectes = [{"matricule": e.matricule, "nom": e.nom_complet, "poste": e.poste}
                   for e in employes.values() if e.statut != StatutEmploye.SORTI and e.departement_id is None]
    return {"reference": plan.reference, "changements": changements, "non_affectes": non_affectes}
