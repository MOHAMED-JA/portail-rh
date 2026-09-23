"""Structures imbriquées, import atomique et droits des Middle Managers."""
import pytest
from fastapi import HTTPException

from app.models import Departement, Employe, JournalAudit, Role, EvenementCarriere
from app.services.organisation import PlanOrganisation, appliquer_plan
from app.services import hierarchie
from app.services.demandes import validateurs_possibles


def plan_test():
    return PlanOrganisation.model_validate({
        "reference": "Test organisation",
        "structures": [
            {"code": "POLE", "nom": "Pôle", "responsable": "100130"},
            {"code": "SANTE", "nom": "Santé", "parent": "POLE", "responsable": "100259"}],
        "affectations": [
            {"matricule": "100130", "identite": "Claire Morel", "departement": "POLE", "niveau": "manager", "poste": "Manager", "superieur": None},
            {"matricule": "100259", "identite": "Julien Garnier", "departement": "SANTE", "niveau": "middle_manager", "poste": "Middle Manager", "superieur": "100130"},
            {"matricule": "100281", "identite": "Paul Benoit", "departement": "SANTE", "niveau": "collaborateur", "poste": "Collaborateur", "superieur": "100259"},
            {"matricule": "ADMINRH", "identite": "Administration RH", "departement": "POLE", "niveau": "collaborateur", "poste": "RH", "superieur": "100130"}]})


def test_plan_idempotent_et_habilitations_preservees(db):
    avant = {e.matricule: (e.mot_de_passe_hash, e.nom, e.prenom) for e in db.query(Employe)}
    bilan = appliquer_plan(db, plan_test())
    db.commit()
    assert len(bilan["changements"]) == 6
    assert db.query(Employe).filter_by(matricule="ADMINRH").one().role == Role.ADMIN_RH
    assert db.query(JournalAudit).count() == 6
    assert db.query(EvenementCarriere).count() == 4
    assert appliquer_plan(db, plan_test())["changements"] == []
    assert db.query(JournalAudit).count() == 6
    assert avant == {e.matricule: (e.mot_de_passe_hash, e.nom, e.prenom) for e in db.query(Employe)}


def test_middle_manager_perimetre_et_validation(db, client, entetes):
    appliquer_plan(db, plan_test())
    db.commit()
    middle = db.query(Employe).filter_by(matricule="100259").one()
    collaborateur = db.query(Employe).filter_by(matricule="100281").one()
    assert middle.role == Role.VALIDATEUR
    assert hierarchie.equipe_ids(db, middle.id) == {collaborateur.id}
    assert [e.matricule for e in validateurs_possibles(db, collaborateur)] == ["100259", "100130"]
    r = client.get("/api/pilotage/equipe", headers=entetes("100259"))
    assert r.status_code == 200
    assert {x["employe"]["matricule"] for x in r.json()["lignes"]} == {"100281"}
    assert client.get("/api/pilotage/collaborateur/NOUVEAU", headers=entetes("100259")).status_code == 403


def test_identite_inexacte_refusee_sans_ecriture(db):
    plan = plan_test()
    plan.affectations[0].identite = "Autre personne"
    with pytest.raises(ValueError, match="Identité"):
        appliquer_plan(db, plan)
    assert db.query(Departement).count() == 1
    assert db.query(JournalAudit).count() == 0


@pytest.mark.parametrize("structure", [False, True])
def test_plan_cyclique_annule(db, structure):
    plan = plan_test()
    if structure:
        plan.structures[0].parent = "SANTE"
    else:
        plan.affectations[0].superieur = "100281"
    with pytest.raises(HTTPException):
        appliquer_plan(db, plan)
    db.rollback()
    assert db.query(Departement).count() == 1
    assert db.query(JournalAudit).count() == 0
    assert db.query(Employe).filter_by(matricule="100259").one().niveau == "collaborateur"


def test_api_refuse_cycle_indirect_et_superieur_inexistant(client, entetes, db):
    chef = db.query(Employe).filter_by(matricule="100130").one()
    enfant = db.query(Employe).filter_by(matricule="100259").one()
    for parent in (enfant.id, 999999, chef.id):
        r = client.put(f"/api/administration/employes/{chef.id}", headers=entetes("ADMINRH"), json={"validateur_id": parent})
        assert r.status_code == 422
    db.expire_all()
    assert chef.validateur_id is None


def test_api_structures_parent_responsable_et_suppression(client, entetes, db):
    h = entetes("ADMINRH")
    responsable = db.query(Employe).filter_by(matricule="100130").one().id
    p = client.post("/api/administration/departements", headers=h, json={"code": "P", "nom": "Pôle", "responsable_id": responsable})
    assert p.status_code == 201
    p = p.json()
    assert p["responsable"] == "Claire Morel"
    assert p["responsable_id"] == responsable
    c = client.post("/api/administration/departements", headers=h, json={"code": "D", "nom": "Direction", "parent_id": p["id"]})
    assert c.status_code == 201
    c = c.json()
    assert c["parent_id"] == p["id"]
    assert client.put(f"/api/administration/departements/{p['id']}", headers=h, json={"code": "P", "nom": "Pôle", "parent_id": c["id"]}).status_code == 422
    assert client.delete(f"/api/administration/departements/{p['id']}", headers=h).status_code == 409
    # Ancien client ne transmettant pas parent_id : le rattachement est conservé.
    r = client.put(f"/api/administration/departements/{c['id']}", headers=h, json={"code": "D", "nom": "Direction renommée"})
    assert r.status_code == 200 and r.json()["parent_id"] == p["id"]
    assert client.get("/api/administration/departements", headers=entetes("100259")).status_code == 200
    assert client.put(f"/api/administration/departements/{c['id']}", headers=entetes("100259"), json={"code": "D", "nom": "Interdit"}).status_code == 403


def test_api_references_structure_invalides(client, entetes):
    for champs in ({"parent_id": 999999}, {"responsable_id": 999999}):
        assert client.post("/api/administration/departements", headers=entetes("ADMINRH"), json={"code": "X", "nom": "Structure", **champs}).status_code == 422


def test_soldes_et_liste_limites_a_la_ligne(client, entetes, db):
    appliquer_plan(db, plan_test())
    db.commit()
    h = entetes("100259")
    externe = db.query(Employe).filter_by(matricule="NOUVEAU").one()
    interne = db.query(Employe).filter_by(matricule="100281").one()
    assert client.get(f"/api/administration/employes/{externe.id}/soldes", headers=h).status_code == 403
    assert client.get(f"/api/administration/employes/{interne.id}/soldes", headers=h).status_code == 200
    assert set(client.get("/api/administration/soldes", headers=h).json()) == {"100259", "100281"}
    visibles = client.get("/api/administration/employes", headers=entetes("100130")).json()
    assert {"100259", "100281"} <= {e["matricule"] for e in visibles}


def test_structure_sans_nom_refusee(client, entetes):
    assert client.post("/api/administration/departements", headers=entetes("ADMINRH"), json={"code": "VIDE", "nom": "   "}).status_code == 422
