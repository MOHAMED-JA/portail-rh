"""Essayer le portail sur un téléphone, par le Wi-Fi de la maison.

Lance une **instance d'essai** du portail, visible des appareils du même réseau
Wi-Fi, sur le port 8002 — le portail habituel (port 8000) peut tourner à côté.
Deux modes :

``--reel``  **copie de la vraie base** : vrais noms, vrai organigramme, vos
            propres identifiants. Garde-fous :
            - c'est une **copie** : rien de ce qui est fait sur le téléphone ne
              touche la vraie base ;
            - les comptes qui ont encore le mot de passe **provisoire commun** sont
              **neutralisés dans la copie** : personne sur le Wi-Fi ne peut ouvrir
              le compte d'un collègue avec le mot de passe de l'import ;
            - la double authentification reste exigée comme en production ;
            - aucune tâche automatique (e-mails, sauvegardes, validations) ;
            - la copie est **effacée à l'arrêt**.
``--demo``  base de **démonstration** (personnel fictif) — par défaut.

Dans les deux cas la liaison est en ``http`` : non chiffrée sur le Wi-Fi. Pour
le mode réel, ne vous connectez qu'avec **votre propre compte**, sur le Wi-Fi de
la maison, jamais sur un réseau public.

Usage (depuis ``backend/``) :
    %PY% ..\\outils\\serveur_telephone.py [--reel | --demo] [--garder]

Au premier lancement, Windows demande d'autoriser Python sur le réseau : répondre
« Autoriser » pour les réseaux **privés** ; le Wi-Fi de la maison doit lui-même
être en profil « Privé ».
"""
import os
import secrets
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
BACKEND = RACINE / "backend"
VRAIE_BASE = BACKEND / "data" / "portail.db"
VRAIE_CLE = BACKEND / "data" / "chiffrement.key"
PORT = int(os.environ.get("PORTAIL_RH_PORT_TELEPHONE", "8002"))
# Hors OneDrive : la base d'essai ne doit jamais se synchroniser ni se mélanger
# à la vraie base.
DOSSIER = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Portail-RH" / "telephone"


# ------------------------------------------------------------------ Réseau
def _rang(ip: str) -> int:
    """Box de la maison d'abord ; 172.16–31 en dernier (souvent la carte
    virtuelle Hyper-V « vEthernet », injoignable depuis un téléphone)."""
    if ip.startswith("192.168."):
        return 0
    if ip.startswith("10."):
        return 1
    return 2


