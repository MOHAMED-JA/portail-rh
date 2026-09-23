/* ==========================================================================
   53. OFFRES DE POSTES EN INTERNE ET MOBILITÉ
   ========================================================================== */
const STATUTS_CAND = { deposee: ["info", "Déposée"], etudiee: ["attente", "À l'étude"], entretien: ["violet", "Entretien"],
  retenue: ["approuvee", "Retenue"], non_retenue: ["rejetee", "Non retenue"], retiree: ["annulee", "Retirée"] };

function carteOffre(o, rh) {
  const ma = o.ma_candidature;
  const [cs, ls] = ma ? STATUTS_CAND[ma.statut] : [];
  return `<article class="carte" style="box-shadow:none;border:1px solid var(--trait)">
    <div class="carte-entete" style="flex-wrap:wrap;gap:8px"><div><h3>${echapper(o.intitule)}</h3>
      <span class="carte-sous">${[o.direction, o.lieu, o.emploi && o.emploi.intitule].filter(Boolean).map(echapper).join(" · ") || "Veltaris"} · candidature jusqu'au ${fmtDate(o.date_limite)}</span></div>
      ${o.publication === "externe" ? `<span class="badge violet">Recrutement externe</span>` : ""}${o.ouverte ? `<span class="badge info">Ouverte</span>` : `<span class="badge annulee">${o.statut === "pourvue" ? "Pourvue" : "Clôturée"}</span>`}</div>
    <p style="font-size:13px;color:var(--encre-2);white-space:pre-line">${echapper(o.description)}</p>
    ${o.profil ? `<p style="font-size:12.5px;margin-top:6px;white-space:pre-line"><strong>Profil recherché :</strong> ${echapper(o.profil)}</p>` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:10px;flex-wrap:wrap">
      ${ma ? `<span class="badge ${cs}">Ma candidature : ${ls}</span>${["deposee", "etudiee", "entretien"].includes(ma.statut) ? `<button class="btn petit fantome" data-retirer-cand="${ma.id}">Retirer</button>` : ""}` : ""}
      ${o.publication !== "externe" && o.ouverte && (!ma || ma.statut === "retiree") ? `<button class="btn petit primaire" data-postuler="${o.id}">${ico("fleche")} Postuler</button>` : ""}
      ${rh ? `<button class="btn petit" data-candidatures="${o.id}">${ico("users")} Candidatures (${o.candidatures})</button>${o.publication === "externe" ? `<button class="btn petit" data-candidatures-externes="${o.id}">${ico("users")} Externes (${o.candidatures_externes || 0})</button>` : ""}
        ${o.statut === "ouverte" ? `<button class="btn petit fantome" data-cloturer-offre="${o.id}">Clôturer</button>` : ""}` : ""}
    </div></article>`;
}

