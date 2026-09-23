/* ==========================================================================
   76 — Barre d'état du téléphone assortie au thème
   Les balises theme-color de portail-rh.html suivent le réglage du système.
   Quand l'utilisateur force « Clair » ou « Sombre », la barre d'état doit
   suivre ce choix, sinon elle reste blanche au-dessus d'un portail noir.
   ========================================================================== */
const COULEUR_BARRE_ETAT = { light: "#FFFFFF", dark: "#121212" };

function accorderBarreEtat() {
  const choix = document.documentElement.getAttribute("data-theme");
  $$('meta[name="theme-color"]').forEach((balise) => {
    if (!balise.dataset.media) balise.dataset.media = balise.getAttribute("media") || "";
    if (COULEUR_BARRE_ETAT[choix]) {
      balise.removeAttribute("media");
      balise.setAttribute("content", COULEUR_BARRE_ETAT[choix]);
    } else {
      balise.setAttribute("media", balise.dataset.media);
      balise.setAttribute("content", balise.dataset.media.includes("dark") ? COULEUR_BARRE_ETAT.dark : COULEUR_BARRE_ETAT.light);
    }
  });
}

new MutationObserver(accorderBarreEtat).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
accorderBarreEtat();
