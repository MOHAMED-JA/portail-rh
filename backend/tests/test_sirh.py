"""Dossier RH, report des congés, parcours, sondages."""
from app.models import Employe, JournalAudit, ReponseSondage, SoldeConge, TacheParcours
from app.services import sirh
from tests.constantes import ANNEE


def test_dossier_visible_par_l_interesse_et_la_rh_seulement(client, entetes):
    assert client.get("/api/sirh/dossier/100259", headers=entetes("100259")).status_code == 200
    assert client.get("/api/sirh/dossier/100259", headers=entetes("ADMINRH")).status_code == 200
    assert client.get("/api/sirh/dossier/100259", headers=entetes("100281")).status_code == 403
    assert client.put("/api/sirh/dossier/100259", headers=entetes("100259"), json={}).status_code == 403


def test_dossier_calcule_retraite_et_visite(client, entetes):
    r = client.put("/api/sirh/dossier/100259", headers=entetes("ADMINRH"), json={
        "date_naissance": "1985-03-14", "visite_medicale_le": "2025-10-01", "visite_periodicite_mois": 12})
    assert r.status_code == 200, r.text
    assert r.json()["date_retraite"] == "2045-03-14"
    assert r.json()["prochaine_visite"] == "2026-09-26"


def test_report_plafonne_a_quinze_jours(client, entetes):
    r = client.get("/api/sirh/report", headers=entetes("ADMINRH")).json()
    ligne = next(l for l in r["lignes"] if l["employe"]["matricule"] == "100259")
    assert (ligne["solde"], ligne["excedent"], ligne["reporte_prevu"], ligne["perdu_prevu"]) == (21, 6, 15, 6)


def test_accord_rh_puis_cloture(client, entetes, db):
    r = client.post("/api/sirh/report/accord", headers=entetes("ADMINRH"),
                    json={"matricule": "100259", "annee": ANNEE, "jours": 4, "motif": "Nécessité de service"})
    assert r.status_code == 200
    ligne = next(l for l in r.json()["lignes"] if l["employe"]["matricule"] == "100259")
    assert (ligne["reporte_prevu"], ligne["perdu_prevu"]) == (19, 2)

    resultats = {x["employe_id"]: x for x in sirh.cloturer(db, ANNEE)}
    julien = db.query(Employe).filter_by(matricule="100259").one()
    paul = db.query(Employe).filter_by(matricule="100281").one()
    assert (resultats[julien.id]["reporte"], resultats[julien.id]["perdu"]) == (19, 2)
    assert (resultats[paul.id]["reporte"], resultats[paul.id]["perdu"]) == (15, 6)
    suivant = db.query(SoldeConge).filter_by(employe_id=julien.id, annee=ANNEE + 1).one()
    assert suivant.report_anterieur == 19
    # Une seconde clôture ne recompte rien.
    assert sirh.cloturer(db, ANNEE) == []


def test_report_accord_reserve_a_la_rh(client, entetes):
    r = client.post("/api/sirh/report/accord", headers=entetes("100130"),
                    json={"matricule": "100259", "annee": ANNEE, "jours": 4})
    assert r.status_code == 403


def test_parcours_creation_coche_et_suppression(client, entetes, db):
    rh = entetes("ADMINRH")
    p = client.post("/api/sirh/parcours", headers=rh, json={"matricule": "100259", "type_parcours": "arrivee"}).json()
    assert len(p["taches"]) == 10 and p["avancement"] == 0

    manager = next(t for t in p["taches"] if t["responsable"] == "Manager")
    assert client.post(f"/api/sirh/parcours/taches/{manager['id']}", headers=entetes("100130"), json={"fait": True}).status_code == 200
    assert client.post(f"/api/sirh/parcours/taches/{manager['id']}", headers=entetes("100281"), json={"fait": True}).status_code == 403

    assert client.delete(f"/api/sirh/parcours/{p['id']}", headers=entetes("100130")).status_code == 403
    assert client.delete(f"/api/sirh/parcours/{p['id']}", headers=rh).status_code == 204
    assert client.delete(f"/api/sirh/parcours/{p['id']}", headers=rh).status_code == 404
    assert db.query(TacheParcours).filter_by(parcours_id=p["id"]).count() == 0
    assert db.query(JournalAudit).filter_by(action="parcours_supprime").count() == 1


def test_sondage_anonyme(client, entetes, db):
    s = client.post("/api/sirh/sondages", headers=entetes("ADMINRH"), json={
        "titre": "Baromètre social", "questions": [
            {"texte": "Satisfaction", "type": "note"},
            {"texte": "Charge", "type": "choix", "choix": ["Faible", "Correcte", "Élevée"]}]}).json()
    chemin = f"/api/sirh/sondages/{s['id']}/reponse"
    assert client.post(chemin, headers=entetes("100259"), json={"reponses": [4, "Élevée"]}).status_code == 200
    assert client.post(chemin, headers=entetes("100259"), json={"reponses": [5, "Faible"]}).status_code == 409
    assert client.post(chemin, headers=entetes("100281"), json={"reponses": [2, "Correcte"]}).status_code == 200
    # Aucune réponse n'est rattachée à une personne.
    assert {r.employe_id for r in db.query(ReponseSondage).all()} == {None}
    resultats = client.get(f"/api/sirh/sondages/{s['id']}/resultats", headers=entetes("ADMINRH")).json()
    assert resultats["participants"] == 2
    assert resultats["questions"][0]["moyenne"] == 3
