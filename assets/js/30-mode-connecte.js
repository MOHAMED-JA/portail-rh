/* ==========================================================================
   30. MODE CONNECTÉ
   L'application interroge l'API FastAPI lorsqu'elle est joignable, et retombe
   d'elle-même sur le jeu de démonstration sinon. Les vues ne changent pas :
   les réponses de l'API sont converties vers les mêmes structures que les
   données de démonstration.
   ========================================================================== */
const API = {
  base: null,
  token: null,

  async detecter() {
    const candidats = [
      location.origin.startsWith("http") ? location.origin : null,
      "http://127.0.0.1:8000",
      "http://localhost:8000",
    ].filter(Boolean);
    for (const base of candidats) {
      try {
        // 1,5 s ne suffisait plus : sur un poste chargé, le portail concluait
        // « pas de serveur » et affichait les données fictives de démonstration.
        const reponse = await fetch(`${base}/api/sante`, { signal: AbortSignal.timeout(6000) });
        if (reponse.ok) { API.base = base; return true; }
      } catch { /* serveur absent ou injoignable */ }
    }
    return false;
  },

  /* Revérification rapide de l'adresse déjà connue, sans reparcourir les
     trois candidats du démarrage. */
  async joignable() {
    if (!API.base) return false;
    try {
      const reponse = await fetch(`${API.base}/api/sante`, { signal: AbortSignal.timeout(4000) });
      return reponse.ok;
    } catch { return false; }
  },

  async appel(chemin, { methode = "GET", corps } = {}) {
    const options = { method: methode, headers: {} };
    if (API.token) options.headers.Authorization = `Bearer ${API.token}`;
    if (corps !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(corps);
    }
    let reponse;
    try {
      reponse = await fetch(API.base + chemin, options);
    } catch {
      // fetch ne lève qu'en cas de serveur injoignable (« Failed to fetch »).
      const souci = new Error("Le serveur ne répond pas. Relancez DEMARRER.bat.");
      souci.reseau = true;
      throw souci;
    }
    if (reponse.status === 204) return null;
    const donnees = await reponse.json().catch(() => null);
    if (!reponse.ok) {
      const detail = donnees && donnees.detail;
      throw new Error(typeof detail === "string" ? detail : `Erreur ${reponse.status}`);
    }
    return donnees;
  },
};

const connecte = () => etat.mode === "connecte" && !!API.token;
const ROLES_API = { employe: "employe", validateur: "validateur", gestionnaire_rh: "admin", admin_rh: "admin" };
/* Gestionnaire RH : mêmes écrans RH que l'administrateur (rôle local « admin »),
   sans la configuration (paramètres, sécurité, rôles RH, audit, sauvegardes). */
function estGestionnaire() { const u = etat.utilisateur; return !!u && u.roleApi === "gestionnaire_rh"; }
const roleFormulaire = (e) => (e && e.roleApi === "gestionnaire_rh" ? "gestionnaire" : (e ? e.role : "employe"));
const optionsRoles = () => estGestionnaire()
  ? [["employe", "Utilisateur"], ["validateur", "Supérieur hiérarchique"]]
  : [["employe", "Utilisateur"], ["validateur", "Supérieur hiérarchique"], ["gestionnaire", "Gestionnaire RH"], ["admin", "Administrateur RH"]];
/* Ligne hiérarchique Veltaris, du plus bas au plus haut (services/hierarchie.py). */
const NIVEAUX_HIERARCHIQUES = [["collaborateur", "Collaborateur"], ["middle_manager", "Middle Manager"], ["manager", "Manager"],
  ["top_manager", "Top Manager"], ["directeur_pole", "Directeur Pôle"], ["dga", "Directeur Général Adjoint"], ["dg", "Directeur Général"]];
const GRADES_BH = ["Chef section", "Sous chef service", "Chef service adjoint", "Chef service", "Chef service principal",
  "Chef division", "Sous directeur", "Directeur adjoint", "Directeur", "Directeur central"];
