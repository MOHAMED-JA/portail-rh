"""Mot de passe oublié : les trois canaux, et l'assurance de ne jamais rester
à la porte (un compte bloqué se réinitialise, une tentative ne bloque pas)."""
from datetime import datetime, timedelta

from app.models import DemandeReinitialisation, Employe, Notification
from app.services import totp
from tests.constantes import MOT_DE_PASSE

NOUVEAU = "Septembre2026"


def compte(db, matricule="100259"):
    return db.query(Employe).filter_by(matricule=matricule).one()


def avec_double_auth(db, employe):
    """Active la double authentification et rend (secret, codes de secours)."""
    secret = totp.nouveau_secret()
    codes, empreintes = totp.codes_de_secours()
    employe.totp_secret, employe.totp_active, employe.codes_secours = secret, True, empreintes
    db.commit()
    return secret, codes


def test_sans_double_auth_la_demande_part_a_la_rh(client, db, entetes):
    r = client.post("/api/auth/oubli", json={"matricule": "100281"}).json()
    assert r["canal"] == "rh"
    attente = client.get("/api/auth/oubli/en-attente", headers=entetes("ADMINRH")).json()
    assert [d["employe"]["matricule"] for d in attente] == ["100281"]
    rh = compte(db, "ADMINRH")
    assert db.query(Notification).filter_by(destinataire_id=rh.id, titre="Mot de passe oublié").count() == 1
    # Classée par la RH : elle disparaît de la file.
    client.post(f"/api/auth/oubli/{attente[0]['id']}/classer", headers=entetes("ADMINRH"))
    assert client.get("/api/auth/oubli/en-attente", headers=entetes("ADMINRH")).json() == []


def test_matricule_inconnu_ne_dit_rien(client, db):
    r = client.post("/api/auth/oubli", json={"matricule": "999999"})
    assert r.status_code == 200 and r.json()["canal"] == "rh"
    trace = db.query(DemandeReinitialisation).filter_by(matricule="999999").one()
    assert trace.employe_id is None and trace.statut == "echec"     # tracé, mais rien de divulgué


def test_reinitialisation_par_double_auth(client, db):
    employe = compte(db)
    secret, codes = avec_double_auth(db, employe)
    assert client.post("/api/auth/oubli", json={"matricule": "100259"}).json()["canal"] == "totp"

    r = client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": totp.code(secret), "code_secours": codes[0], "nouveau": NOUVEAU})
    assert r.status_code == 200

    # Le nouveau mot de passe ouvre la session (étape du code, la 2FA restant active).
    ouverture = client.post("/api/auth/login", json={"matricule": "100259", "mot_de_passe": NOUVEAU})
    assert ouverture.status_code == 200 and ouverture.json()["etape"] == "code_2fa"
    assert client.post("/api/auth/login", json={"matricule": "100259", "mot_de_passe": MOT_DE_PASSE}).status_code == 401

    # Le code de secours a été consommé.
    rejeu = client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": totp.code(secret), "code_secours": codes[0], "nouveau": "Octobre2026"})
    assert rejeu.status_code == 401


def test_code_faux_ne_bloque_pas_le_compte(client, db):
    employe = compte(db)
    secret, codes = avec_double_auth(db, employe)
    r = client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": "000000", "code_secours": codes[0], "nouveau": NOUVEAU})
    assert r.status_code == 401
    db.refresh(employe)
    assert employe.echecs_connexion == 0 and employe.bloque_jusqu is None
    # Le code de secours n'a pas été consommé : il sert encore.
    assert client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": totp.code(secret), "code_secours": codes[0],
        "nouveau": NOUVEAU}).status_code == 200


def test_compte_bloque_peut_se_reinitialiser(client, db):
    employe = compte(db)
    secret, codes = avec_double_auth(db, employe)
    employe.bloque_jusqu = datetime.utcnow() + timedelta(minutes=15)
    employe.echecs_connexion = 4
    db.commit()
    assert client.post("/api/auth/login", json={"matricule": "100259", "mot_de_passe": MOT_DE_PASSE}).status_code == 423

    assert client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": totp.code(secret), "code_secours": codes[0],
        "nouveau": NOUVEAU}).status_code == 200
    db.refresh(employe)
    assert employe.bloque_jusqu is None and employe.echecs_connexion == 0


def test_mot_de_passe_trop_faible_refuse(client, db):
    secret, codes = avec_double_auth(db, compte(db))
    r = client.post("/api/auth/oubli/double-auth", json={
        "matricule": "100259", "code": totp.code(secret), "code_secours": codes[0], "nouveau": "demo2026aa"})
    assert r.status_code == 422


def test_plafond_des_tentatives(client, db):
    for _ in range(10):
        client.post("/api/auth/oubli", json={"matricule": "100130"})
    r = client.post("/api/auth/oubli", json={"matricule": "100130"})
    assert r.status_code == 429
    assert compte(db, "100130").bloque_jusqu is None       # le compte lui-même reste ouvert


def test_file_rh_reservee_aux_comptes_rh(client, entetes):
    assert client.get("/api/auth/oubli/en-attente", headers=entetes("100130")).status_code == 403
