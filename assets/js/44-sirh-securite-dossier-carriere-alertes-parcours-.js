/* ==========================================================================
   44. SIRH : SÉCURITÉ, DOSSIER, CARRIÈRE, ALERTES, PARCOURS, REPORT DES
       CONGÉS, PAIE, ENTRETIEN, PLAN DE FORMATION, BILAN SOCIAL, DOCUMENTS,
       SONDAGES, DONNÉES PERSONNELLES, OUTLOOK, APPLICATION MOBILE
   ========================================================================== */
TYPES_CONGE.push({ code: "sans_solde", libelle: "Congé sans solde" });
if (REGLES.plafondReport === undefined) REGLES.plafondReport = 15;
const sirhAppel = (chemin, options) => API.appel(`/api/sirh${chemin}`, options);
const reserveServeur = (quoi) => etatVide("bouclier", "Disponible avec le serveur", `${quoi} : disponible une fois le portail lancé avec DEMARRER.bat.`);
const chargerEtat = (cle, promesse) => {
  if (etat[cle] !== undefined && etat[cle] !== null) return etat[cle];
  if (etat[`${cle}EnCours`]) return null;
  etat[`${cle}EnCours`] = true;
  promesse().then((d) => { etat[cle] = d; }).catch((souci) => { etat[cle] = { erreur: souci.message }; toast("Chargement impossible", souci.message, "danger"); })
    .finally(() => { etat[`${cle}EnCours`] = false; rendre(false); });
  return null;
};
const squelette = (h = 200) => `<div class="squelette" style="height:${h}px;border-radius:14px"></div>`;

/* --- 1. Changement du mot de passe provisoire imposé ------------------------ */
function imposerChangementMdp() {
  return new Promise((resolve) => {
    const boite = document.createElement("div");
    boite.className = "bloc-mdp";
    boite.innerHTML = `<div class="modale" role="dialog" aria-modal="true" style="max-width:440px">
      <div class="modale-tete"><div><h2>Choisissez votre mot de passe</h2>
        <div class="sous">Première connexion ou mot de passe réinitialisé : le mot de passe provisoire doit être remplacé.</div></div></div>
      <div class="modale-corps">
        <div class="champ"><label for="mdp1">Mot de passe actuel (provisoire)</label><input class="saisie" type="password" id="mdp1" autocomplete="current-password"></div>
        <div class="champ"><label for="mdp2">Nouveau mot de passe</label><input class="saisie" type="password" id="mdp2" autocomplete="new-password">
          <span class="aide">Au moins 8 caractères, avec des lettres et des chiffres.</span></div>
        <div class="champ"><label for="mdp3">Confirmation</label><input class="saisie" type="password" id="mdp3" autocomplete="new-password"></div>
        <div id="mdp-erreur" class="msg-erreur" hidden></div>
      </div>
      <div class="modale-pied"><button class="btn primaire" id="mdp-ok">${ico("bouclier")} Enregistrer et continuer</button></div>
    </div>`;
    document.body.appendChild(boite);
    const erreur = (t) => { const e = boite.querySelector("#mdp-erreur"); e.textContent = t; e.hidden = false; };
    boite.querySelector("#mdp-ok").addEventListener("click", async () => {
      const actuel = boite.querySelector("#mdp1").value, nouveau = boite.querySelector("#mdp2").value, confirme = boite.querySelector("#mdp3").value;
      if (nouveau !== confirme) return erreur("Les deux saisies ne correspondent pas.");
      try {
        await API.appel("/api/auth/mot-de-passe", { methode: "POST", corps: { actuel, nouveau } });
        boite.remove();
        toast("Mot de passe enregistré", "Il remplace le mot de passe provisoire, sur tous les postes.", "succes");
        resolve();
      } catch (souci) { erreur(souci.message); }
    });
    setTimeout(() => boite.querySelector("#mdp1").focus(), 50);
  });
}
const chargerDonneesAvantSecurite = chargerDonneesApi;
chargerDonneesApi = async function () {
  const moiServeur = await API.appel("/api/auth/moi");
  if (moiServeur.doit_changer_mdp) await imposerChangementMdp();
  return chargerDonneesAvantSecurite();
};

/* --- 2. Dossier du collaborateur et carrière (administration RH) ------------ */
const TYPES_CONTRAT = ["CDI", "CDD", "Contractuel", "Stage", "SIVP", "Détachement"];
const CATEGORIES_PERSONNEL = ["Cadre supérieur", "Cadre", "Agent de maîtrise", "Agent d'exécution"];
const TYPES_CARRIERE = { embauche: "Embauche", promotion: "Promotion", mutation: "Mutation", changement_poste: "Changement de poste",
  grade: "Changement de grade", echelon: "Avancement d'échelon", titularisation: "Titularisation", contrat: "Changement de contrat",
  sortie: "Sortie des effectifs", autre: "Autre" };
const val = (v) => echapper(v ?? "");

