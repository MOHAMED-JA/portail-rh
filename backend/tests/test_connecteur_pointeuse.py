"""Connecteur de la pointeuse (outils/connecteur_pointeuse.py) : pointeuse Virdi UBio-X Pro."""
import configparser
import importlib.util
import sys
from datetime import datetime
from pathlib import Path

import pytest

CHEMIN = Path(__file__).resolve().parents[2] / "outils" / "connecteur_pointeuse.py"


@pytest.fixture()
def connecteur(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("connecteur_pointeuse_test", CHEMIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Jamais de fichier écrit à côté du vrai connecteur.
    monkeypatch.setattr(module, "CONFIG", tmp_path / "connecteur.ini")
    monkeypatch.setattr(module, "ETAT", tmp_path / "etat.json")
    return module


def section(**valeurs):
    config = configparser.ConfigParser(interpolation=None)
    config["fichier"] = {k: str(v) for k, v in valeurs.items()}
    return config["fichier"]


def test_modele_par_defaut_source_fichier(connecteur):
    config = configparser.ConfigParser(interpolation=None)
    config.read_string(connecteur.MODELE)
    assert config["source"]["type"] == "fichier"
    assert "Virdi UBio-X Pro" in connecteur.MODELE and config.has_section("virdi")


def test_export_date_et_heure_separees_format_de_la_virdi(connecteur, tmp_path):
    export = tmp_path / "export.csv"
    export.write_text("Badge;Date;Heure\n100259;2026.09.25;08:17:03\n100281;25/09/2026;16:58:00\n;;\n", encoding="cp1252")
    passages = connecteur.depuis_fichier(section(chemin=export, separateur=";", colonne_badge=1, colonne_horodatage=2,
                                                 colonne_heure=3, format="", encodage="cp1252"))
    assert passages == [("100259", datetime(2026, 9, 25, 8, 17, 3)), ("100281", datetime(2026, 9, 25, 16, 58))]


def test_export_horodatage_en_une_colonne_inchange(connecteur, tmp_path):
    export = tmp_path / "export.csv"
    export.write_text("1024;2026-09-25 08:05:00\n", encoding="utf-8")
    passages = connecteur.depuis_fichier(section(chemin=export, colonne_badge=1, colonne_horodatage=2))
    assert passages == [("1024", datetime(2026, 9, 25, 8, 5))]


def test_source_virdi_explique_la_marche_a_suivre(connecteur, monkeypatch):
    connecteur.CONFIG.write_text(connecteur.MODELE.replace("type = fichier", "type = virdi"), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["connecteur", "--test"])
    with pytest.raises(SystemExit) as fin:
        connecteur.main()
    assert "Virdi UBio-X Pro" in str(fin.value) and "type = fichier" in str(fin.value)


def test_source_inconnue_refusee(connecteur, monkeypatch):
    connecteur.CONFIG.write_text(connecteur.MODELE.replace("type = fichier", "type = anviz"), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["connecteur", "--test"])
    with pytest.raises(SystemExit) as fin:
        connecteur.main()
    assert "Source inconnue" in str(fin.value)
