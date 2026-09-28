"""Corrections de sécurité de la version 1.37.0 : fichiers servis par le
portail, pièces jointes protégées, dépôts contrôlés, matricules non
devinables, sessions révoquées, codes de double authentification à usage
unique, mot de passe SMTP chiffré, en-têtes de sécurité."""
import asyncio
from datetime import date, datetime, timedelta

from jose import jwt

from app.core.config import JWT_ALGORITHM, JWT_SECRET, UPLOAD_DIR
from app.main import APPLICATION, app
from app.models import Employe, Parametre
from app.routers import mobilite
from app.services import emails, televersements, totp
from tests.constantes import MOT_DE_PASSE

PDF = b"%PDF-1.4\n% piece de test\n"


def brut(chemin: str) -> tuple[int, bytes]:
    """Requête HTTP GET passée telle quelle à l'application (sans la
    normalisation des « .. » que ferait un client HTTP)."""
    etat = {"statut": None, "corps": b""}
    scope = {"type": "http", "method": "GET", "path": chemin, "raw_path": chemin.encode(), "query_string": b"",
             "headers": [], "http_version": "1.1", "scheme": "http", "server": ("test", 80),
             "client": ("test", 1), "root_path": ""}

    async def recevoir():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def envoyer(message):
        if message["type"] == "http.response.start":
            etat["statut"] = message["status"]
        elif message["type"] == "http.response.body":
            etat["corps"] += message.get("body", b"")

    asyncio.run(app(scope, recevoir, envoyer))
    return etat["statut"], etat["corps"]


def deposer(client, entetes, matricule="100259", contenu=PDF, nom="justificatif.pdf"):
    return client.post("/api/demandes/piece-jointe", headers=entetes(matricule),
                       files={"fichier": (nom, contenu, "application/pdf")})


def lundi_prochain() -> date:
    jour = date.today() + timedelta(days=14)
    return jour - timedelta(days=jour.weekday())


# ---- Fichiers de l'application -------------------------------------------------------------
def test_aucun_fichier_du_disque_hors_de_l_application(tmp_path):
    temoin = tmp_path / "temoin.html"
    temoin.write_text("CONTENU-CONFIDENTIEL", encoding="utf-8")
    absolu = "/" + temoin.as_posix()                       # « /C:/Users/…/temoin.html »
    remontee = "/" + "../" * 12 + temoin.as_posix().split(":", 1)[-1].lstrip("/")
    for chemin in (absolu, remontee, "/%2e%2e/%2e%2e/outils/_logos_snippet.html", "/outils/_logos_snippet.html",
                   "/backend/app/main.py", "/README.md"):
        statut, corps = brut(chemin)
        assert b"CONTENU-CONFIDENTIEL" not in corps and b"Logos officiels" not in corps, chemin
        assert statut == 200 and corps == APPLICATION.read_bytes(), chemin    # l'application, rien d'autre


def test_les_fichiers_de_l_application_restent_servis(client):
    assert "CACHE" in client.get("/sw.js").text
    assert client.get("/manifest.webmanifest").status_code == 200
    assert client.get("/assets/css/portail-rh.css").status_code == 200


def test_entetes_de_securite(client):
    for chemin in ("/", "/api/sante"):
        entetes = client.get(chemin).headers
        assert entetes["X-Content-Type-Options"] == "nosniff"
        assert entetes["X-Frame-Options"] == "SAMEORIGIN"
        assert entetes["Referrer-Policy"] == "same-origin"


# ---- Pièces jointes protégées -------------------------------------------------------------
def test_piece_jointe_reservee_aux_personnes_concernees(client, entetes):
    chemin = deposer(client, entetes).json()["chemin"]
    assert client.get(chemin).status_code == 401                                 # sans connexion
    assert client.get(chemin, headers=entetes("100259")).content == PDF         # l'auteur
    assert client.get(chemin, headers=entetes("100281")).status_code == 404     # un collègue
    assert client.get(chemin, headers=entetes("100130")).status_code == 404     # pas encore rattachée

    debut = lundi_prochain()
    demande = client.post("/api/demandes/conge", headers=entetes("100259"), json={
        "sous_type": "annuel", "date_debut": str(debut), "date_fin": str(debut + timedelta(days=1)),
        "piece_jointe": chemin})
    assert demande.status_code == 201, demande.text
    assert client.get(chemin, headers=entetes("100130")).status_code == 200     # son supérieur
    assert client.get(chemin, headers=entetes("ADMINRH")).status_code == 200    # la RH
    assert client.get(chemin, headers=entetes("100281")).status_code == 404


