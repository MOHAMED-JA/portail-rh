/* ==========================================================================
   36. ADMINISTRATION RH : SUIVI DES FICHES, RELANCES, AFFECTATIONS
   Une fiche dont l'évaluation est validée par le supérieur et par la RH n'est
   plus consultable que par l'administration RH (et par l'intéressé).
   Les changements d'organisation (département, profil, supérieur) sont
   silencieux : l'organigramme se met à jour pour tous, sans notification.
   ========================================================================== */
ouvrirMenuMobile = ouvrirMenuMobileSansDeconnexion;   // déconnexion : en haut à droite seulement

/* --- Données du suivi : API ou calcul local (démonstration) ---------------- */
function suiviDemo() {
  const lignes = {};
  const admin = EMPLOYES.find((e) => e.role === "admin");
  EMPLOYES.filter((e) => e.statut !== "sorti").forEach((e) => {
    const responsable = e.validateur && parMatricule[e.validateur] ? parMatricule[e.validateur] : (admin && admin !== e ? admin : null);
    if (!responsable) return;
    const l = lignes[responsable.matricule] || (lignes[responsable.matricule] = {
      responsable: { ...miniEmploye(responsable), departement: responsable.dept, role: ROLES_LOCAUX[responsable.role] },
      equipe: 0, brouillons: 0, objectifs_a_valider: 0, objectifs_valides: 0, evaluations_a_approuver: 0,
      evaluations_approuvees: 0, evaluations_finalisees: 0, collaborateurs: [],
    });
    const f = ficheDemoBrute(e.matricule), so = f.objectifs.statut, ev = f.evaluation;
    l.equipe++;
    l.brouillons += ["brouillon", "a_corriger"].includes(so);
    l.objectifs_a_valider += so === "soumise";
    l.objectifs_valides += so === "validee";
    l.evaluations_a_approuver += so === "validee" && !ev.valide_superieur_le;
    l.evaluations_approuvees += !!ev.valide_superieur_le;
    l.evaluations_finalisees += !!ev.finalisee_le;
    l.collaborateurs.push({ employe: { ...miniEmploye(e), departement: e.dept }, statut_objectifs: so,
      statut_evaluation: statutEvaluationDemo(f), note_finale: ev.note_finale });
  });
  return Object.values(lignes).map((l) => ({ ...l, en_retard: l.objectifs_a_valider + l.evaluations_a_approuver,
    a_jour: l.objectifs_a_valider + l.evaluations_a_approuver === 0 }))
    .sort((a, b) => b.en_retard - a.en_retard || a.responsable.nom.localeCompare(b.responsable.nom, "fr"));
}
const chargerSuivi = () => (connecte() ? API.appel("/api/fiches/suivi/responsables") : Promise.resolve(suiviDemo()));

async function relancerResponsables(matricules) {
  let relances;
  if (connecte()) {
    relances = (await API.appel("/api/fiches/suivi/relances", { methode: "POST", corps: { responsables: matricules } })).relances;
  } else {
    relances = [];
    suiviDemo().filter((l) => !l.a_jour && (!matricules || matricules.includes(l.responsable.matricule))
      && l.responsable.matricule !== moi().matricule).forEach((l) => {
      const morceaux = [];
      if (l.objectifs_a_valider) morceaux.push(`${l.objectifs_a_valider} fiche(s) d'objectifs à valider`);
      if (l.evaluations_a_approuver) morceaux.push(`${l.evaluations_a_approuver} fiche(s) d'évaluation à compléter`);
      notifierDemo(l.responsable.matricule, "Rappel de l'administration RH",
        `Vous avez ${morceaux.join(" et ")} pour l'exercice ${ANNEE}. Merci de les traiter.`, "alerte",
        l.objectifs_a_valider ? "/fiche-objectifs" : "/fiche-evaluation");
      relances.push(l.responsable.matricule);
    });
  }
  return relances;
}

