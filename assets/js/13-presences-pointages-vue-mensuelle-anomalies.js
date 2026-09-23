/* ==========================================================================
   13. PRÉSENCES — pointages, vue mensuelle, anomalies
   ========================================================================== */
const CODES_PRESENCE = {
  present: ["Présent", "var(--succes)", "var(--succes-doux)"],
  conge: ["Congé", "var(--marine)", "var(--marine-doux)"],
  mission: ["Mission", "var(--violet)", "var(--violet-doux)"],
  absent: ["Absent", "var(--danger)", "var(--danger-doux)"],
};

VUES["/presences"] = function () {
  const f = etat.filtres.presences || (etat.filtres.presences = { onglet: "pointages", employe: moi().matricule, mois: AUJOURDHUI.getMonth() });
  const scope = perimetre();

  const onglets = `
    <div class="segment" id="onglets-presences">
      <button data-onglet="pointages" class="${f.onglet === "pointages" ? "actif" : ""}">Pointages</button>
      <button data-onglet="mensuel" class="${f.onglet === "mensuel" ? "actif" : ""}">Vue mensuelle</button>
      <button data-onglet="anomalies" class="${f.onglet === "anomalies" ? "actif" : ""}">Anomalies${anomaliesOuvertes().length ? ` (${anomaliesOuvertes().length})` : ""}</button>
    </div>`;

  const choisi = parMatricule[f.employe];
  const selecteurEmploye = scope.length > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;min-width:min(340px,100%)">
      <span style="color:var(--encre-3)">${ico("loupe")}</span>
      <input class="saisie" id="filtre-employe" list="liste-employes-presences" autocomplete="off" style="flex:1"
        placeholder="Nom ou matricule du collaborateur…" title="Tapez un nom ou un matricule : la fiche s'affiche dès qu'un seul collaborateur correspond"
        value="${choisi ? echapper(`${nomComplet(choisi)} — ${choisi.matricule}`) : ""}">
      <datalist id="liste-employes-presences">
        ${scope.map((e) => `<option value="${echapper(`${nomComplet(e)} — ${e.matricule}`)}"></option>`).join("")}
      </datalist>
    </div>` : "";

  let corps = "";
  if (f.onglet === "pointages") corps = ongletPointages(f);
  else if (f.onglet === "mensuel") corps = ongletMensuel(f, scope);
  else corps = ongletAnomalies(f, scope);

  const pointageDuJour = POINTAGES.find((p) => p.matricule === moi().matricule && p.date === iso(AUJOURDHUI));
  const passagesDuJour = pointageDuJour ? passagesDe(pointageDuJour) : [];
  const prochainBadge = passagesDuJour.length % 2 === 0 ? "entrée" : "sortie";

  return `
  <section class="carte" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div class="kpi-ico" style="background:var(--marine-doux);color:var(--marine);width:44px;height:44px;border-radius:13px">${ico("horloge")}</div>
    <div style="flex:1;min-width:200px">
      <h3>Badgeage du jour — ${fmtDateLongue(AUJOURDHUI)}</h3>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:2px">
        ${passagesDuJour.length
          ? `${passagesDuJour.length} pointage(s) : ${passagesDuJour.map((h, i) => `<strong class="mono" style="color:var(--encre)">${h}</strong>${i % 2 ? " (sortie)" : " (entrée)"}`).join(" · ")}`
          : "Aucun badgeage enregistré aujourd'hui."}
      </p>
    </div>
    <button class="btn primaire" id="badger">${ico("check")} Badger — ${prochainBadge}</button>
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      ${onglets}
      <div class="barre-filtres" style="margin-left:auto">${selecteurEmploye}</div>
    </div>
    ${corps}
  </section>`;
};

function ongletPointages(f) {
  const lignes = POINTAGES.filter((p) => p.matricule === f.employe)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  if (!lignes.length) return etatVide("horloge", "Aucun pointage", "Les pointages remontent automatiquement de la pointeuse chaque nuit.");

  return `<div class="tableau-boite">
    <table>
      <thead><tr>
        <th>Jour</th><th class="centre">Entrée 1</th><th class="centre">Sortie 1</th><th class="centre">Entrée 2</th><th class="centre">Sortie 2</th>
        <th class="centre">Faites</th><th class="centre">Prévues</th><th class="centre">Retard</th><th>État</th>
      </tr></thead>
      <tbody>
        ${lignes.map((p) => {
          const [libelle, couleur, fond] = CODES_PRESENCE[p.code];
          const anomalies = ANOMALIES.filter((a) => a.matricule === p.matricule && a.date === p.date);
          const manquant = (v) => v ? `<span class="mono">${v}</span>` : `<span class="badge rejetee" style="padding:1px 6px">manquant</span>`;
          return `<tr>
            <td><strong>${fmtJourCourt(p.date)}</strong></td>
            <td class="centre">${p.code === "present" || p.code === "mission" ? manquant(p.e1) : "—"}</td>
            <td class="centre">${p.code === "present" || p.code === "mission" ? manquant(p.s1) : "—"}</td>
            <td class="centre">${p.code === "present" || p.code === "mission" ? manquant(p.e2) : "—"}</td>
            <td class="centre">${p.code === "present" || p.code === "mission" ? manquant(p.s2) : "—"}</td>
            <td class="centre num"><strong>${fmtNombre(p.heures)}</strong></td>
            <td class="centre num" style="color:var(--encre-3)">${fmtNombre(p.prevues)}</td>
            <td class="centre num" style="color:${p.retard > 10 ? "var(--danger)" : p.retard ? "var(--alerte)" : "var(--encre-3)"}">${p.retard ? `+${p.retard} min` : "—"}</td>
            <td>
              <span class="badge" style="background:${fond};color:${couleur}">${libelle}</span>
              ${anomalies.map((a) => `<span class="badge ${a.statut === "ouverte" ? "rejetee" : "annulee"}" title="${echapper(a.detail)}">${ico("alerte")}${a.type}</span>`).join(" ")}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function ongletMensuel(f, scope) {
  const mois = f.mois;
  const debutMois = new Date(ANNEE, mois, 1);
  const jours = new Date(ANNEE, mois + 1, 0).getDate();

  const lignes = scope.map((e) => {
    const p = POINTAGES.filter((x) => x.matricule === e.matricule && depuisIso(x.date).getMonth() === mois);
    const faites = p.reduce((s, x) => s + x.heures, 0);
    const prevues = p.reduce((s, x) => s + x.prevues, 0);
    return {
      employe: e, faites, prevues,
      travailles: p.filter((x) => x.code === "present").length,
      conges: p.filter((x) => x.code === "conge").length,
      absences: p.filter((x) => x.code === "absent").length,
      retards: p.filter((x) => x.retard > 0).length,
      minutes: p.reduce((s, x) => s + x.retard, 0),
      serie: Array.from({ length: jours }, (_, i) => {
        const jour = p.find((x) => depuisIso(x.date).getDate() === i + 1);
        return jour ? jour.heures : 0;
      }),
    };
  }).filter((l) => l.faites || l.conges || l.absences);

  const navMois = `<div class="barre-filtres" style="margin-bottom:14px">
    <button class="btn petit icone" id="mois-precedent" aria-label="Mois précédent">${ico("chevronG")}</button>
    <strong style="font-family:var(--police-titre);font-size:15px;min-width:140px;text-align:center">${MOIS[mois]} ${ANNEE}</strong>
    <button class="btn petit icone" id="mois-suivant" aria-label="Mois suivant" ${mois >= AUJOURDHUI.getMonth() ? "disabled" : ""}>${ico("chevronD")}</button>
    <button class="btn petit" id="export-mensuel" style="margin-left:auto">${ico("telecharger")} Export Excel</button>
  </div>`;

  if (!lignes.length) return navMois + etatVide("calendrier", "Aucune donnée pour ce mois", "Choisissez un autre mois ou importez les pointages depuis l'administration.");

  const maxHeures = Math.max(...lignes.flatMap((l) => l.serie), 1);

  return navMois + `<div class="tableau-boite">
    <table style="min-width:840px">
      <thead><tr>
        <th>Collaborateur</th><th>Activité du mois</th><th class="centre">Travaillés</th><th class="centre">Congés</th>
        <th class="centre">Absences</th><th class="centre">Retards</th><th class="centre">Heures</th><th class="centre">Écart</th>
      </tr></thead>
      <tbody>
        ${lignes.map((l) => {
          const ecart = l.faites - l.prevues;
          const barres = l.serie.map((v, i) => {
            const h = Math.max(2, (v / maxHeures) * 22);
            const couleur = v === 0 ? "var(--trait)" : v >= 8 ? "var(--succes)" : "var(--alerte)";
            return `<rect x="${i * 5.2}" y="${24 - h}" width="3.6" height="${h}" rx="1.4" fill="${couleur}"><title>${i + 1} ${MOIS[mois]} : ${fmtNombre(v)} h</title></rect>`;
          }).join("");
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:9px">
                <div class="avatar s" style="background:${couleurDept(l.employe.dept)}">${initiales(l.employe)}</div>
                <div><strong style="font-size:13px">${echapper(nomComplet(l.employe))}</strong>
                <div style="font-size:11.5px;color:var(--encre-3)" class="mono">${l.employe.matricule}</div></div>
              </div>
            </td>
            <td><svg width="${jours * 5.2}" height="26" viewBox="0 0 ${jours * 5.2} 26" role="img" aria-label="Heures par jour">${barres}</svg></td>
            <td class="centre num">${l.travailles}</td>
            <td class="centre num">${l.conges || "—"}</td>
            <td class="centre num" style="color:${l.absences ? "var(--danger)" : "inherit"}">${l.absences || "—"}</td>
            <td class="centre num">${l.retards ? `${l.retards} · ${l.minutes} min` : "—"}</td>
            <td class="centre num"><strong>${fmtNombre(l.faites)} h</strong></td>
            <td class="centre num" style="color:${ecart >= 0 ? "var(--succes)" : "var(--danger)"}">${ecart >= 0 ? "+" : ""}${fmtNombre(ecart)} h</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function ongletAnomalies(f, scope) {
  const matricules = scope.map((e) => e.matricule);
  const liste = ANOMALIES.filter((a) => matricules.includes(a.matricule))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  if (!liste.length) return etatVide("check", "Aucune anomalie", "Tous les badgeages de votre périmètre sont complets et à l'heure.");

  return `<div class="inbox">
    ${liste.map((a) => {
      const e = parMatricule[a.matricule];
      const ouverte = a.statut === "ouverte";
      return `<article class="inbox-item ${ouverte ? "" : "conge"}">
        <div class="kpi-ico" style="background:${ouverte ? "var(--danger-doux)" : "var(--succes-doux)"};color:${ouverte ? "var(--danger)" : "var(--succes)"}">${ico(ouverte ? "alerte" : "check")}</div>
        <div class="inbox-corps">
          <div class="titre">${echapper(a.type)}
            <span class="badge ${ouverte ? "rejetee" : "approuvee"}">${ouverte ? "À régulariser" : "Justifiée"}</span>
          </div>
          <div class="detail">${echapper(nomComplet(e))} · ${fmtDateLongue(a.date)}</div>
          <div class="meta"><span>${echapper(a.detail)}</span>${a.justification ? `<span>« ${echapper(a.justification)} »</span>` : ""}</div>
        </div>
        <div class="inbox-actions">
          ${ouverte && a.matricule === moi().matricule ? `<button class="btn petit" data-justifier="${a.id}">${ico("crayon")} Justifier</button>`
            : ouverte ? `<span class="badge neutre" title="Seul le collaborateur concerné peut justifier cette anomalie">${ico("oeil")} Indicateur</span>` : ""}
        </div>
      </article>`;
    }).join("")}
  </div>`;
}

function ouvrirJustification(id) {
  const a = ANOMALIES.find((x) => x.id === id);
  if (!a) return;
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>Justifier l'anomalie</h2><div class="sous">${echapper(a.type)} · ${fmtDateLongue(a.date)} · ${echapper(nomComplet(parMatricule[a.matricule]))}</div></div>
      </div>
      <div class="modale-corps">
        <div class="champ">
          <label for="justif">Explication</label>
          <textarea class="saisie" id="justif" placeholder="Ex. : oubli de badgeage au retour de la pause déjeuner."></textarea>
        </div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="annuler-justif">Annuler</button>
        <button class="btn primaire" id="valider-justif">${ico("check")} Envoyer la justification</button>
      </div>
    </div>`);
  $("#annuler-justif").addEventListener("click", fermerCouche);
  $("#valider-justif").addEventListener("click", () => {
    const texte = $("#justif").value.trim();
    if (texte.length < 5) return toast("Explication trop courte", "Décrivez brièvement la situation.", "danger");
    a.statut = "justifiee"; a.justification = texte;
    fermerCouche();
    toast("Anomalie justifiée", "Votre responsable a été notifié pour régularisation.", "succes");
    rendre(false);
  });
}

function badger() {
  let p = POINTAGES.find((x) => x.matricule === moi().matricule && x.date === iso(AUJOURDHUI));
  if (!p) {
    p = { matricule: moi().matricule, date: iso(AUJOURDHUI), code: "present", prevues: 8, e1: null, s1: null, e2: null, s2: null, heures: 0, retard: 0 };
    POINTAGES.push(p);
  }
  const maintenant = new Date();
  const heure = `${String(maintenant.getHours()).padStart(2, "0")}:${String(maintenant.getMinutes()).padStart(2, "0")}`;
  const champ = ["e1", "s1", "e2", "s2"].find((c) => !p[c]);
  if (!champ) return toast("Journée complète", "Les 4 badgeages du jour sont déjà enregistrés.", "info");
  p[champ] = heure;

  const mins = (h) => h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null;
  let total = 0;
  if (p.e1 && p.s1) total += mins(p.s1) - mins(p.e1);
  if (p.e2 && p.s2) total += mins(p.s2) - mins(p.e2);
  p.heures = Math.round((total / 60) * 100) / 100;
  if (champ === "e1") p.retard = Math.max(0, mins(heure) - (8 * 60 + 30));

  toast("Badgeage enregistré", `${{ e1: "Entrée du matin", s1: "Sortie du midi", e2: "Retour de pause", s2: "Sortie du soir" }[champ]} à ${heure}.`, "succes");
  rendre(false);
}

/* ==========================================================================
   14. PLANNINGS — semaine interactive, glisser-déposer pour la RH
   ========================================================================== */
VUES["/plannings"] = function () {
  const f = etat.filtres.planning || (etat.filtres.planning = { decalage: 0, dept: "" });
  const lundi = ajouterJours(lundiDe(AUJOURDHUI), f.decalage * 7);
  const semaine = semaineIso(lundi);
  let employes = perimetre();
  if (f.dept) employes = employes.filter((e) => e.dept === f.dept);

  const creneaux = PLANNINGS.filter((p) => p.semaine === semaine && employes.some((e) => e.matricule === p.matricule));
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const modifiable = estValideur();

  const enTete = `
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn petit icone" id="semaine-precedente" aria-label="Semaine précédente">${ico("chevronG")}</button>
        <div style="text-align:center;min-width:186px">
          <strong style="font-family:var(--police-titre);font-size:15px;display:block">${fmtDate(lundi)} → ${fmtDate(ajouterJours(lundi, 6))}</strong>
          <span style="font-size:11.5px;color:var(--encre-3)" class="mono">${semaine}${f.decalage === 0 ? " · semaine en cours" : ""}</span>
        </div>
        <button class="btn petit icone" id="semaine-suivante" aria-label="Semaine suivante">${ico("chevronD")}</button>
        ${f.decalage !== 0 ? `<button class="btn petit fantome" id="semaine-aujourdhui">Aujourd'hui</button>` : ""}
      </div>
      <div class="barre-filtres" style="margin-left:auto">
        ${estAdmin() ? `<select class="saisie" id="filtre-dept-planning">
          <option value="">Tous les départements</option>
          ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
        </select>` : ""}
        ${modifiable ? `<button class="btn petit" id="dupliquer-semaine">${ico("copie")} Dupliquer la semaine</button>` : ""}
      </div>
    </div>
    <div class="legende" style="margin:-4px 0 14px">
      ${Object.entries(POSTES).map(([code, p]) => `<span class="badge neutre"><span class="point" style="background:${p.couleur}"></span>${p.libelle}</span>`).join("")}
    </div>`;

  if (!creneaux.length) {
    return `<section class="carte">
      ${enTete}
      ${etatVide("calendrier", "Aucun planning publié pour cette semaine",
        modifiable ? "Dupliquez la semaine précédente ou déposez des créneaux directement dans la grille."
          : "Votre responsable n'a pas encore publié le planning de cette semaine. Vous serez notifié dès sa publication.",
        modifiable ? `<button class="btn primaire" id="dupliquer-vide" style="margin-top:10px">${ico("copie")} Reprendre la semaine précédente</button>` : "")}
    </section>`;
  }

  const grille = `
    <div style="overflow-x:auto;border:1px solid var(--trait);border-radius:var(--r-m)">
      <div class="planning-grille">
        <div class="planning-tete" style="text-align:left">
          <div class="jour">Collaborateur</div>
          <div style="font-size:11.5px;color:var(--encre-3);margin-top:3px">${employes.length} personne(s)</div>
        </div>
        ${jours.map((j) => {
          const ferie = estFerie(j);
          const estAujourdhui = iso(j) === iso(AUJOURDHUI);
          return `<div class="planning-tete ${estAujourdhui ? "aujourdhui" : ""} ${ferie ? "ferie" : ""}">
            <div class="jour">${JOURS[j.getDay()].slice(0, 3)}${ferie ? " · férié" : ""}</div>
            <div class="date">${String(j.getDate()).padStart(2, "0")}</div>
          </div>`;
        }).join("")}

        ${employes.map((e) => `
          <div class="planning-employe">
            <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
            <div class="txt"><strong>${echapper(nomComplet(e))}</strong><span>${echapper(e.poste)}</span></div>
          </div>
          ${jours.map((j) => {
            const creneau = creneaux.find((c) => c.matricule === e.matricule && c.date === iso(j));
            const weekend = j.getDay() === 0 || j.getDay() === 6;
            const poste = creneau ? POSTES[creneau.poste] : null;
            return `<div class="planning-cellule ${weekend ? "weekend" : ""}" data-cellule="${e.matricule}|${iso(j)}">
              ${creneau ? `<div class="creneau" draggable="${modifiable}" data-creneau="${creneau.id}"
                style="background:color-mix(in srgb,${poste.couleur} 14%,transparent);border-left-color:${poste.couleur};color:${poste.couleur}">
                ${poste.libelle}<span class="heures">${creneau.debut} – ${creneau.fin}</span>
              </div>` : ""}
            </div>`;
          }).join("")}`).join("")}
      </div>
    </div>`;

  return `<section class="carte">
    ${enTete}
    ${grille}
    ${modifiable ? `<p style="font-size:12px;color:var(--encre-3);margin-top:12px">${ico("crayon")} Glissez un créneau vers une autre cellule pour le déplacer · cliquez sur une cellule vide pour affecter un poste.</p>` : ""}
  </section>`;
};

let creneauEnCours = null;
function brancherPlanning() {
  const modifiable = estValideur();
  $$("[data-creneau]").forEach((el) => {
    el.addEventListener("click", (ev) => { if (modifiable) { ev.stopPropagation(); ouvrirEditionCreneau(el.dataset.creneau); } });
    if (!modifiable) return;
    el.addEventListener("dragstart", () => { creneauEnCours = el.dataset.creneau; el.classList.add("glisse"); });
    el.addEventListener("dragend", () => { creneauEnCours = null; el.classList.remove("glisse"); });
  });
  if (!modifiable) return;
  $$("[data-cellule]").forEach((cellule) => {
    cellule.addEventListener("dragover", (e) => { e.preventDefault(); cellule.classList.add("survol"); });
    cellule.addEventListener("dragleave", () => cellule.classList.remove("survol"));
    cellule.addEventListener("drop", (e) => {
      e.preventDefault();
      cellule.classList.remove("survol");
      if (!creneauEnCours) return;
      const [matricule, date] = cellule.dataset.cellule.split("|");
      deplacerCreneau(creneauEnCours, matricule, date);
    });
    cellule.addEventListener("click", () => {
      if (cellule.querySelector(".creneau")) return;
      const [matricule, date] = cellule.dataset.cellule.split("|");
      ouvrirEditionCreneau(null, matricule, date);
    });
  });
}

function deplacerCreneau(id, matricule, date) {
  const creneau = PLANNINGS.find((p) => p.id === id);
  if (!creneau) return;
  if (PLANNINGS.some((p) => p.matricule === matricule && p.date === date)) {
    return toast("Cellule occupée", "Ce collaborateur a déjà un créneau ce jour-là.", "danger");
  }
  creneau.matricule = matricule;
  creneau.date = date;
  creneau.semaine = semaineIso(depuisIso(date));
  creneau.id = `${matricule}-${date}`;
  toast("Créneau déplacé", `${nomComplet(parMatricule[matricule])} · ${fmtDateLongue(date)} — ${POSTES[creneau.poste].libelle}.`, "succes");
  rendre(false);
}

function ouvrirEditionCreneau(id, matricule, date) {
  const creneau = id ? PLANNINGS.find((p) => p.id === id) : null;
  const cible = creneau || { matricule, date, poste: "siege", debut: "08:30", fin: "17:00" };
  const employe = parMatricule[cible.matricule];

  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>${creneau ? "Modifier le créneau" : "Affecter un poste"}</h2>
        <div class="sous">${echapper(nomComplet(employe))} · ${fmtDateLongue(cible.date)}</div></div>
      </div>
      <div class="modale-corps">
        <div class="champ">
          <label for="c-poste">Poste</label>
          <select class="saisie" id="c-poste">
            ${Object.entries(POSTES).map(([code, p]) => `<option value="${code}" ${cible.poste === code ? "selected" : ""}>${p.libelle}</option>`).join("")}
          </select>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="c-debut">Début</label><input class="saisie" type="time" id="c-debut" value="${cible.debut}"></div>
          <div class="champ"><label for="c-fin">Fin</label><input class="saisie" type="time" id="c-fin" value="${cible.fin}"></div>
        </div>
      </div>
      <div class="modale-pied">
        ${creneau ? `<button class="btn danger" id="supprimer-creneau">${ico("poubelle")} Supprimer</button>` : ""}
        <button class="btn" id="annuler-creneau">Annuler</button>
        <button class="btn primaire" id="enregistrer-creneau">${ico("check")} Enregistrer</button>
      </div>
    </div>`);

  $("#annuler-creneau").addEventListener("click", fermerCouche);
  $("#enregistrer-creneau").addEventListener("click", () => {
    const poste = $("#c-poste").value, debut = $("#c-debut").value, fin = $("#c-fin").value;
    if (fin <= debut) return toast("Horaire invalide", "L'heure de fin doit suivre l'heure de début.", "danger");
    if (creneau) { Object.assign(creneau, { poste, debut, fin }); }
    else {
      PLANNINGS.push({ id: `${cible.matricule}-${cible.date}`, matricule: cible.matricule, date: cible.date,
        semaine: semaineIso(depuisIso(cible.date)), poste, debut, fin });
      NOTIFICATIONS.unshift({ id: idNotif++, matricule: cible.matricule, titre: "Planning mis à jour",
        message: `${POSTES[poste].libelle} le ${fmtDate(cible.date)} (${debut}–${fin}).`, type: "info", lien: "/plannings", lu: false, date: new Date() });
    }
    fermerCouche();
    toast("Planning enregistré", `${nomComplet(employe)} · ${POSTES[poste].libelle} le ${fmtDate(cible.date)}.`, "succes");
    rendre(false);
  });
  const btnSuppr = $("#supprimer-creneau");
  if (btnSuppr) btnSuppr.addEventListener("click", () => {
    const index = PLANNINGS.findIndex((p) => p.id === creneau.id);
    PLANNINGS.splice(index, 1);
    fermerCouche();
    toast("Créneau supprimé", `${fmtDateLongue(creneau.date)} — la cellule est de nouveau libre.`, "info");
    rendre(false);
  });
}

function dupliquerSemaine() {
  const f = etat.filtres.planning;
  const lundiCible = ajouterJours(lundiDe(AUJOURDHUI), f.decalage * 7);
  const lundiSource = ajouterJours(lundiCible, -7);
  const semaineSource = semaineIso(lundiSource), semaineCible = semaineIso(lundiCible);
  const source = PLANNINGS.filter((p) => p.semaine === semaineSource);
  if (!source.length) return toast("Semaine source vide", "La semaine précédente ne contient aucun créneau à copier.", "danger");

  let crees = 0;
  source.forEach((c) => {
    const nouvelleDate = iso(ajouterJours(depuisIso(c.date), 7));
    if (PLANNINGS.some((p) => p.matricule === c.matricule && p.date === nouvelleDate)) return;
    PLANNINGS.push({ id: `${c.matricule}-${nouvelleDate}`, matricule: c.matricule, date: nouvelleDate,
      semaine: semaineCible, poste: c.poste, debut: c.debut, fin: c.fin });
    crees++;
  });
  toast("Semaine dupliquée", `${crees} créneau(x) copiés depuis ${semaineSource}.`, "succes");
  rendre(false);
}
