/* ==========================================================================
   60. REMPLACEMENT D'UN RESPONSABLE
   Prévisualise puis transfère en une transaction la structure, l'équipe et les
   demandes en attente. La sortie des effectifs reste une opération distincte.
   ========================================================================== */
function blocRemplacementResponsable(f) {
  if (!connecte() || estGestionnaire()) return "";
  const choix = f.remplacementResponsable || (f.remplacementResponsable = { responsable: "", remplacant: "" });
  const actifs = EMPLOYES.filter((e) => e.statut !== "sorti")
    .slice().sort((a, b) => nomComplet(a).localeCompare(nomComplet(b), "fr"));
  const options = (selection, exclu = "") => actifs.filter((e) => e.matricule !== exclu).map((e) =>
    `<option value="${e.id}" ${String(e.id) === String(selection) ? "selected" : ""}>${echapper(nomComplet(e))} · ${echapper(e.matricule)} · ${echapper(e.poste || "Poste non renseigné")}</option>`).join("");
  const rapport = etat.remplacementResponsableRapport;
  return `<details class="carte" style="box-shadow:none;margin-bottom:14px" ${rapport || choix.responsable || choix.remplacant ? "open" : ""}>
    <summary style="cursor:pointer"><strong>${ico("organigramme")} Remplacer un responsable</strong>
      <span class="aide">Structure, équipe et demandes en attente en une seule opération</span></summary>
    <div style="padding-top:14px">
      <div class="bandeau-info" style="margin-bottom:14px">${ico("alerte")}<span>Cette passation ne met pas le responsable sortant à la retraite. Enregistrez ensuite sa date de sortie dans l'onglet <strong>Sorties</strong>.</span></div>
      <div class="grille" style="grid-template-columns:1fr 1fr;align-items:end">
        <div class="champ"><label for="rr-responsable">Responsable à remplacer</label><select class="saisie" id="rr-responsable"><option value="">Choisir…</option>${options(choix.responsable)}</select></div>
        <div class="champ"><label for="rr-remplacant">Nouveau responsable</label><select class="saisie" id="rr-remplacant"><option value="">Choisir…</option>${options(choix.remplacant, actifs.find((e) => String(e.id) === String(choix.responsable))?.matricule || "")}</select></div>
      </div>
      <button class="btn primaire" id="rr-previsualiser" style="margin-top:12px" ${choix.responsable && choix.remplacant ? "" : "disabled"}>${ico("loupe")} Prévisualiser la passation</button>
      ${rapport ? `<div style="margin-top:16px">
        <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
          ${carteKpi({ cle: "rr1", libelle: "Structures", valeur: rapport.structures.length, unite: "", icone: "organigramme", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "responsabilité transférée" })}
          ${carteKpi({ cle: "rr2", libelle: "Collaborateurs", valeur: rapport.collaborateurs.length, unite: "", icone: "users", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "nouveau N+1" })}
          ${carteKpi({ cle: "rr3", libelle: "Demandes", valeur: rapport.demandes_en_attente, unite: "", icone: "doc", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: "en attente transférée(s)" })}
        </div>
        <p style="margin:12px 0"><strong>${echapper(rapport.responsable.nom)}</strong> sera remplacé par <strong>${echapper(rapport.remplacant.nom)}</strong>.</p>
        ${rapport.changements_profil.length ? `<p class="aide">Profil du remplaçant : ${rapport.changements_profil.map(echapper).join(" · ")}.</p>` : ""}
        ${rapport.demandes_personnelles_reorientees ? `<p class="aide">${rapport.demandes_personnelles_reorientees} demande personnelle du remplaçant sera réorientée pour éviter une auto-validation.</p>` : ""}
        ${rapport.structures.length ? `<p class="aide"><strong>Structures :</strong> ${rapport.structures.map((d) => echapper(d.nom)).join(" · ")}</p>` : ""}
        ${rapport.collaborateurs.length ? `<p class="aide"><strong>Équipe directe :</strong> ${rapport.collaborateurs.map((e) => echapper(e.nom)).join(" · ")}</p>` : ""}
        <button class="btn succes" id="rr-appliquer" style="margin-top:12px" ${rapport.total_changements ? "" : "disabled"}>${ico("valider")} Confirmer et transférer les responsabilités</button>
      </div>` : ""}
    </div>
  </details>`;
}

const adminAffectationsAvantRemplacement = adminAffectations;
adminAffectations = function (f) {
  return blocRemplacementResponsable(f) + adminAffectationsAvantRemplacement(f);
};

const brancherAdminAvantRemplacement = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdminAvantRemplacement) brancherAdminAvantRemplacement();
  const f = etat.filtres.admin;
  if (!f || f.onglet !== "affectations" || !connecte() || estGestionnaire()) return;
  const choix = f.remplacementResponsable;
  const responsable = $("#rr-responsable"), remplacant = $("#rr-remplacant");
  const changer = () => {
    choix.responsable = responsable.value;
    choix.remplacant = remplacant.value;
    etat.remplacementResponsableRapport = null;
    rendre(false);
  };
  responsable?.addEventListener("change", changer);
  remplacant?.addEventListener("change", changer);
  $("#rr-previsualiser")?.addEventListener("click", async () => {
    try {
      etat.remplacementResponsableRapport = await API.appel("/api/administration/remplacer-responsable?simulation=true", {
        methode: "POST", corps: { responsable_id: Number(choix.responsable), remplacant_id: Number(choix.remplacant) },
      });
      rendre(false);
    } catch (souci) { toast("Passation impossible", souci.message, "danger"); }
  });
  $("#rr-appliquer")?.addEventListener("click", async () => {
    const r = etat.remplacementResponsableRapport;
    if (!r || !confirm(`Transférer les responsabilités de ${r.responsable.nom} à ${r.remplacant.nom} ?`)) return;
    const bouton = $("#rr-appliquer"); bouton.disabled = true; bouton.textContent = "Transfert en cours…";
    try {
      const resultat = await API.appel("/api/administration/remplacer-responsable?simulation=false", {
        methode: "POST", corps: { responsable_id: Number(choix.responsable), remplacant_id: Number(choix.remplacant) },
      });
      await Promise.all([chargerDonneesApi(), rechargerDepartements()]);
      structuresOrganisation = null;
      etat.suiviFiches = null;
      etat.remplacementResponsableRapport = null;
      f.remplacementResponsable = { responsable: "", remplacant: "" };
      toast("Passation terminée", `${resultat.collaborateurs.length} collaborateur(s), ${resultat.structures.length} structure(s) et ${resultat.demandes_en_attente} demande(s) transférés.`, "succes");
      rendre(false);
    } catch (souci) { bouton.disabled = false; bouton.textContent = "Confirmer et transférer les responsabilités"; toast("Transfert refusé", souci.message, "danger"); }
  });
};
