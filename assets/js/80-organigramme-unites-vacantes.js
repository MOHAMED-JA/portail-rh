/* ==========================================================================
   80 — Organigramme : les unités vacantes apparaissent dans l'arbre
   L'arbre ne dessinait une structure que pour y regrouper des personnes : une
   unité sans personne ni responsable (Département Service Clients, Front
   Office Banque Exemple, Département Données…) restait invisible. Elle s'affiche
   désormais en carte « Poste vacant », sous le responsable de la structure
   qui la contient (premier parent doté d'un responsable), rangée par ordre
   alphabétique parmi ses unités sœurs : Relation Clients à droite
   d'Animation Réseau, sous Nathalie Fabre.
   ========================================================================== */
function unitesVacantes() {
  const avecPersonnel = new Set(EMPLOYES.map((x) => x.dept));
  const parents = new Set(DEPARTEMENTS.map((d) => d.parent_id).filter(Boolean));
  return DEPARTEMENTS.filter((d) => !d.responsable_id && !avecPersonnel.has(d.code) && !parents.has(d.id));
}

// Premier parent qui a un responsable : c'est sous lui que l'unité s'affiche.
function titulaireUnite(d) {
  let parent = DEPARTEMENTS.find((p) => p.id === d.parent_id);
  const vus = new Set();
  while (parent && !vus.has(parent.id)) {
    vus.add(parent.id);
    if (parent.responsable_id) return EMPLOYES.find((x) => x.id === parent.responsable_id) || null;
    parent = DEPARTEMENTS.find((p) => p.id === parent.parent_id);
  }
  return null;
}

function vacantesSous(e) {
  return unitesVacantes().filter((d) => titulaireUnite(d)?.matricule === e.matricule);
}

function carteUniteVacante(d) {
  return `<li><div class="org-carte org-structure org-vacante" style="--n:var(--encre-3)" id="org-vac:${echapper(d.code)}">
    <div class="haut"><span class="ini">${ico("batiment")}</span><div style="min-width:0">
      <strong>${echapper(d.nom)}</strong><span class="niv">Structure</span></div></div>
    <div class="pied"><span>Poste vacant · aucune personne</span></div></div></li>`;
}

// Parmi les blocs de structure d'un responsable : à côté des unités sœurs.
const feuillesOrganigrammeAvantVacantes = feuillesOrganigramme;
feuillesOrganigramme = function (simples, options) {
  const blocs = feuillesOrganigrammeAvantVacantes(simples, options);
  if (!options || !options.responsable) return blocs;
  const presentes = [...new Set(simples.map((x) => x.dept || ""))];
  const parentDe = (code) => (DEPARTEMENTS.find((d) => d.code === code) || {}).parent_id;
  const soeurs = vacantesSous(options.responsable).filter((v) => presentes.some((c) => c && parentDe(c) === v.parent_id));
  if (!soeurs.length) return blocs;
  // Les blocs sont triés par nom de structure : on insère chaque unité à son rang.
  const noms = presentes.map((c) => (c ? nomDept(c) : "Sans structure")).sort((a, b) => a.localeCompare(b, "fr"));
  const lignes = blocs.map((html, i) => ({ nom: noms[i] || "", html }));
  soeurs.forEach((v) => lignes.push({ nom: v.nom, html: carteUniteVacante(v) }));
  return lignes.sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((l) => l.html);
};

// Unité sans unité sœur affichée : en fin de branche du responsable. Les
// modules 78 et 79 redessinent certaines branches : on se fie au HTML final.
const brancheOrganigrammeAvantVacantes = brancheOrganigramme;
brancheOrganigramme = function (e, carteHtml, items, ctx) {
  const html = brancheOrganigrammeAvantVacantes(e, carteHtml, items, ctx);
  const reste = ctx ? vacantesSous(e).filter((d) => !html.includes(`id="org-vac:${d.code}"`)) : [];
  if (!reste.length || !html.endsWith("</ul></li>")) return html;
  const cartes = reste.sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map(carteUniteVacante).join("");
  return html.slice(0, -"</ul></li>".length) + cartes + "</ul></li>";
};
