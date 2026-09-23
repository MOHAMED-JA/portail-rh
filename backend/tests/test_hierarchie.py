"""Ligne hiérarchique, Direction générale, tableau de bord de l'équipe."""
import json
from datetime import date, time

import pytest

from app.models import (
    CodePresence, Demande, Departement, Employe, Pointage, Role, SoldeConge, StatutDemande, TypeDemande,
)
from app.services import hierarchie


@pytest.fixture
def organisation(db):
    """DG ← Directeur Pôle ← Claire (manager) ← 100259, 100281, NOUVEAU ; une autre
    équipe (Top Manager 100033 ← 100119) hors de la ligne du Directeur Pôle."""
    def employe(matricule, prenom, nom, niveau, chef=None, role=Role.VALIDATEUR):
        e = db.query(Employe).filter_by(matricule=matricule).one_or_none()
        if e is None:
            d = db.query(Departement).first()
            e = Employe(matricule=matricule, prenom=prenom, nom=nom, email=f"{matricule}@exemple.test", poste="Poste",
                        role=role, mot_de_passe_hash="x", departement_id=d.id, doit_changer_mdp=False)
            db.add(e)
            db.flush()
            db.add(SoldeConge(employe_id=e.id, annee=date.today().year, jours_acquis=21))
        e.niveau = niveau
        e.validateur_id = chef.id if chef else None
        return e

    dg = employe("100052", "Olivier", "Roussel", "dg")
    dga = employe("100193", "Nathalie", "Fabre", "dga", dg)
    pole = employe("100131", "Sébastien", "Lambert", "directeur_pole", dg)
    claire = employe("100130", "Claire", "Morel", "manager", pole)
    top = employe("100033", "Monique", "Mercier", "top_manager", dg)
    employe("100119", "Kevin", "Blanchard", "collaborateur", top, Role.EMPLOYE)
    db.query(Employe).filter(Employe.matricule.in_(["100259", "100281"])).update({"validateur_id": claire.id})
    db.commit()
    return {e.matricule: e.id for e in db.query(Employe).all()} | {"_dga": dga.id}


def ids(db, *matricules):
    return {db.query(Employe).filter_by(matricule=m).one().id for m in matricules}


def test_ligne_hierarchique_directe_et_indirecte(db, organisation):
    assert hierarchie.equipe_ids(db, organisation["100131"]) == ids(db, "100130", "100259", "100281", "NOUVEAU")
    assert hierarchie.equipe_ids(db, organisation["100130"]) == ids(db, "100259", "100281", "NOUVEAU")
    assert hierarchie.equipe_ids(db, organisation["100259"]) == set()


def test_direction_generale_voit_tout_le_personnel(db, organisation):
    dga = db.get(Employe, organisation["_dga"])
    tous = {e.id for e in db.query(Employe).all()} - {dga.id}
    assert hierarchie.perimetre_ids(db, dga) == tous


def test_tableau_de_bord_du_directeur_pole(client, entetes, organisation):
    r = client.get("/api/pilotage/equipe", headers=entetes("100131"))
    assert r.status_code == 200, r.text
    vus = {l["employe"]["matricule"] for l in r.json()["lignes"]}
    assert vus == {"100130", "100259", "100281", "NOUVEAU"}
    assert r.json()["portee"] == "ligne"


def test_tableau_de_bord_de_la_direction_generale(client, entetes, organisation):
    r = client.get("/api/pilotage/equipe", headers=entetes("100052")).json()
    assert r["portee"] == "entreprise"
    assert {"100119", "100259", "100193", "ADMINRH"} <= {l["employe"]["matricule"] for l in r["lignes"]}


def test_collaborateur_sans_equipe_refuse(client, entetes, organisation):
    assert client.get("/api/pilotage/equipe", headers=entetes("100259")).status_code == 403


def test_detail_hors_perimetre_refuse(client, entetes, organisation):
    assert client.get("/api/pilotage/collaborateur/100259", headers=entetes("100131")).status_code == 200
    assert client.get("/api/pilotage/collaborateur/100119", headers=entetes("100131")).status_code == 403
    assert client.get("/api/pilotage/collaborateur/100119", headers=entetes("100193")).status_code == 200


def test_aucune_information_confidentielle(client, entetes, organisation):
    for qui in ("100052", "100131"):  # Direction générale et supérieur
        texte = json.dumps(client.get("/api/pilotage/equipe", headers=entetes(qui)).json())
        texte += json.dumps(client.get("/api/pilotage/collaborateur/100259", headers=entetes(qui)).json())
        for interdit in ("note_comportement", "date_naissance", "visite_medicale", "contact_", "salaire", "diplomes"):
            assert interdit not in texte, (qui, interdit)
    # La note finale n'est donnée qu'à la Direction générale (et à la RH).
    assert "note_finale" not in json.dumps(client.get("/api/pilotage/equipe", headers=entetes("100131")).json())
    assert "note_finale" in client.get("/api/pilotage/equipe", headers=entetes("100052")).json()["lignes"][0]


