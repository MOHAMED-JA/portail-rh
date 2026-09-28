"""Préparation au serveur : configuration isolée, migrations compatibles PostgreSQL."""
from app.core import config, migrations


def test_les_tests_n_ecrivent_pas_dans_backend_data():
    assert "portail-tests-" in str(config.DATA_DIR)
    if config.DATABASE_URL.startswith("sqlite"):
        assert "portail-tests-" in config.DATABASE_URL
    else:
        assert config.DATABASE_URL.startswith("postgresql")
        assert "test" in config.DATABASE_URL.lower()
    assert config.TACHES_DE_FOND is False


def test_cle_de_signature_hors_du_code():
    assert config.JWT_SECRET == "cle-de-test"


def test_migrations_traduites_pour_postgresql(monkeypatch):
    monkeypatch.setattr(migrations.engine.dialect, "name", "postgresql")
    assert migrations._traduire("BOOLEAN NOT NULL DEFAULT 1") == "BOOLEAN NOT NULL DEFAULT TRUE"
    assert migrations._traduire("BOOLEAN NOT NULL DEFAULT 0") == "BOOLEAN NOT NULL DEFAULT FALSE"
    assert migrations._traduire("DATETIME") == "TIMESTAMP"
    assert migrations._traduire("FLOAT NOT NULL DEFAULT 0") == "DOUBLE PRECISION NOT NULL DEFAULT 0"
    assert migrations._traduire("INTEGER NOT NULL DEFAULT 0") == "INTEGER NOT NULL DEFAULT 0"


def test_migrations_inchangees_pour_sqlite(monkeypatch):
    monkeypatch.setattr(migrations.engine.dialect, "name", "sqlite")
    assert migrations._traduire("BOOLEAN NOT NULL DEFAULT 1") == "BOOLEAN NOT NULL DEFAULT 1"


def test_interface_revalidee_api_intacte(client, entetes):
    # Sans Cache-Control, le navigateur mélangeait anciens et nouveaux modules après une mise à jour.
    for chemin in ("/", "/sw.js", "/assets/js/01-outils-dates-formats-aleatoire-deterministe-icon.js", "/annuaire"):
        assert client.get(chemin).headers.get("cache-control") == "no-cache", chemin
    assert client.get("/api/sante").headers.get("cache-control") != "no-cache"