const ROLES_LOCAUX = { employe: "employe", validateur: "validateur", gestionnaire: "gestionnaire_rh", admin: "admin_rh" };

/* ------------------------------------------------- Conversions API → local */
function versDemandeLocale(d) {
  return {
    id: d.id,
    ref: d.reference,
    type: d.type_demande,
    sousType: d.sous_type,
    matricule: d.employe.matricule,
    debut: d.date_debut,
    fin: d.date_fin,
    heureDebut: d.heure_debut ? d.heure_debut.slice(0, 5) : null,
    heureFin: d.heure_fin ? d.heure_fin.slice(0, 5) : null,
    demi: d.demi_journee,
    jours: d.nombre_jours,
    commentaire: d.commentaire,
    justificatif: d.piece_jointe,
    statut: d.statut,
    validateur: d.validateur ? d.validateur.matricule : null,
    dateValidation: d.date_validation ? new Date(d.date_validation) : null,
    motifRefus: d.motif_refus,
    cree: new Date(d.cree_le),
    historique: (d.historique || []).map((h) => ({
      statut: h.statut,
      acteur: h.acteur ? h.acteur.matricule : null,
      commentaire: h.commentaire,
      date: new Date(h.horodatage),
    })),
  };
}

function versPointageLocal(p) {
  const heure = (v) => (v ? v.slice(0, 5) : null);
  return {
    matricule: p.employe.matricule,
    date: p.date_jour,
    code: p.code_presence,
    e1: heure(p.entree1), s1: heure(p.sortie1), e2: heure(p.entree2), s2: heure(p.sortie2),
    heures: p.heures_travaillees,
    prevues: p.heures_prevues,
    retard: p.retard_minutes,
  };
}

function versAnomalieLocale(a) {
  return {
    id: a.id,
    matricule: a.employe.matricule,
    date: a.date_jour,
    type: a.type_anomalie,
    detail: a.detail,
    statut: a.statut,
    justification: a.justification,
  };
}

function versNotificationLocale(n, matricule) {
  return {
    id: n.id, matricule, titre: n.titre, message: n.message,
    type: n.type_notif, lien: n.lien, lu: n.lu, date: new Date(n.horodatage),
  };
}

