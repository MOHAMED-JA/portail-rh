"""Fiches d'objectifs et d'évaluation : l'intéressé et la Direction générale.

- Chaque collaborateur consulte sa fiche d'évaluation, même validée, sans
  pouvoir la modifier.
- Le Directeur général n'a pas de fiche ; il consulte toutes les fiches.
- La Directrice générale adjointe consulte aussi toutes les fiches, sans droit
  d'action ; elle garde sa propre fiche, puisqu'elle a un supérieur.
"""
from datetime import date, datetime

from app.models import Employe, FicheEvaluation, FicheObjectifs, Objectif, StatutFicheObjectifs

ANNEE = date.today().year


def evaluation_finalisee(db, matricule="100259"):
    employe = db.query(Employe).filter_by(matricule=matricule).one()
    fiche = FicheObjectifs(employe_id=employe.id, annee=ANNEE, statut=StatutFicheObjectifs.VALIDEE,
                           soumise_le=datetime.utcnow(), validee_le=datetime.utcnow())
    db.add(fiche)
    db.flush()
    db.add(Objectif(fiche_id=fiche.id, titre="Recouvrement", ponderation=100, note=16))
    maintenant = datetime.utcnow()
    db.add(FicheEvaluation(employe_id=employe.id, annee=ANNEE, note_comportement=15,
                           valide_superieur_le=maintenant, valide_rh_le=maintenant,
                           finalisee_le=maintenant))
    db.commit()


def niveau(db, matricule, valeur):
    employe = db.query(Employe).filter_by(matricule=matricule).one()
    employe.niveau = valeur
    db.commit()


def sans_action(droits):
    return not any(droits[cle] for cle in (
        "modifier_objectifs", "soumettre", "valider_objectifs", "renvoyer_objectifs",
        "noter", "approuver_evaluation", "noter_comportement", "valider_rh"))


def test_le_collaborateur_consulte_sa_fiche_validee_sans_la_modifier(client, db, entetes):
    evaluation_finalisee(db)
    fiche = client.get("/api/fiches/100259", headers=entetes("100259"))
    assert fiche.status_code == 200
    droits = fiche.json()["droits"]
    assert droits["voir_notes"] is True
    assert sans_action(droits)
    # Le plan de développement est figé une fois l'évaluation finalisée.
    assert client.put("/api/fiches/100259/evaluation/developpement", headers=entetes("100259"),
                      json={"formations_souhaitees": ["Excel"]}).status_code == 409


def test_le_directeur_general_na_pas_de_fiche_et_consulte_tout(client, db, entetes):
    evaluation_finalisee(db)
    niveau(db, "100281", "dg")          # hors de la ligne hiérarchique de 100259
    assert client.get("/api/fiches/100281", headers=entetes("100281")).status_code == 409

    fiche = client.get("/api/fiches/100259", headers=entetes("100281"))
    assert fiche.status_code == 200
    assert fiche.json()["droits"]["voir_notes"] is True
    assert sans_action(fiche.json()["droits"])
    visibles = {f["employe"]["matricule"] for f in client.get("/api/fiches", headers=entetes("100281")).json()}
    assert {"100259", "100130"} <= visibles


def test_la_dga_consulte_toutes_les_fiches_sans_agir(client, db, entetes):
    evaluation_finalisee(db)
    niveau(db, "100281", "dga")
    fiche = client.get("/api/fiches/100259", headers=entetes("100281"))
    assert fiche.status_code == 200
    assert fiche.json()["droits"]["voir_notes"] is True
    assert sans_action(fiche.json()["droits"])
    visibles = {f["employe"]["matricule"] for f in client.get("/api/fiches", headers=entetes("100281")).json()}
    assert {"100259", "100130"} <= visibles
    # Elle a un supérieur : sa propre fiche existe.
    assert client.get("/api/fiches/100281", headers=entetes("100281")).status_code == 200


def test_un_collegue_ne_voit_pas_une_fiche_validee_hors_de_sa_ligne(client, db, entetes):
    evaluation_finalisee(db)
    assert client.get("/api/fiches/100259", headers=entetes("100281")).status_code == 403
