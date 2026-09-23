"""Contrôle de complétude et de cohérence des données RH."""
from datetime import date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import administrateur_requis
from app.models import DossierEmploye, Employe, Role, SoldeConge, StatutEmploye

router = APIRouter(prefix="/api/qualite-donnees", tags=["Qualité des données"])


@router.get("", summary="Anomalies de qualité des données RH")
def tableau(db: Session = Depends(get_db), utilisateur: Employe = Depends(administrateur_requis)):
    """Retourne seulement les champs absents ou incohérents, jamais leurs valeurs sensibles."""
    actifs = list(db.scalars(select(Employe).where(Employe.statut != StatutEmploye.SORTI).order_by(
        Employe.nom, Employe.prenom
    )))
    dossiers = {d.employe_id: d for d in db.scalars(select(DossierEmploye).where(
        DossierEmploye.employe_id.in_([e.id for e in actifs])
    ))}
    soldes = {s.employe_id for s in db.scalars(select(SoldeConge).where(
        SoldeConge.annee == date.today().year, SoldeConge.employe_id.in_([e.id for e in actifs])
    ))}
    anomalies: list[dict] = []

    def signaler(employe: Employe, code: str, gravite: str, libelle: str) -> None:
        anomalies.append({
            "matricule": employe.matricule,
            "identite": employe.nom_complet,
            "code": code,
            "gravite": gravite,
            "libelle": libelle,
        })

    for employe in actifs:
        dossier = dossiers.get(employe.id)
        if not employe.departement_id:
            signaler(employe, "sans_structure", "critique", "Structure ou direction non renseignée")
        if employe.niveau != "dg" and not employe.validateur_id:
            signaler(employe, "sans_superieur", "critique", "Supérieur hiérarchique non renseigné")
        elif employe.validateur and employe.validateur.statut == StatutEmploye.SORTI:
            signaler(employe, "superieur_sorti", "critique", "Supérieur hiérarchique sorti de l'effectif")
        if not employe.email or not employe.email.strip():
            signaler(employe, "email_absent", "attention", "Adresse e-mail professionnelle non renseignée")
        if not employe.poste or employe.poste.strip().lower() in {"non renseigné", "non renseigne"}:
            signaler(employe, "poste_absent", "attention", "Poste non renseigné")
        if not employe.date_entree:
            signaler(employe, "date_entree_absente", "attention", "Date d'entrée non renseignée")
        if not dossier:
            signaler(employe, "dossier_absent", "attention", "Dossier RH à créer ou compléter")
        else:
            if not dossier.date_naissance:
                signaler(employe, "naissance_absente", "attention", "Date de naissance non renseignée")
            if not dossier.categorie:
                signaler(employe, "categorie_absente", "attention", "Catégorie professionnelle non renseignée")
        if employe.id not in soldes:
            signaler(employe, "solde_absent", "attention", f"Solde de congés {date.today().year} absent")

    ordre = {"critique": 0, "attention": 1}
    anomalies.sort(key=lambda a: (ordre[a["gravite"]], a["identite"], a["libelle"]))
    par_gravite = {niveau: sum(1 for a in anomalies if a["gravite"] == niveau) for niveau in ordre}
    par_regle: dict[str, int] = {}
    for anomalie in anomalies:
        par_regle[anomalie["code"]] = par_regle.get(anomalie["code"], 0) + 1
    droits = {role.value: sum(1 for employe in actifs if employe.role == role) for role in Role}
    return {
        "genere_le": datetime.utcnow().isoformat(),
        "effectif_actif": len(actifs),
        "anomalies": anomalies,
        "par_gravite": par_gravite,
        "par_regle": par_regle,
        "droits": droits,
        "dossiers_a_completer": par_regle.get("dossier_absent", 0) + par_regle.get("naissance_absente", 0) + par_regle.get("categorie_absente", 0),
    }
