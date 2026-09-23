/* ==========================================================================
   50. RÔLES RH : GESTIONNAIRE RH ET ADMINISTRATEUR RH
   Le gestionnaire mène les opérations RH ; l'administrateur seul configure le
   portail (paramètres, sécurité, rôles RH, départements, sorties, audit).
   ========================================================================== */
const menuAvantRoles = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantRoles();
  if (estGestionnaire()) groupes.forEach((g) => { g.items = g.items.filter((i) => i.route !== "/parametres"); });
  return groupes;
};
const vueParametresAvantRoles = VUES["/parametres"];
VUES["/parametres"] = function () {
  if (estGestionnaire()) return `<section class="carte">${etatVide("bouclier", "Réservé à l'administrateur RH",
    "Les paramètres du portail (règles, types de congé, jours fériés, messagerie, pointeuse) sont modifiés par l'administrateur RH.")}</section>`;
  return vueParametresAvantRoles();
};
const brancherParametresAvantRoles = BRANCHEMENTS["/parametres"];
BRANCHEMENTS["/parametres"] = function () { if (!estGestionnaire()) brancherParametresAvantRoles(); };
