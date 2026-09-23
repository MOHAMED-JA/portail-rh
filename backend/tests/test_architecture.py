"""Questions de confirmation de l'architecture et des responsables."""

from app.models import ConfirmationArchitecture, Departement, Employe, JournalAudit


def test_confirmation_architecture_est_reservee_a_la_rh_et_tracee(client, entetes, db):
    assert client.get("/api/architecture/confirmations", headers=entetes("100259")).status_code == 403
    reponse = client.get("/api/architecture/confirmations", headers=entetes("ADMINRH"))
    assert reponse.status_code == 200, reponse.text
    questionnaire = reponse.json()
    assert questionnaire["total"] == 1 and questionnaire["confirmees"] == 0
    structure = questionnaire["questions"][0]
    responsable = next(c for c in questionnaire["candidats"] if c["matricule"] == "100130")

    reponse = client.put(f"/api/architecture/confirmations/{structure['structure_id']}", headers=entetes("ADMINRH"),
                         json={"responsable_id": responsable["id"]})
    assert reponse.status_code == 200, reponse.text
    db.expire_all()
    departement = db.get(Departement, structure["structure_id"])
    assert departement.responsable_id == responsable["id"]
    confirmation = db.query(ConfirmationArchitecture).filter_by(structure_id=departement.id).one()
    assert confirmation.responsable_confirme_id == responsable["id"]
    assert db.query(JournalAudit).filter_by(action="confirmation_architecture", cible="DIR").count() == 1

    nouveau_responsable = db.query(Employe).filter_by(matricule="100259").one()
    reponse = client.put(f"/api/architecture/confirmations/{structure['structure_id']}", headers=entetes("ADMINRH"),
                         json={"responsable_id": nouveau_responsable.id})
    assert reponse.status_code == 200
    assert db.query(ConfirmationArchitecture).filter_by(structure_id=departement.id).count() == 1
