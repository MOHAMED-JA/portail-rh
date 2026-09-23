/* ==========================================================================
   74. ORGANIGRAMME : COLLABORATEURS REGROUPÉS PAR STRUCTURE
       Sous chaque responsable, les collaborateurs sans équipe apparaissent
       dans un bloc par structure (« Moyens Généraux », « Département
       Inspection », « Secrétariat »…), replié par défaut : un clic affiche
       les noms. Une recherche déplie le bloc qui contient la personne.
   ========================================================================== */
const cleGroupeOrga = (responsable, dept) => `${responsable.matricule}|${dept || "-"}`;

feuillesOrganigramme = function (simples, { responsable, correspond, f }) {
  f.groupesDeplies = f.groupesDeplies || new Set();
  const groupes = new Map();
  simples.forEach((x) => {
    const dept = x.dept || "";
    if (!groupes.has(dept)) groupes.set(dept, []);
    groupes.get(dept).push(x);
  });
  const nomGroupe = (dept) => (dept ? nomDept(dept) : "Sans structure");
  return [...groupes.entries()]
    .sort(([a], [b]) => nomGroupe(a).localeCompare(nomGroupe(b), "fr"))
    .map(([dept, liste]) => {
      const cle = cleGroupeOrga(responsable, dept);
      // Le responsable dirige déjà cette structure : répéter son nom au-dessus
      // de ses collaborateurs directs n'apprend rien et alourdit le dessin.
      const memeStructure = dept === (responsable.dept || "");
      const trouve = liste.some(correspond);
      const ouvert = memeStructure || f.groupesTous || f.groupesDeplies.has(cle) || trouve;
      liste.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr"));
      return `<li><div class="org-carte org-structure ${trouve ? "trouve" : ""}" style="--n:var(--encre-3)" id="org-grp:${echapper(cle)}">
        ${memeStructure ? "" : `<div class="haut"><span class="ini">${ico("batiment")}</span><div style="min-width:0">
          <strong>${echapper(nomGroupe(dept))}</strong><span class="niv">Structure</span></div></div>`}
        ${ouvert ? `<div class="org-noms">${liste.map((x) => `<div class="${correspond(x) ? "trouve" : ""}">
            <span class="ini" style="background:${COULEUR_NIVEAU[niveauDe(x)]}">${initiales(x)}</span>
            <span style="min-width:0"><strong>${echapper(nomComplet(x))}</strong><small>${echapper((x.poste || "").split(" — ")[0] || LIBELLE_NIVEAU[niveauDe(x)] || "")}</small></span></div>`).join("")}</div>` : ""}
        <div class="pied"><span>${liste.length} personne(s)</span>
          ${memeStructure ? "" : `<button data-groupe-orga="${echapper(cle)}" aria-expanded="${ouvert}">${ico(ouvert ? "haut" : "bas")}${ouvert ? "Replier" : "Afficher"}</button>`}</div>
      </div></li>`;
    });
};

const brancherOrganigrammeAvantGroupes = BRANCHEMENTS["/organigramme"] || function () {};
BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  // Avant les écouteurs d'origine (qui redessinent aussitôt) : phase de capture.
  $("#arbre-tout")?.addEventListener("click", () => { f.groupesTous = true; }, true);
  $("#arbre-rien")?.addEventListener("click", () => { f.groupesTous = false; f.groupesDeplies = new Set(); }, true);
  brancherOrganigrammeAvantGroupes();
  if (!f || f.affichage === "liste") return;
  const scene = $("#org-scene");
  $$("[data-groupe-orga]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const cle = b.dataset.groupeOrga;
    if (f.groupesTous) {
      // « Tout déplier » était actif : on garde les autres blocs ouverts.
      f.groupesTous = false;
      f.groupesDeplies = new Set($$("[data-groupe-orga]").map((x) => x.dataset.groupeOrga));
    }
    f.groupesDeplies = f.groupesDeplies || new Set();
    if (scene) memoriserVueOrganigramme(f, scene, `grp:${cle}`);
    if (f.groupesDeplies.has(cle)) f.groupesDeplies.delete(cle); else f.groupesDeplies.add(cle);
    rendre(false);
  }));
};
