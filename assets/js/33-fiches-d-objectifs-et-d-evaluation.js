/* ==========================================================================
   33. FICHES D'OBJECTIFS ET D'ÉVALUATION
   Fiche d'objectifs : rédigée par le collaborateur (objectifs pondérés, total
   100 %), validée ou modifiée par le supérieur hiérarchique, consultée sans
   modification par l'administration RH.
   Fiche d'évaluation : chaque objectif est noté sur 20 par le supérieur ;
   l'administration RH saisit uniquement la note de comportement. Note des
   objectifs = moyenne pondérée ; note finale = 80 % objectifs + 20 %
   comportement, jamais au-delà de 20. Quand le supérieur et la RH ont validé,
   le collaborateur est notifié avec le détail.
   En mode connecté, tout passe par l'API /api/fiches ; en démonstration, le
   même circuit est simulé dans le navigateur.
   ========================================================================== */
const NOTE_MAX = 20;
const PART_FINALE = { objectifs: 80, comportement: 20 };
const STATUTS_OBJECTIFS = {
  brouillon: ["neutre", "Brouillon"], soumise: ["attente", "Soumise au supérieur"],
  a_corriger: ["rejetee", "À corriger"], validee: ["approuvee", "Validée"],
};
const STATUTS_EVALUATION = {
  non_ouverte: ["neutre", "Objectifs non validés"], a_evaluer: ["info", "À évaluer"], en_cours: ["attente", "En cours"],
  attente_rh: ["attente", "En attente de la RH"], attente_superieur: ["attente", "En attente du supérieur"],
  finalisee: ["approuvee", "Validée"],
};
const noteFr = (n) => n == null ? "—" : fmtNombre(Math.round(n * 100) / 100, 2).replace(/,?0+$/, "").replace(/,$/, "");
const arrondi2 = (n) => Math.round(n * 100) / 100;

function noteDesObjectifs(liste) {
  if (!liste.length || liste.some((o) => o.note == null)) return null;
  const poids = liste.reduce((s, o) => s + Number(o.ponderation), 0);
  if (poids <= 0) return null;
  return Math.min(NOTE_MAX, liste.reduce((s, o) => s + o.note * o.ponderation, 0) / poids);
}
function noteFinaleDe(noteObj, noteComp, part = PART_FINALE) {
  if (noteObj == null || noteComp == null) return null;
  return Math.min(NOTE_MAX, (noteObj * part.objectifs + noteComp * part.comportement) / 100);
}

/* ------------------------------------------------ Circuit simulé (démonstration) */
const DEMO_FICHES = {};
let idObjectifDemo = 1;
function ficheDemoBrute(matricule) {
  if (!DEMO_FICHES[matricule]) {
    DEMO_FICHES[matricule] = {
      objectifs: { statut: "brouillon", liste: [], commentaire_superieur: null, soumise_le: null, validee_le: null,
        validee_par: null, modifiee_par_superieur: false },
      evaluation: { appreciation: null, note_comportement: null, commentaire_comportement: null,
        valide_superieur_le: null, superieur: null, valide_rh_le: null, rh: null,
        note_objectifs: null, note_finale: null, finalisee_le: null },
    };
  }
  return DEMO_FICHES[matricule];
}
const miniEmploye = (e) => e ? { matricule: e.matricule, nom: e.nom, prenom: e.prenom, poste: e.poste } : null;

function estSuperieurDe(utilisateur, employe) {
  if (!utilisateur || !employe || utilisateur.matricule === employe.matricule) return false;
  if (employe.validateur && parMatricule[employe.validateur]) return employe.validateur === utilisateur.matricule;
  return utilisateur.role === "admin";
}
function statutEvaluationDemo(f) {
  const o = f.objectifs, ev = f.evaluation;
  if (o.statut !== "validee") return "non_ouverte";
  if (ev.finalisee_le) return "finalisee";
  if (ev.valide_superieur_le && !ev.valide_rh_le) return "attente_rh";
  if (ev.valide_rh_le && !ev.valide_superieur_le) return "attente_superieur";
  if (o.liste.some((x) => x.note != null) || ev.note_comportement != null) return "en_cours";
  return "a_evaluer";
}
function droitsDemo(utilisateur, employe, f) {
  const proprietaire = utilisateur.matricule === employe.matricule;
  const superieur = estSuperieurDe(utilisateur, employe);
  const rh = utilisateur.role === "admin" && !proprietaire;
  const o = f.objectifs, ev = f.evaluation;
  const ouverte = o.statut === "validee";
  const entamee = !!ev.valide_superieur_le || o.liste.some((x) => x.note != null);
  return {
    proprietaire, superieur, rh,
    modifier_objectifs: (proprietaire && ["brouillon", "a_corriger"].includes(o.statut))
      || (superieur && (o.statut === "soumise" || (ouverte && !entamee))),
    soumettre: proprietaire && ["brouillon", "a_corriger"].includes(o.statut),
    valider_objectifs: superieur && o.statut === "soumise",
    renvoyer_objectifs: superieur && o.statut === "soumise",
    noter: superieur && ouverte && !ev.valide_superieur_le,
    approuver_evaluation: superieur && ouverte && !ev.valide_superieur_le,
    noter_comportement: rh && ouverte && !ev.valide_rh_le,
    valider_rh: rh && ouverte && !ev.valide_rh_le,
    voir_notes: !proprietaire || !!ev.finalisee_le,
  };
}
function serialiserDemo(matricule) {
  const employe = parMatricule[matricule];
  const f = ficheDemoBrute(matricule);
  const d = droitsDemo(moi(), employe, f);
  const voir = d.voir_notes;
  const superieur = employe.validateur ? parMatricule[employe.validateur] : null;
  const o = f.objectifs, ev = f.evaluation;
  return {
    annee: ANNEE,
    employe: { ...miniEmploye(employe), departement: employe.dept },
    superieur: miniEmploye(superieur),
    ponderation_finale: { ...PART_FINALE },
    objectifs: {
      statut: o.statut, commentaire_superieur: o.commentaire_superieur, soumise_le: o.soumise_le,
      validee_le: o.validee_le, validee_par: o.validee_par, modifiee_par_superieur: o.modifiee_par_superieur,
      total_ponderation: arrondi2(o.liste.reduce((s, x) => s + Number(x.ponderation), 0)),
      liste: o.liste.map((x) => ({ ...x, note: voir ? x.note : null, commentaire: voir ? x.commentaire : null })),
    },
    evaluation: {
      statut: statutEvaluationDemo(f),
      appreciation: voir ? ev.appreciation : null,
      note_objectifs: voir ? (noteDesObjectifs(o.liste) == null ? null : arrondi2(noteDesObjectifs(o.liste))) : null,
      note_comportement: voir ? ev.note_comportement : null,
      commentaire_comportement: voir ? ev.commentaire_comportement : null,
      valide_superieur_le: ev.valide_superieur_le, superieur: ev.superieur,
      valide_rh_le: ev.valide_rh_le, rh: ev.rh,
      note_finale: voir ? ev.note_finale : null, finalisee_le: ev.finalisee_le,
    },
    droits: d,
  };
}
function notifierDemo(matricule, titre, message, type, lien) {
  NOTIFICATIONS.unshift({ id: idNotif++, matricule, titre, message, type, lien, lu: false, date: new Date() });
}
function erreurFiche(message) { const e = new Error(message); e.metier = true; return e; }
function verifierPonderations(liste) {
  if (!liste.length) throw erreurFiche("Ajoutez au moins un objectif.");
  const total = liste.reduce((s, o) => s + Number(o.ponderation), 0);
  if (Math.abs(total - 100) > 0.01) throw erreurFiche(`La somme des pondérations doit être égale à 100 % (actuellement ${noteFr(total)} %).`);
}
function superieursDe(employe) {
  if (employe.validateur && parMatricule[employe.validateur]) return [parMatricule[employe.validateur]];
  return EMPLOYES.filter((e) => e.role === "admin" && e.matricule !== employe.matricule);
}
function finaliserDemo(matricule) {
  const f = ficheDemoBrute(matricule), ev = f.evaluation, liste = f.objectifs.liste;
  if (!(ev.valide_superieur_le && ev.valide_rh_le) || ev.finalisee_le) return;
  ev.note_objectifs = arrondi2(noteDesObjectifs(liste));
  ev.note_finale = arrondi2(noteFinaleDe(ev.note_objectifs, ev.note_comportement));
  ev.finalisee_le = new Date().toISOString();
  const lignes = liste.map((o) => `${o.titre} (${noteFr(o.ponderation)} %) : ${noteFr(o.note)}/20`).join(" · ");
  notifierDemo(matricule, `Fiche d'évaluation ${ANNEE} validée`,
    `Votre évaluation a été validée par votre supérieur hiérarchique et par la RH. Objectifs : ${noteFr(ev.note_objectifs)}/20 — ${lignes}. `
    + `Comportement : ${noteFr(ev.note_comportement)}/20. Note finale : ${noteFr(ev.note_finale)}/20 `
    + `(${PART_FINALE.objectifs} % objectifs, ${PART_FINALE.comportement} % comportement).`, "succes", "/fiche-evaluation");
}

