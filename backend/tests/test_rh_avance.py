"""Livraison 1.34 : adresse personnelle, Directeur général sans fiche
d'objectifs, générateur de documents, habilitations obligatoires,
rémunération et simulation, indicateurs clés, revue des talents, entretiens
de sortie et bilan social individuel."""
import hashlib
import io
from datetime import date, datetime, timedelta

from openpyxl import Workbook
from sqlalchemy import text

from app.models import (
    DemandeDocument, DocumentEmis, Employe, FicheEvaluation, JournalAudit, Notification, Remuneration,
    StatutEmploye,
)
from app.services import habilitations


def _employe(db, matricule):
    return db.query(Employe).filter_by(matricule=matricule).one()


def _notifications(db, matricule, titre):
    db.expire_all()
    return db.query(Notification).filter_by(destinataire_id=_employe(db, matricule).id, titre=titre).count()


# ------------------------------------------------------------------ Adresse
def test_adresse_modifiee_par_l_interesse_notifie_la_rh(client, entetes, db):
    corps = {"adresse": "12 rue de Marseille", "code_postal": "1000", "ville": "Tunis"}
    r = client.put("/api/sirh/adresse/100259", json=corps, headers=entetes("100259"))
    assert r.status_code == 200, r.text
    assert r.json()["ville"] == "Tunis" and r.json()["adresse_modifiee_le"]
    assert _notifications(db, "ADMINRH", "Changement d'adresse") == 1
    assert db.query(JournalAudit).filter_by(action="adresse_modifiee", cible="100259").count() == 1

    # Même adresse renvoyée : ni notification ni trace de plus.
    client.put("/api/sirh/adresse/100259", json=corps, headers=entetes("100259"))
    assert _notifications(db, "ADMINRH", "Changement d'adresse") == 1

    # Nouvelle adresse : la RH voit l'ancienne et la nouvelle.
    client.put("/api/sirh/adresse/100259", json={**corps, "ville": "Ariana", "code_postal": "2080"}, headers=entetes("100259"))
    db.expire_all()
    derniere = db.query(Notification).filter_by(titre="Changement d'adresse").order_by(Notification.id.desc()).first()
    assert "Tunis" in derniere.message and "Ariana" in derniere.message

    # Personne d'autre ne modifie l'adresse d'un collègue.
    assert client.put("/api/sirh/adresse/100259", json=corps, headers=entetes("100281")).status_code == 403
    assert client.get("/api/sirh/dossier/100259", headers=entetes("100259")).json()["adresse"] == "12 rue de Marseille"


# ------------------------------------------------------------------ Directeur général
def test_directeur_general_sans_fiche_d_objectifs(client, entetes, db):
    dg = _employe(db, "100130")
    dg.niveau = "dg"
    db.commit()
    r = client.get("/api/fiches/100130", headers=entetes("ADMINRH"))
    assert r.status_code == 409 and "Directeur général" in r.json()["detail"]
    assert client.get("/api/fiches/100130", headers=entetes("100130")).status_code == 409
    matricules = [l["employe"]["matricule"] for l in client.get("/api/fiches", headers=entetes("ADMINRH")).json()]
    assert "100130" not in matricules and "100259" in matricules
    suivi = client.get("/api/fiches/suivi/responsables", headers=entetes("ADMINRH")).json()
    assert all(c["employe"]["matricule"] != "100130" for l in suivi for c in l["collaborateurs"])
    # Les autres gardent leur fiche.
    assert client.get("/api/fiches/100259", headers=entetes("ADMINRH")).status_code == 200


# ------------------------------------------------------------------ Générateur de documents
def test_generateur_numerote_verifie_et_annule(client, entetes, db):
    r = client.post("/api/generateur/generer", headers=entetes("ADMINRH"), json={
        "matricule": "100259", "type_document": "attestation_salaire",
        "champs": {"salaire_brut": "2450,5", "salaire_net": 1890, "motif": "Dossier bancaire"}})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["numero"] == f"SAL-{date.today().year}-00001"
    pdf = client.get(f"/api/generateur/{doc['id']}/pdf", headers=entetes("100259"))
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert client.get(f"/api/generateur/{doc['id']}/pdf", headers=entetes("100281")).status_code == 403
    assert _notifications(db, "100259", "Document RH disponible") == 1

    v = client.get(f"/api/generateur/verifier/{doc['code']}?format=json").json()
    assert v["trouve"] and v["valide"] and v["numero"] == doc["numero"] and "2450" not in str(v)
    assert "authentique" in client.get(f"/api/generateur/verifier/{doc['code']}").text
    assert client.get("/api/generateur/verifier/0000-0000-0000?format=json").json()["trouve"] is False

    # Montants chiffrés en base.
    brut = db.execute(text("select donnees from documents_emis where id = :i"), {"i": doc["id"]}).scalar()
    assert brut.startswith("chiffre:") and "2450" not in brut

    assert client.post(f"/api/generateur/{doc['id']}/annuler", json={"motif": "Erreur de montant"},
                       headers=entetes("ADMINRH")).status_code == 200
    assert client.get(f"/api/generateur/verifier/{doc['code']}?format=json").json()["valide"] is False
    assert client.get(f"/api/generateur/{doc['id']}/pdf", headers=entetes("100259")).status_code == 403
    assert client.get("/api/generateur/mes-documents", headers=entetes("100259")).json() == []

    second = client.post("/api/generateur/generer", headers=entetes("ADMINRH"), json={
        "matricule": "100259", "type_document": "attestation_salaire", "champs": {"salaire_brut": 2500}}).json()
    assert second["numero"].endswith("-00002")


