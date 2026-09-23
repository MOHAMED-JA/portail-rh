/* ==========================================================================
   29. MENU MOBILE « PLUS » — toutes les rubriques en feuille glissante
   ========================================================================== */
function ouvrirMenuMobile() {
  const groupes = menuNavigation();
  ouvrirCouche(`
    <div class="feuille" role="dialog" aria-modal="true" aria-label="Toutes les rubriques">
      <div class="feuille-poignee"></div>
      <div class="feuille-corps">
        ${groupes.map((g) => `
          <div class="nav-groupe" style="padding-left:4px">${g.titre}</div>
          <div class="feuille-grille">
            ${g.items.map((i) => `
              <button class="feuille-item ${etat.route === i.route ? "actif" : ""}" data-route-mobile="${i.route}">
                ${ico(i.icone)}
                <span>${i.libelle}</span>
                ${i.pastille ? `<span class="nav-pastille">${i.pastille}</span>` : ""}
              </button>`).join("")}
          </div>`).join("")}
        <div class="nav-groupe" style="padding-left:4px">Mon compte</div>
        <div class="feuille-grille">
          <button class="feuille-item" data-route-mobile="/profil">${ico("bouclier")}<span>Mon profil</span></button>
          <button class="feuille-item" data-route-mobile="/documents">${ico("doc")}<span>Mes documents</span></button>
        </div>
      </div>
    </div>`);
  $$("[data-route-mobile]").forEach((b) => b.addEventListener("click", () => {
    fermerCouche();
    naviguer(b.dataset.routeMobile);
  }));
}
