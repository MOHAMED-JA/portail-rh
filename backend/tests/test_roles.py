"""Rôles RH : le gestionnaire mène les opérations, l'administrateur configure."""
import pytest

from app.core import config
from app.models import Employe, Role


@pytest.fixture
def gestionnaire(db):
    rh = db.query(Employe).filter_by(matricule="ADMINRH").one()
    e = Employe(matricule="GEST01", prenom="Gestion", nom="RH", email="gest@exemple.test", poste="Gestionnaire RH",
                role=Role.GESTIONNAIRE_RH, mot_de_passe_hash=rh.mot_de_passe_hash, doit_changer_mdp=False,
                departement_id=rh.departement_id)
    db.add(e)
    db.commit()
    return e


def test_le_gestionnaire_mene_les_operations_rh(client, entetes, gestionnaire, db):
    h = entetes("GEST01")
    assert client.get("/api/sirh/report", headers=h).status_code == 200
    assert client.get("/api/sirh/dossier/100259", headers=h).status_code == 200
    assert client.put("/api/sirh/dossier/100259", headers=h, json={"grade": "Chef service"}).status_code == 200
    assert client.get("/api/pilotage/equipe", headers=h).status_code == 200
    r = client.post("/api/administration/employes", headers=h, json={
        "matricule": "990010", "nom": "Nouveau", "prenom": "Agent", "email": "agent.test@veltaris.example", "poste": "Chargé"})
    assert r.status_code == 201, r.text
    julien = db.query(Employe).filter_by(matricule="100259").one()
    assert client.put(f"/api/administration/employes/{julien.id}", headers=h, json={"role": "validateur"}).status_code == 200


@pytest.mark.parametrize("methode,chemin,corps", [
    ("put", "/api/parametres/regles", {}),
    ("get", "/api/parametres/messagerie", None),
    ("get", "/api/securite/connexions", None),
    ("get", "/api/securite/etat", None),
    ("get", "/api/administration/audit", None),
    ("get", "/api/sirh/audit.xlsx", None),
    ("get", "/api/sirh/sauvegardes", None),
    ("get", "/api/pointeuse/etat", None),
    ("post", "/api/administration/departements", {"code": "X", "nom": "X"}),
])
def test_configuration_reservee_a_l_administrateur(client, entetes, gestionnaire, methode, chemin, corps):
    appel = getattr(client, methode)
    r = appel(chemin, headers=entetes("GEST01"), **({"json": corps} if corps is not None else {}))
    assert r.status_code == 403, (chemin, r.status_code)


def test_pas_d_elevation_de_droits(client, entetes, gestionnaire, db):
    h = entetes("GEST01")
    rh = db.query(Employe).filter_by(matricule="ADMINRH").one()
    julien = db.query(Employe).filter_by(matricule="100259").one()
    # Ni attribuer un rôle RH, ni modifier un compte RH (y compris le sien).
    assert client.put(f"/api/administration/employes/{julien.id}", headers=h, json={"role": "admin_rh"}).status_code == 403
    assert client.put(f"/api/administration/employes/{julien.id}", headers=h, json={"role": "gestionnaire_rh"}).status_code == 403
    assert client.put(f"/api/administration/employes/{rh.id}", headers=h, json={"mot_de_passe": "Piratage2026"}).status_code == 403
    assert client.put(f"/api/administration/employes/{gestionnaire.id}", headers=h, json={"role": "admin_rh"}).status_code == 403
    r = client.post("/api/administration/employes", headers=h, json={
        "matricule": "990011", "nom": "X", "prenom": "Y", "email": "x.test@veltaris.example", "poste": "P", "role": "admin_rh"})
    assert r.status_code == 403
    assert client.post(f"/api/administration/employes/{julien.id}/sortie", headers=h,
                       json={"motif": "demission", "date_sortie": "2026-12-31"}).status_code == 403


def test_l_administrateur_attribue_les_roles(client, entetes, gestionnaire, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    r = client.put(f"/api/administration/employes/{julien.id}", headers=entetes("ADMINRH"), json={"role": "gestionnaire_rh"})
    assert r.status_code == 200 and r.json()["role"] == "gestionnaire_rh"


def test_double_authentification_appliquee_aux_comptes_designes(client, gestionnaire, monkeypatch):
    monkeypatch.setattr(config, "DOUBLE_AUTH_RH", True)
    monkeypatch.setattr(config, "MATRICULES_DOUBLE_AUTH", frozenset({"GEST01"}))
    r = client.post("/api/auth/login", json={"matricule": "GEST01", "mot_de_passe": "Portail2026"}).json()
    assert r["utilisateur"]["double_auth_requise"] is True


def test_double_authentification_limitee_aux_deux_administratrices_nommees(client, db, monkeypatch):
    monkeypatch.setattr(config, "DOUBLE_AUTH_RH", True)
    monkeypatch.setattr(config, "MATRICULES_DOUBLE_AUTH", frozenset({"100123", "100146"}))
    compte_reference = db.query(Employe).filter_by(matricule="ADMINRH").one()
    for matricule, prenom, nom in (("100123", "Rachel", "Chevalier"), ("100146", "Valérie", "Perrin")):
        db.add(Employe(
            matricule=matricule, prenom=prenom, nom=nom, email=f"{matricule}@exemple.test", poste="Administration RH",
            role=Role.ADMIN_RH, mot_de_passe_hash=compte_reference.mot_de_passe_hash, doit_changer_mdp=False,
        ))
    db.commit()
    for matricule in ("100123", "100146"):
        reponse = client.post("/api/auth/login", json={"matricule": matricule, "mot_de_passe": "Portail2026"}).json()
        assert reponse["utilisateur"]["double_auth_requise"] is True
    reponse_partagee = client.post("/api/auth/login", json={"matricule": "ADMINRH", "mot_de_passe": "Portail2026"}).json()
    assert reponse_partagee["utilisateur"]["double_auth_requise"] is False