def test_generateur_refuse_les_donnees_manquantes_et_traite_la_demande(client, entetes, db):
    rh = entetes("ADMINRH")
    manque = client.post("/api/generateur/generer", headers=rh, json={
        "matricule": "100259", "type_document": "attestation_salaire", "champs": {}})
    assert manque.status_code == 422
    sans_entree = client.post("/api/generateur/generer", headers=rh, json={
        "matricule": "100259", "type_document": "certificat_travail", "champs": {}})
    assert sans_entree.status_code == 422 and "Date d'entrée" in sans_entree.json()["detail"]
    rib = client.post("/api/generateur/generer", headers=rh, json={
        "matricule": "100259", "type_document": "domiciliation_salaire", "champs": {"banque": "Banque Exemple", "rib": "123"}})
    assert rib.status_code == 422
    assert client.post("/api/generateur/generer", headers=entetes("100259"), json={
        "matricule": "100259", "type_document": "attestation_travail"}).status_code == 403

    demande = client.post("/api/sirh/documents", headers=entetes("100259"),
                          json={"type_document": "attestation_travail", "motif": "Visa"}).json()
    doc = client.post("/api/generateur/generer", headers=rh, json={
        "matricule": "100259", "type_document": "attestation_travail", "demande_id": demande["id"]}).json()
    db.expire_all()
    d = db.get(DemandeDocument, demande["id"])
    assert d.statut == "prete" and d.fichier == f"/api/generateur/{doc['id']}/pdf"
    # Une demande d'un autre collaborateur ne peut pas être rattachée.
    assert client.post("/api/generateur/generer", headers=rh, json={
        "matricule": "100281", "type_document": "attestation_travail", "demande_id": demande["id"]}).status_code == 404
    assert len(client.get("/api/generateur/registre?q=Garnier", headers=rh).json()) == 1


# ------------------------------------------------------------------ Habilitations
def test_habilitations_statuts_conformite_et_relances(client, entetes, db):
    rh = entetes("ADMINRH")
    h = client.post("/api/habilitations", headers=rh, json={
        "intitule": "Lutte contre le blanchiment (LBC/FT)", "periodicite_mois": 12, "population": "tous"})
    assert h.status_code == 200, h.text
    hid = h.json()["id"]
    assert client.post("/api/habilitations", headers=rh, json={
        "intitule": "Réservée", "population": "niveaux", "cibles": ["inconnu"]}).status_code == 422
    assert client.post("/api/habilitations", headers=entetes("100259"), json={"intitule": "Essai"}).status_code == 403

    conf = client.get("/api/habilitations/conformite", headers=rh).json()
    assert conf["compteurs"]["manquante"] == conf["exigences"] >= 4 and conf["taux_global"] == 0

    bientot = date.today() - timedelta(days=340)          # expire dans ~25 jours
    r = client.post("/api/habilitations/collaborateur/100259", headers=rh,
                    json={"habilitation_id": hid, "obtenue_le": bientot.isoformat()})
    assert r.status_code == 200, r.text
    ligne = next(l for l in r.json()["exigences"] if l["habilitation"]["id"] == hid)
    assert ligne["statut"] == "a_renouveler" and ligne["obtention"]["expire_le"]

    ancienne = date.today() - timedelta(days=420)
    client.post("/api/habilitations/collaborateur/100281", headers=rh,
                json={"habilitation_id": hid, "obtenue_le": ancienne.isoformat()})
    moi = client.get("/api/habilitations/moi", headers=entetes("100281")).json()
    assert moi["exigences"][0]["statut"] == "expiree"

    assert habilitations.relancer(db)["relances"] == 2
    db.commit()
    assert _notifications(db, "100259", "Habilitation à renouveler") == 1
    assert _notifications(db, "100281", "Habilitation expirée") == 1
    assert _notifications(db, "100130", "Habilitation expirée dans votre équipe") == 1
    assert habilitations.relancer(db)["relances"] == 0       # un seuil n'est signalé qu'une fois

    # Le supérieur voit sa ligne ; un collaborateur sans équipe, non.
    assert client.get("/api/habilitations/conformite", headers=entetes("100130")).status_code == 200
    assert client.get("/api/habilitations/conformite", headers=entetes("100259")).status_code == 403
    # Référentiel suivi : désactivé, pas supprimé.
    assert client.delete(f"/api/habilitations/{hid}", headers=rh).json()["statut"] == "desactivee"


