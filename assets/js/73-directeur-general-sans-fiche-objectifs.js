/* ==========================================================================
   73. DIRECTEUR GÉNÉRAL SANS FICHE D'OBJECTIFS
       Le Directeur général n'a pas de supérieur hiérarchique : il n'a ni fiche
       d'objectifs ni fiche d'évaluation. Il consulte celles du personnel.
   ========================================================================== */
const estDirecteurGeneral = () => connecte() && (moi() || {}).niveau === "dg";

const vueFichesContenuAvantDG = vueFichesContenu;
vueFichesContenu = function (type) {
  if (!estDirecteurGeneral()) return vueFichesContenuAvantDG(type);
  const f = etat.filtres.fiches || (etat.filtres.fiches = { onglet: "equipe", selection: null, recherche: "", statut: "" });
  if (f.onglet === "moi") f.onglet = "equipe";
  if (f.onglet === "equipe" && gereDesFiches()) return vueFichesContenuAvantDG(type);
  return `<section class="carte">${etatVide("cible", "Pas de fiche pour le Directeur général",
    "Le Directeur général n'a pas de supérieur hiérarchique : il n'a ni fiche d'objectifs ni fiche d'évaluation. Les fiches du personnel restent consultables.")}</section>`;
};

const ongletsFichesAvantDG = ongletsFiches;
ongletsFiches = function (f) {
  const html = ongletsFichesAvantDG(f);
  return estDirecteurGeneral() ? html.replace(/<button data-onglet="moi"[^>]*>Ma fiche<\/button>/, "") : html;
};
