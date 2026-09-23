/* ==========================================================================
   55. ANALYSES RH : CHARGE EN PÉRIODE DE CONGÉS, BRADFORD, RISQUE DE DÉPART
   Indicateurs d'alerte : ils ouvrent un échange, ils ne décident de rien.
   ========================================================================== */
const NIVEAUX_BRADFORD = { tres_eleve: "rejetee", eleve: "rejetee", surveiller: "attente", faible: "approuvee" };
const NIVEAUX_RISQUE = { eleve: ["rejetee", "Élevé"], moyen: ["attente", "Moyen"], faible: ["approuvee", "Faible"] };

VUES["/analyses"] = function () {
  if (!connecte()) return reserveServeur("Les analyses RH");
  const direction = estAdmin() || estDirection();
  const f = etat.filtres.analyses || (etat.filtres.analyses = { onglet: "charge", seuil: 70 });
  if (!direction) f.onglet = "charge";
  const d = chargerEtat("analyses", () => {
    if (f.onglet === "bradford") return API.appel("/api/analyses/bradford");
    if (f.onglet === "risque") return API.appel("/api/analyses/risque-depart");
    if (f.onglet === "effectifs") return API.appel("/api/analyses/planification-effectifs");
    return API.appel(`/api/analyses/charge-conges?semaines=12&seuil=${f.seuil}`);
  });
  const onglets = [["charge", "Charge des congés"], ...(direction ? [["bradford", "Absentéisme (Bradford)"], ["risque", "Risque de départ"], ["effectifs", "Prévision des effectifs"]] : [])];
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Analyses RH</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Indicateurs d'alerte pour anticiper — à lire avec discernement, jamais à utiliser seuls pour décider.</p></div>
      ${onglets.length > 1 ? `<div class="segment">${onglets.map(([k, l]) => `<button data-onglet-ana="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>`;
  if (!d) return `<section class="carte">${entete}${squelette(260)}</section>`;
  if (d.erreur) return `<section class="carte">${entete}${etatVide("rapport", "Indisponible", echapper(d.erreur))}</section>`;
  let corps = "";
  if (f.onglet === "charge") {
    const classe = (p) => p >= 85 ? "ok" : p >= d.seuil ? "moyen" : "bas";
    corps = `<div class="barre-filtres" style="margin-bottom:10px"><label style="font-size:13px">Seuil d'alerte de présence
        <input class="saisie num" type="number" min="30" max="100" id="ana-seuil" value="${d.seuil}" style="width:80px;display:inline-block"> %</label>
      <span class="aide">Congés et missions approuvés, plus les demandes en attente (comptées comme absences probables).</span></div>
      <div class="tableau-boite carte-chaleur"><table style="min-width:${220 + 90 * d.directions.length}px"><thead><tr><th>Semaine du</th>
        ${d.directions.map((x) => `<th class="centre" style="font-size:11px">${echapper(x)}</th>`).join("")}</tr></thead><tbody>
        ${d.semaines.map((s) => `<tr><td class="mono">${fmtDate(s.semaine)}${s.jours_ouvres < 5 ? ` <span class="badge neutre" title="Jours fériés">${s.jours_ouvres} j</span>` : ""}</td>
          ${d.directions.map((x) => { const c = s.directions[x]; return `<td class="cellule ${classe(c.presence)}" title="${c.effectif} personne(s) · ${c.absents} absent(s) confirmé(s) · ${c.en_attente} demande(s) en attente">
            ${c.presence} %${c.absents || c.en_attente ? `<div style="font-weight:400;font-size:10.5px">${c.absents} abs.${c.en_attente ? ` + ${c.en_attente} ?` : ""}</div>` : ""}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>
      <h3 style="margin:16px 0 8px;font-size:14px">Congés restant à poser d'ici au 31 décembre (${d.jours_ouvres_restants} jours ouvrés)</h3>
      <div class="tableau-boite"><table style="min-width:480px"><thead><tr><th>Direction</th><th class="centre">Effectif</th><th class="centre">Jours à poser</th><th>Part de la capacité restante</th></tr></thead><tbody>
        ${d.restant_a_poser.map((r) => `<tr><td>${echapper(r.direction)}</td><td class="centre num">${r.effectif}</td><td class="centre num">${fmtNombre(r.jours)}</td>
          <td>${r.part_capacite == null ? "—" : `<div class="jauge" style="width:120px;display:inline-block"><span style="width:${Math.min(100, r.part_capacite)}%"></span></div> ${r.part_capacite} %`}</td></tr>`).join("")}</tbody></table></div>
      <p class="aide" style="margin-top:6px">Une part élevée annonce des absences concentrées en fin d'année : à planifier dès maintenant avec les équipes.</p>`;
  } else if (f.onglet === "bradford") {
    corps = `<p class="aide" style="margin-bottom:10px">Indice = (nombre d'épisodes)² × (jours d'absence) sur 52 semaines — congés maladie et absences injustifiées.
        Repères : ${d.seuils.slice().reverse().map((s) => `${s.libelle} ≥ ${s.seuil}`).join(" · ")}. Il met en évidence les absences courtes et répétées ; il ne dit rien de leurs causes.</p>
      <div class="tableau-boite"><table style="min-width:520px"><thead><tr><th>Direction</th><th class="centre">Effectif</th><th class="centre">Épisodes</th><th class="centre">Jours</th><th class="centre">À surveiller</th></tr></thead><tbody>
        ${d.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.effectif}</td><td class="centre num">${a.episodes}</td><td class="centre num">${fmtNombre(a.jours)}</td>
          <td class="centre">${a.a_surveiller ? `<span class="badge attente">${a.a_surveiller}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>
      ${d.collaborateurs ? `<h3 style="margin:16px 0 8px;font-size:14px">${ico("bouclier")} Détail nominatif (RH uniquement)</h3>
        ${d.collaborateurs.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Direction</th><th class="centre">Épisodes</th><th class="centre">Jours</th><th class="centre">Indice</th></tr></thead><tbody>
          ${d.collaborateurs.map((c) => `<tr><td><strong style="font-size:13px">${echapper(c.employe.prenom + " " + c.employe.nom)}</strong></td><td style="font-size:12.5px">${echapper(c.employe.direction)}</td>
            <td class="centre num">${c.episodes}</td><td class="centre num">${fmtNombre(c.jours)}</td><td class="centre"><span class="badge ${NIVEAUX_BRADFORD[c.niveau]}">${c.indice} · ${c.niveau_libelle}</span></td></tr>`).join("")}</tbody></table></div>`
          : etatVide("check", "Aucune absence non planifiée", "Aucun épisode sur les 52 dernières semaines.")}` : `<p class="aide" style="margin-top:8px">Le détail par collaborateur est réservé à la RH.</p>`}`;
  } else if (f.onglet === "risque") {
    corps = `<p class="aide" style="margin-bottom:10px">Score de 0 à 100, somme de facteurs connus : ${d.facteurs.map((x) => `${echapper(x.libelle)} (${x.poids})`).join(" · ")}.
        C'est un signal pour engager un échange (entretien, formation, mobilité), pas une prédiction.</p>
      <div class="tableau-boite"><table style="min-width:520px"><thead><tr><th>Direction</th><th class="centre">Effectif</th><th class="centre">Score moyen</th><th class="centre">Risque élevé</th><th class="centre">Risque moyen</th></tr></thead><tbody>
        ${d.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.effectif}</td><td class="centre num">${a.score_moyen}</td>
          <td class="centre">${a.eleve ? `<span class="badge rejetee">${a.eleve}</span>` : "—"}</td><td class="centre">${a.moyen ? `<span class="badge attente">${a.moyen}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>
      ${d.retraites_12_mois.length ? `<h3 style="margin:16px 0 8px;font-size:14px">Départs en retraite dans les 12 mois</h3>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${d.retraites_12_mois.map((r) => `<span class="badge info">${echapper(r.employe.prenom + " " + r.employe.nom)} — ${fmtDate(r.date)}</span>`).join("")}</div>` : ""}
      ${d.collaborateurs ? `<h3 style="margin:16px 0 8px;font-size:14px">${ico("bouclier")} Collaborateurs à rencontrer (RH uniquement)</h3>
        ${d.collaborateurs.length ? `<div class="tableau-boite"><table style="min-width:620px"><thead><tr><th>Collaborateur</th><th>Direction</th><th class="centre">Score</th><th>Facteurs</th></tr></thead><tbody>
          ${d.collaborateurs.map((c) => { const [cl, l] = NIVEAUX_RISQUE[c.niveau]; return `<tr><td><strong style="font-size:13px">${echapper(c.employe.prenom + " " + c.employe.nom)}</strong><div style="font-size:11.5px;color:var(--encre-3)">${echapper(c.employe.poste || "")}</div></td>
            <td style="font-size:12.5px">${echapper(c.employe.direction)}</td><td class="centre"><span class="badge ${cl}">${c.score} · ${l}</span></td>
            <td style="font-size:12px">${c.motifs.map(echapper).join(" · ")}</td></tr>`; }).join("")}</tbody></table></div>`
          : etatVide("check", "Aucun signal", "Aucun collaborateur ne présente de risque moyen ou élevé.")}` : ""}`;
  } else {
    corps = `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">${carteKpi({cle:"pe1",libelle:"Effectif",valeur:d.effectif,unite:"",icone:"users",couleur:"var(--marine)",fond:"var(--marine-doux)",detail:"collaborateurs actifs"})}${carteKpi({cle:"pe2",libelle:"Retraites à 12 mois",valeur:d.retraites_12_mois.length,unite:"",icone:"horloge",couleur:"var(--alerte)",fond:"var(--alerte-doux)",detail:"à anticiper"})}${carteKpi({cle:"pe3",libelle:"Postes clés critiques",valeur:d.postes_cles_critiques.length,unite:"",icone:"alerte",couleur:"var(--danger)",fond:"var(--danger-doux)",detail:`${d.recrutement_externe.offres_ouvertes} offre(s) externe(s) ouverte(s)`})}</div><div class="tableau-boite"><table><thead><tr><th>Direction</th><th class="centre">Effectif</th><th class="centre">Retraites à 12 mois</th></tr></thead><tbody>${d.par_direction.map(x=>`<tr><td>${echapper(x.direction)}</td><td class="centre num">${x.effectif}</td><td class="centre num">${x.retraites_12_mois||"—"}</td></tr>`).join("")}</tbody></table></div>${d.postes_cles_critiques.length?`<h3 style="margin:16px 0 8px;font-size:14px">Postes clés à sécuriser</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${d.postes_cles_critiques.map(p=>`<span class="badge rejetee">${echapper(p.intitule)} · ${echapper(p.motifs.join(", "))}</span>`).join("")}</div>`:""}<p class="aide" style="margin-top:12px">Recrutement externe : ${d.recrutement_externe.candidatures_en_cours} candidature(s) en cours. Ces indicateurs servent à préparer les actions RH, pas à décider seuls.</p>`;
  }
  return `<section class="carte">${entete}${corps}</section>`;
};

BRANCHEMENTS["/analyses"] = function () {
  const f = etat.filtres.analyses;
  if (!f) return;
  $$("[data-onglet-ana]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.ongletAna; etat.analyses = null; rendre(false); }));
  $("#ana-seuil")?.addEventListener("change", (e) => { f.seuil = Math.min(100, Math.max(30, Number(e.target.value) || 70)); etat.analyses = null; rendre(false); });
};

TITRES["/analyses"] = "Analyses RH";
const menuAvantAnalyses = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantAnalyses();
  if (!(estValideur() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/analyses")) pilotage.items.splice(1, 0, { route: "/analyses", libelle: "Analyses RH", icone: "rapport" });
  return groupes;
};
const naviguerAvantAnalyses = naviguer;
naviguer = function (route) { if (route === "/analyses") etat.analyses = null; return naviguerAvantAnalyses(route); };
const deconnexionAvantAnalyses = deconnexion;
deconnexion = function (...args) { delete etat.filtres.analyses; etat.analyses = null; return deconnexionAvantAnalyses(...args); };