const FICHES_DEMO = {
  async charger(m) {
    const employe = parMatricule[m], f = ficheDemoBrute(m), u = moi();
    if (u.matricule !== m && u.role !== "admin") {
      if (!estSuperieurDe(u, employe)) throw erreurFiche("Cette fiche n'est pas dans votre périmètre");
      if (f.evaluation.finalisee_le) throw erreurFiche("Fiche validée : son détail n'est consultable que par l'administration RH.");
    }
    return serialiserDemo(m);
  },
  async lister() {
    const u = moi();
    return EMPLOYES.filter((e) => e.matricule !== u.matricule && e.statut !== "sorti"
      && (u.role === "admin" || e.validateur === u.matricule))
      .map((e) => {
        const f = ficheDemoBrute(e.matricule);
        return { employe: { ...miniEmploye(e), departement: e.dept }, superieur_direct: estSuperieurDe(u, e),
          statut_objectifs: f.objectifs.statut, nombre_objectifs: f.objectifs.liste.length,
          statut_evaluation: statutEvaluationDemo(f), note_finale: u.role === "admin" ? f.evaluation.note_finale : null,
          verrouillee: !!f.evaluation.finalisee_le && u.role !== "admin" };
      });
  },
  async enregistrerObjectifs(m, liste) {
    const employe = parMatricule[m], f = ficheDemoBrute(m), d = droitsDemo(moi(), employe, f);
    if (!d.modifier_objectifs) throw erreurFiche(d.rh && !d.superieur
      ? "L'administration RH consulte la fiche d'objectifs sans pouvoir la modifier." : "La fiche d'objectifs n'est pas modifiable à ce stade.");
    const total = liste.reduce((s, o) => s + Number(o.ponderation), 0);
    if (total > 100.01) throw erreurFiche(`La somme des pondérations dépasse 100 % (${noteFr(total)} %).`);
    if (d.superieur) { verifierPonderations(liste); f.objectifs.modifiee_par_superieur = true; }
    f.objectifs.liste = liste.map((o) => ({ id: idObjectifDemo++, titre: o.titre, description: o.description || null,
      indicateur: o.indicateur || null, ponderation: arrondi2(Number(o.ponderation)), note: null, commentaire: null }));
    if (d.superieur && f.objectifs.statut === "validee") {
      notifierDemo(m, "Objectifs modifiés par votre supérieur", `${nomComplet(moi())} a ajusté votre fiche d'objectifs ${ANNEE}.`, "info", "/fiche-objectifs");
    }
    return serialiserDemo(m);
  },
  async soumettre(m) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).soumettre) throw erreurFiche("Seul le collaborateur peut soumettre sa fiche, avant validation.");
    verifierPonderations(f.objectifs.liste);
    f.objectifs.statut = "soumise"; f.objectifs.soumise_le = new Date().toISOString();
    superieursDe(employe).forEach((s) => notifierDemo(s.matricule, "Fiche d'objectifs à valider",
      `${nomComplet(employe)} a soumis sa fiche d'objectifs ${ANNEE} (${f.objectifs.liste.length} objectif(s)).`, "validation", "/fiche-objectifs"));
    return serialiserDemo(m);
  },
  async valider(m, commentaire) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).valider_objectifs) throw erreurFiche("Seul le supérieur hiérarchique valide une fiche soumise.");
    verifierPonderations(f.objectifs.liste);
    Object.assign(f.objectifs, { statut: "validee", validee_le: new Date().toISOString(), validee_par: miniEmploye(moi()),
      commentaire_superieur: commentaire || f.objectifs.commentaire_superieur });
    notifierDemo(m, "Fiche d'objectifs validée", `${nomComplet(moi())} a validé votre fiche d'objectifs ${ANNEE}`
      + `${f.objectifs.modifiee_par_superieur ? " (avec modifications)" : ""}.`, "succes", "/fiche-objectifs");
    return serialiserDemo(m);
  },
  async renvoyer(m, commentaire) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).renvoyer_objectifs) throw erreurFiche("Seul le supérieur hiérarchique peut renvoyer une fiche soumise.");
    if (!commentaire || commentaire.length < 5) throw erreurFiche("Indiquez au collaborateur ce qu'il doit corriger.");
    Object.assign(f.objectifs, { statut: "a_corriger", commentaire_superieur: commentaire });
    notifierDemo(m, "Fiche d'objectifs à corriger", commentaire, "alerte", "/fiche-objectifs");
    return serialiserDemo(m);
  },
  async noter(m, notes, appreciation) {
    const employe = parMatricule[m], f = ficheDemoBrute(m), d = droitsDemo(moi(), employe, f);
    if (!d.noter) throw erreurFiche(d.rh && !d.superieur ? "L'administration RH saisit uniquement la note de comportement."
      : "Seul le supérieur hiérarchique note les objectifs, après leur validation.");
    notes.forEach((n) => {
      const o = f.objectifs.liste.find((x) => x.id === n.objectif_id);
      if (!o) return;
      o.note = n.note == null ? null : arrondi2(Math.min(NOTE_MAX, Math.max(0, n.note)));
      o.commentaire = n.commentaire || null;
    });
    f.evaluation.appreciation = appreciation || null;
    return serialiserDemo(m);
  },
  async approuver(m) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).approuver_evaluation) throw erreurFiche("Seul le supérieur hiérarchique approuve l'évaluation des objectifs.");
    if (f.objectifs.liste.some((o) => o.note == null)) throw erreurFiche("Chaque objectif doit recevoir une note avant approbation.");
    Object.assign(f.evaluation, { valide_superieur_le: new Date().toISOString(), superieur: miniEmploye(moi()),
      note_objectifs: arrondi2(noteDesObjectifs(f.objectifs.liste)) });
    if (!f.evaluation.valide_rh_le) {
      EMPLOYES.filter((e) => e.role === "admin" && e.matricule !== m).forEach((a) => notifierDemo(a.matricule, "Évaluation à compléter",
        `Les objectifs de ${nomComplet(employe)} sont notés : saisissez la note de comportement.`, "validation", "/fiche-evaluation"));
    }
    finaliserDemo(m);
    return serialiserDemo(m);
  },
  async comportement(m, note, commentaire) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).noter_comportement) throw erreurFiche("La note de comportement est saisie par l'administration RH, après validation des objectifs.");
    if (!(note >= 0 && note <= NOTE_MAX)) throw erreurFiche("La note de comportement doit être comprise entre 0 et 20.");
    f.evaluation.note_comportement = arrondi2(note);
    f.evaluation.commentaire_comportement = commentaire || null;
    return serialiserDemo(m);
  },
  async validerRH(m) {
    const employe = parMatricule[m], f = ficheDemoBrute(m);
    if (!droitsDemo(moi(), employe, f).valider_rh) throw erreurFiche("Seule l'administration RH valide cette étape.");
    if (f.evaluation.note_comportement == null) throw erreurFiche("Saisissez la note de comportement avant de valider.");
    Object.assign(f.evaluation, { valide_rh_le: new Date().toISOString(), rh: miniEmploye(moi()) });
    finaliserDemo(m);
    return serialiserDemo(m);
  },
};