# ------------------------------------------------------------------ Rémunération et simulation
def test_remuneration_confidentielle_import_et_simulation(client, entetes, db):
    rh = entetes("ADMINRH")
    corps = {"salaire_base": 2000, "primes_fixes": 300, "salaire_net": 1800, "mois_payes": 13}
    assert client.put("/api/remuneration/collaborateur/100259", json=corps, headers=entetes("100259")).status_code == 403
    assert client.put("/api/remuneration/collaborateur/100259", json=corps, headers=rh).status_code == 200
    brut = db.execute(text("select salaire_base from remunerations")).scalar()
    assert brut.startswith("chiffre:") and "2000" not in brut
    audit = db.query(JournalAudit).filter_by(action="remuneration_modifiee").one()
    assert "2000" not in (audit.detail or "")
    assert client.get("/api/remuneration", headers=entetes("100130")).status_code == 403

    # Import : une erreur bloque tout ; corrigé, il s'applique.
    classeur = Workbook()
    f = classeur.active
    f.append(["Matricule"] * 10)
    f.append(["100281", "Benoit", "Paul", "", 1500, 100, 1200, 12, "Banque Exemple", "123"])
    tampon = io.BytesIO()
    classeur.save(tampon)
    r = client.post("/api/remuneration/import?appliquer=true", headers=rh,
                    files={"fichier": ("r.xlsx", tampon.getvalue(), "application/octet-stream")}).json()
    assert r["erreurs"] and not r["applique"]
    f["J2"] = "12345678901234567890"
    tampon = io.BytesIO()
    classeur.save(tampon)
    r = client.post("/api/remuneration/import?appliquer=true", headers=rh,
                    files={"fichier": ("r.xlsx", tampon.getvalue(), "application/octet-stream")}).json()
    assert r["applique"] and r["lignes"] == 1

    # Performance élevée → mérite de 4 % ; application en juillet (6 mois sur 12).
    annee = date.today().year + 1
    db.add(FicheEvaluation(employe_id=_employe(db, "100259").id, annee=annee - 1, note_finale=16,
                           finalisee_le=datetime.utcnow()))
    db.commit()
    sim = client.post("/api/remuneration/simulation", headers=rh, json={
        "annee": annee, "augmentation_generale": 1, "merite": {"1": 0, "2": 2, "3": 4, "0": 0}, "mois_effet": 7,
        "enveloppe": 1000}).json()
    ligne = next(l for l in sim["collaborateurs"] if l["employe"]["matricule"] == "100259")
    assert ligne["performance"] == 3 and ligne["taux"] == 5
    charges = 1 + sim["reglages"]["taux_charges"] / 100
    assert abs(ligne["cout_annee_pleine"] - 2000 * 0.05 * 13 * charges) < 0.01
    assert abs(ligne["cout_annee"] - ligne["cout_annee_pleine"] / 2) < 0.01
    assert sim["non_valorises"] >= 2 and sim["ecart_enveloppe"] is not None

    dg = _employe(db, "100130")
    dg.niveau = "dg"
    db.commit()
    agrege = client.post("/api/remuneration/simulation", headers=entetes("100130"), json={"annee": annee}).json()
    assert agrege["collaborateurs"] is None and agrege["par_direction"]
    assert client.post("/api/remuneration/simulation", headers=entetes("100259"), json={}).status_code == 403


# ------------------------------------------------------------------ Indicateurs clés
def test_indicateurs_encadrement_decisions_et_conges(client, entetes, db):
    client.put("/api/remuneration/collaborateur/100259", json={"salaire_base": 2200, "mois_payes": 12},
               headers=entetes("ADMINRH"))
    d = client.get("/api/indicateurs", headers=entetes("ADMINRH")).json()
    chef = next(r for r in d["organisation"]["detail"] if r["responsable"]["matricule"] == "100130")
    assert chef["directs"] == 3 and d["organisation"]["niveaux_hierarchiques"] >= 2
    assert d["conges"]["valeur"] > 0 and d["conges"]["non_valorises"] >= 1
    assert d["conges"]["collaborateurs"] is not None
    assert "decisions" in d and d["decisions"]["delai_cible_heures"] == 48
    assert client.get("/api/indicateurs", headers=entetes("100130")).status_code == 403


