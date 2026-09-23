"""Double authentification, historique des connexions, chiffrement."""
import pytest
from sqlalchemy import text

from app.core import config
from app.models import Connexion, DossierEmploye, Employe
from app.services import chiffrement, totp
from tests.constantes import MOT_DE_PASSE


def connexion(client, matricule, mot_de_passe=MOT_DE_PASSE):
    return client.post("/api/auth/login", json={"matricule": matricule, "mot_de_passe": mot_de_passe})


@pytest.fixture
def double_auth_obligatoire(monkeypatch):
    monkeypatch.setattr(config, "DOUBLE_AUTH_RH", True)
    monkeypatch.setattr(config, "MATRICULES_DOUBLE_AUTH", frozenset({"ADMINRH"}))


def activer(client, matricule):
    """Active la double authentification du compte ; renvoie (secret, codes de secours)."""
    h = {"Authorization": f"Bearer {connexion(client, matricule).json()['access_token']}"}
    secret = client.post("/api/auth/2fa/initier", headers=h).json()["secret"]
    r = client.post("/api/auth/2fa/activer", headers=h, json={"code": totp.code(secret)})
    assert r.status_code == 200, r.text
    return secret, r.json()["codes_secours"]


# ---- TOTP ------------------------------------------------------------------------
def test_totp_conforme_rfc6238():
    # Vecteur de test officiel : clé ASCII « 12345678901234567890 », t = 59 s → 94287082 (8 chiffres).
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.code(secret, 59) == "287082"
    assert totp.verifier(secret, "287082", 59)
    assert totp.verifier(secret, "287082", 59 + 30)        # tolérance d'une période
    assert not totp.verifier(secret, "287082", 59 + 120)
    assert not totp.verifier(secret, "abc123", 59)


# ---- Double authentification -------------------------------------------------------------
def test_compte_rh_doit_activer_la_double_authentification(client, double_auth_obligatoire):
    r = connexion(client, "ADMINRH")
    assert r.json()["utilisateur"]["double_auth_requise"] is True
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/sirh/report", headers=h).status_code == 403
    assert client.get("/api/auth/moi", headers=h).status_code == 200
    activer(client, "ADMINRH")
    assert client.get("/api/sirh/report", headers=h).status_code == 200


def test_connexion_en_deux_etapes(client, double_auth_obligatoire):
    secret, _ = activer(client, "ADMINRH")
    r = connexion(client, "ADMINRH").json()
    assert r["etape"] == "code_2fa" and r["access_token"] is None
    # Le jeton d'étape n'ouvre aucune route.
    assert client.get("/api/auth/moi", headers={"Authorization": f"Bearer {r['jeton_etape']}"}).status_code == 401
    faux = client.post("/api/auth/2fa/verifier", json={"jeton_etape": r["jeton_etape"], "code": "000000"})
    assert faux.status_code == 401 and "essai(s) restant(s)" in faux.json()["detail"]
    bon = client.post("/api/auth/2fa/verifier", json={"jeton_etape": r["jeton_etape"], "code": totp.code(secret)})
    assert bon.status_code == 200 and bon.json()["access_token"]


def test_compte_designe_ne_peut_pas_desactiver_sa_protection(client, entetes, double_auth_obligatoire):
    secret, _ = activer(client, "ADMINRH")
    reponse = client.post("/api/auth/2fa/desactiver", headers=entetes("ADMINRH"), json={"code": totp.code(secret)})
    assert reponse.status_code == 403
    assert connexion(client, "ADMINRH").json()["etape"] == "code_2fa"


def test_code_de_secours_a_usage_unique(client, double_auth_obligatoire):
    _, codes = activer(client, "ADMINRH")
    assert len(codes) == 8
    for attendu in (200, 401):
        etape = connexion(client, "ADMINRH").json()["jeton_etape"]
        r = client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape, "code": codes[0]})
        assert r.status_code == attendu


def test_blocage_apres_cinq_codes_faux(client, double_auth_obligatoire):
    secret, _ = activer(client, "ADMINRH")
    etape = connexion(client, "ADMINRH").json()["jeton_etape"]
    for _ in range(4):
        assert client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape, "code": "111111"}).status_code == 401
    assert client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape, "code": "111111"}).status_code == 423
    assert client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape, "code": totp.code(secret)}).status_code == 423