/* ------------------------------------------------------- Chargement complet */
async function chargerDonneesApi() {
  const [profil, departements, annuaire, notifications, tableau] = await Promise.all([
    API.appel("/api/auth/moi"),
    API.appel("/api/administration/departements"),
    API.appel("/api/administration/annuaire"),
    API.appel("/api/notifications?limite=60"),
    API.appel("/api/tableau-bord"),
  ]);

  DEPARTEMENTS.length = 0;
  departements.forEach((d) => DEPARTEMENTS.push({ id: d.id, code: d.code, nom: d.nom, couleur: d.couleur }));

  EMPLOYES.length = 0;
  Object.keys(parMatricule).forEach((cle) => delete parMatricule[cle]);
  annuaire.forEach((e) => {
    const local = {
      id: e.id, matricule: e.matricule, prenom: e.prenom, nom: e.nom, poste: e.poste,
      dept: e.departement, role: ROLES_API[e.role] || "employe", validateur: e.validateur,
      entree: e.date_entree, email: e.email, telephone: e.telephone, statut: "actif", niveau: e.niveau || "collaborateur", roleApi: e.role,
    };
    EMPLOYES.push(local);
    parMatricule[local.matricule] = local;
  });
  etat.utilisateur = parMatricule[profil.matricule];

  // Soldes : une seule requête pour les profils qui y ont droit, sinon le sien.
  Object.keys(SOLDES).forEach((cle) => delete SOLDES[cle]);
  if (etat.utilisateur.role !== "employe") {
    try {
      const tous = await API.appel("/api/administration/soldes");
      Object.entries(tous).forEach(([matricule, s]) => {
        SOLDES[matricule] = { annee: s.annee, acquis: s.jours_acquis, report: s.report_anterieur, pris: s.jours_pris };
      });
    } catch { /* droits insuffisants : on se contente du solde personnel */ }
  }
  if (tableau.solde) {
    const s = tableau.solde;
    SOLDES[profil.matricule] = { annee: s.annee, acquis: s.jours_acquis, report: s.report_anterieur, pris: s.jours_pris };
  }
  EMPLOYES.forEach((e) => {
    if (!SOLDES[e.matricule]) SOLDES[e.matricule] = { annee: ANNEE, acquis: 0, report: 0, pris: 0 };
  });
  // Les entretiens de démonstration sont facultatifs : une connexion à la base
  // ne doit jamais échouer si le navigateur possède un cache partiel de ces
  // données locales. Les fiches réelles sont chargées par leur module dédié.
  if (typeof ENTRETIENS !== "undefined" && typeof OBJECTIFS_MODELES !== "undefined") {
    EMPLOYES.forEach((e) => {
      if (!ENTRETIENS.some((x) => x.matricule === e.matricule)) {
        ENTRETIENS.push({
          matricule: e.matricule, campagne: `Entretien annuel ${ANNEE}`, statut: "a_planifier",
          date: iso(AUJOURDHUI), evaluateur: e.validateur,
          objectifs: OBJECTIFS_MODELES.slice(0, 3).map(([titre, description]) => ({ titre, description, avancement: 0, poids: 30 })),
          souhaits: "", commentaireManager: null,
        });
      }
    });
  }

  NOTIFICATIONS.length = 0;
  notifications.forEach((n) => NOTIFICATIONS.push(versNotificationLocale(n, profil.matricule)));

  await Promise.all([rafraichirDemandes(), rafraichirPresences(), rafraichirPlannings()]);
}

async function rafraichirDemandes() {
  const miennes = await API.appel("/api/demandes?limite=300");
  let equipe = [];
  if (etat.utilisateur.role !== "employe") {
    try { equipe = await API.appel("/api/demandes/equipe"); } catch { /* périmètre restreint */ }
  }
  DEMANDES.length = 0;
  const vues = new Set();
  [...miennes, ...equipe].forEach((d) => {
    if (vues.has(d.reference)) return;
    vues.add(d.reference);
    DEMANDES.push(versDemandeLocale(d));
  });
  DEMANDES.sort((a, b) => b.cree - a.cree);
}

async function rafraichirPresences() {
  const [pointages, ouvertes, justifiees] = await Promise.all([
    API.appel(`/api/presences/pointages?debut=${ANNEE}-01-01&fin=${iso(AUJOURDHUI)}`),
    API.appel("/api/presences/anomalies?statut=ouverte"),
    API.appel("/api/presences/anomalies?statut=justifiee"),
  ]);
  POINTAGES.length = 0;
  pointages.forEach((p) => POINTAGES.push(versPointageLocal(p)));
  ANOMALIES.length = 0;
  [...ouvertes, ...justifiees].forEach((a) => ANOMALIES.push(versAnomalieLocale(a)));
}

async function rafraichirPlannings(semaines) {
  const cibles = semaines || [-1, 0, 1].map((d) => semaineIso(ajouterJours(lundiDe(AUJOURDHUI), d * 7)));
  for (const semaine of cibles) {
    // L'interface note les semaines « 2026-S38 », l'API « 2026-W38 » (ISO).
    const donnees = await API.appel(`/api/plannings/semaine?semaine=${semaine.replace("-S", "-W")}`);
    const parId = Object.fromEntries(donnees.employes.map((e) => [e.id, e.matricule]));
    // On remplace uniquement la semaine rechargée.
    for (let i = PLANNINGS.length - 1; i >= 0; i--) if (PLANNINGS[i].semaine === semaine) PLANNINGS.splice(i, 1);
    donnees.creneaux.forEach((c) => {
      const matricule = parId[c.employe_id];
      if (!matricule) return;
      PLANNINGS.push({
        id: c.id, matricule, date: c.date, semaine,
        poste: c.poste, debut: c.heure_debut, fin: c.heure_fin, note: c.note,
      });
    });
  }
}

