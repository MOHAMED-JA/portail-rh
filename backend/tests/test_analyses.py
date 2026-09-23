"""Analyses RH : Bradford, risque de départ, charge en période de congés."""
from datetime import date, timedelta

from app.models import (
    Anomalie, Demande, Employe, FicheEvaluation, StatutAnomalie, StatutDemande, TypeAnomalie, TypeDemande,
)
from app.routers.analyses import bradford, risque_depart


def jour_ouvre(recul):
    j = date.today() - timedelta(days=recul)
    while j.weekday() >= 5:
        j -= timedelta(days=1)
    return j


def absences(db, employe, n_episodes):
    """n congés maladie d'un jour, espacés d'une semaine."""
    for i in range(n_episodes):
        j = jour_ouvre(10 + 7 * i)
        db.add(Demande(reference=f"MAL-{employe.id}-{i}", type_demande=TypeDemande.CONGE, sous_type="maladie", employe_id=employe.id,
                       date_debut=j, date_fin=j, nombre_jours=1, statut=StatutDemande.APPROUVEE))
    db.commit()


def test_bradford_calcul(db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    absences(db, julien, 4)                                  # 4 épisodes, 4 jours → 4² × 4 = 64
    b = bradford(db, julien)
    assert (b["episodes"], b["jours"], b["indice"], b["niveau"]) == (4, 4, 64, "surveiller")


def test_absences_injustifiees_consecutives_fusionnees(db):
    paul = db.query(Employe).filter_by(matricule="100281").one()
    lundi = date.today() - timedelta(days=date.today().weekday() + 14)
    for k in range(3):                                     # lundi, mardi, mercredi : un seul épisode
        db.add(Anomalie(employe_id=paul.id, date_jour=lundi + timedelta(days=k), type_anomalie=TypeAnomalie.ABSENCE_NON_JUSTIFIEE,
                        statut=StatutAnomalie.OUVERTE))
    db.commit()
    b = bradford(db, paul)
    assert (b["episodes"], b["jours"], b["indice"]) == (1, 3, 3)


def test_bradford_confidentialite(client, entetes, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    absences(db, julien, 4)
    assert client.get("/api/analyses/bradford", headers=entetes("100130")).status_code == 403
    rh = client.get("/api/analyses/bradford", headers=entetes("ADMINRH")).json()
    assert rh["collaborateurs"][0]["employe"]["matricule"] == "100259" and rh["collaborateurs"][0]["indice"] == 64
    dg = db.query(Employe).filter_by(matricule="100130").one()
    dg.niveau = "dg"
    db.commit()
    vue_dg = client.get("/api/analyses/bradford", headers=entetes("100130")).json()
    assert vue_dg["collaborateurs"] is None                                        # pas de détail nominatif
    assert sum(a["a_surveiller"] for a in vue_dg["par_direction"]) == 1


def test_risque_de_depart(db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    julien.date_entree = date.today() - timedelta(days=200)
    db.add(FicheEvaluation(employe_id=julien.id, annee=date.today().year, mobilite_type="geographique"))
    db.commit()
    r = risque_depart(db, julien)
    assert "Souhait de mobilité exprimé" in r["motifs"] and "Moins de 2 ans d'ancienneté" in r["motifs"]
    assert r["score"] == 45 and r["niveau"] == "eleve"     # 15 + 20 + 10 (pas de formation)


def test_risque_de_depart_acces(client, entetes):
    assert client.get("/api/analyses/risque-depart", headers=entetes("100130")).status_code == 403
    r = client.get("/api/analyses/risque-depart", headers=entetes("ADMINRH")).json()
    assert r["par_direction"] and isinstance(r["collaborateurs"], list)


def test_charge_en_periode_de_conges(client, entetes, db):
    julien = db.query(Employe).filter_by(matricule="100259").one()
    lundi = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=2)
    db.add(Demande(reference="CG-CHARGE", type_demande=TypeDemande.CONGE, sous_type="annuel", employe_id=julien.id,
                   date_debut=lundi, date_fin=lundi + timedelta(days=4), nombre_jours=5, statut=StatutDemande.APPROUVEE))
    db.commit()
    r = client.get("/api/analyses/charge-conges?semaines=4&seuil=90", headers=entetes("100130")).json()
    semaine = r["semaines"][2]["directions"]["Direction Audit et Contrôle"]
    # Ligne de Claire : 100259, 100281, NOUVEAU → 3 personnes, 1 absente toute la semaine.
    assert (semaine["effectif"], semaine["absents"], semaine["presence"], semaine["alerte"]) == (3, 1, 67, True)
    assert r["semaines"][1]["directions"]["Direction Audit et Contrôle"]["presence"] == 100
    assert client.get("/api/analyses/charge-conges", headers=entetes("100259")).status_code == 403