def test_reinitialisation_par_un_autre_administrateur(client, entetes, db, double_auth_obligatoire):
    activer(client, "ADMINRH")
    rh = db.query(Employe).filter_by(matricule="ADMINRH").one()
    assert client.post("/api/securite/2fa/100259/reinitialiser", headers=entetes("100259")).status_code == 403
    # Soi-même : refusé.
    assert client.post("/api/securite/2fa/ADMINRH/reinitialiser", headers=entetes("ADMINRH")).status_code == 403
    db.refresh(rh)
    assert rh.totp_active is True
    # Un second administrateur RH peut la réinitialiser (téléphone perdu).
    from app.models import Role
    second = Employe(matricule="ADMIN2", prenom="Second", nom="Admin", email="a2@exemple.test", poste="RH",
                     role=Role.ADMIN_RH, mot_de_passe_hash=rh.mot_de_passe_hash, doit_changer_mdp=False)
    db.add(second)
    db.commit()
    monkey = config.DOUBLE_AUTH_RH
    config.DOUBLE_AUTH_RH = False     # le second compte n'a pas encore son téléphone configuré
    try:
        r = client.post("/api/securite/2fa/ADMINRH/reinitialiser", headers=entetes("ADMIN2"))
    finally:
        config.DOUBLE_AUTH_RH = monkey
    assert r.status_code == 200
    db.refresh(rh)
    assert rh.totp_active is False and rh.totp_secret is None
    assert connexion(client, "ADMINRH").json()["utilisateur"]["double_auth_requise"] is True


def test_employe_non_rh_non_concerne(client, double_auth_obligatoire):
    r = connexion(client, "100259").json()
    assert r["access_token"] and r["utilisateur"]["double_auth_requise"] is False


# ---- Historique des connexions -----------------------------------------------------------
def test_historique_des_connexions(client, entetes, db):
    connexion(client, "100259", "mauvais")
    connexion(client, "100259")
    connexion(client, "INCONNU", "x")
    resultats = [c.resultat for c in db.query(Connexion).order_by(Connexion.id).all()]
    assert resultats == ["mot_de_passe", "succes", "inconnu"]
    lignes = client.get("/api/securite/connexions", headers=entetes("ADMINRH")).json()
    assert {l["resultat"] for l in lignes} == {"mot_de_passe", "succes", "inconnu"}
    assert client.get("/api/securite/connexions", headers=entetes("100259")).status_code == 403
    miennes = client.get("/api/auth/mes-connexions", headers=entetes("100259")).json()
    assert [m["resultat"] for m in miennes] == ["succes", "mot_de_passe"]
    etat = client.get("/api/securite/etat", headers=entetes("ADMINRH")).json()
    assert etat["echecs_24h"] == 2 and etat["connexions_24h"] == 1


# ---- Chiffrement --------------------------------------------------------------------------
def test_donnees_de_sante_chiffrees_en_base(client, entetes, db):
    r = client.put("/api/sirh/dossier/100259", headers=entetes("ADMINRH"), json={
        "aptitude_medicale": "Apte avec réserves", "observations_medicales": "Éviter le port de charges lourdes"})
    assert r.status_code == 200 and r.json()["observations_medicales"] == "Éviter le port de charges lourdes"
    julien = db.query(Employe).filter_by(matricule="100259").one()
    brut = db.execute(text("select aptitude_medicale, observations_medicales from dossiers_employes where employe_id = :i"),
                      {"i": julien.id}).one()
    assert all(v.startswith(chiffrement.PREFIXE) and "réserves" not in v and "charges" not in v for v in brut)
    db.expire_all()
    assert db.get(DossierEmploye, julien.id).aptitude_medicale == "Apte avec réserves"
    # Le supérieur n'y a pas accès.
    assert client.get("/api/sirh/dossier/100259", headers=entetes("100130")).status_code == 403


def test_secret_de_double_authentification_chiffre(client, db, double_auth_obligatoire):
    secret, _ = activer(client, "ADMINRH")
    brut = db.execute(text("select totp_secret from employes where matricule = 'ADMINRH'")).scalar()
    assert brut.startswith(chiffrement.PREFIXE) and secret not in brut


def test_valeur_anterieure_en_clair_toleree():
    assert chiffrement.dechiffrer("texte ancien") == "texte ancien"
    assert chiffrement.dechiffrer(chiffrement.chiffrer("é")) == "é"