/* ------------------------------------------------------------- Connexion */
async function connecter(matricule, motDePasse) {
  if (!connecteDisponible()) return connecterDemo(matricule, motDePasse);

  const erreur = $("#erreur-connexion");
  const bouton = $("#form-connexion button[type=submit]");
  if (bouton) { bouton.disabled = true; bouton.textContent = "Connexion…"; }

  try {
    let session = await API.appel("/api/auth/login", {
      methode: "POST",
      corps: { matricule: matricule.trim().toUpperCase(), mot_de_passe: motDePasse },
    });
    // Double authentification : le code du téléphone est demandé (module 49).
    if (session.etape === "code_2fa") session = await demanderCodeDoubleAuth(session.jeton_etape);
    API.token = session.access_token;
    await chargerDonneesApi();
    etat.route = "/tableau-bord";
    etat.vuesVisitees.clear();
    rendre();
    toast(`Bienvenue ${etat.utilisateur.prenom}`, "Données chargées depuis la base Veltaris.", "succes");
  } catch (souci) {
    if (bouton) { bouton.disabled = false; bouton.innerHTML = `Se connecter ${ico("fleche")}`; }
    if (souci.reseau && !(await API.joignable())) {
      basculerEnDemonstration();
      toast("Serveur arrêté", "Connexion en mode démonstration. Relancez DEMARRER.bat pour retrouver la base.", "alerte");
      return connecterDemo(matricule, motDePasse);
    }
    if (erreur) { erreur.textContent = souci.message; erreur.hidden = false; }
    toast("Connexion refusée", souci.message, "danger");
  }
}

function basculerEnDemonstration() {
  etat.mode = "demo";
  API.token = null;
  ["#bandeau-mode", "#puce-mode"].forEach((sel) => { const el = $(sel); if (el) el.remove(); });
  injecterBandeauMode();
}
const connecteDisponible = () => etat.mode === "connecte";

/* --------------------------------------------------- Écritures : demandes */
async function soumettreDemandeApi(type, f) {
  const corps = { sous_type: f.sousType, commentaire: f.commentaire || null };
  let chemin;
  if (type === "conge") {
    chemin = "/api/demandes/conge";
    Object.assign(corps, { date_debut: iso(f.debut), date_fin: iso(f.fin), demi_journee: f.demi || null, piece_jointe: f.pieceJointe || null });
  } else if (type === "autorisation") {
    chemin = "/api/demandes/autorisation";
    Object.assign(corps, { date_debut: iso(f.debut), heure_debut: `${f.heureDebut}:00`, heure_fin: `${f.heureFin}:00` });
  } else {
    chemin = "/api/demandes/mission";
    Object.assign(corps, { date_debut: iso(f.debut), date_fin: iso(f.fin) });
  }

  const creee = await API.appel(chemin, { methode: "POST", corps });
  await Promise.all([rafraichirDemandes(), rafraichirSolde()]);
  etat.filtres.demandes = { type: "", statut: "", recherche: "" };
  etat.demandeMiseEnAvant = creee.reference;
  fermerCouche();
  toast("Demande enregistrée en base",
    creee.solde_insuffisant
      ? `${creee.reference} · solde insuffisant : transmise directement à la direction RH pour validation.`
      : `${creee.reference} · transmise à ${creee.validateur ? creee.validateur.prenom + " " + creee.validateur.nom : "la direction RH"}.`, "succes");
  naviguer("/mes-demandes");
  rendre(false);
}

