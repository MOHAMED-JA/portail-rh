/* ==========================================================================
   70. RÉMUNÉRATION ET SIMULATION DE LA MASSE SALARIALE
       Saisie des salaires par la RH (montants chiffrés en base, import Excel),
       réglages de calcul, et simulation des augmentations : générale + mérite
       selon la performance, date d'effet, enveloppe. La Direction générale
       voit la simulation par direction, jamais les salaires individuels.
   ========================================================================== */
const remDinars = (v) => (v == null ? "—" : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DT`);
const REM_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function remEtat() {
  return etat.filtres.remuneration || (etat.filtres.remuneration = {
    onglet: "simulation", recherche: "",
    sim: { annee: new Date().getFullYear() + 1, augmentation_generale: 0, merite: { 1: 0, 2: 2, 3: 4, 0: 0 }, mois_effet: 1, enveloppe: "" },
  });
}

VUES["/remuneration"] = function () {
  if (!connecte()) return reserveServeur("La rémunération et la masse salariale");
  if (!(estAdmin() || estDirection())) return etatVide("bouclier", "Réservé", "Réservé à la RH et à la Direction générale.");
  const f = remEtat();
  const onglets = [["simulation", "Simulation"], ...(estAdmin() ? [["saisie", "Salaires"]] : [])];
  if (!onglets.some(([k]) => k === f.onglet)) f.onglet = "simulation";
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Rémunération et masse salariale</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Données confidentielles : les salaires individuels ne sont visibles que de la RH.</p></div>
    ${onglets.length > 1 ? `<div class="segment">${onglets.map(([k, l]) => `<button data-rem-onglet="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>`;

  if (f.onglet === "saisie") {
    const d = chargerEtat("remListe", () => API.appel("/api/remuneration"));
    if (!d || d.erreur) return `<section class="carte">${entete}${d ? etatVide("alerte", "Indisponible", echapper(d.erreur)) : squelette(260)}</section>`;
    const q = f.recherche.toLowerCase();
    const lignes = d.collaborateurs.filter((l) => !q || `${l.employe.prenom} ${l.employe.nom} ${l.employe.matricule} ${l.employe.direction}`.toLowerCase().includes(q));
    return `<section class="carte">${entete}
      <div class="barre-filtres" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <span class="badge ${d.saisies === d.effectif ? "approuvee" : "attente"}">${d.saisies} / ${d.effectif} rémunérations saisies</span>
        <input class="saisie" id="rem-recherche" placeholder="Rechercher" value="${echapper(f.recherche)}" style="width:200px">
        <button class="btn petit" id="rem-modele">${ico("telecharger")} Classeur de saisie</button>
        <label class="btn petit" style="cursor:pointer">${ico("import")} Importer<input type="file" id="rem-import" accept=".xlsx" hidden></label>
        ${estGestionnaire() ? "" : `<button class="btn petit" id="rem-reglages">${ico("reglages")} Réglages</button>`}</div>
      <p class="aide" style="margin-bottom:8px">Charges patronales : ${fmtNombre(d.reglages.taux_charges, 2)} % · ${d.reglages.jours_par_mois} jours de travail par mois (coût d'une journée). Les montants ne figurent jamais au journal d'audit.</p>
      <div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Collaborateur</th><th>Direction</th><th class="centre">Base mensuelle</th><th class="centre">Primes fixes</th><th class="centre">Mois</th><th class="centre">Brut annuel</th><th class="centre">Coût employeur</th><th></th></tr></thead><tbody>
        ${lignes.map((l) => { const r = l.remuneration; return `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong><div class="aide mono">${l.employe.matricule}</div></td>
          <td style="font-size:12.5px">${echapper(l.employe.direction)}</td>
          <td class="centre num">${r ? remDinars(r.salaire_base) : "—"}</td><td class="centre num">${r ? remDinars(r.primes_fixes) : "—"}</td><td class="centre num">${r ? r.mois_payes : "—"}</td>
          <td class="centre num">${r ? remDinars(r.annuel_brut) : "—"}</td><td class="centre num">${r ? remDinars(r.cout_employeur) : `<span class="badge attente">À saisir</span>`}</td>
          <td class="droite"><button class="btn petit" data-rem-saisir="${l.employe.matricule}">${ico("crayon")}</button></td></tr>`; }).join("")}</tbody></table></div></section>`;
  }

  const s = f.sim;
  const res = etat.remSimulation;
  return `<section class="carte">${entete}
    <div class="ligne-champs" style="flex-wrap:wrap">
      <div class="champ"><label>Année simulée</label><input class="saisie" type="number" data-rem-sim="annee" value="${s.annee}" min="2020" max="2100"></div>
      <div class="champ"><label>Augmentation générale (%)</label><input class="saisie" type="number" step="0.1" min="0" data-rem-sim="augmentation_generale" value="${s.augmentation_generale}"></div>
      <div class="champ"><label>À partir de</label><select class="saisie" data-rem-sim="mois_effet">${REM_MOIS.map((m, i) => `<option value="${i + 1}" ${s.mois_effet === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      <div class="champ"><label>Enveloppe de l'année (DT, facultatif)</label><input class="saisie" type="number" min="0" data-rem-sim="enveloppe" value="${s.enveloppe}"></div></div>
    <div class="ligne-champs" style="flex-wrap:wrap">
      ${[[3, "Performance élevée"], [2, "Performance conforme"], [1, "Performance faible"], [0, "Non évalué"]].map(([k, l]) => `<div class="champ"><label>Mérite — ${l} (%)</label>
        <input class="saisie" type="number" step="0.1" min="0" data-rem-merite="${k}" value="${s.merite[k]}"></div>`).join("")}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn primaire" id="rem-simuler">${ico("rapport")} Simuler</button>
      <span class="aide">Performance de l'année précédente : revue des talents calibrée, sinon note de l'évaluation finalisée. L'augmentation porte sur le salaire de base.</span></div>
    ${res && !res.erreur && !res.par_direction.length ? `<div class="bandeau-info alerte" style="margin-top:14px">${ico("alerte")}<span>Aucune rémunération saisie : la simulation a besoin des salaires (onglet « Salaires », saisie ou import du classeur).</span></div>` : ""}
    ${res && !res.erreur && res.par_direction.length ? `<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin:16px 0">
        ${carteKpi({ cle: "rs1", libelle: "Masse salariale actuelle", valeur: remDinars(res.masse_actuelle), unite: "", icone: "portefeuille", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "annuelle, charges comprises" })}
        ${carteKpi({ cle: "rs2", libelle: `Coût en ${res.parametres.annee}`, valeur: remDinars(res.cout_annee), unite: "", icone: "calendrier", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `à partir de ${REM_MOIS[res.parametres.mois_effet - 1]}` })}
        ${carteKpi({ cle: "rs3", libelle: "Coût en année pleine", valeur: remDinars(res.cout_annee_pleine), unite: "", icone: "haut", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: res.evolution_pourcent == null ? "" : `+${fmtNombre(res.evolution_pourcent, 2)} % de masse salariale` })}
        ${carteKpi({ cle: "rs4", libelle: "Écart à l'enveloppe", valeur: res.ecart_enveloppe == null ? "—" : remDinars(res.ecart_enveloppe), unite: "", icone: "check", couleur: res.ecart_enveloppe != null && res.ecart_enveloppe < 0 ? "var(--danger)" : "var(--succes)", fond: res.ecart_enveloppe != null && res.ecart_enveloppe < 0 ? "var(--danger-doux)" : "var(--succes-doux)", detail: res.ecart_enveloppe == null ? "aucune enveloppe saisie" : res.ecart_enveloppe < 0 ? "dépassement" : "marge restante" })}</div>
      ${res.non_valorises ? `<div class="bandeau-info alerte" style="margin-bottom:10px">${ico("alerte")}<span>${res.non_valorises} collaborateur(s) sans rémunération saisie ne sont pas comptés : la masse salariale est sous-estimée.</span></div>` : ""}
      <div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Direction</th><th class="centre">Effectif valorisé</th><th class="centre">Masse actuelle</th><th class="centre">Coût ${res.parametres.annee}</th><th class="centre">Année pleine</th></tr></thead><tbody>
        ${res.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.effectif}</td><td class="centre num">${remDinars(a.masse_actuelle)}</td>
          <td class="centre num">${remDinars(a.cout_annee)}</td><td class="centre num">${remDinars(a.cout_annee_pleine)}</td></tr>`).join("")}</tbody></table></div>
      ${res.collaborateurs ? `<h3 style="margin:16px 0 8px;font-size:14px">${ico("bouclier")} Détail individuel (RH uniquement)</h3>
        <div class="tableau-boite"><table style="min-width:680px"><thead><tr><th>Collaborateur</th><th class="centre">Performance</th><th class="centre">Taux</th><th class="centre">Base actuelle</th><th class="centre">Nouvelle base</th><th class="centre">Coût année pleine</th></tr></thead><tbody>
          ${res.collaborateurs.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong><div class="aide">${echapper(l.employe.direction)}</div></td>
            <td class="centre">${l.performance ? TAL_NIVEAUX[l.performance] : "Non évalué"}</td><td class="centre num">${fmtNombre(l.taux, 2)} %</td>
            <td class="centre num">${remDinars(l.salaire_base)}</td><td class="centre num">${remDinars(l.nouveau_salaire_base)}</td><td class="centre num">${remDinars(l.cout_annee_pleine)}</td></tr>`).join("")}</tbody></table></div>` : ""}` : ""}
  </section>`;
};

function remSaisir(matricule) {
  const l = ((etat.remListe || {}).collaborateurs || []).find((x) => x.employe.matricule === matricule);
  if (!l) return;
  const r = l.remuneration || { mois_payes: 12 };
  const v = (x) => (x == null ? "" : x);
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(520px,100%)">
    ${enteteTiroir(`Rémunération — ${echapper(l.employe.prenom + " " + l.employe.nom)}`, "Montants mensuels bruts, en dinars ; chiffrés en base")}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <div class="ligne-champs"><div class="champ"><label>Salaire de base brut *</label><input class="saisie" type="number" step="0.001" min="0" id="rs-base" value="${v(r.salaire_base)}"></div>
        <div class="champ"><label>Primes fixes mensuelles</label><input class="saisie" type="number" step="0.001" min="0" id="rs-primes" value="${v(r.primes_fixes)}"></div></div>
      <div class="ligne-champs"><div class="champ"><label>Net mensuel (attestation)</label><input class="saisie" type="number" step="0.001" min="0" id="rs-net" value="${v(r.salaire_net)}"></div>
        <div class="champ"><label>Mois payés par an</label><input class="saisie" type="number" step="0.5" min="12" max="16" id="rs-mois" value="${v(r.mois_payes)}"></div></div>
      <div class="ligne-champs"><div class="champ"><label>Banque</label><input class="saisie" id="rs-banque" value="${echapper(v(r.banque))}"></div>
        <div class="champ"><label>RIB (20 chiffres)</label><input class="saisie" id="rs-rib" value="${echapper(v(r.rib))}" inputmode="numeric"></div></div>
      <p id="rs-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="rs-fermer">Fermer</button><button class="btn primaire" id="rs-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#rs-fermer").addEventListener("click", fermerCouche);
  $("#rs-enregistrer").addEventListener("click", async () => {
    const nombre = (id) => ($(id).value === "" ? null : Number($(id).value));
    try {
      await API.appel(`/api/remuneration/collaborateur/${encodeURIComponent(matricule)}`, { methode: "PUT", corps: {
        salaire_base: nombre("#rs-base"), primes_fixes: nombre("#rs-primes"), salaire_net: nombre("#rs-net"),
        mois_payes: nombre("#rs-mois") || 12, banque: $("#rs-banque").value.trim() || null, rib: $("#rs-rib").value.trim() || null } });
      fermerCouche(); etat.remListe = null; toast("Rémunération enregistrée", "", "succes"); rendre(false);
    } catch (souci) { const e = $("#rs-erreur"); e.textContent = souci.message; e.hidden = false; }
  });
}

async function remReglages() {
  const r = await API.appel("/api/remuneration/reglages");
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(460px,100%)">
    ${enteteTiroir("Réglages de calcul", "Utilisés pour le coût employeur, la valeur des congés et la simulation")}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <div class="champ"><label>Charges patronales (% du brut)</label><input class="saisie" type="number" step="0.01" min="0" max="60" id="rr-taux" value="${r.taux_charges}"></div>
      <div class="champ"><label>Jours de travail par mois</label><input class="saisie" type="number" step="0.5" min="15" max="31" id="rr-jours" value="${r.jours_par_mois}"></div>
      <p class="aide">Le taux proposé par défaut est indicatif : à confirmer par la RH selon les cotisations effectivement dues.</p>
      <p id="rr-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="rr-fermer">Fermer</button><button class="btn primaire" id="rr-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#rr-fermer").addEventListener("click", fermerCouche);
  $("#rr-enregistrer").addEventListener("click", async () => {
    try { await API.appel("/api/remuneration/reglages", { methode: "PUT", corps: { taux_charges: Number($("#rr-taux").value), jours_par_mois: Number($("#rr-jours").value) } });
      fermerCouche(); etat.remListe = null; etat.remSimulation = null; toast("Réglages enregistrés", "", "succes"); rendre(false); }
    catch (souci) { const e = $("#rr-erreur"); e.textContent = souci.message; e.hidden = false; }
  });
}

BRANCHEMENTS["/remuneration"] = function () {
  const f = etat.filtres.remuneration;
  if (!f) return;
  $$("[data-rem-onglet]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.remOnglet; rendre(false); }));
  $$("[data-rem-saisir]").forEach((b) => b.addEventListener("click", () => remSaisir(b.dataset.remSaisir)));
  $("#rem-recherche")?.addEventListener("change", (e) => { f.recherche = e.target.value.trim(); rendre(false); });
  $("#rem-modele")?.addEventListener("click", () => telechargerFichier("/api/remuneration/modele.xlsx", "RH-remunerations.xlsx", "Classeur des rémunérations"));
  $("#rem-reglages")?.addEventListener("click", () => remReglages().catch((souci) => toast("Réglages indisponibles", souci.message, "danger")));
  $("#rem-import")?.addEventListener("change", async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    try {
      const essai = await televerser("/api/remuneration/import", fichier);
      if (essai.erreurs.length) {
        toast("Classeur à corriger", `${essai.erreurs.length} erreur(s) : ${essai.erreurs.slice(0, 3).join(" · ")}`, "danger");
      } else if (!essai.lignes) {
        toast("Rien à importer", "Aucune ligne ne contient de salaire de base.", "alerte");
      } else if (confirm(`${essai.lignes} rémunération(s) prête(s) à importer. Appliquer ?`)) {
        await televerser("/api/remuneration/import?appliquer=true", fichier);
        etat.remListe = null; toast("Rémunérations importées", `${essai.lignes} ligne(s)`, "succes"); rendre(false);
      }
    } catch (souci) { toast("Import impossible", souci.message, "danger"); }
    e.target.value = "";
  });
  $$("[data-rem-sim]").forEach((c) => c.addEventListener("change", () => {
    const cle = c.dataset.remSim;
    f.sim[cle] = cle === "enveloppe" ? c.value : Number(c.value);
  }));
  $$("[data-rem-merite]").forEach((c) => c.addEventListener("change", () => { f.sim.merite[c.dataset.remMerite] = Number(c.value) || 0; }));
  $("#rem-simuler")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const s = f.sim;
      etat.remSimulation = await API.appel("/api/remuneration/simulation", { methode: "POST", corps: {
        annee: s.annee, augmentation_generale: s.augmentation_generale, mois_effet: s.mois_effet,
        merite: Object.fromEntries(Object.entries(s.merite).map(([k, v]) => [String(k), Number(v) || 0])),
        enveloppe: s.enveloppe === "" ? null : Number(s.enveloppe) } });
      rendre(false);
    } catch (souci) { toast("Simulation impossible", souci.message, "danger"); ev.currentTarget.disabled = false; }
  });
};

TITRES["/remuneration"] = "Rémunération et masse salariale";
const menuAvantRemuneration = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantRemuneration();
  if (!(estAdmin() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/remuneration")) pilotage.items.push({ route: "/remuneration", libelle: "Masse salariale", icone: "portefeuille" });
  return groupes;
};
const naviguerAvantRemuneration = naviguer;
naviguer = function (route) { if (route === "/remuneration") etat.remListe = null; return naviguerAvantRemuneration(route); };
const deconnexionAvantRemuneration = deconnexion;
deconnexion = function (...args) { delete etat.filtres.remuneration; etat.remListe = null; etat.remSimulation = null; return deconnexionAvantRemuneration(...args); };
