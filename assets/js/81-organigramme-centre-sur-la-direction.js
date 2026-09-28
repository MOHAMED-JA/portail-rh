/* ==========================================================================
   81 — Organigramme : affichage centré sur la Direction générale
   Changer d'affichage (Structures, Organigramme complet, Arbre, zoom…)
   recrée le dessin : la barre de défilement repartait tout à gauche, loin
   du sommet. L'arbre se centre désormais sur la carte du Directeur général,
   en haut, avec la DGA juste en dessous. Déplier ou replier une branche
   conserve toujours la position de lecture (module 47).
   ========================================================================== */
function centrerOrganigrammeSurDirection(scene) {
  const dg = EMPLOYES.find((x) => niveauDe(x) === "dg");
  const carte = (dg && document.getElementById(`org-${dg.matricule}`)) || scene.querySelector(".org-arbre .org-carte");
  if (!carte) return;
  const cadre = scene.getBoundingClientRect();
  const position = carte.getBoundingClientRect();
  scene.scrollLeft = Math.max(0, scene.scrollLeft + position.left - cadre.left + position.width / 2 - scene.clientWidth / 2);
  scene.scrollTop = 0;
}

const brancherOrganigrammeAvantCentrage = BRANCHEMENTS["/organigramme"] || function () {};
BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  // Position à restaurer (dépliage, repliage) : le module 47 s'en charge.
  const positionConservee = !!(f && f.vueArbreAConserver);
  brancherOrganigrammeAvantCentrage();
  const scene = $("#org-scene");
  if (!scene || !f || f.affichage === "liste" || positionConservee) return;
  centrerOrganigrammeSurDirection(scene);
};
