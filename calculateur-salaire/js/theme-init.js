/* Thème mémorisé (ou thème du système), appliqué avant l'affichage pour éviter un flash. */
(function () {
  var t = null;
  try { t = localStorage.getItem("calc-theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
})();
