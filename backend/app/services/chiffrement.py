"""Chiffrement des données sensibles en base (santé, sanctions, secrets de
double authentification).

Algorithme : Fernet (AES-128-CBC + HMAC-SHA256, bibliothèque cryptography).
Clé : variable d'environnement PORTAIL_RH_CLE_CHIFFREMENT sur le serveur ; sinon
une clé générée une fois dans le dossier de données (chiffrement.key).

⚠ Sans la clé, les données chiffrées sont illisibles : elle doit être
sauvegardée À PART de la base (coffre-fort de la DSI). Une sauvegarde de la
base seule ne suffit pas à restaurer ces champs.
"""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import Text, TypeDecorator

from app.core.config import DATA_DIR

PREFIXE = "chiffre:"   # distingue une valeur chiffrée d'une ancienne valeur en clair


def _cle() -> bytes:
    if os.environ.get("PORTAIL_RH_CLE_CHIFFREMENT"):
        return os.environ["PORTAIL_RH_CLE_CHIFFREMENT"].encode()
    fichier = DATA_DIR / "chiffrement.key"
    if not fichier.exists():
        fichier.write_bytes(Fernet.generate_key())
    return fichier.read_bytes().strip()


_fernet: Fernet | None = None


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_cle())
    return _fernet


def chiffrer(valeur: str | None) -> str | None:
    if valeur is None or valeur == "":
        return valeur
    return PREFIXE + fernet().encrypt(valeur.encode("utf-8")).decode("ascii")


def dechiffrer(valeur: str | None) -> str | None:
    if not valeur or not valeur.startswith(PREFIXE):
        return valeur   # valeur vide ou antérieure au chiffrement
    try:
        return fernet().decrypt(valeur[len(PREFIXE):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        return "[donnée chiffrée illisible : clé de chiffrement différente]"


class TexteChiffre(TypeDecorator):
    """Colonne texte chiffrée de façon transparente pour le code."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return chiffrer(value)

    def process_result_value(self, value, dialect):
        return dechiffrer(value)
