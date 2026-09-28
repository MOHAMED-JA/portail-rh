/* ==========================================================================
   78 — Ordre alphabétique, DGA sous le DG, consultation de sa fiche
   1. Le personnel est classé de A à Z sur le nom affiché (« Prénom Nom ») :
      annuaire, listes déroulantes et toutes les vues bâties sur EMPLOYES.
   2. Organigramme : la Direction générale déléguée s'affiche seule, juste
      sous le Directeur général ; les autres personnes rattachées au DG
      (audit, secrétariat…) apparaissent dans un encadré à côté de lui.
   3. Le badge « Votre fiche » ouvre la fiche d'objectifs complète, en
      lecture seule, avec impression.
   ========================================================================== */

/* --- 1. Ordre alphabétique ------------------------------------------------ */
EMPLOYES.sort(compareNoms);  // données de démonstration

const chargerDonneesAvantTri = chargerDonneesApi;
chargerDonneesApi = async function (...args) {
  const resultat = await chargerDonneesAvantTri(...args);
  EMPLOYES.sort(compareNoms);
  return resultat;
};

/* --- 2. DGA juste sous le DG ---------------------------------------------- */
const brancheOrganigrammeAvantDga = brancheOrganigramme;
brancheOrganigramme = function (e, carteHtml, items, ctx) {
  if (!ctx || niveauDe(e) !== "dg") return brancheOrganigrammeAvantDga(e, carteHtml, items, ctx);
  const adjoints = ctx.responsables.filter((x) => niveauDe(x) === "dga");
  const autres = ctx.responsables.filter((x) => niveauDe(x) !== "dga");
  const lateraux = [...autres.map(ctx.branche), ...(ctx.simples.length ? ctx.feuilles(ctx.simples) : [])];
  if (!adjoints.length || !lateraux.length) return brancheOrganigrammeAvantDga(e, carteHtml, items, ctx);
  // Grille 1fr | carte | 1fr : la carte du DG reste centrée au-dessus de la DGA.
  return `<li><div class="org-tete-dg"><span></span>
      <div class="org-tete-centre">${carteHtml}</div>
      <div class="org-lateral"><span class="org-lateral-titre">Rattachés à la Direction générale</span>
        <ul class="org-lateral-liste">${lateraux.join("")}</ul></div></div>
    <ul>${adjoints.map(ctx.branche).join("")}</ul></li>`;
};

/* --- 3. « Votre fiche » : consultation complète ------------------------- */
const enteteFicheAvantConsultation = enteteFiche;
enteteFiche = function (fiche, type) {
  const html = enteteFicheAvantConsultation(fiche, type);
  if (!fiche.droits.proprietaire) return html;
  return html.replace('<span class="badge neutre">Votre fiche</span>',
    `<button type="button" class="badge neutre badge-bouton" id="fiche-consulter" title="Afficher votre fiche d'objectifs complète">${ico("oeil")} Votre fiche</button>`);
};

function lignesFicheConsultation(o) {
  return o.liste.map((x, i) => `<tr><td class="num">${i + 1}</td>
    <td><strong>${echapper(x.titre)}</strong>${x.description ? `<div class="aide">${echapper(x.description)}</div>` : ""}</td>
    <td>${echapper(x.indicateur || "—")}</td><td class="droite">${noteFr(x.ponderation)} %</td></tr>`).join("");
}

function mentionValidation(o) {
  if (o.statut !== "validee") return "";
  return `Validée${o.validee_par ? ` par ${o.validee_par.prenom} ${o.validee_par.nom}` : ""}${o.validee_le ? ` le ${fmtDate(o.validee_le.slice(0, 10))}` : ""}`
    + `${o.modifiee_par_superieur ? " — modifiée par le supérieur hiérarchique" : ""}.`;
}

