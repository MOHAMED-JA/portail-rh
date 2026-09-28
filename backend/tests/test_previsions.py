"""Prévisions RH sur 12 mois : droits, repères, départs connus, congés, regroupement."""
from datetime import date, timedelta

from app.models import (
    Demande, Departement, DossierEmploye, Employe, JournalAudit, StatutDemande, TypeDemande,
)
from app.services import previsions


def _calcul(client, entetes, qui="ADMINRH"):
    r = client.get("/api/previsions", headers=entetes(qui))
    assert r.status_code == 200, r.text
    return r.json()


def test_reserve_rh_et_direction_generale(client, entetes, db):
    assert client.get("/api/previsions", headers=entetes("100259")).status_code == 403
    assert client.get("/api/previsions", headers=entetes("100130")).status_code == 403   # simple manager
    d = _calcul(client, entetes)
    assert len(d["mois"]) == 12 and d["effectif"] == 5
    assert d["taux"]["absenteisme_source"] == "repère" and d["taux"]["depart_source"] == "repère"
    assert d["departs_nominatifs"] == []
    # La Direction générale voit les agrégats, jamais la liste nominative.
    dg = db.query(Employe).filter_by(matricule="100130").one()
    dg.niveau = "dg"
    db.commit()
    d = _calcul(client, entetes, "100130")
    assert d["departs_nominatifs"] is None and d["unites"]


def test_depart_connus_dans_l_horizon(client, entetes, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    paul = db.query(Employe).filter_by(matricule="100281").one()
    db.add(DossierEmploye(employe_id=julien.id, type_contrat="CDD", date_fin_contrat=date.today() + timedelta(days=90)))
    paul.date_sortie = date.today() + timedelta(days=40)
    db.commit()
    d = _calcul(client, entetes)
    unite = d["unites"][0]
    assert unite["departs_certains"] == 2
    motifs = {x["matricule"]: x["motif"] for x in d["departs_nominatifs"]}
    assert motifs == {"100259": "Fin de contrat", "100281": "Sortie programmée"}
    # Effectif projeté = actuel − certains − probables (5 % de 5 = 0,25).
    assert unite["effectif_projete"] == round(5 - 2 - 0.25, 1)


def test_conges_deposes_et_presence(client, entetes, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    d0 = _calcul(client, entetes)
    premier = date.fromisoformat(d0["mois"][2]["mois"])          # dans deux mois
    db.add(Demande(reference="CG-TEST-1", type_demande=TypeDemande.CONGE, sous_type="annuel", employe_id=julien.id,
                   date_debut=premier, date_fin=premier + timedelta(days=27), nombre_jours=20,
                   statut=StatutDemande.APPROUVEE))
    db.commit()
    d = _calcul(client, entetes)
    avant, apres = d0["unites"][0]["mois"][2], d["unites"][0]["mois"][2]
    assert apres["conges_deposes"] >= 18
    assert apres["conges"] >= apres["conges_deposes"]
    assert apres["presence"] <= avant["presence"]


def test_hypotheses_reglees_par_l_administrateur(client, entetes, db):
    h = client.get("/api/previsions", headers=entetes("ADMINRH")).json()["hypotheses"]
    corps = {**h, "taux_absenteisme": 10, "effectifs_cibles": {"DIR": 8}}
    assert client.put("/api/previsions/hypotheses", headers=entetes("100259"), json=corps).status_code == 403
    assert client.put("/api/previsions/hypotheses", headers=entetes("ADMINRH"),
                      json={**corps, "effectifs_cibles": {"INCONNUE": 3}}).status_code == 422
    assert client.put("/api/previsions/hypotheses", headers=entetes("ADMINRH"),
                      json={**corps, "saison_conges": [1] * 11}).status_code == 422
    r = client.put("/api/previsions/hypotheses", headers=entetes("ADMINRH"), json=corps)
    assert r.status_code == 200 and r.json()["taux_absenteisme"] == 10
    d = _calcul(client, entetes)
    assert d["taux"]["absenteisme"] == 10
    unite = d["unites"][0]
    assert unite["effectif_cible"] == 8 and unite["besoin"] == round(8 - unite["effectif_projete"], 1)
    assert db.query(JournalAudit).filter_by(action="previsions_hypotheses").count() == 1


def test_fiabilite_signale_les_donnees_manquantes(client, entetes):
    f = _calcul(client, entetes)["fiabilite"]
    assert f["niveau"] == "faible" and f["mois_historique"] == 0
    assert any("date(s) de naissance" in m for m in f["a_completer"])


def test_regroupement_sous_la_direction_generale_adjointe(db):
    claire = db.query(Employe).filter_by(matricule="100130").one()
    claire.niveau = "dga"
    dg = Departement(code="DG", nom="Direction générale")
    db.add(dg)
    db.flush()
    dga = Departement(code="DGA", nom="Direction générale déléguée", parent_id=dg.id, responsable_id=claire.id)
    db.add(dga)
    db.flush()
    pole = Departement(code="POLE", nom="Pôle Risques", parent_id=dga.id)
    db.add(pole)
    db.flush()
    direction = Departement(code="SOUS", nom="Direction de la conformité", parent_id=pole.id)
    db.add(direction)
    db.flush()
    deps = previsions.structures(db)
    assert previsions.unite_de_structure(direction.id, deps).code == "POLE"
    assert previsions.unite_de_structure(dg.id, deps).code == "DG"
    dga.responsable_id = None      # sans DGA « de regroupement » : le niveau sous la DG
    db.flush()
    db.expire_all()
    assert previsions.unite_de_structure(direction.id, previsions.structures(db)).code == "DGA"
    db.rollback()


def test_horizon_des_douze_mois_suivants():
    assert previsions._mois_suivants(date(2026, 9, 1), 13)[1] == date(2026, 10, 1)
    assert previsions._mois_suivants(date(2026, 12, 1), 3) == [date(2026, 12, 1), date(2027, 1, 1), date(2027, 2, 1)]