async function rafraichirSolde() {
  try {
    const tableau = await API.appel("/api/tableau-bord");
    if (tableau.solde) {
      const s = tableau.solde;
      SOLDES[etat.utilisateur.matricule] = { annee: s.annee, acquis: s.jours_acquis, report: s.report_anterieur, pris: s.jours_pris };
    }
    if (etat.utilisateur.role !== "employe") {
      const tous = await API.appel("/api/administration/soldes");
      Object.entries(tous).forEach(([matricule, s]) => {
        SOLDES[matricule] = { annee: s.annee, acquis: s.jours_acquis, report: s.report_anterieur, pris: s.jours_pris };
      });
    }
  } catch { /* solde inchangé en cas d'échec */ }
}

const soumettreDemandeLocale = soumettreDemande;
soumettreDemande = function (type) {
  if (!connecte()) return soumettreDemandeLocale(type);
  const f = lireFormulaire(type);
  soumettreDemandeApi(type, f).catch((souci) => toast("Dépôt refusé", souci.message, "danger"));
};

const appliquerDecisionLocale = appliquerDecision;
appliquerDecision = function (d, approuve, motif) {
  if (!connecte()) return appliquerDecisionLocale(d, approuve, motif);
  const chemin = `/api/demandes/${d.id}/${approuve ? "approuver" : "rejeter"}`;
  API.appel(chemin, { methode: "POST", corps: { commentaire: motif || null } })
    .then(async () => {
      await Promise.all([rafraichirDemandes(), rafraichirSolde()]);
      toast(approuve ? "Demande approuvée" : "Demande rejetée",
        `${d.ref} · décision enregistrée en base, ${nomComplet(parMatricule[d.matricule])} notifié.`,
        approuve ? "succes" : "info");
      rendre(false);
    })
    .catch((souci) => toast("Décision refusée", souci.message, "danger"));
};

const annulerMaDemandeLocale = annulerMaDemande;
annulerMaDemande = function (d) {
  if (!connecte()) return annulerMaDemandeLocale(d);
  API.appel(`/api/demandes/${d.id}/annuler`, { methode: "POST" })
    .then(async () => {
      await Promise.all([rafraichirDemandes(), rafraichirSolde()]);
      fermerCouche();
      toast("Demande annulée", `${d.ref} a été retirée du circuit de validation.`, "info");
      rendre(false);
    })
    .catch((souci) => toast("Annulation refusée", souci.message, "danger"));
};

/* ------------------------------------------- Écritures : employés, soldes */
function enregistrerEmployeConnecte(existant, donnees, soldeInitial) {
  const departement = DEPARTEMENTS.find((d) => d.code === donnees.dept);
  const validateur = donnees.validateur ? parMatricule[donnees.validateur] : null;
  const corps = {
    nom: donnees.nom, prenom: donnees.prenom, email: donnees.email,
    poste: donnees.poste, departement_id: departement ? departement.id : null,
    validateur_id: validateur ? validateur.id : null,
    role: ROLES_LOCAUX[donnees.role] || "employe",
    niveau: donnees.niveau || "collaborateur",
  };
  const reinitialisation = existant && $("#e-mdp-reset") ? $("#e-mdp-reset").value.trim() : "";
  if (reinitialisation) corps.mot_de_passe = reinitialisation;

  const promesse = existant
    ? API.appel(`/api/administration/employes/${existant.id}`, { methode: "PUT", corps })
    : API.appel("/api/administration/employes", {
        methode: "POST",
        corps: {
          ...corps, matricule: donnees.matricule, date_entree: donnees.entree || null,
          statut: "actif", mot_de_passe: ($("#e-motdepasse") && $("#e-motdepasse").value.trim()) || "demo2026",
          jours_acquis: soldeInitial === null || Number.isNaN(soldeInitial) ? 21 : soldeInitial,
        },
      });

  promesse
    .then(async () => {
      await chargerDonneesApi();
      fermerCouche();
      toast(existant ? "Collaborateur mis à jour" : "Collaborateur créé en base",
        existant
          ? `${donnees.prenom} ${donnees.nom} — modifications enregistrées.`
          : `${donnees.prenom} ${donnees.nom} peut se connecter avec le matricule ${donnees.matricule}.`,
        "succes");
      rendre(false);
    })
    .catch((souci) => toast("Enregistrement refusé", souci.message, "danger"));
}

