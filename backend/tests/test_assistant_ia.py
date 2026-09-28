"""Relais IA de l'assistant RH : désactivé par défaut, questions nettoyées,
repli sur la réponse locale. Aucun appel réseau : le client est simulé."""
from types import SimpleNamespace

from app.core import config
from app.services import assistant_ia

INCOMPRISE = "Quelle est la capitale de la Tunisie ?"


class FauxClient:
    def __init__(self, texte="Réponse de l'IA.", stop="end_turn", erreur=None):
        self.appels = []
        self.texte, self.stop, self.erreur = texte, stop, erreur
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._creer))

    def _creer(self, **arguments):
        self.appels.append(arguments)
        if self.erreur:
            raise self.erreur
        return SimpleNamespace(stop_reason=self.stop,
                               content=[SimpleNamespace(type="thinking", thinking=""),
                                        SimpleNamespace(type="text", text=self.texte)])


def _brancher(monkeypatch, client):
    monkeypatch.setattr(config, "IA_ACTIVE", True)
    monkeypatch.setattr(assistant_ia, "_client", lambda: client)


def test_desactive_par_defaut(client, entetes, monkeypatch):
    faux = FauxClient()
    monkeypatch.setattr(assistant_ia, "_client", lambda: faux)
    r = client.post("/api/assistant", headers=entetes("100259"), json={"question": INCOMPRISE}).json()
    assert r["intention"] == "incompris" and faux.appels == []


def test_question_incomprise_relayee_sans_donnees_personnelles(client, entetes, monkeypatch):
    faux = FauxClient()
    _brancher(monkeypatch, faux)
    question = "Mon collègue 100281 (khemais.paul@veltaris.example, 22 123 456) peut-il ? " + INCOMPRISE
    r = client.post("/api/assistant", headers=entetes("100259"), json={"question": question}).json()
    assert r["intention"] == "ia" and r["texte"] == "Réponse de l'IA."
    assert "vérifiez auprès de l'administration RH" in r["details"][0]
    envoye = faux.appels[0]
    contenu = envoye["messages"][0]["content"]
    assert "100281" not in contenu and "@" not in contenu and "123 456" not in contenu
    assert envoye["model"] == config.IA_MODELE and envoye["fallbacks"] == [{"model": "claude-opus-4-8"}]
    assert "Règles du portail" in envoye["system"] and "2.5 jours acquis" in envoye["system"]


def test_question_comprise_ne_sort_jamais(client, entetes, monkeypatch):
    faux = FauxClient()
    _brancher(monkeypatch, faux)
    r = client.post("/api/assistant", headers=entetes("100259"), json={"question": "Quel est mon solde de congés ?"}).json()
    assert r["intention"] == "solde" and faux.appels == []


def test_erreur_ou_refus_ramene_a_la_reponse_locale(client, entetes, monkeypatch):
    for faux in (FauxClient(erreur=ConnectionError("réseau coupé")), FauxClient(stop="refusal"), FauxClient(texte="  ")):
        _brancher(monkeypatch, faux)
        r = client.post("/api/assistant", headers=entetes("100259"), json={"question": INCOMPRISE}).json()
        assert r["intention"] == "incompris", faux.stop
        assert len(faux.appels) == 1


def test_nettoyage():
    assert assistant_ia.nettoyer("  a.b@c.tn   écrit   au 100259 ") == "[adresse] écrit au [numéro]"
    assert len(assistant_ia.nettoyer("x" * 2000)) == assistant_ia.LONGUEUR_MAX
    assert assistant_ia.nettoyer("appel au +216 71 123 456, dossier VT0002 et CG-2026-120") == \
        "appel au [numéro], dossier [numéro] et [numéro]"
    assert assistant_ia.nettoyer("Congés 2026 : du 12 au 14 octobre") == "Congés 2026 : du 12 au 14 octobre"
