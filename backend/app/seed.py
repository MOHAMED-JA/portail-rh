"""Initialisation de la base avec un jeu de démonstration réaliste.

Usage :  python -m app.seed  [--reset]
"""
from __future__ import annotations

import random
import unicodedata
import sys
from datetime import date, datetime, time, timedelta

from sqlalchemy import select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models import (
    Anomalie,
    CodePresence,
    Demande,
    Departement,
    DocumentRH,
    Employe,
    HistoriqueStatut,
    JournalAudit,
    Notification,
    Planning,
    Pointage,
    Role,
    SoldeConge,
    StatutAnomalie,
    StatutDemande,
    StatutEmploye,
    TypeAnomalie,
    TypeDemande,
    WorkflowValidation,
)
from app.services.calendrier import code_semaine, est_ouvre

random.seed(2026)


def _ascii(texte: str) -> str:
    """« Léa » -> « lea » : adresses e-mail sans accents."""
    return unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode().lower()

DEPARTEMENTS = [
    ("DSI", "Systèmes d'Information", "#2B63C9"),
    ("SIN", "Sinistres", "#E07A5F"),
    ("PRD", "Production & Souscription", "#0E9F6E"),
    ("COM", "Commercial & Réseau", "#D9A441"),
    ("FIN", "Finance & Comptabilité", "#8B5CF6"),
    ("RH", "Ressources Humaines", "#3AA9D6"),
]

# (matricule, prénom, nom, poste, département, rôle, validateur)
EMPLOYES = [
    ("VT0001", "Hugo", "Lefèvre", "Directeur Général Adjoint", "RH", Role.ADMIN_RH, None),
    ("VT0002", "Nadia", "Roche", "Directrice des Ressources Humaines", "RH", Role.ADMIN_RH, "VT0001"),
    ("VT0003", "Karim", "Delorme", "Responsable DSI", "DSI", Role.VALIDATEUR, "VT0001"),
    ("VT0004", "Sophie", "Marchand", "Responsable Sinistres", "SIN", Role.VALIDATEUR, "VT0001"),
    ("VT0005", "Thomas", "Girard", "Responsable Production", "PRD", Role.VALIDATEUR, "VT0001"),
    ("VT0006", "Sonia", "Perret", "Directrice Commerciale", "COM", Role.VALIDATEUR, "VT0001"),
    ("VT0007", "Marc", "Aubert", "Responsable Financier", "FIN", Role.VALIDATEUR, "VT0001"),
    ("VT0010", "Julien", "Garnier", "Ingénieur Études & Développement", "DSI", Role.EMPLOYE, "VT0003"),
    ("VT0011", "Léa", "Fontaine", "Administratrice Systèmes", "DSI", Role.EMPLOYE, "VT0003"),
    ("VT0012", "Yanis", "Moreau", "Analyste Data", "DSI", Role.EMPLOYE, "VT0003"),
    ("VT0013", "Emma", "Bouvier", "Technicienne Support", "DSI", Role.EMPLOYE, "VT0003"),
    ("VT0020", "Inès", "Carré", "Gestionnaire Sinistres Auto", "SIN", Role.EMPLOYE, "VT0004"),
    ("VT0021", "Antoine", "Leroy", "Expert Sinistres IARD", "SIN", Role.EMPLOYE, "VT0004"),
    ("VT0022", "Leïla", "Brun", "Gestionnaire Sinistres Santé", "SIN", Role.EMPLOYE, "VT0004"),
    ("VT0023", "Bastien", "Renaud", "Inspecteur Règlement", "SIN", Role.EMPLOYE, "VT0004"),
    ("VT0030", "Adam", "Colin", "Souscripteur Entreprises", "PRD", Role.EMPLOYE, "VT0005"),
    ("VT0031", "Camille", "Vidal", "Chargée de Production Vie", "PRD", Role.EMPLOYE, "VT0005"),
    ("VT0032", "Mehdi", "Arnaud", "Actuaire", "PRD", Role.EMPLOYE, "VT0005"),
    ("VT0040", "Manon", "Picard", "Chargée de Clientèle", "COM", Role.EMPLOYE, "VT0006"),
    ("VT0041", "Samuel", "Faure", "Animateur Réseau Agences", "COM", Role.EMPLOYE, "VT0006"),
    ("VT0042", "Chloé", "Lemaire", "Conseillère Commerciale", "COM", Role.EMPLOYE, "VT0006"),
    ("VT0050", "Nicolas", "Gauthier", "Comptable", "FIN", Role.EMPLOYE, "VT0007"),
    ("VT0051", "Hélène", "Masson", "Contrôleuse de Gestion", "FIN", Role.EMPLOYE, "VT0007"),
    ("VT0060", "Maxime", "Roux", "Chargé de Formation", "RH", Role.EMPLOYE, "VT0002"),
    ("VT0061", "Amélie", "Guérin", "Gestionnaire Paie", "RH", Role.EMPLOYE, "VT0002"),
]

