/* ==========================================================================
   43. SUPPRESSION D'UN PROFIL : SORTIE DES EFFECTIFS
   Motif (retraite, démission…), date, référence et détail. Le profil n'est
   jamais effacé : il est désactivé à la date de sortie (immédiatement ou
   automatiquement à une date future) ; son équipe et les demandes qu'il
   devait valider passent à son supérieur, à défaut à la RH.
   ========================================================================== */
const MOTIFS_SORTIE = {
  retraite: "Départ à la retraite", demission: "Démission", fin_contrat: "Fin de contrat",
  licenciement: "Licenciement", rupture_conventionnelle: "Rupture à l'amiable",
  mutation: "Mutation / détachement", deces: "Décès", autre: "Autre motif",
};
const SORTIES_DEMO = [];

function ouvrirSortie(matricule) {
  const e = parMatricule[matricule];
  if (!e || !estAdmin()) return;
  const equipe = EMPLOYES.filter((x) => x.validateur === matricule);
  const aValider = DEMANDES.filter((d) => d.statut === "en_attente" && d.validateur === matricule).length;
  const reprise = e.validateur && parMatricule[e.validateur] ? nomComplet(parMatricule[e.validateur]) : "l'administration RH";
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete"><div><h2>Supprimer le profil</h2>
        <div class="sous">${echapper(nomComplet(e))} · ${echapper(e.matricule)} · ${echapper(e.poste || "")}</div></div></div>
      <div class="modale-corps">
        <div class="ligne-champs">
          <div class="champ"><label for="so-motif">Motif de sortie</label>
            <select class="saisie" id="so-motif">${Object.entries(MOTIFS_SORTIE).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
          <div class="champ"><label for="so-date">Date de sortie</label><input class="saisie" type="date" id="so-date" value="${iso(AUJOURDHUI)}"></div>
        </div>
        <div class="champ"><label for="so-ref">Référence (décision, lettre, contrat…)</label>
          <input class="saisie" id="so-ref" placeholder="Ex. Décision DRH n° 2026/145"></div>
        <div class="champ"><label for="so-detail">Détail</label>
          <textarea class="saisie" id="so-detail" placeholder="Circonstances, dernier jour travaillé, solde de tout compte, restitution du matériel…"></textarea></div>
        <div class="bandeau-info alerte">${ico("alerte")}<span id="so-effets"></span></div>
      </div>
      <div class="modale-pied"><button class="btn" id="so-annuler">Annuler</button>
        <button class="btn danger" id="so-valider">${ico("poubelle")} Supprimer le profil</button></div>
    </div>`);
  const effets = () => {
    const futur = $("#so-date").value > iso(AUJOURDHUI);
    $("#so-effets").innerHTML = `${futur ? `<strong>Sortie programmée le ${fmtDateLongue($("#so-date").value)}</strong> : le compte reste actif jusqu'à cette date, puis est désactivé automatiquement.`
      : "<strong>Le compte est désactivé immédiatement</strong> : plus de connexion, retiré de l'annuaire et de l'organigramme."}
      L'historique (demandes, pointages, fiches) est conservé.
      ${equipe.length ? `Ses ${equipe.length} collaborateur(s) seront rattachés à <strong>${echapper(reprise)}</strong>.` : ""}
      ${aValider ? `${aValider} demande(s) qu'il devait valider seront transférées.` : ""} Ses propres demandes en attente seront annulées.`;
  };
  $("#so-date").addEventListener("input", effets);
  effets();
  $("#so-annuler").addEventListener("click", fermerCouche);
  $("#so-valider").addEventListener("click", async () => {
    const corps = { motif: $("#so-motif").value, date_sortie: $("#so-date").value,
      reference: $("#so-ref").value.trim() || null, detail: $("#so-detail").value.trim() || null };
    if (!corps.date_sortie) return toast("Date requise", "Indiquez la date de sortie.", "danger");
    const libelle = MOTIFS_SORTIE[corps.motif];
    try {
      if (connecte()) {
        const r = await API.appel(`/api/administration/employes/${e.id}/sortie`, { methode: "POST", corps });
        await chargerDonneesApi();
        toast(r.statut === "programmee" ? "Sortie programmée" : "Profil supprimé",
          `${nomComplet(e)} — ${libelle} au ${fmtDate(corps.date_sortie)}${r.repris_par && r.equipe_rattachee ? ` · équipe reprise par ${r.repris_par}` : ""}.`, "succes");
      } else {
        const futur = corps.date_sortie > iso(AUJOURDHUI);
        SORTIES_DEMO.unshift({ matricule: e.matricule, nom: e.nom, prenom: e.prenom, poste: e.poste, departement: e.dept,
          statut: futur ? "programmee" : "sorti", motif: corps.motif, motif_libelle: libelle, date_sortie: corps.date_sortie,
          reference: corps.reference, detail: corps.detail, local: e });
        if (!futur) {
          EMPLOYES.filter((x) => x.validateur === e.matricule).forEach((x) => { x.validateur = e.validateur || null; });
          e.statut = "sorti";
          EMPLOYES.splice(EMPLOYES.indexOf(e), 1);
        }
        JOURNAL.unshift({ action: "Sortie des effectifs", cible: e.matricule, acteur: moi().matricule, detail: `${libelle} au ${fmtDate(corps.date_sortie)}`, date: new Date() });
        toast(futur ? "Sortie programmée" : "Profil supprimé", `${nomComplet(e)} — ${libelle}.`, "succes");
      }
      etat.sortiesListe = null;
      fermerCouche();
      rendre(false);
    } catch (souci) { toast("Suppression refusée", souci.message, "danger"); }
  });
}

function adminSorties(f) {
  if (connecte() && !etat.sortiesListe) {
    API.appel("/api/administration/sorties").then((l) => { etat.sortiesListe = l; if (etat.route === "/administration") rendre(false); })
      .catch((souci) => toast("Liste indisponible", souci.message, "danger"));
    return `<div class="squelette" style="height:200px;border-radius:14px"></div>`;
  }
  const liste = connecte() ? etat.sortiesListe : SORTIES_DEMO;
  if (!liste.length) return etatVide("users", "Aucune sortie", "Les profils supprimés (retraite, démission…) et les sorties programmées apparaîtront ici.");
  return `<div class="tableau-boite"><table style="min-width:860px">
    <thead><tr><th>Collaborateur</th><th>Motif</th><th>Date de sortie</th><th>Référence</th><th>Détail</th><th>État</th><th class="droite">Action</th></tr></thead>
    <tbody>${liste.map((x) => `<tr>
      <td><strong style="font-size:13px">${echapper(x.prenom + " " + x.nom)}</strong><div style="font-size:11.5px;color:var(--encre-3)"><span class="mono">${echapper(x.matricule)}</span> · ${echapper(x.poste || "")}</div></td>
      <td>${echapper(x.motif_libelle)}</td>
      <td class="mono">${x.date_sortie ? fmtDate(String(x.date_sortie)) : "—"}</td>
      <td style="font-size:12.5px">${echapper(x.reference || "—")}</td>
      <td style="font-size:12.5px;max-width:260px">${echapper(x.detail || "—")}</td>
      <td>${x.statut === "programmee" ? `<span class="badge attente">${ico("horloge")} Programmée</span>` : `<span class="badge annulee">Sorti</span>`}</td>
      <td class="droite"><button class="btn petit" data-reintegrer="${echapper(x.matricule)}" data-id="${x.id || ""}">${ico("fleche")} ${x.statut === "programmee" ? "Annuler la sortie" : "Réintégrer"}</button></td>
    </tr>`).join("")}</tbody></table></div>
    <p style="font-size:12px;color:var(--encre-3);margin-top:10px">Une réintégration réactive le compte ; son rattachement hiérarchique et son équipe se redéfinissent dans l'onglet « Affectations ».</p>`;
}

const brancherAdministrationAvantSorties = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdministrationAvantSorties) brancherAdministrationAvantSorties();
  $$("[data-supprimer-profil]").forEach((b) => b.addEventListener("click", () => ouvrirSortie(b.dataset.supprimerProfil)));
  $$("[data-reintegrer]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.reintegrer;
    try {
      if (connecte()) {
        await API.appel(`/api/administration/employes/${b.dataset.id}/reintegrer`, { methode: "POST" });
        await chargerDonneesApi();
      } else {
        const i = SORTIES_DEMO.findIndex((x) => x.matricule === m);
        const x = SORTIES_DEMO.splice(i, 1)[0];
        if (x.local && !EMPLOYES.includes(x.local)) { x.local.statut = "actif"; EMPLOYES.push(x.local); }
      }
      etat.sortiesListe = null;
      toast("Profil réintégré", `${m} peut de nouveau se connecter.`, "succes");
      rendre(false);
    } catch (souci) { toast("Réintégration refusée", souci.message, "danger"); }
  }));
};
const naviguerAvantSorties = naviguer;
naviguer = function (route) { if (route === "/administration") etat.sortiesListe = null; return naviguerAvantSorties(route); };
