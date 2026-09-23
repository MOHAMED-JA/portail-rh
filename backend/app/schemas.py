"""Schémas Pydantic — contrats d'entrée/sortie de l'API."""
from __future__ import annotations

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import CodePresence, Role, StatutAnomalie, StatutDemande, StatutEmploye, TypeDemande


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------- Auth
class LoginPayload(BaseModel):
    matricule: str
    mot_de_passe: str


class TokenReponse(BaseModel):
    """Connexion : soit une session (access_token), soit l'étape du code de
    double authentification (etape = "code_2fa" et jeton_etape)."""
    access_token: str | None = None
    token_type: str = "bearer"
    utilisateur: "EmployeDetail | None" = None
    etape: str | None = None
    jeton_etape: str | None = None


# ---------------------------------------------------------------- Références
class DepartementBase(ORMModel):
    id: int
    code: str
    nom: str
    couleur: str
    parent_id: int | None = None


class DepartementDetail(DepartementBase):
    effectif: int = 0
    responsable: str | None = None
    responsable_id: int | None = None


class DepartementPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    code: str = Field(min_length=1, max_length=20)
    nom: str = Field(min_length=1, max_length=120)
    couleur: str = "#2B63C9"
    responsable_id: int | None = None
    parent_id: int | None = None


class EmployeMini(ORMModel):
    id: int
    matricule: str
    nom: str
    prenom: str
    photo: str | None = None
    poste: str | None = None


class EmployeDetail(ORMModel):
    id: int
    matricule: str
    nom: str
    prenom: str
    email: str
    telephone: str | None = None
    photo: str | None = None
    poste: str
    date_entree: date | None = None
    statut: StatutEmploye
    role: Role
    departement: DepartementBase | None = None
    validateur: EmployeMini | None = None
    doit_changer_mdp: bool = False
    niveau: str = "collaborateur"
    totp_active: bool = False
    double_auth_requise: bool = False
    double_auth_obligatoire: bool = False


class EmployePayload(BaseModel):
    matricule: str
    nom: str
    prenom: str
    email: EmailStr
    telephone: str | None = None
    poste: str
    date_entree: date | None = None
    departement_id: int | None = None
    validateur_id: int | None = None
    role: Role = Role.EMPLOYE
    statut: StatutEmploye = StatutEmploye.ACTIF
    mot_de_passe: str | None = None
    jours_acquis: float | None = None
    niveau: str = "collaborateur"


class EmployeMAJ(BaseModel):
    nom: str | None = None
    prenom: str | None = None
    email: EmailStr | None = None
    telephone: str | None = None
    poste: str | None = None
    departement_id: int | None = None
    validateur_id: int | None = None
    role: Role | None = None
    statut: StatutEmploye | None = None
    mot_de_passe: str | None = None
    niveau: str | None = None


# --------------------------------------------------------------------- Solde
class SoldeDetail(ORMModel):
    annee: int
    jours_acquis: float
    jours_pris: float
    report_anterieur: float
    jours_restants: float


class SoldePayload(BaseModel):
    annee: int
    jours_acquis: float
    report_anterieur: float = 0
    jours_pris: float | None = None


# ------------------------------------------------------------------ Demandes
class HistoriqueItem(ORMModel):
    statut: StatutDemande
    commentaire: str | None = None
    horodatage: datetime
    acteur: EmployeMini | None = None


class DemandeDetail(ORMModel):
    id: int
    reference: str
    type_demande: TypeDemande
    sous_type: str
    sous_type_libelle: str = ""
    employe: EmployeMini
    date_debut: date
    date_fin: date
    heure_debut: time | None = None
    heure_fin: time | None = None
    demi_journee: str | None = None
    nombre_jours: float
    duree_heures: float | None = None
    commentaire: str | None = None
    piece_jointe: str | None = None
    statut: StatutDemande
    validateur: EmployeMini | None = None
    date_validation: datetime | None = None
    motif_refus: str | None = None
    niveau_courant: int
    niveaux_requis: int
    derogation_rh: bool = False
    solde_insuffisant: bool = False
    validation_auto_le: datetime | None = None
    cree_le: datetime
    historique: list[HistoriqueItem] = []


