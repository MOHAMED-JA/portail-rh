/* ==========================================================================
   72. MON PROFIL : ADRESSE PERSONNELLE ET BILAN SOCIAL INDIVIDUEL
       Chacun tient son adresse à jour ; l'administration RH est prévenue de
       chaque modification (ancienne et nouvelle adresse). Le bilan social
       individuel récapitule ce que la compagnie investit pour chacun.
   ========================================================================== */
const brancherProfilAvantAdresse = BRANCHEMENTS["/profil"] || function () {};
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantAdresse();
  const contenu = $("#contenu .vue") || $("#contenu");
  if (!contenu || $("#profil-adresse") || !connecte()) return;
  const annee = new Date().getFullYear();
  contenu.insertAdjacentHTML("beforeend", `<section class="grille" id="profil-adresse" style="grid-template-columns:repeat(auto-fit,minmax(310px,1fr));margin-top:16px">
    <article class="carte"><div class="carte-entete"><h3>Mon adresse</h3><span class="aide" id="adr-maj"></span></div>
      <form id="form-adresse" style="display:grid;gap:10px">
        <div class="champ"><label for="adr-rue">Adresse (numéro, rue, résidence)</label><input class="saisie" id="adr-rue" maxlength="255" autocomplete="street-address" required></div>
        <div class="ligne-champs"><div class="champ"><label for="adr-cp">Code postal</label><input class="saisie" id="adr-cp" maxlength="10" inputmode="numeric" autocomplete="postal-code"></div>
          <div class="champ"><label for="adr-ville">Ville</label><input class="saisie" id="adr-ville" maxlength="80" autocomplete="address-level2" required></div></div>
        <p class="aide">La Direction des Ressources Humaines est informée de chaque changement.</p>
        <p id="adr-erreur" class="msg-erreur" hidden></p>
        <div><button class="btn primaire" type="submit" id="adr-enregistrer">${ico("check")} Enregistrer mon adresse</button></div>
      </form></article>
    <article class="carte"><div class="carte-entete"><h3>Mon bilan social individuel</h3></div>
      <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Rémunération et coût employeur, formation, congés, avances et prêts : ce que la compagnie a investi pour vous sur l'année.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="saisie" id="bsi-annee" style="width:110px">${[annee, annee - 1, annee - 2].map((a) => `<option value="${a}">${a}</option>`).join("")}</select>
        <button class="btn" id="bsi-telecharger">${ico("telecharger")} Télécharger (PDF)</button></div></article>
  </section>`);

  const matricule = moi().matricule;
  sirhAppel(`/dossier/${encodeURIComponent(matricule)}`).then((d) => {
    if (!$("#adr-rue")) return;
    $("#adr-rue").value = d.adresse || "";
    $("#adr-cp").value = d.code_postal || "";
    $("#adr-ville").value = d.ville || "";
    if (d.adresse_modifiee_le) $("#adr-maj").textContent = `mise à jour le ${dateServeur(d.adresse_modifiee_le).toLocaleDateString("fr-FR")}`;
  }).catch(() => {});

  $("#form-adresse").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erreur = $("#adr-erreur");
    const bouton = $("#adr-enregistrer");
    erreur.hidden = true;
    bouton.disabled = true;
    try {
      const d = await API.appel(`/api/sirh/adresse/${encodeURIComponent(matricule)}`, { methode: "PUT", corps: {
        adresse: $("#adr-rue").value.trim(), code_postal: $("#adr-cp").value.trim() || null, ville: $("#adr-ville").value.trim() } });
      if (d.adresse_modifiee_le) $("#adr-maj").textContent = `mise à jour le ${dateServeur(d.adresse_modifiee_le).toLocaleDateString("fr-FR")}`;
      toast("Adresse enregistrée", "La RH est informée du changement.", "succes");
    } catch (souci) {
      erreur.textContent = /at least|String should/.test(souci.message) ? "Adresse (5 caractères au moins) et ville sont requises." : souci.message;
      erreur.hidden = false;
    }
    bouton.disabled = false;
  });
  $("#bsi-telecharger").addEventListener("click", () => {
    const a = $("#bsi-annee").value;
    telechargerFichier(`/api/bilan-individuel/${encodeURIComponent(matricule)}.pdf?annee=${a}`, `bilan-individuel-${a}.pdf`, "Bilan social individuel");
  });
};
