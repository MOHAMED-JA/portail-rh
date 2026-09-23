"""Double authentification : codes à usage unique basés sur le temps (TOTP,
RFC 6238), compatibles avec Microsoft Authenticator, Google Authenticator,
FreeOTP… Codes de secours à usage unique pour la perte du téléphone."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import quote

EMETTEUR = "Portail RH Veltaris"
PERIODE = 30
CHIFFRES = 6
TOLERANCE = 1   # une période avant / après : décalage d'horloge du téléphone


def nouveau_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def code(secret: str, instant: float | None = None) -> str:
    cle = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    compteur = int((instant if instant is not None else time.time()) // PERIODE)
    empreinte = hmac.new(cle, struct.pack(">Q", compteur), hashlib.sha1).digest()
    decalage = empreinte[-1] & 0x0F
    valeur = struct.unpack(">I", empreinte[decalage:decalage + 4])[0] & 0x7FFFFFFF
    return str(valeur % 10 ** CHIFFRES).zfill(CHIFFRES)


def verifier(secret: str, saisi: str, instant: float | None = None) -> bool:
    saisi = (saisi or "").replace(" ", "")
    if not (saisi.isdigit() and len(saisi) == CHIFFRES):
        return False
    maintenant = instant if instant is not None else time.time()
    return any(hmac.compare_digest(code(secret, maintenant + d * PERIODE), saisi)
               for d in range(-TOLERANCE, TOLERANCE + 1))


def uri(secret: str, compte: str) -> str:
    """Adresse otpauth:// à afficher en QR code."""
    return (f"otpauth://totp/{quote(EMETTEUR)}:{quote(compte)}?secret={secret}"
            f"&issuer={quote(EMETTEUR)}&digits={CHIFFRES}&period={PERIODE}")


def _empreinte(code_secours: str) -> str:
    return hashlib.sha256(code_secours.replace("-", "").upper().encode()).hexdigest()


def codes_de_secours(nombre: int = 8) -> tuple[list[str], str]:
    """Codes à montrer une seule fois ; seules leurs empreintes sont stockées."""
    codes = [f"{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}" for _ in range(nombre)]
    return codes, json.dumps([_empreinte(c) for c in codes])


def utiliser_code_secours(stockes: str | None, saisi: str) -> str | None:
    """Renvoie la liste mise à jour si le code est valide (il est consommé)."""
    empreintes = json.loads(stockes or "[]")
    cible = _empreinte(saisi or "")
    if cible not in empreintes:
        return None
    empreintes.remove(cible)
    return json.dumps(empreintes)
