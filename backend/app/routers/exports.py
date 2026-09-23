"""Exports PDF et Excel — tous bâtis sur les modèles de app.services.documents."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import utilisateur_courant, valideur_requis
from app.models import (
    CodePresence,
    Demande,
    Departement,
    Employe,
    Pointage,
    Role,
    StatutDemande,
    StatutEmploye,
)
from app.models import ROLES_RH  # noqa: E402
from app.services.demandes import libelle_sous_type, solde_courant
from app.services.documents import (
    EnteteDocument,
    LARGEUR_UTILE,
    fiche_cle_valeur,
    generer_excel,
    generer_pdf,
    paragraphe,
    tableau_donnees,
)

router = APIRouter(prefix="/api/exports", tags=["Exports"])

LIBELLES_STATUT = {
    StatutDemande.EN_ATTENTE: "En attente",
    StatutDemande.APPROUVEE: "Approuvée",
    StatutDemande.REJETEE: "Rejetée",
    StatutDemande.ANNULEE: "Annulée",
    StatutDemande.BROUILLON: "Brouillon",
}
COULEURS_STATUT = {"Approuvée": "DCFCE7", "Rejetée": "FEE2E2", "En attente": "FEF3C7", "Annulée": "E2E8F0"}
CODES_PRESENCE = {
    CodePresence.PRESENT: "Présent", CodePresence.CONGE: "Congé", CodePresence.MISSION: "Mission",
    CodePresence.ABSENT: "Absent", CodePresence.REPOS: "Repos", CodePresence.FERIE: "Férié",
}
MIME_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _nom(employe: Employe | None) -> str:
    return f"{employe.prenom} {employe.nom}" if employe else "—"


def _reponse(tampon, type_mime: str, nom_fichier: str) -> StreamingResponse:
    return StreamingResponse(
        tampon, media_type=type_mime,
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}"'},
    )


def _perimetre_ids(db: Session, utilisateur: Employe) -> list[int]:
    if utilisateur.role in ROLES_RH:
        return list(db.scalars(select(Employe.id).where(Employe.statut != StatutEmploye.SORTI)))
    from app.services import hierarchie

    return [utilisateur.id, *hierarchie.perimetre_ids(db, utilisateur)]


# ------------------------------------------------------------------ Excel
@router.get("/demandes.xlsx", summary="Registre des demandes (Excel)")
def export_demandes(
    statut: StatutDemande | None = None,
    annee: int | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    ids = _perimetre_ids(db, utilisateur)
    requete = select(Demande).where(Demande.employe_id.in_(ids))
    if statut:
        requete = requete.where(Demande.statut == statut)
    if annee:
        requete = requete.where(Demande.date_debut >= date(annee, 1, 1), Demande.date_debut <= date(annee, 12, 31))
    demandes = list(db.scalars(requete.order_by(Demande.cree_le.desc())))

    colonnes = [("Référence", 16), ("Matricule", 11), ("Collaborateur", 24), ("Département", 24),
                ("Type", 13), ("Motif", 28), ("Début", 12), ("Fin", 12), ("Durée", 10),
                ("Statut", 13), ("Validateur", 22), ("Décision le", 17)]
    lignes = []
    for d in demandes:
        duree = f"{d.nombre_jours:g} j" if d.nombre_jours else (f"{d.duree_heures:g} h" if d.duree_heures else "—")
        lignes.append([
            d.reference, d.employe.matricule, _nom(d.employe),
            d.employe.departement.nom if d.employe.departement else "—",
            d.type_demande.value.capitalize(), libelle_sous_type(d.type_demande, d.sous_type),
            d.date_debut.strftime("%d/%m/%Y"), d.date_fin.strftime("%d/%m/%Y"), duree,
            LIBELLES_STATUT[d.statut], _nom(d.validateur),
            d.date_validation.strftime("%d/%m/%Y %H:%M") if d.date_validation else "—",
        ])

    perimetre = "toute l'entreprise" if utilisateur.role in ROLES_RH else (
        "mon équipe" if utilisateur.role == Role.VALIDATEUR else "mes demandes")
    entete = EnteteDocument("Registre des demandes", sous_titre=f"Périmètre : {perimetre}", edite_par=_nom(utilisateur))
    tampon = generer_excel(entete, colonnes, lignes, "Demandes", colonne_statut=10, couleurs_statut=COULEURS_STATUT)
    return _reponse(tampon, MIME_EXCEL, f"RH-registre-demandes-{date.today():%Y%m%d}.xlsx")


@router.get("/pointages.xlsx", summary="Pointages d'une période (Excel)")
def export_pointages(
    debut: date | None = None,
    fin: date | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    aujourdhui = date.today()
    debut = debut or aujourdhui.replace(day=1)
    fin = fin or aujourdhui
    ids = _perimetre_ids(db, utilisateur)
    pointages = list(db.scalars(
        select(Pointage)
        .where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut, Pointage.date_jour <= fin)
        .order_by(Pointage.date_jour.desc(), Pointage.employe_id)
    ))

    heure = lambda h: h.strftime("%H:%M") if h else "—"  # noqa: E731
    colonnes = [("Date", 12), ("Matricule", 11), ("Collaborateur", 24), ("Entrée 1", 10), ("Sortie 1", 10),
                ("Entrée 2", 10), ("Sortie 2", 10), ("Heures faites", 13), ("Heures prévues", 14),
                ("Retard (min)", 12), ("Présence", 12)]
    lignes = [[
        p.date_jour.strftime("%d/%m/%Y"), p.employe.matricule, _nom(p.employe),
        heure(p.entree1), heure(p.sortie1), heure(p.entree2), heure(p.sortie2),
        p.heures_travaillees, p.heures_prevues, p.retard_minutes, CODES_PRESENCE.get(p.code_presence, "—"),
    ] for p in pointages]

    entete = EnteteDocument("Relevé des pointages", sous_titre=f"Du {debut:%d/%m/%Y} au {fin:%d/%m/%Y}",
                            edite_par=_nom(utilisateur))
    tampon = generer_excel(entete, colonnes, lignes, "Pointages", colonne_statut=11,
                           couleurs_statut={"Absent": "FEE2E2", "Congé": "DBEAFE", "Mission": "EDE9FE"})
    return _reponse(tampon, MIME_EXCEL, f"RH-pointages-{debut:%Y%m%d}-{fin:%Y%m%d}.xlsx")


# -------------------------------------------------------------------- PDF
@router.get("/demande/{demande_id}.pdf", summary="Justificatif PDF d'une demande")
def export_demande_pdf(
    demande_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)
):
    demande = db.get(Demande, demande_id)
    if not demande:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if demande.employe_id != utilisateur.id and utilisateur.role == Role.EMPLOYE:
        raise HTTPException(status_code=403, detail="Accès non autorisé")

    e = demande.employe
    titres = {"conge": "Attestation de congé", "autorisation": "Autorisation d'absence", "mission": "Ordre de mission"}

    identite = [
        ("Collaborateur", _nom(e)),
        ("Matricule", e.matricule),
        ("Poste", e.poste),
        ("Département", e.departement.nom if e.departement else "—"),
    ]
    objet = [
        ("Motif", libelle_sous_type(demande.type_demande, demande.sous_type)),
        ("Période", f"du {demande.date_debut:%d/%m/%Y} au {demande.date_fin:%d/%m/%Y}"),
    ]
    if demande.heure_debut and demande.heure_fin:
        objet.append(("Horaire", f"{demande.heure_debut:%H:%M} — {demande.heure_fin:%H:%M}"))
    if demande.nombre_jours:
        objet.append(("Durée", f"{demande.nombre_jours:g} jour(s) ouvré(s)"))
    if demande.commentaire:
        objet.append(("Commentaire", demande.commentaire))

    decision = [
        ("Statut", LIBELLES_STATUT[demande.statut]),
        ("Validé par", _nom(demande.validateur)),
        ("Date de décision", demande.date_validation.strftime("%d/%m/%Y à %H:%M") if demande.date_validation else "—"),
    ]

    contenu = (fiche_cle_valeur(identite, "Collaborateur")
               + fiche_cle_valeur(objet, "Objet de la demande")
               + fiche_cle_valeur(decision, "Décision"))

    entete = EnteteDocument(titres.get(demande.type_demande.value, "Demande"),
                            sous_titre="Justificatif émis par la Direction des Ressources Humaines",
                            reference=demande.reference, edite_par=_nom(utilisateur))
    signataire = (f"{_nom(demande.validateur)} — {demande.validateur.poste}"
                  if demande.validateur and demande.statut == StatutDemande.APPROUVEE else None)
    tampon = generer_pdf(entete, contenu, observation=demande.motif_refus, signataire=signataire)
    return _reponse(tampon, "application/pdf", f"{demande.reference}.pdf")


@router.get("/solde.pdf", summary="Attestation de solde de congés")
def export_solde_pdf(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    solde = solde_courant(db, utilisateur.id)
    db.commit()

    contenu = fiche_cle_valeur([
        ("Collaborateur", _nom(utilisateur)),
        ("Matricule", utilisateur.matricule),
        ("Département", utilisateur.departement.nom if utilisateur.departement else "—"),
    ], "Collaborateur") + tableau_donnees(
        ["Exercice", "Jours acquis", "Report antérieur", "Jours pris", "Solde restant"],
        [[str(solde.annee), f"{solde.jours_acquis:g} j", f"{solde.report_anterieur:g} j",
          f"{solde.jours_pris:g} j", f"{solde.jours_restants:g} j"]],
        titre_section="Situation des congés",
    ) + paragraphe(
        "Le solde indiqué tient compte des seules demandes approuvées à la date d'édition. "
        "Les demandes en cours de validation n'y sont pas encore imputées."
    )
    entete = EnteteDocument("Attestation de solde de congés", sous_titre=f"Situation arrêtée au {date.today():%d/%m/%Y}",
                            reference=f"SOL-{utilisateur.matricule}-{solde.annee}", edite_par=_nom(utilisateur))
    tampon = generer_pdf(entete, contenu, signataire="Direction des Ressources Humaines")
    return _reponse(tampon, "application/pdf", f"RH-solde-{utilisateur.matricule}.pdf")


@router.get("/attestation-travail.pdf", summary="Attestation de travail")
def export_attestation_travail(
    matricule: str | None = None,
    db: Session = Depends(get_db),
    utilisateur: Employe = Depends(utilisateur_courant),
):
    """Un collaborateur édite la sienne ; la RH peut éditer celle d'un tiers."""
    cible = utilisateur
    if matricule and matricule != utilisateur.matricule:
        if utilisateur.role not in ROLES_RH:
            raise HTTPException(status_code=403, detail="Seule la direction RH peut éditer l'attestation d'un tiers")
        cible = db.scalar(select(Employe).where(Employe.matricule == matricule.upper()))
        if not cible:
            raise HTTPException(status_code=404, detail="Collaborateur introuvable")

    # Les champs inconnus restent affichés comme tels : jamais de valeur supposée.
    depuis = f" depuis le {cible.date_entree:%d/%m/%Y}" if cible.date_entree else ""
    poste = f" et y occupe à ce jour le poste de <b>{cible.poste}</b>" if cible.poste != "Non renseigné" else ""
    contenu = paragraphe(
        f"Nous soussignés, <b>Veltaris</b>, attestons que <b>{_nom(cible)}</b>, "
        f"matricule {cible.matricule}, fait partie de nos effectifs{depuis}{poste}."
    ) + fiche_cle_valeur([
        ("Collaborateur", _nom(cible)),
        ("Matricule", cible.matricule),
        ("Poste occupé", cible.poste),
        ("Département", cible.departement.nom if cible.departement else "—"),
        ("Date d'entrée", cible.date_entree.strftime("%d/%m/%Y") if cible.date_entree else "Non renseignée"),
        ("Ancienneté", f"{date.today().year - cible.date_entree.year} an(s)" if cible.date_entree else "Non renseignée"),
        ("Situation", "En activité au sein de la compagnie"),
    ], "Renseignements") + paragraphe(
        "La présente attestation est délivrée à l'intéressé(e), sur sa demande, "
        "pour servir et valoir ce que de droit."
    )
    entete = EnteteDocument("Attestation de travail", sous_titre="Délivrée par la Direction des Ressources Humaines",
                            reference=f"ATT-{cible.matricule}-{date.today():%Y%m%d}", edite_par=_nom(utilisateur))
    tampon = generer_pdf(entete, contenu, signataire="Directeur des Ressources Humaines")
    return _reponse(tampon, "application/pdf", f"RH-attestation-travail-{cible.matricule}.pdf")


