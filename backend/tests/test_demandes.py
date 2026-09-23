"""Congés et autorisations : dépôt, validation, solde, plafonds."""
from datetime import date, timedelta

from app.models import Demande, SoldeConge
from app.services.calendrier import compter_jours_conge


def semaine_ouvree_libre() -> tuple[date, date]:
    """Prochaine semaine complète (lundi → vendredi) sans jour férié, dans l'année."""
    jour = date.today() + timedelta(days=7)
    jour += timedelta(days=(7 - jour.weekday()) % 7)
    while True:
        fin = jour + timedelta(days=4)
        if compter_jours_conge(jour, fin) == 5 and fin.year == jour.year:
            return jour, fin
        jour += timedelta(days=7)


def test_conge_approuve_decompte_le_solde(client, entetes, db):
    debut, fin = semaine_ouvree_libre()
    r = client.post("/api/demandes/conge", headers=entetes("100259"),
                    json={"sous_type": "annuel", "date_debut": str(debut), "date_fin": str(fin)})
    assert r.status_code == 201, r.text
    demande = r.json()
    assert demande["nombre_jours"] == 5

    # Un autre collaborateur ne peut pas valider.
    assert client.post(f"/api/demandes/{demande['id']}/approuver", headers=entetes("100281")).status_code in (403, 404)

    r = client.post(f"/api/demandes/{demande['id']}/approuver", headers=entetes("100130"), json={})
    assert r.status_code == 200, r.text
    assert r.json()["statut"] == "approuvee"
    solde = db.query(SoldeConge).join(SoldeConge.employe).filter_by(matricule="100259").filter(SoldeConge.annee == debut.year).one()
    assert solde.jours_pris == 5


def test_conge_solde_insuffisant_est_transmis_a_la_rh(client, entetes, db):
    """Un solde insuffisant n'interdit pas le dépôt : la RH décide de l'exception."""
    debut, fin = semaine_ouvree_libre()
    solde = db.query(SoldeConge).join(SoldeConge.employe).filter_by(matricule="100259").filter(
        SoldeConge.annee == debut.year
    ).one()
    solde.jours_acquis = 0
    solde.jours_pris = 0
    db.commit()

    reponse = client.post("/api/demandes/conge", headers=entetes("100259"), json={
        "sous_type": "annuel", "date_debut": str(debut), "date_fin": str(fin)
    })
    assert reponse.status_code == 201, reponse.text
    assert reponse.json()["solde_insuffisant"] is True
    demande = db.get(Demande, reponse.json()["id"])
    assert demande.solde_insuffisant is True
    assert demande.validateur.role.value in {"admin_rh", "gestionnaire_rh"}


def test_conge_sur_un_week_end_refuse(client, entetes):
    samedi = date.today() + timedelta(days=(5 - date.today().weekday()) % 7 + 7)
    r = client.post("/api/demandes/conge", headers=entetes("100259"),
                    json={"sous_type": "annuel", "date_debut": str(samedi), "date_fin": str(samedi + timedelta(days=1))})
    assert r.status_code == 422


def test_dates_inversees_refusees(client, entetes):
    debut, fin = semaine_ouvree_libre()
    r = client.post("/api/demandes/conge", headers=entetes("100259"),
                    json={"sous_type": "annuel", "date_debut": str(fin), "date_fin": str(debut)})
    assert r.status_code == 422


def test_autorisation_limitee_a_une_heure_trente(client, entetes):
    debut, _ = semaine_ouvree_libre()
    r = client.post("/api/demandes/autorisation", headers=entetes("100259"), json={
        "sous_type": "perso", "date_debut": str(debut), "heure_debut": "09:00", "heure_fin": "11:00"})
    assert r.status_code == 422
    assert "1h30" in r.json()["detail"] or "1 h 30" in r.json()["detail"]


def test_au_dela_de_quatre_heures_par_mois_derogation_rh(client, entetes, db):
    debut, _ = semaine_ouvree_libre()
    ids = []
    for jour in range(3):  # 3 × 1h30 = 4h30 > 4h
        r = client.post("/api/demandes/autorisation", headers=entetes("100259"), json={
            "sous_type": "perso", "date_debut": str(debut + timedelta(days=jour)),
            "heure_debut": "09:00", "heure_fin": "10:30"})
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    derogations = [db.get(Demande, i).derogation_rh for i in ids]
    assert derogations == [False, False, True]
