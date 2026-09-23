/* ==========================================================================
   37. DONNÉES DE DÉMONSTRATION EN MODE CONNECTÉ
   Notes de frais et formations ne sont pas encore enregistrées en base : en
   mode connecté, on retire les enregistrements fictifs de la démonstration
   (collaborateurs VT00xx), qui faussaient compteurs et listes.
   ========================================================================== */
const chargerDonneesAvantPurge = chargerDonneesApi;
chargerDonneesApi = async function () {
  await chargerDonneesAvantPurge();
  // Ces collections sont facultatives : les données opérationnelles viennent
  // ensuite de l'API. Un cache PWA partiel ne doit pas empêcher la connexion.
  if (typeof NOTES_FRAIS !== "undefined") {
    for (let i = NOTES_FRAIS.length - 1; i >= 0; i--) if (!parMatricule[NOTES_FRAIS[i].matricule]) NOTES_FRAIS.splice(i, 1);
  }
  if (typeof FORMATIONS !== "undefined") {
    FORMATIONS.forEach((fo) => { fo.inscrits = fo.inscrits.filter((m) => parMatricule[m]); });
  }
};