# ------------------------------------------------------------------ Revue des talents
def test_revue_des_talents_proposition_et_calibration(client, entetes, db):
    annee = date.today().year
    db.add(FicheEvaluation(employe_id=_employe(db, "100259").id, annee=annee, note_finale=15.5,
                           finalisee_le=datetime.utcnow()))
    db.commit()
    assert client.put("/api/revue-talents/100259/potentiel", json={"annee": annee, "potentiel": 3},
                      headers=entetes("100281")).status_code == 403
    assert client.put("/api/revue-talents/100259/potentiel", json={"annee": annee, "potentiel": 3, "commentaire": "Moteur"},
                      headers=entetes("100130")).status_code == 200
    equipe = client.get("/api/revue-talents/equipe", headers=entetes("100130")).json()
    assert next(c for c in equipe["collaborateurs"] if c["matricule"] == "100259")["potentiel_propose"] == 3
    # Le supérieur ne voit pas la grille (elle révèle les notes).
    assert client.get("/api/revue-talents", headers=entetes("100130")).status_code == 403

    grille = client.get(f"/api/revue-talents?annee={annee}", headers=entetes("ADMINRH")).json()
    case = next(c for c in grille["cases"] if c["cle"] == "3-3")
    assert [x["matricule"] for x in case["collaborateurs"]] == ["100259"]
    assert any(x["matricule"] == "100281" for x in grille["non_positionnes"])

    assert client.put("/api/revue-talents/100259/calibrer", json={"annee": annee, "performance": 2, "potentiel": 3},
                      headers=entetes("ADMINRH")).status_code == 200
    grille = client.get(f"/api/revue-talents?annee={annee}", headers=entetes("ADMINRH")).json()
    assert any(x["matricule"] == "100259" for x in next(c for c in grille["cases"] if c["cle"] == "2-3")["collaborateurs"])


# ------------------------------------------------------------------ Entretiens de sortie
def test_entretien_de_sortie_et_analyse_des_departs(client, entetes, db):
    rh = entetes("ADMINRH")
    corps = {"date_entretien": date.today().isoformat(), "motif_principal": "evolution",
             "motifs_secondaires": ["remuneration"], "recommanderait": 9, "depart_regrette": True,
             "points_forts": "Équipe soudée", "axes_amelioration": "Perspectives"}
    assert client.put("/api/departs/100281/entretien", json=corps, headers=rh).status_code == 422   # pas encore sorti
    e = _employe(db, "100281")
    e.statut, e.date_sortie, e.motif_sortie = StatutEmploye.SORTI, date.today() - timedelta(days=10), "demission"
    db.commit()
    assert client.put("/api/departs/100281/entretien", json={**corps, "motif_principal": "inconnu"}, headers=rh).status_code == 422
    assert client.put("/api/departs/100281/entretien", json=corps, headers=rh).status_code == 200
    brut = db.execute(text("select points_forts from entretiens_sortie")).scalar()
    assert brut.startswith("chiffre:")

    a = client.get("/api/departs", headers=rh).json()
    assert a["departs"] == 1 and a["entretiens_realises"] == 1 and a["departs_regrettes"] == 1
    assert a["taux_depart_volontaire"] > 0 and a["recommandation_nette"] == 100
    assert a["par_motif_depart"][0]["motif"] == "evolution"
    assert a["collaborateurs"][0]["entretien"]["points_forts"] == "Équipe soudée"
    assert client.get("/api/departs", headers=entetes("100259")).status_code == 403


# ------------------------------------------------------------------ Bilan social individuel
def test_bilan_social_individuel_reserve(client, entetes, db):
    client.put("/api/remuneration/collaborateur/100259", json={"salaire_base": 2000, "primes_fixes": 250},
               headers=entetes("ADMINRH"))
    r = client.get("/api/bilan-individuel/100259.pdf", headers=entetes("100259"))
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert client.get("/api/bilan-individuel/100259.pdf", headers=entetes("ADMINRH")).status_code == 200
    assert client.get("/api/bilan-individuel/100259.pdf", headers=entetes("100130")).status_code == 403
    assert client.get(f"/api/bilan-individuel/100259.pdf?annee={date.today().year + 1}",
                      headers=entetes("100259")).status_code == 422


