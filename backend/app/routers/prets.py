"""Avances sur salaire et prêts sociaux : demande du collaborateur,
décision de la RH, échéancier de retenues transmis à l'export paie.

Données confidentielles : seuls l'intéressé et le personnel RH y accèdent
(ni le supérieur hiérarchique, ni la Direction générale)."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import admin_requis, administrateur_requis, utilisateur_courant
from app.models import ROLES_RH, EcheancePret, Employe, JournalAudit, Pret
from app.services import parametres
from app.services.demandes import administrateurs_rh
from app.services.notifications import notifier

router = APIRouter(prefix="/api/prets", tags=["Avances et prêts"])

# Valeurs par défaut, à ajuster par l'administrateur RH (Paramètres des prêts).
TYPES_DEFAUT = {
    "avance": {"libelle": "Avance sur salaire", "plafond": 1000.0, "mensualites_max": 3, "taux": 0.0, "actif": True},
    "pret_social": {"libelle": "Prêt social", "plafond": 5000.0, "mensualites_max": 24, "taux": 0.0, "actif": True},
}
STATUTS = {"demande": "En attente de décision", "accorde": "Accordé — en remboursement", "refuse": "Refusé",
           "solde": "Remboursé", "annule": "Annulé"}


def types_prets(db: Session) -> dict:
    enregistres = parametres.lire(db, "types_prets", {}) or {}
    return {code: {**defaut, **enregistres.get(code, {})} for code, defaut in TYPES_DEFAUT.items()}


def mois_suivant(jour: date, n: int = 1) -> date:
    total = jour.year * 12 + jour.month - 1 + n
    return date(total // 12, total % 12 + 1, 1)


def echeancier(montant: float, n: int, taux_annuel: float, premier_mois: date) -> list[dict]:
    """Mensualités constantes ; au taux nul, remboursement du seul capital.
    Montants au millime ; la dernière échéance absorbe les arrondis."""
    r = taux_annuel / 100 / 12
    mensualite = round(montant / n, 3) if r == 0 else round(montant * r / (1 - (1 + r) ** -n), 3)
    reste, lignes = montant, []
    for i in range(1, n + 1):
        interets = round(reste * r, 3)
        capital = round(mensualite - interets, 3) if i < n else round(reste, 3)
        reste = round(reste - capital, 3)
        lignes.append({"numero": i, "mois": mois_suivant(premier_mois, i - 1), "capital": capital, "interets": interets,
                       "montant": round(capital + interets, 3)})
    return lignes


def _json(p: Pret, types: dict) -> dict:
    aujourd_hui = date.today().replace(day=1)
    prevues = [e for e in p.echeances if e.statut == "prevue"]
    reste = round(sum(e.montant for e in prevues if e.mois >= aujourd_hui), 3)
    statut = "solde" if p.statut == "accorde" and prevues and reste == 0 else p.statut
    return {
        "id": p.id, "type": p.type_pret, "libelle": types.get(p.type_pret, {}).get("libelle", p.type_pret),
        "employe": {"matricule": p.employe.matricule, "nom": p.employe.nom, "prenom": p.employe.prenom},
        "montant": p.montant, "nb_mensualites": p.nb_mensualites, "taux_annuel": p.taux_annuel, "motif": p.motif,
        "statut": statut, "statut_libelle": STATUTS.get(statut, statut), "demande_le": p.demande_le,
        "decide_le": p.decide_le, "decide_par": f"{p.decide_par.prenom} {p.decide_par.nom}" if p.decide_par else None,
        "commentaire_rh": p.commentaire_rh, "premiere_echeance": p.premiere_echeance,
        "mensualite": prevues[0].montant if prevues else None,
        "rembourse": round(sum(e.montant for e in prevues if e.mois < aujourd_hui), 3),
        "reste_du": reste,
        "echeances": [{"numero": e.numero, "mois": e.mois, "capital": e.capital, "interets": e.interets, "montant": e.montant,
                       "statut": e.statut, "passee": e.mois < aujourd_hui} for e in p.echeances],
    }


def _charger(db: Session, pret_id: int, utilisateur: Employe) -> Pret:
    p = db.get(Pret, pret_id)
    if not p:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if p.employe_id != utilisateur.id and utilisateur.role not in ROLES_RH:
        raise HTTPException(status_code=403, detail="Données confidentielles : réservées à l'intéressé et à la RH.")
    return p


# ------------------------------------------------------------------ Paramètres
@router.get("/types", summary="Types de prêts, plafonds et durées")
def lister_types(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return types_prets(db)


class TypePayload(BaseModel):
    plafond: float = Field(gt=0)
    mensualites_max: int = Field(ge=1, le=120)
    taux: float = Field(ge=0, le=30)
    actif: bool = True


@router.put("/types", summary="Plafonds, durées et taux (administrateur RH)")
def modifier_types(payload: dict[str, TypePayload], db: Session = Depends(get_db),
                   utilisateur: Employe = Depends(administrateur_requis)):
    inconnus = set(payload) - set(TYPES_DEFAUT)
    if inconnus:
        raise HTTPException(status_code=422, detail=f"Type inconnu : {', '.join(inconnus)}")
    parametres.ecrire(db, "types_prets", {k: v.model_dump() for k, v in payload.items()})
    db.add(JournalAudit(acteur_id=utilisateur.id, action="parametres_prets", cible="types_prets"))
    db.commit()
    return types_prets(db)


# ------------------------------------------------------------------ Collaborateur
class DemandePayload(BaseModel):
    type_pret: str
    montant: float = Field(gt=0)
    nb_mensualites: int = Field(ge=1, le=120)
    motif: str | None = Field(default=None, max_length=1000)


@router.get("/simulation", summary="Mensualité et échéancier prévisionnels")
def simuler(type_pret: str, montant: float, nb_mensualites: int, db: Session = Depends(get_db),
            utilisateur: Employe = Depends(utilisateur_courant)):
    t = types_prets(db).get(type_pret)
    if not t:
        raise HTTPException(status_code=422, detail="Type de prêt inconnu")
    lignes = echeancier(montant, max(1, nb_mensualites), t["taux"], mois_suivant(date.today()))
    return {"mensualite": lignes[0]["montant"], "total": round(sum(l["montant"] for l in lignes), 3),
            "interets": round(sum(l["interets"] for l in lignes), 3), "taux": t["taux"], "echeances": lignes}


@router.post("", status_code=201, summary="Demander une avance ou un prêt social")
def demander(payload: DemandePayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    types = types_prets(db)
    t = types.get(payload.type_pret)
    if not t or not t["actif"]:
        raise HTTPException(status_code=422, detail="Ce type de prêt n'est pas proposé.")
    if payload.montant > t["plafond"]:
        raise HTTPException(status_code=422, detail=f"{t['libelle']} : plafond de {t['plafond']:,.0f} DT.".replace(",", " "))
    if payload.nb_mensualites > t["mensualites_max"]:
        raise HTTPException(status_code=422, detail=f"{t['libelle']} : {t['mensualites_max']} mensualités au plus.")
    en_cours = db.scalars(select(Pret).where(Pret.employe_id == utilisateur.id, Pret.type_pret == payload.type_pret,
                                             Pret.statut.in_(["demande", "accorde"]))).all()
    aujourd_hui = date.today().replace(day=1)
    if any(p.statut == "demande" or any(e.statut == "prevue" and e.mois >= aujourd_hui for e in p.echeances) for p in en_cours):
        raise HTTPException(status_code=409, detail=f"Vous avez déjà un(e) {t['libelle'].lower()} en cours.")
    p = Pret(employe_id=utilisateur.id, type_pret=payload.type_pret, montant=round(payload.montant, 3),
             nb_mensualites=payload.nb_mensualites, taux_annuel=t["taux"], motif=(payload.motif or "").strip() or None)
    db.add(p)
    db.flush()
    for rh in administrateurs_rh(db, sauf=utilisateur.id):
        notifier(db, rh.id, f"Demande : {t['libelle'].lower()}",
                 f"{utilisateur.prenom} {utilisateur.nom} demande {p.montant:,.3f} DT sur {p.nb_mensualites} mois.".replace(",", " "),
                 "validation", "/prets")
    db.commit()
    db.refresh(p)
    return _json(p, types)


@router.get("/mes", summary="Mes avances et prêts")
def mes_prets(db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    types = types_prets(db)
    return [_json(p, types) for p in db.scalars(select(Pret).where(Pret.employe_id == utilisateur.id)
                                                .order_by(Pret.demande_le.desc()))]


@router.post("/{pret_id}/annuler", summary="Annuler sa demande avant décision")
def annuler(pret_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    p = _charger(db, pret_id, utilisateur)
    if p.employe_id != utilisateur.id or p.statut != "demande":
        raise HTTPException(status_code=409, detail="Seule une demande en attente peut être annulée par son auteur.")
    p.statut = "annule"
    db.commit()
    return _json(p, types_prets(db))


# ------------------------------------------------------------------ RH
@router.get("", summary="Toutes les demandes et prêts (RH)")
def lister(statut: str | None = None, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    types = types_prets(db)
    requete = select(Pret).order_by(Pret.demande_le.desc())
    if statut:
        requete = requete.where(Pret.statut == statut)
    return [_json(p, types) for p in db.scalars(requete.limit(500))]


@router.get("/{pret_id}", summary="Détail et échéancier")
def detail(pret_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(utilisateur_courant)):
    return _json(_charger(db, pret_id, utilisateur), types_prets(db))


class DecisionPayload(BaseModel):
    accorde: bool
    montant: float | None = Field(default=None, gt=0)
    nb_mensualites: int | None = Field(default=None, ge=1, le=120)
    premiere_echeance: date | None = None
    commentaire: str | None = Field(default=None, max_length=1000)


@router.post("/{pret_id}/decision", summary="Accorder ou refuser (RH)")
def decider(pret_id: int, payload: DecisionPayload, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = _charger(db, pret_id, utilisateur)
    if p.statut != "demande":
        raise HTTPException(status_code=409, detail="Cette demande a déjà été traitée.")
    if p.employe_id == utilisateur.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas décider de votre propre demande.")
    types = types_prets(db)
    t = types[p.type_pret]
    p.decide_le, p.decide_par_id = datetime.utcnow(), utilisateur.id
    p.commentaire_rh = (payload.commentaire or "").strip() or None
    if not payload.accorde:
        if not p.commentaire_rh:
            raise HTTPException(status_code=422, detail="Indiquez le motif du refus.")
        p.statut = "refuse"
        notifier(db, p.employe_id, f"{t['libelle']} refusé(e)", f"Motif : {p.commentaire_rh}", "alerte", "/prets")
    else:
        # La RH peut ajuster le montant ou la durée (sans dépasser les plafonds).
        p.montant = round(payload.montant or p.montant, 3)
        p.nb_mensualites = payload.nb_mensualites or p.nb_mensualites
        if p.montant > t["plafond"] or p.nb_mensualites > t["mensualites_max"]:
            raise HTTPException(status_code=422, detail="Montant ou durée au-delà des plafonds du type de prêt.")
        p.premiere_echeance = (payload.premiere_echeance or mois_suivant(date.today())).replace(day=1)
        p.statut = "accorde"
        for l in echeancier(p.montant, p.nb_mensualites, p.taux_annuel, p.premiere_echeance):
            p.echeances.append(EcheancePret(**l))
        mensualite = p.echeances[0].montant
        notifier(db, p.employe_id, f"{t['libelle']} accordé(e)",
                 f"{p.montant:,.3f} DT, {p.nb_mensualites} retenue(s) de {mensualite:,.3f} DT à partir de "
                 f"{p.premiere_echeance:%m/%Y}.".replace(",", " "), "succes", "/prets")
    db.add(JournalAudit(acteur_id=utilisateur.id, action=f"pret_{p.statut}", cible=p.employe.matricule,
                        detail=f"{t['libelle']} {p.montant:.3f} DT / {p.nb_mensualites} mois"))
    db.commit()
    db.refresh(p)
    return _json(p, types)


@router.post("/{pret_id}/reporter/{numero}", summary="Reporter une échéance en fin d'échéancier (RH)")
def reporter(pret_id: int, numero: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = _charger(db, pret_id, utilisateur)
    e = next((x for x in p.echeances if x.numero == numero and x.statut == "prevue"), None)
    if p.statut != "accorde" or e is None or e.mois < date.today().replace(day=1):
        raise HTTPException(status_code=409, detail="Seule une échéance à venir d'un prêt en cours peut être reportée.")
    e.statut = "reportee"
    dernier = max(x.mois for x in p.echeances if x.statut == "prevue")
    p.echeances.append(EcheancePret(numero=max(x.numero for x in p.echeances) + 1, mois=mois_suivant(dernier),
                                    capital=e.capital, interets=e.interets, montant=e.montant))
    db.add(JournalAudit(acteur_id=utilisateur.id, action="pret_echeance_reportee", cible=p.employe.matricule,
                        detail=f"Échéance {numero} ({e.mois:%m/%Y})"))
    notifier(db, p.employe_id, "Échéance reportée", f"La retenue de {e.mois:%m/%Y} est reportée en fin d'échéancier.",
             "info", "/prets")
    db.commit()
    return _json(p, types_prets(db))


@router.post("/{pret_id}/solder", summary="Remboursement anticipé : solder le prêt (RH)")
def solder(pret_id: int, db: Session = Depends(get_db), utilisateur: Employe = Depends(admin_requis)):
    p = _charger(db, pret_id, utilisateur)
    if p.statut != "accorde":
        raise HTTPException(status_code=409, detail="Seul un prêt en cours peut être soldé.")
    aujourd_hui = date.today().replace(day=1)
    for e in p.echeances:
        if e.statut == "prevue" and e.mois >= aujourd_hui:
            e.statut = "annulee"
    p.statut = "solde"
    db.add(JournalAudit(acteur_id=utilisateur.id, action="pret_solde", cible=p.employe.matricule))
    notifier(db, p.employe_id, "Prêt soldé", "Les retenues à venir sont annulées.", "succes", "/prets")
    db.commit()
    return _json(p, types_prets(db))


def retenues_du_mois(db: Session, employe_id: int, mois: date) -> float:
    """Total des retenues prévues ce mois-ci (export paie)."""
    lignes = db.scalars(select(EcheancePret).join(Pret).where(
        Pret.employe_id == employe_id, Pret.statut.in_(["accorde", "solde"]),
        EcheancePret.mois == mois.replace(day=1), EcheancePret.statut == "prevue"))
    return round(sum(e.montant for e in lignes), 3)
