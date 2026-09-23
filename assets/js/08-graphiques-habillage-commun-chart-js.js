/* ==========================================================================
   8. GRAPHIQUES — habillage commun Chart.js
   ========================================================================== */
const couleurCss = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();

function habillage() {
  return {
    encre: couleurCss("--encre-2"), encre3: couleurCss("--encre-3"),
    trait: couleurCss("--trait"), surface: couleurCss("--surface"),
    marine: couleurCss("--marine"), rouge: couleurCss("--rouge"), succes: couleurCss("--succes"),
    alerte: couleurCss("--alerte"), danger: couleurCss("--danger"), info: couleurCss("--info"),
    violet: couleurCss("--violet"),
  };
}
function infobulle(h) {
  return {
    backgroundColor: h.surface, titleColor: couleurCss("--encre"), bodyColor: h.encre,
    borderColor: h.trait, borderWidth: 1, padding: 11, cornerRadius: 10, displayColors: true,
    boxPadding: 5, titleFont: { family: "IBM Plex Sans", weight: "600", size: 12.5 },
    bodyFont: { family: "IBM Plex Sans", size: 12.5 },
  };
}

function donut(canvas, etiquettes, valeurs, couleurs, centreLibelle) {
  const h = habillage();
  const total = valeurs.reduce((a, b) => a + b, 0) || 1;
  const graphique = new Chart(canvas, {
    type: "doughnut",
    data: { labels: etiquettes, datasets: [{ data: valeurs, backgroundColor: couleurs, borderColor: h.surface, borderWidth: 3, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: { display: false },
        tooltip: { ...infobulle(h), callbacks: { label: (c) => ` ${c.label} : ${c.raw} j (${Math.round(c.raw / total * 100)} %)` } },
      },
      animation: { animateScale: true, duration: 700 },
    },
    plugins: [{
      id: "centre",
      afterDraw(g) {
        const { ctx } = g; const { x, y } = g.getDatasetMeta(0).data[0] || { x: 0, y: 0 };
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = couleurCss("--encre");
        ctx.font = "700 24px Archivo, sans-serif";
        ctx.fillText(total, x, y - 2);
        ctx.fillStyle = h.encre3;
        ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
        ctx.fillText(centreLibelle, x, y + 15);
        ctx.restore();
      },
    }],
  });
  etat.graphiques.push(graphique);
  return graphique;
}

function legendeInteractive(conteneur, graphique, etiquettes, valeurs, couleurs, unite = "j") {
  conteneur.innerHTML = etiquettes.map((e, i) => `
    <button data-index="${i}">
      <span class="point" style="background:${couleurs[i]}"></span>${e}
      <span class="valeur">${valeurs[i]} ${unite}</span>
    </button>`).join("");
  conteneur.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.index);
    graphique.toggleDataVisibility(i);
    b.classList.toggle("eteint");
    graphique.update();
  }));
}

/* ==========================================================================
   9. TABLEAU DE BORD
   ========================================================================== */
function statsPersonnelles() {
  const pointages = mesPointages();
  const mois = AUJOURDHUI.getMonth();
  const duMois = pointages.filter((p) => depuisIso(p.date).getMonth() === mois);
  const duPrecedent = pointages.filter((p) => depuisIso(p.date).getMonth() === (mois === 0 ? 11 : mois - 1));

  const heuresMois = duMois.reduce((s, p) => s + p.heures, 0);
  const heuresPrec = duPrecedent.reduce((s, p) => s + p.heures, 0);
  const prevuesMois = duMois.reduce((s, p) => s + p.prevues, 0);
  // Tolérance de 5 minutes appliquée par la direction RH avant de compter un retard.
  const retardsMois = duMois.filter((p) => p.retard > 5).length;
  const retardsPrec = duPrecedent.filter((p) => p.retard > 5).length;
  const minutesRetard = duMois.reduce((s, p) => s + p.retard, 0);

  const presents = pointages.filter((p) => p.code === "present" || p.code === "mission").length;
  const conges = pointages.filter((p) => p.code === "conge").length;
  const absents = pointages.filter((p) => p.code === "absent").length;
  const ponctuels = pointages.filter((p) => p.retard <= 5 && p.code === "present").length;
  const enRetard = pointages.filter((p) => p.retard > 5).length;
  const anomaliesMoi = ANOMALIES.filter((a) => a.matricule === moi().matricule).length;

  const serieMois = Array.from({ length: 12 }, () => ({ faites: 0, prevues: 0 }));
  pointages.forEach((p) => {
    const m = depuisIso(p.date).getMonth();
    serieMois[m].faites += p.heures;
    serieMois[m].prevues += p.prevues;
  });

  return {
    heuresMois, heuresPrec, prevuesMois, retardsMois, retardsPrec, minutesRetard,
    presents, conges, absents, ponctuels, enRetard, anomaliesMoi, serieMois,
    anomaliesOuvertes: ANOMALIES.filter((a) => a.matricule === moi().matricule && a.statut === "ouverte").length,
    sparkline: duMois.slice(-14).map((p) => p.heures),
  };
}

