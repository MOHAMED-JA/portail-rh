"""Recopie intégrale de la base du portail vers une autre base (SQLite →
PostgreSQL le jour de la mise en service sur le serveur).

Usage (depuis backend/) :
    python ..\\outils\\transferer_base.py  SOURCE  CIBLE
    python ..\\outils\\transferer_base.py  sqlite:///data/portail.db  postgresql+psycopg://rh:MOTDEPASSE@serveur/portail_rh

- La cible doit être vide : le script refuse d'écraser des données.
- Les références croisées (département ↔ responsable, collaborateur →
  supérieur) sont d'abord écrites vides puis complétées, pour satisfaire les
  contrôles d'intégrité de PostgreSQL.
- Les compteurs d'identifiants PostgreSQL sont recalés en fin de copie.
- Le nombre de lignes de chaque table est vérifié à la fin.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import create_engine, event, func, inspect, select, text  # noqa: E402

LOT = 500


def transferer(source_url: str, cible_url: str) -> dict[str, int]:
    from app.core.database import Base
    import app.models  # noqa: F401 — enregistre toutes les tables

    source = create_engine(source_url)
    cible = create_engine(cible_url)
    if cible.dialect.name == "sqlite":
        # Contrôles d'intégrité aussi stricts que PostgreSQL (désactivés par défaut en SQLite).
        event.listen(cible, "connect", lambda connexion, _: connexion.execute("PRAGMA foreign_keys=ON"))

    tables_existantes = set(inspect(cible).get_table_names())
    Base.metadata.create_all(cible)
    with cible.connect() as c:
        for table in Base.metadata.sorted_tables:
            if table.name in tables_existantes and c.execute(select(func.count()).select_from(table)).scalar():
                raise SystemExit(f"La table « {table.name} » de la base cible contient déjà des données : arrêt.")

    tables = Base.metadata.sorted_tables
    ordre = {t.name: i for i, t in enumerate(tables)}
    colonnes_source = {t: {c["name"] for c in inspect(source).get_columns(t)} for t in inspect(source).get_table_names()}
    differes: list[tuple] = []   # (table, colonne, [(id, valeur)])
    comptes: dict[str, int] = {}

    with source.connect() as lecture, cible.begin() as ecriture:
        for table in tables:
            if table.name not in colonnes_source:
                comptes[table.name] = 0
                continue
            # Colonnes qui pointent vers une table pas encore copiée (ou vers elle-même).
            a_differer = [col.name for col in table.columns for fk in col.foreign_keys
                          if ordre.get(fk.column.table.name, -1) >= ordre[table.name]]
            presentes = [c for c in table.columns if c.name in colonnes_source[table.name]]
            lignes = [dict(l._mapping) for l in lecture.execute(select(*presentes))]
            cle = list(table.primary_key.columns)[0].name
            for nom in a_differer:
                valeurs = [(l[cle], l[nom]) for l in lignes if l.get(nom) is not None]
                if valeurs:
                    differes.append((table, nom, valeurs))
                for l in lignes:
                    l[nom] = None
            for i in range(0, len(lignes), LOT):
                ecriture.execute(table.insert(), lignes[i:i + LOT])
            comptes[table.name] = len(lignes)

        for table, nom, valeurs in differes:
            for identifiant, valeur in valeurs:
                cle = list(table.primary_key.columns)[0]
                ecriture.execute(table.update().where(cle == identifiant).values({nom: valeur}))

        if cible.dialect.name == "postgresql":
            for table in tables:
                if "id" in table.c and table.c.id.autoincrement:
                    ecriture.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"))

    with cible.connect() as c:
        for table in tables:
            obtenu = c.execute(select(func.count()).select_from(table)).scalar()
            if obtenu != comptes[table.name]:
                raise SystemExit(f"Écart sur « {table.name} » : {comptes[table.name]} lue(s), {obtenu} écrite(s).")
    source.dispose()
    cible.dispose()
    return comptes


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(1)
    resultat = transferer(sys.argv[1], sys.argv[2])
    print(f"Transfert terminé : {sum(resultat.values())} ligne(s) dans {len(resultat)} table(s).")
    for nom, n in resultat.items():
        if n:
            print(f"  {nom:<28} {n}")
