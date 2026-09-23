"""Bilan social individuel : ce que la compagnie a investi pour chacun sur
l'année — rémunération et coût employeur, formation, congés, avances et
prêts, habilitations. Document personnel : l'intéressé et la RH seulement.

Seules les données présentes dans le portail sont reprises ; une rubrique sans
donnée l'indique au lieu d'afficher un zéro trompeur."""
from __future__ import annotations

import io
from datetime import date
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant
from app.models import (
    ROLES_RH, Demande, DossierEmploye, Employe, Formation, InscriptionFormation, Pret, SoldeConge, StatutDemande,
    TypeDemande,
)
from app.services import habilitations, remuneration
from app.services.calendrier import compter_jours_conge
from app.services.documents import EnteteDocument, fiche_cle_valeur, generer_pdf, paragraphe, tableau_donnees
from app.services.generateur import dinars

router = APIRouter(prefix="/api/bilan-individuel", tags=["Bilan social individuel"])


def _formations(db: Session, e: Employe, annee: int) -> tuple[list[list[str]], float]:
    lignes, total = [], 0.0
    inscriptions = db.scalars(select(InscriptionFormation).join(Formation).where(
        InscriptionFormation.employe_id == e.id, Formation.date_debut >= date(annee, 1, 1),
        Formation.date_debut <= date(annee, 12, 31)).order_by(Formation.date_debut))
    for i in inscriptions:
        f = i.formation
        part = (f.cout or 0) / max(1, len(f.inscriptions))
        total += part
        lignes.append([escape(f.titre), f"{f.date_debut:%d/%m/%Y}", f"{(f.date_fin - f.date_debut).days + 1} j",
                       dinars(part) if f.cout else "—"])
    return lignes, total