function variation(courant, precedent) {
  if (!precedent) return null;
  return Math.round(((courant - precedent) / precedent) * 100);
}
function badgeTendance(valeur, inverse = false) {
  if (valeur === null || valeur === 0) return `<span class="tendance neutre">stable</span>`;
  const positif = inverse ? valeur < 0 : valeur > 0;
  return `<span class="tendance ${positif ? "haut" : "bas"}">${ico(valeur > 0 ? "haut" : "bas")}${Math.abs(valeur)} %</span>`;
}
function sparkline(valeurs, couleur) {
  if (!valeurs.length) return "";
  const max = Math.max(...valeurs, 1), min = Math.min(...valeurs, 0);
  const pas = 64 / Math.max(1, valeurs.length - 1);
  const points = valeurs.map((v, i) => `${(i * pas).toFixed(1)},${(22 - ((v - min) / (max - min || 1)) * 18).toFixed(1)}`).join(" ");
  return `<svg width="64" height="24" viewBox="0 0 64 24" fill="none" aria-hidden="true">
    <polyline points="${points}" stroke="${couleur}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".85"/>
  </svg>`;
}

function carteKpi({ cle, libelle, valeur, unite, icone, couleur, fond, detail, tendance, spark }) {
  return `<article class="kpi" data-kpi="${cle}">
    <div class="kpi-tete">
      <div class="kpi-ico" style="background:${fond};color:${couleur}">${ico(icone)}</div>
      <div class="kpi-libelle">${libelle}</div>
    </div>
    <div class="kpi-valeur">${valeur}<span>${unite}</span></div>
    <div class="kpi-bas">
      <div>
        <div class="kpi-detail">${detail}</div>
        ${tendance || ""}
      </div>
      ${spark || ""}
    </div>
  </article>`;
}

function insightsRH() {
  const resultats = [];
  const scope = perimetre().filter((e) => e.matricule !== moi().matricule);

  const faibles = scope.filter((e) => soldeDe(e.matricule).restant <= 3);
  if (faibles.length) {
    resultats.push({ niveau: "alerte", titre: `${faibles.length} collaborateur(s) en fin de solde`,
      message: faibles.slice(0, 4).map((e) => `${nomComplet(e)} (${fmtNombre(soldeDe(e.matricule).restant)} j)`).join(", ") + (faibles.length > 4 ? "…" : ""),
      action: "Anticiper les demandes de fin d'année." });
  }
  const anciennes = demandesAValider().filter((d) => (Date.now() - d.cree) / 86400000 > 3);
  if (anciennes.length) {
    resultats.push({ niveau: "critique", titre: `${anciennes.length} demande(s) en attente depuis plus de 3 jours`,
      message: "Le délai de réponse cible fixé par la direction RH est de 48 heures.", action: "Traiter la file de validation." });
  }
  const parEmploye = {};
  anomaliesOuvertes().forEach((a) => { parEmploye[a.matricule] = (parEmploye[a.matricule] || 0) + 1; });
  const recurrents = Object.entries(parEmploye).filter(([, n]) => n >= 4);
  if (recurrents.length) {
    resultats.push({ niveau: "info", titre: "Anomalies de pointage récurrentes",
      message: recurrents.slice(0, 3).map(([m, n]) => `${nomComplet(parMatricule[m])} (${n})`).join(", "),
      action: "Rappeler la procédure de badgeage en 2 fois par demi-journée." });
  }
  if (!resultats.length) {
    resultats.push({ niveau: "info", titre: "Aucun signal faible détecté", message: "Soldes, absentéisme et file de validation sont dans les seuils attendus." });
  }
  return resultats;
}