/* Jeu de démonstration : des fiches à chaque étape du circuit. */
(function peuplerFichesDemo() {
  const modeles = OBJECTIFS_MODELES;
  const poids = [[40, 35, 25], [50, 30, 20], [30, 30, 20, 20]];
  const creer = (matricule, n, jeu) => {
    const f = ficheDemoBrute(matricule);
    f.objectifs.liste = modeles.slice(n % 2, (n % 2) + poids[jeu].length).map(([titre, description], i) => ({
      id: idObjectifDemo++, titre, description, indicateur: null, ponderation: poids[jeu][i], note: null, commentaire: null }));
    return f;
  };
  const il = (jours) => new Date(Date.now() - jours * 86400000).toISOString();
  EMPLOYES.forEach((e, index) => {
    if (e.matricule === "VT0010") { creer(e.matricule, 0, 0); return; }   // compte « Utilisateur » : brouillon à compléter
    const etape = index % 5;
    if (etape === 0) return;                                              // fiche vierge
    const f = creer(e.matricule, index, index % 3);
    const superieur = e.validateur ? parMatricule[e.validateur] : null;
    if (etape === 1) { f.objectifs.statut = "soumise"; f.objectifs.soumise_le = il(3); return; }
    Object.assign(f.objectifs, { statut: "validee", soumise_le: il(40), validee_le: il(35), validee_par: miniEmploye(superieur) });
    if (etape === 2) return;                                              // à évaluer
    f.objectifs.liste.forEach((o, i) => { o.note = [15, 13.5, 17, 12][i % 4]; o.commentaire = null; });
    Object.assign(f.evaluation, { valide_superieur_le: il(6), superieur: miniEmploye(superieur),
      appreciation: "Objectifs globalement atteints, bonne implication dans l'équipe.",
      note_objectifs: arrondi2(noteDesObjectifs(f.objectifs.liste)) });
    if (etape === 3) return;                                              // en attente de la RH
    const rh = parMatricule.VT0002 || EMPLOYES.find((x) => x.role === "admin");
    Object.assign(f.evaluation, { note_comportement: 16, commentaire_comportement: "Ponctualité et esprit d'équipe exemplaires.",
      valide_rh_le: il(2), rh: miniEmploye(rh), finalisee_le: il(2) });
    f.evaluation.note_finale = arrondi2(noteFinaleDe(f.evaluation.note_objectifs, 16));
  });
})();

/* ------------------------------------------------------------ Mode connecté */
const FICHES_API = {
  charger: (m) => API.appel(`/api/fiches/${encodeURIComponent(m)}`),
  lister: () => API.appel("/api/fiches"),
  enregistrerObjectifs: (m, liste) => API.appel(`/api/fiches/${encodeURIComponent(m)}/objectifs`, { methode: "PUT", corps: { objectifs: liste } }),
  soumettre: (m) => API.appel(`/api/fiches/${encodeURIComponent(m)}/objectifs/soumettre`, { methode: "POST" }),
  valider: (m, commentaire) => API.appel(`/api/fiches/${encodeURIComponent(m)}/objectifs/valider`, { methode: "POST", corps: { commentaire } }),
  renvoyer: (m, commentaire) => API.appel(`/api/fiches/${encodeURIComponent(m)}/objectifs/renvoyer`, { methode: "POST", corps: { commentaire } }),
  noter: (m, notes, appreciation) => API.appel(`/api/fiches/${encodeURIComponent(m)}/evaluation/notes`, { methode: "PUT", corps: { notes, appreciation } }),
  approuver: (m) => API.appel(`/api/fiches/${encodeURIComponent(m)}/evaluation/approuver`, { methode: "POST" }),
  comportement: (m, note, commentaire) => API.appel(`/api/fiches/${encodeURIComponent(m)}/evaluation/comportement`, { methode: "PUT", corps: { note, commentaire } }),
  validerRH: (m) => API.appel(`/api/fiches/${encodeURIComponent(m)}/evaluation/valider-rh`, { methode: "POST" }),
};
const FICHES = () => (connecte() ? FICHES_API : FICHES_DEMO);

/* ------------------------------------------------------------ Cache des vues */
const cacheFiches = { fiches: {}, liste: null, enCours: new Set(), erreur: null };
function viderCacheFiches() { cacheFiches.fiches = {}; cacheFiches.liste = null; cacheFiches.erreur = null; }
function chargerCache(cle, promesse) {
  if (cacheFiches.enCours.has(cle)) return;
  cacheFiches.enCours.add(cle);
  promesse.then((donnees) => {
    if (cle === "liste") { cacheFiches.liste = donnees; etat.fichesATraiter = compterATraiter(donnees); }
    else cacheFiches.fiches[cle] = donnees;
  }).catch((souci) => { cacheFiches.erreur = souci.message; })
    .finally(() => { cacheFiches.enCours.delete(cle); if (etat.route.startsWith("/fiche-")) rendre(false); });
}
async function actionFiche(promesse, titre, message) {
  try {
    const fiche = await promesse;
    cacheFiches.fiches[fiche.employe.matricule] = fiche;
    cacheFiches.liste = null;
    if (connecte()) {
      try { const notifs = await API.appel("/api/notifications?limite=60");
        NOTIFICATIONS.length = 0; notifs.forEach((n) => NOTIFICATIONS.push(versNotificationLocale(n, moi().matricule))); } catch { /* sans gravité */ }
    }
    await rafraichirCompteurFiches();
    fermerCouche();
    toast(titre, message, "succes");
    rendre(false);
    return fiche;
  } catch (souci) {
    toast("Action refusée", souci.message, "danger");
    return null;
  }
}

/* Supérieur hiérarchique ou administration RH : accès aux fiches d'autrui. */
const gereDesFiches = () => estAdmin() || EMPLOYES.some((e) => e.validateur === moi().matricule);

/* Fiches qui attendent une action de l'utilisateur connecté. */
function compterATraiter(liste) {
  return {
    objectifs: liste.filter((x) => x.superieur_direct && x.statut_objectifs === "soumise").length,
    evaluation: liste.filter((x) => (x.superieur_direct && ["a_evaluer", "en_cours", "attente_superieur"].includes(x.statut_evaluation))
      || (estAdmin() && !x.superieur_direct && x.statut_evaluation === "attente_rh")).length,
  };
}
async function rafraichirCompteurFiches() {
  if (!etat.utilisateur || !gereDesFiches()) { etat.fichesATraiter = null; return; }
  try {
    const liste = await FICHES().lister();
    cacheFiches.liste = liste;
    etat.fichesATraiter = compterATraiter(liste);
  } catch { /* compteur indisponible : sans gravité */ }
}

function ongletsFiches(f) {
  if (!gereDesFiches()) return "";
  const direction = typeof estDirection === "function" && estDirection();
  const libelle = direction ? "Fiches du personnel"
    : estAdmin() && !EMPLOYES.some((e) => e.validateur === moi().matricule) ? "Fiches des collaborateurs" : "Fiches de mon équipe";
  const n = etat.fichesATraiter ? etat.fichesATraiter[f.type || "objectifs"] : 0;
  return `<div class="segment" id="fiches-onglets" style="align-self:flex-start">
    <button data-onglet="moi" class="${f.onglet === "moi" ? "actif" : ""}">Ma fiche</button>
    <button data-onglet="equipe" class="${f.onglet === "equipe" ? "actif" : ""}">${libelle}${n ? ` <span class="nav-pastille" style="position:static;margin-left:6px">${n}</span>` : ""}</button>
  </div>`;
}

