/* ==========================================================================
   84 — Prévisions RH (12 mois) : présence prévue par mois et par pôle,
   départs connus et probables, effectif projeté et besoin par rapport à
   l'effectif cible, fiabilité des données. RH et Direction générale ; les
   hypothèses et effectifs cibles sont réglés par l'administrateur RH.
   ========================================================================== */
const prevPct = (v) => (v == null ? "—" : `${fmtNombre(v, 1)} %`);
const prevNb = (v) => (v == null ? "—" : fmtNombre(v, Number.isInteger(v) ? 0 : 1));
const prevCouleurPresence = (p, seuil) => (p == null ? "" : p < seuil - 10 ? "var(--danger-doux)" : p < seuil ? "var(--alerte-doux)" : "var(--succes-doux)");

VUES["/previsions"] = function () {
  if (!connecte()) return reserveServeur("Les prévisions RH");
  if (!(estAdmin() || estDirection())) return etatVide("bouclier", "Réservé", "Prévisions réservées à la RH et à la Direction générale.");
  const d = chargerEtat("previsionsRh", () => API.appel("/api/previsions"));
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Prévisions RH — 12 prochains mois</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Ordres de grandeur pour anticiper : absentéisme, congés, présence, départs et besoins d'effectif par pôle ou direction. Aucun score individuel.</p></div></div>`;
  if (!d) return `<section class="carte">${entete}${squelette(320)}</section>`;
  if (d.erreur) return `<section class="carte">${entete}${etatVide("rapport", "Indisponible", echapper(d.erreur))}</section>`;

  const f = d.fiabilite, seuil = d.seuil_presence;
  const minEnsemble = d.ensemble.reduce((m, x) => (x.presence != null && (m == null || x.presence < m.presence) ? x : m), null);
  const libMois = (iso) => (d.mois.find((m) => m.mois === iso) || {}).libelle || iso;
  const certains = d.unites.reduce((s, u) => s + u.departs_certains, 0);
  const probables = d.unites.reduce((s, u) => s + u.departs_probables, 0);
  const besoins = d.unites.filter((u) => u.besoin != null && u.besoin > 0);
  const niveau = { faible: ["danger", "Fiabilité faible"], moyenne: ["alerte", "Fiabilité moyenne"], bonne: ["succes", "Fiabilité bonne"] }[f.niveau];

  const fiabilite = `<div class="bandeau-info ${niveau[0] === "succes" ? "succes" : "alerte"}" style="margin-bottom:14px">${ico(niveau[0] === "succes" ? "check" : "alerte")}
    <span><strong>${niveau[1]}</strong> — données administratives complètes à ${f.completude} %, ${f.mois_historique} mois d'activité enregistrée.
      Absentéisme : ${fmtNombre(d.taux.absenteisme, 1)} % (${d.taux.absenteisme_source}) · départs volontaires : ${fmtNombre(d.taux.depart, 1)} % par an (${d.taux.depart_source}).
      ${f.a_completer.length ? `<ul style="margin:6px 0 0 18px">${f.a_completer.map((m) => `<li>${echapper(m)}</li>`).join("")}</ul>` : ""}</span></div>`;

  const kpis = `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(216px,1fr));margin-bottom:16px">
    ${carteKpi({ cle: "pv1", libelle: "Effectif actuel", valeur: d.effectif, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${d.unites.length} pôle(s) ou direction(s)` })}
    ${carteKpi({ cle: "pv2", libelle: "Présence la plus basse", valeur: minEnsemble ? fmtNombre(minEnsemble.presence, 1) : "—", unite: "%", icone: "calendrier", couleur: minEnsemble && minEnsemble.presence < seuil ? "var(--alerte)" : "var(--succes)", fond: minEnsemble && minEnsemble.presence < seuil ? "var(--alerte-doux)" : "var(--succes-doux)", detail: minEnsemble ? `prévue en ${libMois(minEnsemble.mois)} (seuil ${seuil} %)` : "" })}
    ${carteKpi({ cle: "pv3", libelle: "Départs sur 12 mois", valeur: prevNb(Math.round((certains + probables) * 10) / 10), unite: "", icone: "sortie", couleur: "var(--violet)", fond: "var(--marine-doux)", detail: `${certains} connu(s) + ${fmtNombre(probables, 1)} probable(s)` })}
    ${carteKpi({ cle: "pv4", libelle: "Besoin de recrutement", valeur: besoins.length ? prevNb(Math.round(besoins.reduce((s, u) => s + u.besoin, 0) * 10) / 10) : "—", unite: "", icone: "entree", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: besoins.length ? `${besoins.length} unité(s) sous l'effectif cible` : "effectifs cibles à renseigner" })}</div>`;

  const graphique = `<div class="carte" style="box-shadow:none;border:1px solid var(--trait);margin-bottom:16px"><div class="carte-entete"><h3>Taux de présence prévu — ensemble</h3>
      <span class="carte-sous">jours ouvrés, hors absences non planifiées et congés</span></div>
    <div style="height:240px"><canvas id="g-previsions"></canvas></div></div>`;

  const lignesUnites = d.unites.map((u) => `<tr>
      <td><strong>${echapper(u.unite)}</strong></td><td class="droite num">${u.effectif}</td>
      <td class="droite num">${u.departs_certains}</td><td class="droite num">${fmtNombre(u.departs_probables, 1)}</td>
      <td class="droite num">${u.recrutements_en_cours}</td><td class="droite num"><strong>${fmtNombre(u.effectif_projete, 1)}</strong></td>
      <td class="droite num">${u.effectif_cible ?? "—"}</td>
      <td class="droite">${u.besoin == null ? "—" : u.besoin > 0 ? `<span class="badge alerte">+${fmtNombre(u.besoin, 1)}</span>` : `<span class="badge approuvee">${fmtNombre(u.besoin, 1)}</span>`}</td>
      <td class="droite num">${fmtNombre(u.conges_a_poser_avant_31_12, 1)} j</td></tr>`).join("");
  const effectifs = `<div class="carte" style="box-shadow:none;border:1px solid var(--trait);margin-bottom:16px"><div class="carte-entete"><h3>Effectifs projetés à 12 mois</h3>
      <span class="carte-sous">projeté = actuel − départs connus − départs probables + recrutements en cours</span></div>
    <div class="tableau-boite"><table style="min-width:820px"><thead><tr><th>Pôle / direction</th><th class="droite">Effectif</th><th class="droite">Départs connus</th>
      <th class="droite">Départs probables</th><th class="droite">Recrutements</th><th class="droite">Projeté</th><th class="droite">Cible</th><th class="droite">Besoin</th>
      <th class="droite">Congés à poser avant le 31/12</th></tr></thead><tbody>${lignesUnites}</tbody></table></div></div>`;

  const carte = `<div class="carte" style="box-shadow:none;border:1px solid var(--trait);margin-bottom:16px"><div class="carte-entete"><h3>Présence prévue par mois</h3>
      <span class="carte-sous">en rouge ou orange : sous le seuil de ${seuil} % — renforcer ou étaler les congés</span></div>
    <div class="tableau-boite"><table style="min-width:980px"><thead><tr><th>Pôle / direction</th>${d.mois.map((m) => `<th class="droite">${echapper(m.libelle)}</th>`).join("")}</tr></thead><tbody>
      ${d.unites.map((u) => `<tr><td><strong>${echapper(u.unite)}</strong> <span class="aide">(${u.effectif})</span></td>${u.mois.map((m) =>
        `<td class="droite num" style="background:${prevCouleurPresence(m.presence, seuil)}" title="Congés ${fmtNombre(m.conges, 1)} j (dont ${m.conges_deposes} déposés) · absences ${fmtNombre(m.absences, 1)} j">${m.presence == null ? "—" : Math.round(m.presence)}</td>`).join("")}</tr>`).join("")}
      <tr><td><strong>Ensemble</strong></td>${d.ensemble.map((m) => `<td class="droite num" style="background:${prevCouleurPresence(m.presence, seuil)}"><strong>${m.presence == null ? "—" : Math.round(m.presence)}</strong></td>`).join("")}</tr>
    </tbody></table></div></div>`;

  const nominatifs = Array.isArray(d.departs_nominatifs) ? `<div class="carte" style="box-shadow:none;border:1px solid var(--trait);margin-bottom:16px"><div class="carte-entete"><h3>Départs connus</h3>
      <span class="carte-sous">${ico("bouclier")} liste réservée à la RH</span></div>
    ${d.departs_nominatifs.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Pôle / direction</th><th>Motif</th><th>Date</th></tr></thead><tbody>
      ${d.departs_nominatifs.map((x) => `<tr><td>${echapper(x.employe)} <span class="mono aide">${echapper(x.matricule)}</span></td><td>${echapper(x.unite)}</td><td>${echapper(x.motif)}</td><td>${fmtDate(x.date)}</td></tr>`).join("")}</tbody></table></div>`
      : etatVide("users", "Aucun départ connu", "Renseignez dates de naissance, types et fins de contrat dans les dossiers pour voir retraites et fins de CDD.")}</div>` : "";

  const h = d.hypotheses;
  const reglages = estAdmin() && !estGestionnaire() ? `<details class="carte" style="box-shadow:none;border:1px solid var(--trait)"><summary style="cursor:pointer;font-weight:600">${ico("reglages")} Hypothèses et effectifs cibles</summary>
    <div style="display:grid;gap:14px;margin-top:14px">
      <div class="ligne-champs">
        <div class="champ"><label for="pv-abs">Absentéisme de repère (%)</label><input class="saisie num" type="number" step="0.1" min="0" max="30" id="pv-abs" value="${h.taux_absenteisme}"></div>
        <div class="champ"><label for="pv-dep">Départs volontaires de repère (% par an)</label><input class="saisie num" type="number" step="0.1" min="0" max="50" id="pv-dep" value="${h.taux_depart}"></div>
        <div class="champ"><label for="pv-seuil">Seuil d'alerte de présence (%)</label><input class="saisie num" type="number" min="50" max="100" id="pv-seuil" value="${h.seuil_presence}"></div></div>
      <p class="aide">Les repères ne servent que tant que l'historique est insuffisant (6 mois pour l'absentéisme, 12 pour les départs) ; ensuite le constaté les remplace.</p>
      <div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Profil saisonnier (moyenne 1)</th>${["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."].map((m) => `<th>${m}</th>`).join("")}</tr></thead><tbody>
        ${[["saison_absences", "Absences non planifiées"], ["saison_conges", "Congés"]].map(([k, l]) => `<tr><td>${l}</td>${h[k].map((v, i) =>
          `<td><input class="saisie num" type="number" step="0.05" min="0" max="5" data-pv-saison="${k}:${i}" value="${v}" style="width:62px"></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="tableau-boite"><table style="min-width:420px"><thead><tr><th>Pôle / direction</th><th class="droite">Effectif actuel</th><th class="droite">Effectif cible</th></tr></thead><tbody>
        ${d.unites.filter((u) => u.code !== "-").map((u) => `<tr><td>${echapper(u.unite)}</td><td class="droite num">${u.effectif}</td>
          <td class="droite"><input class="saisie num" type="number" min="0" max="5000" data-pv-cible="${echapper(u.code)}" value="${u.effectif_cible ?? ""}" placeholder="—" style="width:90px"></td></tr>`).join("")}</tbody></table></div>
      <div><button class="btn primaire" id="pv-enregistrer">${ico("check")} Enregistrer les hypothèses</button></div>
    </div></details>` : "";

  return `<section class="carte">${entete}${fiabilite}${kpis}${graphique}${carte}${effectifs}${nominatifs}${reglages}</section>`;
};

BRANCHEMENTS["/previsions"] = function () {
  const d = etat.previsionsRh;
  if (!d || d.erreur) return;
  const canvas = $("#g-previsions");
  if (canvas && typeof Chart !== "undefined") {
    const h = habillage();
    const g = new Chart(canvas, {
      type: "line",
      data: {
        labels: d.mois.map((m) => m.libelle),
        datasets: [
          { label: "Présence prévue", data: d.ensemble.map((m) => m.presence), borderColor: h.marine, backgroundColor: h.marine, tension: 0.3, pointRadius: 3 },
          { label: `Seuil (${d.seuil_presence} %)`, data: d.mois.map(() => d.seuil_presence), borderColor: h.alerte, borderDash: [6, 4], pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { suggestedMin: 50, max: 100, ticks: { color: h.encre3, callback: (v) => `${v} %` }, grid: { color: h.trait } },
                  x: { ticks: { color: h.encre3 }, grid: { display: false } } },
        plugins: { legend: { labels: { color: h.encre } }, tooltip: { ...infobulle(h), callbacks: { label: (c) => ` ${c.dataset.label} : ${fmtNombre(c.raw, 1)} %` } } },
      },
    });
    etat.graphiques.push(g);
  }
  $("#pv-enregistrer")?.addEventListener("click", async () => {
    const h = JSON.parse(JSON.stringify(d.hypotheses));
    h.taux_absenteisme = Number($("#pv-abs").value);
    h.taux_depart = Number($("#pv-dep").value);
    h.seuil_presence = Number($("#pv-seuil").value);
    $$("[data-pv-saison]").forEach((c) => { const [k, i] = c.dataset.pvSaison.split(":"); h[k][Number(i)] = Number(c.value); });
    h.effectifs_cibles = {};
    $$("[data-pv-cible]").forEach((c) => { if (c.value !== "") h.effectifs_cibles[c.dataset.pvCible] = Number(c.value); });
    try {
      await API.appel("/api/previsions/hypotheses", { methode: "PUT", corps: h });
      toast("Hypothèses enregistrées", "Les prévisions sont recalculées.", "succes");
      etat.previsionsRh = null; rendre(false);
    } catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
  });
};

TITRES["/previsions"] = "Prévisions RH";
const menuAvantPrevisions = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantPrevisions();
  if (!(estAdmin() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/previsions")) {
    const apres = pilotage.items.findIndex((i) => i.route === "/indicateurs");
    pilotage.items.splice(apres >= 0 ? apres + 1 : pilotage.items.length, 0, { route: "/previsions", libelle: "Prévisions RH", icone: "rapport" });
  }
  return groupes;
};
const naviguerAvantPrevisions = naviguer;
naviguer = function (route) { if (route === "/previsions") etat.previsionsRh = null; return naviguerAvantPrevisions(route); };
const deconnexionAvantPrevisions = deconnexion;
deconnexion = function (...args) { etat.previsionsRh = null; return deconnexionAvantPrevisions(...args); };
