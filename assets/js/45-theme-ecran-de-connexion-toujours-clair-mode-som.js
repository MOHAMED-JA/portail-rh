/* ==========================================================================
   45. THÈME : ÉCRAN DE CONNEXION TOUJOURS CLAIR, MODE SOMBRE NOIR
   ========================================================================== */
/* Plus de bascule clair / sombre sur l'écran de connexion. */
selecteurTheme = () => "";

/* Le thème choisi (clair, sombre ou système) ne s'applique qu'une fois
   connecté ; l'écran de connexion reste en mode clair, sans toucher au choix
   enregistré. */
function appliquerThemeEcran() {
  const racine = document.documentElement;
  const voulu = etat.utilisateur ? stockage.lire("portail-theme", "light") : "light";
  if (racine.getAttribute("data-theme") !== voulu) racine.setAttribute("data-theme", voulu);
}
const rendreAvantThemeEcran = rendre;
rendre = function (...args) {
  appliquerThemeEcran();
  return rendreAvantThemeEcran(...args);
};
const themeActifAvantSysteme = themeActif;
themeActif = function () {
  const t = themeActifAvantSysteme();
  if (t === "systeme") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return t;
};
/* « Système » dans Mon profil : le choix est mémorisé comme tel. */
const brancherProfilAvantTheme = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantTheme();
  const systeme = $('[data-theme-choix="systeme"]');
  if (systeme) systeme.addEventListener("click", () => { stockage.ecrire("portail-theme", "systeme"); rendre(false); });
};
appliquerThemeEcran();