function chargementFiche() {
  return `<section class="carte">${cacheFiches.erreur
    ? etatVide("alerte", "Fiche indisponible", cacheFiches.erreur)
    : `<div class="squelette" style="height:180px;border-radius:14px"></div>`}</section>`;
}

function vueFiches(type) {
  return `<div style="display:flex;flex-direction:column;gap:16px">${vueFichesContenu(type)}</div>`;
}
function vueFichesContenu(type) {
  const nouveau = !etat.filtres.fiches;
  const f = etat.filtres.fiches || (etat.filtres.fiches = { onglet: "moi", selection: null, recherche: "", statut: "" });
  f.type = type;
  if (nouveau && etat.fichesATraiter && etat.fichesATraiter[type] > 0) f.onglet = "equipe";
  if (f.onglet === "equipe" && !gereDesFiches()) f.onglet = "moi";
  const cible = f.onglet === "equipe" ? f.selection : moi().matricule;

  if (f.onglet === "equipe" && !cible) {
    if (!cacheFiches.liste) { chargerCache("liste", FICHES().lister()); return ongletsFiches(f) + chargementFiche(); }
    return ongletsFiches(f) + listeFiches(type, f);
  }
  const fiche = cacheFiches.fiches[cible];
  if (!fiche) { chargerCache(cible, FICHES().charger(cible)); return ongletsFiches(f) + chargementFiche(); }
  const retour = f.onglet === "equipe"
    ? `<button class="btn petit fantome" id="fiche-retour" style="align-self:flex-start">${ico("chevronG")} Retour à la liste</button>` : "";
  const enAttente = f.onglet === "moi" && etat.fichesATraiter ? etat.fichesATraiter[type] : 0;
  const rappel = enAttente ? `<div class="bandeau-info alerte">${ico("inbox")}<span style="flex:1"><strong>${enAttente} fiche(s) de votre équipe attendent votre décision.</strong>
      Elles se trouvent dans l'onglet « Fiches de mon équipe ».</span>
      <button class="btn petit primaire" id="fiches-voir-equipe">${ico("fleche")} Voir</button></div>` : "";
  return ongletsFiches(f) + rappel + retour + enteteFiche(fiche, type)
    + (type === "objectifs" ? corpsObjectifs(fiche) : corpsEvaluation(fiche));
}

function enteteFiche(fiche, type) {
  const e = fiche.employe;
  const [cls, libelle] = type === "objectifs" ? STATUTS_OBJECTIFS[fiche.objectifs.statut] : STATUTS_EVALUATION[fiche.evaluation.statut];
  const role = fiche.droits.proprietaire ? "Votre fiche"
    : fiche.droits.superieur ? "Vous êtes son supérieur hiérarchique"
    : fiche.droits.rh ? "Administration RH" : "";
  return `<section class="carte fiche-tete">
    <div class="avatar l" style="background:${couleurDept(e.departement)}">${(e.prenom[0] + e.nom[0]).toUpperCase()}</div>
    <div class="fiche-id">
      <h2>${type === "objectifs" ? "Fiche d'objectifs" : "Fiche d'évaluation"} ${fiche.annee} — ${echapper(e.prenom)} ${echapper(e.nom)}</h2>
      <p>${echapper(e.poste || "")}${e.poste ? " · " : ""}Matricule <span class="mono">${echapper(e.matricule)}</span>
        · Supérieur hiérarchique : ${fiche.superieur ? echapper(`${fiche.superieur.prenom} ${fiche.superieur.nom}`) : "administration RH"}</p>
    </div>
    ${role ? `<span class="badge neutre">${role}</span>` : ""}
    <span class="badge ${cls}">${libelle}</span>
  </section>`;
}

/* ------------------------------------------------------------ Fiche d'objectifs */
function corpsObjectifs(fiche) {
  const o = fiche.objectifs, d = fiche.droits;
  const bandeaux = [];
  if (d.rh && !d.superieur) bandeaux.push(["info", "oeil", "<strong>Consultation seule.</strong> L'administration RH visualise la fiche d'objectifs sans possibilité de modification."]);
  if (o.statut === "a_corriger" && o.commentaire_superieur) bandeaux.push(["alerte", "alerte", `<strong>À corriger :</strong> ${echapper(o.commentaire_superieur)}`]);
  if (o.statut === "soumise" && d.proprietaire) bandeaux.push(["info", "horloge", "Votre fiche est entre les mains de votre supérieur hiérarchique : il peut la valider, la modifier ou vous la renvoyer."]);
  if (o.statut === "soumise" && d.superieur) bandeaux.push(["alerte", "inbox", "Cette fiche attend votre décision : modifiez-la si besoin, puis validez-la ou renvoyez-la au collaborateur."]);
  if (o.statut === "validee") bandeaux.push(["succes", "check", `Fiche validée${o.validee_par ? ` par ${echapper(o.validee_par.prenom + " " + o.validee_par.nom)}` : ""}${o.validee_le ? ` le ${fmtDate(o.validee_le.slice(0, 10))}` : ""}${o.modifiee_par_superieur ? " — modifiée par le supérieur hiérarchique" : ""}.${o.commentaire_superieur ? ` « ${echapper(o.commentaire_superieur)} »` : ""}`]);

  const html = bandeaux.map(([cls, icone, texte]) => `<div class="bandeau-info ${cls}">${ico(icone)}<span>${texte}</span></div>`).join("");
  return html + (d.modifier_objectifs ? editeurObjectifs(fiche) : lectureObjectifs(fiche));
}