# ------------------------------------------------- Corrections de la relecture du 23/09 (1.35.2)
def _classeur(*lignes) -> bytes:
    classeur = Workbook()
    f = classeur.active
    f.append(["Matricule"] * 10)
    for ligne in lignes:
        f.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def test_generateur_conflit_de_numero_n_ecrase_pas_le_pdf(client, entetes, db, monkeypatch):
    """Deux émissions simultanées lisent le même dernier numéro : la seconde
    tire un autre numéro et le PDF de la première reste intact."""
    from app.services import generateur

    rh = entetes("ADMINRH")
    corps = {"matricule": "100259", "type_document": "attestation_salaire", "champs": {"salaire_brut": 2450}}
    premier = client.post("/api/generateur/generer", headers=rh, json=corps).json()
    chemin = generateur.DOSSIER / f"{premier['numero']}.pdf"
    empreinte = hashlib.sha256(chemin.read_bytes()).hexdigest()
    assert db.get(DocumentEmis, premier["id"]).empreinte == empreinte

    vrai_numero, lectures = generateur._numero, []

    def numero_perime(session, prefixe):
        lectures.append(prefixe)
        # Première lecture : le numéro qu'une émission concurrente vient de prendre.
        return premier["numero"] if len(lectures) == 1 else vrai_numero(session, prefixe)

    monkeypatch.setattr(generateur, "_numero", numero_perime)
    second = client.post("/api/generateur/generer", headers=rh, json=corps)
    assert second.status_code == 200, second.text
    assert second.json()["numero"] != premier["numero"] and len(lectures) == 2
    assert hashlib.sha256(chemin.read_bytes()).hexdigest() == empreinte
    db.expire_all()
    second_doc = db.get(DocumentEmis, second.json()["id"])
    assert second_doc.empreinte == hashlib.sha256((generateur.DOSSIER / second_doc.fichier).read_bytes()).hexdigest()

    # Numéro toujours pris : refus propre (409), aucun fichier touché ni laissé.
    monkeypatch.setattr(generateur, "_numero", lambda session, prefixe: premier["numero"])
    bloque = client.post("/api/generateur/generer", headers=rh, json=corps)
    assert bloque.status_code == 409 and "relancez" in bloque.json()["detail"]
    assert hashlib.sha256(chemin.read_bytes()).hexdigest() == empreinte
    assert db.query(DocumentEmis).count() == 2
    assert not list(generateur.DOSSIER.glob("*.tmp"))


def test_remuneration_saisie_et_import_memes_controles(client, entetes, db):
    rh = entetes("ADMINRH")
    r = client.put("/api/remuneration/collaborateur/100259", headers=rh,
                   json={"salaire_base": 2000, "primes_fixes": -3000, "salaire_net": -500})
    assert r.status_code == 422
    assert "primes fixes" in r.json()["detail"] and "salaire net" in r.json()["detail"]
    r = client.put("/api/remuneration/collaborateur/100259", headers=rh, json={"salaire_base": 2000, "rib": "123"})
    assert r.status_code == 422 and "RIB" in r.json()["detail"]

    # L'import applique les mêmes règles et n'écrit rien tant qu'une ligne est fausse.
    for ligne, attendu in (
        (["100259", "", "", "", 2000, -3000, -500, 12], "primes fixes"),
        (["100259", "", "", "", "NaN", 0, 1500, 12], "salaire de base"),
        (["100259", "", "", "", 2000, "inf", 1500, 12], "primes fixes"),
        (["100259", "", "", "", 2000, 0, 1500, 11], "mois payés"),
    ):
        r = client.post("/api/remuneration/import?appliquer=true", headers=rh,
                        files={"fichier": ("r.xlsx", _classeur(ligne), "application/octet-stream")}).json()
        assert not r["applique"] and attendu in r["erreurs"][0], (ligne, r)
    assert db.query(Remuneration).count() == 0
    assert client.get("/api/remuneration", headers=rh).status_code == 200

    # Valeur non numérique déjà enregistrée : lue comme non saisie, sans erreur 500.
    db.add(Remuneration(employe_id=_employe(db, "100259").id, salaire_base="nan", primes_fixes="inf", mois_payes=12))
    db.commit()
    r = client.get("/api/remuneration", headers=rh)
    assert r.status_code == 200
    ligne = next(l for l in r.json()["collaborateurs"] if l["employe"]["matricule"] == "100259")
    assert ligne["remuneration"] is None
    sim = client.post("/api/remuneration/simulation", headers=rh, json={})
    assert sim.status_code == 200 and sim.json()["masse_actuelle"] >= 0
