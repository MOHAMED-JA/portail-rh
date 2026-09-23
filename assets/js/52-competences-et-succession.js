/* ==========================================================================
   52. COMPÉTENCES ET SUCCESSION
   Référentiel, emplois de référence, évaluation par le supérieur direct,
   écarts → formations suggérées ; postes clés et plans de succession.
   ========================================================================== */
const NIVEAUX_COMP = ["Non évalué", "Notions", "Pratique", "Maîtrise", "Expert"];
const RISQUES = { eleve: ["rejetee", "Risque élevé"], moyen: ["attente", "Risque moyen"], faible: ["approuvee", "Risque faible"] };
const jauge = (acquis, requis) => `<span class="niveaux" title="${NIVEAUX_COMP[acquis]} / requis : ${NIVEAUX_COMP[requis]}">${[1, 2, 3, 4].map((n) =>
  `<i class="${n <= acquis ? "plein" : n <= requis ? "manque" : ""} ${n === requis ? "requis" : ""}"></i>`).join("")}</span>`;

function vueProfilCompetences(p) {
  if (!p.emploi) return etatVide("cible", "Aucun emploi de référence", "La RH rattache chaque collaborateur à un emploi de référence qui définit les compétences attendues.");
  return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <span class="badge info">${echapper(p.emploi.intitule)}</span>
      ${p.couverture != null ? `<span class="badge ${p.couverture >= 80 ? "approuvee" : p.couverture >= 50 ? "attente" : "rejetee"}">${p.couverture} % des compétences au niveau</span>` : ""}
      <span class="aide">${p.ecarts} écart(s)</span></div>
    <div class="tableau-boite"><table style="min-width:640px"><thead><tr><th>Compétence</th><th>Niveau (acquis / requis)</th><th>Écart</th><th>Formations proposées</th></tr></thead><tbody>
      ${p.competences.map((c) => `<tr><td><strong style="font-size:13px">${echapper(c.competence)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${echapper(c.domaine)}${c.commentaire ? ` · « ${echapper(c.commentaire)} »` : ""}</div></td>
        <td>${jauge(c.acquis, c.requis)} <span style="font-size:12px;color:var(--encre-3)">${NIVEAUX_COMP[c.acquis]} / ${NIVEAUX_COMP[c.requis]}</span></td>
        <td>${c.ecart ? `<span class="badge attente">−${c.ecart}</span>` : `<span class="badge approuvee">${ico("check")}</span>`}</td>
        <td style="font-size:12px">${c.formations.map((f) => `<a href="#/formations" data-lien-formation>${echapper(f.titre)}</a> <span style="color:var(--encre-3)">(${fmtDate(f.debut)})</span>`).join("<br>") || (c.ecart ? "<span style='color:var(--encre-3)'>Aucune session prévue</span>" : "")}</td></tr>`).join("")}
    </tbody></table></div>
    ${p.autres.length ? `<p class="aide" style="margin-top:8px">Autres compétences évaluées : ${p.autres.map((a) => `${echapper(a.competence)} (${NIVEAUX_COMP[a.acquis]})`).join(", ")}</p>` : ""}`;
}

async function ouvrirEvaluationCompetences(matricule) {
  let p;
  try { p = await API.appel(`/api/talents/profil/${matricule}`); } catch (souci) { return toast("Indisponible", souci.message, "danger"); }
  const e = p.employe;
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(760px,100%)">
    ${enteteTiroir(`Compétences — ${echapper(e.prenom + " " + e.nom)}`, `${echapper(e.poste || "")}${p.emploi ? ` · ${echapper(p.emploi.intitule)}` : ""}`)}
    <div class="tiroir-corps">${p.peut_evaluer && p.competences.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Compétence</th><th>Requis</th><th>Niveau constaté</th><th>Commentaire</th></tr></thead><tbody>
      ${p.competences.map((c) => `<tr><td><strong style="font-size:13px">${echapper(c.competence)}</strong></td><td>${NIVEAUX_COMP[c.requis]}</td>
        <td><select class="saisie" data-eval-comp="${c.competence_id}">${NIVEAUX_COMP.map((l, n) => `<option value="${n}" ${c.acquis === n ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><input class="saisie" data-eval-com="${c.competence_id}" value="${echapper(c.commentaire || "")}" placeholder="Facultatif"></td></tr>`).join("")}</tbody></table></div>` : vueProfilCompetences(p)}</div>
    ${p.peut_evaluer && p.competences.length ? `<div class="tiroir-pied"><button class="btn" id="ev-fermer">Fermer</button><button class="btn primaire" id="ev-enregistrer">${ico("check")} Enregistrer l'évaluation</button></div>` : ""}
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#ev-fermer")?.addEventListener("click", fermerCouche);
  $("#ev-enregistrer")?.addEventListener("click", async () => {
    const evaluations = $$("[data-eval-comp]").map((s) => ({ competence_id: Number(s.dataset.evalComp), niveau: Number(s.value),
      commentaire: $(`[data-eval-com="${s.dataset.evalComp}"]`).value.trim() || null }));
    try { await API.appel(`/api/talents/evaluation/${matricule}`, { methode: "PUT", corps: { evaluations } }); fermerCouche();
      toast("Évaluation enregistrée", `${e.prenom} ${e.nom}`, "succes"); etat.talents = null; rendre(false); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  });
}

VUES["/competences"] = function () {
  if (!connecte()) return reserveServeur("Les compétences");
  const rh = estAdmin(), direction = rh || estDirection();
  const f = etat.filtres.talents || (etat.filtres.talents = { onglet: "moi" });
  const d = chargerEtat("talents", () => Promise.all([
    API.appel(`/api/talents/profil/${moi().matricule}`),
    (estValideur() || direction) ? API.appel("/api/talents/equipe").catch(() => null) : Promise.resolve(null),
    rh ? Promise.all([API.appel("/api/talents/competences"), API.appel("/api/talents/emplois")]) : Promise.resolve([[], []]),
    direction ? API.appel("/api/talents/postes-cles") : Promise.resolve([]),
  ]).then(([moiProfil, equipe, [competences, emplois], postes]) => ({ moiProfil, equipe, competences, emplois, postes })));
  if (!d) return squelette(300);
  if (d.erreur) return `<section class="carte">${etatVide("cible", "Indisponible", echapper(d.erreur))}</section>`;
  const onglets = [["moi", "Mes compétences"], ...(d.equipe ? [["equipe", direction ? "Personnel" : "Mon équipe"]] : []),
    ...(rh ? [["referentiel", "Référentiel"]] : []), ...(direction ? [["succession", "Postes clés et succession"]] : [])];
  if (!onglets.some(([k]) => k === f.onglet)) f.onglet = "moi";
  let corps = "";
  if (f.onglet === "moi") corps = vueProfilCompetences(d.moiProfil);
  else if (f.onglet === "equipe") {
    const q = (f.recherche || "").toLowerCase();
    const lignes = d.equipe.lignes.filter((l) => !q || `${l.employe.prenom} ${l.employe.nom} ${l.employe.matricule}`.toLowerCase().includes(q));
    corps = `<div class="grille" style="grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:14px;align-items:start">
      <div><input class="saisie" id="tal-recherche" placeholder="Nom ou matricule" value="${echapper(f.recherche || "")}" style="max-width:240px;margin-bottom:8px">
        <div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Emploi</th><th>Couverture</th><th>Écarts</th><th></th></tr></thead><tbody>
        ${lignes.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${echapper(l.employe.poste || "")}</div></td>
          <td style="font-size:12.5px">${l.emploi ? echapper(l.emploi) : `<span style="color:var(--encre-3)">Non rattaché</span>`}</td>
          <td>${l.couverture == null ? "—" : `<div class="jauge" style="width:90px;display:inline-block"><span style="width:${l.couverture}%"></span></div> ${l.couverture} %`}</td>
          <td>${l.ecarts ? `<span class="badge attente">${l.ecarts}</span>` : "—"}</td>
          <td class="droite"><button class="btn petit ${l.peut_evaluer ? "" : "fantome"}" data-evaluer="${l.employe.matricule}">${l.peut_evaluer ? `${ico("crayon")} Évaluer` : "Voir"}</button></td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="sirh-section"><h4>Besoins de formation</h4>${d.equipe.besoins.length ? d.equipe.besoins.map((b) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
          <span>${echapper(b.competence)} <span style="color:var(--encre-3);font-size:11.5px">${echapper(b.domaine)}</span></span><strong>${b.personnes}</strong></div>`).join("")
        : `<span class="aide">Aucun écart relevé.</span>`}
        ${d.equipe.sans_emploi ? `<span class="aide">${d.equipe.sans_emploi} collaborateur(s) sans emploi de référence.</span>` : ""}</div></div>`;
  } else if (f.onglet === "referentiel") {
    const parDomaine = {};
    d.competences.forEach((c) => (parDomaine[c.domaine] = parDomaine[c.domaine] || []).push(c));
    corps = `<div class="sirh-grille">
      <div class="sirh-section"><h4>Compétences (${d.competences.length})</h4>
        ${Object.entries(parDomaine).map(([dom, liste]) => `<div style="margin-bottom:6px"><strong style="font-size:12px;color:var(--encre-3)">${echapper(dom)}</strong><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:3px">
          ${liste.map((c) => `<span class="badge neutre">${echapper(c.nom)} <button class="btn icone fantome" style="padding:0;height:auto" data-retirer-comp="${c.id}" title="Retirer">${ico("croix")}</button></span>`).join("")}</div></div>`).join("")}
        <div class="ligne-champs"><input class="saisie" id="rc-nom" placeholder="Nouvelle compétence"><input class="saisie" id="rc-domaine" placeholder="Domaine" list="rc-domaines" style="max-width:160px">
          <datalist id="rc-domaines">${Object.keys(parDomaine).map((x) => `<option value="${echapper(x)}">`).join("")}</datalist>
          <button class="btn petit" id="rc-ajouter">${ico("plus")}</button></div></div>
      <div class="sirh-section"><h4>Emplois de référence (${d.emplois.length})</h4>
        ${d.emplois.map((e) => `<div style="border-bottom:1px dashed var(--trait);padding:6px 0"><div style="display:flex;justify-content:space-between;gap:6px">
            <strong style="font-size:13px">${echapper(e.intitule)}</strong><button class="btn petit fantome" data-editer-emploi="${e.id}">${ico("crayon")}</button></div>
          <div style="font-size:11.5px;color:var(--encre-3)">${e.exigences.map((x) => `${echapper(x.competence)} (${NIVEAUX_COMP[x.niveau_requis]})`).join(" · ") || "Aucune compétence requise"}</div></div>`).join("")}
        <button class="btn petit primaire" data-editer-emploi="" style="margin-top:8px">${ico("plus")} Nouvel emploi</button></div>
      <div class="sirh-section"><h4>Rattacher un collaborateur</h4>
        <input class="saisie" id="ra-matricule" list="ra-liste" placeholder="Matricule ou nom">
        <datalist id="ra-liste">${EMPLOYES.map((x) => `<option value="${x.matricule}">${echapper(nomComplet(x))}</option>`).join("")}</datalist>
        <select class="saisie" id="ra-emploi"><option value="">— Aucun emploi —</option>${d.emplois.map((e) => `<option value="${e.id}">${echapper(e.intitule)}</option>`).join("")}</select>
        <button class="btn petit primaire" id="ra-valider">${ico("check")} Rattacher</button></div></div>`;
  } else {
    corps = `${rh ? `<div class="ligne-champs" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="champ"><label>Poste clé</label><input class="saisie" id="pc-intitule" placeholder="Ex. Directeur Pôle Technique"></div>
        <div class="champ"><label>Titulaire</label><input class="saisie" id="pc-titulaire" list="ra-liste2" placeholder="Matricule"></div>
        <datalist id="ra-liste2">${EMPLOYES.map((x) => `<option value="${x.matricule}">${echapper(nomComplet(x))}</option>`).join("")}</datalist>
        <div class="champ" style="max-width:140px"><label>Criticité</label><select class="saisie" id="pc-criticite"><option value="1">Modérée</option><option value="2" selected>Forte</option><option value="3">Vitale</option></select></div>
        <button class="btn primaire" id="pc-creer">${ico("plus")} Déclarer</button></div>` : ""}
      ${d.postes.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">${d.postes.map((p) => { const [c, l] = RISQUES[p.risque]; return `<article class="carte" style="box-shadow:none;border:1px solid var(--trait)">
        <div class="carte-entete" style="gap:8px;flex-wrap:wrap"><div><h3>${echapper(p.intitule)}</h3><span class="carte-sous">Criticité ${p.criticite_libelle}${p.titulaire ? ` · ${echapper(p.titulaire.prenom + " " + p.titulaire.nom)}` : " · poste vacant"}</span></div><span class="badge ${c}">${l}</span></div>
        ${p.motifs.length ? `<p style="font-size:12px;color:var(--encre-3);margin-bottom:6px">${p.motifs.map(echapper).join(" · ")}</p>` : ""}
        ${p.successeurs.map((s) => `<div style="display:flex;justify-content:space-between;gap:6px;font-size:12.5px;padding:3px 0;border-bottom:1px dashed var(--trait)">
          <span>${echapper(s.prenom + " " + s.nom)} <span class="badge ${s.preparation === "immediat" ? "approuvee" : "neutre"}">${s.preparation_libelle}</span></span>
          ${rh ? `<button class="btn icone fantome" data-retirer-succ="${p.id}:${s.id}">${ico("croix")}</button>` : ""}</div>`).join("") || `<span class="aide">Aucun successeur identifié.</span>`}
        ${rh ? `<div class="ligne-champs" style="margin-top:8px"><input class="saisie" data-succ-mat="${p.id}" list="ra-liste2" placeholder="Successeur (matricule)">
          <select class="saisie" data-succ-prep="${p.id}" style="max-width:170px"><option value="immediat">Prêt maintenant</option><option value="1_2_ans" selected>Dans 1 à 2 ans</option><option value="3_ans">Dans 3 ans ou plus</option></select>
          <button class="btn petit" data-succ-ajouter="${p.id}">${ico("plus")}</button><button class="btn icone fantome" data-suppr-poste="${p.id}" title="Supprimer le poste clé">${ico("poubelle")}</button></div>` : ""}
      </article>`; }).join("")}</div>` : etatVide("users", "Aucun poste clé", "Déclarez les postes dont la vacance mettrait l'activité en difficulté, puis identifiez leurs successeurs.")}
      <p class="aide" style="margin-top:8px">${ico("bouclier")} Plans de succession confidentiels : RH et Direction générale uniquement. Le départ en retraite du titulaire est calculé à partir de sa date de naissance (dossier).</p>`;
  }
  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Compétences${direction ? " et succession" : ""}</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Compétences attendues par l'emploi, niveau constaté par le supérieur, écarts et formations proposées.</p></div>
      ${onglets.length > 1 ? `<div class="segment">${onglets.map(([k, l]) => `<button data-onglet-tal="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>
    ${corps}</section>`;
};

function ouvrirEditeurEmploi(id) {
  const d = etat.talents;
  const e = d.emplois.find((x) => String(x.id) === String(id)) || { intitule: "", famille: "", exigences: [] };
  const requis = Object.fromEntries(e.exigences.map((x) => [x.competence_id, x.niveau_requis]));
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(640px,100%)">
    ${enteteTiroir(e.id ? "Modifier l'emploi" : "Nouvel emploi de référence", "Compétences requises et niveau attendu")}
    <div class="tiroir-corps"><div class="ligne-champs"><div class="champ"><label>Intitulé</label><input class="saisie" id="em-intitule" value="${echapper(e.intitule)}"></div>
      <div class="champ"><label>Famille</label><input class="saisie" id="em-famille" value="${echapper(e.famille || "")}" placeholder="Technique, Support, Contrôle…"></div></div>
      <div class="tableau-boite" style="margin-top:10px"><table><thead><tr><th>Compétence</th><th>Niveau requis</th></tr></thead><tbody>
      ${d.competences.map((c) => `<tr><td style="font-size:13px">${echapper(c.nom)} <span style="color:var(--encre-3);font-size:11.5px">${echapper(c.domaine)}</span></td>
        <td><select class="saisie" data-exigence="${c.id}">${NIVEAUX_COMP.map((l, n) => `<option value="${n}" ${(requis[c.id] || 0) === n ? "selected" : ""}>${n ? l : "Non requise"}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div></div>
    <div class="tiroir-pied"><button class="btn" id="em-annuler">Annuler</button><button class="btn primaire" id="em-enregistrer">${ico("check")} Enregistrer</button></div></aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#em-annuler").addEventListener("click", fermerCouche);
  $("#em-enregistrer").addEventListener("click", async () => {
    const corps = { intitule: $("#em-intitule").value.trim(), famille: $("#em-famille").value.trim() || null,
      exigences: $$("[data-exigence]").filter((s) => Number(s.value) > 0).map((s) => ({ competence_id: Number(s.dataset.exigence), niveau_requis: Number(s.value) })) };
    try { await API.appel(e.id ? `/api/talents/emplois/${e.id}` : "/api/talents/emplois", { methode: e.id ? "PUT" : "POST", corps });
      fermerCouche(); etat.talents = null; toast("Emploi enregistré", corps.intitule, "succes"); rendre(false); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  });
}

BRANCHEMENTS["/competences"] = function () {
  const f = etat.filtres.talents;
  if (!f) return;
  const recharger = () => { etat.talents = null; rendre(false); };
  const appel = async (chemin, options, message) => {
    try { await API.appel(chemin, options); if (message) toast(message, "", "succes"); recharger(); } catch (souci) { toast("Refusé", souci.message, "danger"); }
  };
  $$("[data-onglet-tal]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.ongletTal; rendre(false); }));
  $$("[data-evaluer]").forEach((b) => b.addEventListener("click", () => ouvrirEvaluationCompetences(b.dataset.evaluer)));
  $$("[data-lien-formation]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); naviguer("/formations"); }));
  const recherche = $("#tal-recherche");
  if (recherche) recherche.addEventListener("input", debounce(() => {
    f.recherche = recherche.value; rendre(false); const c = $("#tal-recherche"); c.focus(); c.setSelectionRange(c.value.length, c.value.length);
  }, 250));
  $("#rc-ajouter")?.addEventListener("click", () => appel("/api/talents/competences", { methode: "POST",
    corps: { nom: $("#rc-nom").value.trim(), domaine: $("#rc-domaine").value.trim() } }, "Compétence ajoutée"));
  $$("[data-retirer-comp]").forEach((b) => b.addEventListener("click", () => {
    if (confirm("Retirer cette compétence du référentiel ? Les évaluations passées sont conservées.")) appel(`/api/talents/competences/${b.dataset.retirerComp}`, { methode: "DELETE" });
  }));
  $$("[data-editer-emploi]").forEach((b) => b.addEventListener("click", () => ouvrirEditeurEmploi(b.dataset.editerEmploi)));
  $("#ra-valider")?.addEventListener("click", () => {
    const m = $("#ra-matricule").value.trim().toUpperCase();
    if (!parMatricule[m]) return toast("Collaborateur inconnu", "Choisissez un matricule dans la liste.", "danger");
    appel(`/api/talents/affectation/${m}`, { methode: "PUT", corps: { emploi_id: $("#ra-emploi").value ? Number($("#ra-emploi").value) : null } }, "Rattachement enregistré");
  });
  $("#pc-creer")?.addEventListener("click", () => appel("/api/talents/postes-cles", { methode: "POST", corps: {
    intitule: $("#pc-intitule").value.trim(), titulaire: $("#pc-titulaire").value.trim().toUpperCase() || null, criticite: Number($("#pc-criticite").value) } }, "Poste clé déclaré"));
  $$("[data-succ-ajouter]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.succAjouter;
    appel(`/api/talents/postes-cles/${id}/successeurs`, { methode: "POST", corps: {
      matricule: $(`[data-succ-mat="${id}"]`).value.trim().toUpperCase(), preparation: $(`[data-succ-prep="${id}"]`).value } }, "Successeur ajouté");
  }));
  $$("[data-retirer-succ]").forEach((b) => b.addEventListener("click", () => {
    const [p, s] = b.dataset.retirerSucc.split(":"); appel(`/api/talents/postes-cles/${p}/successeurs/${s}`, { methode: "DELETE" });
  }));
  $$("[data-suppr-poste]").forEach((b) => b.addEventListener("click", () => {
    if (confirm("Supprimer ce poste clé et son plan de succession ?")) appel(`/api/talents/postes-cles/${b.dataset.supprPoste}`, { methode: "DELETE" });
  }));
};

TITRES["/competences"] = "Compétences";
const menuAvantTalents = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantTalents();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/competences")) {
    const i = perso.items.findIndex((x) => x.route === "/formations");
    perso.items.splice(i >= 0 ? i + 1 : perso.items.length, 0, { route: "/competences", libelle: "Compétences", icone: "cible" });
  }
  return groupes;
};
const naviguerAvantTalents = naviguer;
naviguer = function (route) { if (route === "/competences") etat.talents = null; return naviguerAvantTalents(route); };
const deconnexionAvantTalents = deconnexion;
deconnexion = function (...args) { delete etat.filtres.talents; etat.talents = null; return deconnexionAvantTalents(...args); };
