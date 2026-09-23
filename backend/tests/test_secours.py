"""Copie de secours hors OneDrive : archive complète, restauration à blanc,
restauration réelle et supervision."""
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from app.core.config import DATA_DIR
from app.models import Employe, JournalAudit
from app.services import secours

pytestmark = pytest.mark.skipif(secours.base_sqlite() is None, reason="copie de secours propre à SQLite")


def _preparer(db) -> None:
    """Une donnée chiffrée et une pièce jointe, pour que le test porte sur du réel."""
    employe = db.query(Employe).filter_by(matricule="100259").one()
    employe.totp_secret = "SECRET-DE-TEST"
    db.commit()
    (DATA_DIR / "uploads").mkdir(exist_ok=True)
    (DATA_DIR / "uploads" / "piece-test-secours.pdf").write_bytes(b"%PDF-1.4 piece de test")


def _reecrire(archive: Path, nom: str, contenu: bytes) -> None:
    """Remplace un fichier dans une archive sans toucher au manifeste."""
    with zipfile.ZipFile(archive) as source:
        elements = {n: source.read(n) for n in source.namelist()}
    elements[nom] = contenu
    with zipfile.ZipFile(archive, "w") as cible:
        for n, octets in elements.items():
            cible.writestr(n, octets)


def test_archive_complete_et_restauration_a_blanc(db, tmp_path):
    _preparer(db)
    archive = secours.creer_archive(dossier_secours=tmp_path)
    with zipfile.ZipFile(archive) as z:
        noms = set(z.namelist())
        manifeste = json.loads(z.read("manifeste.json"))
    # secret.key : absente ici (PORTAIL_RH_SECRET fourni par conftest), archivée sur les postes.
    assert {"portail.db", "manifeste.json", "donnees/chiffrement.key",
            "donnees/uploads/piece-test-secours.pdf"} <= noms
    assert not any(n.endswith(".db") and n != "portail.db" for n in noms)     # ni tests.db ni sauvegardes
    assert not any(n.startswith("donnees/secours/") for n in noms)
    assert manifeste["fichiers"]["portail.db"]["sha256"]

    rapport = secours.controler_archive(archive)
    assert rapport["statut"] == "ok", rapport["points"]
    assert rapport["employes"] >= 4 and rapport["pieces_jointes"] >= 1
    dechiffrement = next(p for p in rapport["points"] if p["controle"] == "Données chiffrées relisibles")
    assert "relue" in dechiffrement["detail"]
    assert (tmp_path / (archive.stem + ".controle.json")).is_file()


def test_archive_abimee_ou_mauvaise_cle_refusee(db, tmp_path):
    _preparer(db)
    abimee = secours.creer_archive(dossier_secours=tmp_path)
    _reecrire(abimee, "donnees/uploads/piece-test-secours.pdf", b"contenu altere")
    rapport = secours.controler_archive(abimee)
    assert rapport["statut"] == "erreur"
    assert not next(p for p in rapport["points"] if p["controle"] == "Empreintes des fichiers")["ok"]

    # Une clé qui ne correspond pas à la base : l'archive ne permettrait pas de
    # relire les données de santé et de sanction, elle doit être signalée.
    mauvaise = secours.creer_archive(dossier_secours=tmp_path)
    nouvelle_cle = Fernet.generate_key()
    _reecrire(mauvaise, "donnees/chiffrement.key", nouvelle_cle)
    with zipfile.ZipFile(mauvaise) as z:
        manifeste = json.loads(z.read("manifeste.json"))
    import hashlib
    manifeste["fichiers"]["donnees/chiffrement.key"]["sha256"] = hashlib.sha256(nouvelle_cle).hexdigest()
    _reecrire(mauvaise, "manifeste.json", json.dumps(manifeste).encode())
    rapport = secours.controler_archive(mauvaise)
    assert rapport["statut"] == "erreur"
    point = next(p for p in rapport["points"] if p["controle"] == "Données chiffrées relisibles")
    assert not point["ok"] and "ne déchiffre pas" in point["detail"]

    with pytest.raises(ValueError):
        secours.restaurer(mauvaise, base=tmp_path / "cible.db", dossier_donnees=tmp_path / "donnees",
                          dossier_secours=tmp_path)


def test_restauration_reelle_archive_l_etat_precedent(db, tmp_path):
    _preparer(db)
    archive = secours.creer_archive(dossier_secours=tmp_path / "secours")

    # Poste sinistré : une base vide et un dossier de données sans pièces jointes.
    donnees = tmp_path / "donnees"
    donnees.mkdir()
    base = donnees / "portail.db"
    with sqlite3.connect(str(base)) as c:
        c.execute("create table employes (id integer)")
    c.close()

    resultat = secours.restaurer(archive, base=base, dossier_donnees=donnees, dossier_secours=tmp_path / "secours")
    assert resultat["integrite"] == "ok"
    assert resultat["etat_precedent"].startswith(secours.PREFIXE_AVANT_RESTAURATION)
    assert (donnees / "uploads" / "piece-test-secours.pdf").read_bytes() == b"%PDF-1.4 piece de test"
    assert (donnees / "chiffrement.key").read_bytes() == (DATA_DIR / "chiffrement.key").read_bytes()
    with sqlite3.connect(str(base)) as c:
        assert c.execute("select count(*) from employes where matricule = '100259'").fetchone()[0] == 1
    c.close()
    # L'état d'avant est lui-même une archive contrôlable : la restauration se défait.
    avant = tmp_path / "secours" / resultat["etat_precedent"]
    assert avant.is_file()


def test_conservation_limitee(db, tmp_path, monkeypatch):
    monkeypatch.setattr(secours, "CONSERVATION", 2)
    archives = [secours.creer_archive(dossier_secours=tmp_path) for _ in range(4)]
    for archive in archives:
        secours.controler_archive(archive)
    secours.purger(tmp_path)
    assert set(tmp_path.glob("portail-secours-*.zip")) == set(archives[-2:])
    assert len(list(tmp_path.glob("*.controle.json"))) == 2


def test_dossier_dans_onedrive_signale(tmp_path, monkeypatch):
    assert secours.dans_onedrive(Path(r"C:\Users\x\OneDrive - Exemple\Portail-RH\secours"))
    monkeypatch.setenv("OneDrive", str(tmp_path / "Nuage"))
    assert secours.dans_onedrive(tmp_path / "Nuage" / "secours")
    assert not secours.dans_onedrive(tmp_path / "Local" / "secours")


def test_api_copie_de_secours_reservee_et_supervisee(client, entetes, db):
    assert client.post("/api/supervision/secours", headers=entetes("100259")).status_code == 403
    r = client.post("/api/supervision/secours", headers=entetes("ADMINRH"))
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["rapport"]["statut"] == "ok"
    assert corps["statut"] == "ok" and corps["hors_onedrive"] is True
    assert db.query(JournalAudit).filter_by(action="copie_de_secours").count() == 1

    tableau = client.get("/api/supervision", headers=entetes("ADMINRH")).json()
    assert tableau["secours"]["derniere"]["nom"] == corps["rapport"]["archive"]
    assert tableau["secours"]["controle"]["statut"] == "ok"