@pytest.fixture
def evaluation_finalisee(db, organisation):
    from datetime import datetime

    from app.models import FicheEvaluation, FicheObjectifs, StatutFicheObjectifs

    julien = organisation["100259"]
    db.add(FicheObjectifs(employe_id=julien, annee=date.today().year, statut=StatutFicheObjectifs.VALIDEE))
    db.add(FicheEvaluation(employe_id=julien, annee=date.today().year, note_objectifs=15, note_comportement=16,
                           note_finale=15.3, valide_superieur_le=datetime.utcnow(), valide_rh_le=datetime.utcnow(),
                           finalisee_le=datetime.utcnow()))
    db.commit()


def test_direction_generale_consulte_les_evaluations_finalisees(client, entetes, evaluation_finalisee):
    for qui in ("100052", "100193"):
        r = client.get("/api/fiches/100259", headers=entetes(qui))
        assert r.status_code == 200, (qui, r.text)
        assert r.json()["evaluation"]["note_finale"] == 15.3
        droits = r.json()["droits"]
        assert not any(droits[k] for k in ("superieur", "rh", "modifier_objectifs", "noter", "approuver_evaluation",
                                           "noter_comportement", "valider_rh", "valider_objectifs"))
    ligne = next(l for l in client.get("/api/pilotage/equipe", headers=entetes("100052")).json()["lignes"]
                 if l["employe"]["matricule"] == "100259")
    assert ligne["note_finale"] == 15.3
    # Les supérieurs (même le direct) n'ont pas accès au détail d'une fiche finalisée.
    assert client.get("/api/fiches/100259", headers=entetes("100130")).status_code == 403
    assert client.get("/api/fiches/100259", headers=entetes("100131")).status_code == 403


def test_direction_generale_ne_modifie_pas_une_evaluation(client, entetes, evaluation_finalisee):
    for qui in ("100052", "100193"):
        h = entetes(qui)
        assert client.put("/api/fiches/100259/evaluation/comportement", headers=h, json={"note": 20}).status_code in (403, 409, 422)
        assert client.post("/api/fiches/100259/evaluation/valider-rh", headers=h, json={}).status_code in (403, 409)
        assert client.post("/api/fiches/100259/evaluation/approuver", headers=h, json={}).status_code in (403, 409)


def test_indicateurs_du_mois(client, entetes, organisation, db):
    julien = organisation["100259"]
    jour = date.today().replace(day=1)
    while jour.weekday() >= 5:
        jour = jour.replace(day=jour.day + 1)
    db.add(Pointage(employe_id=julien, date_jour=jour, entree1=time(8, 20), sortie1=time(12, 0), entree2=time(13, 0),
                    sortie2=time(17, 0), heures_travaillees=7.7, heures_prevues=8, retard_minutes=20,
                    code_presence=CodePresence.PRESENT))
    db.add(Demande(reference="TEST-MAL-1", type_demande=TypeDemande.CONGE, sous_type="maladie", employe_id=julien,
                   date_debut=jour, date_fin=jour, nombre_jours=1, statut=StatutDemande.APPROUVEE))
    db.commit()
    lignes = client.get("/api/pilotage/equipe", headers=entetes("100130")).json()["lignes"]
    ligne = next(l for l in lignes if l["employe"]["matricule"] == "100259")
    assert (ligne["retards"], ligne["retard_minutes"], ligne["jours_presents"]) == (1, 20, 1)
    assert ligne["absences"]["maladie"] == 1


def test_fiche_lisible_par_la_ligne_mais_modifiable_par_le_seul_superieur_direct(client, entetes, organisation):
    direct = client.get("/api/fiches/100259", headers=entetes("100130"))
    indirect = client.get("/api/fiches/100259", headers=entetes("100131"))
    dg = client.get("/api/fiches/100259", headers=entetes("100052"))
    assert direct.status_code == indirect.status_code == dg.status_code == 200
    assert direct.json()["droits"]["superieur"] is True
    assert indirect.json()["droits"]["superieur"] is False
    assert dg.json()["droits"]["superieur"] is False
    assert client.get("/api/fiches/100259", headers=entetes("100119")).status_code == 403


def test_presences_de_la_ligne(client, entetes, organisation):
    julien, kevin = organisation["100259"], organisation["100119"]
    assert client.get(f"/api/presences/pointages?employe_id={julien}", headers=entetes("100131")).status_code == 200
    assert client.get(f"/api/presences/pointages?employe_id={kevin}", headers=entetes("100131")).status_code == 403


def test_niveau_controle_par_l_administration(client, entetes, organisation):
    rh = entetes("ADMINRH")
    julien = organisation["100259"]
    assert client.put(f"/api/administration/employes/{julien}", headers=rh, json={"niveau": "roi"}).status_code == 422
    r = client.put(f"/api/administration/employes/{julien}", headers=rh, json={"niveau": "middle_manager"})
    assert r.status_code == 200 and r.json()["niveau"] == "middle_manager"


def test_la_ligne_et_la_direction_ne_modifient_pas_les_fiches(client, entetes, organisation):
    objectifs = {"objectifs": [{"titre": "Objectif", "ponderation": 100}]}
    for qui in ("100131", "100052"):
        assert client.put("/api/fiches/100259/objectifs", headers=entetes(qui), json=objectifs).status_code == 403
        assert client.post("/api/fiches/100259/objectifs/valider", headers=entetes(qui), json={}).status_code == 403