@router.get("/synthese.pdf", summary="Synthèse RH consolidée")
def export_synthese(db: Session = Depends(get_db), utilisateur: Employe = Depends(valideur_requis)):
    aujourdhui = date.today()
    debut_annee = date(aujourdhui.year, 1, 1)
    lignes, total_effectif, total_heures = [], 0, 0.0

    for departement in db.scalars(select(Departement).order_by(Departement.nom)):
        ids = list(db.scalars(select(Employe.id).where(
            Employe.departement_id == departement.id, Employe.statut != StatutEmploye.SORTI)))
        if not ids:
            continue
        pointages = db.scalars(
            select(Pointage).where(Pointage.employe_id.in_(ids), Pointage.date_jour >= debut_annee)
        ).all()
        total = len(pointages) or 1
        absents = sum(1 for p in pointages if p.code_presence in (CodePresence.ABSENT, CodePresence.CONGE))
        retards = [p.retard_minutes for p in pointages if p.retard_minutes > 0]
        heures = sum(p.heures_travaillees for p in pointages)
        en_attente = db.scalar(select(func.count(Demande.id)).where(
            Demande.employe_id.in_(ids), Demande.statut == StatutDemande.EN_ATTENTE)) or 0
        lignes.append([
            departement.nom, str(len(ids)), f"{absents / total * 100:.1f} %",
            f"{sum(retards) / len(retards):.0f} min" if retards else "—",
            str(en_attente), f"{heures:,.0f} h".replace(",", " "),
        ])
        total_effectif += len(ids)
        total_heures += heures

    en_attente = db.scalar(select(func.count(Demande.id)).where(Demande.statut == StatutDemande.EN_ATTENTE)) or 0
    contenu = fiche_cle_valeur([
        ("Effectif actif", f"{total_effectif} collaborateur(s)"),
        ("Heures travaillées", f"{total_heures:,.0f} h depuis le 1er janvier".replace(",", " ")),
        ("Demandes à traiter", f"{en_attente} en attente de décision"),
    ], "Chiffres clés") + tableau_donnees(
        ["Département", "Effectif", "Absentéisme", "Retard moyen", "En attente", "Heures"],
        lignes,
        largeurs=[LARGEUR_UTILE * r for r in (0.34, 0.11, 0.14, 0.14, 0.12, 0.15)],
        titre_section="Détail par département",
    ) + paragraphe(
        "Les taux sont calculés sur les jours pointés depuis le 1er janvier de l'exercice en cours. "
        "L'absentéisme inclut les absences et les congés."
    )
    entete = EnteteDocument("Synthèse RH consolidée", sous_titre=f"Exercice {aujourdhui.year} — situation au {aujourdhui:%d/%m/%Y}",
                            reference=f"SYN-{aujourdhui:%Y%m%d}", edite_par=_nom(utilisateur))
    tampon = generer_pdf(entete, contenu, signataire="Directeur des Ressources Humaines")
    return _reponse(tampon, "application/pdf", f"RH-synthese-{aujourdhui:%Y%m%d}.pdf")
