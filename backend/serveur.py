"""Démarre le serveur sur les deux adresses de boucle locale.

Sur ce poste, « localhost » se résout d'abord en IPv6 (::1). Un serveur qui
n'écoute qu'en IPv4 (127.0.0.1) laisse alors certains navigateurs attendre
une réponse qui ne vient pas. Écouter sur ::1 et 127.0.0.1 règle le problème
sans exposer l'application au réseau de l'entreprise : seules les adresses de
boucle locale sont ouvertes.

Usage :  .venv\\Scripts\\python.exe serveur.py
"""
import os
import socket

import uvicorn

# Variable d'environnement utile pour lancer une instance de test à côté.
PORT = int(os.environ.get("PORTAIL_RH_PORT", "8100"))
# Sur le serveur de la DSI : adresse d'écoute explicite (ex. 127.0.0.1 derrière
# le serveur web https, ou 0.0.0.0). Sans elle : boucle locale uniquement.
HOTE = os.environ.get("PORTAIL_RH_HOTE")


def socket_local(famille: int, adresse: str) -> socket.socket:
    prise = socket.socket(famille, socket.SOCK_STREAM)
    if famille == socket.AF_INET6:
        # Sans cette option, ::1 pourrait aussi capter l'IPv4 et entrer en
        # conflit avec la prise 127.0.0.1 ouverte à côté.
        prise.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    prise.bind((adresse, PORT))
    prise.listen(128)
    return prise


def main() -> None:
    if HOTE:
        print(f"Portail RH — écoute sur {HOTE}, port {PORT}")
        # proxy_headers : adresse réelle du client transmise par le serveur web.
        uvicorn.run("app.main:app", host=HOTE, port=PORT, log_level="info",
                    proxy_headers=True, forwarded_allow_ips="*")
        return
    prises = [socket_local(socket.AF_INET, "127.0.0.1")]
    try:
        prises.append(socket_local(socket.AF_INET6, "::1"))
        adresses = "127.0.0.1 et [::1]"
    except OSError:
        adresses = "127.0.0.1 (IPv6 indisponible sur ce poste)"

    print(f"Portail RH — écoute sur {adresses}, port {PORT}")
    print(f"Application : http://127.0.0.1:{PORT}   ou   http://localhost:{PORT}")
    serveur = uvicorn.Server(uvicorn.Config("app.main:app", log_level="info"))
    serveur.run(sockets=prises)


if __name__ == "__main__":
    main()
