"""Connexion, changement de mot de passe imposé, blocage, droits d'accès."""
from tests.constantes import MOT_DE_PASSE


def connexion(client, matricule, mot_de_passe=MOT_DE_PASSE):
    return client.post("/api/auth/login", json={"matricule": matricule, "mot_de_passe": mot_de_passe})


def test_sante(client):
    r = client.get("/api/sante")
    assert r.status_code == 200 and r.json()["statut"] == "ok"


def test_connexion_reussie(client):
    r = connexion(client, "100259")
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_matricule_insensible_a_la_casse(client):
    assert connexion(client, "adminrh").status_code == 200


def test_changement_impose_bloque_l_api(client):
    r = connexion(client, "NOUVEAU")
    assert r.json()["utilisateur"]["doit_changer_mdp"] is True
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/demandes", headers=h).status_code == 403
    assert client.get("/api/auth/moi", headers=h).status_code == 200


def test_changement_de_mot_de_passe_debloque(client):
    h = {"Authorization": f"Bearer {connexion(client, 'NOUVEAU').json()['access_token']}"}
    r = client.post("/api/auth/mot-de-passe", headers=h, json={"actuel": MOT_DE_PASSE, "nouveau": "Automne2026"})
    assert r.status_code == 200
    assert client.get("/api/demandes", headers=h).status_code == 200
    assert connexion(client, "NOUVEAU", "Automne2026").status_code == 200


def test_mot_de_passe_faible_refuse(client):
    h = {"Authorization": f"Bearer {connexion(client, 'NOUVEAU').json()['access_token']}"}
    for faible in ("abcdefgh", "12345678", "court1"):
        r = client.post("/api/auth/mot-de-passe", headers=h, json={"actuel": MOT_DE_PASSE, "nouveau": faible})
        assert r.status_code in (400, 422), faible


def test_blocage_apres_cinq_echecs(client):
    for i in range(4):
        r = connexion(client, "100281", "mauvais")
        assert r.status_code == 401
        assert f"{4 - i} essai(s) restant(s)" in r.json()["detail"]
    assert connexion(client, "100281", "mauvais").status_code == 423
    # Même avec le bon mot de passe, le compte reste bloqué.
    assert connexion(client, "100281").status_code == 423


def test_sans_jeton_refuse(client):
    assert client.get("/api/demandes").status_code == 401


def test_routes_rh_interdites_au_collaborateur(client, entetes):
    h = entetes("100259")
    for chemin in ("/api/sirh/report", "/api/sirh/alertes", "/api/sirh/bilan", "/api/sirh/audit.xlsx"):
        assert client.get(chemin, headers=h).status_code == 403, chemin
    assert client.get("/api/sirh/report", headers=entetes("ADMINRH")).status_code == 200
