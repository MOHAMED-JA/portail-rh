"""Connecteur pointeuse → Portail RH (liaison directe, option 3).

Lit les passages de badge et les envoie au portail
(POST /api/pointeuse/passages). À planifier toutes les 5 minutes avec le
Planificateur de tâches Windows. Chaque passage n'est envoyé qu'une fois :
le dernier horodatage transmis est mémorisé, et le portail ignore de toute
façon les doublons.

Pointeuse de Veltaris : Virdi UBio-X Pro (Union Community ; visage,
empreinte, carte), constatée sur photo le 25/09/2026. Ce n'est pas une
ZKTeco : la lecture réseau « zkteco » ne s'applique pas à elle.

Sources au choix :

  fichier  (par défaut, à utiliser pour la Virdi) Fichier exporté par le
           logiciel de la pointeuse (CSV ou TXT) : une ligne par passage,
           « badge ou matricule ; date heure », ou date et heure dans deux
           colonnes distinctes (colonne_heure).
  virdi    Lecture directe de la Virdi : pas encore branchée. Il faut
           d'abord identifier le logiciel qui récupère les pointages (le
           plus souvent Virdi UNIS, base Access ou SQL Server) ; en attendant,
           utiliser « fichier ».
  zkteco   Pointeuse ZKTeco (et compatibles, protocole réseau port 4370),
           pour un autre modèle. Nécessite :  pip install pyzk

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
adresse = http://127.0.0.1:8100
cle =

[source]
; fichier (pointeuse Virdi UBio-X Pro : export du logiciel), virdi (à venir) ou zkteco
type = fichier
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
; si l'heure est dans une colonne à part (ex. 25/09/2026;08:17:03) : son numéro
colonne_heure =
; laisser vide pour essayer les formats courants (dont 2026.09.25 08:17:03)
format =
; utf-8-sig (défaut), cp1252 ou utf-16 selon le logiciel d'export
encodage = utf-8-sig

[virdi]
; réservé à la lecture directe de la Virdi UBio-X Pro, une fois le logiciel identifié
"""
FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y/%m/%d %H:%M:%S",
           "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%d-%m-%Y %H:%M:%S", "%d.%m.%Y %H:%M:%S",
           "%Y%m%d %H%M%S", "%Y%m%d%H%M%S")
SOURCES = ("fichier", "virdi", "zkteco")


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


def depuis_virdi(section) -> list[tuple[str, datetime]]:
    sys.exit("Lecture directe de la pointeuse Virdi UBio-X Pro : pas encore disponible.\n"
             "Il faut d'abord identifier le logiciel qui récupère ses pointages (souvent Virdi UNIS).\n"
             "En attendant : exportez les passages depuis ce logiciel en CSV, puis dans\n"
             f"{CONFIG.name}, mettez  type = fichier  et le chemin de l'export dans [fichier].")


def _entier(section, cle: str, defaut: int | None) -> int | None:
    valeur = (section.get(cle) or "").strip()
    return int(valeur) if valeur else defaut


def depuis_fichier(section) -> list[tuple[str, datetime]]:
    chemin = Path(section.get("chemin"))
    if not chemin.exists():
        sys.exit(f"Fichier introuvable : {chemin}")
    col_badge = _entier(section, "colonne_badge", 1) - 1
    col_date = _entier(section, "colonne_horodatage", 2) - 1
    col_heure = _entier(section, "colonne_heure", None)
    col_heure = None if col_heure is None else col_heure - 1
    formats = tuple(f for f in ((section.get("format") or "").strip(),) if f) + FORMATS
    utiles = max(c for c in (col_badge, col_date, col_heure) if c is not None)
    passages = []
    with chemin.open(encoding=(section.get("encodage") or "utf-8-sig").strip(), errors="replace", newline="") as flux:
        for ligne in csv.reader(flux, delimiter=section.get("separateur", ";") or ";"):
            if len(ligne) <= utiles or not ligne[col_badge].strip():
                continue  # ligne d'en-tête, vide ou incomplète
            texte = ligne[col_date].strip()
            if col_heure is not None:
                texte = f"{texte} {ligne[col_heure].strip()}"
            for fmt in formats:
                try:
                    passages.append((ligne[col_badge].strip(), datetime.strptime(texte, fmt)))
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
    source = config["source"].get("type", "fichier").strip().lower()
    terminal = config["source"].get("terminal", "Pointeuse")
    if source not in SOURCES:
        sys.exit(f"Source inconnue « {source} » : choisissez {', '.join(SOURCES)} dans [source] type.")
    if source == "virdi":
        passages = depuis_virdi(config["virdi"] if config.has_section("virdi") else {})
    elif source == "zkteco":
        passages = depuis_zkteco(config["zkteco"])
    else:
        passages = depuis_fichier(config["fichier"])

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
            resultat = envoyer(config["portail"].get("adresse", "http://127.0.0.1:8100"), cle, lot)
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
