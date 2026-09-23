"""Délégation de validation : qui décide quand le supérieur est absent."""
from datetime import date, timedelta

from app.models import Demande, Employe, StatutDemande, TypeDemande
from tests.constantes import MOT_DE_PASSE  # noqa: F401  (cohérence avec les autres suites)


def demande_en_attente(db, matricule="100259"):
    """Demande du collaborateur, adressée à son supérieur hiérarchique."""
    employe = db.query(Employe).filter_by(matricule=matricule).one()
    debut = date.today() + timedelta(days=10)
    demande = Demande(reference=f"CG-DEL-{matricule}", type_demande=TypeDemande.CONGE, sous_type="annuel",
                      employe_id=employe.id, validateur_id=employe.validateur_id,
                      date_debut=debut, date_fin=debut + timedelta(days=2), nombre_jours=3,
                      statut=StatutDemande.EN_ATTENTE)
    db.add(demande)
    db.commit()
    db.refresh(demande)
    return demande


def periode(jours_avant=0, jours_apres=7):
    return {"debut": str(date.today() - timedelta(days=jours_avant)),
            "fin": str(date.today() + timedelta(days=jours_apres))}


def test_le_remplacant_voit_et_decide(client, db, entetes):
    demande = demande_en_attente(db)
    titulaire = db.query(Employe).filter_by(matricule="100130").one()   # supérieur de 100259
    assert demande.validateur_id == titulaire.id

    # Avant délégation, un collègue sans lien hiérarchique ne peut rien.
    assert client.post(f"/api/demandes/{demande.id}/approuver", headers=entetes("100281"),
                       json={}).status_code == 403

    r = client.post("/api/delegations", headers=entetes("100130"), json={
        "suppleant_id": db.query(Employe).filter_by(matricule="100281").one().id,
        **periode(), "motif": "Congé annuel"})
    assert r.status_code == 201 and r.json()["en_cours"] is True

    file_remplacant = client.get("/api/demandes/a-valider", headers=entetes("100281")).json()
    assert demande.reference in [d["reference"] for d in file_remplacant]

    decision = client.post(f"/api/demandes/{demande.id}/approuver", headers=entetes("100281"), json={})
    assert decision.status_code == 200
    db.refresh(demande)
    assert demande.statut == StatutDemande.APPROUVEE


def test_delegation_expiree_ne_donne_plus_rien(client, db, entetes):
    demande = demande_en_attente(db)
    suppleant = db.query(Employe).filter_by(matricule="100281").one()
    r = client.post("/api/delegations", headers=entetes("100130"), json={
        "suppleant_id": suppleant.id, "debut": str(date.today() - timedelta(days=30)),
        "fin": str(date.today() + timedelta(days=1))})
    delegation_id = r.json()["id"]

    assert client.delete(f"/api/delegations/{delegation_id}", headers=entetes("100130")).status_code == 204
    assert client.post(f"/api/demandes/{demande.id}/approuver", headers=entetes("100281"),
                       json={}).status_code == 403
    # Sans délégation en cours, un collaborateur simple n a plus accès à la file.
    assert client.get("/api/demandes/a-valider", headers=entetes("100281")).status_code == 403


def test_refus_des_delegations_incoherentes(client, db, entetes):
    moi = db.query(Employe).filter_by(matricule="100130").one()
    autre = db.query(Employe).filter_by(matricule="100281").one()

    assert client.post("/api/delegations", headers=entetes("100130"),
                       json={"suppleant_id": moi.id, **periode()}).status_code == 422
    assert client.post("/api/delegations", headers=entetes("100130"), json={
        "suppleant_id": autre.id, "debut": str(date.today() + timedelta(days=5)),
        "fin": str(date.today())}).status_code == 422
    assert client.post("/api/delegations", headers=entetes("100130"), json={
        "suppleant_id": autre.id, "debut": str(date.today() - timedelta(days=60)),
        "fin": str(date.today() - timedelta(days=30))}).status_code == 422
    assert client.post("/api/delegations", headers=entetes("100130"), json={
        "suppleant_id": autre.id, "debut": str(date.today()),
        "fin": str(date.today() + timedelta(days=400))}).status_code == 422

    assert client.post("/api/delegations", headers=entetes("100130"),
                       json={"suppleant_id": autre.id, **periode()}).status_code == 201
    # Deux délégations qui se chevauchent : on ne saurait plus qui décide.
    assert client.post("/api/delegations", headers=entetes("100130"),
                       json={"suppleant_id": autre.id, **periode()}).status_code == 409
    # Le remplaçant ne délègue pas à son tour.
    assert client.post("/api/delegations", headers=entetes("100281"),
                       json={"suppleant_id": moi.id, **periode()}).status_code == 409


def test_seuls_le_titulaire_et_la_rh_gerent_la_delegation(client, db, entetes):
    autre = db.query(Employe).filter_by(matricule="100281").one()
    # Déléguer pour quelqu'un d'autre : réservé à la RH.
    assert client.post("/api/delegations", headers=entetes("100130"), json={
        "titulaire_id": autre.id, "suppleant_id": db.query(Employe).filter_by(matricule="100259").one().id,
        **periode()}).status_code == 403
    r = client.post("/api/delegations", headers=entetes("ADMINRH"), json={
        "titulaire_id": db.query(Employe).filter_by(matricule="100130").one().id,
        "suppleant_id": autre.id, **periode()})
    assert r.status_code == 201

    assert client.get("/api/delegations?toutes=true", headers=entetes("100259")).status_code == 403
    assert len(client.get("/api/delegations?toutes=true", headers=entetes("ADMINRH")).json()) == 1
    valideurs = client.get("/api/delegations/valideurs", headers=entetes("ADMINRH")).json()
    assert any(v["remplacant"] and v["employe"]["matricule"] == "100130" for v in valideurs)
