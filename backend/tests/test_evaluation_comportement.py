"""Note de comportement : saisie par l'administration RH, 20 % de la note finale."""
from datetime import date, datetime

from app.models import Employe, FicheEvaluation, FicheObjectifs, Objectif, StatutFicheObjectifs

ANNEE = date.today().year


def objectifs_valides(db, matricule="100259", note_attendue=None):
    employe = db.query(Employe).filter_by(matricule=matricule).one()
    fiche = FicheObjectifs(employe_id=employe.id, annee=ANNEE, statut=StatutFicheObjectifs.VALIDEE,
                           soumise_le=datetime.utcnow(), validee_le=datetime.utcnow())
    db.add(fiche)
    db.flush()
    objectif = Objectif(fiche_id=fiche.id, titre="Recouvrement", ponderation=100, note=note_attendue)
    db.add(objectif)
    db.commit()
    return objectif.id


def test_la_rh_consulte_toutes_les_fiches_objectifs(client, entetes):
    visibles = {f["employe"]["matricule"] for f in client.get("/api/fiches", headers=entetes("ADMINRH")).json()}
    assert {"100259", "100281", "100130"} <= visibles


def test_note_finale_80_objectifs_20_comportement(client, db, entetes):
    objectif = objectifs_valides(db)
    # Le supérieur note les objectifs puis approuve.
    assert client.put("/api/fiches/100259/evaluation/notes", headers=entetes("100130"),
                      json={"notes": [{"objectif_id": objectif, "note": 16}]}).status_code == 200
    assert client.post("/api/fiches/100259/evaluation/approuver", headers=entetes("100130"),
                       json={}).status_code == 200
    # L'administration RH saisit le comportement, puis valide.
    fiche = client.get("/api/fiches/100259", headers=entetes("ADMINRH")).json()
    assert fiche["droits"]["noter_comportement"] is True
    assert fiche["ponderation_finale"] == {"objectifs": 80, "comportement": 20}
    assert client.put("/api/fiches/100259/evaluation/comportement", headers=entetes("ADMINRH"),
                      json={"note": 11}).status_code == 200
    assert client.post("/api/fiches/100259/evaluation/valider-rh", headers=entetes("ADMINRH"),
                       json={}).status_code == 200

    ev = db.query(FicheEvaluation).filter_by(annee=ANNEE).one()
    db.refresh(ev)
    # 16 × 80 % + 11 × 20 % = 15 (l'ancien barème 70 / 30 aurait donné 14,5).
    assert ev.finalisee_le is not None and ev.note_finale == 15


def test_seule_la_rh_saisit_le_comportement(client, db, entetes):
    objectifs_valides(db, note_attendue=16)
    assert client.put("/api/fiches/100259/evaluation/comportement", headers=entetes("100130"),
                      json={"note": 11}).status_code == 403
    assert client.put("/api/fiches/100259/evaluation/comportement", headers=entetes("100259"),
                      json={"note": 20}).status_code == 403
