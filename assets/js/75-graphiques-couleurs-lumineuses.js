/* ==========================================================================
   75. GRAPHIQUES AUX COULEURS LUMINEUSES
       Refonte 1.35 : les séries « marine » des graphiques (barres d'heures,
       congés…) prennent le bleu vif de la charte (--fx-graphe) ; en mode
       sombre, le jeton reprend le bleu habituel.
   ========================================================================== */
const habillageAvantCouleursLumineuses = habillage;
habillage = function () {
  const h = habillageAvantCouleursLumineuses();
  const bleuVif = couleurCss("--fx-graphe");
  return bleuVif ? { ...h, marine: bleuVif } : h;
};