function enregistrerSoldeConnecte(matricule, acquis, report, pris) {
  const employe = parMatricule[matricule];
  API.appel(`/api/administration/employes/${employe.id}/soldes`, {
    methode: "PUT",
    corps: { annee: ANNEE, jours_acquis: acquis, report_anterieur: report, jours_pris: pris },
  })
    .then(async () => {
      await rafraichirSolde();
      fermerCouche();
      toast("Solde mis à jour en base", `${nomComplet(employe)} · ${fmtNombre(soldeDe(matricule).restant)} jour(s) restants.`, "succes");
      rendre(false);
    })
    .catch((souci) => toast("Mise à jour refusée", souci.message, "danger"));
}

/* ------------------------------------------- Écritures : présences, plannings */
const badgerLocal = badger;
badger = function () {
  if (!connecte()) return badgerLocal();
  API.appel("/api/presences/badger", { methode: "POST" })
    .then(async (pointage) => {
      await rafraichirPresences();
      const dernier = ["sortie du soir", "retour de pause", "sortie du midi", "entrée du matin"]
        .find((_, i) => [pointage.sortie2, pointage.entree2, pointage.sortie1, pointage.entree1][i]);
      toast("Badgeage enregistré en base", `${dernier || "Pointage"} · ${fmtDateLongue(AUJOURDHUI)}.`, "succes");
      rendre(false);
    })
    .catch((souci) => toast("Badgeage refusé", souci.message, "danger"));
};

const ouvrirJustificationLocale = ouvrirJustification;
ouvrirJustification = function (id) {
  ouvrirJustificationLocale(id);
  if (!connecte()) return;
  const bouton = $("#valider-justif");
  const remplacant = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(remplacant, bouton);
  remplacant.addEventListener("click", () => {
    const texte = $("#justif").value.trim();
    if (texte.length < 5) return toast("Explication trop courte", "Décrivez brièvement la situation.", "danger");
    API.appel(`/api/presences/anomalies/${id}/justifier?justification=${encodeURIComponent(texte)}`, { methode: "POST" })
      .then(async () => {
        await rafraichirPresences();
        fermerCouche();
        toast("Anomalie justifiée", "La justification est enregistrée en base.", "succes");
        rendre(false);
      })
      .catch((souci) => toast("Justification refusée", souci.message, "danger"));
  });
};

const enregistrerCreneauLocal = ouvrirEditionCreneau;
ouvrirEditionCreneau = function (id, matricule, date) {
  enregistrerCreneauLocal(id, matricule, date);
  if (!connecte()) return;
  const creneau = id ? PLANNINGS.find((p) => p.id === id || p.id === Number(id)) : null;
  const cible = creneau || { matricule, date };
  const bouton = $("#enregistrer-creneau");
  const remplacant = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(remplacant, bouton);
  remplacant.addEventListener("click", () => {
    const poste = $("#c-poste").value, debut = $("#c-debut").value, fin = $("#c-fin").value;
    if (fin <= debut) return toast("Horaire invalide", "L'heure de fin doit suivre l'heure de début.", "danger");
    const employe = parMatricule[cible.matricule];
    API.appel("/api/plannings/creneau", {
      methode: "PUT",
      corps: { employe_id: employe.id, date_jour: cible.date, poste, heure_debut: `${debut}:00`, heure_fin: `${fin}:00`, note: null },
    })
      .then(async () => {
        await rafraichirPlannings([semaineIso(depuisIso(cible.date))]);
        fermerCouche();
        toast("Planning enregistré en base", `${nomComplet(employe)} · ${POSTES[poste].libelle} le ${fmtDate(cible.date)}.`, "succes");
        rendre(false);
      })
      .catch((souci) => toast("Enregistrement refusé", souci.message, "danger"));
  });
};

