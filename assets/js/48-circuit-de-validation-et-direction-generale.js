/* ==========================================================================
   48. CIRCUIT DE VALIDATION ET DIRECTION GÉNÉRALE
   Le supérieur hiérarchique décide en premier ; le DGA voit les demandes de
   sa ligne et peut valider à défaut ; le DG consulte sans file de décision.
   ========================================================================== */
const demandesAValiderAvantDirection = demandesAValider;
demandesAValider = function () {
  const u = moi();
  if (!u || estAdmin()) return demandesAValiderAvantDirection();
  if (u.niveau === "dg") return [];
  const enAttente = DEMANDES.filter((d) => d.statut === "en_attente" && d.matricule !== u.matricule);
  if (u.niveau === "dga") return enAttente;
  const equipe = new Set(equipeDe(u.matricule).map((e) => e.matricule));
  return enAttente.filter((d) => d.validateur === u.matricule || equipe.has(d.matricule));
};
const menuAvantCircuit = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantCircuit();
  if ((moi() || {}).niveau === "dg") groupes.forEach((g) => { g.items = g.items.filter((i) => i.route !== "/validation"); });
  return groupes;
};