async function ouvrirDossier(matricule) {
  const e = parMatricule[matricule];
  if (!connecte()) return toast("Disponible avec le serveur", "Le dossier du collaborateur est enregistré en base.", "info");
  let dossier, carriere;
  try { [dossier, carriere] = await Promise.all([sirhAppel(`/dossier/${matricule}`), sirhAppel(`/carriere/${matricule}`)]); }
  catch (souci) { return toast("Dossier indisponible", souci.message, "danger"); }
  const edition = estAdmin();
  const dis = edition ? "" : "disabled";
  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true" style="width:min(820px,100%)">
      ${enteteTiroir(`Dossier — ${nomComplet(e)}`, `${e.matricule} · ${e.poste || ""} · ${nomDept(e.dept)}`)}
      <div class="tiroir-corps" style="display:flex;flex-direction:column;gap:12px">
        <div class="sirh-grille">
          <div class="sirh-section"><h4>Contrat et classification</h4>
            <div class="ligne-champs"><div class="champ"><label>Date d'embauche</label><input class="saisie" type="date" id="do-entree" value="${val(dossier.date_entree)}" ${dis}></div>
              <div class="champ"><label>Type de contrat</label><select class="saisie" id="do-contrat" ${dis}><option value=""></option>${TYPES_CONTRAT.map((t) => `<option ${dossier.type_contrat === t ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
            <div class="ligne-champs"><div class="champ"><label>Fin de contrat</label><input class="saisie" type="date" id="do-fin-contrat" value="${val(dossier.date_fin_contrat)}" ${dis}></div>
              <div class="champ"><label>Fin de période d'essai</label><input class="saisie" type="date" id="do-fin-essai" value="${val(dossier.date_fin_essai)}" ${dis}></div></div>
            <div class="champ"><label>Catégorie</label><input class="saisie" id="do-categorie" list="liste-categories" value="${val(dossier.categorie)}" ${dis}>
              <datalist id="liste-categories">${CATEGORIES_PERSONNEL.map((c) => `<option value="${c}">`).join("")}</datalist></div>
            <div class="ligne-champs"><div class="champ"><label>Grade</label><input class="saisie" id="do-grade" list="liste-grades" value="${val(dossier.grade)}" ${dis}>
              <datalist id="liste-grades">${GRADES_BH.map((g) => `<option value="${g}">`).join("")}</datalist></div>
              <div class="champ"><label>Échelon</label><input class="saisie" id="do-echelon" value="${val(dossier.echelon)}" ${dis}></div></div>
          </div>
          <div class="sirh-section"><h4>Informations personnelles</h4>
            <div class="champ"><label>Date de naissance</label><input class="saisie" type="date" id="do-naissance" value="${val(dossier.date_naissance)}" ${dis}>
              ${dossier.date_retraite ? `<span class="aide">Retraite (60 ans) : ${fmtDateLongue(dossier.date_retraite)}</span>` : ""}</div>
            <div class="champ"><label>Diplômes</label><textarea class="saisie" id="do-diplomes" style="min-height:62px" ${dis}>${val(dossier.diplomes)}</textarea></div>
            <div class="champ"><label>Personne à prévenir</label><input class="saisie" id="do-contact" placeholder="Nom" value="${val(dossier.contact_nom)}" ${dis}></div>
            <div class="ligne-champs"><div class="champ"><input class="saisie" id="do-lien" placeholder="Lien (conjoint, parent…)" value="${val(dossier.contact_lien)}" ${dis}></div>
              <div class="champ"><input class="saisie" id="do-tel" placeholder="Téléphone" value="${val(dossier.contact_telephone)}" ${dis}></div></div>
          </div>
          <div class="sirh-section"><h4>Santé au travail</h4>
            <div class="ligne-champs"><div class="champ"><label>Dernière visite médicale</label><input class="saisie" type="date" id="do-visite" value="${val(dossier.visite_medicale_le)}" ${dis}></div>
              <div class="champ"><label>Périodicité (mois)</label><input class="saisie" type="number" min="1" max="60" id="do-periodicite" value="${dossier.visite_periodicite_mois || 12}" ${dis}></div></div>
            ${dossier.prochaine_visite ? `<span class="badge ${dossier.prochaine_visite < iso(AUJOURDHUI) ? "rejetee" : "info"}" style="align-self:flex-start">${ico("calendrier")} Prochaine visite : ${fmtDate(dossier.prochaine_visite)}</span>` : ""}
            <div class="champ"><label>Aptitude médicale</label><input class="saisie" id="do-aptitude" list="liste-aptitudes" value="${val(dossier.aptitude_medicale)}" ${dis}>
              <datalist id="liste-aptitudes"><option value="Apte"><option value="Apte avec réserves"><option value="Inapte temporaire"><option value="Inapte"></datalist></div>
            <div class="champ"><label>Restrictions et aménagements</label><textarea class="saisie" id="do-observations" style="min-height:56px" ${dis}>${val(dossier.observations_medicales)}</textarea>
              <span class="aide">${ico("bouclier")} Données de santé chiffrées en base, visibles uniquement par la RH et l'intéressé.</span></div>
          </div>
        </div>
        <div class="sirh-section"><h4>Historique de carrière</h4>
          ${carriere.length ? `<div class="tableau-boite"><table style="min-width:600px"><thead><tr><th>Date</th><th>Événement</th><th>Avant</th><th>Après</th><th>Référence</th>${edition ? "<th></th>" : ""}</tr></thead><tbody>
            ${carriere.map((x) => `<tr><td class="mono">${fmtDate(x.date_effet)}</td><td><strong>${echapper(x.libelle)}</strong>${x.commentaire ? `<div style="font-size:11.5px;color:var(--encre-3)">${echapper(x.commentaire)}</div>` : ""}</td>
              <td>${echapper(x.avant || "—")}</td><td>${echapper(x.apres || "—")}</td><td style="font-size:12px">${echapper(x.reference || "")}</td>
              ${edition ? `<td><button class="btn icone fantome petit" data-suppr-carriere="${x.id}" title="Supprimer">${ico("poubelle")}</button></td>` : ""}</tr>`).join("")}
          </tbody></table></div>` : `<p style="font-size:12.5px;color:var(--encre-3)">Aucun événement enregistré.</p>`}
          ${edition ? `<div class="ligne-champs" style="align-items:flex-end;flex-wrap:wrap">
            <div class="champ"><label>Événement</label><select class="saisie" id="ca-type">${Object.entries(TYPES_CARRIERE).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
            <div class="champ"><label>Date d'effet</label><input class="saisie" type="date" id="ca-date" value="${iso(AUJOURDHUI)}"></div>
            <div class="champ"><label>Avant</label><input class="saisie" id="ca-avant"></div>
            <div class="champ"><label>Après</label><input class="saisie" id="ca-apres"></div>
            <div class="champ"><label>Référence</label><input class="saisie" id="ca-ref" placeholder="Décision n°…"></div>
            <button class="btn" id="ca-ajouter">${ico("plus")} Ajouter</button></div>` : ""}
        </div>
      </div>
      ${edition ? `<div class="tiroir-pied"><button class="btn" id="do-fermer">Fermer</button><button class="btn primaire" id="do-enregistrer">${ico("check")} Enregistrer le dossier</button></div>` : ""}
    </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  if (!edition) return;
  $("#do-fermer").addEventListener("click", fermerCouche);
  $("#do-enregistrer").addEventListener("click", async () => {
    const v = (id) => $(`#${id}`).value.trim() || null;
    try {
      await sirhAppel(`/dossier/${matricule}`, { methode: "PUT", corps: {
        date_entree: v("do-entree"), date_naissance: v("do-naissance"), categorie: v("do-categorie"), grade: v("do-grade"),
        echelon: v("do-echelon"), type_contrat: v("do-contrat"), date_fin_contrat: v("do-fin-contrat"), date_fin_essai: v("do-fin-essai"),
        diplomes: v("do-diplomes"), contact_nom: v("do-contact"), contact_lien: v("do-lien"), contact_telephone: v("do-tel"),
        visite_medicale_le: v("do-visite"), visite_periodicite_mois: Number($("#do-periodicite").value) || 12,
        aptitude_medicale: v("do-aptitude"), observations_medicales: v("do-observations") } });
      e.entree = v("do-entree");
      toast("Dossier enregistré", nomComplet(e), "succes");
      etat.alertesRH = null;
      fermerCouche();
    } catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
  });
  $("#ca-ajouter").addEventListener("click", async () => {
    try {
      await sirhAppel(`/carriere/${matricule}`, { methode: "POST", corps: { type_evenement: $("#ca-type").value, date_effet: $("#ca-date").value,
        avant: $("#ca-avant").value.trim() || null, apres: $("#ca-apres").value.trim() || null, reference: $("#ca-ref").value.trim() || null } });
      ouvrirDossier(matricule);
    } catch (souci) { toast("Ajout refusé", souci.message, "danger"); }
  });
  $$("[data-suppr-carriere]").forEach((b) => b.addEventListener("click", async () => {
    await sirhAppel(`/carriere/evenement/${b.dataset.supprCarriere}`, { methode: "DELETE" });
    ouvrirDossier(matricule);
  }));
}

/* --- 3. Onglets d'administration : alertes, report, documents -------------- */
const TYPES_ALERTES = { fin_essai: ["attente", "Fin de période d'essai"], fin_contrat: ["attente", "Fin de contrat"],
  retraite: ["violet", "Départ à la retraite"], visite_medicale: ["info", "Visite médicale"], anciennete: ["approuvee", "Ancienneté"] };

function adminAlertes() {
  if (!connecte()) return reserveServeur("Le suivi des alertes RH");
  const liste = chargerEtat("alertesRH", () => sirhAppel("/alertes"));
  if (!liste) return squelette();
  if (!liste.length) return etatVide("check", "Aucune alerte", "Aucune échéance dans les semaines à venir. Les alertes s'appuient sur les dossiers des collaborateurs (icône dossier dans « Employés »).");
  return `<div class="inbox">${liste.map((a) => {
    const [cls, libelle] = TYPES_ALERTES[a.type];
    return `<article class="inbox-item"><div class="kpi-ico" style="background:var(--alerte-doux);color:var(--alerte)">${ico(a.type === "anciennete" ? "etoile" : "alerte")}</div>
      <div class="inbox-corps"><div class="titre">${echapper(a.employe.prenom + " " + a.employe.nom)} <span class="badge ${cls}">${libelle}</span></div>
        <div class="detail">${echapper(a.message)}</div>
        <div class="meta"><span>Échéance : ${fmtDateLongue(a.echeance)}</span><span>${a.jours < 0 ? `dépassée de ${-a.jours} j` : a.jours === 0 ? "aujourd'hui" : `dans ${a.jours} j`}</span></div></div>
      <div class="inbox-actions"><button class="btn petit" data-dossier="${echapper(a.employe.matricule)}">${ico("doc")} Dossier</button></div></article>`;
  }).join("")}</div>`;
}

function adminReport() {
  if (!connecte()) return reserveServeur("Le report des congés");
  const r = chargerEtat("reportRH", () => sirhAppel("/report"));
  if (!r) return squelette();
  const perdu = r.lignes.reduce((s, l) => s + l.perdu_prevu, 0);
  return `<div class="bandeau-info" style="margin-bottom:12px">${ico("calendrier")}<span>Au <strong>31 décembre ${r.annee}</strong>, le solde reporté sur ${r.annee + 1}
      est plafonné à <strong>${fmtNombre(r.plafond)} jours</strong>. Au-delà, les jours sont perdus, sauf <strong>accord de la RH</strong>.
      Les collaborateurs concernés sont prévenus automatiquement le 1er et le 15 décembre ; la clôture est automatique le 1er janvier.</span></div>
    <div class="barre-filtres" style="justify-content:space-between;margin-bottom:12px">
      <span><strong>${r.lignes.length}</strong> collaborateur(s) au-delà du plafond · <strong>${fmtNombre(perdu)} jour(s)</strong> perdus à ce jour sans accord
        ${r.cloture_precedente.nombre ? ` · clôture ${r.cloture_precedente.annee} : ${fmtNombre(r.cloture_precedente.reporte)} j reportés, ${fmtNombre(r.cloture_precedente.perdu)} j perdus` : ""}</span>
      <button class="btn petit primaire" id="report-notifier">${ico("cloche")} Prévenir les collaborateurs maintenant</button>
    </div>
    ${r.lignes.length ? `<div class="tableau-boite"><table style="min-width:820px"><thead><tr><th>Collaborateur</th><th class="centre">Solde</th><th class="centre">Excédent</th>
      <th>Accord RH</th><th class="centre">Reporté</th><th class="centre">Perdu</th><th class="droite">Action</th></tr></thead><tbody>
      ${r.lignes.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong><div class="mono" style="font-size:11.5px;color:var(--encre-3)">${echapper(l.employe.matricule)}</div></td>
        <td class="centre num">${fmtNombre(l.solde)} j</td><td class="centre num" style="color:var(--alerte)">+${fmtNombre(l.excedent)} j</td>
        <td style="font-size:12.5px">${l.accord ? `<span class="badge approuvee">${fmtNombre(l.accord.jours)} j accordé(s)</span> ${echapper(l.accord.motif || "")}` : "—"}</td>
        <td class="centre num"><strong>${fmtNombre(l.reporte_prevu)} j</strong></td><td class="centre num" style="color:${l.perdu_prevu ? "var(--danger)" : "var(--encre-3)"}">${fmtNombre(l.perdu_prevu)} j</td>
        <td class="droite" style="white-space:nowrap"><button class="btn petit" data-accord="${echapper(l.employe.matricule)}" data-excedent="${l.excedent}">${ico("check")} ${l.accord ? "Modifier" : "Accorder"}</button>
          ${l.accord ? `<button class="btn petit fantome" data-retirer-accord="${echapper(l.employe.matricule)}">${ico("croix")}</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : etatVide("check", "Aucun dépassement", `Aucun solde ne dépasse ${fmtNombre(r.plafond)} jours.`)}`;
}

const STATUTS_DOCS = { demandee: ["attente", "Demandée"], en_cours: ["info", "En cours"], prete: ["approuvee", "Prête"], refusee: ["rejetee", "Refusée"] };
function adminDocuments() {
  if (!connecte()) return reserveServeur("Le suivi des demandes de documents");
  const liste = chargerEtat("documentsRH", () => sirhAppel("/documents"));
  if (!liste) return squelette();
  if (!liste.length) return etatVide("doc", "Aucune demande", "Les demandes d'attestations et de certificats des collaborateurs apparaîtront ici.");
  return `<div class="tableau-boite"><table style="min-width:820px"><thead><tr><th>Collaborateur</th><th>Document</th><th>Motif</th><th>Demandé le</th><th>Statut</th><th class="droite">Actions</th></tr></thead><tbody>
    ${liste.map((d) => { const [c, l] = STATUTS_DOCS[d.statut]; return `<tr>
      <td><strong style="font-size:13px">${echapper(d.employe.prenom + " " + d.employe.nom)}</strong></td><td>${echapper(d.libelle)}</td>
      <td style="font-size:12.5px">${echapper(d.motif || "—")}</td><td class="mono">${fmtDate(String(d.cree_le).slice(0, 10))}</td>
      <td><span class="badge ${c}">${l}</span>${d.fichier ? ` <a href="${lienFichier(d.fichier)}" target="_blank" rel="noopener">${ico("doc")}</a>` : ""}</td>
      <td class="droite" style="white-space:nowrap">${d.statut === "prete" || d.statut === "refusee" ? "" : `
        <button class="btn petit fantome" data-doc-statut="en_cours" data-doc-id="${d.id}">En cours</button>
        <label class="btn petit" style="cursor:pointer">${ico("import")} Déposer le PDF<input type="file" accept=".pdf,.doc,.docx" data-doc-fichier="${d.id}" hidden></label>
        <button class="btn petit fantome" data-doc-statut="prete" data-doc-id="${d.id}" title="Document à retirer à la RH">Prête</button>
        <button class="btn petit fantome" data-doc-statut="refusee" data-doc-id="${d.id}" style="color:var(--danger)">Refuser</button>`}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}

/* Administration : trois onglets de plus, et l'icône dossier sur chaque ligne */
VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  const onglets = [["employes", "Employés"], ["affectations", "Affectations"], ["alertes", "Alertes RH"], ["report", "Report des congés"],
    ["documents", "Documents demandés"], ["suivi", "Suivi des fiches"], ["sorties", "Sorties"], ["departements", "Départements"],
    ["synthese", "Synthèse"], ["organigramme", "Organigramme"], ["journal", "Journal d'audit"], ["import", "Import & exports"]];
  const vues = { employes: () => adminEmployes(f), affectations: () => adminAffectations(f), suivi: () => adminSuivi(f), sorties: () => adminSorties(f),
    alertes: adminAlertes, report: adminReport, documents: adminDocuments,
    departements: adminDepartements, synthese: adminSynthese, organigramme: adminOrganigramme, journal: adminJournal, import: adminImport };
  const corps = (vues[f.onglet] || vues.employes)();
  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div class="segment" id="onglets-admin" style="flex-wrap:wrap">
        ${onglets.map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("")}
      </div>
    </div>
    ${corps}
  </section>`;
};
/* Icône « dossier » sur chaque ligne du tableau des employés */
const adminEmployesAvantDossier = adminEmployes;
adminEmployes = function (f) {
  return adminEmployesAvantDossier(f).replace(/(<button class="btn petit icone fantome" data-editer="([^"]+)" title="Modifier">)/g,
    `<button class="btn petit icone fantome" data-dossier="$2" title="Dossier du collaborateur">${ico("doc")}</button>$1`);
};
const brancherAdminAvantSirh = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  brancherAdminAvantSirh();
  $$("#onglets-admin button").forEach((b) => b.addEventListener("click", () => { etat.alertesRH = etat.reportRH = etat.documentsRH = null; }));
  $$("[data-dossier]").forEach((b) => b.addEventListener("click", () => ouvrirDossier(b.dataset.dossier)));
  const notifier = $("#report-notifier");
  if (notifier) notifier.addEventListener("click", async () => {
    const r = await sirhAppel("/report/notifier", { methode: "POST" });
    toast("Collaborateurs prévenus", `${r.notifies} collaborateur(s) notifié(s) du risque de perte.`, "succes");
  });
  $$("[data-accord]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.accord;
    ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><div><h2>Accord de report</h2>
        <div class="sous">${echapper(nomComplet(parMatricule[m] || { prenom: m, nom: "" }))} · excédent de ${fmtNombre(Number(b.dataset.excedent))} j au-delà de ${fmtNombre(REGLES.plafondReport)} j</div></div></div>
      <div class="modale-corps"><div class="champ"><label for="ac-jours">Jours reportés au-delà du plafond</label>
        <input class="saisie" type="number" step="0.5" min="0.5" id="ac-jours" value="${b.dataset.excedent}"></div>
        <div class="champ"><label for="ac-motif">Motif de l'accord</label><textarea class="saisie" id="ac-motif" placeholder="Nécessités de service, congé refusé pour raison de service…"></textarea></div></div>
      <div class="modale-pied"><button class="btn" id="ac-annuler">Annuler</button><button class="btn primaire" id="ac-ok">${ico("check")} Accorder</button></div></div>`);
    $("#ac-annuler").addEventListener("click", fermerCouche);
    $("#ac-ok").addEventListener("click", async () => {
      try {
        etat.reportRH = await sirhAppel("/report/accord", { methode: "POST", corps: { matricule: m, annee: ANNEE, jours: Number($("#ac-jours").value), motif: $("#ac-motif").value.trim() || null } });
        fermerCouche(); toast("Report accordé", "Le collaborateur est notifié.", "succes"); rendre(false);
      } catch (souci) { toast("Accord refusé", souci.message, "danger"); }
    });
  }));
  $$("[data-retirer-accord]").forEach((b) => b.addEventListener("click", async () => {
    etat.reportRH = await sirhAppel(`/report/accord/${b.dataset.retirerAccord}/${ANNEE}`, { methode: "DELETE" });
    rendre(false);
  }));
  $$("[data-doc-statut]").forEach((b) => b.addEventListener("click", async () => {
    let commentaire = null;
    if (b.dataset.docStatut === "refusee") commentaire = prompt("Motif du refus ?") || null;
    await sirhAppel(`/documents/${b.dataset.docId}/traiter`, { methode: "POST", corps: { statut: b.dataset.docStatut, commentaire } });
    etat.documentsRH = null; toast("Demande mise à jour", "Le collaborateur est notifié.", "succes"); rendre(false);
  }));
  $$("[data-doc-fichier]").forEach((champ) => champ.addEventListener("change", async () => {
    if (!champ.files[0]) return;
    try { await televerser(`/api/sirh/documents/${champ.dataset.docFichier}/fichier`, champ.files[0]); etat.documentsRH = null; toast("Document déposé", "Le collaborateur peut le télécharger.", "succes"); rendre(false); }
    catch (souci) { toast("Dépôt refusé", souci.message, "danger"); }
  }));
  const zoneImport = $("#lancer-import");
  if (zoneImport && !$("#export-paie") && connecte()) {
    const mois = iso(new Date(AUJOURDHUI.getFullYear(), AUJOURDHUI.getMonth() - (AUJOURDHUI.getDate() < 10 ? 1 : 0), 1)).slice(0, 7);
    zoneImport.closest(".grille").insertAdjacentHTML("beforeend", `
      <article class="carte" style="box-shadow:none"><div class="carte-entete"><div class="kpi-ico" style="background:var(--violet-doux);color:var(--violet)">${ico("portefeuille")}</div><h3>Préparation de la paie</h3></div>
        <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Éléments variables du mois pour le logiciel de paie : congés par type, sans solde, missions, autorisations, heures, heures supplémentaires, retards, absences injustifiées, frais remboursés.</p>
        <div style="display:flex;gap:8px"><input class="saisie" type="month" id="paie-mois" value="${mois}" style="max-width:170px"><button class="btn primaire" id="export-paie">${ico("telecharger")} Export paie (Excel)</button></div></article>
      ${estGestionnaire() ? "" : `<article class="carte" style="box-shadow:none"><div class="carte-entete"><div class="kpi-ico" style="background:var(--succes-doux);color:var(--succes)">${ico("bouclier")}</div><h3>Audit et sauvegardes</h3></div>
        <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Sauvegarde automatique quotidienne de la base (30 jours conservés, dossier backend\\data\\sauvegardes, synchronisé par OneDrive).</p>
        <div style="display:flex;flex-direction:column;gap:8px"><button class="btn btn-bloc" id="export-audit">${ico("telecharger")} Journal d'audit — Excel</button>
          <button class="btn btn-bloc" id="sauvegarde-maintenant">${ico("bouclier")} Sauvegarder maintenant</button><div id="liste-sauvegardes" style="font-size:12px;color:var(--encre-3)"></div></div></article>`}`);
    $("#export-paie").addEventListener("click", () => telechargerFichier(`/api/sirh/paie.xlsx?mois=${$("#paie-mois").value}`, `paie-${$("#paie-mois").value}.xlsx`, "Export paie"));
    if (!estGestionnaire()) {
    $("#export-audit").addEventListener("click", () => telechargerFichier("/api/sirh/audit.xlsx", "journal-audit.xlsx", "Journal d'audit"));
    const afficher = (r) => { $("#liste-sauvegardes").innerHTML = r.fichiers.length ? `Dernière : <strong>${r.fichiers[0].nom}</strong> (${r.fichiers[0].taille_ko} Ko) · ${r.fichiers.length} conservée(s)` : "Aucune sauvegarde pour l'instant."; };
    sirhAppel("/sauvegardes").then(afficher).catch(() => {});
    $("#sauvegarde-maintenant").addEventListener("click", async () => { afficher(await sirhAppel("/sauvegardes", { methode: "POST" })); toast("Sauvegarde effectuée", "Copie de la base enregistrée.", "succes"); });
    }
  }
};

