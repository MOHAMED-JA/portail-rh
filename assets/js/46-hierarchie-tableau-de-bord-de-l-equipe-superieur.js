/* ==========================================================================
   46. HIÉRARCHIE : TABLEAU DE BORD DE L'ÉQUIPE (supérieurs, Direction générale)
   Pointages, présences, absences, fiches d'objectifs et d'évaluation de toute
   la ligne hiérarchique ; tout le personnel pour le DG, le DGA et la RH.
   Aucune donnée confidentielle (paie, dossier personnel, notes finalisées).
   ========================================================================== */
const LIBELLE_NIVEAU = Object.fromEntries(NIVEAUX_HIERARCHIQUES);
const estDirection = () => ["dg", "dga"].includes((moi() || {}).niveau);
const SITUATIONS_JOUR = {
  present: ["approuvee", "Présent"], conge: ["info", "En congé"], maladie: ["attente", "Maladie"],
  mission: ["violet", "Mission"], non_pointe: ["rejetee", "Non pointé"], attendu: ["neutre", "Attendu"], repos: ["neutre", "Repos"],
};
const badgeNiveau = (n) => n && n !== "collaborateur" ? `<span class="badge neutre" style="padding:1px 7px">${LIBELLE_NIVEAU[n] || n}</span>` : "";

function filtresPilotage() {
  return etat.filtres.pilotage || (etat.filtres.pilotage = { mois: iso(AUJOURDHUI).slice(0, 7), departement: "", niveau: "", recherche: "" });
}
function chargerPilotage() {
  const f = filtresPilotage();
  const cle = `${f.mois}|${f.departement}|${f.niveau}`;
  if (etat.pilotageCle === cle && etat.pilotage) return etat.pilotage;
  if (etat.pilotageEnCours === cle) return null;
  etat.pilotageEnCours = cle;
  const q = new URLSearchParams({ mois: f.mois });
  if (f.departement) q.set("departement", f.departement);
  if (f.niveau) q.set("niveau", f.niveau);
  API.appel(`/api/pilotage/equipe?${q}`)
    .then((d) => { etat.pilotage = d; etat.pilotageCle = cle; })
    .catch((souci) => { etat.pilotage = { erreur: souci.message }; etat.pilotageCle = cle; })
    .finally(() => { etat.pilotageEnCours = null; if (etat.route === "/tableau-equipe") rendre(false); });
  return null;
}