POSTES_PLANNING = ["siege", "agence", "teletravail", "formation", "terrain", "astreinte"]

COMMENTAIRES_CONGE = [
    "Congé familial planifié de longue date.",
    "Repos annuel — dossiers transmis à l'équipe.",
    "Déplacement familial à Sfax.",
    "Vacances scolaires des enfants.",
    "Récupération après la clôture trimestrielle.",
]


def reinitialiser() -> None:
    # Suppression par le schéma plutôt que du fichier : sous Windows, un
    # serveur encore ouvert verrouillerait la base.
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def peupler() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.scalar(select(Employe).limit(1)):
        print("Base déjà peuplée — relancer avec --reset pour repartir de zéro.")
        db.close()
        return

    aujourdhui = date.today()
    annee = aujourdhui.year

    # ------------------------------------------------------------ Départements
    departements: dict[str, Departement] = {}
    for code, nom, couleur in DEPARTEMENTS:
        departement = Departement(code=code, nom=nom, couleur=couleur)
        db.add(departement)
        departements[code] = departement
    db.flush()

    # ---------------------------------------------------------------- Employés
    employes: dict[str, Employe] = {}
    for index, (matricule, prenom, nom, poste, dept, role, _) in enumerate(EMPLOYES):
        employe = Employe(
            matricule=matricule,
            prenom=prenom,
            nom=nom,
            email=f"{_ascii(prenom.split()[0])}.{_ascii(nom).replace(' ', '')}@veltaris.example",
            telephone=f"+216 {random.randint(20, 99)} {random.randint(100, 999)} {random.randint(100, 999)}",
            poste=poste,
            date_entree=date(annee - random.randint(1, 14), random.randint(1, 12), random.randint(1, 28)),
            statut=StatutEmploye.ACTIF,
            role=role,
            departement_id=departements[dept].id,
            mot_de_passe_hash=hash_password("demo2026"),
            doit_changer_mdp=False,  # comptes de démonstration : accès direct
        )
        db.add(employe)
        employes[matricule] = employe
    db.flush()

    for matricule, *_rest in EMPLOYES:
        validateur_matricule = _rest[-1]
        if validateur_matricule:
            employes[matricule].validateur_id = employes[validateur_matricule].id

    for code, _nom, _couleur in DEPARTEMENTS:
        responsable = next(
            (employes[m] for m, *r in EMPLOYES if r[3] == code and r[4] in (Role.VALIDATEUR, Role.ADMIN_RH)),
            None,
        )
        if responsable:
            departements[code].responsable_id = responsable.id
    db.flush()

    # ------------------------------------------------------------------ Soldes
    for employe in employes.values():
        anciennete = annee - employe.date_entree.year
        acquis = 21 + min(9, anciennete // 3)  # 21 j + 1 j tous les 3 ans (plafonné)
        db.add(
            SoldeConge(
                employe_id=employe.id,
                annee=annee - 1,
                jours_acquis=acquis,
                jours_pris=acquis - random.choice([0, 0, 1, 2]),
                report_anterieur=0,
            )
        )
        db.add(
            SoldeConge(
                employe_id=employe.id,
                annee=annee,
                jours_acquis=acquis,
                jours_pris=0,
                report_anterieur=random.choice([0, 0, 1, 2, 3]),
            )
        )
    db.flush()

    # ------------------------------------------------------ Workflows (config)
    db.add(WorkflowValidation(type_demande=TypeDemande.CONGE, niveaux=1))
    db.add(WorkflowValidation(type_demande=TypeDemande.CONGE, niveaux=2, seuil_jours=10))
    db.add(WorkflowValidation(type_demande=TypeDemande.MISSION, niveaux=1))
    db.add(WorkflowValidation(type_demande=TypeDemande.AUTORISATION, niveaux=1))
    db.flush()

    # --------------------------------------------------------------- Pointages
    debut_historique = aujourdhui - timedelta(days=150)
    jour = debut_historique
    while jour <= aujourdhui:
        if est_ouvre(jour):
            for employe in employes.values():
                tirage = random.random()
                if tirage < 0.05:
                    code = CodePresence.CONGE
                elif tirage < 0.07:
                    code = CodePresence.ABSENT
                elif tirage < 0.11:
                    code = CodePresence.MISSION
                else:
                    code = CodePresence.PRESENT

                pointage = Pointage(
                    employe_id=employe.id,
                    date_jour=jour,
                    heures_prevues=8.0,
                    code_presence=code,
                )

                if code in (CodePresence.PRESENT, CodePresence.MISSION):
                    retard = random.choices([0, 0, 0, 5, 12, 25, 45], weights=[45, 20, 12, 8, 8, 5, 2])[0]
                    arrivee = datetime.combine(jour, time(8, 30)) + timedelta(minutes=retard)
                    pause = datetime.combine(jour, time(12, 30)) + timedelta(minutes=random.randint(-10, 15))
                    reprise = pause + timedelta(minutes=random.randint(45, 75))
                    depart = datetime.combine(jour, time(17, 0)) + timedelta(minutes=random.randint(-20, 70))

                    pointage.entree1 = arrivee.time().replace(second=0, microsecond=0)
                    pointage.sortie1 = pause.time().replace(second=0, microsecond=0)
                    pointage.entree2 = reprise.time().replace(second=0, microsecond=0)
                    pointage.sortie2 = depart.time().replace(second=0, microsecond=0)
                    pointage.retard_minutes = max(0, retard)

                    # 4 % de badgeages incomplets → anomalie dérivée
                    oubli = random.random()
                    manquant = None
                    if oubli < 0.02:
                        pointage.sortie2 = None
                        manquant = TypeAnomalie.SORTIE_MANQUANTE
                    elif oubli < 0.04:
                        pointage.entree2 = None
                        manquant = TypeAnomalie.ENTREE_MANQUANTE

                    total = 0
                    for entree, sortie in ((pointage.entree1, pointage.sortie1), (pointage.entree2, pointage.sortie2)):
                        if entree and sortie:
                            total += (sortie.hour * 60 + sortie.minute) - (entree.hour * 60 + entree.minute)
                    pointage.heures_travaillees = round(total / 60, 2)

                    db.add(pointage)
                    db.flush()

                    if manquant:
                        db.add(
                            Anomalie(
                                employe_id=employe.id,
                                pointage_id=pointage.id,
                                date_jour=jour,
                                type_anomalie=manquant,
                                detail="Badgeage incomplet détecté automatiquement",
                                statut=StatutAnomalie.OUVERTE,
                            )
                        )
                    elif pointage.retard_minutes > 10:
                        db.add(
                            Anomalie(
                                employe_id=employe.id,
                                pointage_id=pointage.id,
                                date_jour=jour,
                                type_anomalie=TypeAnomalie.RETARD,
                                detail=f"Retard de {pointage.retard_minutes} minutes",
                                statut=StatutAnomalie.OUVERTE if random.random() < 0.4 else StatutAnomalie.JUSTIFIEE,
                                justification=None if random.random() < 0.4 else "Embouteillages — justifié auprès du N+1",
                            )
                        )
                else:
                    pointage.heures_travaillees = 0
                    db.add(pointage)
                    if code == CodePresence.ABSENT and random.random() < 0.5:
                        db.flush()
                        db.add(
                            Anomalie(
                                employe_id=employe.id,
                                pointage_id=pointage.id,
                                date_jour=jour,
                                type_anomalie=TypeAnomalie.ABSENCE_NON_JUSTIFIEE,
                                detail="Absence sans demande associée",
                                statut=StatutAnomalie.OUVERTE,
                            )
                        )
        jour += timedelta(days=1)
    db.flush()

    # --------------------------------------------------------------- Demandes
    compteur_reference = 1000

    def creer_demande(employe: Employe, type_demande: TypeDemande, sous_type: str, debut: date, fin: date, statut: StatutDemande, **extra) -> Demande:
        nonlocal compteur_reference
        compteur_reference += 1
        prefixe = {"conge": "CG", "autorisation": "AU", "mission": "MS"}[type_demande.value]
        validateur = db.get(Employe, employe.validateur_id) if employe.validateur_id else None
        demande = Demande(
            reference=f"{prefixe}-{annee}-{compteur_reference}",
            type_demande=type_demande,
            sous_type=sous_type,
            employe_id=employe.id,
            date_debut=debut,
            date_fin=fin,
            statut=statut,
            validateur_id=validateur.id if validateur else None,
            cree_le=datetime.combine(debut - timedelta(days=random.randint(3, 20)), time(random.randint(8, 17), random.choice([0, 15, 30, 45]))),
            niveau_courant=1,
            niveaux_requis=1,
            **extra,
        )
        db.add(demande)
        db.flush()
        db.add(
            HistoriqueStatut(
                demande_id=demande.id,
                statut=StatutDemande.EN_ATTENTE,
                acteur_id=employe.id,
                commentaire="Demande soumise",
                horodatage=demande.cree_le,
            )
        )
        if statut in (StatutDemande.APPROUVEE, StatutDemande.REJETEE):
            decision = demande.cree_le + timedelta(days=random.randint(1, 3), hours=random.randint(1, 6))
            demande.date_validation = decision
            db.add(
                HistoriqueStatut(
                    demande_id=demande.id,
                    statut=statut,
                    acteur_id=validateur.id if validateur else None,
                    commentaire="Demande approuvée" if statut == StatutDemande.APPROUVEE else demande.motif_refus,
                    horodatage=decision,
                )
            )
        return demande

    types_conge_courants = ["annuel", "annuel", "annuel", "maladie", "mariage_employe", "naissance", "deces_parent"]

    for employe in employes.values():
        solde = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == employe.id, SoldeConge.annee == annee))
        jours_pris = 0.0

        # Congés passés (approuvés)
        for _ in range(random.randint(1, 3)):
            sous_type = random.choice(types_conge_courants)
            debut = aujourdhui - timedelta(days=random.randint(20, 140))
            duree = random.randint(1, 5)
            fin = debut + timedelta(days=duree - 1)
            nombre = float(sum(1 for i in range(duree) if est_ouvre(debut + timedelta(days=i))))
            if nombre == 0:
                continue
            creer_demande(
                employe, TypeDemande.CONGE, sous_type, debut, fin, StatutDemande.APPROUVEE,
                nombre_jours=nombre, commentaire=random.choice(COMMENTAIRES_CONGE),
            )
            if sous_type == "annuel":
                jours_pris += nombre

        # Une demande en attente pour la moitié des employés
        if random.random() < 0.55:
            debut = aujourdhui + timedelta(days=random.randint(3, 40))
            duree = random.randint(1, 6)
            fin = debut + timedelta(days=duree - 1)
            nombre = float(sum(1 for i in range(duree) if est_ouvre(debut + timedelta(days=i)))) or 1.0
            creer_demande(
                employe, TypeDemande.CONGE, "annuel", debut, fin, StatutDemande.EN_ATTENTE,
                nombre_jours=nombre, commentaire=random.choice(COMMENTAIRES_CONGE),
            )

        # Un refus occasionnel
        if random.random() < 0.18:
            debut = aujourdhui - timedelta(days=random.randint(10, 60))
            demande = creer_demande(
                employe, TypeDemande.CONGE, "annuel", debut, debut + timedelta(days=2), StatutDemande.REJETEE,
                nombre_jours=2.0, commentaire="Pont de fin de semaine",
            )
            demande.motif_refus = "Effectif insuffisant sur la période — merci de décaler d'une semaine."

        # Autorisations
        for _ in range(random.randint(0, 3)):
            jour_auto = aujourdhui - timedelta(days=random.randint(1, 90))
            heure_debut = time(random.choice([9, 10, 11, 14, 15]), random.choice([0, 30]))
            heure_fin = time(heure_debut.hour + random.randint(1, 2), heure_debut.minute)
            creer_demande(
                employe, TypeDemande.AUTORISATION, random.choice(["perso", "priere_vendredi", "professionnel", "formation"]),
                jour_auto, jour_auto,
                random.choice([StatutDemande.APPROUVEE, StatutDemande.APPROUVEE, StatutDemande.EN_ATTENTE]),
                heure_debut=heure_debut, heure_fin=heure_fin,
                duree_heures=float(heure_fin.hour - heure_debut.hour),
                nombre_jours=0, commentaire="Rendez-vous administratif",
            )

        # Missions
        for _ in range(random.randint(0, 2)):
            debut = aujourdhui + timedelta(days=random.randint(-45, 25))
            fin = debut + timedelta(days=random.randint(0, 3))
            nombre = float(sum(1 for i in range((fin - debut).days + 1) if est_ouvre(debut + timedelta(days=i))))
            creer_demande(
                employe, TypeDemande.MISSION,
                random.choice(["formation", "visite_risque", "teletravail", "reunion", "foire", "evenement"]),
                debut, fin,
                StatutDemande.APPROUVEE if debut < aujourdhui else random.choice([StatutDemande.EN_ATTENTE, StatutDemande.APPROUVEE]),
                nombre_jours=nombre or 1.0,
                commentaire=random.choice([
                    "Visite de risque client entreprise à Sousse.",
                    "Séminaire produits IARD — Tunis.",
                    "Réunion réseau agences du Grand Tunis.",
                    "Télétravail validé dans le cadre de l'accord interne.",
                ]),
            )

        if solde:
            solde.jours_pris = round(jours_pris, 1)
    db.flush()

    # --------------------------------------------------------------- Plannings
    lundi_courant = aujourdhui - timedelta(days=aujourdhui.weekday())
    for decalage_semaine in (-1, 0, 1):
        lundi = lundi_courant + timedelta(weeks=decalage_semaine)
        for employe in employes.values():
            # La semaine +1 n'est volontairement pas remplie pour une partie
            # de l'effectif : l'état vide du planning est ainsi démontrable.
            if decalage_semaine == 1 and random.random() < 0.4:
                continue
            for offset in range(5):
                jour = lundi + timedelta(days=offset)
                poste = random.choices(
                    POSTES_PLANNING, weights=[50, 18, 16, 6, 6, 4]
                )[0]
                db.add(
                    Planning(
                        employe_id=employe.id,
                        date_jour=jour,
                        semaine=code_semaine(jour),
                        poste=poste,
                        heure_debut=time(8, 30),
                        heure_fin=time(17, 0) if poste != "astreinte" else time(20, 0),
                        note="Astreinte week-end incluse" if poste == "astreinte" else None,
                    )
                )
    db.flush()

    # ----------------------------------------------------------- Notifications
    modeles = [
        ("Demande approuvée", "Votre congé annuel du 12/08 au 16/08 a été approuvé par votre N+1.", "succes", "/mes-demandes"),
        ("Nouvelle demande à valider", "Inès Carré a déposé une demande de congé annuel (4 jours).", "validation", "/validation"),
        ("Anomalie de pointage", "Sortie manquante détectée sur votre journée du 03/09.", "alerte", "/presences"),
        ("Planning mis à jour", "Votre planning de la semaine prochaine a été publié.", "info", "/plannings"),
        ("Solde de congés", "Il vous reste 12 jours à poser avant le 31 décembre.", "info", "/mes-demandes"),
    ]
    for employe in employes.values():
        for index in range(random.randint(2, 5)):
            titre, message, type_notif, lien = random.choice(modeles)
            db.add(
                Notification(
                    destinataire_id=employe.id,
                    titre=titre,
                    message=message,
                    type_notif=type_notif,
                    lien=lien,
                    lu=random.random() < 0.45,
                    horodatage=datetime.now() - timedelta(hours=random.randint(1, 180)),
                )
            )

    # -------------------------------------------------------- Documents RH
    for employe in employes.values():
        for mois in range(max(1, aujourdhui.month - 3), aujourdhui.month + 1):
            db.add(
                DocumentRH(
                    employe_id=employe.id,
                    titre=f"Bulletin de paie — {mois:02d}/{annee}",
                    categorie="bulletin",
                    periode=f"{mois:02d}/{annee}",
                    cree_le=datetime(annee, mois, 28),
                )
            )
        db.add(
            DocumentRH(
                employe_id=employe.id,
                titre="Attestation de travail",
                categorie="attestation",
                periode=str(annee),
                cree_le=datetime.now() - timedelta(days=random.randint(10, 120)),
            )
        )
        db.add(
            DocumentRH(
                employe_id=employe.id,
                titre="Charte de télétravail — à signer",
                categorie="contrat",
                periode=str(annee),
                cree_le=datetime.now() - timedelta(days=random.randint(1, 30)),
            )
        )

    # ------------------------------------------------------------------ Audit
    db.add(
        JournalAudit(
            acteur_id=employes["VT0002"].id,
            action="initialisation_plateforme",
            cible="base de démonstration",
            detail=f"{len(employes)} employés, {len(DEPARTEMENTS)} départements",
        )
    )

    db.commit()
    db.close()

    print("Base de démonstration créée.")
    print("  Admin RH   : VT0002 / demo2026  (Nadia Roche)")
    print("  Validateur : VT0003 / demo2026  (Karim Delorme)")
    print("  Employé    : VT0010 / demo2026  (Julien Garnier)")


if __name__ == "__main__":
    if "--reset" in sys.argv:
        reinitialiser()
    peupler()
