"""Offres de postes en interne, candidatures, lien avec la mobilité souhaitée."""
from datetime import date, timedelta

from app.models import CandidatureExterne, Employe, FicheEvaluation, Notification, ParcoursRH


def publier(client, entetes, **champs):
    corps = {"intitule": "Chargé d'inspection", "description": "Contrôle des agences et du réseau commercial.",
             "date_limite": str(date.today() + timedelta(days=15)), **champs}
    return client.post("/api/mobilite/offres", headers=entetes("ADMINRH"), json=corps)


def test_publication_reservee_a_la_rh_et_souhaits_prevenus(client, entetes, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    db.add(FicheEvaluation(employe_id=julien.id, annee=date.today().year, mobilite_type="fonctionnelle"))
    db.commit()
    assert client.post("/api/mobilite/offres", headers=entetes("100130"), json={}).status_code in (403, 422)
    r = publier(client, entetes)
    assert r.status_code == 201 and r.json()["prevenus"] == 1
    assert db.query(Notification).filter_by(destinataire_id=julien.id).filter(Notification.titre.like("Offre interne%")).count() == 1
    paul = db.query(Employe).filter_by(matricule="100281").one()
    assert db.query(Notification).filter_by(destinataire_id=paul.id).count() == 0
    souhaits = client.get("/api/mobilite/souhaits", headers=entetes("ADMINRH")).json()
    assert [s["employe"]["matricule"] for s in souhaits] == ["100259"]


def test_offre_expiree_refusee(client, entetes):
    assert publier(client, entetes, date_limite=str(date.today() - timedelta(days=1))).status_code == 422


def test_candidature_parcours_complet(client, entetes, db):
    o = publier(client, entetes).json()
    offres = client.get("/api/mobilite/offres", headers=entetes("100259")).json()
    assert [x["id"] for x in offres] == [o["id"]]
    r = client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100259"), json={"motivation": "Expérience terrain"})
    assert r.status_code == 201 and r.json()["ma_candidature"]["statut"] == "deposee"
    assert client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100259"), json={}).status_code == 409
    # Confidentialité : ni le supérieur ni un collègue ne voient les candidatures.
    assert client.get(f"/api/mobilite/offres/{o['id']}/candidatures", headers=entetes("100130")).status_code == 403
    liste = client.get(f"/api/mobilite/offres/{o['id']}/candidatures", headers=entetes("ADMINRH")).json()["candidatures"]
    c = liste[0]
    assert c["employe"]["matricule"] == "100259" and c["motivation"] == "Expérience terrain"
    # Convocation en entretien : le supérieur est informé.
    claire = db.query(Employe).filter_by(matricule="100130").one()
    client.post(f"/api/mobilite/candidatures/{c['id']}/suivi", headers=entetes("ADMINRH"), json={"statut": "entretien"})
    assert db.query(Notification).filter_by(destinataire_id=claire.id, titre="Mobilité interne d'un collaborateur").count() == 1
    client.post(f"/api/mobilite/candidatures/{c['id']}/suivi", headers=entetes("ADMINRH"), json={"statut": "retenue"})
    # Une deuxième candidature est clôturée « non retenue » à la clôture de l'offre.
    client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100281"), json={})
    r = client.post(f"/api/mobilite/offres/{o['id']}/cloturer", headers=entetes("ADMINRH")).json()
    assert r["statut"] == "pourvue"
    statuts = {x["employe"]["matricule"]: x["statut"] for x in
               client.get(f"/api/mobilite/offres/{o['id']}/candidatures", headers=entetes("ADMINRH")).json()["candidatures"]}
    assert statuts == {"100259": "retenue", "100281": "non_retenue"}
    # L'offre clôturée n'est plus proposée, sauf à ceux qui y ont postulé.
    assert client.get("/api/mobilite/offres", headers=entetes("100130")).json() == []
    assert len(client.get("/api/mobilite/offres", headers=entetes("100259")).json()) == 1


def test_retrait_de_candidature(client, entetes):
    o = publier(client, entetes).json()
    client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100259"), json={})
    cid = client.get(f"/api/mobilite/offres/{o['id']}/candidatures", headers=entetes("ADMINRH")).json()["candidatures"][0]["id"]
    assert client.post(f"/api/mobilite/candidatures/{cid}/retirer", headers=entetes("100281")).status_code == 404
    assert client.post(f"/api/mobilite/candidatures/{cid}/retirer", headers=entetes("100259")).status_code == 200
    # Il peut postuler à nouveau tant que l'offre est ouverte.
    assert client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100259"), json={}).status_code == 201


def test_adequation_avec_l_emploi_vise(client, entetes):
    rh = entetes("ADMINRH")
    comp = {c["nom"]: c["id"] for c in client.get("/api/talents/competences", headers=rh).json()}
    emploi = client.post("/api/talents/emplois", headers=rh, json={"intitule": "Inspecteur", "exigences": [
        {"competence_id": comp["Recouvrement"], "niveau_requis": 2},
        {"competence_id": comp["Relation client"], "niveau_requis": 3}]}).json()
    client.put("/api/talents/evaluation/100259", headers=entetes("100130"), json={"evaluations": [
        {"competence_id": comp["Recouvrement"], "niveau": 3}, {"competence_id": comp["Relation client"], "niveau": 2}]})
    o = publier(client, entetes, emploi_id=emploi["id"]).json()
    client.post(f"/api/mobilite/offres/{o['id']}/candidater", headers=entetes("100259"), json={})
    c = client.get(f"/api/mobilite/offres/{o['id']}/candidatures", headers=rh).json()["candidatures"][0]
    assert c["adequation"] == 50


def test_recrutement_externe_cv_suivi_et_integration(client, entetes, db):
    offre = publier(client, entetes, publication="externe", intitule="Actuaire junior").json()
    publiques = client.get("/api/mobilite/recrutement/offres")
    assert publiques.status_code == 200 and publiques.json()[0]["id"] == offre["id"]
    depot = client.post(f"/api/mobilite/recrutement/offres/{offre['id']}/candidater", data={
        "nom": "Candidat", "prenom": "Lina", "email": "lina.candidat@example.test", "motivation": "Formation actuarielle",
    }, files={"cv": ("lina-cv.pdf", b"%PDF-1.4 candidat", "application/pdf")})
    assert depot.status_code == 201, depot.text
    assert client.post(f"/api/mobilite/recrutement/offres/{offre['id']}/candidater", data={
        "nom": "Candidat", "prenom": "Lina", "email": "lina.candidat@example.test",
    }, files={"cv": ("lina-cv.pdf", b"%PDF-1.4 candidat", "application/pdf")}).status_code == 409
    liste = client.get(f"/api/mobilite/offres/{offre['id']}/candidatures-externes", headers=entetes("ADMINRH"))
    assert liste.status_code == 200 and liste.json()["candidatures"][0]["cv_nom"] == "lina-cv.pdf"
    candidature_id = liste.json()["candidatures"][0]["id"]
    nom_stocke = db.get(CandidatureExterne, candidature_id).cv_chemin
    assert client.get(f"/fichiers/recrutement/{nom_stocke}").status_code == 404
    assert client.get(f"/api/mobilite/candidatures-externes/{candidature_id}/cv", headers=entetes("100259")).status_code == 403
    assert client.get(f"/api/mobilite/candidatures-externes/{candidature_id}/cv", headers=entetes("ADMINRH")).status_code == 200
    assert client.post(f"/api/mobilite/candidatures-externes/{candidature_id}/suivi", headers=entetes("ADMINRH"),
                       json={"statut": "retenue"}).status_code == 200
    integration = client.post(f"/api/mobilite/candidatures-externes/{candidature_id}/integrer", headers=entetes("ADMINRH"),
                              json={"matricule": "EXT001", "poste": "Actuaire junior"})
    assert integration.status_code == 200, integration.text
    employe = db.query(Employe).filter_by(matricule="EXT001").one()
    assert employe.email == "lina.candidat@example.test"
    assert db.query(ParcoursRH).filter_by(employe_id=employe.id, type_parcours="arrivee").count() == 1
    assert db.get(CandidatureExterne, candidature_id).statut == "integree"