def adresses_locales() -> list[str]:
    """Toutes les adresses du poste sur un réseau local, la plus probable en tête.

    Une seule adresse devinée ne suffit pas : un VPN actif au lancement faisait
    afficher une adresse que le téléphone ne pouvait pas joindre."""
    adresses = {info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    utiles = [ip for ip in adresses if not ip.startswith(("127.", "169.254."))]
    return sorted(utiles, key=lambda ip: (_rang(ip), ip)) or ["127.0.0.1"]


def adresse_locale() -> str:
    return adresses_locales()[0]


# ------------------------------------------------------------------ Bases
def environnement(reel: bool = False) -> dict:
    dossier = DOSSIER / ("reel" if reel else "demo")
    dossier.mkdir(parents=True, exist_ok=True)
    base = dossier / ("copie-reelle.db" if reel else "essai-telephone.db")
    env = dict(os.environ)
    env.update({
        "PORTAIL_RH_DATA_DIR": str(dossier),
        "PORTAIL_RH_DATABASE_URL": "sqlite:///" + base.as_posix(),
        "PORTAIL_RH_HOTE": "0.0.0.0",
        "PORTAIL_RH_PORT": str(PORT),
        "PORTAIL_RH_TACHES_FOND": "0",
        "PYTHONIOENCODING": "utf-8",
    })
    if reel:
        # Même clé que la vraie base : sans elle, les champs chiffrés sont illisibles.
        if VRAIE_CLE.exists():
            env["PORTAIL_RH_CLE_CHIFFREMENT"] = VRAIE_CLE.read_text(encoding="utf-8").strip()
        env.pop("PORTAIL_RH_DOUBLE_AUTH_RH", None)          # double authentification active
    else:
        env["PORTAIL_RH_DOUBLE_AUTH_RH"] = "0"
    return env


def chemin_base(env: dict) -> Path:
    return Path(env["PORTAIL_RH_DATABASE_URL"].removeprefix("sqlite:///"))


def copier_vraie_base(cible: Path) -> int:
    """Copie cohérente de la vraie base (lecture seule), puis neutralisation des
    comptes restés sur le mot de passe provisoire commun. Rend leur nombre."""
    if not VRAIE_BASE.exists():
        raise SystemExit("Base réelle introuvable : lancez d'abord DEMARRER.bat.")
    cible.unlink(missing_ok=True)
    with sqlite3.connect(VRAIE_BASE.resolve().as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(str(cible)) as copie:
            source.backup(copie)

    from passlib.hash import bcrypt  # déjà installé avec le portail

    inutilisable = bcrypt.hash(secrets.token_urlsafe(32))   # secret jeté aussitôt
    with sqlite3.connect(str(cible)) as copie:
        n = copie.execute("UPDATE employes SET mot_de_passe_hash = ? WHERE doit_changer_mdp = 1",
                          (inutilisable,)).rowcount
        copie.commit()
    return n


def preparer(reel: bool, garder: bool, env: dict) -> int | None:
    base = chemin_base(env)
    if reel:
        print("Copie de la base réelle (lecture seule de l'originale)…")
        return copier_vraie_base(base)
    if not garder or not base.exists():
        print("Préparation de la base de démonstration (personnel fictif)…")
        subprocess.run([sys.executable, "-m", "app.seed", "--reset"], cwd=BACKEND, env=env, check=True)
    return None


# ------------------------------------------------------------------ Lancement
def afficher(reel: bool, neutralises: int | None) -> None:
    adresses = adresses_locales()
    trait = "=" * 66
    print(f"\n{trait}\n  Sur le téléphone (même Wi-Fi que ce poste), ouvrez Chrome :\n")
    print(f"      http://{adresses[0]}:{PORT}\n")
    if len(adresses) > 1:
        print("  Si la page ne s'ouvre pas, essayez :")
        for ip in adresses[1:]:
            print(f"      http://{ip}:{PORT}")
        print()
    if reel:
        print("  DONNÉES RÉELLES — copie de la base, effacée à l'arrêt.")
        print("  Connectez-vous avec VOTRE matricule et VOTRE mot de passe.")
        print(f"  {neutralises} compte(s) encore sur le mot de passe provisoire sont")
        print("  neutralisés dans cette copie : nul ne peut les ouvrir d'ici.")
        print("  Liaison non chiffrée : Wi-Fi de la maison uniquement.")
    else:
        print("  Comptes de démonstration (mot de passe : demo2026)")
        print("      VT0010  collaborateur")
        print("      VT0003  supérieur hiérarchique")
        print("      VT0002  administration RH")
        print("  Données fictives uniquement.")
    print("\n  Le téléphone n'y arrive pas ? Dans Windows, le Wi-Fi de la maison doit")
    print("  être en profil « Privé » : un réseau « Public » bloque les connexions.")
    print(f"\n  Ctrl + C pour arrêter.\n{trait}\n")


def main() -> None:
    reel = "--reel" in sys.argv
    env = environnement(reel)
    neutralises = preparer(reel, "--garder" in sys.argv, env)
    afficher(reel, neutralises)
    try:
        subprocess.run([sys.executable, "serveur.py"], cwd=BACKEND, env=env)
    except KeyboardInterrupt:
        pass
    finally:
        if reel:
            base = chemin_base(env)
            for fichier in (base, base.with_suffix(".db-wal"), base.with_suffix(".db-shm")):
                fichier.unlink(missing_ok=True)
            print("Copie de la base réelle effacée.")


if __name__ == "__main__":
    main()
