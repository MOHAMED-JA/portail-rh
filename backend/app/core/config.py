"""Configuration centrale de l'application.

Tous les réglages propres à une installation se donnent par variables
d'environnement (serveur de la DSI) ; sans elles, le portail fonctionne comme
sur les postes de travail : base SQLite et fichiers dans ``backend/data``.

| Variable                | Rôle                                                   |
|-------------------------|--------------------------------------------------------|
| PORTAIL_RH_DATABASE_URL      | Base de données (SQLite par défaut, PostgreSQL en prod)|
| PORTAIL_RH_DATA_DIR          | Dossier des fichiers (téléversements, sauvegardes)     |
| PORTAIL_RH_SECRET            | Clé de signature des sessions et des liens e-mail      |
| PORTAIL_RH_TACHES_FOND       | « 0 » désactive les tâches automatiques (tests)        |
| PORTAIL_RH_ORIGINES          | Origines autorisées (CORS), séparées par des virgules  |
| PORTAIL_RH_HOTE / PORTAIL_RH_PORT | Adresse et port d'écoute (serveur.py)                  |
| PORTAIL_RH_DOUBLE_AUTH_RH    | « 0 » désactive l'obligation de double authentification|
| PORTAIL_RH_DOUBLE_AUTH_MATRICULES | Matricules soumis à la double authentification      |
| PORTAIL_RH_CLE_CHIFFREMENT   | Clé Fernet des données sensibles (sinon chiffrement.key)|
| PORTAIL_RH_DOSSIER_SECOURS   | Copies de secours hors OneDrive (défaut : LOCALAPPDATA) |
"""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.environ.get("PORTAIL_RH_DATA_DIR") or BASE_DIR / "data")
UPLOAD_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

# SQLite pour les postes de travail, PostgreSQL sur le serveur : le schéma
# SQLAlchemy est le même, seule l'adresse change.
DATABASE_URL = os.environ.get("PORTAIL_RH_DATABASE_URL", f"sqlite:///{DATA_DIR / 'portail.db'}")
EST_SQLITE = DATABASE_URL.startswith("sqlite")

# Copies de secours HORS OneDrive (disque du poste). Une instance de test
# (PORTAIL_RH_DATA_DIR fourni) garde les siennes dans son propre dossier, pour ne
# jamais mêler une base jetable aux copies du vrai portail.
if os.environ.get("PORTAIL_RH_DOSSIER_SECOURS"):
    DOSSIER_SECOURS = Path(os.environ["PORTAIL_RH_DOSSIER_SECOURS"])
elif os.environ.get("PORTAIL_RH_DATA_DIR"):
    DOSSIER_SECOURS = DATA_DIR / "secours"
else:
    DOSSIER_SECOURS = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share") / "Portail-RH" / "secours"


def _secret() -> str:
    """Clé de signature : variable d'environnement sur le serveur ; sinon une
    clé aléatoire propre à l'installation, créée une fois dans le dossier de
    données (partagée par les deux postes via OneDrive)."""
    if os.environ.get("PORTAIL_RH_SECRET"):
        return os.environ["PORTAIL_RH_SECRET"]
    fichier = DATA_DIR / "secret.key"
    if not fichier.exists():
        fichier.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return fichier.read_text(encoding="utf-8").strip()


JWT_SECRET = _secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 12

TACHES_DE_FOND = os.environ.get("PORTAIL_RH_TACHES_FOND", "1") != "0"
# Double authentification obligatoire uniquement pour les comptes nommés par
# l'administration RH (PORTAIL_RH_DOUBLE_AUTH_MATRICULES, vide par défaut) ;
# les autres comptes peuvent l'activer de façon facultative.
DOUBLE_AUTH_RH = os.environ.get("PORTAIL_RH_DOUBLE_AUTH_RH", "1") != "0"
MATRICULES_DOUBLE_AUTH = frozenset(
    matricule.strip().upper()
    for matricule in os.environ.get("PORTAIL_RH_DOUBLE_AUTH_MATRICULES", "").split(",")
    if matricule.strip()
)
ORIGINES = [o.strip() for o in os.environ.get("PORTAIL_RH_ORIGINES", "*").split(",") if o.strip()]

APP_NAME = "Portail RH — Plateforme Ressources Humaines"
APP_VERSION = "1.0.0"

# Fiche d'évaluation : part de chaque bloc dans la note finale sur 20.
# La note des objectifs est la moyenne des notes pondérée par les objectifs ;
# la note de comportement est saisie par l'administration RH.
PART_OBJECTIFS = 80
PART_COMPORTEMENT = 20

# Pièces jointes acceptées (bouton « Parcourir ») : PDF et Word uniquement.
EXTENSIONS_AUTORISEES = {".pdf", ".doc", ".docx"}
