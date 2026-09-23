/* ==========================================================================
   47. ORGANIGRAMME DESSINÉ EN ARBRE : structures (responsables) ou complet,
       zoom, déplacement, recherche, impression. La vue liste reste disponible.
   ========================================================================== */
const RANG_NIVEAU = Object.fromEntries(NIVEAUX_HIERARCHIQUES.map(([c], i) => [c, i]));
const COULEUR_NIVEAU = { dg: "var(--rouge)", dga: "#C2410C", directeur_pole: "var(--violet)", top_manager: "var(--marine)",
  manager: "var(--info)", middle_manager: "var(--succes)", collaborateur: "var(--encre-3)" };
const niveauDe = (e) => e.niveau || "collaborateur";

function arbreHierarchique() {
  const { racines, enfants } = arbreOrganisation();
  const tri = (a, b) => (RANG_NIVEAU[niveauDe(b)] - RANG_NIVEAU[niveauDe(a)])
    || ((enfants[b.matricule] || []).length - (enfants[a.matricule] || []).length)
    || (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr");
  Object.values(enfants).forEach((l) => l.sort(tri));
  racines.sort(tri);
  return { racines, enfants };
}

/* Collaborateurs sans équipe sous un responsable : un ou plusieurs <li>.
   Point d'extension (module 74 : regroupement par structure). */
function feuillesOrganigramme(simples, { mode, correspond }) {
  if (mode === "complet") {
    return [`<li><div class="org-feuilles">${simples.map((x) => `<div class="${correspond(x) ? "trouve" : ""}" ${correspond(x) ? 'style="background:var(--alerte-doux)"' : ""}>
      <span class="ini" style="background:${COULEUR_NIVEAU[niveauDe(x)]}">${initiales(x)}</span>
      <span><strong style="font-size:11.5px">${echapper(nomComplet(x))}</strong><small>${echapper(x.poste && x.poste !== "Non renseigné" ? x.poste : x.matricule)}</small></span></div>`).join("")}</div></li>`];
  }
  return [`<li><div class="org-feuilles" style="text-align:center;padding:10px">${ico("users")}
      <strong style="display:block;font-size:12.5px;margin-top:4px">${simples.length} collaborateur(s)</strong>
      <small style="color:var(--encre-3)">rattaché(s) directement</small></div></li>`];
}

const vueListeOrganigramme = VUES["/organigramme"];
const brancherListeOrganigramme = BRANCHEMENTS["/organigramme"];

VUES["/organigramme"] = function () {
  const f = etat.filtres.orga || (etat.filtres.orga = { recherche: "", dept: "", deplies: null });
  f.affichage = f.affichage || "arbre";
  const bascule = `<div class="segment" id="orga-affichage" role="group" aria-label="Affichage">
    <button data-affichage="arbre" class="${f.affichage === "arbre" ? "actif" : ""}">${ico("organigramme")} Arbre</button>
    <button data-affichage="liste" class="${f.affichage === "liste" ? "actif" : ""}">${ico("menu")} Liste</button></div>`;
  if (f.affichage === "liste") {
    return vueListeOrganigramme().replace('<h2>Organigramme Veltaris</h2>', `<h2>Organigramme Veltaris</h2>${bascule}`);
  }
  f.modeArbre = f.modeArbre || "structures";
  f.zoom = f.zoom || 1;
  const { racines, enfants } = arbreHierarchique();
  const effectif = (m) => (enfants[m] || []).reduce((s, x) => s + 1 + effectif(x.matricule), 0);
  const estResponsable = (e) => (enfants[e.matricule] || []).length > 0 || RANG_NIVEAU[niveauDe(e)] >= RANG_NIVEAU.middle_manager;
  if (!f.arbreDeplies) {
    // Premier affichage : Direction générale, DGA, directeurs de pôle et Top Managers.
    f.arbreDeplies = new Set();
    const ouvrir = (e, p) => { if (p < 3) { f.arbreDeplies.add(e.matricule); (enfants[e.matricule] || []).forEach((x) => ouvrir(x, p + 1)); } };
    racines.forEach((e) => ouvrir(e, 0));
    let c = moi();
    while (c && c.validateur && parMatricule[c.validateur]) { f.arbreDeplies.add(c.validateur); c = parMatricule[c.validateur]; }
  }
  const q = f.recherche.trim().toLowerCase();
  const correspond = (e) => q && `${e.prenom} ${e.nom} ${e.matricule} ${e.poste || ""}`.toLowerCase().includes(q);
  const chemin = new Set();
  if (q) EMPLOYES.filter(correspond).forEach((e) => {
    let c = e;
    while (c && c.validateur && parMatricule[c.validateur]) { chemin.add(c.validateur); c = parMatricule[c.validateur]; }
  });
  const carte = (e) => {
    const n = niveauDe(e);
    const sous = enfants[e.matricule] || [];
    const ouvert = f.arbreDeplies.has(e.matricule) || chemin.has(e.matricule);
    const total = effectif(e.matricule);
    const libelleNiveau = e.role === "admin" && n === "collaborateur" ? "Administration RH" : LIBELLE_NIVEAU[n];
    return `<div class="org-carte ${e.matricule === moi().matricule ? "moi" : ""} ${correspond(e) ? "trouve" : ""}" style="--n:${COULEUR_NIVEAU[n]}" id="org-${echapper(e.matricule)}">
      <div class="haut"><span class="ini">${initiales(e)}</span><div style="min-width:0"><strong>${echapper(nomComplet(e))}</strong>
        <span class="niv">${libelleNiveau}</span></div></div>
      <span class="poste">${echapper(e.poste && e.poste !== "Non renseigné" ? e.poste : nomDept(e.dept))}</span>
      ${sous.length ? `<div class="pied"><span>${total} personne(s)</span>
        <button data-arbre="${echapper(e.matricule)}" aria-expanded="${ouvert}">${ico(ouvert ? "haut" : "bas")}${ouvert ? "Replier" : `${sous.length} direct(s)`}</button></div>` : ""}
    </div>`;
  };
  const branche = (e) => {
    const sous = enfants[e.matricule] || [];
    const ouvert = f.arbreDeplies.has(e.matricule) || chemin.has(e.matricule);
    if (!sous.length || !ouvert) return `<li>${carte(e)}</li>`;
    const responsables = sous.filter(estResponsable);
    const simples = sous.filter((x) => !estResponsable(x));
    const items = responsables.map(branche);
    if (simples.length) items.push(...feuillesOrganigramme(simples, { responsable: e, mode: f.modeArbre, correspond, f }));
    return `<li>${carte(e)}<ul>${items.join("")}</ul></li>`;
  };
  const presents = [...new Set(EMPLOYES.map(niveauDe))];
  return `<div style="display:flex;flex-direction:column;gap:16px">
    <section class="carte">
      <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
        <h2>Organigramme Veltaris</h2>${bascule}
        <span class="carte-sous" style="margin-left:auto">Dessiné à partir des rattachements enregistrés par la RH</span>
      </div>
      <div class="orga-outils" style="margin-bottom:12px;flex-wrap:wrap">
        <div class="segment" role="group" aria-label="Contenu">
          <button data-mode-arbre="structures" class="${f.modeArbre === "structures" ? "actif" : ""}">Structures</button>
          <button data-mode-arbre="complet" class="${f.modeArbre === "complet" ? "actif" : ""}">Organigramme complet</button></div>
        <input class="saisie" id="arbre-recherche" placeholder="Rechercher un nom, un poste…" value="${echapper(f.recherche)}" style="max-width:240px">
        <button class="btn petit fantome" id="arbre-moins" title="Réduire">−</button>
        <span class="badge neutre" style="min-width:52px;justify-content:center">${Math.round(f.zoom * 100)} %</span>
        <button class="btn petit fantome" id="arbre-plus" title="Agrandir">+</button>
        <button class="btn petit fantome" id="arbre-ajuster">Ajuster</button>
        <button class="btn petit fantome" id="arbre-tout">${ico("bas")} Tout déplier</button>
        <button class="btn petit fantome" id="arbre-rien">${ico("haut")} Replier</button>
        <button class="btn petit" id="arbre-imprimer">${ico("telecharger")} Imprimer / PDF</button>
      </div>
      <div class="org-legende" style="margin-bottom:10px">${NIVEAUX_HIERARCHIQUES.slice().reverse().filter(([c]) => presents.includes(c))
        .map(([c, l]) => `<span style="--n:${COULEUR_NIVEAU[c]}"><i></i>${l}</span>`).join("")}</div>
      <div class="org-scene" id="org-scene"><div class="org-zoom" id="org-zoom" style="zoom:${f.zoom}">
        <ul class="org-arbre">${racines.map(branche).join("") || `<li>${etatVide("users", "Organigramme vide", "Aucun collaborateur en base.")}</li>`}</ul>
      </div></div>
      <p class="aide" style="margin-top:8px">Faites glisser pour vous déplacer, Ctrl + molette pour zoomer. « Structures » n'affiche que les responsables
        (les collaborateurs sont regroupés sous leur responsable) ; « Organigramme complet » les liste tous.</p>
    </section>
  </div>`;
};

/* Déplacement à la souris : écouteurs posés une seule fois sur la fenêtre. */
const glisseOrganigramme = { depart: null };
function memoriserVueOrganigramme(f, scene, matricule = null) {
  const largeur = Math.max(1, scene.scrollWidth);
  const hauteur = Math.max(1, scene.scrollHeight);
  const ancre = matricule ? document.getElementById(`org-${matricule}`) : null;
  const cadre = scene.getBoundingClientRect();
  const position = ancre?.getBoundingClientRect();
  f.vueArbreAConserver = {
    ratioX: (scene.scrollLeft + scene.clientWidth / 2) / largeur,
    ratioY: (scene.scrollTop + scene.clientHeight / 2) / hauteur,
    matricule,
    ancreX: position ? position.left - cadre.left : null,
    ancreY: position ? position.top - cadre.top : null,
  };
}

function restaurerVueOrganigramme(f, scene) {
  const vue = f.vueArbreAConserver;
  if (!vue) return false;
  delete f.vueArbreAConserver;
  scene.scrollLeft = Math.max(0, vue.ratioX * scene.scrollWidth - scene.clientWidth / 2);
  scene.scrollTop = Math.max(0, vue.ratioY * scene.scrollHeight - scene.clientHeight / 2);
  const ancre = vue.matricule ? document.getElementById(`org-${vue.matricule}`) : null;
  if (ancre && vue.ancreX != null && vue.ancreY != null) {
    const cadre = scene.getBoundingClientRect();
    const position = ancre.getBoundingClientRect();
    scene.scrollLeft += position.left - cadre.left - vue.ancreX;
    scene.scrollTop += position.top - cadre.top - vue.ancreY;
  }
  return true;
}
window.addEventListener("pointermove", (e) => {
  const d = glisseOrganigramme.depart;
  if (!d || !d.scene.isConnected) return;
  d.scene.scrollLeft = d.l - (e.clientX - d.x);
  d.scene.scrollTop = d.t - (e.clientY - d.y);
});
window.addEventListener("pointerup", () => {
  if (glisseOrganigramme.depart) glisseOrganigramme.depart.scene.classList.remove("glisse");
  glisseOrganigramme.depart = null;
});

BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  $$("[data-affichage]").forEach((b) => b.addEventListener("click", () => { f.affichage = b.dataset.affichage; rendre(false); }));
  if (f.affichage === "liste") return brancherListeOrganigramme();
  const scene = $("#org-scene"), zoom = $("#org-zoom");
  if (!scene) return;
  const appliquerZoom = (z) => { f.zoom = Math.min(1.6, Math.max(0.3, Math.round(z * 100) / 100)); rendre(false); };
  $$("[data-mode-arbre]").forEach((b) => b.addEventListener("click", () => { f.modeArbre = b.dataset.modeArbre; rendre(false); }));
  $$("[data-arbre]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const m = b.dataset.arbre;
    memoriserVueOrganigramme(f, scene, m);
    if (f.arbreDeplies.has(m)) f.arbreDeplies.delete(m); else f.arbreDeplies.add(m);
    rendre(false);
  }));
  $("#arbre-plus").addEventListener("click", () => appliquerZoom(f.zoom + 0.1));
  $("#arbre-moins").addEventListener("click", () => appliquerZoom(f.zoom - 0.1));
  $("#arbre-ajuster").addEventListener("click", () => {
    const naturelle = zoom.getBoundingClientRect().width / f.zoom;
    appliquerZoom((scene.clientWidth - 20) / (naturelle || 1));
  });
  $("#arbre-tout").addEventListener("click", () => { memoriserVueOrganigramme(f, scene); f.arbreDeplies = new Set(EMPLOYES.map((e) => e.matricule)); rendre(false); });
  $("#arbre-rien").addEventListener("click", () => { memoriserVueOrganigramme(f, scene); f.arbreDeplies = new Set(); rendre(false); });
  $("#arbre-imprimer").addEventListener("click", () => window.print());
  const recherche = $("#arbre-recherche");
  recherche.addEventListener("input", debounce(() => {
    f.recherche = recherche.value; rendre(false);
    const champ = $("#arbre-recherche"); champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
    const trouve = $(".org-carte.trouve, .org-feuilles .trouve");
    if (trouve) trouve.scrollIntoView({ block: "center", inline: "center" });
  }, 300));
  // Centrer la racine au premier affichage
  if (!restaurerVueOrganigramme(f, scene) && !f.arbreCentre) {
    f.arbreCentre = true;
    scene.scrollLeft = Math.max(0, (scene.scrollWidth - scene.clientWidth) / 2);
  }
  // Déplacement à la souris et zoom Ctrl + molette
  scene.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    glisseOrganigramme.depart = { scene, x: e.clientX, y: e.clientY, l: scene.scrollLeft, t: scene.scrollTop };
    scene.classList.add("glisse");
  });
  scene.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    appliquerZoom(f.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
};
