/* ==========================================================================
   58. IMPORT EXCEL RH EN MASSE
   Modèle prérempli, prévisualisation sans écriture, validation atomique,
   sauvegarde avant application et journal d'audit.
   ========================================================================== */
let fichierImportRH = null;

function blocImportRH() {
  if (!connecte()) return "";
  const rapport = etat.importRH;
  const erreurs = rapport && rapport.erreurs ? rapport.erreurs : [];
  const apercu = rapport && rapport.apercu ? rapport.apercu : [];
  return `<article class="carte" style="box-shadow:none;grid-column:1/-1">
    <div class="carte-entete">
      <div class="kpi-ico" style="background:var(--violet-doux);color:var(--violet)">${ico("users")}</div>
      <div><h3>Affectations et dossiers RH en masse</h3>
      <div class="sous">Classeur prérempli · contrôle complet avant écriture · sauvegarde automatique</div></div>
    </div>
    <div class="grille" style="grid-template-columns:minmax(260px,.8fr) minmax(320px,1.2fr);align-items:start">
      <div>
        <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Téléchargez le modèle, complétez les cellules jaunes puis prévisualisez les changements. Le mot <strong>EFFACER</strong> retire explicitement une valeur existante.</p>
        <button class="btn btn-bloc" id="telecharger-modele-rh">${ico("telecharger")} Télécharger le modèle prérempli</button>
        <div class="champ" style="margin-top:14px"><label for="fichier-import-rh">Classeur complété (.xlsx)</label>
          <input class="saisie" type="file" id="fichier-import-rh" accept=".xlsx" data-formats-donnees></div>
        <button class="btn primaire btn-bloc" id="previsualiser-import-rh" style="margin-top:12px">${ico("loupe")} Prévisualiser sans écrire</button>
      </div>
      <div id="rapport-import-rh">
        ${!rapport ? etatVide("import", "Aucun classeur contrôlé", "La prévisualisation affiche les erreurs et les champs qui seront modifiés.") : `
          <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
            ${carteKpi({ cle: "irh1", libelle: "Collaborateurs", valeur: rapport.collaborateurs_modifies || 0, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "avec changement" })}
            ${carteKpi({ cle: "irh2", libelle: "Champs", valeur: rapport.champs_modifies || 0, unite: "", icone: "doc", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "à mettre à jour" })}
            ${carteKpi({ cle: "irh3", libelle: "Erreurs", valeur: erreurs.length, unite: "", icone: "alerte", couleur: erreurs.length ? "var(--danger)" : "var(--succes)", fond: erreurs.length ? "var(--danger-doux)" : "var(--succes-doux)", detail: erreurs.length ? "à corriger" : "classeur valide" })}
          </div>
          ${erreurs.length ? `<div class="msg-erreur" style="display:block;margin-bottom:12px"><strong>Import refusé tant que ces erreurs subsistent :</strong><ul style="margin:8px 0 0 18px">${erreurs.slice(0, 20).map((e) => `<li>${echapper(e)}</li>`).join("")}</ul>${erreurs.length > 20 ? `<p>… et ${erreurs.length - 20} autre(s).</p>` : ""}</div>` : ""}
          ${apercu.length ? `<div class="tableau-boite" style="max-height:280px"><table><thead><tr><th>Matricule</th><th>Collaborateur</th><th>Champs modifiés</th></tr></thead><tbody>${apercu.map((a) => `<tr><td class="mono">${echapper(a.matricule)}</td><td>${echapper(a.nom)}</td><td>${a.champs.map((c) => `<span class="badge neutre">${echapper(c)}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table></div>` : etatVide("doc", "Aucun changement", "Le classeur correspond déjà aux données enregistrées.")}
          ${rapport.valide && apercu.length ? `<button class="btn succes btn-bloc" id="appliquer-import-rh" style="margin-top:12px">${ico("valider")} Appliquer ${apercu.length} mise(s) à jour</button>` : ""}
          ${rapport.sauvegarde ? `<p class="aide" style="margin-top:8px">Sauvegarde créée : <span class="mono">${echapper(rapport.sauvegarde)}</span></p>` : ""}`}
      </div>
    </div>
  </article>`;
}

const adminImportAvantExcelRH = adminImport;
adminImport = function () {
  const html = adminImportAvantExcelRH();
  return html.replace('<div class="grille"', `<div class="grille">${blocImportRH()}</div><div class="grille"`);
};

const brancherAdminAvantImportRH = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdminAvantImportRH) brancherAdminAvantImportRH();
  if (!etat.filtres.admin || etat.filtres.admin.onglet !== "import" || !connecte()) return;
  const modele = $("#telecharger-modele-rh");
  if (modele) modele.addEventListener("click", () => telechargerFichier(
    "/api/administration/import-rh/modele.xlsx", "import-rh-affectations-dossiers.xlsx", "Modèle d'import RH"));
  const champ = $("#fichier-import-rh");
  if (champ) champ.addEventListener("change", () => { fichierImportRH = champ.files[0] || null; etat.importRH = null; });
  const previsualiser = $("#previsualiser-import-rh");
  if (previsualiser) previsualiser.addEventListener("click", async () => {
    fichierImportRH = (champ && champ.files[0]) || fichierImportRH;
    if (!fichierImportRH) return toast("Aucun fichier", "Sélectionnez le classeur Excel complété.", "danger");
    if (!fichierImportRH.name.toLowerCase().endsWith(".xlsx")) return toast("Format non compatible", "Le modèle d'import RH doit rester au format .xlsx.", "danger");
    previsualiser.disabled = true; previsualiser.textContent = "Contrôle en cours…";
    try {
      etat.importRH = await televerser("/api/administration/import-rh?simulation=true", fichierImportRH);
      toast(etat.importRH.valide ? "Classeur contrôlé" : "Corrections nécessaires",
        etat.importRH.valide ? `${etat.importRH.collaborateurs_modifies} collaborateur(s) seront mis à jour.` : `${etat.importRH.erreurs.length} erreur(s) détectée(s).`,
        etat.importRH.valide ? "succes" : "danger");
    } catch (souci) { toast("Contrôle impossible", souci.message, "danger"); }
    rendre(false);
  });
  const appliquer = $("#appliquer-import-rh");
  if (appliquer) appliquer.addEventListener("click", async () => {
    if (!fichierImportRH || !confirm(`Appliquer les changements à ${etat.importRH.collaborateurs_modifies} collaborateur(s) ? Une sauvegarde sera créée avant l'écriture.`)) return;
    appliquer.disabled = true; appliquer.textContent = "Application en cours…";
    try {
      etat.importRH = await televerser("/api/administration/import-rh?simulation=false", fichierImportRH);
      await Promise.all([chargerDonneesApi(), chargerJournal()]);
      toast("Import terminé", `${etat.importRH.appliques} collaborateur(s) mis à jour.`, "succes");
      fichierImportRH = null;
    } catch (souci) { toast("Import refusé", souci.message, "danger"); }
    rendre(false);
  });
};
