"""Modèle de données RH — Veltaris.

Toutes les tables sont écrites en SQLAlchemy 2.0 typé, sans fonctionnalité
spécifique SQLite : la migration vers PostgreSQL ne demande aucun changement
de schéma.
"""
from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.services.chiffrement import TexteChiffre


# --------------------------------------------------------------------------
# Énumérations métier
# --------------------------------------------------------------------------
class Role(str, PyEnum):
    EMPLOYE = "employe"
    VALIDATEUR = "validateur"
    GESTIONNAIRE_RH = "gestionnaire_rh"   # opérations RH courantes
    ADMIN_RH = "admin_rh"                 # + configuration, sécurité, rôles, audit


# Personnel RH : accès aux données RH et confidentielles. L'administrateur
# seul configure le portail (paramètres, sécurité, rôles, audit, sauvegardes).
ROLES_RH = (Role.GESTIONNAIRE_RH, Role.ADMIN_RH)


class StatutEmploye(str, PyEnum):
    ACTIF = "actif"
    SUSPENDU = "suspendu"
    SORTI = "sorti"


class StatutDemande(str, PyEnum):
    BROUILLON = "brouillon"
    EN_ATTENTE = "en_attente"
    APPROUVEE = "approuvee"
    REJETEE = "rejetee"
    ANNULEE = "annulee"


class TypeDemande(str, PyEnum):
    CONGE = "conge"
    AUTORISATION = "autorisation"
    MISSION = "mission"


class CodePresence(str, PyEnum):
    PRESENT = "present"
    CONGE = "conge"
    MISSION = "mission"
    ABSENT = "absent"
    REPOS = "repos"
    FERIE = "ferie"


class TypeAnomalie(str, PyEnum):
    ENTREE_MANQUANTE = "entree_manquante"
    SORTIE_MANQUANTE = "sortie_manquante"
    RETARD = "retard"
    DEPART_ANTICIPE = "depart_anticipe"
    ABSENCE_NON_JUSTIFIEE = "absence_non_justifiee"
    POINTAGE_IMPAIR = "pointage_impair"


class StatutAnomalie(str, PyEnum):
    OUVERTE = "ouverte"
    JUSTIFIEE = "justifiee"
    IGNOREE = "ignoree"


# Types de congés — droit du travail tunisien
TYPES_CONGE = [
    {"code": "annuel", "libelle": "Congé annuel", "jours_max": None, "justificatif": False},
    {"code": "naissance", "libelle": "Naissance d'un enfant", "jours_max": 2, "justificatif": True},
    {"code": "deces_conjoint_enfant", "libelle": "Décès du conjoint ou d'un enfant", "jours_max": 3, "justificatif": True},
    {"code": "deces_parent", "libelle": "Décès du père ou de la mère", "jours_max": 3, "justificatif": True},
    {"code": "deces_frere", "libelle": "Décès frère", "jours_max": 2, "justificatif": True},
    {"code": "deces_grand_parent", "libelle": "Décès du grand-père ou de la grand-mère", "jours_max": 1, "justificatif": True},
    {"code": "mariage_employe", "libelle": "Mariage de l'employé", "jours_max": 3, "justificatif": True},
    {"code": "mariage_enfant", "libelle": "Mariage de l'enfant", "jours_max": 1, "justificatif": True},
    {"code": "circoncision", "libelle": "Circoncision de l'enfant", "jours_max": 1, "justificatif": True},
    {"code": "paternel", "libelle": "Congé paternel", "jours_max": 2, "justificatif": True},
    {"code": "maladie", "libelle": "Congé de maladie", "jours_max": None, "justificatif": True},
    {"code": "prenatal", "libelle": "Congé prénatal", "jours_max": 30, "justificatif": True},
    {"code": "suspension", "libelle": "Suspension", "jours_max": None, "justificatif": False},
    {"code": "mise_a_pied", "libelle": "Mise à pied", "jours_max": None, "justificatif": False},
    {"code": "sans_solde", "libelle": "Congé sans solde", "jours_max": None, "justificatif": False},
]

TYPES_AUTORISATION = [
    {"code": "perso", "libelle": "Perso"},
    {"code": "priere_vendredi", "libelle": "Prière du vendredi"},
    {"code": "professionnel", "libelle": "Professionnel"},
    {"code": "formation", "libelle": "Formation"},
    {"code": "allaitement", "libelle": "Heure d'allaitement"},
    {"code": "mission_inspection", "libelle": "Mission d'inspection"},
]

TYPES_MISSION = [
    {"code": "formation", "libelle": "Formation"},
    {"code": "visite_risque", "libelle": "Visite de risque"},
    {"code": "teletravail", "libelle": "Télétravail"},
    {"code": "foire", "libelle": "Foire"},
    {"code": "evenement", "libelle": "Événement"},
    {"code": "reunion", "libelle": "Réunion"},
]

# Seuls ces types de congé décrémentent le solde annuel.
TYPES_CONGE_DECOMPTES = {"annuel"}


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------
class Departement(Base):
    __tablename__ = "departements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    nom: Mapped[str] = mapped_column(String(120))
    couleur: Mapped[str] = mapped_column(String(20), default="#2B63C9")
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("departements.id"))
    # use_alter : département → responsable → département forme un cycle que
    # SQLAlchemy doit connaître pour ordonner création et suppression des tables.
    responsable_id: Mapped[int | None] = mapped_column(
        ForeignKey("employes.id", use_alter=True, name="fk_departements_responsable_id")
    )

    employes: Mapped[list["Employe"]] = relationship(
        back_populates="departement", foreign_keys="Employe.departement_id"
    )
    responsable: Mapped["Employe | None"] = relationship(foreign_keys=[responsable_id])


class ConfirmationArchitecture(Base):
    """Décision RH traçable sur le responsable d'une structure de l'organigramme."""

    __tablename__ = "confirmations_architecture"
    __table_args__ = (UniqueConstraint("structure_id", name="uq_confirmation_architecture_structure"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    structure_id: Mapped[int] = mapped_column(ForeignKey("departements.id"), index=True)
    responsable_confirme_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    confirme_par_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))
    confirme_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    structure: Mapped["Departement"] = relationship(foreign_keys=[structure_id])
    responsable_confirme: Mapped["Employe | None"] = relationship(foreign_keys=[responsable_confirme_id])
    confirme_par: Mapped["Employe"] = relationship(foreign_keys=[confirme_par_id])


