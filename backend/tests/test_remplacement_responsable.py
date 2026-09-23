"""Passation d'un responsable : équipe, structures et demandes en attente."""
from datetime import date, timedelta

from app.models import (
    Demande,
    Departement,
    Employe,
    EvenementCarriere,
    JournalAudit,
    Notification,
    Role,
    StatutDemande,
    StatutEmploye,
    TypeDemande,
)


def _demande(db, reference: str, employe: Employe, validateur: Employe) -> Demande:
    demande = Demande(
        reference=reference,
        type_demande=TypeDemande.CONGE,
        sous_type="annuel",
        employe_id=employe.id,
        date_debut=date.today() + timedelta(days=30),
        date_fin=date.today() + timedelta(days=30),
        nombre_jours=1,
        statut=StatutDemande.EN_ATTENTE,
        validateur_id=validateur.id,
        niveau_courant=1,
        niveaux_requis=1,
    )
    db.add(demande)
    return demande


def test_remplacement_previsualise_puis_transfere_tout(client, entetes, db):
    responsable = db.query(Employe).filter_by(matricule="100130").one()
    remplacant = db.query(Employe).filter_by(matricule="100259").one()
    collegue = db.query(Employe).filter_by(matricule="100281").one()
    nouveau = db.query(Employe).filter_by(matricule="NOUVEAU").one()
    departement = db.query(Departement).one()
    departement.responsable_id = responsable.id
    responsable.niveau = "manager"
    _demande(db, "REMPL-001", collegue, responsable)
    demande_remplacant = _demande(db, "REMPL-002", remplacant, responsable)
    db.commit()

    corps = {"responsable_id": responsable.id, "remplacant_id": remplacant.id}
    simulation = client.post(
        "/api/administration/remplacer-responsable?simulation=true",
        headers=entetes("ADMINRH"),
        json=corps,
    )
    assert simulation.status_code == 200, simulation.text
    rapport = simulation.json()
    assert rapport["simulation"] is True
    assert rapport["responsable"]["matricule"] == "100130"
    assert rapport["remplacant"]["matricule"] == "100259"
    assert {e["matricule"] for e in rapport["collaborateurs"]} == {"100281", "NOUVEAU"}
    assert rapport["demandes_en_attente"] == 2
    assert rapport["demandes_personnelles_reorientees"] == 1
    db.expire_all()
    assert departement.responsable_id == responsable.id
    assert collegue.validateur_id == responsable.id

    application = client.post(
        "/api/administration/remplacer-responsable?simulation=false",
        headers=entetes("ADMINRH"),
        json=corps,
    )
    assert application.status_code == 200, application.text
    assert application.json()["simulation"] is False
    sauvegarde = application.json()["sauvegarde"]
    if db.bind.dialect.name == "sqlite":
        assert sauvegarde.endswith(".db")
    else:
        assert sauvegarde is None
    db.expire_all()
    assert departement.responsable_id == remplacant.id
    assert remplacant.validateur_id is None
    assert remplacant.role == Role.VALIDATEUR
    assert remplacant.niveau == "manager"
    assert collegue.validateur_id == remplacant.id
    assert nouveau.validateur_id == remplacant.id
    assert db.query(Demande).filter_by(reference="REMPL-001").one().validateur_id == remplacant.id
    assert db.get(Demande, demande_remplacant.id).validateur.matricule == "ADMINRH"
    assert db.query(JournalAudit).filter_by(action="remplacement_responsable").count() == 1
    assert db.query(EvenementCarriere).filter_by(employe_id=remplacant.id, type_evenement="prise_responsabilite").count() == 1
    assert db.query(Notification).filter_by(destinataire_id=remplacant.id, titre="Nouvelles responsabilités").count() == 1


def test_remplacement_refuse_aux_non_administrateurs_et_aux_sortis(client, entetes, db):
    responsable = db.query(Employe).filter_by(matricule="100130").one()
    remplacant = db.query(Employe).filter_by(matricule="100259").one()
    corps = {"responsable_id": responsable.id, "remplacant_id": remplacant.id}
    assert client.post(
        "/api/administration/remplacer-responsable", headers=entetes("100259"), json=corps
    ).status_code == 403
    remplacant.statut = StatutEmploye.SORTI
    db.commit()
    reponse = client.post(
        "/api/administration/remplacer-responsable", headers=entetes("ADMINRH"), json=corps
    )
    assert reponse.status_code == 422
    assert "actif" in reponse.json()["detail"]
