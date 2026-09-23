/* ==========================================================================
   26. RAPPORTS & ANALYSES
   ========================================================================== */
VUES["/rapports"] = function () {
  const f = etat.filtres.rapports || (etat.filtres.rapports = { dept: "", periode: "annee" });
  let equipe = perimetre();
  if (f.dept) equipe = equipe.filter((e) => e.dept === f.dept);
  const matricules = equipe.map((e) => e.matricule);

  const moisLimite = f.periode === "trimestre" ? Math.max(0, AUJOURDHUI.getMonth() - 2) : 0;
  const pointages = POINTAGES.filter((p) => matricules.includes(p.matricule) && depuisIso(p.date).getMonth() >= moisLimite);
  const demandes = DEMANDES.filter((d) => matricules.includes(d.matricule) && depuisIso(d.debut).getMonth() >= moisLimite);

  const heures = pointages.reduce((s, p) => s + p.heures, 0);
  const prevues = pointages.reduce((s, p) => s + p.prevues, 0);
  const absences = pointages.filter((p) => p.code === "absent").length;
  const conges = pointages.filter((p) => p.code === "conge").length;
  const tauxAbs = pointages.length ? ((absences + conges) / pointages.length) * 100 : 0;
  const anomalies = ANOMALIES.filter((a) => matricules.includes(a.matricule));

  // Classement des collaborateurs par anomalies ouvertes
  const parPersonne = {};
  anomalies.filter((a) => a.statut === "ouverte").forEach((a) => { parPersonne[a.matricule] = (parPersonne[a.matricule] || 0) + 1; });
  const top = Object.entries(parPersonne).sort((a, b) => b[1] - a[1]).slice(0, 5);

  etat.rapport = { equipe, pointages, demandes, matricules, moisLimite };

  return `
  <section class="carte" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <div class="segment" id="rapport-periode">
      <button data-valeur="annee" class="${f.periode === "annee" ? "actif" : ""}">Année ${ANNEE}</button>
      <button data-valeur="trimestre" class="${f.periode === "trimestre" ? "actif" : ""}">3 derniers mois</button>
    </div>
    <select class="saisie" id="rapport-dept" style="width:auto;min-width:210px">
      <option value="">Tout mon périmètre — ${perimetre().length} personnes</option>
      ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
    </select>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn petit" data-export-rapport="Rapport d'activité (PDF)">${ico("telecharger")} PDF</button>
      <button class="btn petit" data-export-rapport="Données détaillées (Excel)">${ico("telecharger")} Excel</button>
    </div>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "r1", libelle: "Taux d'absentéisme", valeur: fmtNombre(tauxAbs), unite: "%", icone: "alerte", couleur: tauxAbs > 8 ? "var(--danger)" : "var(--succes)", fond: tauxAbs > 8 ? "var(--danger-doux)" : "var(--succes-doux)", detail: `${absences + conges} jours d'absence` })}
    ${carteKpi({ cle: "r2", libelle: "Heures travaillées", valeur: Math.round(heures).toLocaleString("fr-FR"), unite: "h", icone: "horloge", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${Math.round(prevues).toLocaleString("fr-FR")} h prévues` })}
    ${carteKpi({ cle: "r3", libelle: "Heures supplémentaires", valeur: Math.round(Math.max(0, heures - prevues)).toLocaleString("fr-FR"), unite: "h", icone: "tableau", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "Au-delà du temps prévu" })}
    ${carteKpi({ cle: "r4", libelle: "Anomalies ouvertes", valeur: anomalies.filter((a) => a.statut === "ouverte").length, unite: "", icone: "croix", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `${anomalies.length} détectées au total` })}
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Absentéisme mois par mois</h3><span class="carte-sous">en % des jours pointés</span></div>
      <div class="boite-graph"><canvas id="g-absenteisme"></canvas></div>
    </article>
    <article class="carte">
      <div class="carte-entete"><h3>Motifs d'absence</h3><span class="carte-sous">demandes approuvées</span></div>
      <div class="boite-graph"><canvas id="g-motifs"></canvas></div>
    </article>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Charge par département</h3><span class="carte-sous">heures faites vs prévues</span></div>
      <div class="boite-graph"><canvas id="g-charge"></canvas></div>
    </article>
    <article class="carte">
      <div class="carte-entete"><h3>Anomalies les plus fréquentes</h3></div>
      ${top.length ? `<div style="display:flex;flex-direction:column;gap:9px">
        ${top.map(([matricule, total]) => {
          const e = parMatricule[matricule];
          const largeur = (total / top[0][1]) * 100;
          return `<div style="display:flex;align-items:center;gap:11px">
            <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px">
                <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${echapper(nomComplet(e))}</strong>
                <span class="num" style="color:var(--encre-3)">${total}</span>
              </div>
              <div class="jauge" style="margin-top:5px;height:6px"><span style="width:${largeur}%;background:linear-gradient(90deg,var(--alerte),var(--danger))"></span></div>
            </div>
          </div>`;
        }).join("")}
      </div>` : etatVide("check", "Aucune anomalie ouverte", "Les badgeages de votre périmètre sont complets.")}
    </article>
  </section>`;
};

BRANCHEMENTS["/rapports"] = function () {
  const f = etat.filtres.rapports;
  $$("#rapport-periode button").forEach((b) => b.addEventListener("click", () => { f.periode = b.dataset.valeur; rendre(false); }));
  $("#rapport-dept").addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
  $$("[data-export-rapport]").forEach((b) => b.addEventListener("click", () =>
    toast("Export en préparation", `${b.dataset.exportRapport} — généré par le backend aux couleurs de Veltaris.`, "info")));
  graphiquesRapports();
};

function graphiquesRapports() {
  const h = habillage();
  const { pointages, demandes, equipe } = etat.rapport;
  const moisAffiches = MOIS_COURT.slice(0, AUJOURDHUI.getMonth() + 1);

  // 1. Absentéisme mensuel
  const parMois = moisAffiches.map((_, index) => {
    const lot = pointages.filter((p) => depuisIso(p.date).getMonth() === index);
    if (!lot.length) return 0;
    return Math.round((lot.filter((p) => p.code === "absent" || p.code === "conge").length / lot.length) * 1000) / 10;
  });
  etat.graphiques.push(new Chart($("#g-absenteisme"), {
    type: "line",
    data: {
      labels: moisAffiches,
      datasets: [{
        label: "Taux d'absentéisme", data: parMois, borderColor: h.marine, borderWidth: 2.6, tension: .35,
        pointRadius: 3.5, pointHoverRadius: 6, pointBackgroundColor: h.surface, pointBorderWidth: 2,
        fill: true, backgroundColor: (ctx) => {
          const zone = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
          zone.addColorStop(0, "rgba(91,155,240,.28)");
          zone.addColorStop(1, "rgba(91,155,240,0)");
          return zone;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: h.trait }, ticks: { color: h.encre3, font: { size: 11.5 } } },
        y: { beginAtZero: true, grid: { color: h.trait }, border: { display: false },
          ticks: { color: h.encre3, callback: (v) => `${v} %`, maxTicksLimit: 6, font: { size: 11 } } },
      },
      plugins: { legend: { display: false }, tooltip: { ...infobulle(h), callbacks: { label: (c) => ` ${c.raw} % d'absentéisme` } } },
    },
  }));

  // 2. Motifs d'absence (barres horizontales)
  const motifs = {};
  demandes.filter((d) => d.statut === "approuvee").forEach((d) => {
    const cle = libelleType(d.type, d.sousType);
    motifs[cle] = (motifs[cle] || 0) + (d.jours || 1);
  });
  const tri = Object.entries(motifs).sort((a, b) => b[1] - a[1]).slice(0, 7);
  etat.graphiques.push(new Chart($("#g-motifs"), {
    type: "bar",
    data: {
      labels: tri.map(([cle]) => cle),
      datasets: [{ label: "Jours", data: tri.map(([, v]) => v), backgroundColor: h.marine, borderRadius: 5, maxBarThickness: 20 }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, grid: { color: h.trait }, border: { display: false }, ticks: { color: h.encre3, font: { size: 11 } } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: h.encre, font: { size: 11.5 }, crossAlign: "far" } },
      },
      plugins: { legend: { display: false }, tooltip: { ...infobulle(h), callbacks: { label: (c) => ` ${c.raw} jour(s)` } } },
    },
  }));

  // 3. Charge par département
  const departements = [...new Set(equipe.map((e) => e.dept))];
  const faites = departements.map((code) => {
    const ids = equipe.filter((e) => e.dept === code).map((e) => e.matricule);
    return Math.round(pointages.filter((p) => ids.includes(p.matricule)).reduce((s, p) => s + p.heures, 0));
  });
  const attendues = departements.map((code) => {
    const ids = equipe.filter((e) => e.dept === code).map((e) => e.matricule);
    return Math.round(pointages.filter((p) => ids.includes(p.matricule)).reduce((s, p) => s + p.prevues, 0));
  });
  etat.graphiques.push(new Chart($("#g-charge"), {
    type: "bar",
    data: {
      labels: departements,
      datasets: [
        { label: "Heures faites", data: faites, backgroundColor: departements.map((c) => couleurDept(c)), borderRadius: 5, maxBarThickness: 32 },
        { label: "Heures prévues", data: attendues, backgroundColor: h.trait, borderRadius: 5, maxBarThickness: 32 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: h.trait }, ticks: { color: h.encre3, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { beginAtZero: true, grid: { color: h.trait }, border: { display: false },
          ticks: { color: h.encre3, callback: (v) => `${v} h`, maxTicksLimit: 6, font: { size: 11 } } },
      },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", color: h.encre, padding: 14, font: { size: 12 } } },
        tooltip: { ...infobulle(h), callbacks: { title: (items) => nomDept(items[0].label), label: (c) => ` ${c.dataset.label} : ${c.raw.toLocaleString("fr-FR")} h` } },
      },
    },
  }));
}

/* ==========================================================================
   27. PARAMÈTRES RH
   ========================================================================== */
const REGLES = {
  heureArrivee: "08:30", toleranceRetard: 5, dureeJournee: 8,
  seuilDoubleValidation: 10, reportMax: 5, delaiReponse: 48,
};

VUES["/parametres"] = function () {
  const f = etat.filtres.parametres || (etat.filtres.parametres = { onglet: "types" });
  const onglets = [["types", "Types de demandes"], ["workflow", "Workflow & règles"], ["feries", "Jours fériés"]];

  let corps = "";
  if (f.onglet === "types") {
    corps = `
      <p style="font-size:12.5px;color:var(--encre-3);margin-bottom:12px">
        Plafonds issus du droit du travail tunisien. Décocher un type le retire des formulaires sans toucher à l'historique.
      </p>
      <div class="tableau-boite">
        <table style="min-width:640px">
          <thead><tr><th>Type de congé</th><th class="centre">Plafond</th><th class="centre">Justificatif</th><th class="centre">Décompte solde</th><th class="centre">Actif</th></tr></thead>
          <tbody>
            ${TYPES_CONGE.map((t) => `<tr>
              <td><strong>${echapper(t.libelle)}</strong><div class="mono" style="font-size:11px;color:var(--encre-3)">${t.code}</div></td>
              <td class="centre num">${t.max ? `${t.max} j` : "—"}</td>
              <td class="centre">${t.justif ? `<span class="badge info">${ico("check")} Requis</span>` : `<span class="badge neutre">Non</span>`}</td>
              <td class="centre">${t.solde ? `<span class="badge or">Oui</span>` : `<span class="badge neutre">Non</span>`}</td>
              <td class="centre"><input type="checkbox" checked data-type-actif="${t.code}" style="width:17px;height:17px;accent-color:var(--marine)"></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  } else if (f.onglet === "workflow") {
    corps = `
      <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <article class="carte" style="box-shadow:none">
          <div class="carte-entete"><h3>Circuit de validation</h3></div>
          <div style="display:flex;flex-direction:column;gap:13px">
            <div class="champ">
              <label for="p-seuil">Double validation au-delà de</label>
              <div style="display:flex;align-items:center;gap:9px">
                <input class="saisie" type="number" id="p-seuil" value="${REGLES.seuilDoubleValidation}" min="1" max="30" style="width:90px">
                <span style="font-size:13px;color:var(--encre-2)">jours de congé consécutifs</span>
              </div>
              <span class="aide">Au-delà, le N+2 doit également valider la demande.</span>
            </div>
            <div class="champ">
              <label for="p-delai">Validation automatique après</label>
              <div style="display:flex;align-items:center;gap:9px">
                <input class="saisie" type="number" id="p-delai" value="${REGLES.delaiReponse}" min="1" max="336" step="1" style="width:90px">
                <span style="font-size:13px;color:var(--encre-2)">heures</span>
              </div>
              <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin-top:4px"><input type="checkbox" id="p-auto" ${REGLES.validationAutomatique === false ? "" : "checked"} style="width:16px;height:16px;accent-color:var(--marine)"> Valider automatiquement les congés et autorisations restés sans réponse dans ce délai</label>
            </div>
            <div class="champ">
              <label for="p-report">Report de solde maximal</label>
              <div style="display:flex;align-items:center;gap:9px">
                <input class="saisie" type="number" id="p-report" value="${REGLES.reportMax}" min="0" max="15" style="width:90px">
                <span style="font-size:13px;color:var(--encre-2)">jours vers l'année suivante</span>
              </div>
            </div>
          </div>
        </article>

        <article class="carte" style="box-shadow:none">
          <div class="carte-entete"><h3>Règles de badgeage</h3></div>
          <div style="display:flex;flex-direction:column;gap:13px">
            <div class="champ">
              <label for="p-arrivee">Heure d'arrivée théorique</label>
              <input class="saisie" type="time" id="p-arrivee" value="${REGLES.heureArrivee}" style="width:140px">
            </div>
            <div class="champ">
              <label for="p-tolerance">Tolérance avant retard</label>
              <div style="display:flex;align-items:center;gap:9px">
                <input class="saisie" type="number" id="p-tolerance" value="${REGLES.toleranceRetard}" min="0" max="30" style="width:90px">
                <span style="font-size:13px;color:var(--encre-2)">minutes</span>
              </div>
            </div>
            <div class="champ">
              <label for="p-duree">Durée d'une journée de travail</label>
              <div style="display:flex;align-items:center;gap:9px">
                <input class="saisie" type="number" id="p-duree" value="${REGLES.dureeJournee}" min="4" max="12" step="0.5" style="width:90px">
                <span style="font-size:13px;color:var(--encre-2)">heures</span>
              </div>
            </div>
            <div style="padding:12px;border-radius:var(--r-m);background:var(--marine-doux);font-size:12.5px;color:var(--encre-2)">
              ${ico("alerte")} Le badgeage en <strong>deux fois par demi-journée</strong> reste obligatoire : toute entrée ou sortie manquante génère une anomalie.
            </div>
          </div>
        </article>
      </div>
      <button class="btn primaire" id="p-enregistrer" style="margin-top:16px">${ico("check")} Enregistrer les règles</button>`;
  } else {
    corps = `
      <p style="font-size:12.5px;color:var(--encre-3);margin-bottom:12px">
        Les fêtes religieuses suivent le calendrier lunaire : leurs dates sont saisies chaque année par la direction RH.
      </p>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">
        ${JOURS_FERIES_CONFIG.map(([date, nom, type]) => `
          <div style="display:flex;align-items:center;gap:11px;padding:12px;border:1px solid var(--trait);border-radius:var(--r-m)">
            <div class="kpi-ico" style="background:${type === "fixe" ? "var(--marine-doux)" : "var(--rouge-doux)"};color:${type === "fixe" ? "var(--marine)" : "var(--rouge)"}">${ico("calendrier")}</div>
            <div style="min-width:0">
              <strong style="font-size:13px;display:block">${echapper(nom)}</strong>
              <span style="font-size:11.5px;color:var(--encre-3)" class="mono">${date} · ${type === "fixe" ? "date fixe" : "date mobile"}</span>
            </div>
          </div>`).join("")}
      </div>
      <button class="btn primaire" id="p-ajouter-ferie" style="margin-top:16px">${ico("plus")} Ajouter un jour férié</button>`;
  }

  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div class="segment" id="parametres-onglets">
        ${onglets.map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("")}
      </div>
    </div>
    ${corps}
  </section>`;
};

BRANCHEMENTS["/parametres"] = function () {
  const f = etat.filtres.parametres;
  $$("#parametres-onglets button").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.onglet; rendre(false); }));

  const enregistrer = $("#p-enregistrer");
  if (enregistrer) enregistrer.addEventListener("click", () => {
    REGLES.seuilDoubleValidation = Number($("#p-seuil").value);
    REGLES.delaiReponse = Number($("#p-delai").value);
    REGLES.reportMax = Number($("#p-report").value);
    REGLES.heureArrivee = $("#p-arrivee").value;
    REGLES.toleranceRetard = Number($("#p-tolerance").value);
    REGLES.dureeJournee = Number($("#p-duree").value);
    JOURNAL.unshift({ action: "Modification des règles RH", cible: "Workflow & badgeage", acteur: moi().matricule,
      detail: `Double validation > ${REGLES.seuilDoubleValidation} j · tolérance ${REGLES.toleranceRetard} min`, date: new Date() });
    toast("Règles enregistrées", "Les nouveaux paramètres s'appliquent aux prochaines demandes.", "succes");
  });
  $$("[data-type-actif]").forEach((c) => c.addEventListener("change", () => {
    toast(c.checked ? "Type réactivé" : "Type désactivé", `« ${libelleType("conge", c.dataset.typeActif)} » ${c.checked ? "apparaît de nouveau" : "n'apparaîtra plus"} dans les formulaires.`, "info");
  }));
  const ajouter = $("#p-ajouter-ferie");
  if (ajouter) ajouter.addEventListener("click", () => toast("Jour férié", "La saisie des dates mobiles se fait en début d'année civile.", "info"));
};

/* ==========================================================================
   28. MON PROFIL
   ========================================================================== */
VUES["/profil"] = function () {
  const u = moi();
  const solde = soldeDe(u.matricule);
  const validateur = u.validateur ? parMatricule[u.validateur] : null;
  const theme = stockage.lire("portail-theme", null) || "light";
  const prefs = stockage.lire("portail-notifs", { validation: true, planning: true, anomalies: true, formations: false });

  return `
  <section class="profil">
    <div class="avatar xl">${initiales(u)}</div>
    <div class="profil-id">
      <h2>${nomComplet(u)}</h2>
      <div class="poste">${echapper(u.poste)}</div>
      <div class="profil-meta">
        <span class="puce-marque mono">${u.matricule}</span>
        <span class="puce-marque">${ico("batiment")} ${nomDept(u.dept)}</span>
        ${u.entree ? `<span class="puce-marque">${ico("calendrier")} ${ANNEE - Number(u.entree.slice(0, 4))} an(s) d'ancienneté</span>` : ""}
      </div>
    </div>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(310px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Informations personnelles</h3>
        <span class="carte-sous">Modifiable par la RH</span></div>
      <div class="tableau-boite">
        <table style="min-width:auto"><tbody>
          <tr><td style="width:44%;color:var(--encre-3);font-weight:600;font-size:12.5px">Matricule</td><td class="mono">${u.matricule}</td></tr>
          <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Email</td><td>${echapper(u.email)}</td></tr>
          <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Téléphone</td><td class="mono">${echapper(u.telephone || "—")}</td></tr>
          <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Date d'entrée</td><td>${u.entree ? fmtDateLongue(u.entree) : "Non renseignée"}</td></tr>
          <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Responsable</td><td>${validateur ? echapper(nomComplet(validateur)) : "Direction"}</td></tr>
          <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Solde ${ANNEE}</td><td><strong>${fmtNombre(solde.restant)} j</strong> sur ${fmtNombre(solde.total)} j</td></tr>
        </tbody></table>
      </div>
      <button class="btn petit" id="profil-correction" style="margin-top:12px">${ico("crayon")} Demander une correction</button>
    </article>

    <article class="carte">
      <div class="carte-entete"><h3>Apparence</h3></div>
      <div class="champ">
        <label>Thème de l'interface</label>
        <div class="segment" id="profil-theme">
          <button data-theme-choix="light" class="${theme === "light" ? "actif" : ""}">${ico("soleil")} Clair</button>
          <button data-theme-choix="dark" class="${theme === "dark" ? "actif" : ""}">${ico("lune")} Sombre</button>
          <button data-theme-choix="systeme" class="${theme === "systeme" ? "actif" : ""}">Système</button>
        </div>
        <span class="aide">Le choix est mémorisé sur cet appareil.</span>
      </div>

      <div class="carte-entete" style="margin-top:20px"><h3>Notifications</h3></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${[["validation", "Décisions sur mes demandes"], ["planning", "Publication de mon planning"],
           ["anomalies", "Anomalies de pointage"], ["formations", "Nouvelles sessions de formation"]]
          .map(([cle, libelle]) => `
          <label style="display:flex;align-items:center;gap:11px;cursor:pointer;font-size:13px">
            <input type="checkbox" data-pref="${cle}" ${prefs[cle] ? "checked" : ""} style="width:17px;height:17px;accent-color:var(--marine)">
            ${libelle}
          </label>`).join("")}
      </div>
    </article>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(310px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Sécurité</h3></div>
      <div class="champ"><label for="mdp-actuel">Mot de passe actuel</label><input class="saisie" type="password" id="mdp-actuel" autocomplete="current-password"></div>
      <div class="champ" style="margin-top:11px"><label for="mdp-nouveau">Nouveau mot de passe</label><input class="saisie" type="password" id="mdp-nouveau" autocomplete="new-password"></div>
      <div class="champ" style="margin-top:11px"><label for="mdp-confirme">Confirmation</label><input class="saisie" type="password" id="mdp-confirme" autocomplete="new-password"></div>
      <button class="btn primaire" id="changer-mdp" style="margin-top:14px">${ico("bouclier")} Changer le mot de passe</button>
    </article>

    <article class="carte">
      <div class="carte-entete"><h3>Mes données</h3></div>
      <p style="font-size:13px;color:var(--encre-2);margin-bottom:13px">
        Récupérez l'ensemble de vos données RH : pointages, demandes, soldes, formations et notes de frais.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-bloc" data-export-perso="Historique complet (Excel)">${ico("telecharger")} Mon historique — Excel</button>
        <button class="btn btn-bloc" data-export-perso="Attestation de solde (PDF)">${ico("telecharger")} Attestation de solde — PDF</button>
        <button class="btn btn-bloc" data-export-perso="Relevé de pointages (PDF)">${ico("telecharger")} Relevé de pointages — PDF</button>
      </div>
    </article>
  </section>`;
};

BRANCHEMENTS["/profil"] = function () {
  $$("[data-theme-choix]").forEach((b) => b.addEventListener("click", () => {
    const choix = b.dataset.themeChoix;
    if (choix === "systeme") {
      try { localStorage.removeItem("portail-theme"); } catch { /* mode privé */ }
      document.documentElement.removeAttribute("data-theme");
      etat.graphiques.forEach((g) => g && g.destroy && g.destroy());
      etat.graphiques = [];
      rendre(false);
      toast("Thème système", "L'interface suit désormais les réglages de votre appareil.", "info");
    } else {
      appliquerTheme(choix);
    }
  }));
  $$("[data-pref]").forEach((c) => c.addEventListener("change", () => {
    const prefs = stockage.lire("portail-notifs", {});
    prefs[c.dataset.pref] = c.checked;
    stockage.ecrire("portail-notifs", prefs);
    toast("Préférence enregistrée", `${c.checked ? "Vous recevrez" : "Vous ne recevrez plus"} ces notifications.`, "succes");
  }));
  $("#changer-mdp").addEventListener("click", () => {
    const actuel = $("#mdp-actuel").value, nouveau = $("#mdp-nouveau").value, confirme = $("#mdp-confirme").value;
    if (actuel !== "demo2026") return toast("Mot de passe incorrect", "Le mot de passe actuel ne correspond pas.", "danger");
    if (nouveau.length < 8) return toast("Mot de passe trop court", "Utilisez au moins 8 caractères.", "danger");
    if (nouveau !== confirme) return toast("Confirmation différente", "Les deux saisies ne correspondent pas.", "danger");
    toast("Mot de passe modifié", "Votre nouveau mot de passe est actif sur tous vos appareils.", "succes");
    ["mdp-actuel", "mdp-nouveau", "mdp-confirme"].forEach((id) => { $(`#${id}`).value = ""; });
  });
  $("#profil-correction").addEventListener("click", () => toast("Demande envoyée", "La direction RH traitera votre demande de correction sous 48 h.", "succes"));
  $$("[data-export-perso]").forEach((b) => b.addEventListener("click", () =>
    toast("Export en préparation", `${b.dataset.exportPerso} — document généré par le backend.`, "info")));
};
