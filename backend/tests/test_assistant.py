"""Assistant RH sans IA externe : compréhension (dates, heures, intentions),
réponses calculées depuis la base, périmètre de chacun, aucune écriture."""
from datetime import date, time, timedelta

import pytest

from app.models import Demande, Employe
from app.services.assistant_comprehension import detecter, lire_periode, normaliser
from app.services.calendrier import compter_jours_conge

LUNDI = date(2026, 9, 28)


def periode(question, jour=LUNDI):
    return lire_periode(normaliser(question), jour)


# ---- Compréhension --------------------------------------------------------------------------
def test_normalisation_sans_accents():
    assert normaliser("  Où en est MA demande ? ") == "ou en est ma demande"


@pytest.mark.parametrize("question, debut, fin", [
    ("Je veux poser 3 jours la semaine prochaine", date(2026, 10, 5), date(2026, 10, 7)),
    ("Poser un congé du 12 au 14 octobre", date(2026, 10, 12), date(2026, 10, 14)),
    ("congé du 28 décembre au 3 janvier", date(2026, 12, 28), date(2027, 1, 3)),
    ("mission le 2/10", date(2026, 10, 2), date(2026, 10, 2)),
    ("télétravail vendredi prochain", date(2026, 10, 2), date(2026, 10, 2)),
    ("du 01/10/2026 au 02/10/2026", date(2026, 10, 1), date(2026, 10, 2)),
    ("poser trois jours à partir du 14 octobre", date(2026, 10, 14), date(2026, 10, 19)),  # 15/10 férié, week-end
])
def test_lecture_des_dates(question, debut, fin):
    p = periode(question)
    assert (p.debut, p.fin) == (debut, fin)


def test_lecture_des_heures_et_demi_journee():
    p = periode("Je voudrais une autorisation demain de 10h à 11h30")
    assert (p.debut, p.heure_debut, p.heure_fin) == (date(2026, 9, 29), time(10), time(11, 30))
    p = periode("autorisation jeudi à 14h pendant 1h30")
    assert (p.debut, p.heure_debut, p.heure_fin) == (date(2026, 10, 1), time(14), time(15, 30))
    assert periode("je veux prendre lundi matin").demi_journee == "matin"
    assert periode("Combien de jours de congé me reste-t-il ?") is None


@pytest.mark.parametrize("question, intention", [
    ("Combien de jours de congé me reste-t-il ?", "solde"),
    ("combien de jours puis-je poser ?", "solde"),
    ("Où en est ma demande ?", "mes_demandes"),
    ("Qui valide mes congés ?", "mon_validateur"),
    ("Je veux poser 3 jours la semaine prochaine", "action_conge"),
    ("poser mon congé de mariage du 5 au 7 novembre", "action_conge"),
    ("Je voudrais une autorisation demain de 10h à 11h30", "action_autorisation"),
    ("télétravail vendredi prochain", "action_mission"),
    ("Combien d'heures d'autorisation par mois ?", "regle_autorisation"),
    ("Qui est absent demain dans mon équipe ?", "absents"),
    ("Quelles demandes dois-je valider ?", "a_valider"),
    ("Quelles sont les alertes RH ?", "alertes"),
    ("Quand est ma prochaine visite médicale ?", "visite_medicale"),
    ("Où en est ma fiche d'objectifs ?", "fiche_objectifs"),
    ("Vais-je perdre des jours au 31 décembre ?", "report"),
    ("Combien de jours pour un mariage ?", "regle_exceptionnels"),
    ("Quels sont les horaires en été ?", "regle_horaires"),
    ("Combien de jours acquiert-on par mois ?", "regle_acquisition"),
    ("Que se passe-t-il sans réponse sous 48h ?", "regle_validation_auto"),
    ("Prochains jours fériés", "jours_feries"),
    ("J'ai oublié mon mot de passe", "regle_mot_de_passe"),
    ("bonjour", "aide"),
    ("quel temps fait-il", None),
])
def test_intentions(question, intention):
    t = normaliser(question)
    assert detecter(t, lire_periode(t, LUNDI) is not None) == intention


# ---- Réponses depuis la base ------------------------------------------------------------------
def jours_ouvres_futurs(nombre=2):
    """Premier bloc de ``nombre`` jours ouvrés consécutifs, dans trois semaines au moins."""
    debut = date.today() + timedelta(days=21)
    while True:
        fin = debut + timedelta(days=nombre - 1)
        if debut.weekday() < 5 and compter_jours_conge(debut, fin) == nombre and fin.year == debut.year:
            return debut, fin
        debut += timedelta(days=1)


def demander(client, entetes, question, matricule="100259"):
    r = client.post("/api/assistant", headers=entetes(matricule), json={"question": question})
    assert r.status_code == 200, r.text
    return r.json()


def deposer_conge(client, entetes, debut, fin, matricule="100259"):
    r = client.post("/api/demandes/conge", headers=entetes(matricule),
                    json={"sous_type": "annuel", "date_debut": str(debut), "date_fin": str(fin)})
    assert r.status_code == 201, r.text
    return r.json()