function ouvrirFicheConsultation(fiche) {
  const o = fiche.objectifs, e = fiche.employe;
  const [cls, libelle] = STATUTS_OBJECTIFS[o.statut] || ["neutre", o.statut];
  const validee = o.statut === "validee";
  ouvrirCouche(`<div class="modale large" role="dialog" aria-modal="true" aria-labelledby="fc-titre">
    <div class="modale-tete"><div><h2 id="fc-titre">Fiche d'objectifs ${fiche.annee}</h2>
      <div class="sous">${echapper(e.prenom + " " + e.nom)} · matricule ${echapper(e.matricule)} · supérieur hiérarchique :
        ${fiche.superieur ? echapper(fiche.superieur.prenom + " " + fiche.superieur.nom) : "administration RH"}</div></div>
      <span class="badge ${cls}" style="margin-left:auto">${libelle}</span></div>
    <div class="modale-corps">
      <div class="bandeau-info ${validee ? "succes" : "info"}">${ico(validee ? "check" : "oeil")}<span>${validee
        ? `<strong>Consultation seule.</strong> ${echapper(mentionValidation(o))} Une fiche validée n'est plus modifiable.`
        : "<strong>Consultation.</strong> Tant qu'elle n'est pas validée, la fiche se modifie depuis la page Fiche d'objectifs, selon son état."}</span></div>
      ${o.liste.length ? `<div class="tableau-boite"><table style="min-width:560px">
        <thead><tr><th style="width:40px">#</th><th>Objectif</th><th>Indicateur de mesure</th><th class="droite" style="width:110px">Pondération</th></tr></thead>
        <tbody>${lignesFicheConsultation(o)}</tbody>
        <tfoot><tr><td></td><td colspan="2" class="droite"><strong>Total</strong></td><td class="droite"><strong>${noteFr(o.total_ponderation)} %</strong></td></tr></tfoot>
      </table></div>` : etatVide("doc", "Aucun objectif saisi", "La fiche ne contient pas encore d'objectif.")}
      ${o.commentaire_superieur ? `<p class="aide">Commentaire du supérieur : « ${echapper(o.commentaire_superieur)} »</p>` : ""}
    </div>
    <div class="modale-pied"><button class="btn" id="fc-fermer">Fermer</button>
      ${o.liste.length ? `<button class="btn primaire" id="fc-imprimer">${ico("telecharger")} Imprimer / PDF</button>` : ""}</div></div>`);
  $("#fc-fermer").addEventListener("click", fermerCouche);
  $("#fc-imprimer")?.addEventListener("click", () => imprimerFicheObjectifs(fiche));
}

function imprimerFicheObjectifs(fiche) {
  const o = fiche.objectifs, e = fiche.employe;
  const fenetre = window.open("", "_blank");
  if (!fenetre) return toast("Impression bloquée", "Autorisez les fenêtres surgissantes pour imprimer la fiche.", "alerte");
  fenetre.document.write(`<!doctype html><meta charset="utf-8"><title>Fiche d'objectifs ${fiche.annee} — ${echapper(e.prenom + " " + e.nom)}</title>
    <style>body{font-family:Segoe UI,Arial,sans-serif;color:#072241;margin:32px}h1{font-size:20px;margin:12px 0 4px}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}th,td{border:1px solid #DCE2EC;padding:7px;text-align:left;vertical-align:top}
    th{background:#072241;color:#fff}td.m{text-align:right}p{color:#4A4E56;margin:2px 0}small{color:#4A4E56}</style>
    <img src="${LOGOS.clair}" style="height:26px"><h1>Fiche d'objectifs ${fiche.annee}</h1>
    <p>${echapper(e.prenom + " " + e.nom)} · matricule ${echapper(e.matricule)}${e.poste ? ` · ${echapper(e.poste)}` : ""}</p>
    <p>Supérieur hiérarchique : ${fiche.superieur ? echapper(fiche.superieur.prenom + " " + fiche.superieur.nom) : "administration RH"}
      · statut : ${(STATUTS_OBJECTIFS[o.statut] || ["", o.statut])[1]}</p>
    ${o.statut === "validee" ? `<p>${echapper(mentionValidation(o))}</p>` : ""}
    <table><tr><th>#</th><th>Objectif</th><th>Indicateur de mesure</th><th>Pondération</th></tr>
    ${o.liste.map((x, i) => `<tr><td>${i + 1}</td><td><strong>${echapper(x.titre)}</strong>${x.description ? `<br><small>${echapper(x.description)}</small>` : ""}</td>
      <td>${echapper(x.indicateur || "—")}</td><td class="m">${noteFr(x.ponderation)} %</td></tr>`).join("")}
    <tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td class="m"><strong>${noteFr(o.total_ponderation)} %</strong></td></tr></table>
    <script>setTimeout(() => print(), 300)<\/script>`);
  fenetre.document.close();
}

["/fiche-objectifs", "/fiche-evaluation", "/entretiens"].forEach((route) => {
  const brancherAvantConsultation = BRANCHEMENTS[route] || function () {};
  BRANCHEMENTS[route] = function () {
    brancherAvantConsultation();
    $("#fiche-consulter")?.addEventListener("click", () => {
      const fiche = cacheFiches.fiches[moi().matricule];
      if (fiche) ouvrirFicheConsultation(fiche);
    });
  };
});