class CongePayload(BaseModel):
    sous_type: str
    date_debut: date
    date_fin: date
    demi_journee: str | None = None
    commentaire: str | None = None
    piece_jointe: str | None = None


class AutorisationPayload(BaseModel):
    sous_type: str
    date_debut: date
    heure_debut: time
    heure_fin: time
    commentaire: str | None = None


class MissionPayload(BaseModel):
    sous_type: str
    date_debut: date
    date_fin: date
    commentaire: str | None = None


class DecisionPayload(BaseModel):
    commentaire: str | None = None
    signature: str | None = None


class SimulationConge(BaseModel):
    nombre_jours: float
    jours_restants_avant: float
    jours_restants_apres: float
    depassement: bool
    decompte_solde: bool
    jours_feries: list[str] = []
    message: str | None = None


# ----------------------------------------------------------------- Pointages
class PointageDetail(ORMModel):
    id: int
    employe: EmployeMini
    date_jour: date
    entree1: time | None = None
    sortie1: time | None = None
    entree2: time | None = None
    sortie2: time | None = None
    heures_travaillees: float
    heures_prevues: float
    retard_minutes: int
    code_presence: CodePresence
    anomalies: list[str] = []
    passages: list[str] = []   # chaque passage de badge, « HH:MM »


class PointagePayload(BaseModel):
    employe_id: int
    date_jour: date
    entree1: time | None = None
    sortie1: time | None = None
    entree2: time | None = None
    sortie2: time | None = None
    code_presence: CodePresence = CodePresence.PRESENT


class AnomalieDetail(ORMModel):
    id: int
    employe: EmployeMini
    date_jour: date
    type_anomalie: str
    detail: str | None = None
    statut: StatutAnomalie
    justification: str | None = None


# ------------------------------------------------------------------ Planning
class PlanningDetail(ORMModel):
    id: int
    employe: EmployeMini
    date_jour: date
    semaine: str
    poste: str
    heure_debut: time
    heure_fin: time
    note: str | None = None


class PlanningPayload(BaseModel):
    employe_id: int
    date_jour: date
    poste: str
    heure_debut: time = time(8, 30)
    heure_fin: time = time(17, 0)
    note: str | None = None


# ------------------------------------------------------------- Notifications
class NotificationDetail(ORMModel):
    id: int
    titre: str
    message: str
    type_notif: str
    lien: str | None = None
    lu: bool
    horodatage: datetime


# --------------------------------------------------------------- Tableau bord
class KPI(BaseModel):
    valeur: float
    libelle: str
    unite: str = ""
    variation: float | None = None
    detail: str | None = None


class SerieMensuelle(BaseModel):
    mois: list[str]
    heures_travaillees: list[float]
    heures_prevues: list[float]
    heures_supp: list[float]


class TableauBord(BaseModel):
    solde: SoldeDetail | None = None
    kpis: dict[str, KPI]
    repartition_absences: dict[str, int]
    repartition_retards: dict[str, int]
    series: SerieMensuelle
    dernieres_demandes: list[DemandeDetail]
    notifications_non_lues: int


class InsightRH(BaseModel):
    niveau: str  # info | alerte | critique
    titre: str
    message: str
    action: str | None = None


class DocumentDetail(ORMModel):
    id: int
    titre: str
    categorie: str
    periode: str | None = None
    fichier: str | None = None
    signe: bool
    cree_le: datetime


class AuditItem(ORMModel):
    id: int
    action: str
    cible: str | None = None
    detail: str | None = None
    horodatage: datetime
    acteur: EmployeMini | None = None


TokenReponse.model_rebuild()