def test_connexion_requise(client):
    assert client.post("/api/assistant", json={"question": "solde"}).status_code == 401


def test_question_trop_longue(client, entetes):
    r = client.post("/api/assistant", headers=entetes("100259"), json={"question": "a" * 501})
    assert r.status_code == 422


def test_solde_et_valideur(client, entetes):
    r = demander(client, entetes, "Combien de jours de congé me reste-t-il ?")
    assert r["intention"] == "solde" and "21 jour(s)" in r["texte"]
    r = demander(client, entetes, "Qui valide mes congés ?")
    assert "Claire Morel" in r["texte"]


def test_superieur_de_la_direction_generale(client, entetes, db):
    chef = db.query(Employe).filter_by(matricule="100130").one()
    chef.niveau = "dga"
    db.commit()
    r = demander(client, entetes, "Qui valide mes congés ?")
    assert "Direction générale" in r["texte"] and "l'administration RH décide" in r["texte"]
    assert r["details"] == ["Claire Morel peut aussi les valider tant que la RH ne l'a pas fait."]


def test_mes_demandes_en_attente(client, entetes):
    debut, fin = jours_ouvres_futurs()
    demande = deposer_conge(client, entetes, debut, fin)
    r = demander(client, entetes, "Où en est ma demande ?")
    assert r["intention"] == "mes_demandes"
    assert any(demande["reference"] in ligne and "chez Claire Morel" in ligne for ligne in r["details"])


def test_action_guidee_ne_depose_rien(client, entetes, db):
    debut, fin = jours_ouvres_futurs()
    avant = db.query(Demande).count()
    r = demander(client, entetes, f"Je veux poser un congé du {debut:%d/%m/%Y} au {fin:%d/%m/%Y}")
    assert r["intention"] == "action_conge"
    assert r["action"] == {"type": "conge", "sous_type": "annuel", "date_debut": str(debut), "date_fin": str(fin),
                           "demi_journee": None}
    assert "2 jour(s)" in r["texte"] and any("Solde après cette demande : 19 j" in d for d in r["details"])
    assert db.query(Demande).count() == avant


def test_action_autorisation_trop_longue_signalee(client, entetes):
    debut, _ = jours_ouvres_futurs(1)
    r = demander(client, entetes, f"autorisation le {debut:%d/%m/%Y} de 9h à 11h")
    assert r["action"]["heure_debut"] == "09:00" and r["action"]["heure_fin"] == "11:00"
    assert any("au plus 1h30" in d for d in r["details"])


def test_absents_selon_le_perimetre(client, entetes):
    debut, fin = jours_ouvres_futurs()
    demande = deposer_conge(client, entetes, debut, fin)
    assert client.post(f"/api/demandes/{demande['id']}/approuver", headers=entetes("100130"), json={}).status_code == 200
    question = f"Qui est absent le {debut:%d/%m/%Y} dans mon équipe ?"

    manager = demander(client, entetes, question, "100130")
    assert manager["intention"] == "absents"
    assert manager["details"][0].startswith("Julien Garnier — Congé du ")
    assert "Congé annuel" not in manager["details"][0]           # le motif précis reste à la RH
    rh = demander(client, entetes, question, "ADMINRH")
    assert "Congé — Congé annuel" in rh["details"][0]
    collegue = demander(client, entetes, question, "100281")
    assert "pas d'équipe" in collegue["texte"] and not collegue["details"]


def test_file_de_validation_du_manager(client, entetes):
    debut, fin = jours_ouvres_futurs()
    demande = deposer_conge(client, entetes, debut, fin)
    r = demander(client, entetes, "Quelles demandes dois-je valider ?", "100130")
    assert r["intention"] == "a_valider" and any(demande["reference"] in d for d in r["details"])
    assert "pas de file" in demander(client, entetes, "Quelles demandes dois-je valider ?", "100281")["texte"]


def test_alertes_reservees_a_la_rh(client, entetes):
    assert "réservées" in demander(client, entetes, "Quelles sont les alertes RH ?")["texte"]
    assert demander(client, entetes, "Quelles sont les alertes RH ?", "ADMINRH")["intention"] == "alertes"


def test_regles_lues_dans_les_parametres(client, entetes):
    r = demander(client, entetes, "Combien d'heures d'autorisation par mois ?")
    assert "1h30" in r["texte"] and "4h" in r["texte"]
    r = demander(client, entetes, "Combien de jours pour un mariage ?")
    assert "Mariage de l'employé : 3 jour(s)" in r["texte"]


def test_question_incomprise_et_suggestions_selon_le_profil(client, entetes):
    r = demander(client, entetes, "quel temps fait-il")
    assert r["intention"] == "incompris" and r["suggestions"]
    assert "Qui est absent demain dans mon équipe ?" not in r["suggestions"]
    manager = client.get("/api/assistant/suggestions", headers=entetes("100130")).json()
    assert "Qui est absent demain dans mon équipe ?" in manager["suggestions"]