VUES["/mobilite"] = function () {
  if (!connecte()) return reserveServeur("Les offres internes");
  const rh = estAdmin();
  const f = etat.filtres.mobilite || (etat.filtres.mobilite = { onglet: "offres" });
  const d = chargerEtat("mobilite", () => Promise.all([
    API.appel(`/api/mobilite/offres${rh ? "?toutes=true" : ""}`),
    rh ? API.appel("/api/mobilite/souhaits") : Promise.resolve([]),
    rh ? API.appel("/api/talents/emplois") : Promise.resolve([]),
  ]).then(([offres, souhaits, emplois]) => ({ offres, souhaits, emplois })));
  if (!d) return squelette(260);
  if (d.erreur) return `<section class="carte">${etatVide("users", "Indisponible", echapper(d.erreur))}</section>`;
  const onglets = rh ? [["offres", "Offres"], ["publier", "Publier une offre"], ["souhaits", `Souhaits de mobilité (${d.souhaits.length})`]] : [];
  let corps;
  if (f.onglet === "publier") {
    corps = `<div class="sirh-section" style="max-width:760px">
      <div class="ligne-champs"><div class="champ"><label>Intitulé du poste</label><input class="saisie" id="of-intitule"></div>
        <div class="champ" style="max-width:190px"><label>Candidature jusqu'au</label><input class="saisie" type="date" id="of-limite" value="${iso(new Date(AUJOURDHUI.getTime() + 15 * 86400000))}"></div></div>
      <div class="champ" style="max-width:350px"><label>Publication</label><select class="saisie" id="of-publication"><option value="interne">Mobilité interne</option><option value="externe">Recrutement externe</option></select><span class="aide">Les candidatures externes et leurs CV restent réservés à la RH.</span></div>
      <div class="ligne-champs"><div class="champ"><label>Direction</label><select class="saisie" id="of-dept"><option value="">—</option>${DEPARTEMENTS.map((x) => `<option value="${x.id}">${echapper(x.nom)}</option>`).join("")}</select></div>
        <div class="champ"><label>Emploi de référence</label><select class="saisie" id="of-emploi"><option value="">—</option>${d.emplois.map((x) => `<option value="${x.id}">${echapper(x.intitule)}</option>`).join("")}</select>
          <span class="aide">Permet de calculer l'adéquation des candidats (compétences).</span></div>
        <div class="champ"><label>Lieu</label><input class="saisie" id="of-lieu" placeholder="Siège, agence…"></div></div>
      <div class="champ"><label>Missions</label><textarea class="saisie" id="of-description" style="min-height:90px"></textarea></div>
      <div class="champ"><label>Profil recherché</label><textarea class="saisie" id="of-profil" style="min-height:60px"></textarea></div>
      <button class="btn primaire" id="of-publier">${ico("fleche")} Publier l'offre</button>
      <span class="aide">Les collaborateurs ayant exprimé un souhait de mobilité lors de leur entretien annuel sont prévenus par notification.</span></div>`;
  } else if (f.onglet === "souhaits") {
    corps = d.souhaits.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Souhait</th><th>Précisions</th><th>Entretien</th></tr></thead><tbody>
      ${d.souhaits.map((s) => `<tr><td><strong style="font-size:13px">${echapper(s.employe.prenom + " " + s.employe.nom)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${echapper(s.employe.poste || "")}</div></td>
        <td><span class="badge info">${echapper(s.mobilite)}</span></td><td style="font-size:12.5px">${echapper(s.detail || "—")}</td><td>${s.annee}</td></tr>`).join("")}</tbody></table></div>`
      : etatVide("users", "Aucun souhait exprimé", "Les souhaits de mobilité saisis dans la fiche d'évaluation (partie Développement et mobilité) apparaîtront ici.");
  } else {
    corps = d.offres.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${d.offres.map((o) => carteOffre(o, rh)).join("")}</div>`
      : etatVide("users", "Aucune offre ouverte", "Les postes à pourvoir en interne seront publiés ici par la RH.");
  }
  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Offres et recrutement</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Mobilité interne et recrutement externe. Les candidatures et CV externes sont réservés à la RH.</p></div>
      ${onglets.length ? `<div class="segment">${onglets.map(([k, l]) => `<button data-onglet-mob="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>
    ${corps}</section>`;
};

async function ouvrirCandidatures(offreId) {
  let d;
  try { d = await API.appel(`/api/mobilite/offres/${offreId}/candidatures`); } catch (souci) { return toast("Indisponible", souci.message, "danger"); }
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(820px,100%)">
    ${enteteTiroir(`Candidatures — ${echapper(d.offre.intitule)}`, `${d.candidatures.length} candidature(s) · jusqu'au ${fmtDate(d.offre.date_limite)}`)}
    <div class="tiroir-corps" style="display:flex;flex-direction:column;gap:10px">
      ${d.candidatures.length ? d.candidatures.map((c) => { const [cs, ls] = STATUTS_CAND[c.statut]; return `<div class="sirh-section">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${echapper(c.employe.prenom + " " + c.employe.nom)}</strong>
          <div style="font-size:11.5px;color:var(--encre-3)">${[c.employe.poste, c.employe.direction, c.employe.emploi].filter(Boolean).map(echapper).join(" · ")}</div></div>
          <span class="badge ${cs}">${ls}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px">
          ${c.adequation != null ? `<span class="badge ${c.adequation >= 75 ? "approuvee" : c.adequation >= 50 ? "attente" : "rejetee"}">Adéquation compétences : ${c.adequation} %</span>` : ""}
          ${c.mobilite_souhaitee ? `<span class="badge info">${echapper(c.mobilite_souhaitee)} souhaitée</span>` : ""}
          ${c.note_derniere_evaluation != null ? `<span class="badge neutre">Dernière évaluation : ${fmtNombre(c.note_derniere_evaluation, 2)}/20</span>` : ""}
          <span style="color:var(--encre-3)">déposée le ${fmtDate(String(c.deposee_le).slice(0, 10))}</span></div>
        ${c.motivation ? `<p style="font-size:12.5px;white-space:pre-line">« ${echapper(c.motivation)} »</p>` : ""}
        ${c.statut !== "retiree" ? `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${[["etudiee", "À l'étude"], ["entretien", "Convoquer en entretien"], ["retenue", "Retenir"], ["non_retenue", "Ne pas retenir"]]
            .filter(([s]) => s !== c.statut).map(([s, l]) => `<button class="btn petit ${s === "retenue" ? "succes" : s === "non_retenue" ? "danger" : "fantome"}" data-suivi="${c.id}:${s}">${l}</button>`).join("")}</div>` : ""}
      </div>`; }).join("") : etatVide("users", "Aucune candidature", "Personne n'a encore postulé.")}
    </div></aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $$("[data-suivi]").forEach((b) => b.addEventListener("click", async () => {
    const [id, statut] = b.dataset.suivi.split(":");
    const commentaire = statut === "non_retenue" || statut === "entretien" ? prompt(statut === "entretien" ? "Date et lieu de l'entretien (facultatif) :" : "Message au candidat (facultatif) :") : null;
    try { await API.appel(`/api/mobilite/candidatures/${id}/suivi`, { methode: "POST", corps: { statut, commentaire } });
      toast("Candidature mise à jour", "Le candidat est notifié.", "succes"); etat.mobilite = null; ouvrirCandidatures(offreId); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
}

BRANCHEMENTS["/mobilite"] = function () {
  const f = etat.filtres.mobilite;
  if (!f) return;
  const recharger = () => { etat.mobilite = null; rendre(false); };
  $$("[data-onglet-mob]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.ongletMob; rendre(false); }));
  $$("[data-postuler]").forEach((b) => b.addEventListener("click", () => {
    const o = etat.mobilite.offres.find((x) => x.id === Number(b.dataset.postuler));
    ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><div><h2>Postuler</h2><div class="sous">${echapper(o.intitule)}</div></div></div>
      <div class="modale-corps"><div class="champ"><label>Motivation</label><textarea class="saisie" id="cand-motivation" style="min-height:120px" placeholder="Votre parcours, ce qui vous attire dans ce poste…"></textarea></div>
        <span class="aide">${ico("bouclier")} Visible uniquement par la RH.</span></div>
      <div class="modale-pied"><button class="btn" id="cand-annuler">Annuler</button><button class="btn primaire" id="cand-ok">${ico("fleche")} Envoyer</button></div></div>`);
    $("#cand-annuler").addEventListener("click", fermerCouche);
    $("#cand-ok").addEventListener("click", async () => {
      try { await API.appel(`/api/mobilite/offres/${o.id}/candidater`, { methode: "POST", corps: { motivation: $("#cand-motivation").value.trim() || null } });
        fermerCouche(); toast("Candidature envoyée", "La RH vous tiendra informé(e).", "succes"); recharger(); }
      catch (souci) { toast("Refusé", souci.message, "danger"); }
    });
  }));
  $$("[data-retirer-cand]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Retirer votre candidature ?")) return;
    await API.appel(`/api/mobilite/candidatures/${b.dataset.retirerCand}/retirer`, { methode: "POST" }); recharger();
  }));
  $$("[data-candidatures]").forEach((b) => b.addEventListener("click", () => ouvrirCandidatures(b.dataset.candidatures)));
  $$("[data-cloturer-offre]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Clôturer l'offre ? Les candidatures en cours non retenues seront informées.")) return;
    await API.appel(`/api/mobilite/offres/${b.dataset.cloturerOffre}/cloturer`, { methode: "POST" }); toast("Offre clôturée", "", "succes"); recharger();
  }));
  $("#of-publier")?.addEventListener("click", async () => {
    const corps = { intitule: $("#of-intitule").value.trim(), date_limite: $("#of-limite").value,
      departement_id: $("#of-dept").value ? Number($("#of-dept").value) : null, emploi_id: $("#of-emploi").value ? Number($("#of-emploi").value) : null,
      lieu: $("#of-lieu").value.trim() || null, description: $("#of-description").value.trim(), profil: $("#of-profil").value.trim() || null,
      publication: $("#of-publication").value };
    try { const r = await API.appel("/api/mobilite/offres", { methode: "POST", corps });
      toast("Offre publiée", `${r.prevenus} collaborateur(s) intéressé(s) prévenu(s).`, "succes"); f.onglet = "offres"; recharger(); }
    catch (souci) { toast("Publication refusée", souci.message, "danger"); }
  });
};

TITRES["/mobilite"] = "Offres et recrutement";
const menuAvantMobilite = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantMobilite();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/mobilite")) {
    const i = perso.items.findIndex((x) => x.route === "/competences");
    perso.items.splice(i >= 0 ? i + 1 : perso.items.length, 0, { route: "/mobilite", libelle: "Offres & recrutement", icone: "users" });
  }
  return groupes;
};
const naviguerAvantMobilite = naviguer;
naviguer = function (route) { if (route === "/mobilite") etat.mobilite = null; return naviguerAvantMobilite(route); };
const deconnexionAvantMobilite = deconnexion;
deconnexion = function (...args) { delete etat.filtres.mobilite; etat.mobilite = null; return deconnexionAvantMobilite(...args); };

/* --- Recrutement externe : CV consultables uniquement depuis l'espace RH. --- */
async function ouvrirCandidaturesExternes(offreId) {
  let donnees;
  try { donnees = await API.appel(`/api/mobilite/offres/${offreId}/candidatures-externes`); }
  catch (souci) { return toast("Indisponible", souci.message, "danger"); }
  const statut = (c) => STATUTS_CAND[c.statut] || ["neutre", c.statut];
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(820px,100%)">
    ${enteteTiroir(`Candidatures externes — ${echapper(donnees.offre.intitule)}`, `${donnees.candidatures.length} candidature(s)`)}
    <div class="tiroir-corps" style="display:flex;flex-direction:column;gap:10px">${donnees.candidatures.length ? donnees.candidatures.map((c) => { const [classe, libelle] = statut(c); return `<div class="sirh-section"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${echapper(c.prenom + " " + c.nom)}</strong><div class="aide">${echapper(c.email)}${c.telephone ? ` · ${echapper(c.telephone)}` : ""}</div></div><span class="badge ${classe}">${echapper(libelle)}</span></div>${c.motivation ? `<p style="white-space:pre-line">${echapper(c.motivation)}</p>` : ""}<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap"><button class="btn petit" data-cv-externe="${c.id}:${echapper(c.cv_nom)}">CV : ${echapper(c.cv_nom)}</button>${c.statut === "retenue" ? `<button class="btn petit succes" data-integrer-externe="${c.id}">Créer le profil RH</button>` : ""}${!c.integree ? [["etudiee", "À l'étude"], ["entretien", "Entretien"], ["retenue", "Retenir"], ["non_retenue", "Écarter"]].filter(([s]) => s !== c.statut).map(([s, l]) => `<button class="btn petit ${s === "retenue" ? "succes" : "fantome"}" data-suivi-externe="${c.id}:${s}">${l}</button>`).join("") : ""}</div></div>`; }).join("") : etatVide("users", "Aucune candidature", "Aucun candidat externe n'a encore postulé.")}</div></aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $$('[data-suivi-externe]').forEach((b) => b.addEventListener("click", async () => {
    const [id, suivi] = b.dataset.suiviExterne.split(":");
    try { await API.appel(`/api/mobilite/candidatures-externes/${id}/suivi`, { methode: "POST", corps: { statut: suivi } }); etat.mobilite = null; ouvrirCandidaturesExternes(offreId); }
    catch (souci) { toast("Mise à jour refusée", souci.message, "danger"); }
  }));
  $$('[data-cv-externe]').forEach((b) => b.addEventListener("click", () => { const [id, nom] = b.dataset.cvExterne.split(":"); telechargerFichier(`/api/mobilite/candidatures-externes/${id}/cv`, nom, "CV du candidat"); }));
  $$('[data-integrer-externe]').forEach((b) => b.addEventListener("click", () => ouvrirIntegrationExterne(Number(b.dataset.integrerExterne), offreId)));
}

function ouvrirIntegrationExterne(candidatureId, offreId) {
  const optionsDept = DEPARTEMENTS.map((d) => `<option value="${d.id}">${echapper(d.nom)}</option>`).join("");
  const optionsChef = EMPLOYES.filter((e) => e.statut !== "sorti").map((e) => `<option value="${e.id}">${echapper(nomComplet(e))}</option>`).join("");
  ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><div><h2>Créer le profil RH</h2><div class="sous">Le parcours d'arrivée sera ouvert automatiquement.</div></div></div><div class="modale-corps"><div class="ligne-champs"><label>Matricule<input class="saisie" id="ce-matricule" required></label><label>Poste<input class="saisie" id="ce-poste" required></label></div><div class="ligne-champs"><label>Structure<select class="saisie" id="ce-dept"><option value="">—</option>${optionsDept}</select></label><label>Supérieur<select class="saisie" id="ce-chef"><option value="">—</option>${optionsChef}</select></label></div></div><div class="modale-pied"><button class="btn" id="ce-annuler">Annuler</button><button class="btn primaire" id="ce-creer">Créer et intégrer</button></div></div>`);
  $("#ce-annuler").addEventListener("click", fermerCouche);
  $("#ce-creer").addEventListener("click", async () => { try { const r = await API.appel(`/api/mobilite/candidatures-externes/${candidatureId}/integrer`, { methode: "POST", corps: { matricule: $("#ce-matricule").value.trim(), poste: $("#ce-poste").value.trim(), departement_id: $("#ce-dept").value ? Number($("#ce-dept").value) : null, validateur_id: $("#ce-chef").value ? Number($("#ce-chef").value) : null } }); fermerCouche(); toast("Collaborateur intégré", `${r.nom} · ${r.matricule}`, "succes"); etat.mobilite = null; ouvrirCandidaturesExternes(offreId); } catch (souci) { toast("Intégration refusée", souci.message, "danger"); } });
}

const branchementsMobiliteAvantExterne = BRANCHEMENTS["/mobilite"];
BRANCHEMENTS["/mobilite"] = function () {
  branchementsMobiliteAvantExterne();
  $$('[data-candidatures-externes]').forEach((b) => b.addEventListener("click", () => ouvrirCandidaturesExternes(Number(b.dataset.candidaturesExternes))));
};
