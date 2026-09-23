"""Compétences, écarts, formations suggérées ; postes clés et succession."""
from datetime import date, timedelta

import pytest

from app.models import DossierEmploye, Employe, Formation


@pytest.fixture
def referentiel(client, entetes, db):
    rh = entetes("ADMINRH")
    comp = {c["nom"]: c["id"] for c in client.get("/api/talents/competences", headers=rh).json()}
    emploi = client.post("/api/talents/emplois", headers=rh, json={
        "intitule": "Inspecteur", "famille": "Contrôle", "exigences": [
            {"competence_id": comp["Contrôle interne et audit"], "niveau_requis": 3},
            {"competence_id": comp["Recouvrement"], "niveau_requis": 2},
            {"competence_id": comp["Excel et outils bureautiques"], "niveau_requis": 2}]}).json()
    client.put("/api/talents/affectation/100259", headers=rh, json={"emploi_id": emploi["id"]})
    db.add(Formation(titre="Audit interne et contrôle des risques", theme="Conformité", date_debut=date.today() + timedelta(days=20),
                     date_fin=date.today() + timedelta(days=21), lieu="Siège", places=10))
    db.commit()
    return comp, emploi


def test_referentiel_initial(client, entetes):
    noms = [c["nom"] for c in client.get("/api/talents/competences", headers=entetes("100259")).json()]
    assert "Souscription IARD" in noms and len(noms) >= 15


def test_referentiel_reserve_a_la_rh(client, entetes):
    assert client.post("/api/talents/competences", headers=entetes("100130"), json={"nom": "X", "domaine": "Y"}).status_code == 403
    assert client.post("/api/talents/competences", headers=entetes("ADMINRH"), json={"nom": "Tableaux de bord", "domaine": "Pilotage"}).status_code == 201


def test_ecarts_et_formations_suggerees(client, entetes, referentiel):
    comp, _ = referentiel
    # Le supérieur direct (Claire) évalue.
    r = client.put("/api/talents/evaluation/100259", headers=entetes("100130"), json={"evaluations": [
        {"competence_id": comp["Contrôle interne et audit"], "niveau": 1},
        {"competence_id": comp["Recouvrement"], "niveau": 3},
        {"competence_id": comp["Excel et outils bureautiques"], "niveau": 2}]})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["emploi"]["intitule"] == "Inspecteur" and p["ecarts"] == 1 and p["couverture"] == 67
    audit = next(l for l in p["competences"] if l["competence"] == "Contrôle interne et audit")
    assert (audit["requis"], audit["acquis"], audit["ecart"]) == (3, 1, 2)
    assert audit["formations"] and "Audit interne" in audit["formations"][0]["titre"]
    # L'intéressé consulte son profil, sans pouvoir s'évaluer.
    moi = client.get("/api/talents/profil/100259", headers=entetes("100259")).json()
    assert moi["ecarts"] == 1 and moi["peut_evaluer"] is False
    assert client.put("/api/talents/evaluation/100259", headers=entetes("100259"), json={"evaluations": []}).status_code == 403


def test_seul_le_superieur_direct_evalue(client, entetes, referentiel):
    comp, _ = referentiel
    corps = {"evaluations": [{"competence_id": comp["Recouvrement"], "niveau": 2}]}
    assert client.put("/api/talents/evaluation/100259", headers=entetes("100281"), json=corps).status_code == 403
    assert client.put("/api/talents/evaluation/100259", headers=entetes("ADMINRH"), json=corps).status_code == 200
    assert client.get("/api/talents/profil/100259", headers=entetes("100281")).status_code == 403


def test_besoins_de_l_equipe(client, entetes, referentiel):
    r = client.get("/api/talents/equipe", headers=entetes("100130")).json()
    julien = next(l for l in r["lignes"] if l["employe"]["matricule"] == "100259")
    assert julien["emploi"] == "Inspecteur" and julien["ecarts"] == 3 and julien["peut_evaluer"] is True
    assert {b["competence"] for b in r["besoins"]} == {"Contrôle interne et audit", "Recouvrement", "Excel et outils bureautiques"}
    assert client.get("/api/talents/equipe", headers=entetes("100259")).status_code == 403


def test_succession_et_risque(client, entetes, db):
    rh = entetes("ADMINRH")
    claire = db.query(Employe).filter_by(matricule="100130").one()
    db.add(DossierEmploye(employe_id=claire.id, date_naissance=date(date.today().year - 59, 1, 1)))
    db.commit()
    p = client.post("/api/talents/postes-cles", headers=rh, json={"intitule": "Directeur Inspection", "titulaire": "100130", "criticite": 3}).json()
    assert p["risque"] == "eleve" and "aucun successeur identifié" in p["motifs"]
    assert any("retraite" in m for m in p["motifs"])
    p = client.post(f"/api/talents/postes-cles/{p['id']}/successeurs", headers=rh, json={"matricule": "100259", "preparation": "1_2_ans"}).json()
    assert p["risque"] == "eleve"          # poste vital, départ proche, personne n'est prêt
    p = client.post(f"/api/talents/postes-cles/{p['id']}/successeurs", headers=rh, json={"matricule": "100281", "preparation": "immediat"}).json()
    assert p["risque"] == "faible" and p["successeurs"][0]["matricule"] == "100281"
    assert client.post(f"/api/talents/postes-cles/{p['id']}/successeurs", headers=rh, json={"matricule": "100130", "preparation": "immediat"}).status_code == 422


def test_succession_confidentielle(client, entetes):
    assert client.get("/api/talents/postes-cles", headers=entetes("100130")).status_code == 403
    assert client.get("/api/talents/postes-cles", headers=entetes("ADMINRH")).status_code == 200
    assert client.post("/api/talents/postes-cles", headers=entetes("100130"), json={"intitule": "X"}).status_code == 403