/* --- 4. Parcours d'arrivée et de départ (RH et managers) --------------------- */
VUES["/parcours"] = function () {
  if (!connecte()) return reserveServeur("Le suivi des arrivées et départs");
  const liste = chargerEtat("parcoursListe", () => sirhAppel("/parcours"));
  if (!liste) return squelette(260);
  const entete = `<section class="carte" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><h2>Arrivées et départs</h2><p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Listes de tâches RH, DSI et manager, ouvertes automatiquement à la création ou à la suppression d'un profil.</p></div>
    ${estAdmin() ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="saisie" id="pa-matricule" list="liste-employes-parcours" placeholder="Matricule ou nom" style="min-width:200px">
      <datalist id="liste-employes-parcours">${EMPLOYES.map((e) => `<option value="${e.matricule}">${echapper(nomComplet(e))}</option>`).join("")}</datalist>
      <select class="saisie" id="pa-type"><option value="arrivee">Arrivée</option><option value="depart">Départ</option></select>
      <button class="btn primaire" id="pa-ouvrir">${ico("plus")} Ouvrir un parcours</button></div>` : ""}</section>`;
  if (!liste.length) return entete + `<section class="carte">${etatVide("check", "Aucun parcours en cours", "Les arrivées et départs de votre périmètre apparaîtront ici.")}</section>`;
  return entete + `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr))">${liste.map((p) => `
    <article class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:8px">
      <div><h3>${echapper(p.employe.prenom + " " + p.employe.nom)}</h3><span class="carte-sous">${p.type === "arrivee" ? "Arrivée" : "Départ"} le ${fmtDateLongue(p.date_reference)} · ${echapper(p.employe.poste || "")}</span></div>
      <div style="display:flex;align-items:center;gap:6px"><span class="badge ${p.type === "arrivee" ? "approuvee" : "attente"}">${p.avancement} %</span>
        ${estAdmin() ? `<button class="btn petit fantome" data-suppr-parcours="${p.id}" data-libelle="${p.type === "arrivee" ? "d'arrivée" : "de départ"} de ${echapper(p.employe.prenom + " " + p.employe.nom)}" title="Supprimer ce parcours" style="color:var(--danger)">${ico("poubelle")} Supprimer</button>` : ""}</div></div>
      <div class="jauge" style="margin-bottom:8px"><span style="width:${p.avancement}%"></span></div>
      ${p.taches.map((t) => `<label class="tache ${t.fait_le ? "faite" : ""}"><input type="checkbox" data-tache="${t.id}" ${t.fait_le ? "checked" : ""}>
        <div style="flex:1"><div class="libelle" style="font-size:13px">${echapper(t.libelle)}</div>
        <div style="font-size:11.5px;color:var(--encre-3)"><span class="badge neutre" style="padding:0 6px">${t.responsable}</span> ${t.echeance ? `échéance ${fmtDate(t.echeance)}` : ""}${t.fait_par ? ` · fait par ${echapper(t.fait_par)}` : ""}</div></div></label>`).join("")}
    </article>`).join("")}</div>`;
};
BRANCHEMENTS["/parcours"] = function () {
  $$("[data-tache]").forEach((c) => c.addEventListener("change", async () => {
    try { await sirhAppel(`/parcours/taches/${c.dataset.tache}`, { methode: "POST", corps: { fait: c.checked } }); etat.parcoursListe = null; rendre(false); }
    catch (souci) { c.checked = !c.checked; toast("Action refusée", souci.message, "danger"); }
  }));
  const ouvrir = $("#pa-ouvrir");
  $$("[data-suppr-parcours]").forEach((b) => b.addEventListener("click", () => {
    ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><div><h2>Supprimer le parcours</h2>
        <div class="sous">Parcours ${b.dataset.libelle}</div></div></div>
      <div class="modale-corps"><p style="font-size:13px;color:var(--encre-2)">Le parcours et toutes ses tâches (cochées ou non) seront supprimés. Le profil du collaborateur n'est pas touché. L'opération est inscrite au journal d'audit.</p></div>
      <div class="modale-pied"><button class="btn" id="sp-annuler">Annuler</button><button class="btn danger" id="sp-ok" style="background:var(--danger);color:#fff">${ico("poubelle")} Supprimer</button></div></div>`);
    $("#sp-annuler").addEventListener("click", fermerCouche);
    $("#sp-ok").addEventListener("click", async () => {
      try {
        await sirhAppel(`/parcours/${b.dataset.supprParcours}`, { methode: "DELETE" });
        fermerCouche(); etat.parcoursListe = null;
        toast("Parcours supprimé", `Parcours ${b.dataset.libelle} retiré.`, "succes"); rendre(false);
      } catch (souci) { toast("Suppression refusée", souci.message, "danger"); }
    });
  }));
  if (ouvrir) ouvrir.addEventListener("click", async () => {
    const m = $("#pa-matricule").value.trim().toUpperCase();
    if (!parMatricule[m]) return toast("Collaborateur inconnu", "Choisissez un matricule dans la liste.", "danger");
    try { await sirhAppel("/parcours", { methode: "POST", corps: { matricule: m, type_parcours: $("#pa-type").value } }); etat.parcoursListe = null; rendre(false); }
    catch (souci) { toast("Ouverture refusée", souci.message, "danger"); }
  });
};

/* --- 5. Bilan social (tableau de bord de direction) --------------------------- */
VUES["/bilan-social"] = function () {
  if (!connecte()) return reserveServeur("Le bilan social");
  const b = chargerEtat("bilanRH", () => sirhAppel("/bilan"));
  if (!b) return squelette(320);
  const kpi = (cle, libelle, valeur, unite, icone, couleur, fond, detail) => carteKpi({ cle, libelle, valeur, unite, icone, couleur, fond, detail });
  return `<section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      ${kpi("bs1", "Effectif", b.effectif, "", "users", "var(--marine)", "var(--marine-doux)", `${b.entrees} entrée(s) · ${b.sorties} sortie(s) en ${b.annee}`)}
      ${kpi("bs2", "Taux d'absentéisme", fmtNombre(b.absenteisme, 2), "%", "horloge", "var(--alerte)", "var(--alerte-doux)", `${fmtNombre(b.jours_absence)} j (maladie, sans solde, absences injustifiées)`)}
      ${kpi("bs3", "Taux de rotation", fmtNombre(b.rotation, 2), "%", "fleche", "var(--violet)", "var(--violet-doux)", "(entrées + sorties) / 2 ÷ effectif moyen")}
      ${kpi("bs4", "Formation", fmtNombre(b.heures_formation_par_personne), "h / pers.", "diplome", "var(--succes)", "var(--succes-doux)", `${b.heures_formation} h au total`)}
      ${kpi("bs5", "Congés non pris", fmtNombre(b.conges_non_pris, 0), "j", "calendrier", "var(--danger)", "var(--danger-doux)", `${b.conges_au_dela_plafond} solde(s) au-delà de ${fmtNombre(REGLES.plafondReport)} j — passif social`)}
      ${kpi("bs6", "Ancienneté moyenne", b.anciennete_moyenne == null ? "—" : fmtNombre(b.anciennete_moyenne), "ans", "etoile", "var(--info)", "var(--info-doux)", `${b.dossiers_incomplets} dossier(s) à compléter`)}
    </section>
    ${b.dossiers_incomplets ? `<div class="bandeau-info alerte">${ico("alerte")}<span>${b.dossiers_incomplets} dossier(s) incomplet(s) (date de naissance, catégorie ou date d'embauche) : la pyramide des âges et les indicateurs par catégorie en dépendent. Complétez-les dans Administration → Employés → icône dossier.</span></div>` : ""}
    <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <article class="carte"><div class="carte-entete"><h3>Effectif par direction</h3></div><div class="boite-graph" style="height:260px"><canvas id="g-bs-direction"></canvas></div></article>
      <article class="carte"><div class="carte-entete"><h3>Pyramide des âges</h3></div><div class="boite-graph" style="height:260px"><canvas id="g-bs-ages"></canvas></div></article>
      <article class="carte"><div class="carte-entete"><h3>Effectif par catégorie</h3></div><div class="boite-graph" style="height:260px"><canvas id="g-bs-categories"></canvas></div></article>
      <article class="carte"><div class="carte-entete"><h3>Sorties par motif — ${b.annee}</h3></div>
        ${Object.keys(b.motifs_sortie).length ? `<div class="tableau-boite"><table style="min-width:auto"><tbody>${Object.entries(b.motifs_sortie).map(([m, n]) => `<tr><td>${echapper(MOTIFS_SORTIE[m] || m)}</td><td class="droite num"><strong>${n}</strong></td></tr>`).join("")}</tbody></table></div>`
          : etatVide("users", "Aucune sortie", "Aucune sortie des effectifs cette année.")}</article>
    </section>`;
};
BRANCHEMENTS["/bilan-social"] = function () {
  const b = etat.bilanRH;
  if (!b || b.erreur || !$("#g-bs-direction")) return;
  const h = habillage();
  const barres = (id, donnees, couleur, horizontal = false) => etat.graphiques.push(new Chart($(id), {
    type: "bar", data: { labels: Object.keys(donnees), datasets: [{ data: Object.values(donnees), backgroundColor: couleur, borderRadius: 6 }] },
    options: { indexAxis: horizontal ? "y" : "x", maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: h.encre3 } }, y: { grid: { color: h.trait }, ticks: { color: h.encre3, precision: 0 } } } } }));
  barres("#g-bs-direction", b.par_direction, h.marine, true);
  barres("#g-bs-ages", b.pyramide, h.succes, true);
  etat.graphiques.push(new Chart($("#g-bs-categories"), { type: "doughnut", data: { labels: Object.keys(b.par_categorie),
    datasets: [{ data: Object.values(b.par_categorie), backgroundColor: [h.marine, h.succes, h.alerte, h.violet, h.info, h.encre3], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: h.encre } } } } }));
};

/* --- 6. Sondages et baromètre social ------------------------------------------- */
VUES["/sondages"] = function () {
  if (!connecte()) return reserveServeur("Les sondages");
  const liste = chargerEtat("sondagesListe", () => sirhAppel("/sondages"));
  if (!liste) return squelette(260);
  const creation = estAdmin() ? `<section class="carte"><div class="carte-entete"><h3>Nouveau sondage</h3><span class="carte-sous">Envoyé à tout le personnel par notification</span></div>
    <div class="ligne-champs"><div class="champ"><label>Titre</label><input class="saisie" id="so-titre" placeholder="Baromètre social ${ANNEE}"></div>
      <div class="champ" style="max-width:170px"><label>Clôture</label><input class="saisie" type="date" id="so-fin"></div></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:6px 0"><input type="checkbox" id="so-anonyme" checked style="width:16px;height:16px;accent-color:var(--marine)"> Réponses anonymes</label>
    <div class="champ"><label>Questions (une par ligne) — préfixe <span class="mono">note:</span> (1 à 5), <span class="mono">choix:</span> (options après « | »), ou texte libre</label>
      <textarea class="saisie mono" id="so-questions" style="min-height:110px" placeholder="note: Êtes-vous satisfait de vos conditions de travail ?&#10;choix: Votre charge de travail | Faible | Correcte | Élevée&#10;Quelles améliorations proposez-vous ?"></textarea></div>
    <button class="btn primaire" id="so-creer" style="margin-top:10px">${ico("fleche")} Publier le sondage</button></section>` : "";
  const cartes = liste.map((s) => `<article class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:8px"><div><h3>${echapper(s.titre)}</h3>
      <span class="carte-sous">${s.anonyme ? "Anonyme" : "Nominatif"} · ${s.participants} réponse(s) (${s.taux} %)${s.date_fin ? ` · jusqu'au ${fmtDate(s.date_fin)}` : ""}</span></div>
      ${s.a_repondu ? `<span class="badge approuvee">${ico("check")} Répondu</span>` : s.ouvert ? `<span class="badge info">Ouvert</span>` : `<span class="badge annulee">Clos</span>`}</div>
    ${!s.a_repondu && s.ouvert ? `<div style="display:flex;flex-direction:column;gap:12px" data-sondage="${s.id}">${s.questions.map((q, i) => `<div class="champ"><label>${i + 1}. ${echapper(q.texte)}</label>
      ${q.type === "note" ? `<div class="etoiles" data-q="${i}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-note="${n}">★</button>`).join("")}</div>`
      : q.type === "choix" ? `<select class="saisie" data-q="${i}"><option value=""></option>${(q.choix || []).map((c) => `<option>${echapper(c)}</option>`).join("")}</select>`
      : `<textarea class="saisie" data-q="${i}" style="min-height:60px"></textarea>`}</div>`).join("")}
      <button class="btn primaire" data-envoyer-sondage="${s.id}" style="align-self:flex-start">${ico("check")} Envoyer mes réponses</button></div>` : ""}
    ${estAdmin() ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn petit" data-resultats="${s.id}">${ico("rapport")} Résultats</button>
      ${s.ouvert ? `<button class="btn petit fantome" data-clore="${s.id}">Clore</button>` : ""}</div><div id="resultats-${s.id}"></div>` : ""}
  </article>`).join("");
  return creation + (cartes || `<section class="carte">${etatVide("rapport", "Aucun sondage", "Les sondages et baromètres de la RH apparaîtront ici.")}</section>`);
};
BRANCHEMENTS["/sondages"] = function () {
  $$(".etoiles").forEach((z) => z.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    z.dataset.valeur = b.dataset.note;
    z.querySelectorAll("button").forEach((x) => x.classList.toggle("actif", Number(x.dataset.note) <= Number(b.dataset.note)));
  })));
  $$("[data-envoyer-sondage]").forEach((b) => b.addEventListener("click", async () => {
    const zone = $(`[data-sondage="${b.dataset.envoyerSondage}"]`);
    const reponses = $$("[data-q]", zone).map((el) => el.classList.contains("etoiles") ? Number(el.dataset.valeur || 0) || null : el.value.trim());
    if (reponses.some((r, i) => r === null && $$("[data-q]", zone)[i].classList.contains("etoiles"))) return toast("Réponse manquante", "Donnez une note à chaque question notée.", "danger");
    try { await sirhAppel(`/sondages/${b.dataset.envoyerSondage}/reponse`, { methode: "POST", corps: { reponses } }); etat.sondagesListe = null; toast("Merci !", "Vos réponses sont enregistrées.", "succes"); rendre(false); }
    catch (souci) { toast("Envoi refusé", souci.message, "danger"); }
  }));
  const creer = $("#so-creer");
  if (creer) creer.addEventListener("click", async () => {
    const questions = $("#so-questions").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      if (/^note\s*:/i.test(l)) return { texte: l.replace(/^note\s*:/i, "").trim(), type: "note" };
      if (/^choix\s*:/i.test(l)) { const [texte, ...choix] = l.replace(/^choix\s*:/i, "").split("|").map((x) => x.trim()); return { texte, type: "choix", choix }; }
      return { texte: l, type: "texte" };
    });
    if (!$("#so-titre").value.trim() || !questions.length) return toast("Sondage incomplet", "Indiquez un titre et au moins une question.", "danger");
    try { await sirhAppel("/sondages", { methode: "POST", corps: { titre: $("#so-titre").value.trim(), anonyme: $("#so-anonyme").checked, date_fin: $("#so-fin").value || null, questions } });
      etat.sondagesListe = null; toast("Sondage publié", "Tout le personnel est notifié.", "succes"); rendre(false); }
    catch (souci) { toast("Publication refusée", souci.message, "danger"); }
  });
  $$("[data-resultats]").forEach((b) => b.addEventListener("click", async () => {
    const r = await sirhAppel(`/sondages/${b.dataset.resultats}/resultats`);
    $(`#resultats-${b.dataset.resultats}`).innerHTML = `<div class="tableau-boite" style="margin-top:10px"><table style="min-width:auto"><tbody>${r.questions.map((q) => `<tr><td style="width:40%"><strong>${echapper(q.texte)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${q.reponses} réponse(s)</div></td>
      <td>${q.type === "note" ? `Moyenne <strong>${q.moyenne ?? "—"}</strong> / 5` : q.type === "choix" ? Object.entries(q.repartition).map(([c, n]) => `${echapper(c)} : <strong>${n}</strong>`).join(" · ")
        : (q.commentaires || []).map((t) => `« ${echapper(t)} »`).join("<br>") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }));
  $$("[data-clore]").forEach((b) => b.addEventListener("click", async () => { await sirhAppel(`/sondages/${b.dataset.clore}/cloturer`, { methode: "POST" }); etat.sondagesListe = null; rendre(false); }));
};

