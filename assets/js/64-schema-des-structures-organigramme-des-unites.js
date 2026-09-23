/* ==========================================================================
   64. SCHÉMA DES STRUCTURES : l'organigramme des unités, pas des personnes.
       L'arbre existant dessine les rattachements entre collaborateurs : une
       direction sans effectif n'y apparaît donc jamais. Ce schéma dessine les
       pôles, directions centrales, directions et départements tels qu'ils sont
       enregistrés, y compris ceux dont le poste de responsable est à pourvoir.
   ========================================================================== */
const vueOrganigrammeAvantSchema = VUES["/organigramme"];
const brancherOrganigrammeAvantSchema = BRANCHEMENTS["/organigramme"];

/* Le rang vient du libellé, jamais de la profondeur : le Bureau d'Ordre est
   rattaché à la Direction générale sans être un pôle pour autant. */
const RANGS_STRUCTURE = [
  ["Direction générale", "#072241"],
  ["Pôle", "#0F3D6B"],
  ["Direction centrale", "#1C6E8C"],
  ["Direction", "#2B8C6A"],
  ["Département", "#6B8F3A"],
  ["Unité", "#7C8CA3"],
];

/* Creer, renommer et supprimer une unite sont reserves a l'administrateur RH
   (le serveur exige administrateur_requis) ; le gestionnaire RH consulte. */
function administrateurRH() {
  return connecte() && estAdmin() && !estGestionnaire();
}

function rangStructure(nom) {
  const n = (nom || "").toLocaleLowerCase("fr");
  if (n.startsWith("direction générale")) return RANGS_STRUCTURE[0];
  if (n.startsWith("pôle")) return RANGS_STRUCTURE[1];
  if (n.startsWith("direction centrale")) return RANGS_STRUCTURE[2];
  if (n.startsWith("direction")) return RANGS_STRUCTURE[3];
  if (n.startsWith("département")) return RANGS_STRUCTURE[4];
  return RANGS_STRUCTURE[5];
}

