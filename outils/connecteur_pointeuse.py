"""Connecteur pointeuse → Portail RH (liaison directe, option 3).

Lit les passages de badge et les envoie au portail
(POST /api/pointeuse/passages). À planifier toutes les 5 minutes avec le
Planificateur de tâches Windows. Chaque passage n'est envoyé qu'une fois :
le dernier horodatage transmis est mémorisé, et le portail ignore de toute
façon les doublons.

Deux sources au choix :

  zkteco   Pointeuse ZKTeco (et compatibles, protocole réseau port 4370),
           lue directement sur le réseau. Nécessite :  pip install pyzk
  fichier  Fichier exporté par le logiciel de la pointeuse (CSV ou TXT) :
           une ligne par passage « badge ou matricule ; date heure ».

Configuration : fichier connecteur_pointeuse.ini à côté de ce script
(créé au premier lancement avec des valeurs à compléter).

Usage :  python outils/connecteur_pointeuse.py            (une synchronisation)
         python outils/connecteur_pointeuse.py --test     (affiche sans envoyer)
"""
from __future__ import annotations

import argparse
import configparser
import csv
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ICI = Path(__file__).resolve().parent
CONFIG = ICI / "connecteur_pointeuse.ini"
ETAT = ICI / "connecteur_pointeuse.etat.json"
MODELE = """[portail]
; Adresse du portail et clé (Paramètres RH → Pointeuse → Copier)
adresse = http://127.0.0.1:8000
cle =

[source]
; zkteco ou fichier
type = zkteco
; nom affiché dans le portail
terminal = Pointeuse principale

[zkteco]
ip = 192.168.1.201
port = 4370
; mot de passe de communication de la pointeuse (0 par défaut)
mot_de_passe = 0

[fichier]
; export du logiciel de la pointeuse : colonnes badge;date heure
chemin = C:\\Pointeuse\\export.csv
separateur = ;
colonne_badge = 1
colonne_horodatage = 2
format = %Y-%m-%d %H:%M:%S
"""
FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y/%m/%d %H:%M:%S")


def lire_config() -> configparser.ConfigParser:
    if not CONFIG.exists():
        CONFIG.write_text(MODELE, encoding="utf-8")
        sys.exit(f"Configuration créée : {CONFIG}\nComplétez l'adresse, la clé et la source, puis relancez.")
    config = configparser.ConfigParser(interpolation=None)   # « % » des formats de date
    config.read(CONFIG, encoding="utf-8")
    return config


def depuis_zkteco(section) -> list[tuple[str, datetime]]:
    try:
        from zk import ZK  # pyzk
    except ImportError:
        sys.exit("Module pyzk absent : installez-le avec  pip install pyzk")
    zk = ZK(section.get("ip"), port=section.getint("port", 4370), timeout=15,
            password=section.getint("mot_de_passe", 0), ommit_ping=True)
    connexion = zk.connect()
    try:
        connexion.disable_device()   # lecture cohérente, quelques secondes
        return [(str(p.user_id), p.timestamp) for p in connexion.get_attendance()]
    finally:
        connexion.enable_device()
        connexion.disconnect()


def depuis_fichier(section) -> list[tuple[str, datetime]]:
    chemin = Path(section.get("chemin"))
    if not chemin.exists():
        sys.exit(f"Fichier introuvable : {chemin}")
    col_badge = section.getint("colonne_badge", 1) - 1
    col_heure = section.getint("colonne_horodatage", 2) - 1
    formats = tuple(f for f in (section.get("format"),) if f) + FORMATS
    passages = []
    with chemin.open(encoding="utf-8-sig", errors="replace") as flux:
        for ligne in csv.reader(flux, delimiter=section.get("separateur", ";")):
            if len(ligne) <= max(col_badge, col_heure):
                continue
            for fmt in formats:
                try:
                    passages.append((ligne[col_badge].strip(), datetime.strptime(ligne[col_heure].strip(), fmt)))
                    break
                except (ValueError, TypeError):
                    continue
    return passages


def envoyer(adresse: str, cle: str, lot: list[dict]) -> dict:
    requete = urllib.request.Request(adresse.rstrip("/") + "/api/pointeuse/passages",
                                     data=json.dumps({"passages": lot}).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "X-Cle-Pointeuse": cle})
    with urllib.request.urlopen(requete, timeout=60) as reponse:
        return json.loads(reponse.read())


def main() -> int:
    arguments = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    arguments.add_argument("--test", action="store_true", help="affiche les passages sans les envoyer")
    arguments.add_argument("--tout", action="store_true", help="renvoie tout l'historique (les doublons sont ignorés)")
    options = arguments.parse_args()
    config = lire_config()
    source = config["source"].get("type", "zkteco").strip().lower()
    terminal = config["source"].get("terminal", "Pointeuse")
    passages = depuis_zkteco(config["zkteco"]) if source == "zkteco" else depuis_fichier(config["fichier"])

    dernier = None
    if ETAT.exists() and not options.tout:
        dernier = datetime.fromisoformat(json.loads(ETAT.read_text(encoding="utf-8"))["dernier"])
    nouveaux = sorted(((b, h) for b, h in passages if dernier is None or h > dernier), key=lambda x: x[1])
    print(f"{len(passages)} passage(s) lus, {len(nouveaux)} nouveau(x).")
    if options.test:
        for badge, heure in nouveaux[-20:]:
            print(f"  {badge:>10}  {heure:%d/%m/%Y %H:%M:%S}")
        return 0
    if not nouveaux:
        return 0
    cle = config["portail"].get("cle", "").strip()
    if not cle:
        sys.exit("Clé du portail manquante dans connecteur_pointeuse.ini")
    total = {"ajoutes": 0, "doublons": 0, "inconnus": set()}
    for i in range(0, len(nouveaux), 2000):
        lot = [{"badge": b, "horodatage": h.isoformat(), "terminal": terminal} for b, h in nouveaux[i:i + 2000]]
        try:
            resultat = envoyer(config["portail"].get("adresse", "http://127.0.0.1:8000"), cle, lot)
        except urllib.error.HTTPError as erreur:
            sys.exit(f"Refus du portail ({erreur.code}) : {erreur.read().decode('utf-8', 'replace')}")
        except urllib.error.URLError as erreur:
            sys.exit(f"Portail injoignable : {erreur.reason}. Le serveur est-il démarré ?")
        total["ajoutes"] += resultat["ajoutes"]
        total["doublons"] += resultat["doublons"]
        total["inconnus"].update(resultat["inconnus"])
    ETAT.write_text(json.dumps({"dernier": max(h for _, h in nouveaux).isoformat()}), encoding="utf-8")
    print(f"Envoyés : {total['ajoutes']} nouveau(x), {total['doublons']} déjà connu(s).")
    if total["inconnus"]:
        print(f"Badges sans collaborateur : {', '.join(sorted(total['inconnus']))} "
              "(renseignez la correspondance dans Paramètres RH → Pointeuse).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