VUES["/tableau-bord"] = function () {
  const u = moi();
  const s = statsPersonnelles();
  const solde = soldeDe(u.matricule);
  const validateur = u.validateur ? parMatricule[u.validateur] : null;
  const dernieres = mesDemandes().slice(0, 4);
  const notifs = mesNotifications().slice(0, 5);
  const pourcentage = Math.max(0, Math.min(100, (solde.restant / solde.total) * 100));

  const insights = estValideur() ? `
    <section class="carte">
      <div class="carte-entete">
        <h2>Signaux RH</h2>
        <span class="carte-sous">Détection automatique sur votre périmètre</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${insightsRH().map((i) => {
          const couleurs = { critique: ["--danger", "--danger-doux"], alerte: ["--alerte", "--alerte-doux"], info: ["--info", "--info-doux"] }[i.niveau];
          return `<div style="display:flex;gap:11px;padding:12px 13px;border-radius:var(--r-m);background:var(${couleurs[1]});border:1px solid color-mix(in srgb,var(${couleurs[0]}) 24%,transparent)">
            <div style="color:var(${couleurs[0]});flex:none;margin-top:1px">${ico("alerte")}</div>
            <div>
              <strong style="font-size:13.5px;display:block">${echapper(i.titre)}</strong>
              <p style="font-size:12.5px;color:var(--encre-2);margin-top:2px">${echapper(i.message)}</p>
              ${i.action ? `<p style="font-size:12px;color:var(${couleurs[0]});font-weight:600;margin-top:5px">${echapper(i.action)}</p>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>` : "";

  return `
  <section class="profil">
    <div class="avatar xl">${initiales(u)}</div>
    <div class="profil-id">
      <h2>${nomComplet(u)}</h2>
      <div class="poste">${echapper(u.poste)}</div>
      <div class="profil-meta">
        <span class="puce-marque mono">${u.matricule}</span>
        <span class="puce-marque">${ico("batiment")} ${nomDept(u.dept)}</span>
        ${validateur ? `<span class="puce-marque">${ico("users")} N+1 · ${nomComplet(validateur)}</span>` : `<span class="puce-marque">${ico("bouclier")} Validation finale</span>`}
        ${u.entree ? `<span class="puce-marque">${ico("calendrier")} Entré le ${fmtDate(u.entree)}</span>` : ""}
      </div>
    </div>
    <div class="profil-solde">
      <div class="lib">Solde ${ANNEE}</div>
      <div class="val">${fmtNombre(solde.restant)} <span style="font-size:14px;font-weight:600">jours</span></div>
      <div class="jauge"><span style="width:${pourcentage}%"></span></div>
      <div style="font-size:11.5px;color:rgba(255,255,255,.82);margin-top:7px">${fmtNombre(solde.pris)} j pris · ${fmtNombre(solde.total)} j acquis</div>
    </div>
  </section>

  <section class="actions-rapides">
    <button class="action-rapide" data-demande="conge">
      <span class="ico" style="background:var(--marine-doux);color:var(--marine)">${ico("calendrier")}</span>
      <span><strong>Demander un congé</strong><span>Solde et jours ouvrés calculés en direct</span></span>
    </button>
    <button class="action-rapide" data-demande="autorisation">
      <span class="ico" style="background:var(--info-doux);color:var(--info)">${ico("horloge")}</span>
      <span><strong>Autorisation d'absence</strong><span>Quelques heures dans la journée</span></span>
    </button>
    <button class="action-rapide" data-demande="mission">
      <span class="ico" style="background:var(--violet-doux);color:var(--violet)">${ico("avion")}</span>
      <span><strong>Ordre de mission</strong><span>Formation, visite de risque, télétravail…</span></span>
    </button>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(216px,1fr))">
    ${carteKpi({ cle: "solde", libelle: "Solde de congés", valeur: fmtNombre(solde.restant), unite: "j", icone: "calendrier",
      couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${fmtNombre(solde.pris)} j pris sur ${fmtNombre(solde.total)} j`,
      tendance: `<span class="tendance ${solde.restant < 5 ? "bas" : "neutre"}" style="margin-top:6px">${solde.restant < 5 ? "solde faible" : "dans les clous"}</span>` })}
    ${carteKpi({ cle: "absences", libelle: "Absences cumulées", valeur: s.conges + s.absents, unite: "j", icone: "users",
      couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `${s.anomaliesOuvertes} anomalie(s) ouverte(s)`,
      tendance: `<span class="tendance ${s.absents ? "bas" : "haut"}" style="margin-top:6px">${s.absents} absence(s) injustifiée(s)</span>` })}
    ${carteKpi({ cle: "heures", libelle: "Heures travaillées (mois)", valeur: fmtNombre(s.heuresMois), unite: "h", icone: "horloge",
      couleur: "var(--succes)", fond: "var(--succes-doux)", detail: `${fmtNombre(s.prevuesMois)} h prévues`,
      tendance: badgeTendance(variation(s.heuresMois, s.heuresPrec)), spark: sparkline(s.sparkline, couleurCss("--succes")) })}
    ${carteKpi({ cle: "retards", libelle: "Retards & heures supp.", valeur: s.retardsMois, unite: "", icone: "alerte",
      couleur: "var(--danger)", fond: "var(--danger-doux)",
      detail: `${s.minutesRetard} min cumulées · ${fmtNombre(Math.max(0, s.heuresMois - s.prevuesMois))} h supp.`,
      tendance: badgeTendance(variation(s.retardsMois, s.retardsPrec), true) })}
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(288px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Répartition des présences</h3><span class="carte-sous">${ANNEE}</span></div>
      <div class="boite-graph donut"><canvas id="g-absences"></canvas></div>
      <div class="legende" id="l-absences"></div>
    </article>
    <article class="carte">
      <div class="carte-entete"><h3>Ponctualité</h3><span class="carte-sous">${ANNEE}</span></div>
      <div class="boite-graph donut"><canvas id="g-retards"></canvas></div>
      <div class="legende" id="l-retards"></div>
    </article>
  </section>

  <section class="carte">
    <div class="carte-entete">
      <h3>Heures travaillées vs heures prévues</h3>
      <span class="carte-sous">Cumul mensuel ${ANNEE}</span>
    </div>
    <div class="boite-graph"><canvas id="g-heures"></canvas></div>
  </section>

  ${insights}

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <article class="carte">
      <div class="carte-entete">
        <h3>Notifications</h3>
        ${nonLues() ? `<button class="btn petit fantome" data-tout-lu="1">Tout marquer comme lu</button>` : ""}
      </div>
      ${notifs.length ? `<div class="liste-notif">${notifs.map(ligneNotification).join("")}</div>`
        : etatVide("cloche", "Aucune notification", "Vous serez prévenu ici dès qu'une demande change de statut.")}
    </article>

    <article class="carte">
      <div class="carte-entete">
        <h3>Mes dernières demandes</h3>
        <button class="btn petit fantome" data-route="/mes-demandes">Tout voir ${ico("chevronD")}</button>
      </div>
      ${dernieres.length ? `<div style="display:flex;flex-direction:column;gap:8px">
        ${dernieres.map((d) => `
          <button class="inbox-item ${d.type}" data-demande-ref="${d.ref}" style="grid-template-columns:1fr auto;text-align:left;cursor:pointer">
            <div class="inbox-corps">
              <div class="titre">${echapper(libelleType(d.type, d.sousType))}</div>
              <div class="meta"><span class="mono">${d.ref}</span><span>${fmtDate(d.debut)} → ${fmtDate(d.fin)}</span></div>
            </div>
            ${badgeStatut(d.statut)}
          </button>`).join("")}
      </div>` : etatVide("demandes", "Aucune demande", "Vos demandes de congé, d'autorisation et de mission apparaîtront ici.")}
    </article>
  </section>`;
};

function badgeStatut(statut) {
  const map = {
    en_attente: ["attente", "horloge", "En attente"],
    approuvee: ["approuvee", "check", "Approuvée"],
    rejetee: ["rejetee", "croix", "Rejetée"],
    annulee: ["annulee", "croix", "Annulée"],
  };
  const [cls, icone, libelle] = map[statut] || map.en_attente;
  return `<span class="badge ${cls}">${ico(icone)}${libelle}</span>`;
}

function ligneNotification(n) {
  const styles = {
    succes: ["check", "var(--succes)", "var(--succes-doux)"],
    alerte: ["alerte", "var(--alerte)", "var(--alerte-doux)"],
    validation: ["inbox", "var(--marine)", "var(--marine-doux)"],
    info: ["cloche", "var(--info)", "var(--info-doux)"],
  };
  const [icone, couleur, fond] = styles[n.type] || styles.info;
  return `<div class="notif ${n.lu ? "" : "non-lue"}" data-notif="${n.id}">
    <div class="notif-ico" style="background:${fond};color:${couleur}">${ico(icone)}</div>
    <div class="notif-corps">
      <strong>${echapper(n.titre)}</strong>
      <p>${echapper(n.message)}</p>
      <time>${tempsRelatif(n.date)}</time>
    </div>
    ${n.lu ? "" : '<span class="pastille-bleue" aria-label="Non lue"></span>'}
  </div>`;
}

function etatVide(icone, titre, texte, action = "") {
  return `<div class="vide">
    <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
      <ellipse cx="80" cy="103" rx="52" ry="7" fill="currentColor" opacity=".13"/>
      <rect x="40" y="26" width="80" height="62" rx="10" fill="var(--surface-3)" stroke="var(--trait-fort)" stroke-width="1.5"/>
      <rect x="52" y="42" width="42" height="5" rx="2.5" fill="var(--trait-fort)"/>
      <rect x="52" y="55" width="56" height="5" rx="2.5" fill="var(--trait-fort)" opacity=".7"/>
      <rect x="52" y="68" width="30" height="5" rx="2.5" fill="var(--trait-fort)" opacity=".45"/>
      <circle cx="114" cy="34" r="17" fill="var(--marine-doux)" stroke="var(--marine)" stroke-width="1.5"/>
      <g transform="translate(106,26) scale(0.68)" stroke="var(--marine)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">${ICONES[icone] || ICONES.doc}</g>
    </svg>
    <h3>${echapper(titre)}</h3>
    <p>${echapper(texte)}</p>
    ${action}
  </div>`;
}

function graphiquesTableauBord() {
  const s = statsPersonnelles();
  const h = habillage();

  const etiqA = ["Présent", "Congé", "Absent"];
  const valA = [s.presents, s.conges, s.absents];
  const coulA = [h.succes, h.marine, h.danger];
  const gA = donut($("#g-absences"), etiqA, valA, coulA, "jours pointés");
  legendeInteractive($("#l-absences"), gA, etiqA, valA, coulA);

  const etiqR = ["Ponctuel", "Retard", "Anomalie"];
  const valR = [s.ponctuels, s.enRetard, s.anomaliesMoi];
  const coulR = [h.succes, h.alerte, h.danger];
  const gR = donut($("#g-retards"), etiqR, valR, coulR, "journées");
  legendeInteractive($("#l-retards"), gR, etiqR, valR, coulR);

  const moisAffiches = MOIS_COURT.slice(0, AUJOURDHUI.getMonth() + 1);
  const faites = s.serieMois.slice(0, AUJOURDHUI.getMonth() + 1).map((m) => Math.round(m.faites));
  const prevues = s.serieMois.slice(0, AUJOURDHUI.getMonth() + 1).map((m) => Math.round(m.prevues));

  const gH = new Chart($("#g-heures"), {
    data: {
      labels: moisAffiches,
      datasets: [
        { type: "bar", label: "Heures travaillées", data: faites, backgroundColor: h.marine, borderRadius: 6, maxBarThickness: 34, order: 2 },
        { type: "line", label: "Heures prévues", data: prevues, borderColor: h.rouge, backgroundColor: h.rouge, borderWidth: 2.4,
          tension: .35, pointRadius: 3.5, pointHoverRadius: 6, pointBackgroundColor: h.surface, pointBorderWidth: 2, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6 } },
      scales: {
        x: { grid: { display: false }, border: { color: h.trait }, ticks: { color: h.encre3, font: { family: "IBM Plex Sans", size: 11.5 } } },
        y: { beginAtZero: true, grid: { color: h.trait, drawTicks: false }, border: { display: false },
          ticks: { color: h.encre3, padding: 8, font: { family: "IBM Plex Mono", size: 11 }, callback: (v) => `${v} h`, maxTicksLimit: 6 } },
      },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", color: h.encre, padding: 16, font: { family: "IBM Plex Sans", size: 12 } } },
        tooltip: { ...infobulle(h), callbacks: { label: (c) => ` ${c.dataset.label} : ${c.raw} h` } },
      },
      animation: { duration: 750 },
    },
  });
  etat.graphiques.push(gH);
}
