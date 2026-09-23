/* ==========================================================================
   67. FORMATIONS ET HABILITATIONS OBLIGATOIRES
       Référentiel tenu par la RH (qui doit quoi, tous les combien de mois),
       obtentions et renouvellements, tableau de conformité par direction et
       relances automatiques à 60 j, 30 j et à l'expiration.
   ========================================================================== */
const HAB_BADGES = { conforme: "approuvee", a_renouveler: "attente", expiree: "rejetee", manquante: "annulee" };
const HAB_SUGGESTIONS = [
  "Lutte contre le blanchiment et le financement du terrorisme (LBC/FT)",
  "Protection des données personnelles (loi 2004-63)",
  "Code de déontologie et conformité",
  "Sécurité incendie et évacuation",
  "Secourisme du travail",
  "Agrément d'intermédiaire en assurance",
];

function habEtat() {
  return etat.filtres.habilitations || (etat.filtres.habilitations = { onglet: "moi" });
}
const habPeutVoirConformite = () => estAdmin() || estDirection() || estValideur();
function habBadge(statut, libelle) { return `<span class="badge ${HAB_BADGES[statut] || "neutre"}">${echapper(libelle)}</span>`; }

function habLignesExigences(lignes) {
  if (!lignes.length) return etatVide("check", "Aucune habilitation exigée", "Aucune formation ou habilitation obligatoire ne vous concerne pour l'instant.");
  return `<div class="tableau-boite"><table style="min-width:520px"><thead><tr><th>Habilitation</th><th>Obtenue le</th><th>Valable jusqu'au</th><th>État</th></tr></thead><tbody>
    ${lignes.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.habilitation.intitule)}</strong></td>
      <td class="mono">${l.obtention ? fmtDate(l.obtention.obtenue_le) : "—"}</td>
      <td class="mono">${l.obtention ? (l.obtention.expire_le ? fmtDate(l.obtention.expire_le) : "Sans limite") : "—"}</td>
      <td>${habBadge(l.statut, l.statut_libelle)}</td></tr>`).join("")}</tbody></table></div>`;
}

VUES["/habilitations"] = function () {
  if (!connecte()) return reserveServeur("Les habilitations obligatoires");
  const f = habEtat();
  const onglets = [["moi", "Ma situation"], ...(habPeutVoirConformite() ? [["conformite", "Conformité"]] : []), ...(estAdmin() ? [["referentiel", "Référentiel"]] : [])];
  if (!onglets.some(([k]) => k === f.onglet)) f.onglet = "moi";
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Formations et habilitations obligatoires</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Obligations réglementaires et échéances de renouvellement.</p></div>
    ${onglets.length > 1 ? `<div class="segment">${onglets.map(([k, l]) => `<button data-hab-onglet="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>`;

  if (f.onglet === "moi") {
    const d = chargerEtat("habMoi", () => API.appel("/api/habilitations/moi"));
    if (!d || d.erreur) return `<section class="carte">${entete}${d ? etatVide("alerte", "Indisponible", echapper(d.erreur)) : squelette(160)}</section>`;
    return `<section class="carte">${entete}${habLignesExigences(d.exigences)}
      <p class="aide" style="margin-top:8px">Vous êtes prévenu 60 jours et 30 jours avant l'expiration, puis à l'échéance. Les sessions de renouvellement sont organisées par la RH.</p></section>`;
  }

  if (f.onglet === "referentiel") {
    const r = chargerEtat("habReferentiel", () => API.appel("/api/habilitations"));
    if (!r || r.erreur) return `<section class="carte">${entete}${squelette(160)}</section>`;
    return `<section class="carte">${entete}
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn petit primaire" data-hab-editer="">${ico("plus")} Nouvelle habilitation</button></div>
      ${r.habilitations.length ? `<div class="tableau-boite"><table style="min-width:640px"><thead><tr><th>Intitulé</th><th>Catégorie</th><th>Renouvellement</th><th>Personnel concerné</th><th>État</th><th></th></tr></thead><tbody>
        ${r.habilitations.map((h) => `<tr><td><strong style="font-size:13px">${echapper(h.intitule)}</strong>${h.organisme ? `<div class="aide">${echapper(h.organisme)}</div>` : ""}</td>
          <td>${echapper(h.categorie_libelle)}</td><td>${h.periodicite_mois ? `tous les ${h.periodicite_mois} mois` : "une fois"}</td>
          <td style="font-size:12.5px">${echapper(h.population_libelle)}</td><td>${h.actif ? `<span class="badge approuvee">Active</span>` : `<span class="badge neutre">Désactivée</span>`}</td>
          <td class="droite" style="white-space:nowrap"><button class="btn petit" data-hab-editer="${h.id}">${ico("crayon")}</button>
            ${h.actif ? `<button class="btn petit" data-hab-retirer="${h.id}">${ico("poubelle")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : etatVide("diplome", "Référentiel vide", "Ajoutez les formations et habilitations exigées par la réglementation ou la politique interne.")}</section>`;
  }

  const c = chargerEtat("habConformite", () => API.appel("/api/habilitations/conformite"));
  if (!c || c.erreur) return `<section class="carte">${entete}${c ? etatVide("alerte", "Indisponible", echapper(c.erreur)) : squelette(200)}</section>`;
  const n = c.compteurs;
  return `<section class="carte">${entete}
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      ${carteKpi({ cle: "hab1", libelle: "Taux de conformité", valeur: c.taux_global == null ? "—" : c.taux_global, unite: c.taux_global == null ? "" : "%", icone: "bouclier", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${c.exigences} exigence(s)` })}
      ${carteKpi({ cle: "hab2", libelle: "À renouveler", valeur: n.a_renouveler, unite: "", icone: "horloge", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "dans les 60 jours" })}
      ${carteKpi({ cle: "hab3", libelle: "Expirées", valeur: n.expiree, unite: "", icone: "alerte", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: "à régulariser" })}
      ${carteKpi({ cle: "hab4", libelle: "Manquantes", valeur: n.manquante, unite: "", icone: "diplome", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: "jamais obtenues" })}</div>
    ${c.peut_saisir ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn petit primaire" data-hab-obtention="">${ico("plus")} Enregistrer une obtention</button></div>` : ""}
    ${c.par_direction.length ? `<h3 style="margin:4px 0 8px;font-size:14px">Par direction</h3><div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Direction</th><th class="centre">Exigences</th><th class="centre">Conformité</th><th class="centre">À renouveler</th><th class="centre">Expirées</th><th class="centre">Manquantes</th></tr></thead><tbody>
      ${c.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.exigees}</td>
        <td class="centre"><div class="jauge" style="width:90px;display:inline-block"><span style="width:${a.taux || 0}%"></span></div> ${a.taux}%</td>
        <td class="centre num">${a.a_renouveler || "—"}</td><td class="centre num">${a.expiree || "—"}</td><td class="centre num">${a.manquante || "—"}</td></tr>`).join("")}</tbody></table></div>`
      : etatVide("diplome", "Aucune exigence", "Le référentiel des habilitations est vide.")}
    ${c.a_traiter.length ? `<h3 style="margin:16px 0 8px;font-size:14px">À traiter</h3><div class="tableau-boite"><table style="min-width:620px"><thead><tr><th>Collaborateur</th><th>Direction</th><th>Habilitation</th><th>Échéance</th><th>État</th>${c.peut_saisir ? "<th></th>" : ""}</tr></thead><tbody>
      ${c.a_traiter.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong></td><td style="font-size:12.5px">${echapper(l.employe.direction)}</td>
        <td style="font-size:12.5px">${echapper(l.habilitation.intitule)}</td><td class="mono">${l.obtention && l.obtention.expire_le ? fmtDate(l.obtention.expire_le) : "—"}</td>
        <td>${habBadge(l.statut, l.statut_libelle)}</td>
        ${c.peut_saisir ? `<td class="droite"><button class="btn petit" data-hab-obtention="${l.employe.matricule}" data-hab-id="${l.habilitation.id}">${ico("check")} Saisir</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : ""}
  </section>`;
};

async function habEditer(id) {
  const r = etat.habReferentiel || await API.appel("/api/habilitations");
  const h = r.habilitations.find((x) => String(x.id) === String(id)) || { intitule: "", categorie: "formation_reglementaire", population: "tous", cibles: [], actif: true };
  const structures = (typeof DEPARTEMENTS !== "undefined" ? DEPARTEMENTS : []).slice().sort((a, b) => a.nom.localeCompare(b.nom));
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(620px,100%)">
    ${enteteTiroir(h.id ? "Modifier l'habilitation" : "Nouvelle habilitation", "Qui doit la détenir et tous les combien de mois la renouveler")}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <div class="champ"><label>Intitulé *</label><input class="saisie" id="hab-intitule" list="hab-suggestions" value="${echapper(h.intitule)}">
        <datalist id="hab-suggestions">${HAB_SUGGESTIONS.map((s) => `<option value="${echapper(s)}">`).join("")}</datalist></div>
      <div class="ligne-champs"><div class="champ"><label>Catégorie</label><select class="saisie" id="hab-categorie">${Object.entries(r.categories).map(([k, l]) => `<option value="${k}" ${k === h.categorie ? "selected" : ""}>${echapper(l)}</option>`).join("")}</select></div>
        <div class="champ"><label>Renouvellement (mois)</label><input class="saisie" id="hab-periodicite" type="number" min="1" max="120" value="${h.periodicite_mois || ""}" placeholder="vide : une seule fois"></div></div>
      <div class="champ"><label>Organisme (facultatif)</label><input class="saisie" id="hab-organisme" value="${echapper(h.organisme || "")}"></div>
      <div class="champ"><label>Personnel concerné</label><select class="saisie" id="hab-population">${Object.entries(r.populations).map(([k, l]) => `<option value="${k}" ${k === h.population ? "selected" : ""}>${echapper(l)}</option>`).join("")}</select></div>
      <div id="hab-cibles-departements" ${h.population === "departements" ? "" : "hidden"} style="max-height:180px;overflow:auto;border:1px solid var(--trait);border-radius:10px;padding:8px">
        ${structures.map((d) => `<label style="display:flex;gap:8px;font-size:13px"><input type="checkbox" data-hab-cible-dep="${d.id}" ${h.population === "departements" && h.cibles.map(String).includes(String(d.id)) ? "checked" : ""}> ${echapper(d.nom)}</label>`).join("")}
        <p class="aide">Une structure inclut ses sous-structures.</p></div>
      <div id="hab-cibles-niveaux" ${h.population === "niveaux" ? "" : "hidden"}>
        ${Object.entries(r.niveaux).map(([k, l]) => `<label style="display:flex;gap:8px;font-size:13px"><input type="checkbox" data-hab-cible-niv="${k}" ${h.population === "niveaux" && h.cibles.includes(k) ? "checked" : ""}> ${echapper(l)}</label>`).join("")}</div>
      <div class="champ"><label>Description</label><textarea class="saisie" id="hab-description" rows="3">${echapper(h.description || "")}</textarea></div>
      <label style="display:flex;gap:8px;font-size:13px"><input type="checkbox" id="hab-actif" ${h.actif ? "checked" : ""}> Exigence active</label>
      <p id="hab-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="hab-fermer">Fermer</button><button class="btn primaire" id="hab-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#hab-fermer").addEventListener("click", fermerCouche);
  $("#hab-population").addEventListener("change", (e) => {
    $("#hab-cibles-departements").hidden = e.target.value !== "departements";
    $("#hab-cibles-niveaux").hidden = e.target.value !== "niveaux";
  });
  $("#hab-enregistrer").addEventListener("click", async () => {
    const population = $("#hab-population").value;
    const cibles = population === "departements" ? $$("[data-hab-cible-dep]:checked").map((c) => Number(c.dataset.habCibleDep))
      : population === "niveaux" ? $$("[data-hab-cible-niv]:checked").map((c) => c.dataset.habCibleNiv) : [];
    const corps = { intitule: $("#hab-intitule").value.trim(), categorie: $("#hab-categorie").value, organisme: $("#hab-organisme").value.trim() || null,
      periodicite_mois: Number($("#hab-periodicite").value) || null, population, cibles, description: $("#hab-description").value.trim() || null, actif: $("#hab-actif").checked };
    try {
      await API.appel(h.id ? `/api/habilitations/${h.id}` : "/api/habilitations", { methode: h.id ? "PUT" : "POST", corps });
      fermerCouche(); etat.habReferentiel = null; etat.habConformite = null; etat.habMoi = null;
      toast("Référentiel mis à jour", corps.intitule, "succes"); rendre(false);
    } catch (souci) { const e = $("#hab-erreur"); e.textContent = souci.message; e.hidden = false; }
  });
}

async function habSaisirObtention(matricule, habilitationId) {
  const r = etat.habReferentiel || await API.appel("/api/habilitations");
  const actives = r.habilitations.filter((h) => h.actif);
  if (!actives.length) return toast("Référentiel vide", "Ajoutez d'abord une habilitation dans l'onglet Référentiel.", "alerte");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(560px,100%)">
    ${enteteTiroir("Enregistrer une obtention", "Obtention initiale ou renouvellement ; l'historique est conservé")}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <div class="champ"><label>Collaborateur *</label><select class="saisie" id="hob-matricule"><option value="">Choisir…</option>
        ${EMPLOYES.slice().sort((a, b) => a.nom.localeCompare(b.nom)).map((e) => `<option value="${e.matricule}" ${e.matricule === matricule ? "selected" : ""}>${echapper(nomComplet(e))} · ${e.matricule}</option>`).join("")}</select></div>
      <div class="champ"><label>Habilitation *</label><select class="saisie" id="hob-habilitation">
        ${actives.map((h) => `<option value="${h.id}" ${String(h.id) === String(habilitationId) ? "selected" : ""}>${echapper(h.intitule)}</option>`).join("")}</select></div>
      <div class="ligne-champs"><div class="champ"><label>Obtenue le *</label><input class="saisie" type="date" id="hob-obtenue" max="${aujourdhui}" value="${aujourdhui}"></div>
        <div class="champ"><label>Valable jusqu'au</label><input class="saisie" type="date" id="hob-expire"></div></div>
      <p class="aide">Sans date de validité, elle est calculée d'après la périodicité du référentiel.</p>
      <div class="champ"><label>Référence (attestation, certificat…)</label><input class="saisie" id="hob-reference" maxlength="80"></div>
      <div class="champ"><label>Justificatif (PDF, DOC, DOCX)</label><input class="saisie" type="file" id="hob-fichier" accept=".pdf,.doc,.docx"></div>
      <p id="hob-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="hob-fermer">Fermer</button><button class="btn primaire" id="hob-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#hob-fermer").addEventListener("click", fermerCouche);
  $("#hob-enregistrer").addEventListener("click", async (ev) => {
    const cible = $("#hob-matricule").value;
    const erreur = $("#hob-erreur");
    if (!cible) { erreur.textContent = "Choisissez le collaborateur."; erreur.hidden = false; return; }
    ev.currentTarget.disabled = true;
    try {
      const id = Number($("#hob-habilitation").value);
      const s = await API.appel(`/api/habilitations/collaborateur/${encodeURIComponent(cible)}`, { methode: "POST", corps: {
        habilitation_id: id, obtenue_le: $("#hob-obtenue").value, expire_le: $("#hob-expire").value || null, reference: $("#hob-reference").value.trim() || null } });
      const fichier = $("#hob-fichier").files[0];
      if (fichier) await televerser(`/api/habilitations/obtention/${s.obtention_id}/justificatif`, fichier);
      fermerCouche(); etat.habConformite = null; etat.habMoi = null;
      toast("Obtention enregistrée", "Le collaborateur est prévenu.", "succes"); rendre(false);
    } catch (souci) { erreur.textContent = souci.message; erreur.hidden = false; ev.currentTarget.disabled = false; }
  });
}

BRANCHEMENTS["/habilitations"] = function () {
  const f = etat.filtres.habilitations;
  if (!f) return;
  $$("[data-hab-onglet]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.habOnglet; rendre(false); }));
  $$("[data-hab-editer]").forEach((b) => b.addEventListener("click", () => habEditer(b.dataset.habEditer)));
  $$("[data-hab-obtention]").forEach((b) => b.addEventListener("click", () => habSaisirObtention(b.dataset.habObtention, b.dataset.habId)));
  $$("[data-hab-retirer]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Retirer cette habilitation ? Si des obtentions sont enregistrées, elle est seulement désactivée.")) return;
    try { const r = await API.appel(`/api/habilitations/${b.dataset.habRetirer}`, { methode: "DELETE" });
      etat.habReferentiel = null; etat.habConformite = null;
      toast(r.statut === "supprimee" ? "Habilitation supprimée" : "Habilitation désactivée", "", "succes"); rendre(false); }
    catch (souci) { toast("Action refusée", souci.message, "danger"); }
  }));
};

TITRES["/habilitations"] = "Habilitations obligatoires";
const menuAvantHabilitations = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantHabilitations();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/habilitations")) {
    const i = perso.items.findIndex((x) => x.route === "/formations");
    perso.items.splice(i >= 0 ? i + 1 : perso.items.length, 0, { route: "/habilitations", libelle: "Habilitations", icone: "bouclier" });
  }
  return groupes;
};
const naviguerAvantHabilitations = naviguer;
naviguer = function (route) {
  if (route === "/habilitations") { etat.habMoi = null; etat.habConformite = null; etat.habReferentiel = null; }
  return naviguerAvantHabilitations(route);
};
const deconnexionAvantHabilitations = deconnexion;
deconnexion = function (...args) {
  delete etat.filtres.habilitations;
  etat.habMoi = null; etat.habConformite = null; etat.habReferentiel = null;
  return deconnexionAvantHabilitations(...args);
};
