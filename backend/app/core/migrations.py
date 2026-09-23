"""Migrations légères : ajoute aux tables existantes les colonnes introduites
par les nouvelles versions, sans toucher aux données (SQLite comme PostgreSQL)."""
from sqlalchemy import inspect, text

from app.core.database import engine

COLONNES = {
    "departements": [("parent_id", "INTEGER REFERENCES departements(id)")],
    "offres_internes": [("publication", "VARCHAR(20) NOT NULL DEFAULT 'interne'")],
    "demandes": [("derogation_rh", "BOOLEAN NOT NULL DEFAULT 0"), ("solde_insuffisant", "BOOLEAN NOT NULL DEFAULT 0")],
    "employes": [("motif_sortie", "VARCHAR(40)"), ("date_sortie", "DATE"), ("detail_sortie", "TEXT"),
                 ("reference_sortie", "VARCHAR(80)"), ("sortie_saisie_le", "DATETIME"),
                 ("doit_changer_mdp", "BOOLEAN NOT NULL DEFAULT 1"), ("echecs_connexion", "INTEGER NOT NULL DEFAULT 0"),
                 ("bloque_jusqu", "DATETIME"), ("niveau", "VARCHAR(30) NOT NULL DEFAULT 'collaborateur'"),
                 ("totp_secret", "TEXT"), ("totp_active", "BOOLEAN NOT NULL DEFAULT 0"), ("codes_secours", "TEXT")],
    "dossiers_employes": [("aptitude_medicale", "TEXT"), ("observations_medicales", "TEXT"),
                          ("adresse", "VARCHAR(255)"), ("code_postal", "VARCHAR(10)"), ("ville", "VARCHAR(80)"),
                          ("adresse_modifiee_le", "DATETIME")],
    "fiches_evaluation": [("formations_souhaitees", "TEXT"), ("plan_developpement", "TEXT"),
                          ("mobilite_type", "VARCHAR(30)"), ("mobilite_detail", "TEXT"),
                          ("pris_connaissance_le", "DATETIME"), ("commentaire_collaborateur", "TEXT")],
    "formations": [("cout", "FLOAT NOT NULL DEFAULT 0")],
}


def _traduire(definition: str) -> str:
    """Les définitions sont écrites pour SQLite ; PostgreSQL veut TIMESTAMP et
    des booléens TRUE / FALSE."""
    if engine.dialect.name != "postgresql":
        return definition
    d = definition.replace("DATETIME", "TIMESTAMP").replace("FLOAT", "DOUBLE PRECISION")
    if d.startswith("BOOLEAN"):
        d = d.replace("DEFAULT 0", "DEFAULT FALSE").replace("DEFAULT 1", "DEFAULT TRUE")
    return d


def appliquer() -> None:
    inspecteur = inspect(engine)
    tables = set(inspecteur.get_table_names())
    with engine.begin() as connexion:
        for table, colonnes in COLONNES.items():
            if table not in tables:
                continue
            existantes = {c["name"] for c in inspecteur.get_columns(table)}
            for nom, definition in colonnes:
                if nom not in existantes:
                    connexion.execute(text(f"ALTER TABLE {table} ADD COLUMN {nom} {_traduire(definition)}"))
