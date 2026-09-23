/* ==========================================================================
   42. PRIÈRE DU VENDREDI, ACQUISITION MENSUELLE
   - Prière du vendredi : 13h–14h, accordée d'office et valable ensuite chaque
     vendredi, sans nouvelle demande ni accord, hors quota mensuel.
   - Congés : +2,5 jours crédités le 1er de chaque mois (serveur).
   ========================================================================== */
if (REGLES.acquisitionMensuelle === undefined) REGLES.acquisitionMensuelle = 2.5;
etat.priere = null;
async function chargerPriere() { etat.priere = connecte() ? await API.appel("/api/demandes/priere-vendredi") : etat.priere; }
const prochainVendredi = (d = AUJOURDHUI) => { let c = new Date(d); while (c.getDay() !== 5) c = ajouterJours(c, 1); return c; };

const simulerDemandeAvantPriere = simulerDemande;
simulerDemande = function (type) {
  const choix = $("#d-type");
  if (type !== "autorisation" || !choix || choix.value !== "priere_vendredi") return simulerDemandeAvantPriere(type);
  const inscrit = etat.priere && etat.priere.depuis;
  const vendredi = depuisIso($("#d-debut").value).getDay() === 5;
  $("#d-simulation").innerHTML = `<div class="carte" style="padding:14px;background:${inscrit || vendredi ? "var(--succes-doux)" : "var(--danger-doux)"}">
    <strong style="display:block;margin-bottom:4px">${ico("check")} Prière du vendredi — 13h à 14h</strong>
    <span style="font-size:12.5px;color:var(--encre-2)">${inscrit
      ? `Vous êtes déjà autorisé(e) <strong>chaque vendredi de 13h à 14h</strong> depuis le ${fmtDate(inscrit)} : aucune demande n'est nécessaire.`
      : vendredi ? `Accordée d'office, sans accord du supérieur. <strong>Ensuite, chaque vendredi de 13h à 14h</strong>, vous pourrez sortir sans nouvelle demande. Hors quota mensuel.`
      : `Choisissez un vendredi.`}</span></div>`;
};
const ouvrirDemandeAvantPriere = ouvrirDemande;
ouvrirDemande = function (type) {
  ouvrirDemandeAvantPriere(type);
  if (type !== "autorisation") return;
  chargerPriere().catch(() => {});
  const choix = $("#d-type");
  const heures = $$('#couche input[type="time"]');
  const appliquer = () => {
    const priere = choix.value === "priere_vendredi";
    heures.forEach((h) => { h.readOnly = priere; });
    if (priere) {
      heures[0].value = "13:00"; heures[1].value = "14:00";
      const date = $("#d-debut");
      if (depuisIso(date.value).getDay() !== 5) date.value = iso(prochainVendredi(depuisIso(date.value)));
    }
    simulerDemande("autorisation");
  };
  choix.addEventListener("change", appliquer);
  appliquer();
};
const soumettreDemandeAvantPriere = soumettreDemande;
soumettreDemande = function (type) {
  const choix = $("#d-type");
  if (type === "autorisation" && choix && choix.value === "priere_vendredi") {
    if (etat.priere && etat.priere.depuis) return toast("Déjà autorisé(e)", "Chaque vendredi de 13h à 14h : aucune demande n'est nécessaire.", "info");
    if (depuisIso($("#d-debut").value).getDay() !== 5) return toast("Choisissez un vendredi", "La prière du vendredi se demande pour un vendredi.", "danger");
    if (!connecte()) etat.priere = { depuis: $("#d-debut").value };
  }
  const resultat = soumettreDemandeAvantPriere(type);
  if (connecte()) setTimeout(() => chargerPriere().catch(() => {}), 1500);
  return resultat;
};
const chargerDonneesAvantPriere = chargerDonneesApi;
chargerDonneesApi = async function () { await chargerDonneesAvantPriere(); await chargerPriere().catch(() => {}); };

/* Profil : l'acquisition mensuelle est rappelée sous le solde. */
const brancherProfilAvantAcquisition = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantAcquisition();
  const ligne = [...$$("#contenu td")].find((td) => td.textContent.trim().startsWith("Solde "));
  if (ligne && ligne.nextElementSibling && !ligne.nextElementSibling.querySelector(".acq")) {
    ligne.nextElementSibling.insertAdjacentHTML("beforeend",
      `<div class="acq" style="font-size:11.5px;color:var(--encre-3)">+${fmtNombre(REGLES.acquisitionMensuelle || 2.5)} j crédités le 1er de chaque mois${etat.priere && etat.priere.depuis ? " · prière du vendredi 13h–14h autorisée" : ""}</div>`);
  }
};