/* --- Onglet « Suivi des fiches » -------------------------------------------- */
function adminSuivi(f) {
  if (!etat.suiviFiches) {
    if (!etat.suiviEnCours) {
      etat.suiviEnCours = true;
      chargerSuivi().then((d) => { etat.suiviFiches = d; })
        .catch((souci) => { etat.suiviFiches = []; toast("Suivi indisponible", souci.message, "danger"); })
        .finally(() => { etat.suiviEnCours = false; if (etat.route === "/administration") rendre(false); });
    }
    return `<div class="squelette" style="height:220px;border-radius:14px"></div>`;
  }
  const lignes = etat.suiviFiches;
  const filtre = f.suivi || "retard";
  const visibles = lignes.filter((l) => filtre === "tous" || (filtre === "retard" ? !l.a_jour : l.a_jour));
  const somme = (cle) => lignes.reduce((s, l) => s + l[cle], 0);
  const enRetard = lignes.filter((l) => !l.a_jour).length;
  const [so, se] = [STATUTS_OBJECTIFS, STATUTS_EVALUATION];
  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:14px">
    ${carteKpi({ cle: "sv1", libelle: "Responsables en retard", valeur: enRetard, unite: `/ ${lignes.length}`, icone: "alerte", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "Au moins une fiche en attente" })}
    ${carteKpi({ cle: "sv2", libelle: "Objectifs à valider", valeur: somme("objectifs_a_valider"), unite: "", icone: "cible", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${somme("objectifs_valides")} fiche(s) validée(s)` })}
    ${carteKpi({ cle: "sv3", libelle: "Évaluations à compléter", valeur: somme("evaluations_a_approuver"), unite: "", icone: "etoile", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: `${somme("evaluations_approuvees")} approuvée(s) par le supérieur` })}
    ${carteKpi({ cle: "sv4", libelle: "Évaluations finalisées", valeur: somme("evaluations_finalisees"), unite: "", icone: "check", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: `${somme("brouillons")} fiche(s) non soumise(s) par les collaborateurs` })}
  </section>
  <div class="barre-filtres" style="margin-bottom:12px;justify-content:space-between">
    <div class="segment" id="suivi-filtre">
      ${[["retard", `N'ont pas encore approuvé (${enRetard})`], ["ajour", `À jour (${lignes.length - enRetard})`], ["tous", "Tous"]]
        .map(([cle, libelle]) => `<button data-suivi="${cle}" class="${filtre === cle ? "actif" : ""}">${libelle}</button>`).join("")}
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn petit fantome" id="suivi-actualiser">${ico("horloge")} Actualiser</button>
      <button class="btn petit primaire" id="suivi-relancer-tous" ${enRetard ? "" : "disabled"}>${ico("cloche")} Relancer tous les responsables en retard</button>
    </div>
  </div>
  ${visibles.length ? `<div class="tableau-boite"><table style="min-width:860px">
    <thead><tr><th>Responsable</th><th class="centre">Équipe</th><th class="centre">Objectifs à valider</th>
      <th class="centre">Évaluations à compléter</th><th class="centre">Validées / finalisées</th><th>État</th><th class="droite">Actions</th></tr></thead>
    <tbody>${visibles.map((l) => {
      const r = l.responsable, ouvert = (f.suiviOuverts || []).includes(r.matricule);
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:9px">
          <div class="avatar s" style="background:${couleurDept(r.departement)}">${(r.prenom[0] + r.nom[0]).toUpperCase()}</div>
          <div><strong style="font-size:13px">${echapper(r.prenom + " " + r.nom)}</strong>
          <div style="font-size:11.5px;color:var(--encre-3)"><span class="mono">${echapper(r.matricule)}</span> · ${echapper(r.poste || "")}</div></div></div></td>
        <td class="centre num">${l.equipe}</td>
        <td class="centre num"><strong style="color:${l.objectifs_a_valider ? "var(--alerte)" : "inherit"}">${l.objectifs_a_valider}</strong></td>
        <td class="centre num"><strong style="color:${l.evaluations_a_approuver ? "var(--alerte)" : "inherit"}">${l.evaluations_a_approuver}</strong></td>
        <td class="centre num">${l.objectifs_valides} / ${l.evaluations_finalisees}</td>
        <td>${l.a_jour ? `<span class="badge approuvee">${ico("check")} A approuvé</span>` : `<span class="badge attente">${ico("horloge")} N'a pas encore approuvé</span>`}</td>
        <td class="droite" style="white-space:nowrap">
          <button class="btn petit fantome" data-suivi-detail="${echapper(r.matricule)}">${ico(ouvert ? "haut" : "bas")} Détail</button>
          ${l.a_jour || r.matricule === moi().matricule ? "" : `<button class="btn petit" data-relancer="${echapper(r.matricule)}">${ico("cloche")} Relancer</button>`}
        </td>
      </tr>
      ${ouvert ? l.collaborateurs.map((c) => {
        const [c1, l1] = so[c.statut_objectifs] || ["neutre", c.statut_objectifs];
        const [c2, l2] = se[c.statut_evaluation] || ["neutre", c.statut_evaluation];
        return `<tr class="suivi-detail">
          <td style="padding-left:52px">${echapper(c.employe.prenom + " " + c.employe.nom)} <span class="mono" style="font-size:11.5px;color:var(--encre-3)">${echapper(c.employe.matricule)}</span></td>
          <td colspan="2"><span class="badge ${c1}">Objectifs : ${l1}</span></td>
          <td colspan="2"><span class="badge ${c2}">Évaluation : ${l2}</span></td>
          <td class="num">${c.note_finale == null ? "—" : `<strong>${noteFr(c.note_finale)}</strong> /20`}</td>
          <td class="droite"><button class="btn petit fantome" data-voir-fiche="${echapper(c.employe.matricule)}">${ico("oeil")} Voir la fiche</button></td>
        </tr>`;
      }).join("") : ""}`;
    }).join("")}</tbody>
  </table></div>` : etatVide("check", filtre === "retard" ? "Tous les responsables sont à jour" : "Aucun responsable",
      filtre === "retard" ? "Aucune fiche d'objectifs ni d'évaluation n'attend de validation." : "Aucun rattachement hiérarchique enregistré.")}`;
}

function brancherSuivi(f) {
  $$("[data-suivi]").forEach((b) => b.addEventListener("click", () => { f.suivi = b.dataset.suivi; rendre(false); }));
  $$("[data-suivi-detail]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.suiviDetail;
    f.suiviOuverts = (f.suiviOuverts || []).includes(m) ? f.suiviOuverts.filter((x) => x !== m) : [...(f.suiviOuverts || []), m];
    rendre(false);
  }));
  $$("[data-voir-fiche]").forEach((b) => b.addEventListener("click", () => {
    etat.filtres.fiches = { onglet: "equipe", selection: b.dataset.voirFiche, recherche: "", statut: "" };
    naviguer("/fiche-evaluation");
  }));
  const actualiser = $("#suivi-actualiser");
  if (actualiser) actualiser.addEventListener("click", () => { etat.suiviFiches = null; rendre(false); });
  const relancer = async (matricules) => {
    try {
      const faits = await relancerResponsables(matricules);
      toast(faits.length ? "Relance envoyée" : "Aucune relance",
        faits.length ? `${faits.length} responsable(s) notifié(s) : un rappel les invite à traiter leurs fiches.` : "Aucun responsable n'a de fiche en attente.",
        faits.length ? "succes" : "info");
    } catch (souci) { toast("Relance impossible", souci.message, "danger"); }
  };
  $$("[data-relancer]").forEach((b) => b.addEventListener("click", () => relancer([b.dataset.relancer])));
  const tous = $("#suivi-relancer-tous");
  if (tous) tous.addEventListener("click", () => relancer(null));
}

/* --- Onglet « Affectations » ------------------------------------------------ */
function adminAffectations(f) {
  const a = f.affectation || (f.affectation = { dept: DEPARTEMENTS[0] ? DEPARTEMENTS[0].code : "", role: "", validateur: "__inchange", recherche: "", origine: "", selection: [] });
  let liste = EMPLOYES.filter((e) => e.statut !== "sorti");
  if (a.origine) liste = liste.filter((e) => (e.dept || "") === (a.origine === "__aucun" ? "" : a.origine));
  if (a.recherche) {
    const q = a.recherche.toLowerCase();
    liste = liste.filter((e) => `${nomComplet(e)} ${e.matricule} ${e.poste || ""}`.toLowerCase().includes(q));
  }
  liste.sort((x, y) => (x.nom + x.prenom).localeCompare(y.nom + y.prenom, "fr"));
  const superieurs = EMPLOYES.filter((e) => e.statut !== "sorti").sort((x, y) => (x.nom + x.prenom).localeCompare(y.nom + y.prenom, "fr"));
  return `
  <div class="bandeau-info" style="margin-bottom:14px">${ico("organigramme")}<span>Affectez un ou plusieurs collaborateurs à un département, et changez au besoin leur profil ou leur supérieur hiérarchique.
    L'organigramme est mis à jour pour tous les utilisateurs, <strong>sans notification</strong>.</span></div>
  <div class="grille" style="grid-template-columns:minmax(260px,1fr) minmax(300px,1.4fr);align-items:start">
    <article class="carte" style="box-shadow:none;display:flex;flex-direction:column;gap:12px">
      <h3>1. Destination</h3>
      <div class="champ"><label for="af-dept">Département</label>
        <select class="saisie" id="af-dept">${DEPARTEMENTS.map((d) => `<option value="${echapper(d.code)}" ${a.dept === d.code ? "selected" : ""}>${echapper(d.nom)}</option>`).join("")}</select></div>
      <details ${DEPARTEMENTS.length ? "" : "open"}><summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--marine)">+ Créer un département</summary>
        <div style="display:flex;gap:8px;margin-top:8px"><input class="saisie" id="af-nouveau-dept" placeholder="Ex. Direction Commerciale">
          <button class="btn petit" id="af-creer-dept">${ico("plus")} Créer</button></div></details>
      <div class="champ"><label for="af-role">Profil</label>
        <select class="saisie" id="af-role">
          <option value="">Ne pas changer</option>
          ${optionsRoles().map(([v, l]) => `<option value="${v}" ${a.role === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></div>
      <div class="champ"><label for="af-validateur">Supérieur hiérarchique</label>
        <select class="saisie" id="af-validateur">
          <option value="__inchange" ${a.validateur === "__inchange" ? "selected" : ""}>Ne pas changer</option>
          <option value="" ${a.validateur === "" ? "selected" : ""}>Aucun — relève directement de la RH</option>
          ${superieurs.map((e) => `<option value="${echapper(e.matricule)}" ${a.validateur === e.matricule ? "selected" : ""}>${echapper(nomComplet(e))} — ${echapper(e.poste || e.matricule)}</option>`).join("")}
        </select></div>
      <button class="btn primaire" id="af-appliquer" ${a.selection.length ? "" : "disabled"}>${ico("check")} Affecter ${a.selection.length} collaborateur(s)</button>
    </article>
    <article class="carte" style="box-shadow:none;display:flex;flex-direction:column;gap:10px">
      <h3>2. Collaborateurs <span class="badge neutre">${a.selection.length} sélectionné(s)</span></h3>
      <div class="barre-filtres">
        <input class="saisie" id="af-recherche" placeholder="Nom, matricule, poste…" value="${echapper(a.recherche)}" style="flex:1">
        <select class="saisie" id="af-origine">
          <option value="">Tous les départements</option>
          <option value="__aucun" ${a.origine === "__aucun" ? "selected" : ""}>Non affectés</option>
          ${DEPARTEMENTS.map((d) => `<option value="${echapper(d.code)}" ${a.origine === d.code ? "selected" : ""}>${echapper(d.nom)}</option>`).join("")}
        </select>
      </div>
      <div style="display:flex;gap:8px;font-size:12.5px">
        <button class="btn petit fantome" id="af-tout">Tout cocher (${liste.length})</button>
        <button class="btn petit fantome" id="af-rien">Tout décocher</button>
      </div>
      <div class="affectation-liste">${liste.map((e) => `
        <label class="affectation-ligne">
          <input type="checkbox" data-af="${echapper(e.matricule)}" ${a.selection.includes(e.matricule) ? "checked" : ""}>
          <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
          <div style="min-width:0;flex:1"><strong style="font-size:13px;display:block">${echapper(nomComplet(e))}</strong>
            <span style="font-size:11.5px;color:var(--encre-3)"><span class="mono">${echapper(e.matricule)}</span> · ${echapper(nomDept(e.dept))} · ${echapper(libelleProfil(e.role))}</span></div>
        </label>`).join("") || `<div style="padding:16px">${etatVide("users", "Aucun collaborateur", "Modifiez la recherche ou le filtre.")}</div>`}</div>
    </article>
  </div>`;
}

function codeDepartement(nom) {
  const base = nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 16) || "DEPT";
  let code = base, n = 2;
  while (DEPARTEMENTS.some((d) => d.code === code)) code = `${base.slice(0, 14)}-${n++}`;
  return code;
}
const PALETTE_DEPT = ["#2B63C9", "#E07A5F", "#0E9F6E", "#D9A441", "#8B5CF6", "#3AA9D6", "#C0477E", "#0E7C86"];

async function rechargerDepartements() {
  const departements = await API.appel("/api/administration/departements");
  DEPARTEMENTS.length = 0;
  departements.forEach((d) => DEPARTEMENTS.push({ id: d.id, code: d.code, nom: d.nom, couleur: d.couleur }));
}

function brancherAffectations(f) {
  const a = f.affectation;
  const lier = (id, cle, evt = "change") => { const el = $(`#${id}`); if (el) el.addEventListener(evt, () => { a[cle] = el.value; if (evt === "change") rendre(false); }); };
  lier("af-dept", "dept"); lier("af-role", "role"); lier("af-validateur", "validateur"); lier("af-origine", "origine");
  const recherche = $("#af-recherche");
  recherche.addEventListener("input", debounce(() => {
    a.recherche = recherche.value; rendre(false);
    const champ = $("#af-recherche"); champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
  }, 250));
  $$("[data-af]").forEach((c) => c.addEventListener("change", () => {
    const m = c.dataset.af;
    a.selection = c.checked ? [...new Set([...a.selection, m])] : a.selection.filter((x) => x !== m);
    rendre(false);
  }));
  $("#af-tout").addEventListener("click", () => { a.selection = [...new Set([...a.selection, ...$$("[data-af]").map((c) => c.dataset.af)])]; rendre(false); });
  $("#af-rien").addEventListener("click", () => { a.selection = []; rendre(false); });

  $("#af-creer-dept").addEventListener("click", async () => {
    const nom = $("#af-nouveau-dept").value.trim();
    if (nom.length < 3) return toast("Nom trop court", "Indiquez le nom complet du département.", "danger");
    if (DEPARTEMENTS.some((d) => d.nom.toLowerCase() === nom.toLowerCase())) return toast("Déjà existant", `« ${nom} » existe déjà.`, "alerte");
    const nouveau = { code: codeDepartement(nom), nom, couleur: PALETTE_DEPT[DEPARTEMENTS.length % PALETTE_DEPT.length] };
    try {
      if (connecte()) { await API.appel("/api/administration/departements", { methode: "POST", corps: nouveau }); await rechargerDepartements(); }
      else DEPARTEMENTS.push(nouveau);
      a.dept = nouveau.code;
      toast("Département créé", nom, "succes");
      rendre(false);
    } catch (souci) { toast("Création impossible", souci.message, "danger"); }
  });

  $("#af-appliquer").addEventListener("click", async () => {
    const departement = DEPARTEMENTS.find((d) => d.code === a.dept);
    if (!departement || !a.selection.length) return;
    if (a.validateur !== "__inchange" && a.validateur && a.selection.includes(a.validateur)) {
      return toast("Rattachement impossible", "Un collaborateur ne peut pas être son propre supérieur : décochez-le.", "danger");
    }
    const bouton = $("#af-appliquer");
    bouton.disabled = true; bouton.textContent = "Enregistrement…";
    let faits = 0;
    try {
      for (const m of a.selection) {
        const e = parMatricule[m];
        if (!e) continue;
        if (connecte()) {
          const corps = { departement_id: departement.id };
          if (a.role) corps.role = ROLES_LOCAUX[a.role];
          if (a.validateur !== "__inchange") corps.validateur_id = a.validateur ? parMatricule[a.validateur].id : null;
          await API.appel(`/api/administration/employes/${e.id}`, { methode: "PUT", corps });
        } else {
          e.dept = departement.code;
          if (a.role) e.role = a.role;
          if (a.validateur !== "__inchange") e.validateur = a.validateur || null;
          JOURNAL.unshift({ action: "Affectation", cible: m, acteur: moi().matricule, detail: departement.nom, date: new Date() });
        }
        faits++;
      }
      if (connecte()) await chargerDonneesApi();
      toast("Affectation enregistrée", `${faits} collaborateur(s) → ${departement.nom}. L'organigramme est à jour pour tous, sans notification.`, "succes");
      a.selection = [];
      etat.suiviFiches = null;
      if (etat.filtres.orga) etat.filtres.orga.deplies = null;
    } catch (souci) {
      toast("Affectation interrompue", `${faits} enregistrée(s) avant l'erreur : ${souci.message}`, "danger");
      if (connecte()) await chargerDonneesApi().catch(() => {});
    }
    rendre(false);
  });
}

/* --- Administration : deux onglets de plus ---------------------------------- */
VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  const onglets = [["employes", "Employés"], ["affectations", "Affectations"], ["suivi", "Suivi des fiches"], ["sorties", "Sorties"], ["departements", "Départements"],
    ["synthese", "Synthèse"], ["organigramme", "Organigramme"], ["journal", "Journal d'audit"], ["import", "Import & exports"]];
  const vues = { employes: () => adminEmployes(f), affectations: () => adminAffectations(f), suivi: () => adminSuivi(f), sorties: () => adminSorties(f),
    departements: adminDepartements, synthese: adminSynthese, organigramme: adminOrganigramme, journal: adminJournal, import: adminImport };
  const corps = (vues[f.onglet] || vues.employes)();
  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div class="segment" id="onglets-admin">
        ${onglets.map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("")}
      </div>
    </div>
    ${corps}
  </section>`;
};
const brancherAdministrationAvantSuivi = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdministrationAvantSuivi) brancherAdministrationAvantSuivi();
  const f = etat.filtres.admin;
  if (!f) return;
  if (f.onglet === "suivi" && etat.suiviFiches) brancherSuivi(f);
  if (f.onglet === "affectations") brancherAffectations(f);
};
/* Le suivi est relu à chaque arrivée sur l'administration. */
const naviguerAvantSuivi = naviguer;
naviguer = function (route) {
  if (route === "/administration") etat.suiviFiches = null;
  return naviguerAvantSuivi(route);
};

/* --- Organigramme : les changements d'affectation apparaissent sans recharger */
setInterval(async () => {
  if (!connecte() || etat.route !== "/organigramme") return;
  const avant = JSON.stringify(EMPLOYES.map((e) => [e.matricule, e.dept, e.validateur, e.poste]));
  try { await rafraichirAnnuaire(); await rechargerDepartements(); } catch { return; }
  const apres = JSON.stringify(EMPLOYES.map((e) => [e.matricule, e.dept, e.validateur, e.poste]));
  const saisie = document.activeElement && ["INPUT", "SELECT"].includes(document.activeElement.tagName);
  if (avant !== apres && !saisie) rendre(false);
}, 20000);