/* ------------------------------------------------------ Bandeau de mode */
function injecterBandeauMode() {
  const actions = document.querySelector(".entete-actions");
  if (actions && !document.querySelector("#puce-mode")) {
    const enBase = connecte();
    const puce = document.createElement("span");
    puce.id = "puce-mode";
    puce.className = `badge ${enBase ? "approuvee" : "attente"}`;
    puce.title = enBase
      ? "Les données proviennent de la base Veltaris et y sont enregistrées."
      : "Serveur non détecté : les données sont simulées et remises à zéro au rechargement.";
    puce.innerHTML = `${ico(enBase ? "bouclier" : "alerte")}${enBase ? "Base de données" : "Démonstration"}`;
    actions.insertBefore(puce, actions.firstChild);
  }

  const boite = document.querySelector(".connexion-boite");
  if (boite && !document.querySelector("#bandeau-mode")) {
    const enBase = etat.mode === "connecte";
    const bandeau = document.createElement("div");
    bandeau.id = "bandeau-mode";
    bandeau.style.cssText = `display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:var(--r-m);font-size:12.5px;
      background:var(${enBase ? "--succes-doux" : "--alerte-doux"});color:var(--encre-2);
      border:1px solid color-mix(in srgb,var(${enBase ? "--succes" : "--alerte"}) 28%,transparent)`;
    bandeau.innerHTML = `<span style="color:var(${enBase ? "--succes" : "--alerte"});flex:none">${ico(enBase ? "bouclier" : "alerte")}</span>
      <span>${enBase
        ? "<strong>Connecté à la base Veltaris.</strong> Les comptes, demandes et validations sont enregistrés durablement."
        : "<strong>Mode démonstration.</strong> Le serveur n'est pas démarré : les données sont simulées et repartent à zéro à chaque rechargement."}</span>`;
    boite.insertBefore(bandeau, boite.children[1]);
  }
}

const rendreSansBandeau = rendre;
rendre = function (...args) {
  rendreSansBandeau(...args);
  injecterBandeauMode();
};

/* ------------------------------------------------- Surveillance du serveur
   Toutes les 15 s en mode connecté : si le serveur tombe (fenêtre fermée,
   poste en veille), la puce de l'en-tête passe au rouge au lieu de laisser
   l'utilisateur découvrir le problème à la prochaine action. */
setInterval(async () => {
  if (etat.mode !== "connecte" || !API.base) return;
  const puce = $("#puce-mode");
  let enLigne = false;
  try {
    const reponse = await fetch(`${API.base}/api/sante`, { signal: AbortSignal.timeout(3000) });
    enLigne = reponse.ok;
  } catch { enLigne = false; }
  if (!puce) return;
  if (enLigne && puce.dataset.etat === "arrete") {
    puce.className = "badge approuvee";
    puce.innerHTML = `${ico("bouclier")}Base de données`;
    puce.dataset.etat = "";
    toast("Serveur de nouveau disponible", "Les enregistrements reprennent normalement.", "succes");
  } else if (!enLigne && puce.dataset.etat !== "arrete") {
    puce.className = "badge rejetee";
    puce.innerHTML = `${ico("alerte")}Serveur arrêté`;
    puce.title = "Relancez DEMARRER.bat : rien ne peut être enregistré tant que le serveur est arrêté.";
    puce.dataset.etat = "arrete";
    toast("Serveur arrêté", "Rien ne sera enregistré. Relancez DEMARRER.bat.", "danger");
  }
}, 15000);

/* --------------------------------------------------------------- Démarrage */
(async function demarrerModeConnecte() {
  etat.mode = (await API.detecter()) ? "connecte" : "demo";
  if (!etat.utilisateur) rendre();
  if (etat.mode === "connecte") {
    console.info(`Portail RH — mode connecté sur ${API.base}`);
  } else {
    console.info("Portail RH — mode démonstration (serveur non détecté)");
  }
})();