def construire(db: Session, e: Employe, annee: int, edite_par: str) -> bytes:
    dossier = db.get(DossierEmploye, e.id)
    anciennete = f"{annee - e.date_entree.year} an(s)" if e.date_entree else "Date d'entrée non renseignée"
    contenu = paragraphe(
        f"Ce bilan récapitule, pour l'année <b>{annee}</b>, les éléments de votre relation de travail avec "
        f"Veltaris tels qu'ils sont enregistrés dans le portail RH. Il est personnel et confidentiel.")
    contenu += fiche_cle_valeur([
        ("Collaborateur", escape(f"{e.prenom} {e.nom}")), ("Matricule", e.matricule), ("Poste", escape(e.poste or "—")),
        ("Direction", escape(e.departement.nom) if e.departement else "—"),
        ("Catégorie / grade", escape(" · ".join(x for x in ((dossier.categorie if dossier else None),
                                                         (dossier.grade if dossier else None)) if x) or "Non renseignés")),
        ("Date d'entrée", e.date_entree.strftime("%d/%m/%Y") if e.date_entree else "Non renseignée"),
        ("Ancienneté", anciennete),
    ], "Votre situation")

    r = remuneration.lire(db, e.id)
    regles = remuneration.reglages(db)
    if r:
        brut = remuneration.annuel_brut(r)
        cout = remuneration.cout_employeur(r, regles["taux_charges"])
        contenu += fiche_cle_valeur([
            ("Salaire de base mensuel brut", dinars(r["salaire_base"])),
            ("Primes fixes mensuelles", dinars(r["primes_fixes"])),
            ("Mois payés dans l'année", f"{r['mois_payes']:g}"),
            ("Rémunération annuelle brute", dinars(brut)),
            (f"Charges patronales ({regles['taux_charges']:g} %)", dinars(cout - brut)),
            ("Coût total pour l'employeur", f"<b>{dinars(cout)}</b>"),
        ], "Votre rémunération (éléments fixes)")
    else:
        contenu += fiche_cle_valeur([("Rémunération", "Non encore saisie dans le portail RH")], "Votre rémunération")

    lignes, total_formation = _formations(db, e, annee)
    if lignes:
        contenu += tableau_donnees(["Formation", "Début", "Durée", "Part du coût"], lignes, titre_section="Votre formation")
        if total_formation:
            contenu += paragraphe(f"Investissement de la compagnie dans votre formation : <b>{dinars(total_formation)}</b>.")
    else:
        contenu += fiche_cle_valeur([("Formation", f"Aucune formation enregistrée en {annee}")], "Votre formation")

    solde = db.scalar(select(SoldeConge).where(SoldeConge.employe_id == e.id, SoldeConge.annee == annee))
    maladie = sum(compter_jours_conge(max(d.date_debut, date(annee, 1, 1)), min(d.date_fin, date(annee, 12, 31))) or 0
                  for d in db.scalars(select(Demande).where(
                      Demande.employe_id == e.id, Demande.statut == StatutDemande.APPROUVEE,
                      Demande.type_demande == TypeDemande.CONGE, Demande.sous_type == "maladie",
                      Demande.date_fin >= date(annee, 1, 1), Demande.date_debut <= date(annee, 12, 31))))
    conges = [("Jours de congé acquis", f"{solde.jours_acquis:g} j"), ("Report de l'année précédente", f"{solde.report_anterieur:g} j"),
              ("Jours pris", f"{solde.jours_pris:g} j"), ("Solde", f"{solde.jours_restants:g} j")] if solde else [
              ("Congés", "Aucun solde enregistré pour cette année")]
    contenu += fiche_cle_valeur(conges + [("Jours de congé maladie", f"{maladie:g} j")], "Vos congés et absences")

    prets = list(db.scalars(select(Pret).where(Pret.employe_id == e.id, Pret.statut.in_(("accorde", "solde")),
                                               Pret.decide_le.isnot(None))))
    prets = [p for p in prets if p.decide_le.year == annee]
    if prets:
        contenu += tableau_donnees(["Nature", "Accordé le", "Montant", "Mensualités", "Taux"],
                                   [["Avance sur salaire" if p.type_pret == "avance" else "Prêt social", f"{p.decide_le:%d/%m/%Y}",
                                     dinars(p.montant), str(p.nb_mensualites), f"{p.taux_annuel:g} %"] for p in prets],
                                   titre_section="Vos avances et prêts sociaux")

    exigences = habilitations.situation(db, [e])
    if exigences:
        a_jour = sum(1 for l in exigences if l["statut"] in ("conforme", "a_renouveler"))
        contenu += fiche_cle_valeur([("Habilitations obligatoires à jour", f"{a_jour} sur {len(exigences)}")],
                                    "Vos habilitations")

    entete = EnteteDocument(f"Bilan social individuel {annee}", sous_titre=escape(f"{e.prenom} {e.nom} — matricule {e.matricule}"),
                            reference=f"BSI-{annee}-{e.matricule}", edite_par=edite_par)
    return generer_pdf(entete, contenu, observation="Montants indicatifs, établis à partir des données saisies dans le "
                       "portail RH ; ils ne remplacent pas vos bulletins de paie.",
                       signataire="Directeur des Ressources Humaines").getvalue()


@router.get("/{matricule}.pdf", summary="Bilan social individuel (l'intéressé ou la RH)")
def bilan(matricule: str, annee: int | None = None, db: Session = Depends(get_db),
          utilisateur: Employe = Depends(utilisateur_courant)):
    e = db.scalar(select(Employe).where(Employe.matricule == matricule.strip().upper()))
    if not e:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")
    if e.id != utilisateur.id and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Bilan réservé à l'intéressé et à la RH.")
    annee = annee or date.today().year
    if not 2000 <= annee <= date.today().year:
        raise HTTPException(status_code=422, detail="Année invalide.")
    pdf = construire(db, e, annee, f"{utilisateur.prenom} {utilisateur.nom}")
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="RH-bilan-individuel-{annee}-{e.matricule}.pdf"'})