VUES["/tableau-equipe"] = function () {
  if (!connecte()) return reserveServeur("Le tableau de bord de l'équipe");
  const f = filtresPilotage();
  const d = chargerPilotage();
  if (!d) return squelette(420);
  if (d.erreur) return `<section class="carte">${etatVide("users", "Tableau de bord indisponible", echapper(d.erreur))}</section>`;
  const i = d.indicateurs;
  const presents = d.aujourdhui.present || 0;
  const q = f.recherche.trim().toLowerCase();
  const lignes = d.lignes.filter((l) => !q || `${l.employe.prenom} ${l.employe.nom} ${l.employe.matricule} ${l.employe.poste}`.toLowerCase().includes(q));
  const kpi = (cle, libelle, valeur, unite, icone, couleur, fond, detail) => carteKpi({ cle, libelle, valeur, unite, icone, couleur, fond, detail });
  const moisLisible = new Date(`${d.mois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return `
    <section class="carte">
      <div class="carte-entete" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div style="flex:1;min-width:240px"><h2>Tableau de bord de l'équipe</h2>
          <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">${d.portee === "entreprise"
            ? `Tout le personnel — ${estAdmin() ? "administration RH" : "Direction générale"}`
            : `Votre ligne hiérarchique : collaborateurs directs et indirects`} · ${d.effectif} personne(s)</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="saisie" type="month" id="pi-mois" value="${f.mois}" style="max-width:160px" aria-label="Mois">
          <select class="saisie" id="pi-dept" style="max-width:220px" aria-label="Direction"><option value="">Toutes les directions</option>
            ${d.filtres.departements.map((x) => `<option ${f.departement === x ? "selected" : ""}>${echapper(x)}</option>`).join("")}</select>
          <select class="saisie" id="pi-niveau" style="max-width:190px" aria-label="Niveau"><option value="">Tous les niveaux</option>
            ${d.filtres.niveaux.map((x) => `<option value="${x.code}" ${f.niveau === x.code ? "selected" : ""}>${x.libelle}</option>`).join("")}</select>
          <input class="saisie" id="pi-recherche" placeholder="Nom ou matricule" value="${echapper(f.recherche)}" style="max-width:190px">
        </div>
      </div>
      <div class="bandeau-info" style="margin-top:4px">${ico("bouclier")}<span>${d.notes_visibles
          ? "Consultation seule. Paie et dossier personnel restent réservés à l'administration RH et à l'intéressé."
          : "Paie, dossier personnel et détail des évaluations finalisées restent confidentiels : administration RH, Direction générale et intéressé uniquement."}</span></div>
    </section>
    <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      ${kpi("pi1", "Présents aujourd'hui", presents, `/ ${d.effectif}`, "users", "var(--succes)", "var(--succes-doux)",
        `${d.aujourdhui.conge || 0} en congé · ${d.aujourdhui.mission || 0} en mission · ${d.aujourdhui.non_pointe || 0} non pointé(s)`)}
      ${kpi("pi2", "Taux d'absentéisme", fmtNombre(i.taux_absenteisme, 2), "%", "horloge", "var(--alerte)", "var(--alerte-doux)", `${moisLisible} · maladie, sans solde, suspensions, injustifiées`)}
      ${kpi("pi3", "Retards", i.retards, "", "alerte", "var(--danger)", "var(--danger-doux)", `${i.retard_minutes} min cumulées`)}
      ${kpi("pi4", "Heures travaillées", fmtNombre(i.heures_travaillees, 0), "h", "horloge", "var(--marine)", "var(--marine-doux)", `${fmtNombre(i.heures_prevues, 0)} h prévues sur les jours pointés`)}
      ${kpi("pi5", "Anomalies ouvertes", i.anomalies_ouvertes, "", "alerte", "var(--alerte)", "var(--alerte-doux)", `${i.demandes_en_attente} demande(s) en attente`)}
      ${kpi("pi6", "Fiches", `${i.objectifs_valides}/${d.effectif}`, "", "cible", "var(--violet)", "var(--violet-doux)", `objectifs validés · ${i.evaluations_finalisees} évaluation(s) finalisée(s)`)}
    </section>
    <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <article class="carte"><div class="carte-entete"><h3>Situation aujourd'hui</h3></div><div class="boite-graph" style="height:220px"><canvas id="g-pi-jour"></canvas></div></article>
      <article class="carte"><div class="carte-entete"><h3>Absences — ${moisLisible}</h3><span class="carte-sous">jours</span></div><div class="boite-graph" style="height:220px"><canvas id="g-pi-absences"></canvas></div></article>
    </section>
    <section class="carte">
      <div class="carte-entete"><h3>Collaborateurs</h3><span class="carte-sous">${lignes.length} affiché(s) · cliquez sur une ligne pour le détail du mois</span></div>
      ${lignes.length ? `<div class="tableau-boite"><table style="min-width:1080px"><thead><tr>
        <th>Collaborateur</th><th>Aujourd'hui</th><th class="centre">Présence</th><th class="centre">Heures</th><th class="centre">Retards</th>
        <th class="centre">Absences</th><th class="centre">Anomalies</th><th class="centre">Solde</th><th>Objectifs</th><th>Évaluation</th>${d.notes_visibles ? '<th class="centre">Note finale</th>' : ""}</tr></thead><tbody>
        ${lignes.map((l) => {
          const e = l.employe, a = l.absences;
          const [cj, lj] = SITUATIONS_JOUR[l.aujourdhui] || ["neutre", "—"];
          const [co, lo] = STATUTS_OBJECTIFS[l.objectifs] || ["neutre", l.objectifs];
          const [ce, le] = STATUTS_EVALUATION[l.evaluation] || ["neutre", l.evaluation];
          const abs = [["Congé", a.conge], ["Maladie", a.maladie], ["Mission", a.mission], ["Sans solde", a.sans_solde],
            ["Suspension", a.suspension], ["Injustifiée", a.injustifiee]].filter(([, v]) => v).map(([k, v]) => `${k} ${fmtNombre(v)}`).join(" · ");
          return `<tr data-pilotage="${echapper(e.matricule)}" style="cursor:pointer">
            <td><strong style="font-size:13px">${echapper(e.prenom + " " + e.nom)}</strong> ${badgeNiveau(e.niveau)}
              <div style="font-size:11.5px;color:var(--encre-3)">${echapper(e.poste || "")}${e.grade ? ` · ${echapper(e.grade)}` : ""}${d.portee === "entreprise" && e.departement ? ` · ${echapper(e.departement)}` : ""}</div></td>
            <td>${l.aujourdhui ? `<span class="badge ${cj}">${lj}</span>` : "—"}</td>
            <td class="centre num">${l.jours_presents} / ${l.jours_ouvres} j</td>
            <td class="centre num">${fmtNombre(l.heures_travaillees)} / ${fmtNombre(l.heures_prevues)} h</td>
            <td class="centre num" style="color:${l.retards ? "var(--danger)" : "inherit"}">${l.retards ? `${l.retards} · ${l.retard_minutes} min` : "—"}</td>
            <td class="centre" style="font-size:12px">${abs || "—"}</td>
            <td class="centre num">${l.anomalies_ouvertes || "—"}</td>
            <td class="centre num">${l.solde_conges == null ? "—" : `${fmtNombre(l.solde_conges)} j`}</td>
            <td><span class="badge ${co}">${lo}</span></td><td><span class="badge ${ce}">${le}</span></td>
            ${d.notes_visibles ? `<td class="centre num"><strong>${l.note_finale == null ? "—" : `${fmtNombre(l.note_finale, 2)} / 20`}</strong></td>` : ""}</tr>`;
        }).join("")}</tbody></table></div>` : etatVide("users", "Aucun collaborateur", "Aucun collaborateur ne correspond aux filtres.")}
    </section>`;
};

BRANCHEMENTS["/tableau-equipe"] = function () {
  const f = filtresPilotage();
  const d = etat.pilotage;
  const changer = (cle, valeur) => { f[cle] = valeur; etat.pilotage = null; rendre(false); };
  const mois = $("#pi-mois"); if (mois) mois.addEventListener("change", () => mois.value && changer("mois", mois.value));
  const dept = $("#pi-dept"); if (dept) dept.addEventListener("change", () => changer("departement", dept.value));
  const niveau = $("#pi-niveau"); if (niveau) niveau.addEventListener("change", () => changer("niveau", niveau.value));
  const recherche = $("#pi-recherche");
  if (recherche) recherche.addEventListener("input", () => {
    f.recherche = recherche.value;
    const position = recherche.selectionStart;
    rendre(false);
    const champ = $("#pi-recherche"); if (champ) { champ.focus(); champ.setSelectionRange(position, position); }
  });
  $$("[data-pilotage]").forEach((tr) => tr.addEventListener("click", () => ouvrirDetailPilotage(tr.dataset.pilotage)));
  if (!d || d.erreur || !$("#g-pi-jour")) return;
  const h = habillage();
  const couleurs = { present: h.succes, conge: h.info, maladie: h.alerte, mission: h.violet, non_pointe: h.danger, attendu: h.encre3, repos: h.trait };
  const cles = Object.keys(SITUATIONS_JOUR).filter((k) => d.aujourdhui[k]);
  etat.graphiques.push(new Chart($("#g-pi-jour"), { type: "doughnut",
    data: { labels: cles.map((k) => SITUATIONS_JOUR[k][1]), datasets: [{ data: cles.map((k) => d.aujourdhui[k]), backgroundColor: cles.map((k) => couleurs[k]), borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right", labels: { color: h.encre } } } } }));
  const types = Object.keys(d.absences);
  etat.graphiques.push(new Chart($("#g-pi-absences"), { type: "bar",
    data: { labels: types, datasets: [{ data: types.map((k) => d.absences[k]), backgroundColor: h.marine, borderRadius: 6 }] },
    options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: h.trait }, ticks: { color: h.encre3, precision: 0 } }, y: { grid: { display: false }, ticks: { color: h.encre } } } } }));
};

async function ouvrirDetailPilotage(matricule) {
  const f = filtresPilotage();
  let d;
  try { d = await API.appel(`/api/pilotage/collaborateur/${encodeURIComponent(matricule)}?mois=${f.mois}`); }
  catch (souci) { return toast("Détail indisponible", souci.message, "danger"); }
  const e = d.employe;
  const heure = (x) => x || "—";
  const LIBELLES_ANOMALIE = { entree_manquante: "Entrée manquante", sortie_manquante: "Sortie manquante", retard: "Retard",
    depart_anticipe: "Départ anticipé", absence_non_justifiee: "Absence non justifiée", pointage_impair: "Pointage impair" };
  const STATUTS_DEMANDE_PI = { en_attente: ["attente", "En attente"], approuvee: ["approuvee", "Approuvée"], rejetee: ["rejetee", "Refusée"],
    annulee: ["annulee", "Annulée"], brouillon: ["neutre", "Brouillon"] };
  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true" style="width:min(820px,100%)">
      ${enteteTiroir(`${echapper(e.prenom + " " + e.nom)}`, `${echapper(e.poste || "")}${e.niveau && e.niveau !== "collaborateur" ? ` · ${LIBELLE_NIVEAU[e.niveau]}` : ""}${e.grade ? ` · ${echapper(e.grade)}` : ""}${e.superieur ? ` · N+1 : ${echapper(e.superieur)}` : ""}`)}
      <div class="tiroir-corps" style="display:flex;flex-direction:column;gap:14px">
        <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
          ${[["Présence", `${d.jours_presents} / ${d.jours_ouvres} j`], ["Heures", `${fmtNombre(d.heures_travaillees)} / ${fmtNombre(d.heures_prevues)} h`],
             ["Retards", d.retards ? `${d.retards} · ${d.retard_minutes} min` : "Aucun"], ["Anomalies ouvertes", d.anomalies_ouvertes],
             ["Autorisations", `${fmtNombre(d.autorisations_heures)} h`], ["Solde congés", d.solde_conges == null ? "—" : `${fmtNombre(d.solde_conges)} j`]]
            .map(([k, v]) => `<div class="sirh-section" style="padding:10px"><h4>${k}</h4><strong style="font-size:17px">${v}</strong></div>`).join("")}
        </div>
        <div class="sirh-section"><h4>Pointages du mois</h4>
          ${d.pointages.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Jour</th><th>Entrée</th><th>Sortie</th><th>Entrée</th><th>Sortie</th><th class="centre">Heures</th><th class="centre">Retard</th></tr></thead><tbody>
            ${d.pointages.map((p) => `<tr><td class="mono">${fmtDate(p.jour)}</td><td class="mono">${heure(p.entree1)}</td><td class="mono">${heure(p.sortie1)}</td>
              <td class="mono">${heure(p.entree2)}</td><td class="mono">${heure(p.sortie2)}</td><td class="centre num">${fmtNombre(p.heures)}</td>
              <td class="centre num" style="color:${p.retard ? "var(--danger)" : "inherit"}">${p.retard ? `${p.retard} min` : "—"}</td></tr>`).join("")}
          </tbody></table></div>` : `<p style="font-size:12.5px;color:var(--encre-3)">Aucun pointage ce mois-ci.</p>`}</div>
        <div class="sirh-section"><h4>Anomalies</h4>
          ${d.anomalies.length ? d.anomalies.map((a) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--trait)">
            <span>${fmtDate(a.jour)} — ${LIBELLES_ANOMALIE[a.type] || a.type}</span><span class="badge ${a.statut === "ouverte" ? "attente" : "approuvee"}">${a.statut === "ouverte" ? "Ouverte" : a.statut === "justifiee" ? "Justifiée" : "Ignorée"}</span></div>`).join("")
            : `<p style="font-size:12.5px;color:var(--encre-3)">Aucune anomalie.</p>`}</div>
        <div class="sirh-section"><h4>Congés, autorisations et missions</h4>
          ${d.demandes.length ? d.demandes.map((x) => { const [c, l] = STATUTS_DEMANDE_PI[x.statut] || ["neutre", x.statut]; return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--trait)">
            <span><strong>${echapper(x.libelle)}</strong> · ${fmtDate(x.du)}${x.au !== x.du ? ` → ${fmtDate(x.au)}` : ""} · ${x.type === "autorisation" ? `${fmtNombre(x.heures || 0)} h` : `${fmtNombre(x.jours)} j`}</span>
            <span class="badge ${c}">${l}</span></div>`; }).join("") : `<p style="font-size:12.5px;color:var(--encre-3)">Aucune demande sur la période.</p>`}</div>
        <div class="sirh-section"><h4>Fiches ${f.mois.slice(0, 4)}</h4>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px">Objectifs : <span class="badge ${(STATUTS_OBJECTIFS[d.objectifs] || ["neutre"])[0]}">${(STATUTS_OBJECTIFS[d.objectifs] || [0, d.objectifs])[1]}</span>
            Évaluation : <span class="badge ${(STATUTS_EVALUATION[d.evaluation] || ["neutre"])[0]}">${(STATUTS_EVALUATION[d.evaluation] || [0, d.evaluation])[1]}</span>
            ${d.note_finale != null ? `Note finale : <strong>${fmtNombre(d.note_finale, 2)} / 20</strong>` : ""}</div>
          <p class="aide">${"note_finale" in d ? "Consultation seule : la fiche complète s'ouvre depuis « Fiche d'évaluation » → Fiches de mon équipe."
            : "Le détail d'une évaluation finalisée n'est consultable que par l'administration RH, la Direction générale et l'intéressé."}</p></div>
      </div>
    </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
}

TITRES["/tableau-equipe"] = "Tableau de bord équipe";
/* Filtres et données propres à la session : remis à zéro à la déconnexion. */
const deconnexionAvantPilotage = deconnexion;
deconnexion = function (...args) {
  delete etat.filtres.pilotage;
  etat.pilotage = null; etat.pilotageCle = null;
  return deconnexionAvantPilotage(...args);
};
const menuAvantPilotage = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantPilotage();
  if (!(estValideur() || estDirection())) return groupes;
  let equipe = groupes.find((g) => g.titre === "Équipe");
  if (equipe && !equipe.items.some((i) => i.route === "/tableau-equipe")) {
    equipe.items.unshift({ route: "/tableau-equipe", libelle: "Tableau de bord équipe", icone: "tableau" });
  }
  return groupes;
};
const naviguerAvantPilotage = naviguer;
naviguer = function (route) {
  if (route === "/tableau-equipe") etat.pilotage = null;
  return naviguerAvantPilotage(route);
};