class Employe(Base):
    __tablename__ = "employes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    matricule: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    nom: Mapped[str] = mapped_column(String(80))
    prenom: Mapped[str] = mapped_column(String(80))
    # Non unique : certaines boîtes de service sont partagées entre plusieurs
    # collaborateurs. L'identifiant de connexion est le matricule.
    email: Mapped[str] = mapped_column(String(160), index=True)
    telephone: Mapped[str | None] = mapped_column(String(30))
    photo: Mapped[str | None] = mapped_column(String(255))
    poste: Mapped[str] = mapped_column(String(120))
    # Facultative : l'annuaire interne ne la fournit pas, et une date inventée
    # finirait imprimée sur les attestations de travail.
    date_entree: Mapped[date | None] = mapped_column(Date, nullable=True)
    statut: Mapped[StatutEmploye] = mapped_column(Enum(StatutEmploye), default=StatutEmploye.ACTIF)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.EMPLOYE)
    mot_de_passe_hash: Mapped[str] = mapped_column(String(255))

    departement_id: Mapped[int | None] = mapped_column(ForeignKey("departements.id"))
    validateur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))

    # Sortie des effectifs (le profil est désactivé, jamais effacé).
    motif_sortie: Mapped[str | None] = mapped_column(String(40))
    date_sortie: Mapped[date | None] = mapped_column(Date)
    detail_sortie: Mapped[str | None] = mapped_column(Text)
    reference_sortie: Mapped[str | None] = mapped_column(String(80))
    sortie_saisie_le: Mapped[datetime | None] = mapped_column(DateTime)

    # Sécurité : changement imposé à la première connexion, blocage après échecs.
    doit_changer_mdp: Mapped[bool] = mapped_column(Boolean, default=True)
    echecs_connexion: Mapped[int] = mapped_column(Integer, default=0)
    bloque_jusqu: Mapped[datetime | None] = mapped_column(DateTime)

    # Niveau hiérarchique (services/hierarchie.NIVEAUX) : collaborateur → DG.
    niveau: Mapped[str] = mapped_column(String(30), default="collaborateur")

    # Double authentification (TOTP) : secret chiffré, codes de secours hachés.
    totp_secret: Mapped[str | None] = mapped_column(TexteChiffre)
    totp_active: Mapped[bool] = mapped_column(Boolean, default=False)
    codes_secours: Mapped[str | None] = mapped_column(Text)

    departement: Mapped["Departement | None"] = relationship(
        back_populates="employes", foreign_keys=[departement_id]
    )
    validateur: Mapped["Employe | None"] = relationship(remote_side=[id], foreign_keys=[validateur_id])
    soldes: Mapped[list["SoldeConge"]] = relationship(back_populates="employe", cascade="all, delete-orphan")

    @property
    def double_auth_obligatoire(self) -> bool:
        """Compte désigné par la politique RH, même après activation."""
        from app.core import config

        return (
            config.DOUBLE_AUTH_RH
            and self.matricule.upper() in config.MATRICULES_DOUBLE_AUTH
        )

    @property
    def double_auth_requise(self) -> bool:
        return self.double_auth_obligatoire and not self.totp_active

    @property
    def nom_complet(self) -> str:
        return f"{self.prenom} {self.nom}"

    @property
    def initiales(self) -> str:
        return f"{self.prenom[:1]}{self.nom[:1]}".upper()


class SoldeConge(Base):
    __tablename__ = "soldes_conge"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_solde_employe_annee"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))
    annee: Mapped[int] = mapped_column(Integer)
    jours_acquis: Mapped[float] = mapped_column(Float, default=0)
    jours_pris: Mapped[float] = mapped_column(Float, default=0)
    report_anterieur: Mapped[float] = mapped_column(Float, default=0)

    employe: Mapped["Employe"] = relationship(back_populates="soldes")

    @property
    def jours_restants(self) -> float:
        return round(self.jours_acquis + self.report_anterieur - self.jours_pris, 2)


class Demande(Base):
    """Table unique pour congés / autorisations / missions.

    Les trois formulaires partagent 80 % de leurs champs et surtout le même
    workflow de validation : une table unique évite trois pipelines dupliqués
    (file de validation, audit trail, notifications, exports).
    """

    __tablename__ = "demandes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    type_demande: Mapped[TypeDemande] = mapped_column(Enum(TypeDemande))
    sous_type: Mapped[str] = mapped_column(String(40))  # code du type de congé/autorisation/mission
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)

    date_debut: Mapped[date] = mapped_column(Date)
    date_fin: Mapped[date] = mapped_column(Date)
    heure_debut: Mapped[time | None] = mapped_column(Time)
    heure_fin: Mapped[time | None] = mapped_column(Time)
    demi_journee: Mapped[str | None] = mapped_column(String(10))  # "matin" | "apres_midi" | None
    nombre_jours: Mapped[float] = mapped_column(Float, default=0)
    duree_heures: Mapped[float | None] = mapped_column(Float)

    commentaire: Mapped[str | None] = mapped_column(Text)
    piece_jointe: Mapped[str | None] = mapped_column(String(255))
    statut: Mapped[StatutDemande] = mapped_column(Enum(StatutDemande), default=StatutDemande.EN_ATTENTE, index=True)

    validateur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    date_validation: Mapped[datetime | None] = mapped_column(DateTime)
    motif_refus: Mapped[str | None] = mapped_column(Text)
    signature: Mapped[str | None] = mapped_column(Text)  # signature électronique (data URL)

    niveau_courant: Mapped[int] = mapped_column(Integer, default=1)
    niveaux_requis: Mapped[int] = mapped_column(Integer, default=1)
    # Autorisation au-delà du quota mensuel : décision réservée à la RH.
    derogation_rh: Mapped[bool] = mapped_column(Boolean, default=False)
    solde_insuffisant: Mapped[bool] = mapped_column(Boolean, default=False)

    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    validateur: Mapped["Employe | None"] = relationship(foreign_keys=[validateur_id])
    historique: Mapped[list["HistoriqueStatut"]] = relationship(
        back_populates="demande", cascade="all, delete-orphan", order_by="HistoriqueStatut.horodatage"
    )


class HistoriqueStatut(Base):
    """Audit trail : chaque transition de statut d'une demande."""

    __tablename__ = "historique_statuts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    demande_id: Mapped[int] = mapped_column(ForeignKey("demandes.id"))
    statut: Mapped[StatutDemande] = mapped_column(Enum(StatutDemande))
    acteur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    commentaire: Mapped[str | None] = mapped_column(Text)
    horodatage: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    demande: Mapped["Demande"] = relationship(back_populates="historique")
    acteur: Mapped["Employe | None"] = relationship()