/* --- 7. Formations : plan annuel (RH) et évaluations à chaud / à froid ------ */
const vueFormationsAvantPlan = VUES["/formations"];
VUES["/formations"] = function () {
  const base = vueFormationsAvantPlan();
  if (!connecte()) return base;
  const aEvaluer = chargerEtat("formationsAEvaluer", () => sirhAppel("/mes-evaluations-formation")) || [];
  const evaluations = Array.isArray(aEvaluer) && aEvaluer.length ? `<section class="carte"><div class="carte-entete"><h3>Formations à évaluer</h3><span class="carte-sous">À chaud (participant) · à froid, deux mois après (manager)</span></div>
    ${aEvaluer.map((x) => `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 0;border-bottom:1px dashed var(--trait)">
      <div style="flex:1;min-width:220px"><strong style="font-size:13px">${echapper(x.titre)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${x.moment === "chaud" ? "Votre avis de participant" : `Efficacité pour ${echapper(x.participant)}`} · terminée le ${fmtDate(x.fin)}</div></div>
      <div class="etoiles" data-eval-formation="${x.formation_id}" data-moment="${x.moment}" data-matricule="${echapper(x.matricule)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-note="${n}">★</button>`).join("")}</div></div>`).join("")}</section>` : "";
  if (!estAdmin()) return evaluations + base;
  const plan = etat.planFormation;
  const outil = `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:8px"><h3>Plan de formation ${ANNEE}</h3>
      <button class="btn petit" id="plan-afficher">${ico(plan ? "haut" : "bas")} ${plan ? "Masquer" : "Afficher"} le plan</button></div>
    ${plan && !plan.erreur ? `<div class="sirh-grille" style="margin-bottom:12px">
        <div class="sirh-section"><h4>Budget</h4><div class="ligne-champs"><div class="champ"><label>Budget (DT)</label><input class="saisie" type="number" id="pl-budget" value="${plan.budget}"></div>
          <div class="champ"><label>Engagé</label><strong style="font-size:18px">${dinars(plan.engage)}</strong><span class="aide">Reste : ${dinars(plan.reste)}</span></div></div></div>
        <div class="sirh-section"><h4>Taxe de formation professionnelle</h4><div class="ligne-champs"><div class="champ"><label>Masse salariale annuelle (DT)</label><input class="saisie" type="number" id="pl-masse" value="${plan.masse_salariale}"></div>
          <div class="champ" style="max-width:110px"><label>Taux (%)</label><input class="saisie" type="number" step="0.1" id="pl-taux" value="${plan.taux_tfp}"></div></div>
          <span class="aide">TFP due : <strong>${dinars(plan.tfp_due)}</strong>. Les dépenses de formation agréées ouvrent droit à une avance ou un crédit sur la TFP (à rapprocher avec la comptabilité).</span></div>
        <div class="sirh-section"><h4>Souhaits des entretiens</h4>${Object.keys(plan.souhaits).length ? Object.entries(plan.souhaits).map(([t, n]) => `<div style="display:flex;justify-content:space-between;font-size:13px"><span>${echapper(t)}</span><strong>${n}</strong></div>`).join("") : `<span class="aide">Aucun souhait exprimé pour l'instant.</span>`}
          <span class="aide">${fmtNombre(plan.heures_par_personne)} h de formation par personne (${plan.heures_formation} h).</span></div></div>
      <button class="btn primaire petit" id="pl-enregistrer" style="margin-bottom:12px">${ico("check")} Enregistrer le budget</button>
      <div class="tableau-boite"><table style="min-width:820px"><thead><tr><th>Session</th><th>Organisme</th><th>Début</th><th class="centre">Inscrits</th><th class="droite">Coût (DT)</th><th class="centre">Coût / participant</th><th class="centre">À chaud</th><th class="centre">À froid</th></tr></thead><tbody>
        ${plan.sessions.map((s) => `<tr><td><strong style="font-size:13px">${echapper(s.titre)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${echapper(s.theme)}${s.active ? "" : " · retirée"}</div></td>
          <td style="font-size:12.5px">${echapper(s.organisme || "—")}</td><td class="mono">${fmtDate(s.debut)}</td><td class="centre num">${s.inscrits} / ${s.places}</td>
          <td class="droite"><input class="saisie num" type="number" min="0" step="0.001" data-cout="${s.id}" value="${s.cout}" style="width:120px;text-align:right"></td>
          <td class="centre num">${s.cout_par_participant == null ? "—" : dinars(s.cout_par_participant)}</td>
          <td class="centre">${s.evaluation_chaud == null ? "—" : `${fmtNombre(s.evaluation_chaud)} / 5`}</td><td class="centre">${s.evaluation_froid == null ? "—" : `${fmtNombre(s.evaluation_froid)} / 5`}</td></tr>`).join("")}
      </tbody></table></div>` : plan === undefined || plan === null ? "" : ""}
  </section>`;
  return evaluations + outil + base;
};
const brancherFormationsAvantPlan = BRANCHEMENTS["/formations"];
BRANCHEMENTS["/formations"] = function () {
  brancherFormationsAvantPlan();
  $$("[data-eval-formation]").forEach((z) => z.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    try { await sirhAppel(`/formations/${z.dataset.evalFormation}/evaluation`, { methode: "POST", corps: { moment: z.dataset.moment, note: Number(b.dataset.note), matricule: z.dataset.matricule } });
      etat.formationsAEvaluer = null; toast("Évaluation enregistrée", `${b.dataset.note} / 5 — merci.`, "succes"); rendre(false); }
    catch (souci) { toast("Évaluation refusée", souci.message, "danger"); }
  })));
  const afficher = $("#plan-afficher");
  if (afficher) afficher.addEventListener("click", async () => {
    if (etat.planFormation) { etat.planFormation = null; return rendre(false); }
    try { etat.planFormation = await sirhAppel(`/plan-formation?annee=${ANNEE}`); rendre(false); } catch (souci) { toast("Plan indisponible", souci.message, "danger"); }
  });
  const enregistrer = $("#pl-enregistrer");
  if (enregistrer) enregistrer.addEventListener("click", async () => {
    try { etat.planFormation = await sirhAppel("/plan-formation/budget", { methode: "PUT", corps: { annee: ANNEE, budget: Number($("#pl-budget").value) || 0,
      masse_salariale: Number($("#pl-masse").value) || 0, taux_tfp: Number($("#pl-taux").value) || 0 } }); toast("Budget enregistré", "", "succes"); rendre(false); }
    catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
  });
  $$("[data-cout]").forEach((c) => c.addEventListener("change", async () => {
    await sirhAppel(`/formations/${c.dataset.cout}/cout`, { methode: "PUT", corps: { cout: Number(c.value) || 0 } });
    etat.planFormation = await sirhAppel(`/plan-formation?annee=${ANNEE}`); rendre(false);
  }));
};

