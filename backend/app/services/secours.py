"""Copie de secours hors OneDrive, avec restauration testée.

La base, ses sauvegardes quotidiennes et les deux clés vivent dans le même
dossier synchronisé : une suppression malencontreuse (ou un conflit OneDrive)
les emporterait ensemble. Chaque jour, une archive complète est donc déposée
HORS OneDrive, sur le disque du poste (``%LOCALAPPDATA%\\Portail-RH\\secours``
par défaut, ou ``PORTAIL_RH_DOSSIER_SECOURS``) :

- ``portail.db`` : copie cohérente de la base (API de sauvegarde SQLite) ;
- tout le dossier de données (pièces jointes, clés, plans d'organisation…),
  sauf les bases et les sauvegardes locales ;
- ``manifeste.json`` : version, poste, date, empreinte SHA-256 de chaque fichier.

Chaque archive est aussitôt restaurée à blanc dans un dossier temporaire :
empreintes, ``PRAGMA integrity_check``, présence du personnel et relecture des
données chiffrées avec la clé archivée. Le résultat est écrit à côté de
l'archive (``.controle.json``) et remonte dans la supervision.

La restauration réelle passe par ``outils/restaurer_secours.py`` (serveur arrêté,
archive de l'état courant avant toute écriture).
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import APP_VERSION, DATA_DIR, DATABASE_URL, DOSSIER_SECOURS
from app.services.chiffrement import PREFIXE

CONSERVATION = 30               # archives quotidiennes conservées
CONSERVATION_AVANT_RESTAURATION = 10
PREFIXE_QUOTIDIEN = "portail-secours"
PREFIXE_AVANT_RESTAURATION = "portail-avant-restauration"
EXCLUS_RACINE = {"sauvegardes", "__pycache__"}
SUFFIXES_BASE = (".db", ".db-journal", ".db-wal", ".db-shm")


def base_sqlite() -> Path | None:
    if not DATABASE_URL.startswith("sqlite:///"):
        return None
    return Path(DATABASE_URL.replace("sqlite:///", "", 1))


def dans_onedrive(chemin: Path) -> bool:
    """Vrai si le dossier est synchronisé par OneDrive (ce qu'on veut éviter)."""
    chemin = Path(chemin).resolve()
    racines = [os.environ.get(v) for v in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer")]
    for racine in filter(None, racines):
        try:
            chemin.relative_to(Path(racine).resolve())
            return True
        except ValueError:
            pass
    return any(partie.lower().startswith("onedrive") for partie in chemin.parts)


def _empreinte(chemin: Path) -> str:
    h = hashlib.sha256()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def _fichiers_donnees(dossier_donnees: Path, dossier_secours: Path) -> list[Path]:
    fichiers = []
    for chemin in sorted(dossier_donnees.rglob("*")):
        if not chemin.is_file():
            continue
        relatif = chemin.relative_to(dossier_donnees)
        if relatif.parts[0] in EXCLUS_RACINE or chemin.name.endswith(SUFFIXES_BASE):
            continue
        try:
            chemin.relative_to(dossier_secours)
            continue   # le dossier de secours ne s'archive pas lui-même
        except ValueError:
            pass
        fichiers.append(chemin)
    return fichiers


def creer_archive(prefixe: str = PREFIXE_QUOTIDIEN, *, base: Path | None = None,
                  dossier_donnees: Path | None = None, dossier_secours: Path | None = None) -> Path:
    """Crée une archive complète de l'état courant et la purge au-delà de la conservation."""
    base = Path(base) if base else base_sqlite()
    if base is None:
        raise RuntimeError("Copie de secours sans objet : la base PostgreSQL est sauvegardée par la DSI.")
    if not base.exists():
        raise FileNotFoundError(f"Base introuvable : {base}")
    dossier_donnees = Path(dossier_donnees or DATA_DIR)
    dossier_secours = Path(dossier_secours or DOSSIER_SECOURS)
    dossier_secours.mkdir(parents=True, exist_ok=True)
    maintenant = datetime.now()
    cible = dossier_secours / f"{prefixe}-{maintenant:%Y%m%d-%H%M%S}.zip"
    n = 1
    while cible.exists():
        n += 1
        cible = dossier_secours / f"{prefixe}-{maintenant:%Y%m%d-%H%M%S}-{n}.zip"

    with tempfile.TemporaryDirectory(prefix="portail-secours-") as temporaire:
        copie = Path(temporaire) / "portail.db"
        with sqlite3.connect(str(base)) as origine, sqlite3.connect(str(copie)) as destination:
            origine.backup(destination)
        # Fermeture explicite : sous Windows, un fichier ouvert ne se supprime pas.
        origine.close()
        destination.close()
        contenu = {"portail.db": copie}
        for chemin in _fichiers_donnees(dossier_donnees, dossier_secours):
            contenu["donnees/" + chemin.relative_to(dossier_donnees).as_posix()] = chemin
        manifeste = {
            "application": "Portail RH", "version": APP_VERSION, "cree_le": maintenant.isoformat(timespec="seconds"),
            "poste": socket.gethostname(), "base_source": str(base),
            "cle_chiffrement": "variable d'environnement (à conserver par la DSI)"
            if os.environ.get("PORTAIL_RH_CLE_CHIFFREMENT") else "donnees/chiffrement.key",
            "fichiers": {nom: {"sha256": _empreinte(chemin), "octets": chemin.stat().st_size}
                         for nom, chemin in contenu.items()},
        }
        partiel = cible.with_suffix(".zip.partiel")
        with zipfile.ZipFile(partiel, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for nom, chemin in contenu.items():
                archive.write(chemin, nom)
            archive.writestr("manifeste.json", json.dumps(manifeste, ensure_ascii=False, indent=2))
        os.replace(partiel, cible)
    purger(dossier_secours)
    return cible


def _archives(dossier: Path, prefixe: str) -> list[Path]:
    # Par date de création : deux archives de la même seconde (suffixe « -2 »)
    # seraient mal classées par leur seul nom.
    return sorted(Path(dossier).glob(f"{prefixe}-*.zip"), key=lambda f: (f.stat().st_mtime_ns, f.name))


def purger(dossier_secours: Path | None = None) -> None:
    dossier_secours = Path(dossier_secours or DOSSIER_SECOURS)
    for prefixe, garder in ((PREFIXE_QUOTIDIEN, CONSERVATION),
                            (PREFIXE_AVANT_RESTAURATION, CONSERVATION_AVANT_RESTAURATION)):
        for ancienne in _archives(dossier_secours, prefixe)[:-garder]:
            ancienne.unlink(missing_ok=True)
            _chemin_controle(ancienne).unlink(missing_ok=True)


def _chemin_controle(archive: Path) -> Path:
    return archive.with_name(archive.stem + ".controle.json")


def _colonnes_chiffrees() -> list[tuple[str, str]]:
    from app.core.database import Base
    from app.services.chiffrement import TexteChiffre

    return [(table.name, colonne.name) for table in Base.metadata.sorted_tables
            for colonne in table.columns if isinstance(colonne.type, TexteChiffre)]


def _extraire(archive: zipfile.ZipFile, dossier: Path) -> None:
    racine = dossier.resolve()
    for nom in archive.namelist():
        cible = (dossier / nom).resolve()
        if racine not in cible.parents:
            raise ValueError(f"Chemin refusé dans l'archive : {nom}")
    archive.extractall(dossier)


def controler_archive(chemin: Path, *, enregistrer: bool = True) -> dict:
    """Restauration à blanc : l'archive permet-elle vraiment de repartir ?"""
    chemin = Path(chemin)
    points: list[dict] = []

    def point(libelle: str, ok: bool, detail: str = "") -> bool:
        points.append({"controle": libelle, "ok": ok, "detail": detail})
        return ok

    resume: dict = {}
    try:
        with tempfile.TemporaryDirectory(prefix="portail-restauration-") as temporaire:
            dossier = Path(temporaire)
            with zipfile.ZipFile(chemin) as archive:
                _extraire(archive, dossier)
            manifeste = json.loads((dossier / "manifeste.json").read_text(encoding="utf-8"))
            resume = {"version": manifeste.get("version"), "poste": manifeste.get("poste"),
                      "cree_le": manifeste.get("cree_le")}
            abimes = [nom for nom, info in manifeste["fichiers"].items()
                      if not (dossier / nom).is_file() or _empreinte(dossier / nom) != info["sha256"]]
            point("Empreintes des fichiers", not abimes,
                  f"{len(manifeste['fichiers'])} fichier(s) vérifié(s)" if not abimes
                  else f"Fichier(s) abîmé(s) ou absent(s) : {', '.join(abimes[:5])}")

            base = dossier / "portail.db"
            with sqlite3.connect(str(base)) as connexion:
                integrite = connexion.execute("PRAGMA integrity_check").fetchone()[0]
                point("Intégrité de la base", integrite == "ok", integrite)
                employes = connexion.execute("select count(*) from employes").fetchone()[0]
                resume["employes"] = employes
                point("Personnel présent", employes > 0, f"{employes} compte(s)")
                valeurs = []
                for table, colonne in _colonnes_chiffrees():
                    try:
                        ligne = connexion.execute(
                            f'select "{colonne}" from "{table}" where "{colonne}" like ? limit 1',
                            (PREFIXE + "%",)).fetchone()
                    except sqlite3.OperationalError:
                        continue   # table absente d'une ancienne version
                    if ligne:
                        valeurs.append(ligne[0])
            connexion.close()

            fichier_cle = dossier / "donnees" / "chiffrement.key"
            if fichier_cle.is_file():
                cle = fichier_cle.read_bytes().strip()
            elif os.environ.get("PORTAIL_RH_CLE_CHIFFREMENT"):
                cle = os.environ["PORTAIL_RH_CLE_CHIFFREMENT"].encode()
            else:
                cle = None
            if not valeurs:
                point("Données chiffrées relisibles", True, "Aucune donnée chiffrée à relire")
            elif cle is None:
                point("Données chiffrées relisibles", False, "Clé de chiffrement absente de l'archive")
            else:
                try:
                    fernet = Fernet(cle)
                    for valeur in valeurs:
                        fernet.decrypt(valeur[len(PREFIXE):].encode("ascii"))
                    point("Données chiffrées relisibles", True, f"{len(valeurs)} colonne(s) relue(s) avec la clé archivée")
                except (InvalidToken, ValueError):
                    point("Données chiffrées relisibles", False, "La clé archivée ne déchiffre pas les données")
            point("Clé de signature des sessions", (dossier / "donnees" / "secret.key").is_file()
                  or bool(os.environ.get("PORTAIL_RH_SECRET")),
                  "présente" if (dossier / "donnees" / "secret.key").is_file() else "variable d'environnement")
            resume["pieces_jointes"] = sum(1 for nom in manifeste["fichiers"] if nom.startswith("donnees/uploads/"))
    except Exception as erreur:  # noqa: BLE001 — une archive illisible est un résultat, pas un plantage
        point("Lecture de l'archive", False, f"{type(erreur).__name__} : {erreur}")

    rapport = {
        "archive": chemin.name, "controle_le": datetime.now().isoformat(timespec="seconds"),
        "statut": "ok" if all(p["ok"] for p in points) else "erreur", "points": points, **resume,
    }
    if enregistrer and chemin.exists():
        _chemin_controle(chemin).write_text(json.dumps(rapport, ensure_ascii=False, indent=2), encoding="utf-8")
    return rapport


def sauvegarder_et_controler() -> dict:
    archive = creer_archive()
    rapport = controler_archive(archive)
    return {**rapport, "dossier": str(DOSSIER_SECOURS),
            "taille_ko": round(archive.stat().st_size / 1024)}


def etat() -> dict:
    """Résumé pour la supervision."""
    dossier = Path(DOSSIER_SECOURS)
    if base_sqlite() is None:
        return {"statut": "a_configurer", "dossier": str(dossier), "archives": 0,
                "message": "Base PostgreSQL : la copie de secours relève de la DSI."}
    hors_onedrive = not dans_onedrive(dossier)
    archives = _archives(dossier, PREFIXE_QUOTIDIEN) if dossier.exists() else []
    resultat = {"dossier": str(dossier), "hors_onedrive": hors_onedrive, "archives": len(archives),
                "conservation": CONSERVATION}
    if not archives:
        return {**resultat, "statut": "absente", "message": "Aucune copie de secours hors OneDrive pour l'instant."}
    derniere = archives[-1]
    age = (datetime.now() - datetime.fromtimestamp(derniere.stat().st_mtime)).total_seconds() / 3600
    controle = None
    if _chemin_controle(derniere).is_file():
        controle = json.loads(_chemin_controle(derniere).read_text(encoding="utf-8"))
    ok = hors_onedrive and age <= 48 and controle is not None and controle["statut"] == "ok"
    if not hors_onedrive:
        message = "Le dossier de secours est dans OneDrive : il ne protège pas d'une suppression synchronisée."
    elif controle is None:
        message = "La dernière copie n'a pas encore été restaurée à blanc."
    elif controle["statut"] != "ok":
        message = "La dernière copie n'a pas passé le test de restauration."
    elif age > 48:
        message = "Aucune copie de secours depuis plus de 48 h."
    else:
        message = "Dernière copie restaurée à blanc avec succès."
    return {**resultat, "statut": "ok" if ok else "alerte", "message": message,
            "derniere": {"nom": derniere.name, "taille_ko": round(derniere.stat().st_size / 1024),
                         "le": datetime.fromtimestamp(derniere.stat().st_mtime).isoformat(timespec="seconds"),
                         "age_heures": round(age, 1)},
            "controle": controle}


def restaurer(chemin: Path, *, base: Path | None = None, dossier_donnees: Path | None = None,
              dossier_secours: Path | None = None) -> dict:
    """Remet en place la base et les fichiers d'une archive contrôlée.

    Le serveur doit être arrêté (l'appelant le vérifie). L'état courant est
    d'abord archivé : une restauration se défait en restaurant cette archive.
    Aucun fichier n'est supprimé ; ceux de l'archive écrasent leurs homonymes.
    """
    chemin = Path(chemin)
    base = Path(base) if base else base_sqlite()
    if base is None:
        raise RuntimeError("Restauration sans objet : la base PostgreSQL est restaurée par la DSI.")
    dossier_donnees = Path(dossier_donnees or DATA_DIR)
    controle = controler_archive(chemin, enregistrer=False)
    if controle["statut"] != "ok":
        raise ValueError("Archive refusée : elle ne passe pas le test de restauration.")
    avant = creer_archive(PREFIXE_AVANT_RESTAURATION, base=base, dossier_donnees=dossier_donnees,
                          dossier_secours=dossier_secours) if base.exists() else None
    fichiers = 0
    with zipfile.ZipFile(chemin) as archive, tempfile.TemporaryDirectory(prefix="portail-restauration-") as temporaire:
        _extraire(archive, Path(temporaire))
        for source in Path(temporaire, "donnees").rglob("*"):
            if source.is_file():
                cible = dossier_donnees / source.relative_to(Path(temporaire, "donnees"))
                cible.parent.mkdir(parents=True, exist_ok=True)
                cible.write_bytes(source.read_bytes())
                fichiers += 1
        provisoire = base.with_name(base.name + ".restauration")
        provisoire.write_bytes(Path(temporaire, "portail.db").read_bytes())
        for suffixe in ("-journal", "-wal", "-shm"):
            Path(str(base) + suffixe).unlink(missing_ok=True)
        os.replace(provisoire, base)
    with sqlite3.connect(str(base)) as connexion:
        integrite = connexion.execute("PRAGMA integrity_check").fetchone()[0]
    connexion.close()
    return {"archive": chemin.name, "base": str(base), "fichiers_restaures": fichiers,
            "integrite": integrite, "etat_precedent": avant.name if avant else None,
            "employes": controle.get("employes")}