class Pointage(Base):
    __tablename__ = "pointages"
    __table_args__ = (UniqueConstraint("employe_id", "date_jour", name="uq_pointage_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    date_jour: Mapped[date] = mapped_column(Date, index=True)
    entree1: Mapped[time | None] = mapped_column(Time)
    sortie1: Mapped[time | None] = mapped_column(Time)
    entree2: Mapped[time | None] = mapped_column(Time)
    sortie2: Mapped[time | None] = mapped_column(Time)
    heures_travaillees: Mapped[float] = mapped_column(Float, default=0)
    heures_prevues: Mapped[float] = mapped_column(Float, default=8.0)
    retard_minutes: Mapped[int] = mapped_column(Integer, default=0)
    code_presence: Mapped[CodePresence] = mapped_column(Enum(CodePresence), default=CodePresence.PRESENT)

    employe: Mapped["Employe"] = relationship()


class Anomalie(Base):
    __tablename__ = "anomalies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    pointage_id: Mapped[int | None] = mapped_column(ForeignKey("pointages.id"))
    date_jour: Mapped[date] = mapped_column(Date, index=True)
    type_anomalie: Mapped[TypeAnomalie] = mapped_column(Enum(TypeAnomalie))
    detail: Mapped[str | None] = mapped_column(String(255))
    statut: Mapped[StatutAnomalie] = mapped_column(Enum(StatutAnomalie), default=StatutAnomalie.OUVERTE)
    justification: Mapped[str | None] = mapped_column(Text)

    employe: Mapped["Employe"] = relationship()
    pointage: Mapped["Pointage | None"] = relationship()


class Planning(Base):
    __tablename__ = "plannings"
    __table_args__ = (UniqueConstraint("employe_id", "date_jour", name="uq_planning_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    date_jour: Mapped[date] = mapped_column(Date, index=True)
    semaine: Mapped[str] = mapped_column(String(10), index=True)  # ISO "2026-W38"
    poste: Mapped[str] = mapped_column(String(60))  # Agence, Siège, Télétravail, Astreinte…
    heure_debut: Mapped[time] = mapped_column(Time)
    heure_fin: Mapped[time] = mapped_column(Time)
    note: Mapped[str | None] = mapped_column(String(255))

    employe: Mapped["Employe"] = relationship()


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    destinataire_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    titre: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    type_notif: Mapped[str] = mapped_column(String(40), default="info")  # info|succes|alerte|validation
    lien: Mapped[str | None] = mapped_column(String(120))
    lu: Mapped[bool] = mapped_column(Boolean, default=False)
    horodatage: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    destinataire: Mapped["Employe"] = relationship()


class DocumentRH(Base):
    """Espace « Mes documents RH » : bulletins, attestations, contrats."""

    __tablename__ = "documents_rh"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    titre: Mapped[str] = mapped_column(String(160))
    categorie: Mapped[str] = mapped_column(String(40))  # bulletin|attestation|contrat|autre
    periode: Mapped[str | None] = mapped_column(String(40))
    fichier: Mapped[str | None] = mapped_column(String(255))
    signe: Mapped[bool] = mapped_column(Boolean, default=False)
    signature: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employe: Mapped["Employe"] = relationship()


class JournalAudit(Base):
    """Traçabilité globale des actions administratives."""

    __tablename__ = "journal_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    acteur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    action: Mapped[str] = mapped_column(String(80))
    cible: Mapped[str | None] = mapped_column(String(120))
    detail: Mapped[str | None] = mapped_column(Text)
    horodatage: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    acteur: Mapped["Employe | None"] = relationship()


class WorkflowValidation(Base):
    """Workflow configurable : nombre de niveaux par type et département."""

    __tablename__ = "workflows_validation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type_demande: Mapped[TypeDemande] = mapped_column(Enum(TypeDemande))
    departement_id: Mapped[int | None] = mapped_column(ForeignKey("departements.id"))
    sous_type: Mapped[str | None] = mapped_column(String(40))
    niveaux: Mapped[int] = mapped_column(Integer, default=1)
    seuil_jours: Mapped[float | None] = mapped_column(Float)  # au-delà : niveau supplémentaire

    departement: Mapped["Departement | None"] = relationship()


# --------------------------------------------------------------------------
# Fiches d'objectifs et d'évaluation annuelles
# --------------------------------------------------------------------------
class StatutFicheObjectifs(str, PyEnum):
    BROUILLON = "brouillon"      # rédigée par le collaborateur
    SOUMISE = "soumise"          # transmise au supérieur hiérarchique
    A_CORRIGER = "a_corriger"    # renvoyée au collaborateur
    VALIDEE = "validee"          # validée (éventuellement modifiée) par le supérieur


class FicheObjectifs(Base):
    """Objectifs de l'année, pondérés en pourcentage (total : 100 %).

    Rédigée par le collaborateur, validée ou modifiée par son supérieur
    hiérarchique, consultable sans modification par l'administration RH."""

    __tablename__ = "fiches_objectifs"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_fiche_objectifs"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    annee: Mapped[int] = mapped_column(Integer)
    statut: Mapped[StatutFicheObjectifs] = mapped_column(
        Enum(StatutFicheObjectifs), default=StatutFicheObjectifs.BROUILLON
    )
    commentaire_superieur: Mapped[str | None] = mapped_column(Text)
    soumise_le: Mapped[datetime | None] = mapped_column(DateTime)
    validee_le: Mapped[datetime | None] = mapped_column(DateTime)
    validee_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    modifiee_par_superieur: Mapped[bool] = mapped_column(Boolean, default=False)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    validee_par: Mapped["Employe | None"] = relationship(foreign_keys=[validee_par_id])
    objectifs: Mapped[list["Objectif"]] = relationship(
        back_populates="fiche", cascade="all, delete-orphan", order_by="Objectif.ordre"
    )


class Objectif(Base):
    """Un objectif et, une fois l'évaluation menée, sa note sur 20."""

    __tablename__ = "objectifs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fiche_id: Mapped[int] = mapped_column(ForeignKey("fiches_objectifs.id"), index=True)
    ordre: Mapped[int] = mapped_column(Integer, default=0)
    titre: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    indicateur: Mapped[str | None] = mapped_column(String(255))
    ponderation: Mapped[float] = mapped_column(Float)  # en %
    note: Mapped[float | None] = mapped_column(Float)  # sur 20, saisie par le supérieur
    commentaire_note: Mapped[str | None] = mapped_column(Text)

    fiche: Mapped["FicheObjectifs"] = relationship(back_populates="objectifs")


class FicheEvaluation(Base):
    """Évaluation annuelle : notes des objectifs (supérieur hiérarchique) et
    note de comportement (administration RH), validées par chacun."""

    __tablename__ = "fiches_evaluation"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_fiche_evaluation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    annee: Mapped[int] = mapped_column(Integer)
    appreciation_superieur: Mapped[str | None] = mapped_column(Text)
    note_comportement: Mapped[float | None] = mapped_column(Float)
    commentaire_comportement: Mapped[str | None] = mapped_column(Text)
    superieur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    valide_superieur_le: Mapped[datetime | None] = mapped_column(DateTime)
    rh_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    valide_rh_le: Mapped[datetime | None] = mapped_column(DateTime)
    note_objectifs: Mapped[float | None] = mapped_column(Float)
    note_finale: Mapped[float | None] = mapped_column(Float)
    finalisee_le: Mapped[datetime | None] = mapped_column(DateTime)
    # Entretien annuel : développement, mobilité, prise de connaissance signée.
    formations_souhaitees: Mapped[str | None] = mapped_column(Text)   # JSON : thèmes / sessions
    plan_developpement: Mapped[str | None] = mapped_column(Text)
    mobilite_type: Mapped[str | None] = mapped_column(String(30))
    mobilite_detail: Mapped[str | None] = mapped_column(Text)
    pris_connaissance_le: Mapped[datetime | None] = mapped_column(DateTime)
    commentaire_collaborateur: Mapped[str | None] = mapped_column(Text)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    superieur: Mapped["Employe | None"] = relationship(foreign_keys=[superieur_id])
    rh: Mapped["Employe | None"] = relationship(foreign_keys=[rh_id])



# --------------------------------------------------------------------------
# Notes de frais, formations, paramètres
# --------------------------------------------------------------------------
class StatutNoteFrais(str, PyEnum):
    BROUILLON = "brouillon"
    EN_ATTENTE = "en_attente"
    APPROUVEE = "approuvee"
    REJETEE = "rejetee"
    REMBOURSEE = "remboursee"


class NoteFrais(Base):
    __tablename__ = "notes_frais"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    periode: Mapped[str] = mapped_column(String(10))           # « 09/2026 »
    mission_reference: Mapped[str | None] = mapped_column(String(24))
    statut: Mapped[StatutNoteFrais] = mapped_column(Enum(StatutNoteFrais), default=StatutNoteFrais.BROUILLON, index=True)
    total: Mapped[float] = mapped_column(Float, default=0)
    justificatifs: Mapped[str | None] = mapped_column(Text)    # chemins séparés par « | »
    valideur_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    motif_refus: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    transmise_le: Mapped[datetime | None] = mapped_column(DateTime)
    decidee_le: Mapped[datetime | None] = mapped_column(DateTime)
    remboursee_le: Mapped[datetime | None] = mapped_column(DateTime)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    valideur: Mapped["Employe | None"] = relationship(foreign_keys=[valideur_id])
    lignes: Mapped[list["LigneFrais"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", order_by="LigneFrais.date_depense"
    )


class LigneFrais(Base):
    __tablename__ = "lignes_frais"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes_frais.id"), index=True)
    date_depense: Mapped[date] = mapped_column(Date)
    categorie: Mapped[str] = mapped_column(String(20))
    libelle: Mapped[str | None] = mapped_column(String(200))
    montant: Mapped[float] = mapped_column(Float)

    note: Mapped["NoteFrais"] = relationship(back_populates="lignes")


class Formation(Base):
    __tablename__ = "formations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    titre: Mapped[str] = mapped_column(String(160))
    theme: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text)
    date_debut: Mapped[date] = mapped_column(Date)
    date_fin: Mapped[date] = mapped_column(Date)
    lieu: Mapped[str] = mapped_column(String(120))
    formateur: Mapped[str | None] = mapped_column(String(120))
    places: Mapped[int] = mapped_column(Integer, default=12)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    cout: Mapped[float] = mapped_column(Float, default=0)   # coût total de la session (DT)

    inscriptions: Mapped[list["InscriptionFormation"]] = relationship(
        back_populates="formation", cascade="all, delete-orphan"
    )


class InscriptionFormation(Base):
    __tablename__ = "inscriptions_formation"
    __table_args__ = (UniqueConstraint("formation_id", "employe_id", name="uq_inscription"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    formation_id: Mapped[int] = mapped_column(ForeignKey("formations.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    inscrit_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    formation: Mapped["Formation"] = relationship(back_populates="inscriptions")
    employe: Mapped["Employe"] = relationship()


class Parametre(Base):
    """Paramètres RH et préférences utilisateur, stockés en JSON par clé."""

    __tablename__ = "parametres"

    cle: Mapped[str] = mapped_column(String(80), primary_key=True)
    valeur: Mapped[str] = mapped_column(Text)
    modifie_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PassageBadge(Base):
    """Un passage brut à la pointeuse (ou au bouton « Badger »)."""

    __tablename__ = "passages_badge"
    __table_args__ = (UniqueConstraint("employe_id", "horodatage", name="uq_passage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    horodatage: Mapped[datetime] = mapped_column(DateTime, index=True)
    source: Mapped[str] = mapped_column(String(20), default="pointeuse")   # pointeuse | portail | import
    terminal: Mapped[str | None] = mapped_column(String(60))
    recu_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employe: Mapped["Employe"] = relationship()


class EmailSortant(Base):
    """File d'attente et historique des e-mails envoyés par le portail."""

    __tablename__ = "emails_sortants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    destinataire: Mapped[str] = mapped_column(String(160))
    sujet: Mapped[str] = mapped_column(String(200))
    corps_html: Mapped[str] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(String(20), default="en_file", index=True)  # en_file|envoye|erreur|non_configure
    erreur: Mapped[str | None] = mapped_column(Text)
    tentatives: Mapped[int] = mapped_column(Integer, default=0)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    envoye_le: Mapped[datetime | None] = mapped_column(DateTime)


# --------------------------------------------------------------------------
# SIRH : dossier du collaborateur, carrière, parcours, report des congés,
# documents demandés, sondages, évaluation des formations
# --------------------------------------------------------------------------
class DossierEmploye(Base):
    """Dossier administratif complet (1 pour 1 avec le collaborateur)."""

    __tablename__ = "dossiers_employes"

    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), primary_key=True)
    date_naissance: Mapped[date | None] = mapped_column(Date)
    categorie: Mapped[str | None] = mapped_column(String(60))      # cadre, agent de maîtrise, exécution…
    grade: Mapped[str | None] = mapped_column(String(60))
    echelon: Mapped[str | None] = mapped_column(String(20))
    type_contrat: Mapped[str | None] = mapped_column(String(30))   # CDI, CDD, stage, SIVP, contractuel
    date_fin_contrat: Mapped[date | None] = mapped_column(Date)
    date_fin_essai: Mapped[date | None] = mapped_column(Date)
    diplomes: Mapped[str | None] = mapped_column(Text)
    contact_nom: Mapped[str | None] = mapped_column(String(120))
    contact_lien: Mapped[str | None] = mapped_column(String(60))
    contact_telephone: Mapped[str | None] = mapped_column(String(30))
    visite_medicale_le: Mapped[date | None] = mapped_column(Date)
    visite_periodicite_mois: Mapped[int] = mapped_column(Integer, default=12)
    # Données de santé : chiffrées en base (services/chiffrement.py).
    aptitude_medicale: Mapped[str | None] = mapped_column(TexteChiffre)       # apte, apte avec réserves…
    observations_medicales: Mapped[str | None] = mapped_column(TexteChiffre)  # restrictions, aménagements
    # Adresse personnelle : saisie par l'intéressé (ou la RH) ; chaque
    # modification est notifiée à l'administration RH.
    adresse: Mapped[str | None] = mapped_column(String(255))
    code_postal: Mapped[str | None] = mapped_column(String(10))
    ville: Mapped[str | None] = mapped_column(String(80))
    adresse_modifiee_le: Mapped[datetime | None] = mapped_column(DateTime)
    modifie_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    employe: Mapped["Employe"] = relationship()


class EvenementCarriere(Base):
    """Historique de carrière : embauche, promotion, mutation, changement de poste…"""

    __tablename__ = "evenements_carriere"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    date_effet: Mapped[date] = mapped_column(Date)
    type_evenement: Mapped[str] = mapped_column(String(30))
    avant: Mapped[str | None] = mapped_column(String(200))
    apres: Mapped[str | None] = mapped_column(String(200))
    reference: Mapped[str | None] = mapped_column(String(80))
    commentaire: Mapped[str | None] = mapped_column(Text)
    saisi_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ParcoursRH(Base):
    """Parcours d'arrivée ou de départ : liste de tâches RH, DSI, manager."""

    __tablename__ = "parcours_rh"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    type_parcours: Mapped[str] = mapped_column(String(10))   # arrivee | depart
    date_reference: Mapped[date] = mapped_column(Date)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    termine_le: Mapped[datetime | None] = mapped_column(DateTime)

    employe: Mapped["Employe"] = relationship()
    taches: Mapped[list["TacheParcours"]] = relationship(back_populates="parcours", cascade="all, delete-orphan",
                                                         order_by="TacheParcours.ordre")


class TacheParcours(Base):
    __tablename__ = "taches_parcours"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parcours_id: Mapped[int] = mapped_column(ForeignKey("parcours_rh.id"), index=True)
    ordre: Mapped[int] = mapped_column(Integer, default=0)
    libelle: Mapped[str] = mapped_column(String(200))
    responsable: Mapped[str] = mapped_column(String(20))   # RH | DSI | Manager | Collaborateur
    echeance: Mapped[date | None] = mapped_column(Date)
    fait_le: Mapped[datetime | None] = mapped_column(DateTime)
    fait_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    commentaire: Mapped[str | None] = mapped_column(String(255))

    parcours: Mapped["ParcoursRH"] = relationship(back_populates="taches")
    fait_par: Mapped["Employe | None"] = relationship()


class AccordReport(Base):
    """Accord de la RH pour reporter au-delà du plafond (15 jours)."""

    __tablename__ = "accords_report"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_accord_report"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    annee: Mapped[int] = mapped_column(Integer)              # exercice clôturé
    jours_supplementaires: Mapped[float] = mapped_column(Float)  # au-delà du plafond
    motif: Mapped[str | None] = mapped_column(Text)
    accorde_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    accorde_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ClotureConges(Base):
    """Résultat de la clôture annuelle des congés, par collaborateur."""

    __tablename__ = "clotures_conges"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_cloture"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    annee: Mapped[int] = mapped_column(Integer)
    solde_final: Mapped[float] = mapped_column(Float)
    reporte: Mapped[float] = mapped_column(Float)
    perdu: Mapped[float] = mapped_column(Float)
    cloture_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DemandeDocument(Base):
    """Demande de document RH (attestation, certificat…) et son suivi."""

    __tablename__ = "demandes_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    type_document: Mapped[str] = mapped_column(String(40))
    motif: Mapped[str | None] = mapped_column(String(255))
    statut: Mapped[str] = mapped_column(String(20), default="demandee")   # demandee | en_cours | prete | refusee
    commentaire_rh: Mapped[str | None] = mapped_column(Text)
    fichier: Mapped[str | None] = mapped_column(String(255))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    traitee_le: Mapped[datetime | None] = mapped_column(DateTime)

    employe: Mapped["Employe"] = relationship()


class Sondage(Base):
    __tablename__ = "sondages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    titre: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    questions: Mapped[str] = mapped_column(Text)      # JSON : [{"texte", "type": note|choix|texte, "choix": [...]}]
    anonyme: Mapped[bool] = mapped_column(Boolean, default=True)
    ouvert: Mapped[bool] = mapped_column(Boolean, default=True)
    date_fin: Mapped[date | None] = mapped_column(Date)
    cree_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReponseSondage(Base):
    """Réponses : sans lien avec la personne lorsque le sondage est anonyme."""

    __tablename__ = "reponses_sondage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sondage_id: Mapped[int] = mapped_column(ForeignKey("sondages.id"), index=True)
    employe_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    departement: Mapped[str | None] = mapped_column(String(20))
    reponses: Mapped[str] = mapped_column(Text)
    cree_le: Mapped[date] = mapped_column(Date, default=date.today)


class ParticipationSondage(Base):
    """Qui a déjà répondu (pour empêcher une double réponse), sans le contenu."""

    __tablename__ = "participations_sondage"
    __table_args__ = (UniqueConstraint("sondage_id", "employe_id", name="uq_participation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sondage_id: Mapped[int] = mapped_column(ForeignKey("sondages.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))


class EvaluationFormation(Base):
    """Évaluation à chaud (participant) ou à froid (manager, 3 mois après)."""

    __tablename__ = "evaluations_formation"
    __table_args__ = (UniqueConstraint("formation_id", "employe_id", "moment", name="uq_eval_formation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    formation_id: Mapped[int] = mapped_column(ForeignKey("formations.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))   # participant évalué
    moment: Mapped[str] = mapped_column(String(10))                      # chaud | froid
    note: Mapped[int] = mapped_column(Integer)                           # 1 à 5
    commentaire: Mapped[str | None] = mapped_column(Text)
    evalue_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DelegationValidation(Base):
    """Remplaçant désigné pendant l'absence d'un valideur.

    Sans elle, les demandes d'une équipe attendent le retour du supérieur, puis
    se valident d'office au bout du délai de réponse : personne n'a lu. Le
    suppléant décide **à la place du titulaire et en son nom**, pendant la seule
    période déclarée ; il ne reçoit aucun autre droit, ne voit pas les données
    confidentielles du titulaire et ne peut pas déléguer à son tour.
    """

    __tablename__ = "delegations_validation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    titulaire_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    suppleant_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    debut: Mapped[date] = mapped_column(Date)
    fin: Mapped[date] = mapped_column(Date)
    motif: Mapped[str | None] = mapped_column(String(120))
    cree_par_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    annulee_le: Mapped[datetime | None] = mapped_column(DateTime)

    titulaire: Mapped["Employe"] = relationship(foreign_keys=[titulaire_id])
    suppleant: Mapped["Employe"] = relationship(foreign_keys=[suppleant_id])
    cree_par: Mapped["Employe"] = relationship(foreign_keys=[cree_par_id])


class DemandeReinitialisation(Base):
    """Mot de passe oublié : trace de chaque demande et de chaque tentative.

    Trois canaux : « totp » (le compte prouve son identité avec l'application
    d'authentification et un code de secours), « email » (lien à usage unique
    envoyé à l'adresse professionnelle) et « rh » (la RH réinitialise depuis
    Administration → Profils). Une demande ne bloque jamais le compte.
    """

    __tablename__ = "demandes_reinitialisation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"), index=True)
    matricule: Mapped[str] = mapped_column(String(40))            # tel que saisi
    canal: Mapped[str] = mapped_column(String(10))                # totp, email, rh
    statut: Mapped[str] = mapped_column(String(20), default="en_attente")  # en_attente, aboutie, traitee, echec
    jeton_hash: Mapped[str | None] = mapped_column(String(128))   # canal « email » seulement
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    expire_le: Mapped[datetime | None] = mapped_column(DateTime)
    close_le: Mapped[datetime | None] = mapped_column(DateTime)
    traitee_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    adresse_ip: Mapped[str | None] = mapped_column(String(64))

    employe: Mapped["Employe | None"] = relationship(foreign_keys=[employe_id])


class Connexion(Base):
    """Historique des connexions (réussies et refusées), pour la sécurité."""

    __tablename__ = "connexions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"), index=True)
    matricule: Mapped[str] = mapped_column(String(40))          # tel que saisi
    horodatage: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    adresse_ip: Mapped[str | None] = mapped_column(String(64))
    navigateur: Mapped[str | None] = mapped_column(String(255))
    resultat: Mapped[str] = mapped_column(String(30))            # succes, mot_de_passe, bloque, code_2fa…
    double_auth: Mapped[bool] = mapped_column(Boolean, default=False)

    employe: Mapped["Employe | None"] = relationship()


# --------------------------------------------------------------------------
# Avances sur salaire et prêts sociaux (confidentiel : RH + intéressé)
# --------------------------------------------------------------------------
class Pret(Base):
    __tablename__ = "prets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    type_pret: Mapped[str] = mapped_column(String(20))            # avance, pret_social
    montant: Mapped[float] = mapped_column(Float)
    nb_mensualites: Mapped[int] = mapped_column(Integer)
    taux_annuel: Mapped[float] = mapped_column(Float, default=0)
    motif: Mapped[str | None] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(String(20), default="demande")   # demande, accorde, refuse, solde, annule
    demande_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    decide_le: Mapped[datetime | None] = mapped_column(DateTime)
    decide_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    commentaire_rh: Mapped[str | None] = mapped_column(Text)
    premiere_echeance: Mapped[date | None] = mapped_column(Date)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    decide_par: Mapped["Employe | None"] = relationship(foreign_keys=[decide_par_id])
    echeances: Mapped[list["EcheancePret"]] = relationship(back_populates="pret", cascade="all, delete-orphan",
                                                         order_by="EcheancePret.numero")


class EcheancePret(Base):
    __tablename__ = "echeances_pret"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pret_id: Mapped[int] = mapped_column(ForeignKey("prets.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)
    mois: Mapped[date] = mapped_column(Date, index=True)          # 1er du mois de retenue sur salaire
    capital: Mapped[float] = mapped_column(Float)
    interets: Mapped[float] = mapped_column(Float, default=0)
    montant: Mapped[float] = mapped_column(Float)
    statut: Mapped[str] = mapped_column(String(20), default="prevue")   # prevue, reportee, annulee

    pret: Mapped["Pret"] = relationship(back_populates="echeances")


# --------------------------------------------------------------------------
# Supervision technique : tâches automatiques, erreurs et sauvegardes
# --------------------------------------------------------------------------
class EtatTache(Base):
    """Dernier état consolidé d'un traitement automatique, sans historique infini."""

    __tablename__ = "etats_taches"

    nom: Mapped[str] = mapped_column(String(80), primary_key=True)
    statut: Mapped[str] = mapped_column(String(20), default="jamais")  # succes, echec, jamais
    derniere_execution: Mapped[datetime | None] = mapped_column(DateTime)
    dernier_succes: Mapped[datetime | None] = mapped_column(DateTime)
    dernier_echec: Mapped[datetime | None] = mapped_column(DateTime)
    duree_ms: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[str | None] = mapped_column(String(500))
    executions: Mapped[int] = mapped_column(Integer, default=0)
    echecs: Mapped[int] = mapped_column(Integer, default=0)


class IncidentTechnique(Base):
    """Erreur regroupée par empreinte pour éviter une ligne à chaque répétition."""

    __tablename__ = "incidents_techniques"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    empreinte: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    type_erreur: Mapped[str] = mapped_column(String(120))
    message: Mapped[str] = mapped_column(String(1000))
    detail: Mapped[str | None] = mapped_column(Text)
    occurrences: Mapped[int] = mapped_column(Integer, default=1)
    premiere_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    derniere_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    resolu_le: Mapped[datetime | None] = mapped_column(DateTime)
    resolu_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))

    resolu_par: Mapped["Employe | None"] = relationship(foreign_keys=[resolu_par_id])


# --------------------------------------------------------------------------
# Compétences, emplois de référence, postes clés et succession
# --------------------------------------------------------------------------
class Competence(Base):
    __tablename__ = "competences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nom: Mapped[str] = mapped_column(String(120), unique=True)
    domaine: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Emploi(Base):
    """Emploi de référence (métier) et compétences qu'il requiert."""

    __tablename__ = "emplois"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    intitule: Mapped[str] = mapped_column(String(120), unique=True)
    famille: Mapped[str | None] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)

    exigences: Mapped[list["ExigenceEmploi"]] = relationship(back_populates="emploi", cascade="all, delete-orphan")


class ExigenceEmploi(Base):
    __tablename__ = "exigences_emploi"
    __table_args__ = (UniqueConstraint("emploi_id", "competence_id", name="uq_exigence"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    emploi_id: Mapped[int] = mapped_column(ForeignKey("emplois.id"), index=True)
    competence_id: Mapped[int] = mapped_column(ForeignKey("competences.id"))
    niveau_requis: Mapped[int] = mapped_column(Integer)          # 1 notions … 4 expert

    emploi: Mapped["Emploi"] = relationship(back_populates="exigences")
    competence: Mapped["Competence"] = relationship()


class AffectationEmploi(Base):
    """Emploi de référence occupé par le collaborateur (1 pour 1)."""

    __tablename__ = "affectations_emploi"

    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), primary_key=True)
    emploi_id: Mapped[int] = mapped_column(ForeignKey("emplois.id"))

    emploi: Mapped["Emploi"] = relationship()


class EvaluationCompetence(Base):
    __tablename__ = "evaluations_competence"
    __table_args__ = (UniqueConstraint("employe_id", "competence_id", name="uq_evaluation_competence"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    competence_id: Mapped[int] = mapped_column(ForeignKey("competences.id"))
    niveau: Mapped[int] = mapped_column(Integer)
    commentaire: Mapped[str | None] = mapped_column(Text)
    evalue_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    evalue_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    competence: Mapped["Competence"] = relationship()
    evalue_par: Mapped["Employe | None"] = relationship(foreign_keys=[evalue_par_id])


class PosteCle(Base):
    __tablename__ = "postes_cles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    intitule: Mapped[str] = mapped_column(String(160))
    titulaire_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    criticite: Mapped[int] = mapped_column(Integer, default=2)      # 1 modérée, 2 forte, 3 vitale
    notes: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    titulaire: Mapped["Employe | None"] = relationship()
    successeurs: Mapped[list["Successeur"]] = relationship(back_populates="poste", cascade="all, delete-orphan")


class Successeur(Base):
    __tablename__ = "successeurs"
    __table_args__ = (UniqueConstraint("poste_id", "employe_id", name="uq_successeur"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    poste_id: Mapped[int] = mapped_column(ForeignKey("postes_cles.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"))
    preparation: Mapped[str] = mapped_column(String(20))           # immediat, 1_2_ans, 3_ans
    commentaire: Mapped[str | None] = mapped_column(Text)

    poste: Mapped["PosteCle"] = relationship(back_populates="successeurs")
    employe: Mapped["Employe"] = relationship()


# --------------------------------------------------------------------------
# Offres de postes en interne et candidatures (mobilité)
# --------------------------------------------------------------------------
class OffreInterne(Base):
    __tablename__ = "offres_internes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    intitule: Mapped[str] = mapped_column(String(160))
    departement_id: Mapped[int | None] = mapped_column(ForeignKey("departements.id"))
    emploi_id: Mapped[int | None] = mapped_column(ForeignKey("emplois.id"))
    lieu: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    profil: Mapped[str | None] = mapped_column(Text)
    date_limite: Mapped[date] = mapped_column(Date)
    statut: Mapped[str] = mapped_column(String(20), default="ouverte")   # ouverte, cloturee, pourvue
    publication: Mapped[str] = mapped_column(String(20), default="interne")  # interne, externe
    cree_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    departement: Mapped["Departement | None"] = relationship()
    emploi: Mapped["Emploi | None"] = relationship()
    candidatures: Mapped[list["Candidature"]] = relationship(back_populates="offre", cascade="all, delete-orphan")
    candidatures_externes: Mapped[list["CandidatureExterne"]] = relationship(
        back_populates="offre", cascade="all, delete-orphan"
    )


class Candidature(Base):
    __tablename__ = "candidatures"
    __table_args__ = (UniqueConstraint("offre_id", "employe_id", name="uq_candidature"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    offre_id: Mapped[int] = mapped_column(ForeignKey("offres_internes.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    motivation: Mapped[str | None] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(String(20), default="deposee")  # deposee, etudiee, entretien, retenue, non_retenue, retiree
    commentaire_rh: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    mis_a_jour_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    offre: Mapped["OffreInterne"] = relationship(back_populates="candidatures")
    employe: Mapped["Employe"] = relationship()


class CandidatureExterne(Base):
    """Candidature déposée hors effectif ; son CV n'est jamais servi publiquement."""
    __tablename__ = "candidatures_externes"
    __table_args__ = (UniqueConstraint("offre_id", "email", name="uq_candidature_externe"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    offre_id: Mapped[int] = mapped_column(ForeignKey("offres_internes.id"), index=True)
    nom: Mapped[str] = mapped_column(String(80))
    prenom: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(160), index=True)
    telephone: Mapped[str | None] = mapped_column(String(30))
    motivation: Mapped[str | None] = mapped_column(Text)
    cv_chemin: Mapped[str] = mapped_column(String(255))
    cv_nom_original: Mapped[str] = mapped_column(String(255))
    statut: Mapped[str] = mapped_column(String(20), default="deposee")
    commentaire_rh: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    mis_a_jour_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    offre: Mapped["OffreInterne"] = relationship(back_populates="candidatures_externes")


# --------------------------------------------------------------------------
# Accidents du travail et suivi médical (données de santé chiffrées)
# --------------------------------------------------------------------------
class AccidentTravail(Base):
    __tablename__ = "accidents_travail"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    type_accident: Mapped[str] = mapped_column(String(30))        # travail, trajet, maladie_professionnelle
    date_accident: Mapped[date] = mapped_column(Date, index=True)
    heure: Mapped[time | None] = mapped_column(Time)
    lieu: Mapped[str | None] = mapped_column(String(160))
    circonstances: Mapped[str | None] = mapped_column(TexteChiffre)
    temoins: Mapped[str | None] = mapped_column(TexteChiffre)
    lesions: Mapped[str | None] = mapped_column(TexteChiffre)     # santé : RH et intéressé
    arret: Mapped[bool] = mapped_column(Boolean, default=False)
    debut_arret: Mapped[date | None] = mapped_column(Date)
    fin_arret: Mapped[date | None] = mapped_column(Date)
    date_reprise: Mapped[date | None] = mapped_column(Date)
    statut: Mapped[str] = mapped_column(String(20), default="declare")   # declare, transmis, clos
    reference_cnam: Mapped[str | None] = mapped_column(String(60))
    transmis_le: Mapped[date | None] = mapped_column(Date)
    declare_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    declare_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    declare_par: Mapped["Employe | None"] = relationship(foreign_keys=[declare_par_id])
    suivis: Mapped[list["SuiviAccident"]] = relationship(back_populates="accident", cascade="all, delete-orphan",
                                                        order_by="SuiviAccident.date_suivi")


class SuiviAccident(Base):
    __tablename__ = "suivis_accident"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accident_id: Mapped[int] = mapped_column(ForeignKey("accidents_travail.id"), index=True)
    date_suivi: Mapped[date] = mapped_column(Date)
    type_suivi: Mapped[str] = mapped_column(String(30))   # certificat_initial, prolongation, visite_reprise, consolidation, autre
    jours_arret: Mapped[int | None] = mapped_column(Integer)
    commentaire: Mapped[str | None] = mapped_column(TexteChiffre)
    piece_jointe: Mapped[str | None] = mapped_column(String(255))
    saisi_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))

    accident: Mapped["AccidentTravail"] = relationship(back_populates="suivis")


# --------------------------------------------------------------------------
# Dossier disciplinaire (RH uniquement ; faits chiffrés)
# --------------------------------------------------------------------------
class Sanction(Base):
    __tablename__ = "sanctions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    type_sanction: Mapped[str] = mapped_column(String(30))
    date_faits: Mapped[date] = mapped_column(Date)
    faits: Mapped[str] = mapped_column(TexteChiffre)
    date_entretien: Mapped[date | None] = mapped_column(Date)     # entretien / audition préalable
    date_notification: Mapped[date | None] = mapped_column(Date)
    jours_mise_a_pied: Mapped[int | None] = mapped_column(Integer)
    reference: Mapped[str | None] = mapped_column(String(80))
    observations: Mapped[str | None] = mapped_column(TexteChiffre)
    piece_jointe: Mapped[str | None] = mapped_column(String(255))
    statut: Mapped[str] = mapped_column(String(20), default="instruction")   # instruction, notifiee, annulee
    cree_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    cree_par: Mapped["Employe | None"] = relationship(foreign_keys=[cree_par_id])


# --------------------------------------------------------------------------
# Générateur de documents RH : registre des documents émis
# --------------------------------------------------------------------------
class DocumentEmis(Base):
    """Chaque document produit par le générateur : numéro, code de
    vérification (QR code) et empreinte du PDF. Jamais supprimé : annulé."""

    __tablename__ = "documents_emis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    numero: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    type_document: Mapped[str] = mapped_column(String(40))
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    demande_id: Mapped[int | None] = mapped_column(ForeignKey("demandes_documents.id"))
    emis_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    emis_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    code_verification: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    empreinte: Mapped[str] = mapped_column(String(64))
    fichier: Mapped[str] = mapped_column(String(255))            # nom dans DATA_DIR/documents_emis
    donnees: Mapped[str | None] = mapped_column(TexteChiffre)     # champs saisis (JSON), dont montants
    annule_le: Mapped[datetime | None] = mapped_column(DateTime)
    annule_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    motif_annulation: Mapped[str | None] = mapped_column(String(255))

    employe: Mapped["Employe"] = relationship(foreign_keys=[employe_id])
    emis_par: Mapped["Employe | None"] = relationship(foreign_keys=[emis_par_id])


# --------------------------------------------------------------------------
# Rémunération (confidentielle : RH et intéressé ; montants chiffrés)
# --------------------------------------------------------------------------
class Remuneration(Base):
    __tablename__ = "remunerations"

    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), primary_key=True)
    salaire_base: Mapped[str | None] = mapped_column(TexteChiffre)    # brut mensuel (DT)
    primes_fixes: Mapped[str | None] = mapped_column(TexteChiffre)    # primes mensuelles fixes brutes (DT)
    salaire_net: Mapped[str | None] = mapped_column(TexteChiffre)     # net mensuel, pour l'attestation de salaire
    mois_payes: Mapped[float] = mapped_column(Float, default=12)
    banque: Mapped[str | None] = mapped_column(String(80))
    rib: Mapped[str | None] = mapped_column(TexteChiffre)
    modifie_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    modifie_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))


# --------------------------------------------------------------------------
# Formations et habilitations obligatoires (conformité réglementaire)
# --------------------------------------------------------------------------
class Habilitation(Base):
    __tablename__ = "habilitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    intitule: Mapped[str] = mapped_column(String(160))
    categorie: Mapped[str] = mapped_column(String(30), default="formation_reglementaire")
    organisme: Mapped[str | None] = mapped_column(String(120))
    periodicite_mois: Mapped[int | None] = mapped_column(Integer)     # vide : acquise une fois pour toutes
    population: Mapped[str] = mapped_column(String(20), default="tous")   # tous, departements, niveaux
    cibles: Mapped[str | None] = mapped_column(Text)                  # JSON : identifiants ou niveaux visés
    description: Mapped[str | None] = mapped_column(Text)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class HabilitationCollaborateur(Base):
    """Une obtention (ou un renouvellement) : l'historique est conservé."""

    __tablename__ = "habilitations_collaborateurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    habilitation_id: Mapped[int] = mapped_column(ForeignKey("habilitations.id"), index=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    obtenue_le: Mapped[date] = mapped_column(Date)
    expire_le: Mapped[date | None] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(80))
    justificatif: Mapped[str | None] = mapped_column(String(255))
    relance_seuil: Mapped[int | None] = mapped_column(Integer)        # dernier seuil (jours) déjà signalé
    saisi_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    saisi_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    habilitation: Mapped["Habilitation"] = relationship()


# --------------------------------------------------------------------------
# Revue des talents : grille performance × potentiel et calibration
# --------------------------------------------------------------------------
class RevueTalent(Base):
    __tablename__ = "revues_talents"
    __table_args__ = (UniqueConstraint("employe_id", "annee", name="uq_revue_talent"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), index=True)
    annee: Mapped[int] = mapped_column(Integer)
    potentiel_propose: Mapped[int | None] = mapped_column(Integer)    # 1 faible, 2 moyen, 3 élevé
    commentaire_superieur: Mapped[str | None] = mapped_column(Text)
    propose_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    propose_le: Mapped[datetime | None] = mapped_column(DateTime)
    performance: Mapped[int | None] = mapped_column(Integer)          # calibrée par la RH
    potentiel: Mapped[int | None] = mapped_column(Integer)            # calibré par la RH
    commentaire_calibration: Mapped[str | None] = mapped_column(Text)
    calibre_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    calibre_le: Mapped[datetime | None] = mapped_column(DateTime)


# --------------------------------------------------------------------------
# Entretiens de sortie (RH ; appréciations chiffrées)
# --------------------------------------------------------------------------
class EntretienSortie(Base):
    __tablename__ = "entretiens_sortie"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employe_id: Mapped[int] = mapped_column(ForeignKey("employes.id"), unique=True, index=True)
    date_entretien: Mapped[date] = mapped_column(Date)
    motif_principal: Mapped[str] = mapped_column(String(40))
    motifs_secondaires: Mapped[str | None] = mapped_column(Text)      # JSON
    recommanderait: Mapped[int | None] = mapped_column(Integer)       # 0 à 10
    reviendrait: Mapped[bool | None] = mapped_column(Boolean)
    depart_regrette: Mapped[bool | None] = mapped_column(Boolean)     # appréciation RH
    points_forts: Mapped[str | None] = mapped_column(TexteChiffre)
    axes_amelioration: Mapped[str | None] = mapped_column(TexteChiffre)
    mene_par_id: Mapped[int | None] = mapped_column(ForeignKey("employes.id"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    modifie_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