function lectureObjectifs(fiche) {
  const o = fiche.objectifs;
  if (!o.liste.length) {
    return `<section class="carte">${etatVide("doc", "Aucun objectif saisi",
      fiche.droits.proprietaire ? "Votre fiche n'est pas modifiable à ce stade." : "Le collaborateur n'a pas encore rédigé ses objectifs.")}</section>`;
  }
  return `<section class="carte">
    <div class="carte-entete"><h3>Objectifs ${fiche.annee}</h3><span class="carte-sous">${o.liste.length} objectif(s) · total ${noteFr(o.total_ponderation)} %</span></div>
    <div class="tableau-boite"><table style="min-width:560px">
      <thead><tr><th style="width:40px">#</th><th>Objectif</th><th>Indicateur de mesure</th><th class="droite" style="width:120px">Pondération</th></tr></thead>
      <tbody>${o.liste.map((x, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td><strong style="font-size:13px">${echapper(x.titre)}</strong>${x.description ? `<div style="font-size:12px;color:var(--encre-2);margin-top:2px">${echapper(x.description)}</div>` : ""}</td>
        <td style="font-size:12.5px;color:var(--encre-2)">${echapper(x.indicateur || "—")}</td>
        <td class="droite"><span class="badge neutre">${noteFr(x.ponderation)} %</span></td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

function editeurObjectifs(fiche) {
  const cle = fiche.employe.matricule;
  etat.brouillonsObjectifs = etat.brouillonsObjectifs || {};
  if (!etat.brouillonsObjectifs[cle]) {
    etat.brouillonsObjectifs[cle] = fiche.objectifs.liste.length
      ? fiche.objectifs.liste.map((x) => ({ titre: x.titre, description: x.description || "", indicateur: x.indicateur || "", ponderation: x.ponderation }))
      : [{ titre: "", description: "", indicateur: "", ponderation: 100 }];
  }
  const d = fiche.droits;
  const boutons = d.superieur
    ? `<button class="btn" id="obj-enregistrer">${ico("crayon")} Enregistrer les modifications</button>
       ${d.renvoyer_objectifs ? `<button class="btn" id="obj-renvoyer">${ico("chevronG")} Renvoyer au collaborateur</button>` : ""}
       ${d.valider_objectifs ? `<button class="btn primaire" id="obj-valider">${ico("check")} Valider la fiche</button>` : ""}`
    : `<button class="btn" id="obj-enregistrer">${ico("crayon")} Enregistrer le brouillon</button>
       ${d.soumettre ? `<button class="btn primaire" id="obj-soumettre">${ico("fleche")} Soumettre à mon supérieur</button>` : ""}`;
  return `<section class="carte">
    <div class="carte-entete">
      <h3>${d.superieur ? "Objectifs du collaborateur" : "Mes objectifs"} ${fiche.annee}</h3>
      <span class="carte-sous">Chaque objectif est pondéré en pourcentage ; le total doit faire 100 %.</span>
    </div>
    <div id="obj-lignes" style="display:flex;flex-direction:column;gap:10px">${lignesEditeur(cle)}</div>
    <button class="btn petit" id="obj-ajouter" style="margin-top:10px">${ico("plus")} Ajouter un objectif</button>
    <div class="total-ponderation" id="obj-total" style="margin-top:14px">${blocTotal(cle)}</div>
    <div class="actions-fiche" style="margin-top:14px">${boutons}</div>
  </section>`;
}

function lignesEditeur(cle) {
  return etat.brouillonsObjectifs[cle].map((o, i) => `
    <div class="objectif-ligne" data-ligne="${i}">
      <span class="num-obj">${i + 1}</span>
      <div class="objectif-champs">
        <input class="saisie" data-champ="titre" placeholder="Intitulé de l'objectif" value="${echapper(o.titre)}" maxlength="200" aria-label="Intitulé de l'objectif ${i + 1}">
        <textarea class="saisie" data-champ="description" placeholder="Description, résultats attendus" style="min-height:54px" aria-label="Description de l'objectif ${i + 1}">${echapper(o.description)}</textarea>
        <input class="saisie" data-champ="indicateur" placeholder="Indicateur de mesure (facultatif)" value="${echapper(o.indicateur)}" aria-label="Indicateur de l'objectif ${i + 1}">
      </div>
      <label class="champ"><span style="font-size:11.5px;font-weight:600;color:var(--encre-3)">Pondération</span>
        <span class="saisie-pct"><input class="saisie num" type="number" min="1" max="100" step="1" data-champ="ponderation" value="${o.ponderation}" aria-label="Pondération de l'objectif ${i + 1}"> %</span>
      </label>
      <button class="btn icone fantome" data-supprimer-objectif="${i}" aria-label="Supprimer l'objectif ${i + 1}" title="Supprimer">${ico("poubelle")}</button>
    </div>`).join("");
}

function blocTotal(cle) {
  const total = etat.brouillonsObjectifs[cle].reduce((s, o) => s + (Number(o.ponderation) || 0), 0);
  const ok = Math.abs(total - 100) <= 0.01;
  $("#obj-total") && $("#obj-total").classList.toggle("ok", ok);
  $("#obj-total") && $("#obj-total").classList.toggle("ko", !ok);
  return `<span style="font-size:12.5px;color:var(--encre-2);font-weight:600">Total des pondérations
      <span style="display:block;font-weight:400;color:var(--encre-3)">${ok ? "Réparti correctement." : total > 100 ? `Dépassement de ${noteFr(total - 100)} %.` : `Il reste ${noteFr(100 - total)} % à répartir.`}</span></span>
    <strong>${noteFr(total)} %</strong>`;
}

function lireBrouillon(cle) {
  return etat.brouillonsObjectifs[cle]
    .map((o) => ({ titre: o.titre.trim(), description: o.description.trim() || null, indicateur: o.indicateur.trim() || null, ponderation: Number(o.ponderation) }))
    .filter((o) => o.titre || o.description);
}

function brancherEditeurObjectifs(fiche) {
  const cle = fiche.employe.matricule;
  const zone = $("#obj-lignes");
  if (!zone) return;
  const majTotal = () => { const t = $("#obj-total"); if (t) t.innerHTML = blocTotal(cle); };
  const redessiner = () => { zone.innerHTML = lignesEditeur(cle); brancherLignes(); majTotal(); };
  const brancherLignes = () => {
    $$("[data-ligne]", zone).forEach((ligne) => {
      const i = Number(ligne.dataset.ligne);
      $$("[data-champ]", ligne).forEach((champ) => champ.addEventListener("input", () => {
        etat.brouillonsObjectifs[cle][i][champ.dataset.champ] = champ.value;
        if (champ.dataset.champ === "ponderation") majTotal();
      }));
    });
    $$("[data-supprimer-objectif]", zone).forEach((b) => b.addEventListener("click", () => {
      etat.brouillonsObjectifs[cle].splice(Number(b.dataset.supprimerObjectif), 1);
      redessiner();
    }));
  };
  brancherLignes();
  majTotal();
  $("#obj-ajouter").addEventListener("click", () => {
    const liste = etat.brouillonsObjectifs[cle];
    const reste = Math.max(0, 100 - liste.reduce((s, o) => s + (Number(o.ponderation) || 0), 0));
    liste.push({ titre: "", description: "", indicateur: "", ponderation: reste || 10 });
    redessiner();
    const champs = $$("[data-champ=titre]", zone);
    if (champs.length) champs[champs.length - 1].focus();
  });

  const valides = () => {
    const liste = lireBrouillon(cle);
    if (liste.some((o) => o.titre.length < 2)) { toast("Intitulé manquant", "Chaque objectif doit avoir un intitulé.", "danger"); return null; }
    if (liste.some((o) => !(o.ponderation > 0 && o.ponderation <= 100))) { toast("Pondération invalide", "Chaque pondération est comprise entre 1 et 100 %.", "danger"); return null; }
    return liste;
  };
  const enregistrer = async () => {
    const liste = valides();
    if (!liste) return null;
    const r = await actionFiche(FICHES().enregistrerObjectifs(cle, liste), "Fiche enregistrée", `${liste.length} objectif(s) enregistré(s).`);
    if (r) delete etat.brouillonsObjectifs[cle];
    return r;
  };
  $("#obj-enregistrer").addEventListener("click", enregistrer);

  const soumettre = $("#obj-soumettre");
  if (soumettre) soumettre.addEventListener("click", async () => {
    const liste = valides();
    if (!liste) return;
    const total = liste.reduce((s, o) => s + o.ponderation, 0);
    if (Math.abs(total - 100) > 0.01) return toast("Pondérations incomplètes", `Le total doit être de 100 % (actuellement ${noteFr(total)} %).`, "danger");
    try { await FICHES().enregistrerObjectifs(cle, liste); } catch (souci) { return toast("Action refusée", souci.message, "danger"); }
    delete etat.brouillonsObjectifs[cle];
    actionFiche(FICHES().soumettre(cle), "Fiche soumise", "Votre supérieur hiérarchique a été notifié.");
  });

  const valider = $("#obj-valider");
  if (valider) valider.addEventListener("click", () => ouvrirDecisionObjectifs(fiche, true));
  const renvoyer = $("#obj-renvoyer");
  if (renvoyer) renvoyer.addEventListener("click", () => ouvrirDecisionObjectifs(fiche, false));
}

function ouvrirDecisionObjectifs(fiche, valider) {
  const cle = fiche.employe.matricule;
  const liste = lireBrouillon(cle);
  if (valider) {
    const total = liste.reduce((s, o) => s + o.ponderation, 0);
    if (Math.abs(total - 100) > 0.01) return toast("Pondérations incomplètes", `Le total doit être de 100 % (actuellement ${noteFr(total)} %).`, "danger");
  }
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete"><div>
        <h2>${valider ? "Valider la fiche d'objectifs" : "Renvoyer pour correction"}</h2>
        <div class="sous">${echapper(fiche.employe.prenom + " " + fiche.employe.nom)} · ${liste.length} objectif(s)</div>
      </div></div>
      <div class="modale-corps">
        ${valider ? `<p style="font-size:13px;color:var(--encre-2)">Les modifications éventuelles sont enregistrées avant la validation. Le collaborateur est notifié.</p>` : ""}
        <div class="champ"><label for="decision-commentaire">${valider ? "Commentaire (facultatif)" : "Ce que le collaborateur doit corriger"}</label>
          <textarea class="saisie" id="decision-commentaire" style="min-height:90px"></textarea></div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="decision-annuler">Annuler</button>
        <button class="btn ${valider ? "primaire" : "danger"}" id="decision-confirmer">${ico(valider ? "check" : "chevronG")} ${valider ? "Valider" : "Renvoyer"}</button>
      </div>
    </div>`);
  $("#decision-annuler").addEventListener("click", fermerCouche);
  $("#decision-confirmer").addEventListener("click", async () => {
    const commentaire = $("#decision-commentaire").value.trim();
    if (valider) {
      if (liste.some((o) => o.titre.length < 2)) return toast("Intitulé manquant", "Chaque objectif doit avoir un intitulé.", "danger");
      try { await FICHES().enregistrerObjectifs(cle, liste); } catch (souci) { return toast("Action refusée", souci.message, "danger"); }
      delete etat.brouillonsObjectifs[cle];
      actionFiche(FICHES().valider(cle, commentaire || null), "Fiche d'objectifs validée", `${fiche.employe.prenom} ${fiche.employe.nom} a été notifié.`);
    } else {
      if (commentaire.length < 5) return toast("Commentaire requis", "Indiquez au collaborateur ce qu'il doit corriger.", "danger");
      delete etat.brouillonsObjectifs[cle];
      actionFiche(FICHES().renvoyer(cle, commentaire), "Fiche renvoyée", `${fiche.employe.prenom} ${fiche.employe.nom} a été notifié.`);
    }
  });
}