/* --- 8. Entretien annuel : développement, mobilité, prise de connaissance --- */
const MOBILITES = { "": "Non précisée", aucune: "Aucune mobilité souhaitée", interne: "Mobilité interne (même métier)",
  fonctionnelle: "Mobilité fonctionnelle (autre métier)", geographique: "Mobilité géographique" };
const corpsEvaluationAvantEntretien = corpsEvaluation;
corpsEvaluation = function (fiche) {
  const base = corpsEvaluationAvantEntretien(fiche);
  if (!connecte()) return base;
  const ev = fiche.evaluation, d = fiche.droits;
  const modifiable = (d.proprietaire || d.superieur) && !ev.finalisee_le;
  const souhaits = ev.formations_souhaitees || [];
  const themes = [...new Set([...THEMES_FORMATION, ...FORMATIONS.map((f) => f.titre)])];
  const developpement = `<section class="carte"><div class="carte-entete"><h3>Développement et mobilité</h3><span class="carte-sous">Alimente le plan de formation de la RH</span></div>
    ${modifiable ? `<div class="champ"><label>Formations souhaitées</label><div style="display:flex;flex-wrap:wrap;gap:6px">${themes.map((t) => `<label class="badge neutre" style="cursor:pointer;gap:5px"><input type="checkbox" data-souhait="${echapper(t)}" ${souhaits.includes(t) ? "checked" : ""}> ${echapper(t)}</label>`).join("")}</div></div>
      <div class="champ" style="margin-top:10px"><label>Plan de développement</label><textarea class="saisie" id="ev-plan" placeholder="Compétences à renforcer, accompagnement, objectifs d'évolution…">${echapper(ev.plan_developpement || "")}</textarea></div>
      <div class="ligne-champs" style="margin-top:10px"><div class="champ"><label>Mobilité souhaitée</label><select class="saisie" id="ev-mobilite">${Object.entries(MOBILITES).map(([k, l]) => `<option value="${k}" ${ev.mobilite_type === k || (!ev.mobilite_type && !k) ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="champ"><label>Précisions</label><input class="saisie" id="ev-mobilite-detail" value="${echapper(ev.mobilite_detail || "")}" placeholder="Poste, direction, région…"></div></div>
      <button class="btn primaire petit" id="ev-dev-enregistrer" style="margin-top:10px">${ico("check")} Enregistrer</button>`
    : `<p style="font-size:13px"><strong>Formations souhaitées :</strong> ${souhaits.length ? souhaits.map(echapper).join(", ") : "—"}</p>
      <p style="font-size:13px;margin-top:6px"><strong>Plan de développement :</strong> ${echapper(ev.plan_developpement || "—")}</p>
      <p style="font-size:13px;margin-top:6px"><strong>Mobilité :</strong> ${MOBILITES[ev.mobilite_type || ""]}${ev.mobilite_detail ? ` — ${echapper(ev.mobilite_detail)}` : ""}</p>`}
  </section>`;
  const signature = ev.finalisee_le ? `<section class="carte"><div class="carte-entete"><h3>Prise de connaissance</h3></div>
    ${ev.pris_connaissance_le ? `<div class="bandeau-info succes">${ico("signature")}<span>Signée par le collaborateur le <strong>${fmtDateLongue(String(ev.pris_connaissance_le).slice(0, 10))}</strong>${ev.commentaire_collaborateur ? ` — « ${echapper(ev.commentaire_collaborateur)} »` : ""}.</span></div>`
      : d.proprietaire ? `<p style="font-size:13px;color:var(--encre-2);margin-bottom:8px">En signant, vous attestez avoir pris connaissance de votre évaluation (ce qui ne vaut pas accord sur son contenu).</p>
        <div class="champ"><label>Commentaire (facultatif)</label><textarea class="saisie" id="ev-commentaire-collab"></textarea></div>
        <button class="btn primaire" id="ev-signer" style="margin-top:10px">${ico("signature")} J'ai pris connaissance de mon évaluation</button>`
      : `<p style="font-size:13px;color:var(--encre-3)">En attente de la signature du collaborateur.</p>`}</section>` : "";
  return base + developpement + signature;
};
const brancherEvaluationAvantEntretien = BRANCHEMENTS["/fiche-evaluation"];
BRANCHEMENTS["/fiche-evaluation"] = function () {
  brancherEvaluationAvantEntretien();
  const f = etat.filtres.fiches;
  const cible = f && f.onglet === "equipe" ? f.selection : moi().matricule;
  const enregistrer = $("#ev-dev-enregistrer");
  if (enregistrer) enregistrer.addEventListener("click", () => actionFiche(API.appel(`/api/fiches/${encodeURIComponent(cible)}/evaluation/developpement`, { methode: "PUT", corps: {
    formations_souhaitees: $$("[data-souhait]").filter((c) => c.checked).map((c) => c.dataset.souhait),
    plan_developpement: $("#ev-plan").value.trim() || null, mobilite_type: $("#ev-mobilite").value || null,
    mobilite_detail: $("#ev-mobilite-detail").value.trim() || null } }), "Plan enregistré", "Développement et mobilité mis à jour."));
  const signer = $("#ev-signer");
  if (signer) signer.addEventListener("click", () => actionFiche(API.appel(`/api/fiches/${encodeURIComponent(cible)}/evaluation/pris-connaissance`, { methode: "POST",
    corps: { commentaire: $("#ev-commentaire-collab").value.trim() || null } }), "Prise de connaissance signée", "Votre supérieur hiérarchique est informé."));
};

/* --- 9. Mes documents : demande d'attestation et suivi ----------------------- */
const vueDocumentsAvantDemandes = VUES["/documents"];
VUES["/documents"] = function () {
  const base = vueDocumentsAvantDemandes();
  if (!connecte()) return base;
  const liste = chargerEtat("mesDocumentsDemandes", () => sirhAppel("/documents"));
  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><h3>Demander un document à la RH</h3></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="saisie" id="dd-type" style="max-width:280px">
      <option value="attestation_salaire">Attestation de salaire</option><option value="certificat_travail">Certificat de travail</option>
      <option value="domiciliation_salaire">Attestation de domiciliation de salaire</option><option value="attestation_conges">Attestation de congés</option>
      <option value="autre">Autre document</option></select>
      <input class="saisie" id="dd-motif" placeholder="Motif (dossier bancaire, visa…)" style="flex:1;min-width:200px">
      <button class="btn primaire" id="dd-demander">${ico("fleche")} Demander</button></div>
    <p class="aide" style="margin-top:6px">L'attestation de travail et l'attestation de solde se téléchargent immédiatement ci-dessous.</p>
    ${Array.isArray(liste) && liste.length ? `<div class="tableau-boite" style="margin-top:12px"><table style="min-width:auto"><tbody>${liste.map((d) => { const [c, l] = STATUTS_DOCS[d.statut]; return `<tr>
      <td><strong style="font-size:13px">${echapper(d.libelle)}</strong><div style="font-size:11.5px;color:var(--encre-3)">demandé le ${fmtDate(String(d.cree_le).slice(0, 10))}${d.commentaire_rh ? ` · ${echapper(d.commentaire_rh)}` : ""}</div></td>
      <td class="droite"><span class="badge ${c}">${l}</span> ${d.fichier ? `<a class="btn petit" href="${lienFichier(d.fichier)}" target="_blank" rel="noopener">${ico("telecharger")} Télécharger</a>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : ""}
  </section>` + base;
};
const brancherDocumentsAvantDemandes = BRANCHEMENTS["/documents"];
BRANCHEMENTS["/documents"] = function () {
  if (brancherDocumentsAvantDemandes) brancherDocumentsAvantDemandes();
  const bouton = $("#dd-demander");
  if (bouton) bouton.addEventListener("click", async () => {
    try { await sirhAppel("/documents", { methode: "POST", corps: { type_document: $("#dd-type").value, motif: $("#dd-motif").value.trim() || null } });
      etat.mesDocumentsDemandes = null; toast("Demande envoyée", "La RH est notifiée ; vous suivrez l'avancement ici.", "succes"); rendre(false); }
    catch (souci) { toast("Demande refusée", souci.message, "danger"); }
  });
};

/* --- 10. Mon profil : dossier, données personnelles, Outlook, notifications - */
const brancherProfilAvantSirh = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantSirh();
  const contenu = $("#contenu .vue") || $("#contenu");
  if (!contenu || $("#profil-sirh")) return;
  contenu.insertAdjacentHTML("beforeend", `<section class="grille" id="profil-sirh" style="grid-template-columns:repeat(auto-fit,minmax(310px,1fr));margin-top:16px">
    <article class="carte"><div class="carte-entete"><h3>Mon dossier et mes données</h3></div>
      <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Conformément à la loi n° 2004-63 sur la protection des données personnelles, vous pouvez consulter et télécharger l'ensemble des données vous concernant ; les corrections se demandent à la RH.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-bloc" id="profil-dossier">${ico("doc")} Consulter mon dossier et ma carrière</button>
        <button class="btn btn-bloc" id="profil-donnees">${ico("telecharger")} Télécharger toutes mes données</button></div></article>
    <article class="carte"><div class="carte-entete"><h3>Calendrier et téléphone</h3></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-bloc" id="profil-ics">${ico("calendrier")} Exporter mes congés vers Outlook (.ics)</button>
        ${estValideur() ? `<button class="btn btn-bloc" id="profil-ics-equipe">${ico("users")} Exporter les congés de mon équipe (.ics)</button>` : ""}
        <button class="btn btn-bloc" id="profil-notif">${ico("cloche")} Activer les notifications sur cet appareil</button>
        <button class="btn btn-bloc" id="profil-installer" ${etat.installation ? "" : "hidden"}>${ico("telecharger")} Installer l'application</button></div>
      <p class="aide" style="margin-top:8px">Sur téléphone : ouvrez le portail dans le navigateur, puis « Ajouter à l'écran d'accueil ».</p></article></section>`);
  $("#profil-dossier").addEventListener("click", () => ouvrirDossier(moi().matricule));
  $("#profil-donnees").addEventListener("click", () => telechargerFichier("/api/sirh/mes-donnees", `mes-donnees-${moi().matricule}.json`, "Mes données"));
  $("#profil-ics").addEventListener("click", () => telechargerFichier("/api/sirh/conges.ics", "mes-conges.ics", "Mes congés"));
  const equipe = $("#profil-ics-equipe");
  if (equipe) equipe.addEventListener("click", () => telechargerFichier("/api/sirh/conges.ics?equipe=true", "conges-equipe.ics", "Congés de l'équipe"));
  $("#profil-notif").addEventListener("click", async () => {
    if (!("Notification" in window)) return toast("Non pris en charge", "Ce navigateur ne gère pas les notifications.", "alerte");
    const choix = await Notification.requestPermission();
    toast(choix === "granted" ? "Notifications activées" : "Notifications refusées",
      choix === "granted" ? "Vous serez prévenu même lorsque le portail est en arrière-plan." : "Vous pouvez les autoriser dans les réglages du navigateur.", choix === "granted" ? "succes" : "alerte");
  });
  const installer = $("#profil-installer");
  if (installer) installer.addEventListener("click", () => { if (etat.installation) etat.installation.prompt(); });
};

/* Notifications système (téléphone, poste) pour les nouvelles notifications */
const notificationsVues = new Set();
setInterval(() => {
  if (!etat.utilisateur || !("Notification" in window) || Notification.permission !== "granted") { NOTIFICATIONS.forEach((n) => notificationsVues.add(n.id)); return; }
  NOTIFICATIONS.filter((n) => !n.lu && !notificationsVues.has(n.id)).forEach((n) => {
    notificationsVues.add(n.id);
    if (!document.hidden) return;
    const titre = n.titre, options = { body: n.message.slice(0, 180), icon: "/assets/marque/logo-picto.png", tag: `notif-${n.id}` };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(titre, options));
    else new Notification(titre, options);
  });
}, 5000);

/* Application installable */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  // Quand OneDrive apporte une nouvelle version, le nouveau cache prend la
  // main. Recharger alors la page évite de garder des modules de deux versions.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  }
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); etat.installation = e; });

/* --- 11. Report : avertissement du collaborateur ------------------------------ */
const brancherAvantReport = brancherVueCourante;
brancherVueCourante = function () {
  brancherAvantReport();
  if (!connecte() || !["/tableau-bord", "/mes-demandes"].includes(etat.route) || $("#bandeau-report")) return;
  sirhAppel("/report/moi").then((r) => {
    if (!r.excedent || $("#bandeau-report") || !$("#contenu")) return;
    const reporte = Math.min(r.solde, r.plafond + r.accord);
    const perdu = Math.max(0, r.solde - reporte);
    ($("#contenu .vue") || $("#contenu")).insertAdjacentHTML("afterbegin", `<div class="bandeau-info ${perdu ? "alerte" : "succes"}" id="bandeau-report" style="margin-bottom:14px">${ico("calendrier")}<span>
      Solde ${r.annee} : <strong>${fmtNombre(r.solde)} jours</strong>. Au 31 décembre, ${fmtNombre(r.plafond)} jours au plus sont reportés${r.accord ? ` (+ ${fmtNombre(r.accord)} j accordés par la RH)` : ""}
      ${perdu ? ` : <strong>${fmtNombre(perdu)} jour(s) seront perdus</strong> si vous ne les posez pas.` : " : aucun jour ne sera perdu."}</span></div>`);
  }).catch(() => {});
};

/* --- 12. Menu, titres et paramètres ------------------------------------------- */
TITRES["/parcours"] = "Arrivées et départs";
TITRES["/bilan-social"] = "Bilan social";
TITRES["/sondages"] = "Sondages";
const menuAvantSirh = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantSirh();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/sondages")) perso.items.push({ route: "/sondages", libelle: "Sondages", icone: "rapport" });
  const equipe = groupes.find((g) => g.titre === "Équipe");
  if (equipe && estValideur() && !equipe.items.some((i) => i.route === "/parcours")) equipe.items.push({ route: "/parcours", libelle: "Arrivées et départs", icone: "users" });
  const pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (pilotage && estAdmin() && !pilotage.items.some((i) => i.route === "/bilan-social")) pilotage.items.splice(1, 0, { route: "/bilan-social", libelle: "Bilan social", icone: "rapport" });
  return groupes;
};
const naviguerAvantSirh = naviguer;
naviguer = function (route) {
  const caches = { "/parcours": "parcoursListe", "/bilan-social": "bilanRH", "/sondages": "sondagesListe", "/formations": "formationsAEvaluer", "/documents": "mesDocumentsDemandes" };
  if (caches[route]) etat[caches[route]] = null;
  if (route === "/administration") etat.alertesRH = etat.reportRH = etat.documentsRH = null;
  return naviguerAvantSirh(route);
};
const brancherParametresAvantPlafond = BRANCHEMENTS["/parametres"];
BRANCHEMENTS["/parametres"] = function () {
  brancherParametresAvantPlafond();
  const acq = $("#p-acq");
  if (acq && !$("#p-plafond")) {
    acq.closest(".champ").insertAdjacentHTML("afterend", `<div class="champ" style="margin-top:10px"><label for="p-plafond">Plafond de report au 31/12 (jours)</label>
      <input class="saisie" type="number" step="0.5" min="0" max="60" id="p-plafond" value="${REGLES.plafondReport ?? 15}" style="width:110px">
      <span class="aide">Au-delà, les jours sont perdus sauf accord de la RH (Administration → Report des congés).</span></div>`);
    $("#p-plafond").addEventListener("change", () => { REGLES.plafondReport = Number($("#p-plafond").value) || 15; });
  }
};
