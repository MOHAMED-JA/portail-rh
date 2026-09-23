/* Accueil mobile : accès immédiat aux démarches les plus fréquentes. */
const brancherVueAvantAccueilMobile = brancherVueCourante;
brancherVueCourante = function () {
  brancherVueAvantAccueilMobile();
  // Le premier rendu remplace le contenu après le squelette : insérer les
  // raccourcis ici, une fois la vraie vue installée, évite leur disparition.
  if (!connecte() || etat.route !== "/tableau-bord") return;
  const contenu = $("#contenu");
  if (!contenu) return;
  contenu.insertAdjacentHTML("afterbegin", `<section class="accueil-mobile" aria-label="Actions rapides"><button data-mobile-route="/mes-demandes">${ico("calendrier")} Mes demandes</button><button data-mobile-route="/mes-demandes?nouvelle=conge">${ico("plus")} Congé</button><button data-mobile-route="/mes-demandes?nouvelle=autorisation">${ico("plus")} Autorisation</button>${estValideur() ? `<button data-mobile-route="/validation">${ico("check")} À valider</button>` : ""}</section>`);
  $$('[data-mobile-route]', contenu).forEach((b) => b.addEventListener("click", () => naviguer(b.dataset.mobileRoute.split("?")[0])));
};
