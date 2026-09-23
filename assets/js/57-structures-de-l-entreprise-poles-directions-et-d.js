/* ==========================================================================
   57. STRUCTURES DE L'ENTREPRISE : pôles, directions et départements imbriqués.
       Les liens de structures ne modifient pas les droits des personnes.
   ========================================================================== */
const vueOrganisationAvantStructures = VUES["/organigramme"];
const brancherOrganisationAvantStructures = BRANCHEMENTS["/organigramme"];
let structuresOrganisation = null;
let erreurStructuresOrganisation = "";
let chargementStructuresOrganisation = false;

async function chargerStructuresOrganisation() {
  if (chargementStructuresOrganisation || !connecte()) return;
  chargementStructuresOrganisation = true;
  erreurStructuresOrganisation = "";
  try {
    const [structures] = await Promise.all([API.appel("/api/administration/departements"), rafraichirAnnuaire()]);
    structuresOrganisation = structures;
  } catch (souci) { erreurStructuresOrganisation = souci.message; }
  finally {
    chargementStructuresOrganisation = false;
    if (etat.route === "/organigramme") rendre(false);
  }
}

VUES["/organigramme"] = function () {
  const f = etat.filtres.orga || (etat.filtres.orga = { recherche: "", dept: "", deplies: null });
  if (f.affichage !== "unites") {
    return vueOrganisationAvantStructures().replace('</h2>', '</h2><button class="btn petit" id="org-unites">Par structures</button>');
  }
  const outils = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><h2>Organisation par pôles et directions</h2>
    <button class="btn petit" id="org-personnes">Chaîne hiérarchique</button>
    <button class="btn petit" id="org-actualiser">Actualiser</button></div>`;
  if (!connecte()) return `<section class="carte">${outils}${etatVide("organigramme", "Disponible avec le serveur", "Les structures sont enregistrées dans la base du portail.")}</section>`;
  if (!structuresOrganisation) return `<section class="carte">${outils}<p role="status">${echapper(erreurStructuresOrganisation || "Chargement des structures…")}</p></section>`;
  const structures = structuresOrganisation;
  const parId = new Map(structures.map((d) => [d.id, d]));
  const enfants = new Map();
  structures.forEach((d) => { const parent = parId.has(d.parent_id) ? d.parent_id : null;
    if (!enfants.has(parent)) enfants.set(parent, []); enfants.get(parent).push(d); });
  const q = (f.rechercheStructure || "").trim().toLocaleLowerCase("fr");
  const membres = (d) => EMPLOYES.filter((e) => e.dept === d.code);
  const effectifStructure = (d, vus = new Set()) => {
    if (vus.has(d.id)) return 0;
    const suite = new Set(vus).add(d.id);
    return membres(d).length + (enfants.get(d.id) || []).reduce((total, x) => total + effectifStructure(x, suite), 0);
  };
  const texte = (d) => [d.nom, d.code, d.responsable || "", ...membres(d).map((e) => `${nomComplet(e)} ${e.matricule} ${LIBELLE_NIVEAU[niveauDe(e)]}`)].join(" ").toLocaleLowerCase("fr");
  const correspond = (d, vus = new Set()) => {
    if (vus.has(d.id)) return false;
    const suite = new Set(vus).add(d.id);
    return !q || texte(d).includes(q) || (enfants.get(d.id) || []).some((x) => correspond(x, suite));
  };
  const dessines = new Set();
  const carte = (d, profondeur = 0, vus = new Set(), montrerTout = false) => {
    if (vus.has(d.id) || (!montrerTout && !correspond(d))) return "";
    dessines.add(d.id);
    const suite = new Set(vus).add(d.id);
    const equipe = membres(d);
    const responsable = EMPLOYES.find((e) => e.id === d.responsable_id);
    const enfantsHtml = (enfants.get(d.id) || []).map((x) => carte(x, profondeur + 1, suite, montrerTout || (q && texte(d).includes(q)))).join("");
    return `<details class="structure-rh" ${q || profondeur < 3 ? "open" : ""}>
      <summary><strong>${echapper(d.nom)}</strong><span class="badge neutre">${equipe.length} direct(s)${(enfants.get(d.id) || []).length ? ` · ${effectifStructure(d)} au total` : ""}</span></summary>
      <p class="aide" style="margin:8px 0">${d.responsable ? `Responsable : <strong>${echapper(d.responsable)}</strong>${responsable ? ` · ${echapper(LIBELLE_NIVEAU[niveauDe(responsable)] || niveauDe(responsable))}` : ""}` : "Responsable non renseigné"}</p>
      ${equipe.length ? `<div class="structure-equipe">${equipe.map((e) => `<div class="structure-personne"><strong>${echapper(nomComplet(e))}</strong> <span class="mono">${echapper(e.matricule)}</span>
        <small>${echapper(LIBELLE_NIVEAU[niveauDe(e)] || niveauDe(e))}${e.validateur && parMatricule[e.validateur] ? ` · N+1 : ${echapper(nomComplet(parMatricule[e.validateur]))}` : ""}</small></div>`).join("")}</div>` : ""}
      ${estAdmin() && !estGestionnaire() ? `<button class="btn petit fantome" style="margin-top:10px" data-structure-modifier="${d.id}">Modifier la structure</button>` : ""}
      ${enfantsHtml ? `<div class="structures-rh">${enfantsHtml}</div>` : ""}</details>`;
  };
  let contenu = (enfants.get(null) || []).map((d) => carte(d)).join("");
  // Une ancienne donnée cyclique ne doit ni bloquer l'écran ni disparaître.
  const isolees = structures.filter((d) => !dessines.has(d.id) && correspond(d));
  if (isolees.length) contenu += `<p class="aide">Structures à vérifier</p>` + isolees.filter((d) => !dessines.has(d.id)).map((d) => dessines.has(d.id) ? "" : carte(d)).join("");
  const sans = EMPLOYES.filter((e) => !e.dept || !structures.some((d) => d.code === e.dept));
  return `<section class="carte">${outils}<p class="aide">Les unités suivent l'organisation de l'entreprise. Le N+1 affiché sous chaque personne détermine sa chaîne hiérarchique.</p>
    <label class="aide" for="org-recherche-structure">Rechercher une structure, une personne ou un niveau</label>
    <input id="org-recherche-structure" class="saisie" value="${echapper(f.rechercheStructure || "")}" placeholder="Ex. Santé, Middle Manager, matricule…" style="margin:8px 0 16px">
    ${erreurStructuresOrganisation ? `<p role="alert">${echapper(erreurStructuresOrganisation)}</p>` : ""}
    <div class="structures-rh">${contenu || etatVide("users", "Aucune structure trouvée", "Modifiez votre recherche.")}</div>
    ${sans.length ? `<details class="structure-rh" style="margin-top:16px"><summary><strong>Affectations à compléter</strong><span class="badge neutre">${sans.length} personne(s)</span></summary><p class="aide">Aucune unité renseignée. Le rattachement actuel peut être provisoire.</p><div class="structure-equipe">${sans.map((e) => `<div class="structure-personne">${echapper(nomComplet(e))} · ${echapper(e.matricule)}</div>`).join("")}</div></details>` : ""}</section>`;
};

function modifierStructureOrganisation(id) {
  const d = structuresOrganisation.find((x) => x.id === id);
  if (!d) return;
  ouvrirCouche(`<div class="couche-entete"><h2>Modifier la structure</h2></div><form id="form-structure-rh" style="padding:20px;display:grid;gap:14px">
    <label>Nom<input class="saisie" name="nom" required maxlength="120" value="${echapper(d.nom)}"></label>
    <label>Structure parente<select class="saisie" name="parent"><option value="">Aucune (sommet)</option>${structuresOrganisation.filter((x) => x.id !== id).map((x) => `<option value="${x.id}" ${x.id === d.parent_id ? "selected" : ""}>${echapper(x.nom)}</option>`).join("")}</select></label>
    <label>Responsable<select class="saisie" name="responsable"><option value="">Non renseigné</option>${EMPLOYES.map((e) => `<option value="${e.id}" ${e.id === d.responsable_id ? "selected" : ""}>${echapper(nomComplet(e))} · ${echapper(e.matricule)}</option>`).join("")}</select></label>
    <p class="aide">Les rattachements individuels se modifient dans Administration → Affectations. Une structure ne donne pas de droits supplémentaires à son responsable.</p>
    <p id="structure-erreur" role="alert"></p><div style="display:flex;gap:10px"><button class="btn primaire" type="submit">Enregistrer</button><button class="btn" id="structure-annuler" type="button">Annuler</button></div></form>`);
  $("#structure-annuler").addEventListener("click", fermerCouche);
  $("#form-structure-rh").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const form = ev.currentTarget; const bouton = form.querySelector('[type="submit"]'); bouton.disabled = true;
    const valeurs = new FormData(form);
    try {
      await API.appel(`/api/administration/departements/${d.id}`, { methode: "PUT", corps: {
        code: d.code, nom: valeurs.get("nom").trim(), couleur: d.couleur,
        parent_id: valeurs.get("parent") ? Number(valeurs.get("parent")) : null,
        responsable_id: valeurs.get("responsable") ? Number(valeurs.get("responsable")) : null } });
      await rechargerDepartements(); fermerCouche(); await chargerStructuresOrganisation();
      toast("Structure enregistrée", d.code, "succes");
    } catch (souci) { $("#structure-erreur").textContent = souci.message; bouton.disabled = false; }
  });
}

BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  if (f.affichage !== "unites") {
    brancherOrganisationAvantStructures();
    $("#org-unites")?.addEventListener("click", () => { f.affichage = "unites"; rendre(false); chargerStructuresOrganisation(); });
    return;
  }
  $("#org-personnes")?.addEventListener("click", () => { f.affichage = "arbre"; rendre(false); });
  $("#org-actualiser")?.addEventListener("click", chargerStructuresOrganisation);
  $("#org-recherche-structure")?.addEventListener("input", debounce((ev) => {
    f.rechercheStructure = ev.target.value; rendre(false);
    const champ = $("#org-recherche-structure"); champ?.focus(); champ?.setSelectionRange(champ.value.length, champ.value.length);
  }, 250));
  $$("[data-structure-modifier]").forEach((b) => b.addEventListener("click", () => modifierStructureOrganisation(Number(b.dataset.structureModifier))));
  if (!structuresOrganisation && !erreurStructuresOrganisation) chargerStructuresOrganisation();
};
const deconnexionAvantStructures = deconnexion;
deconnexion = function (...args) { structuresOrganisation = null; erreurStructuresOrganisation = ""; return deconnexionAvantStructures(...args); };
