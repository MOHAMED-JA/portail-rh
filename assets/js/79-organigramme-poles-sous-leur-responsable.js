/* ==========================================================================
   79 — Organigramme : les pôles apparaissent dans l'arbre
   L'arbre suit les N+1. Quand un responsable dirige aussi un pôle distinct de
   sa propre structure (Nathalie Fabre : DGA et, par intérim, Pôle Risques
   et Pilotage), ses subordonnés de ce pôle sont regroupés sous une carte du
   pôle, au lieu d'être mélangés aux autres (Support, Technique, Commercial…).
   Carte ouverte par défaut ; « Replier » sur la carte la referme.
   ========================================================================== */
function polesDirigesPar(e) {
  return DEPARTEMENTS.filter((d) => d.responsable_id && d.responsable_id === e.id
    && d.code !== e.dept && /^pôle\b/i.test(d.nom || ""));
}

function codesSousStructure(racine) {
  const codes = new Set([racine.code]);
  let ajout = true;
  while (ajout) {
    ajout = false;
    DEPARTEMENTS.forEach((d) => {
      const parent = DEPARTEMENTS.find((p) => p.id === d.parent_id);
      if (parent && codes.has(parent.code) && !codes.has(d.code)) { codes.add(d.code); ajout = true; }
    });
  }
  return codes;
}

function descendantsOrganigramme(liste) {
  const parChef = {};
  EMPLOYES.forEach((x) => { if (x.validateur) (parChef[x.validateur] = parChef[x.validateur] || []).push(x); });
  const vus = new Set(), pile = [...liste];
  while (pile.length) {
    const x = pile.pop();
    if (vus.has(x.matricule)) continue;
    vus.add(x.matricule);
    pile.push(...(parChef[x.matricule] || []));
  }
  return [...vus].map((m) => parMatricule[m]).filter(Boolean);
}

const brancheOrganigrammeAvantPoles = brancheOrganigramme;
brancheOrganigramme = function (e, carteHtml, items, ctx) {
  const poles = ctx ? polesDirigesPar(e) : [];
  if (!poles.length) return brancheOrganigrammeAvantPoles(e, carteHtml, items, ctx);
  const f = etat.filtres.orga;
  f.polesFermes = f.polesFermes || new Set();
  const q = (f.recherche || "").trim().toLowerCase();
  let responsables = ctx.responsables, simples = ctx.simples;
  const cartesPoles = poles.map((pole) => {
    const codes = codesSousStructure(pole);
    const dedans = (x) => codes.has(x.dept);
    const resp = responsables.filter(dedans), simp = simples.filter(dedans);
    if (!resp.length && !simp.length) return "";
    responsables = responsables.filter((x) => !dedans(x));
    simples = simples.filter((x) => !dedans(x));
    const membres = descendantsOrganigramme([...resp, ...simp]);
    const trouve = q && membres.some((x) => `${x.prenom} ${x.nom} ${x.matricule} ${x.poste || ""}`.toLowerCase().includes(q));
    const ouvert = trouve || !f.polesFermes.has(pole.code);
    const titulaire = pole.responsable || nomComplet(e);
    return `<li><div class="org-carte org-pole" style="--n:${COULEUR_NIVEAU.directeur_pole}" id="org-pole:${echapper(pole.code)}">
        <div class="haut"><span class="ini">${ico("batiment")}</span><div style="min-width:0">
          <strong>${echapper(pole.nom)}</strong><span class="niv">Pôle</span></div></div>
        <span class="poste">Sous l'égide de ${echapper(titulaire)}</span>
        <div class="pied"><span>${membres.length} personne(s)</span>
          <button data-pole-orga="${echapper(pole.code)}" aria-expanded="${ouvert}">${ico(ouvert ? "haut" : "bas")}${ouvert ? "Replier" : "Afficher"}</button></div>
      </div>${ouvert ? `<ul>${[...resp.map(ctx.branche), ...(simp.length ? ctx.feuilles(simp) : [])].join("")}</ul>` : ""}</li>`;
  }).filter(Boolean);
  if (!cartesPoles.length) return brancheOrganigrammeAvantPoles(e, carteHtml, items, ctx);
  const autres = [...responsables.map(ctx.branche), ...(simples.length ? ctx.feuilles(simples) : [])];
  return brancheOrganigrammeAvantPoles(e, carteHtml, [...cartesPoles, ...autres], { ...ctx, responsables, simples });
};

const brancherOrganigrammeAvantPoles = BRANCHEMENTS["/organigramme"] || function () {};
BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  // « Tout déplier » rouvre aussi les pôles (capture : avant le redessin d'origine).
  $("#arbre-tout")?.addEventListener("click", () => { if (f) f.polesFermes = new Set(); }, true);
  brancherOrganigrammeAvantPoles();
  if (!f || f.affichage === "liste") return;
  const scene = $("#org-scene");
  $$("[data-pole-orga]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const code = b.dataset.poleOrga;
    f.polesFermes = f.polesFermes || new Set();
    if (scene) memoriserVueOrganigramme(f, scene, `pole:${code}`);
    if (f.polesFermes.has(code)) f.polesFermes.delete(code); else f.polesFermes.add(code);
    rendre(false);
  }));
};
