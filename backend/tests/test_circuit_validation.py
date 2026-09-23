"""Circuit de validation : le supérieur hiérarchique décide en premier ; le
DGA est informé et peut valider à défaut ; le DG consulte seulement. Les
fiches ne sont jamais validées par la Direction générale."""
from datetime import date, timedelta

import pytest

from app.models import (
    Demande, Departement, Employe, Notification, Role, SoldeConge, StatutDemande, TypeDemande, WorkflowValidation,
)
from app.services.calendrier import compter_jours_conge
from tests.test_demandes import semaine_ouvree_libre


@pytest.fixture
def organisation(db):
    """DG ← DGA ← Directeur Pôle ← Claire ← 100259, 100281 ; 100119 relève
    directement (et provisoirement) du DGA."""
    def employe(matricule, niveau, chef=None, role=Role.VALIDATEUR):
        e = db.query(Employe).filter_by(matricule=matricule).one_or_none()
        if e is None:
            d = db.query(Departement).first()
            e = Employe(matricule=matricule, prenom=matricule, nom="Test", email=f"{matricule}@exemple.test", poste="Poste",
                        role=role, mot_de_passe_hash="x", departement_id=d.id, doit_changer_mdp=False)
            db.add(e)
            db.flush()
            db.add(SoldeConge(employe_id=e.id, annee=date.today().year, jours_acquis=30))
        e.niveau = niveau
        e.validateur_id = chef.id if chef else None
        return e

    dg = employe("100052", "dg")
    dga = employe("100193", "dga", dg)
    pole = employe("100131", "directeur_pole", dga)
    claire = employe("100130", "manager", pole)
    employe("100119", "collaborateur", dga, Role.EMPLOYE)
    db.query(Employe).filter(Employe.matricule.in_(["100259", "100281"])).update({"validateur_id": claire.id})
    db.query(Employe).filter_by(matricule="ADMINRH").update({"validateur_id": dga.id})
    db.commit()
    return {e.matricule: e.id for e in db.query(Employe).all()}


def conge(client, entetes, matricule, jours=5):
    debut, fin = semaine_ouvree_libre()
    if jours > 5:
        fin = debut + timedelta(days=11)
    r = client.post("/api/demandes/conge", headers=entetes(matricule),
                    json={"sous_type": "annuel", "date_debut": str(debut), "date_fin": str(fin)})
    assert r.status_code == 201, r.text
    return r.json()


def notifications(db, identifiant):
    return [n.titre for n in db.query(Notification).filter_by(destinataire_id=identifiant).all()]


def test_le_superieur_valide_en_premier_et_le_dga_est_informe(client, entetes, organisation, db):
    d = conge(client, entetes, "100259")
    assert d["validateur"]["matricule"] == "100130"
    assert "Nouvelle demande à valider" in notifications(db, organisation["100130"])
    assert "Nouvelle demande dans votre périmètre" in notifications(db, organisation["100193"])
    assert notifications(db, organisation["100052"]) == []


def test_file_de_validation_du_dga_et_du_dg(client, entetes, organisation):
    d = conge(client, entetes, "100259")
    assert d["id"] in [x["id"] for x in client.get("/api/demandes/a-valider", headers=entetes("100193")).json()]
    assert d["id"] not in [x["id"] for x in client.get("/api/demandes/a-valider", headers=entetes("100052")).json()]


def test_le_dg_consulte_sans_valider(client, entetes, organisation):
    d = conge(client, entetes, "100259")
    assert client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100052"), json={}).status_code == 403
    # Il peut la consulter.
    assert client.get(f"/api/demandes/{d['id']}", headers=entetes("100052")).status_code == 200


def test_le_dga_valide_a_defaut_du_superieur(client, entetes, organisation):
    d = conge(client, entetes, "100259")
    r = client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100193"), json={})
    assert r.status_code == 200 and r.json()["statut"] == "approuvee"
    # Une fois décidée, le supérieur ne peut plus revenir dessus.
    assert client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100130"), json={}).status_code == 409


def test_sans_superieur_operationnel_la_rh_decide(client, entetes, organisation):
    for matricule in ("100119", "100131"):  # rattachés au seul DGA
        d = conge(client, entetes, matricule)
        assert d["validateur"]["matricule"] == "ADMINRH", matricule
    d = conge(client, entetes, "100119")
    assert client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100193"), json={}).status_code == 200


def test_double_validation_sans_la_direction_generale(client, entetes, organisation, db):
    db.add(WorkflowValidation(type_demande=TypeDemande.CONGE, niveaux=2, seuil_jours=10))
    db.commit()
    d = conge(client, entetes, "100259", jours=12)
    assert d["niveaux_requis"] == 2
    r = client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100130"), json={}).json()
    assert r["statut"] == "en_attente" and r["validateur"]["matricule"] == "100131"   # N+2 : Directeur Pôle
    r = client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("100131"), json={}).json()
    assert r["statut"] == "approuvee"
    # Collaborateur rattaché au seul DGA : la RH valide les deux niveaux en une fois.
    d = conge(client, entetes, "100119", jours=12)
    r = client.post(f"/api/demandes/{d['id']}/approuver", headers=entetes("ADMINRH"), json={}).json()
    assert r["statut"] == "approuvee"


def test_fiches_en_consultation_pour_la_direction_generale(client, entetes, organisation, db):
    objectifs = {"objectifs": [{"titre": "Objectif", "ponderation": 100}]}
    # Collaborateur rattaché au seul DGA : la RH tient lieu de supérieur.
    r = client.get("/api/fiches/100119", headers=entetes("100193")).json()
    assert r["droits"]["superieur"] is False
    assert client.get("/api/fiches/100119", headers=entetes("ADMINRH")).json()["droits"]["superieur"] is True
    # Soumission : la RH doit valider, le DGA est informé pour consultation.
    assert client.put("/api/fiches/100119/objectifs", headers=entetes("100119"), json=objectifs).status_code == 200
    assert client.post("/api/fiches/100119/objectifs/soumettre", headers=entetes("100119"), json={}).status_code == 200
    assert "Fiche d'objectifs soumise (consultation)" in notifications(db, organisation["100193"])
    for qui in ("100193", "100052"):
        assert client.post("/api/fiches/100119/objectifs/valider", headers=entetes(qui), json={}).status_code == 403
    assert client.post("/api/fiches/100119/objectifs/valider", headers=entetes("ADMINRH"), json={}).status_code == 200
    # Collaborateur avec un vrai supérieur : c'est lui qui agit.
    assert client.get("/api/fiches/100259", headers=entetes("100130")).json()["droits"]["superieur"] is True
