"""Assistant RH : relais vers une IA (Claude, SDK officiel ``anthropic``).

Désactivé par défaut (``PORTAIL_RH_IA=1`` pour l'activer, sur décision de la DSI).
Il n'intervient que lorsque le moteur local ne comprend pas la question, et
n'envoie que la question elle-même, débarrassée des matricules, numéros et
adresses e-mail, avec les règles générales du portail : aucune donnée de la
base (soldes, demandes, dossiers) ne sort. Toute erreur ramène à la réponse
locale ; rien n'est conservé."""
from __future__ import annotations

import re

from app.core import config
from app.services import parametres

MOTIF_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
# Téléphones (6 chiffres ou plus, séparés ou non), matricules (5 chiffres ou
# plus), références alphanumériques (VT0002, CG-2026-120) ; les années restent.
MOTIF_TELEPHONE = re.compile(r"\+?\d(?:[ .\-]?\d){5,}")
MOTIF_NUMERO = re.compile(r"\b(?:[A-Za-z]{1,3}-?\d{3,}(?:-\d+)*|\d{5,})\b")
LONGUEUR_MAX = 500

CONSIGNES = """Tu es l'assistant RH du portail interne de Veltaris (Tunisie).
Réponds en français, en cinq phrases au plus, sur un ton simple et courtois.
Tu n'as accès à aucune donnée personnelle : si la question porte sur la situation
d'une personne (solde, demande, fiche, paie, dossier), explique que le portail y
répond dans ses rubriques ou via l'assistant en posant la question autrement.
Ne donne que des informations générales. Pour une règle propre à Veltaris,
appuie-toi uniquement sur les règles ci-dessous ; au-delà, invite à contacter
l'administration RH plutôt que de supposer. Ne fais aucune promesse de décision."""


def active() -> bool:
    return config.IA_ACTIVE


def nettoyer(question: str) -> str:
    """Retire ce qui pourrait identifier quelqu'un avant tout envoi."""
    texte = MOTIF_EMAIL.sub("[adresse]", question)
    texte = MOTIF_NUMERO.sub("[numéro]", texte)       # références entières d'abord (CG-2026-120)
    texte = MOTIF_TELEPHONE.sub("[numéro]", texte)
    return " ".join(texte.split())[:LONGUEUR_MAX]


def regles_generales() -> str:
    r = parametres.REGLES
    lignes = [
        f"- Horaires : {r.get('heureArrivee')}–{r.get('pauseDebut')} et {r.get('pauseFin')}–{r.get('heureDepart')}, "
        f"séance unique {r.get('heureArriveeEte')}–{r.get('heureDepartEte')} en juillet et août.",
        f"- Congés : {r.get('acquisitionMensuelle')} jours acquis par mois ; au 31 décembre, "
        f"{r.get('plafondReport')} jours reportés au plus, sauf accord de la RH.",
        f"- Autorisations d'absence : {r.get('maxAutorisationHeures')} h au plus par sortie, "
        f"{r.get('quotaAutorisationMois')} h par mois.",
        f"- Au-delà de {r.get('seuilDoubleValidation')} jours, un congé demande une double validation.",
        f"- Sans réponse du supérieur sous {r.get('delaiReponse')} h, une demande est validée d'office."
        if r.get("validationAutomatique") else "- Pas de validation automatique des demandes.",
    ]
    return "Règles du portail :\n" + "\n".join(lignes)


def _client():
    import anthropic  # installé sur le serveur seulement (requirements-serveur.txt)

    # Délai court : l'utilisateur attend dans le tiroir de conversation.
    return anthropic.Anthropic(timeout=25.0, max_retries=1)


def repondre(question: str) -> str | None:
    """Texte de l'IA, ou None (IA désactivée, indisponible ou refus) : la
    réponse locale s'applique alors."""
    if not active():
        return None
    texte = nettoyer(question)
    if not texte:
        return None
    try:
        reponse = _client().beta.messages.create(
            model=config.IA_MODELE,
            max_tokens=4096,
            output_config={"effort": config.IA_EFFORT},
            # En cas de refus par les garde-fous du modèle, la même requête est
            # reprise par le modèle de repli, dans le même appel.
            betas=["server-side-fallback-2026-06-01"],
            fallbacks=[{"model": "claude-opus-4-8"}],
            system=f"{CONSIGNES}\n\n{regles_generales()}",
            messages=[{"role": "user", "content": texte}],
        )
    except Exception as erreur:  # SDK absent, réseau, clé, quota, 5xx : jamais bloquant
        from app.services import supervision

        supervision.enregistrer_erreur("assistant_ia", erreur)
        return None
    if reponse.stop_reason == "refusal":
        return None
    resultat = "".join(b.text for b in reponse.content if b.type == "text").strip()
    return resultat or None