def test_on_ne_s_approprie_pas_la_piece_d_un_autre(client, entetes):
    chemin = deposer(client, entetes, matricule="100281").json()["chemin"]
    debut = lundi_prochain()
    r = client.post("/api/demandes/conge", headers=entetes("100259"), json={
        "sous_type": "annuel", "date_debut": str(debut), "date_fin": str(debut), "piece_jointe": chemin})
    assert r.status_code == 422
    assert client.get(chemin, headers=entetes("100259")).status_code == 404


def test_piece_disciplinaire_rh_et_interesse_seulement(client, entetes):
    sanction = client.post("/api/discipline", headers=entetes("ADMINRH"), json={
        "matricule": "100259", "type_sanction": "avertissement", "date_faits": str(date.today() - timedelta(days=5)),
        "faits": "Absences injustifiées répétées sans prévenir la hiérarchie."}).json()
    r = client.post(f"/api/discipline/{sanction['id']}/piece", headers=entetes("ADMINRH"),
                    files={"fichier": ("decision.pdf", PDF, "application/pdf")})
    assert r.status_code == 200, r.text
    chemin = r.json()["piece_jointe"]
    assert client.get(chemin, headers=entetes("100259")).status_code == 200     # l'intéressé
    assert client.get(chemin, headers=entetes("100130")).status_code == 404     # pas son supérieur
    assert client.get(chemin, headers=entetes("100281")).status_code == 404


def test_noms_de_pieces_hors_du_dossier_refuses(client, entetes):
    for chemin in ("/fichiers/..%2f..%2fportail.db", "/fichiers/recrutement/abc.pdf", "/fichiers/secret.key"):
        assert client.get(chemin, headers=entetes("ADMINRH")).status_code == 404, chemin


# ---- Dépôts contrôlés ------------------------------------------------------------------------
def test_faux_pdf_refuse(client, entetes):
    avant = set(UPLOAD_DIR.iterdir())
    r = deposer(client, entetes, contenu=b"<html><script>alert(1)</script></html>")
    assert r.status_code == 422 and "ne correspond pas" in r.json()["detail"]
    assert set(UPLOAD_DIR.iterdir()) == avant


def test_fichier_trop_volumineux_refuse_sans_trace(client, entetes, monkeypatch):
    monkeypatch.setattr(televersements, "TAILLE_MAX", 200 * 1024)
    avant = set(UPLOAD_DIR.iterdir())
    r = deposer(client, entetes, contenu=PDF + b"0" * (300 * 1024))
    assert r.status_code == 413
    assert set(UPLOAD_DIR.iterdir()) == avant                                   # fichier partiel supprimé


def test_signatures_word_reconnues():
    assert televersements.contenu_conforme(".docx", b"PK\x03\x04reste")
    assert televersements.contenu_conforme(".doc", televersements.SIGNATURE_DOC + b"reste")
    assert not televersements.contenu_conforme(".docx", b"%PDF-1.4")


def test_depot_public_de_cv_plafonne(client, entetes, monkeypatch):
    monkeypatch.setattr(mobilite, "DEPOTS_PAR_ADRESSE_ET_HEURE", 2)
    monkeypatch.setattr(mobilite, "_depots_publics", {})
    offre = client.post("/api/mobilite/offres", headers=entetes("ADMINRH"), json={
        "intitule": "Chargé de clientèle", "description": "Relation client et suivi des contrats.",
        "date_limite": str(date.today() + timedelta(days=30)), "publication": "externe"})
    assert offre.status_code == 201, offre.text
    url = f"/api/mobilite/recrutement/offres/{offre.json()['id']}/candidater"
    statuts = [client.post(url, data={"nom": "Candidat", "prenom": f"Numero{i}", "email": f"c{i}@example.test"},
                           files={"cv": ("cv.pdf", PDF, "application/pdf")}).status_code for i in range(3)]
    assert statuts == [201, 201, 429]


# ---- Matricules non devinables -----------------------------------------------------------------
def test_matricule_inconnu_repond_comme_un_compte_existant(client):
    existant = client.post("/api/auth/login", json={"matricule": "100281", "mot_de_passe": "mauvais1"})
    inconnu = client.post("/api/auth/login", json={"matricule": "990001", "mot_de_passe": "mauvais1"})
    assert existant.status_code == inconnu.status_code == 401
    assert existant.json() == inconnu.json()


