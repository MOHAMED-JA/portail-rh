/* ==========================================================================
   77 — Le menu de gauche garde sa position de défilement
   Chaque clic sur une rubrique reconstruit toute la coque (rail compris) :
   le menu remontait en haut et il fallait redescendre pour retrouver la
   rubrique suivante. La position est relevée avant le rendu et rétablie
   aussitôt après ; la rubrique active reste visible (recherche Ctrl + K).
   La page de droite, elle, s'affiche toujours depuis son début.
   ========================================================================== */
let positionMenu = 0;

function menuPrincipal() { return $(".rail > nav"); }

const rendreAvantPositionMenu = rendre;
rendre = function (...args) {
  const avant = menuPrincipal();
  if (avant) positionMenu = avant.scrollTop;
  rendreAvantPositionMenu(...args);
  const apres = menuPrincipal();
  if (!apres || apres === avant) return;
  apres.scrollTop = positionMenu;
  const actif = $(".nav-lien.actif", apres);
  if (actif) {
    const cadre = apres.getBoundingClientRect();
    const lien = actif.getBoundingClientRect();
    if (lien.top < cadre.top || lien.bottom > cadre.bottom) actif.scrollIntoView({ block: "nearest" });
  }
};