VUES["/organigramme"] = function () {
  const f = etat.filtres.orga || (etat.filtres.orga = { recherche: "", dept: "", deplies: null });
  if (f.affichage !== "schema") {
    return vueOrganigrammeAvantSchema().replace(
      "</h2>", '</h2><button class="btn petit" id="org-schema">Schéma des structures</button>');
  }
  f.zoomSchema = f.zoomSchema || 1;
  const outils = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <h2>Schéma des structures</h2>
      <button class="btn petit" id="org-personnes-schema">Chaîne hiérarchique</button>
      <button class="btn petit" id="org-unites-schema">Liste des structures</button>
      <span class="carte-sous" style="margin-left:auto">Toutes les unités enregistrées, responsable pourvu ou non</span>
    </div>`;
  if (!connecte()) {
    return `<section class="carte">${outils}${etatVide("organigramme", "Disponible avec le serveur",
      "Les structures sont enregistrées dans la base du portail.")}</section>`;
  }
  if (!structuresOrganisation) {
    return `<section class="carte">${outils}<p role="status">${echapper(
      erreurStructuresOrganisation || "Chargement des structures…")}</p></section>`;
  }

  const structures = structuresOrganisation;
  const parId = new Map(structures.map((d) => [d.id, d]));
  const enfants = new Map();
  structures.forEach((d) => {
    const parent = parId.has(d.parent_id) ? d.parent_id : null;
    if (!enfants.has(parent)) enfants.set(parent, []);
    enfants.get(parent).push(d);
  });
  enfants.forEach((liste) => liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr")));

  if (!f.schemaReplies) f.schemaReplies = new Set();
  const membres = (d) => EMPLOYES.filter((e) => e.dept === d.code);
  const effectifTotal = (d, vus = new Set()) => {
    if (vus.has(d.id)) return 0;
    const suite = new Set(vus).add(d.id);
    return membres(d).length + (enfants.get(d.id) || []).reduce((t, x) => t + effectifTotal(x, suite), 0);
  };

  const q = (f.rechercheSchema || "").trim().toLocaleLowerCase("fr");
  const texte = (d) => `${d.nom} ${d.code} ${d.responsable || ""}`.toLocaleLowerCase("fr");
  const correspond = (d, vus = new Set()) => {
    if (vus.has(d.id)) return false;
    const suite = new Set(vus).add(d.id);
    return !q || texte(d).includes(q) || (enfants.get(d.id) || []).some((x) => correspond(x, suite));
  };

  const carte = (d) => {
    const sous = (enfants.get(d.id) || []).filter((x) => correspond(x));
    const direct = membres(d).length;
    const total = effectifTotal(d);
    const replie = f.schemaReplies.has(d.id);
    const [rang, couleur] = rangStructure(d.nom);
    const trouve = q && texte(d).includes(q);
    return `<div class="str-carte ${trouve ? "trouve" : ""}" style="--s:${couleur}">
      <span class="str-rang">${rang}</span>
      <strong>${echapper(d.nom)}</strong>
      ${d.responsable
        ? `<span class="str-resp">${echapper(d.responsable)}</span>`
        : `<span class="str-resp vacant">…à pourvoir…</span>`}
      <span class="str-effectif">${direct} direct(s)${total !== direct ? ` · ${total} au total` : ""}</span>
      <div class="str-actions">
        ${sous.length ? `<button class="str-plier" data-schema-plier="${d.id}" aria-expanded="${!replie}">
          ${ico(replie ? "bas" : "haut")}${replie ? `${sous.length} unité(s)` : "Replier"}</button>` : ""}
        ${administrateurRH() ? `<button class="str-plier" data-schema-modifier="${d.id}" title="Modifier cette structure">${ico("crayon")}</button>
          ${!sous.length && !direct ? `<button class="str-plier str-supprimer" data-schema-supprimer="${d.id}"
            title="Supprimer cette structure vide">${ico("poubelle")}</button>` : ""}` : ""}
      </div>
    </div>`;
  };

  const branche = (d, profondeur = 0, vus = new Set()) => {
    if (vus.has(d.id) || !correspond(d)) return "";
    const suite = new Set(vus).add(d.id);
    const sous = (enfants.get(d.id) || []).filter((x) => correspond(x));
    const contenu = carte(d);
    if (!sous.length || f.schemaReplies.has(d.id)) return `<li>${contenu}</li>`;
    return `<li>${contenu}<ul>${sous.map((x) => branche(x, profondeur + 1, suite)).join("")}</ul></li>`;
  };

  const racines = (enfants.get(null) || []).filter((x) => correspond(x));
  const vacantes = structures.filter((d) => !d.responsable).length;
  return `<div style="display:flex;flex-direction:column;gap:16px"><section class="carte">${outils}
    <div class="orga-outils" style="margin-bottom:12px;flex-wrap:wrap">
      <input class="saisie" id="schema-recherche" placeholder="Rechercher une direction, un département…"
        value="${echapper(f.rechercheSchema || "")}" style="max-width:280px">
      <button class="btn petit fantome" id="schema-moins" title="Réduire">−</button>
      <span class="badge neutre" style="min-width:52px;justify-content:center">${Math.round(f.zoomSchema * 100)} %</span>
      <button class="btn petit fantome" id="schema-plus" title="Agrandir">+</button>
      <button class="btn petit fantome" id="schema-tout">${ico("bas")} Tout déplier</button>
      <button class="btn petit fantome" id="schema-rien">${ico("haut")} Replier</button>
      <button class="btn petit" id="schema-imprimer">${ico("telecharger")} Imprimer / PDF</button>
      ${administrateurRH() ? `<button class="btn petit primaire" id="schema-creer">${ico("plus")} Nouvelle structure</button>` : ""}
    </div>
    <div class="org-legende" style="margin-bottom:10px">${RANGS_STRUCTURE
      .filter(([l]) => structures.some((d) => rangStructure(d.nom)[0] === l))
      .map(([l, c]) => `<span style="--n:${c}"><i></i>${l}</span>`).join("")}</div>
    <div class="org-scene" id="schema-scene"><div class="org-zoom" style="zoom:${f.zoomSchema}">
      <ul class="org-arbre str-arbre">${racines.map((x) => branche(x)).join("")
        || `<li>${etatVide("organigramme", "Aucune structure", "Aucune unité ne correspond à la recherche.")}</li>`}</ul>
    </div></div>
    <p class="aide" style="margin-top:8px">${structures.length} unité(s) enregistrée(s), dont
      <strong>${vacantes}</strong> sans responsable nommé. Les effectifs « au total » incluent les unités rattachées.
      ${administrateurRH()
        ? "Le crayon modifie une structure (nom, rattachement, responsable) ; la corbeille n'apparaît que sur une unité vide."
        : "La modification des structures est réservée à l'administrateur RH."}</p>
  </section></div>`;
};

/* Creation : le parent et le responsable sont demandes des le depart, pour
   qu'une nouvelle unite n'apparaisse jamais orpheline au sommet de l'arbre. */
function creerStructureOrganisation() {
  const structures = structuresOrganisation || [];
  ouvrirCouche(`<div class="couche-entete"><h2>Nouvelle structure</h2></div>
    <form id="form-creer-structure" style="padding:20px;display:grid;gap:14px">
      <label>Nom<input class="saisie" name="nom" required maxlength="120"
        placeholder="Département Contrôle interne"></label>
      <label>Structure parente<select class="saisie" name="parent">
        <option value="">Aucune (sommet de l'organigramme)</option>
        ${structures.map((x) => `<option value="${x.id}">${echapper(x.nom)}</option>`).join("")}</select></label>
      <label>Responsable<select class="saisie" name="responsable">
        <option value="">À pourvoir</option>
        ${EMPLOYES.map((e) => `<option value="${e.id}">${echapper(nomComplet(e))} · ${echapper(e.matricule)}</option>`).join("")}</select></label>
      <p class="aide">Le rang affiché suit l'intitulé : commencez par « Pôle », « Direction Centrale »,
        « Direction » ou « Département ». Désigner un responsable ne change ni ses droits ni les N+1 de
        son équipe, qui se règlent dans Administration → Affectations.</p>
      <p id="creer-structure-erreur" role="alert" class="msg-erreur" hidden></p>
      <div style="display:flex;gap:10px">
        <button class="btn primaire" type="submit">Créer</button>
        <button class="btn" id="creer-structure-annuler" type="button">Annuler</button></div>
    </form>`);
  $("#creer-structure-annuler").addEventListener("click", fermerCouche);
  $("#form-creer-structure").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const bouton = form.querySelector('[type="submit"]');
    const erreur = $("#creer-structure-erreur");
    const valeurs = new FormData(form);
    const nom = valeurs.get("nom").trim();
    if (nom.length < 3) { erreur.textContent = "Indiquez le nom complet de la structure."; erreur.hidden = false; return; }
    if (structures.some((x) => x.nom.toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr"))) {
      erreur.textContent = `« ${nom} » existe déjà.`; erreur.hidden = false; return;
    }
    bouton.disabled = true;
    try {
      await API.appel("/api/administration/departements", { methode: "POST", corps: {
        code: codeDepartement(nom), nom,
        couleur: PALETTE_DEPT[structures.length % PALETTE_DEPT.length],
        parent_id: valeurs.get("parent") ? Number(valeurs.get("parent")) : null,
        responsable_id: valeurs.get("responsable") ? Number(valeurs.get("responsable")) : null } });
      await rechargerDepartements();
      fermerCouche();
      structuresOrganisation = null;
      await chargerStructuresOrganisation();
      toast("Structure créée", nom, "succes");
    } catch (souci) {
      erreur.textContent = souci.message; erreur.hidden = false; bouton.disabled = false;
    }
  });
}

async function supprimerStructureOrganisation(id) {
  const d = (structuresOrganisation || []).find((x) => x.id === id);
  if (!d) return;
  if (!confirm(`Supprimer « ${d.nom} » ? Cette structure est vide : aucune personne ni sous-structure ne lui est rattachée.`)) return;
  try {
    await API.appel(`/api/administration/departements/${id}`, { methode: "DELETE" });
    await rechargerDepartements();
    structuresOrganisation = null;
    await chargerStructuresOrganisation();
    toast("Structure supprimée", d.nom, "succes");
  } catch (souci) {
    toast("Suppression refusée", souci.message, "danger");
  }
}

BRANCHEMENTS["/organigramme"] = function () {
  brancherOrganigrammeAvantSchema();
  const f = etat.filtres.orga;
  if (!f) return;
  $("#org-schema")?.addEventListener("click", () => {
    f.affichage = "schema";
    rendre(false);
    chargerStructuresOrganisation();
  });
  if (f.affichage !== "schema") return;
  $("#org-personnes-schema")?.addEventListener("click", () => { f.affichage = "arbre"; rendre(false); });
  $("#org-unites-schema")?.addEventListener("click", () => { f.affichage = "unites"; rendre(false); });
  $$("[data-schema-plier]").forEach((b) => b.addEventListener("click", () => {
    const id = Number(b.dataset.schemaPlier);
    if (f.schemaReplies.has(id)) f.schemaReplies.delete(id); else f.schemaReplies.add(id);
    rendre(false);
  }));
  $("#schema-plus")?.addEventListener("click", () => { f.zoomSchema = Math.min(1.6, (f.zoomSchema || 1) + 0.1); rendre(false); });
  $("#schema-moins")?.addEventListener("click", () => { f.zoomSchema = Math.max(0.4, (f.zoomSchema || 1) - 0.1); rendre(false); });
  $("#schema-tout")?.addEventListener("click", () => { f.schemaReplies = new Set(); rendre(false); });
  $("#schema-rien")?.addEventListener("click", () => {
    f.schemaReplies = new Set((structuresOrganisation || []).map((d) => d.id));
    rendre(false);
  });
  $("#schema-imprimer")?.addEventListener("click", () => window.print());
  $("#schema-creer")?.addEventListener("click", creerStructureOrganisation);
  $$("[data-schema-modifier]").forEach((b) => b.addEventListener("click",
    () => modifierStructureOrganisation(Number(b.dataset.schemaModifier))));
  $$("[data-schema-supprimer]").forEach((b) => b.addEventListener("click",
    () => supprimerStructureOrganisation(Number(b.dataset.schemaSupprimer))));
  const recherche = $("#schema-recherche");
  if (recherche) {
    recherche.addEventListener("input", debounce(() => {
      f.rechercheSchema = recherche.value;
      rendre(false);
    }, 250));
  }
};

const deconnexionAvantSchema = deconnexion;
deconnexion = function (...args) {
  const f = etat.filtres.orga;
  if (f) { f.affichage = "arbre"; f.rechercheSchema = ""; f.schemaReplies = new Set(); }
  return deconnexionAvantSchema(...args);
};