def test_matricule_inconnu_bloque_comme_un_compte_existant(client):
    def rafale(matricule):
        return [client.post("/api/auth/login", json={"matricule": matricule, "mot_de_passe": "mauvais1"})
                for _ in range(6)]
    existant, inconnu = rafale("100281"), rafale("990002")
    assert [r.status_code for r in existant] == [r.status_code for r in inconnu] == [401, 401, 401, 401, 423, 423]
    assert [r.json()["detail"] for r in existant] == [r.json()["detail"] for r in inconnu]


# ---- Sessions ------------------------------------------------------------------------------------
def connexion(client, matricule="100259", mot_de_passe=MOT_DE_PASSE):
    r = client.post("/api/auth/login", json={"matricule": matricule, "mot_de_passe": mot_de_passe})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_changer_son_mot_de_passe_ferme_les_autres_sessions(client):
    autre_poste = connexion(client)
    ici = connexion(client)
    r = client.post("/api/auth/mot-de-passe", headers=ici, json={"actuel": MOT_DE_PASSE, "nouveau": "Automne2026x"})
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.get("/api/auth/moi", headers=autre_poste).status_code == 401
    assert client.get("/api/auth/moi", headers=ici).status_code == 401
    renouvelee = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/auth/moi", headers=renouvelee).status_code == 200


def test_reinitialisation_par_la_rh_ferme_les_sessions(client, entetes, db):
    session = connexion(client, "100281")
    employe = db.query(Employe).filter_by(matricule="100281").one()
    r = client.put(f"/api/administration/employes/{employe.id}", headers=entetes("ADMINRH"),
                   json={"mot_de_passe": "Provisoire9"})
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/moi", headers=session).status_code == 401


def test_seul_un_jeton_de_session_ouvre_l_api(client, db):
    employe = db.query(Employe).filter_by(matricule="100259").one()
    sans_type = jwt.encode({"sub": str(employe.id), "exp": datetime.utcnow() + timedelta(hours=1)},
                           JWT_SECRET, algorithm=JWT_ALGORITHM)
    assert client.get("/api/auth/moi", headers={"Authorization": f"Bearer {sans_type}"}).status_code == 401


# ---- Double authentification ------------------------------------------------------------------------
def test_code_de_double_authentification_a_usage_unique(client, db):
    employe = db.query(Employe).filter_by(matricule="100259").one()
    secret = totp.nouveau_secret()
    employe.totp_secret, employe.totp_active = secret, True
    db.commit()

    def etape():
        r = client.post("/api/auth/login", json={"matricule": "100259", "mot_de_passe": MOT_DE_PASSE}).json()
        return r["jeton_etape"]

    code = totp.code(secret)
    assert client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape(), "code": code}).status_code == 200
    rejeu = client.post("/api/auth/2fa/verifier", json={"jeton_etape": etape(), "code": code})
    assert rejeu.status_code == 401 and "déjà utilisé" in rejeu.json()["detail"]


def test_code_suivant_accepte_apres_usage():
    class Compte:
        totp_secret, totp_dernier_pas = totp.nouveau_secret(), None
    instant = 1_000_000.0
    assert totp.consommer(Compte, totp.code(Compte.totp_secret, instant), instant)
    assert not totp.consommer(Compte, totp.code(Compte.totp_secret, instant), instant)
    suivant = instant + totp.PERIODE
    assert totp.consommer(Compte, totp.code(Compte.totp_secret, suivant), suivant)


# ---- Messagerie ---------------------------------------------------------------------------------------
def test_mot_de_passe_smtp_chiffre_en_base(client, entetes, db):
    r = client.put("/api/parametres/messagerie", headers=entetes("ADMINRH"), json={
        "actif": False, "serveur": "smtp.exemple.test", "utilisateur": "portail", "mot_de_passe": "Secret-SMTP-1"})
    assert r.status_code == 200 and r.json()["mot_de_passe"] == "••••••••"
    brut_en_base = db.get(Parametre, "messagerie")
    assert "Secret-SMTP-1" not in str(brut_en_base.valeur)
    assert emails.configuration(db)["mot_de_passe"] == "Secret-SMTP-1"
