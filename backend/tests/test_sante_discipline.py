"""Accidents du travail (déclaration, confidentialité médicale, suivi,
statistiques) et dossier disciplinaire (RH seule, faits chiffrés)."""
from datetime import date, timedelta

from sqlalchemy import text

from app.models import Employe, Notification
from app.services import chiffrement


def declarer(client, entetes, qui="100130", pour="100259", **champs):
    corps = {"matricule": pour, "type_accident": "travail", "date_accident": str(date.today() - timedelta(days=1)),
             "lieu": "Agence Lac 2", "circonstances": "Chute dans l'escalier des archives.",
             "lesions": "Entorse de la cheville droite", "arret": True, "debut_arret": str(date.today()), **champs}
    return client.post("/api/sante-travail/accidents", headers=entetes(qui), json=corps)


# ---- Accidents du travail ------------------------------------------------------------------
def test_declaration_par_le_superieur_et_notifications(client, entetes, db):
    r = declarer(client, entetes)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["acces"] == "ligne" and "lesions" not in a              # le supérieur ne voit pas le médical
    rh = db.query(Employe).filter_by(matricule="ADMINRH").one()
    assert db.query(Notification).filter_by(destinataire_id=rh.id).filter(Notification.titre.like("Accident%")).count() == 1
    # Un collègue ne peut pas déclarer pour autrui.
    assert declarer(client, entetes, qui="100281").status_code == 403


def test_confidentialite_medicale(client, entetes):
    a = declarer(client, entetes).json()
    assert client.get(f"/api/sante-travail/accidents/{a['id']}", headers=entetes("100259")).json()["lesions"] == "Entorse de la cheville droite"
    assert client.get(f"/api/sante-travail/accidents/{a['id']}", headers=entetes("ADMINRH")).json()["lesions"]
    assert "lesions" not in client.get(f"/api/sante-travail/accidents/{a['id']}", headers=entetes("100130")).json()
    assert client.get(f"/api/sante-travail/accidents/{a['id']}", headers=entetes("100281")).status_code == 403


def test_donnees_medicales_chiffrees(client, entetes, db):
    a = declarer(client, entetes).json()
    brut = db.execute(text("select lesions, circonstances from accidents_travail where id = :i"), {"i": a["id"]}).one()
    assert all(v.startswith(chiffrement.PREFIXE) for v in brut) and "cheville" not in brut[0]


def test_transmission_suivi_et_cloture(client, entetes):
    a = declarer(client, entetes, pour="100259", qui="100259").json()     # déclaration pour soi
    assert a["statut"] == "declare" and a["en_retard"] is False
    rh = entetes("ADMINRH")
    assert client.post(f"/api/sante-travail/accidents/{a['id']}/transmettre", headers=entetes("100130"),
                       json={"reference_cnam": "AT-1"}).status_code == 403
    r = client.post(f"/api/sante-travail/accidents/{a['id']}/transmettre", headers=rh, json={"reference_cnam": "AT-2026-0042"}).json()
    assert r["statut"] == "transmis"
    r = client.post(f"/api/sante-travail/accidents/{a['id']}/suivi", headers=rh, json={
        "date_suivi": str(date.today()), "type_suivi": "prolongation", "jours_arret": 10, "commentaire": "Immobilisation"}).json()
    assert r["fin_arret"] == str(date.today() + timedelta(days=9)) and r["suivis"][0]["commentaire"] == "Immobilisation"
    reprise = date.today() + timedelta(days=7)
    r = client.post(f"/api/sante-travail/accidents/{a['id']}/cloturer", headers=rh, json={"date_reprise": str(reprise)}).json()
    assert r["statut"] == "clos" and r["fin_arret"] == str(reprise - timedelta(days=1)) and r["jours_arret"] == 7


def test_statistiques_reservees(client, entetes):
    declarer(client, entetes)
    assert client.get("/api/sante-travail/statistiques", headers=entetes("100130")).status_code == 403
    s = client.get("/api/sante-travail/statistiques", headers=entetes("ADMINRH")).json()
    assert s["accidents"] == 1 and s["avec_arret"] == 1 and s["par_type"]["Accident du travail"] == 1


def test_date_future_refusee(client, entetes):
    assert declarer(client, entetes, date_accident=str(date.today() + timedelta(days=2))).status_code == 422


# ---- Dossier disciplinaire ----------------------------------------------------------------
def ouvrir(client, entetes, qui="ADMINRH", **champs):
    corps = {"matricule": "100259", "type_sanction": "avertissement", "date_faits": str(date.today() - timedelta(days=10)),
             "faits": "Absences injustifiées répétées sans prévenir la hiérarchie.", **champs}
    return client.post("/api/discipline", headers=entetes(qui), json=corps)


def test_disciplinaire_reserve_a_la_rh(client, entetes):
    for qui in ("100130", "100259", "100281"):
        assert ouvrir(client, entetes, qui=qui).status_code == 403
        assert client.get("/api/discipline", headers=entetes(qui)).status_code == 403
    assert ouvrir(client, entetes).status_code == 201


def test_faits_chiffres_et_cycle(client, entetes, db):
    s = ouvrir(client, entetes).json()
    brut = db.execute(text("select faits from sanctions where id = :i"), {"i": s["id"]}).scalar()
    assert brut.startswith(chiffrement.PREFIXE) and "Absences" not in brut
    r = client.post(f"/api/discipline/{s['id']}/notifier", headers=entetes("ADMINRH"), json={"date_notification": str(date.today())}).json()
    assert r["statut"] == "notifiee"
    assert client.put(f"/api/discipline/{s['id']}", headers=entetes("ADMINRH"), json={
        "matricule": "100259", "type_sanction": "blame", "date_faits": str(date.today()), "faits": "Modification tardive refusée"}).status_code == 409
    # Droit d'accès : l'intéressé retrouve la mesure notifiée dans ses données.
    donnees = client.get("/api/sirh/mes-donnees", headers=entetes("100259")).json()
    assert donnees["sanctions_notifiees"][0]["type"] == "Avertissement"


def test_mise_a_pied_exige_une_duree(client, entetes):
    assert ouvrir(client, entetes, type_sanction="mise_a_pied").status_code == 422
    assert ouvrir(client, entetes, type_sanction="mise_a_pied", jours_mise_a_pied=2).status_code == 201


def test_pas_de_procedure_sur_soi_meme(client, entetes):
    assert ouvrir(client, entetes, matricule="ADMINRH").status_code == 403


def test_procedure_en_instruction_invisible_dans_mes_donnees(client, entetes):
    ouvrir(client, entetes)
    assert client.get("/api/sirh/mes-donnees", headers=entetes("100259")).json()["sanctions_notifiees"] == []


def test_taux_non_calcules_sans_heures_suffisantes(client, entetes):
    declarer(client, entetes)
    s = client.get("/api/sante-travail/statistiques", headers=entetes("ADMINRH")).json()
    assert s["taux_frequence"] is None and s["taux_gravite"] is None
