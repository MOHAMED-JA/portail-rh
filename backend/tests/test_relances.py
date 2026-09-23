"""Relances quotidiennes par e-mail : demandes, fiches et échéances RH."""
from datetime import date, datetime, timedelta

from app.models import (
    Demande, EmailSortant, Employe, FicheObjectifs, StatutDemande, StatutFicheObjectifs, TypeDemande,
)
from app.services import delegation, parametres, relances


def demande_ancienne(db, heures=48, matricule="100259"):
    employe = db.query(Employe).filter_by(matricule=matricule).one()
    debut = date.today() + timedelta(days=10)
    demande = Demande(reference=f"CG-REL-{matricule}", type_demande=TypeDemande.CONGE, sous_type="annuel",
                      employe_id=employe.id, validateur_id=employe.validateur_id,
                      date_debut=debut, date_fin=debut + timedelta(days=1), nombre_jours=2,
                      statut=StatutDemande.EN_ATTENTE,
                      cree_le=datetime.utcnow() - timedelta(hours=heures))
    db.add(demande)
    db.commit()
    return demande


def destinataires(db):
    return [e.destinataire for e in db.query(EmailSortant).all()]


def test_relance_du_valideur_apres_le_delai(db):
    demande_ancienne(db)
    valideur = db.query(Employe).filter_by(matricule="100130").one()
    resultat = relances.relancer(db)
    assert resultat["demandes"] == 1
    assert valideur.email in destinataires(db)


def test_demande_recente_pas_de_relance(db):
    demande_ancienne(db, heures=2)
    assert relances.relancer(db)["demandes"] == 0


def test_la_relance_va_au_remplacant(db):
    demande_ancienne(db)
    titulaire = db.query(Employe).filter_by(matricule="100130").one()
    suppleant = db.query(Employe).filter_by(matricule="100281").one()
    db.add(delegation.DelegationValidation(
        titulaire_id=titulaire.id, suppleant_id=suppleant.id, debut=date.today(),
        fin=date.today() + timedelta(days=5), cree_par_id=titulaire.id))
    db.commit()

    relances.relancer(db)
    envoyes = destinataires(db)
    assert suppleant.email in envoyes and titulaire.email not in envoyes


def test_relance_des_fiches_en_retard(db):
    employe = db.query(Employe).filter_by(matricule="100259").one()
    db.add(FicheObjectifs(employe_id=employe.id, annee=date.today().year,
                          statut=StatutFicheObjectifs.BROUILLON))
    autre = db.query(Employe).filter_by(matricule="100281").one()
    db.add(FicheObjectifs(employe_id=autre.id, annee=date.today().year,
                          statut=StatutFicheObjectifs.SOUMISE,
                          soumise_le=datetime.utcnow() - timedelta(days=30)))
    db.commit()

    assert relances.relancer(db)["fiches"] == 2
    envoyes = destinataires(db)
    assert employe.email in envoyes                      # au collaborateur : à rédiger
    assert autre.validateur.email in envoyes             # au supérieur : à valider


def test_une_seule_relance_par_jour(db):
    demande_ancienne(db)
    premier = relances.relancer(db)
    assert premier["demandes"] == 1
    second = relances.relancer(db)
    assert second == {"statut": "déjà exécuté aujourd'hui"}
    assert len(destinataires(db)) == len(set(destinataires(db)))


def test_relances_desactivables(db):
    demande_ancienne(db)
    regles = parametres.lire(db, "regles", {}) or {}
    parametres.ecrire(db, "regles", {**regles, "relancesActives": False})
    db.commit()
    assert relances.relancer(db) == {"statut": "relances désactivées"}
    assert destinataires(db) == []