/* ------------------------------------------------------------ Fiche d'évaluation */
function corpsEvaluation(fiche) {
  const o = fiche.objectifs, ev = fiche.evaluation, d = fiche.droits, part = fiche.ponderation_finale || PART_FINALE;
  if (ev.statut === "non_ouverte") {
    return `<section class="carte">${etatVide("horloge", "Évaluation non ouverte",
      "La fiche d'évaluation s'ouvre dès que la fiche d'objectifs est validée par le supérieur hiérarchique.",
      `<button class="btn petit" data-route="/fiche-objectifs">${ico("doc")} Voir la fiche d'objectifs</button>`)}</section>`;
  }
  const etapes = `<section class="etapes">
    <div class="etape faite"><span class="rond">${ico("check")}</span><div><strong>Objectifs validés</strong><span>${o.validee_le ? fmtDate(o.validee_le.slice(0, 10)) : ""}</span></div></div>
    <div class="etape ${ev.valide_superieur_le ? "faite" : ""}"><span class="rond">${ico(ev.valide_superieur_le ? "check" : "horloge")}</span><div><strong>Notes des objectifs</strong>
      <span>${ev.valide_superieur_le ? `Approuvées le ${fmtDate(ev.valide_superieur_le.slice(0, 10))}${ev.superieur ? ` par ${echapper(ev.superieur.prenom + " " + ev.superieur.nom)}` : ""}` : "Supérieur hiérarchique"}</span></div></div>
    <div class="etape ${ev.valide_rh_le ? "faite" : ""}"><span class="rond">${ico(ev.valide_rh_le ? "check" : "horloge")}</span><div><strong>Note de comportement</strong>
      <span>${ev.valide_rh_le ? `Validée le ${fmtDate(ev.valide_rh_le.slice(0, 10))} par la RH` : "Administration RH"}</span></div></div>
    <div class="etape ${ev.finalisee_le ? "faite" : ""}"><span class="rond">${ico(ev.finalisee_le ? "check" : "cloche")}</span><div><strong>Notification</strong>
      <span>${ev.finalisee_le ? "Collaborateur informé du détail" : "Après les deux validations"}</span></div></div>
  </section>`;

  if (d.proprietaire && !d.voir_notes) {
    return etapes + `<section class="carte">${etatVide("bouclier", "Évaluation en cours",
      "Vos notes seront visibles ici, avec leur détail, dès que votre supérieur hiérarchique et l'administration RH auront validé votre évaluation. Vous recevrez une notification.")}</section>`;
  }

  const bandeau = d.rh && !d.superieur && !ev.finalisee_le
    ? `<div class="bandeau-info">${ico("bouclier")}<span><strong>Administration RH :</strong> vous saisissez uniquement la note de comportement. Les notes des objectifs professionnels relèvent du supérieur hiérarchique.</span></div>` : "";
  const felicitations = d.proprietaire && ev.finalisee_le
    ? `<div class="bandeau-info succes">${ico("check")}<span><strong>Évaluation validée</strong> par votre supérieur hiérarchique et par la RH le ${fmtDate(ev.finalisee_le.slice(0, 10))}.</span></div>` : "";

  const editable = d.noter;
  const lignes = o.liste.map((x, i) => {
    const contribution = x.note == null ? null : (x.note * x.ponderation) / 100;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><strong style="font-size:13px">${echapper(x.titre)}</strong>${x.indicateur ? `<div style="font-size:11.5px;color:var(--encre-3)">Indicateur : ${echapper(x.indicateur)}</div>` : ""}</td>
      <td class="droite"><span class="badge neutre">${noteFr(x.ponderation)} %</span></td>
      <td class="droite">${editable
        ? `<input class="saisie num saisie-note" type="number" min="0" max="20" step="0.25" data-note="${x.id}" value="${x.note ?? ""}" aria-label="Note sur 20 de l'objectif ${i + 1}">`
        : `<strong class="num">${noteFr(x.note)}</strong><span style="color:var(--encre-3)"> /20</span>`}</td>
      <td class="droite num" data-contribution="${x.id}">${contribution == null ? "—" : noteFr(contribution)}</td>
      <td>${editable
        ? `<input class="saisie" data-commentaire-note="${x.id}" value="${echapper(x.commentaire || "")}" placeholder="Commentaire" aria-label="Commentaire de l'objectif ${i + 1}">`
        : `<span style="font-size:12.5px;color:var(--encre-2)">${echapper(x.commentaire || "—")}</span>`}</td>
    </tr>`;
  }).join("");

  const noteComp = ev.note_comportement;
  const blocComportement = d.noter_comportement
    ? `<div class="ligne-champs" style="align-items:flex-end">
        <div class="champ"><label for="eval-comportement">Note de comportement (sur 20)</label>
          <input class="saisie num" type="number" min="0" max="20" step="0.25" id="eval-comportement" value="${noteComp ?? ""}"></div>
        <div class="champ" style="flex:2"><label for="eval-comportement-commentaire">Commentaire</label>
          <input class="saisie" id="eval-comportement-commentaire" value="${echapper(ev.commentaire_comportement || "")}" placeholder="Assiduité, ponctualité, esprit d'équipe, respect des règles…"></div>
      </div>
      <div class="actions-fiche" style="margin-top:12px">
        <button class="btn" id="eval-comportement-enregistrer">${ico("crayon")} Enregistrer la note</button>
        <button class="btn primaire" id="eval-valider-rh">${ico("check")} Valider (administration RH)</button>
      </div>`
    : `<p style="font-size:13px;color:var(--encre-2)">${noteComp == null
        ? "La note de comportement sera saisie par l'administration RH."
        : `<strong class="num" style="font-size:15px">${noteFr(noteComp)}</strong> /20${ev.commentaire_comportement ? ` — ${echapper(ev.commentaire_comportement)}` : ""}`}</p>`;

  return etapes + bandeau + felicitations + `
  <section class="carte">
    <div class="carte-entete"><h3>Évaluation des objectifs professionnels</h3>
      <span class="carte-sous">Notés sur 20 par le supérieur hiérarchique · note = moyenne pondérée</span></div>
    <div class="tableau-boite"><table style="min-width:820px">
      <thead><tr><th style="width:36px">#</th><th style="min-width:240px">Objectif</th><th class="droite" style="width:104px">Pondération</th>
        <th class="droite" style="width:120px">Note /20</th><th class="droite" style="width:104px">Points pondérés</th><th style="min-width:170px">Commentaire</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table></div>
    ${editable ? `
      <div class="champ" style="margin-top:12px"><label for="eval-appreciation">Appréciation générale du supérieur hiérarchique</label>
        <textarea class="saisie" id="eval-appreciation" style="min-height:70px">${echapper(ev.appreciation || "")}</textarea></div>
      <div class="actions-fiche" style="margin-top:12px">
        <button class="btn" id="eval-notes-enregistrer">${ico("crayon")} Enregistrer les notes</button>
        <button class="btn primaire" id="eval-approuver">${ico("check")} Approuver l'évaluation</button>
      </div>`
    : ev.appreciation ? `<p style="font-size:13px;color:var(--encre-2);margin-top:12px"><strong>Appréciation du supérieur :</strong> ${echapper(ev.appreciation)}</p>` : ""}
  </section>

  <section class="carte">
    <div class="carte-entete"><h3>Comportement</h3><span class="carte-sous">Note saisie uniquement par l'administration RH</span></div>
    ${blocComportement}
  </section>

  <section class="carte">
    <div class="carte-entete"><h3>Note finale</h3>
      <span class="carte-sous">${part.objectifs} % objectifs + ${part.comportement} % comportement — plafonnée à 20/20</span></div>
    <div class="note-finale" id="eval-synthese">${blocSynthese(fiche)}</div>
  </section>`;
}

function blocSynthese(fiche, apercu) {
  const part = fiche.ponderation_finale || PART_FINALE;
  const nObj = apercu ? apercu.objectifs : fiche.evaluation.note_objectifs;
  const nComp = apercu ? apercu.comportement : fiche.evaluation.note_comportement;
  const finale = fiche.evaluation.note_finale != null && !apercu ? fiche.evaluation.note_finale : noteFinaleDe(nObj, nComp, part);
  return `
    <div class="note-bloc"><span>Objectifs (${part.objectifs} %)</span><strong class="num">${noteFr(nObj)}</strong> <small>/20</small></div>
    <div class="note-bloc"><span>Comportement (${part.comportement} %)</span><strong class="num">${noteFr(nComp)}</strong> <small>/20</small></div>
    <div class="note-bloc finale"><span>Note finale${fiche.evaluation.finalisee_le ? "" : " (provisoire)"}</span><strong class="num">${noteFr(finale)}</strong> <small>/20</small></div>`;
}

function brancherEvaluation(fiche) {
  const cle = fiche.employe.matricule;
  const lireNotes = () => fiche.objectifs.liste.map((x) => {
    const champ = $(`[data-note="${x.id}"]`);
    const brut = champ ? champ.value.trim().replace(",", ".") : "";
    const commentaire = $(`[data-commentaire-note="${x.id}"]`);
    return { objectif_id: x.id, note: brut === "" ? null : Number(brut), commentaire: commentaire ? commentaire.value.trim() || null : null };
  });
  const apercu = () => {
    const notes = lireNotes();
    notes.forEach((n) => {
      const x = fiche.objectifs.liste.find((o) => o.id === n.objectif_id);
      const cellule = $(`[data-contribution="${n.objectif_id}"]`);
      const valide = n.note != null && n.note >= 0 && n.note <= NOTE_MAX;
      const champ = $(`[data-note="${n.objectif_id}"]`);
      if (champ) champ.closest("td").classList.toggle("erreur", n.note != null && !valide);
      if (cellule) cellule.textContent = valide ? noteFr((n.note * x.ponderation) / 100) : "—";
    });
    const liste = fiche.objectifs.liste.map((x) => ({ ...x, note: (notes.find((n) => n.objectif_id === x.id) || {}).note }));
    const comp = $("#eval-comportement");
    const nComp = comp && comp.value !== "" ? Math.min(NOTE_MAX, Math.max(0, Number(comp.value.replace(",", ".")))) : fiche.evaluation.note_comportement;
    const nObj = liste.every((x) => x.note != null && x.note >= 0 && x.note <= NOTE_MAX) ? noteDesObjectifs(liste) : fiche.evaluation.note_objectifs;
    $("#eval-synthese").innerHTML = blocSynthese(fiche, { objectifs: nObj, comportement: nComp });
  };
  $$("[data-note]").forEach((c) => c.addEventListener("input", apercu));
  const comp = $("#eval-comportement");
  if (comp) comp.addEventListener("input", apercu);

  const controlerNotes = (exigerToutes) => {
    const notes = lireNotes();
    if (notes.some((n) => n.note != null && !(n.note >= 0 && n.note <= NOTE_MAX))) { toast("Note invalide", "Chaque note est comprise entre 0 et 20.", "danger"); return null; }
    if (exigerToutes && notes.some((n) => n.note == null)) { toast("Notes manquantes", "Chaque objectif doit recevoir une note avant approbation.", "danger"); return null; }
    return notes;
  };
  const appreciation = () => ($("#eval-appreciation") ? $("#eval-appreciation").value.trim() || null : null);
  const btnNotes = $("#eval-notes-enregistrer");
  if (btnNotes) btnNotes.addEventListener("click", () => {
    const notes = controlerNotes(false);
    if (notes) actionFiche(FICHES().noter(cle, notes, appreciation()), "Notes enregistrées", "Vous pouvez approuver l'évaluation une fois toutes les notes saisies.");
  });
  const btnApprouver = $("#eval-approuver");
  if (btnApprouver) btnApprouver.addEventListener("click", async () => {
    const notes = controlerNotes(true);
    if (!notes) return;
    try { await FICHES().noter(cle, notes, appreciation()); } catch (souci) { return toast("Action refusée", souci.message, "danger"); }
    actionFiche(FICHES().approuver(cle), "Évaluation approuvée", "L'administration RH a été notifiée pour la note de comportement.");
  });

  const lireComportement = () => {
    const brut = $("#eval-comportement").value.trim().replace(",", ".");
    const note = Number(brut);
    if (brut === "" || !(note >= 0 && note <= NOTE_MAX)) { toast("Note invalide", "La note de comportement est comprise entre 0 et 20.", "danger"); return null; }
    return { note, commentaire: $("#eval-comportement-commentaire").value.trim() || null };
  };
  const btnComp = $("#eval-comportement-enregistrer");
  if (btnComp) btnComp.addEventListener("click", () => {
    const c = lireComportement();
    if (c) actionFiche(FICHES().comportement(cle, c.note, c.commentaire), "Note de comportement enregistrée", `${noteFr(c.note)}/20`);
  });
  const btnRH = $("#eval-valider-rh");
  if (btnRH) btnRH.addEventListener("click", async () => {
    const c = lireComportement();
    if (!c) return;
    try { await FICHES().comportement(cle, c.note, c.commentaire); } catch (souci) { return toast("Action refusée", souci.message, "danger"); }
    const fiche2 = await actionFiche(FICHES().validerRH(cle), "Évaluation validée par la RH", "Validation enregistrée.");
    if (fiche2 && fiche2.evaluation.finalisee_le) toast("Évaluation finalisée", `${fiche.employe.prenom} ${fiche.employe.nom} a été notifié avec le détail de ses notes.`, "succes");
  });
}

/* ------------------------------------------------------------ Liste d'équipe */
function listeFiches(type, f) {
  let liste = cacheFiches.liste || [];
  if (f.recherche) {
    const q = f.recherche.toLowerCase();
    liste = liste.filter((x) => `${x.employe.prenom} ${x.employe.nom} ${x.employe.matricule}`.toLowerCase().includes(q));
  }
  const cleStatut = type === "objectifs" ? "statut_objectifs" : "statut_evaluation";
  const statuts = type === "objectifs" ? STATUTS_OBJECTIFS : STATUTS_EVALUATION;
  if (f.statut) liste = liste.filter((x) => x[cleStatut] === f.statut);
  const urgent = (x) => compterATraiter([x])[type] > 0 ? 0 : 1;
  liste = [...liste].sort((a, b) => urgent(a) - urgent(b));
  const aTraiter = compterATraiter(cacheFiches.liste || [])[type];
  return `
  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <h2>${type === "objectifs" ? "Fiches d'objectifs" : "Fiches d'évaluation"} ${ANNEE}</h2>
      <span class="badge ${aTraiter ? "attente" : "approuvee"}">${aTraiter} à traiter</span>
    </div>
    <div class="barre-filtres" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <input class="saisie" id="fiches-recherche" placeholder="Rechercher un collaborateur…" value="${echapper(f.recherche)}" style="max-width:280px">
      <select class="saisie" id="fiches-statut" style="max-width:240px">
        <option value="">Tous les statuts</option>
        ${Object.entries(statuts).map(([cle, [, libelle]]) => `<option value="${cle}" ${f.statut === cle ? "selected" : ""}>${libelle}</option>`).join("")}
      </select>
    </div>
    ${liste.length ? `<div class="tableau-boite"><table style="min-width:640px">
      <thead><tr><th>Collaborateur</th><th>Rôle</th><th class="centre">Objectifs</th><th>Statut</th>${type === "evaluation" ? '<th class="droite">Note finale</th>' : ""}<th class="droite">Action</th></tr></thead>
      <tbody>${liste.map((x) => {
        const [cls, libelle] = statuts[x[cleStatut]] || ["neutre", x[cleStatut]];
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:9px">
            <div class="avatar s" style="background:${couleurDept(x.employe.departement)}">${(x.employe.prenom[0] + x.employe.nom[0]).toUpperCase()}</div>
            <div><strong style="font-size:13px">${echapper(x.employe.prenom + " " + x.employe.nom)}</strong>
            <div style="font-size:11.5px;color:var(--encre-3)"><span class="mono">${echapper(x.employe.matricule)}</span> · ${echapper(x.employe.poste || "")}</div></div>
          </div></td>
          <td style="font-size:12.5px;color:var(--encre-2)">${x.superieur_direct ? "Supérieur hiérarchique"
            : (typeof estDirection === "function" && estDirection() ? "Consultation" : "Consultation RH")}</td>
          <td class="centre num">${x.nombre_objectifs}</td>
          <td><span class="badge ${cls}">${libelle}</span></td>
          ${type === "evaluation" ? `<td class="droite num"><strong>${x.note_finale == null ? "—" : noteFr(x.note_finale) + " /20"}</strong></td>` : ""}
          <td class="droite">${x.verrouillee
            ? `<span class="badge neutre" title="Fiche validée : son détail n'est consultable que par l'administration RH">${ico("bouclier")} Validée · accès RH</span>`
            : `<button class="btn petit" data-ouvrir-fiche="${echapper(x.employe.matricule)}">${ico("oeil")} Ouvrir</button>`}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>` : etatVide("users", "Aucune fiche", "Aucun collaborateur ne correspond à ces critères.")}
  </section>`;
}

/* ------------------------------------------------------------ Branchements */
function brancherFiches(type) {
  const f = etat.filtres.fiches;
  $$("#fiches-onglets button").forEach((b) => b.addEventListener("click", () => {
    f.onglet = b.dataset.onglet; f.selection = null; cacheFiches.liste = null; rendre(false);
  }));
  const retour = $("#fiche-retour");
  if (retour) retour.addEventListener("click", () => { f.selection = null; cacheFiches.liste = null; rendre(false); });
  const voirEquipe = $("#fiches-voir-equipe");
  if (voirEquipe) voirEquipe.addEventListener("click", () => { f.onglet = "equipe"; f.selection = null; cacheFiches.liste = null; rendre(false); });
  $$("[data-ouvrir-fiche]").forEach((b) => b.addEventListener("click", () => {
    f.selection = b.dataset.ouvrirFiche; delete cacheFiches.fiches[f.selection]; rendre(false);
  }));
  const recherche = $("#fiches-recherche");
  if (recherche) recherche.addEventListener("input", debounce(() => {
    f.recherche = recherche.value; rendre(false);
    const champ = $("#fiches-recherche"); if (champ) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }, 250));
  const statut = $("#fiches-statut");
  if (statut) statut.addEventListener("change", () => { f.statut = statut.value; rendre(false); });

  const cible = f.onglet === "equipe" ? f.selection : moi().matricule;
  const fiche = cible && cacheFiches.fiches[cible];
  if (!fiche) return;
  if (type === "objectifs" && fiche.droits.modifier_objectifs) brancherEditeurObjectifs(fiche);
  if (type === "evaluation") brancherEvaluation(fiche);
}

VUES["/fiche-objectifs"] = () => vueFiches("objectifs");
VUES["/fiche-evaluation"] = () => vueFiches("evaluation");
VUES["/entretiens"] = VUES["/fiche-objectifs"];
BRANCHEMENTS["/fiche-objectifs"] = () => brancherFiches("objectifs");
BRANCHEMENTS["/fiche-evaluation"] = () => brancherFiches("evaluation");
BRANCHEMENTS["/entretiens"] = BRANCHEMENTS["/fiche-objectifs"];
TITRES["/fiche-objectifs"] = "Fiche d'objectifs";
TITRES["/fiche-evaluation"] = "Fiche d'évaluation";
TITRES["/entretiens"] = "Fiche d'objectifs";

/* Deux icônes dédiées : cible (objectifs) et étoile (évaluation). */
ICONES.cible = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>';
ICONES.etoile = '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>';

/* Menu : les deux rubriques remplacent l'ancienne page « Entretiens ». */
const menuNavigationSansFiches = menuNavigation;
menuNavigation = function () {
  const groupes = menuNavigationSansFiches();
  const perso = groupes[0].items;
  const index = perso.findIndex((i) => i.route === "/entretiens");
  const n = etat.fichesATraiter || {};
  const rubriques = [
    { route: "/fiche-objectifs", libelle: "Fiche d'objectifs", icone: "cible", pastille: n.objectifs || 0 },
    { route: "/fiche-evaluation", libelle: "Fiche d'évaluation", icone: "etoile", pastille: n.evaluation || 0 },
  ];
  perso.splice(index >= 0 ? index : perso.length, index >= 0 ? 1 : 0, ...rubriques);
  return groupes;
};

/* Fraîcheur : chaque arrivée sur une fiche relit les données. */
const naviguerSansFiches = naviguer;
naviguer = function (route) {
  if (route.startsWith("/fiche-") || route === "/entretiens") viderCacheFiches();
  return naviguerSansFiches(route);
};
const connecterDemoSansCompteur = connecterDemo;
connecterDemo = function (...args) {
  connecterDemoSansCompteur(...args);
  if (etat.utilisateur) rafraichirCompteurFiches().then(() => rendre(false));
};
const chargerDonneesSansCompteur = chargerDonneesApi;
chargerDonneesApi = async function () {
  await chargerDonneesSansCompteur();
  await rafraichirCompteurFiches();
};
const deconnexionSansFiches = deconnexion;
deconnexion = function () {
  viderCacheFiches();
  etat.fichesATraiter = null;
  etat.brouillonsObjectifs = {};
  delete etat.filtres.fiches;
  return deconnexionSansFiches();
};
