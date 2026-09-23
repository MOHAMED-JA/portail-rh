/* ==========================================================================
   10. DÉPÔT DE DEMANDES — tiroirs avec validation en direct
   ========================================================================== */
function ouvrirChoixDemande() {
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true" aria-labelledby="t-choix">
      <div class="modale-tete">
        <div><h2 id="t-choix">Nouvelle demande</h2><div class="sous">Choisissez le type de demande à déposer.</div></div>
        <button class="btn icone fantome" id="fermer-choix" style="margin-left:auto" aria-label="Fermer">${ico("croix")}</button>
      </div>
      <div class="modale-corps">
        <div class="actions-rapides" style="flex-direction:column">
          <button class="action-rapide" data-demande="conge">
            <span class="ico" style="background:var(--marine-doux);color:var(--marine)">${ico("calendrier")}</span>
            <span><strong>Congé</strong><span>Annuel, maladie, événement familial…</span></span>
          </button>
          <button class="action-rapide" data-demande="autorisation">
            <span class="ico" style="background:var(--info-doux);color:var(--info)">${ico("horloge")}</span>
            <span><strong>Autorisation d'absence</strong><span>Sortie de quelques heures</span></span>
          </button>
          <button class="action-rapide" data-demande="mission">
            <span class="ico" style="background:var(--violet-doux);color:var(--violet)">${ico("avion")}</span>
            <span><strong>Ordre de mission</strong><span>Formation, visite de risque, télétravail…</span></span>
          </button>
        </div>
      </div>
    </div>`);
  $$("[data-demande]", $("#couche")).forEach((b) => b.addEventListener("click", () => ouvrirDemande(b.dataset.demande)));
  // Le voile porte lui aussi data-fermer : viser le bouton par son identifiant,
  // sinon le gestionnaire se pose sur le voile et tout clic ferme la fenêtre.
  $("#fermer-choix").addEventListener("click", fermerCouche);
}

function enteteTiroir(titre, sous) {
  return `<div class="tiroir-tete">
    <div><h2>${titre}</h2><div class="sous">${sous}</div></div>
    <button class="btn icone fantome" id="fermer-tiroir" style="margin-left:auto" aria-label="Fermer">${ico("croix")}</button>
  </div>`;
}

function ouvrirDemande(type) {
  const u = moi();
  const validateur = u.validateur ? parMatricule[u.validateur] : null;
  const solde = soldeDe(u.matricule);
  const demain = iso(ajouterJours(AUJOURDHUI, 1));
  const blocValidateur = `
    <div style="display:flex;align-items:center;gap:11px;padding:12px 13px;border-radius:var(--r-m);background:var(--surface-2);border:1px solid var(--trait)">
      ${validateur ? `<div class="avatar s" style="background:${couleurDept(validateur.dept)}">${initiales(validateur)}</div>` : `<div class="kpi-ico" style="background:var(--succes-doux);color:var(--succes)">${ico("bouclier")}</div>`}
      <div>
        <div style="font-size:11.5px;color:var(--encre-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600">Circuit de validation</div>
        <strong style="font-size:13.5px">${validateur ? `${nomComplet(validateur)} — ${validateur.poste}` : "Validation directe (vous êtes en bout de chaîne)"}</strong>
      </div>
    </div>`;

  let corps = "";
  if (type === "conge") {
    corps = `
      <div class="champ">
        <label for="d-type">Type de congé</label>
        <select class="saisie" id="d-type">${TYPES_CONGE.map((t) => `<option value="${t.code}">${t.libelle}${t.max ? ` — ${t.max} j max` : ""}</option>`).join("")}</select>
      </div>
      <div class="ligne-champs">
        <div class="champ"><label for="d-debut">Date de début</label><input class="saisie" type="date" id="d-debut" value="${demain}"></div>
        <div class="champ"><label for="d-fin">Date de fin</label><input class="saisie" type="date" id="d-fin" value="${demain}"></div>
      </div>
      <div class="champ">
        <label>Demi-journée</label>
        <div class="segment" id="d-demi">
          <button type="button" data-demi="" class="actif">Journées entières</button>
          <button type="button" data-demi="matin">Matin</button>
          <button type="button" data-demi="apres_midi">Après-midi</button>
        </div>
      </div>
      <div id="d-simulation"></div>
      <div class="champ">
        <label for="d-justificatif">Justificatif <span style="font-weight:400;color:var(--encre-3)">(PDF, DOC ou DOCX)</span></label>
        <input class="saisie" type="file" id="d-justificatif" accept=".pdf,.doc,.docx">
        <div class="aide" id="d-apercu"></div>
      </div>`;
  } else if (type === "autorisation") {
    corps = `
      <div class="champ">
        <label for="d-type">Motif de l'autorisation</label>
        <select class="saisie" id="d-type">${TYPES_AUTORISATION.map((t) => `<option value="${t.code}">${t.libelle}</option>`).join("")}</select>
      </div>
      <div class="champ"><label for="d-debut">Date</label><input class="saisie" type="date" id="d-debut" value="${demain}"></div>
      <div class="ligne-champs">
        <div class="champ"><label for="d-h-debut">Heure de début</label><input class="saisie" type="time" id="d-h-debut" value="14:00"></div>
        <div class="champ"><label for="d-h-fin">Heure de fin</label><input class="saisie" type="time" id="d-h-fin" value="16:00"></div>
      </div>
      <div id="d-simulation"></div>`;
  } else {
    corps = `
      <div class="champ">
        <label for="d-type">Type de mission</label>
        <select class="saisie" id="d-type">${TYPES_MISSION.map((t) => `<option value="${t.code}">${t.libelle}</option>`).join("")}</select>
      </div>
      <div class="ligne-champs">
        <div class="champ"><label for="d-debut">Date de début</label><input class="saisie" type="date" id="d-debut" value="${demain}"></div>
        <div class="champ"><label for="d-fin">Date de fin</label><input class="saisie" type="date" id="d-fin" value="${demain}"></div>
      </div>
      <div id="d-simulation"></div>`;
  }

  const titres = { conge: ["Demande de congé", `Solde disponible : ${fmtNombre(solde.restant)} jour(s)`],
    autorisation: ["Autorisation d'absence", "Absence de quelques heures dans la journée"],
    mission: ["Ordre de mission", "Déplacement professionnel ou télétravail"] };

  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true">
      ${enteteTiroir(titres[type][0], titres[type][1])}
      <form class="tiroir-corps" id="form-demande" novalidate>
        ${corps}
        <div class="champ">
          <label for="d-commentaire">Commentaire</label>
          <textarea class="saisie" id="d-commentaire" placeholder="Précisez le contexte pour faciliter la validation…"></textarea>
        </div>
        ${blocValidateur}
      </form>
      <div class="tiroir-pied">
        <button class="btn" id="annuler-demande">Annuler</button>
        <button class="btn primaire" id="soumettre-demande">${ico("check")} Soumettre la demande</button>
      </div>
    </aside>`, { tiroir: true });

  const rafraichir = () => simulerDemande(type);
  ["d-type", "d-debut", "d-fin", "d-h-debut", "d-h-fin"].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.addEventListener("change", rafraichir);
  });
  $$("#d-demi button").forEach((b) => b.addEventListener("click", () => {
    $$("#d-demi button").forEach((x) => x.classList.remove("actif"));
    b.classList.add("actif");
    rafraichir();
  }));
  const fichier = $("#d-justificatif");
  if (fichier) fichier.addEventListener("change", () => {
    const f = fichier.files[0];
    $("#d-apercu").innerHTML = f ? `${ico("doc")} ${echapper(f.name)} — ${(f.size / 1024).toFixed(0)} Ko` : "";
  });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#annuler-demande").addEventListener("click", fermerCouche);
  $("#soumettre-demande").addEventListener("click", () => soumettreDemande(type));
  rafraichir();
}

function lireFormulaire(type) {
  const sousType = $("#d-type").value;
  const debut = depuisIso($("#d-debut").value);
  const fin = type === "autorisation" ? debut : depuisIso(($("#d-fin") || $("#d-debut")).value);
  const demi = type === "conge" ? ($("#d-demi .actif").dataset.demi || null) : null;
  return { sousType, debut, fin, demi,
    heureDebut: $("#d-h-debut") ? $("#d-h-debut").value : null,
    heureFin: $("#d-h-fin") ? $("#d-h-fin").value : null,
    commentaire: $("#d-commentaire").value.trim() };
}

function simulerDemande(type) {
  const boite = $("#d-simulation");
  const f = lireFormulaire(type);
  const solde = soldeDe(moi().matricule);

  if (type === "autorisation") {
    const [h1, m1] = f.heureDebut.split(":").map(Number);
    const [h2, m2] = f.heureFin.split(":").map(Number);
    const minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    const maximum = Number(REGLES.maxAutorisationHeures || 1.5) * 60;
    const quota = Number(REGLES.quotaAutorisationMois || 4) * 60;
    const dejaPris = Math.round(heuresAutorisationMois(moi().matricule, f.debut) * 60);
    const tropLongue = minutes > maximum;
    const derogation = !tropLongue && minutes > 0 && dejaPris + minutes > quota;
    const invalide = minutes <= 0 || tropLongue;
    boite.innerHTML = `<div class="carte" style="padding:14px;background:${invalide ? "var(--danger-doux)" : "var(--surface-2)"};border-color:${invalide ? "var(--danger)" : "var(--trait)"}">
      <div style="font-size:12px;color:var(--encre-2);margin-bottom:8px">Déjà utilisé en ${MOIS[f.debut.getMonth()]} : <strong>${dureeHm(dejaPris)}</strong> sur ${dureeHm(quota)} · maximum ${dureeHm(maximum)} par autorisation</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-size:11.5px;color:var(--encre-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Durée demandée</div>
        <strong style="font-family:var(--police-titre);font-size:21px">${invalide ? "—" : `${fmtNombre(minutes / 60)} h`}</strong></div>
        ${estOuvre(f.debut) ? `<span class="badge info">${ico("check")} Jour ouvré</span>` : `<span class="badge attente">${ico("alerte")} Jour non travaillé</span>`}
      </div>
      ${minutes <= 0 ? `<p class="msg-erreur" style="margin-top:8px">L'heure de fin doit suivre l'heure de début.</p>` : ""}
      ${tropLongue ? `<p class="msg-erreur" style="margin-top:8px">Une autorisation ne peut pas dépasser ${dureeHm(maximum)}.</p>` : ""}
      ${derogation ? `<p style="margin-top:8px;font-size:12.5px;color:var(--alerte);font-weight:600">${ico("alerte")} Quota mensuel de ${dureeHm(quota)} dépassé : cette demande sera une dérogation, accordée uniquement par la direction RH.</p>` : ""}
    </div>`;
    return;
  }

  const jours = type === "conge" ? joursConge(f.debut, f.fin, f.demi) : joursOuvres(f.debut, f.fin) - (f.demi ? 0.5 : 0);
  const regle = CATALOGUE[type].find((t) => t.code === f.sousType) || {};
  const decompte = type === "conge" && f.sousType === "annuel";
  const apres = decompte ? solde.restant - jours : solde.restant;
  const depassement = decompte && apres < 0;
  const tropLong = regle.max && jours > regle.max;
  const invalide = f.fin < f.debut || jours <= 0;
  const feries = [];
  for (let c = new Date(f.debut); c <= f.fin; c = ajouterJours(c, 1)) {
    const nom = estFerie(c);
    if (nom && c.getDay() !== 0 && c.getDay() !== 6) feries.push(`${fmtDate(c)} — ${nom}`);
  }
  const pourcentage = Math.max(0, Math.min(100, (apres / (solde.total || 1)) * 100));

  boite.innerHTML = `
    <div class="carte" style="padding:15px;background:var(--surface-2)">
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between">
        <div>
          <div style="font-size:11.5px;color:var(--encre-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Jours décomptés</div>
          <strong style="font-family:var(--police-titre);font-size:26px;line-height:1.2">${invalide ? "—" : fmtNombre(jours)} <span style="font-size:13px;font-weight:600;color:var(--encre-3)">jour(s)</span></strong>
        </div>
        ${decompte ? `<div style="text-align:right">
          <div style="font-size:11.5px;color:var(--encre-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Solde après validation</div>
          <strong style="font-family:var(--police-titre);font-size:22px;color:${depassement ? "var(--danger)" : "var(--succes)"}">${fmtNombre(apres)} j</strong>
        </div>` : `<span class="badge neutre">Ne décompte pas le solde annuel</span>`}
      </div>
      ${decompte ? `<div class="jauge ${depassement ? "alerte" : ""}" style="margin-top:12px"><span style="width:${pourcentage}%"></span></div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--encre-3);margin-top:6px">
        <span>Solde actuel : ${fmtNombre(solde.restant)} j</span><span>Acquis ${ANNEE} : ${fmtNombre(solde.total)} j</span>
      </div>` : ""}
      ${feries.length ? `<p style="font-size:12px;color:var(--rouge);margin-top:10px;font-weight:500">${ico("alerte")} Jour(s) férié(s) non décompté(s) : ${feries.join(" · ")}</p>` : ""}
      ${invalide ? `<p class="msg-erreur" style="margin-top:10px">Période invalide : aucun jour ouvré sélectionné.</p>` : ""}
      ${depassement ? `<p class="bandeau-info" style="margin-top:10px;color:var(--alerte)">${ico("alerte")} Dépassement de ${fmtNombre(Math.abs(apres))} jour(s) : vous pouvez déposer la demande. Elle sera transmise directement à la RH pour validation.</p>` : ""}
      ${tropLong ? `<p class="msg-erreur" style="margin-top:10px">« ${regle.libelle} » est limité à ${regle.max} jour(s) par le droit du travail.</p>` : ""}
    </div>`;
}

function soumettreDemande(type) {
  const f = lireFormulaire(type);
  const u = moi();
  const solde = soldeDe(u.matricule);
  let soldeInsuffisant = false;

  if (type === "autorisation") {
    const [h1, m1] = f.heureDebut.split(":").map(Number);
    const [h2, m2] = f.heureFin.split(":").map(Number);
    if (h2 * 60 + m2 <= h1 * 60 + m1) return toast("Horaire invalide", "L'heure de fin doit suivre l'heure de début.", "danger");
    if (h2 * 60 + m2 - (h1 * 60 + m1) > Number(REGLES.maxAutorisationHeures || 1.5) * 60) {
      return toast("Durée non autorisée", `Une autorisation ne peut pas dépasser ${dureeHm(Number(REGLES.maxAutorisationHeures || 1.5) * 60)}.`, "danger");
    }
  } else {
    const jours = type === "conge" ? joursConge(f.debut, f.fin, f.demi) : joursOuvres(f.debut, f.fin) - (f.demi ? 0.5 : 0);
    const regle = CATALOGUE[type].find((t) => t.code === f.sousType) || {};
    if (f.fin < f.debut || jours <= 0) return toast("Période invalide", "Aucun jour décompté dans la période choisie (week-end ou jours fériés).", "danger");
    if (regle.max && jours > regle.max) return toast("Durée non conforme", `« ${regle.libelle} » est limité à ${regle.max} jour(s).`, "danger");
    if (type === "conge" && f.sousType === "annuel" && jours > solde.restant) {
      soldeInsuffisant = true;
    }
  }

  const demande = creerDemande(u, type, f.sousType, f.debut, f.fin, "en_attente", {
    cree: new Date(),
    commentaire: f.commentaire,
    heureDebut: f.heureDebut, heureFin: f.heureFin, demi: f.demi,
    soldeInsuffisant,
    justificatif: $("#d-justificatif") && $("#d-justificatif").files[0] ? $("#d-justificatif").files[0].name : null,
  });
  DEMANDES.sort((a, b) => b.cree - a.cree);
  // Les filtres actifs pourraient masquer la demande tout juste déposée.
  etat.filtres.demandes = { type: "", statut: "", recherche: "" };
  etat.demandeMiseEnAvant = demande.ref;

  if (u.validateur) {
    NOTIFICATIONS.unshift({
      id: idNotif++, matricule: u.validateur, titre: "Nouvelle demande à valider",
      message: `${nomComplet(u)} — ${libelleType(type, f.sousType)} (${demande.ref})`,
      type: "validation", lien: "/validation", lu: false, date: new Date(),
    });
  }
  fermerCouche();
  toast("Demande envoyée", soldeInsuffisant ? `${demande.ref} · solde insuffisant : transmise directement à la direction RH.` : `${demande.ref} · transmise à ${u.validateur ? nomComplet(parMatricule[u.validateur]) : "la direction RH"}.`, "succes");
  naviguer("/mes-demandes");
  rendre(false);
}

/* ==========================================================================
   11. MES DEMANDES
   ========================================================================== */
VUES["/mes-demandes"] = function () {
  const f = etat.filtres.demandes || (etat.filtres.demandes = { type: "", statut: "", recherche: "" });
  let liste = mesDemandes();
  if (f.type) liste = liste.filter((d) => d.type === f.type);
  if (f.statut) liste = liste.filter((d) => d.statut === f.statut);
  if (f.recherche) {
    const q = f.recherche.toLowerCase();
    liste = liste.filter((d) => d.ref.toLowerCase().includes(q) || libelleType(d.type, d.sousType).toLowerCase().includes(q) || (d.commentaire || "").toLowerCase().includes(q));
  }
  const solde = soldeDe(moi().matricule);
  const enAttente = mesDemandes().filter((d) => d.statut === "en_attente").length;

  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "s1", libelle: "Solde restant", valeur: fmtNombre(solde.restant), unite: "j", icone: "calendrier", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${fmtNombre(solde.pris)} j consommés en ${ANNEE}` })}
    ${carteKpi({ cle: "s2", libelle: "En attente de décision", valeur: enAttente, unite: "", icone: "horloge", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "Délai de réponse cible : 48 h" })}
    ${carteKpi({ cle: "s3", libelle: `Demandes ${ANNEE}`, valeur: mesDemandes().length, unite: "", icone: "demandes", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "Congés, autorisations et missions" })}
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap">
      <h2>Historique de mes demandes</h2>
      <button class="btn primaire petit" data-action="nouvelle-demande">${ico("plus")} Nouvelle demande</button>
    </div>

    <div class="barre-filtres" style="margin-bottom:14px">
      <div class="segment" id="filtre-type">
        ${[["", "Toutes"], ["conge", "Congés"], ["autorisation", "Autorisations"], ["mission", "Missions"]]
          .map(([v, l]) => `<button data-valeur="${v}" class="${f.type === v ? "actif" : ""}">${l}</button>`).join("")}
      </div>
      <select class="saisie" id="filtre-statut">
        ${[["", "Tous les statuts"], ["en_attente", "En attente"], ["approuvee", "Approuvées"], ["rejetee", "Rejetées"], ["annulee", "Annulées"]]
          .map(([v, l]) => `<option value="${v}" ${f.statut === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <input class="saisie" id="filtre-recherche" placeholder="Rechercher une référence, un motif…" value="${echapper(f.recherche)}">
      <span class="compteur-resultats">${liste.length} demande(s)</span>
    </div>

    ${liste.length ? `<div class="tableau-boite">
      <table>
        <thead><tr>
          <th>Référence</th><th>Type</th><th>Période</th><th class="centre">Durée</th><th>Validateur</th><th>Statut</th><th></th>
        </tr></thead>
        <tbody>
          ${liste.map((d) => `<tr class="cliquable ${d.ref === etat.demandeMiseEnAvant ? "ligne-nouvelle" : ""}" data-demande-ref="${d.ref}">
            <td class="mono" style="font-size:12px">${d.ref}</td>
            <td>
              <div class="puce-type"><span class="point" style="background:${{ conge: "var(--marine)", autorisation: "var(--info)", mission: "var(--violet)" }[d.type]}"></span>${echapper(libelleType(d.type, d.sousType))}</div>
            </td>
            <td>${d.debut === d.fin ? fmtDate(d.debut) : `${fmtDate(d.debut)} → ${fmtDate(d.fin)}`}
              ${d.heureDebut ? `<span style="color:var(--encre-3);font-size:12px"> · ${d.heureDebut}–${d.heureFin}</span>` : ""}</td>
            <td class="centre num">${d.type === "autorisation" ? `${d.heureDebut ? fmtNombre((Number(d.heureFin.slice(0, 2)) - Number(d.heureDebut.slice(0, 2)))) + " h" : "—"}` : `${fmtNombre(d.jours)} j`}</td>
            <td>${d.validateur ? echapper(nomComplet(parMatricule[d.validateur])) : "—"}</td>
            <td>${badgeStatut(d.statut)}</td>
            <td class="droite">${ico("chevronD", "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : etatVide("demandes", "Aucune demande ne correspond", "Modifiez vos filtres ou déposez une nouvelle demande.",
      `<button class="btn primaire" data-action="nouvelle-demande" style="margin-top:10px">${ico("plus")} Nouvelle demande</button>`)}
  </section>`;
};

function ouvrirDetailDemande(ref) {
  const d = DEMANDES.find((x) => x.ref === ref);
  if (!d) return;
  const employe = parMatricule[d.matricule];
  const validateur = d.validateur ? parMatricule[d.validateur] : null;
  const annulable = d.matricule === moi().matricule && (d.statut === "en_attente" || d.statut === "approuvee");

  const lignes = [
    ["Collaborateur", `${nomComplet(employe)} (${employe.matricule})`],
    ["Département", nomDept(employe.dept)],
    ["Type", libelleType(d.type, d.sousType)],
    ["Période", d.debut === d.fin ? fmtDateLongue(d.debut) : `${fmtDateLongue(d.debut)} → ${fmtDateLongue(d.fin)}`],
    d.heureDebut ? ["Horaire", `${d.heureDebut} — ${d.heureFin}`] : null,
    d.type !== "autorisation" ? ["Durée", `${fmtNombre(d.jours)} jour(s) ouvré(s)`] : null,
    ["Validateur", validateur ? `${nomComplet(validateur)} — ${validateur.poste}` : "Direction RH"],
    d.justificatif ? ["Justificatif", d.justificatif] : null,
    d.commentaire ? ["Commentaire", d.commentaire] : null,
    d.motifRefus ? ["Motif du refus", d.motifRefus] : null,
  ].filter(Boolean);

  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true">
      ${enteteTiroir(libelleType(d.type, d.sousType), `<span class="mono">${d.ref}</span> · déposée ${tempsRelatif(d.cree)}`)}
      <div class="tiroir-corps">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${badgeStatut(d.statut)}
          <span class="badge neutre">${{ conge: "Congé", autorisation: "Autorisation", mission: "Mission" }[d.type]}</span>
          ${d.statut === "en_attente" ? `<span class="badge info">Niveau 1 / ${d.jours > 10 ? 2 : 1}</span>` : ""}
        </div>

        <div class="tableau-boite">
          <table style="min-width:auto">
            <tbody>
              ${lignes.map(([cle, valeur]) => `<tr>
                <td style="width:38%;color:var(--encre-3);font-weight:600;font-size:12.5px">${echapper(cle)}</td>
                <td>${echapper(valeur)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>

        <div>
          <h3 style="margin-bottom:12px">Historique de validation</h3>
          <div class="chrono">
            ${d.historique.map((h) => {
              const styles = { en_attente: ["attente", "horloge", "Demande soumise"], approuvee: ["succes", "check", "Demande approuvée"], rejetee: ["danger", "croix", "Demande rejetée"], annulee: ["", "croix", "Demande annulée"] }[h.statut];
              const acteur = h.acteur ? parMatricule[h.acteur] : null;
              return `<div class="chrono-etape">
                <div class="chrono-pastille ${styles[0]}">${ico(styles[1])}</div>
                <div class="chrono-texte">
                  <strong>${styles[2]}</strong>
                  <p>${acteur ? echapper(nomComplet(acteur)) : "Système"}${h.commentaire ? ` — ${echapper(h.commentaire)}` : ""}</p>
                  <time>${fmtDate(h.date)} à ${String(h.date.getHours()).padStart(2, "0")}:${String(h.date.getMinutes()).padStart(2, "0")}</time>
                </div>
              </div>`;
            }).join("")}
            ${d.statut === "en_attente" ? `<div class="chrono-etape">
              <div class="chrono-pastille">${ico("horloge")}</div>
              <div class="chrono-texte"><strong style="color:var(--encre-3)">En attente de décision</strong>
              <p>${validateur ? echapper(nomComplet(validateur)) : "Direction RH"} doit se prononcer.</p></div>
            </div>` : ""}
          </div>
        </div>
      </div>
      <div class="tiroir-pied">
        ${annulable ? `<button class="btn danger" id="annuler-la-demande">${ico("croix")} Annuler la demande</button>` : ""}
        <button class="btn" id="pdf-demande">${ico("telecharger")} Justificatif PDF</button>
        <button class="btn primaire" id="fermer-detail">Fermer</button>
      </div>
    </aside>`, { tiroir: true });

  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#fermer-detail").addEventListener("click", fermerCouche);
  $("#pdf-demande").addEventListener("click", () => toast("Export PDF", `${d.ref} — le document sera généré par le backend aux couleurs de Veltaris.`, "info"));
  const btnAnnuler = $("#annuler-la-demande");
  if (btnAnnuler) btnAnnuler.addEventListener("click", () => annulerMaDemande(d));
}

function annulerMaDemande(d) {
  d.statut = "annulee";
  d.historique.push({ statut: "annulee", acteur: moi().matricule, commentaire: "Demande annulée par le demandeur", date: new Date() });
  if (d.type === "conge" && d.sousType === "annuel") SOLDES[d.matricule].pris = Math.max(0, SOLDES[d.matricule].pris - d.jours);
  fermerCouche();
  toast("Demande annulée", `${d.ref} a été retirée du circuit de validation.`, "info");
  rendre(false);
}

/* ==========================================================================
   12. FILE DE VALIDATION
   ========================================================================== */
VUES["/validation"] = function () {
  const f = etat.filtres.validation || (etat.filtres.validation = { type: "", dept: "" });
  let liste = demandesAValider();
  if (f.type) liste = liste.filter((d) => d.type === f.type);
  if (f.dept) liste = liste.filter((d) => parMatricule[d.matricule].dept === f.dept);
  liste.sort((a, b) => a.cree - b.cree);

  const equipe = estAdmin() ? EMPLOYES : equipeDe(moi().matricule);
  const anomaliesEquipe = ANOMALIES.filter((a) => a.statut === "ouverte" && equipe.some((e) => e.matricule === a.matricule));
  const congesEnCours = DEMANDES.filter((d) => d.statut === "approuvee" && d.type === "conge"
    && depuisIso(d.debut) <= AUJOURDHUI && depuisIso(d.fin) >= AUJOURDHUI && equipe.some((e) => e.matricule === d.matricule));

  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "v1", libelle: "En attente de votre décision", valeur: demandesAValider().length, unite: "", icone: "inbox", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `${liste.filter((d) => (Date.now() - d.cree) / 86400000 > 3).length} depuis plus de 3 jours` })}
    ${carteKpi({ cle: "v2", libelle: "Effectif suivi", valeur: equipe.length, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: estAdmin() ? "Toute l'entreprise" : "Votre équipe directe" })}
    ${carteKpi({ cle: "v3", libelle: "Absents aujourd'hui", valeur: congesEnCours.length, unite: "", icone: "calendrier", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: congesEnCours.length ? congesEnCours.slice(0, 2).map((d) => parMatricule[d.matricule].prenom).join(", ") : "Équipe au complet" })}
    ${carteKpi({ cle: "v4", libelle: "Anomalies équipe", valeur: anomaliesEquipe.length, unite: "", icone: "alerte", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: "Pointages à régulariser" })}
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap">
      <h2>File de validation</h2>
      <div class="barre-filtres">
        <div class="segment" id="filtre-type-validation">
          ${[["", "Toutes"], ["conge", "Congés"], ["autorisation", "Autorisations"], ["mission", "Missions"]]
            .map(([v, l]) => `<button data-valeur="${v}" class="${f.type === v ? "actif" : ""}">${l}</button>`).join("")}
        </div>
        ${estAdmin() ? `<select class="saisie" id="filtre-dept-validation">
          <option value="">Tous les départements</option>
          ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
        </select>` : ""}
      </div>
    </div>

    ${liste.length ? `<div class="inbox">
      ${liste.map((d) => {
        const e = parMatricule[d.matricule];
        const anciennete = Math.floor((Date.now() - d.cree) / 86400000);
        const solde = soldeDe(d.matricule);
        return `<article class="inbox-item ${d.type}">
          <div class="avatar" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
          <div class="inbox-corps" data-demande-ref="${d.ref}" style="cursor:pointer">
            <div class="titre">${echapper(nomComplet(e))}
              <span class="badge neutre">${echapper(libelleType(d.type, d.sousType))}</span>
              ${anciennete > 3 ? `<span class="badge rejetee">${ico("alerte")} ${anciennete} j d'attente</span>` : ""}
              ${d.validateur && d.validateur !== moi().matricule && parMatricule[d.validateur]
                ? `<span class="badge info" title="Vous pouvez valider à défaut">Décision attendue de ${echapper(nomComplet(parMatricule[d.validateur]))}</span>` : ""}
            </div>
            <div class="detail">${d.debut === d.fin ? fmtDateLongue(d.debut) : `${fmtDateLongue(d.debut)} → ${fmtDateLongue(d.fin)}`}
              ${d.heureDebut ? ` · ${d.heureDebut}–${d.heureFin}` : ` · ${fmtNombre(d.jours)} jour(s)`}</div>
            <div class="meta">
              <span class="mono">${d.ref}</span>
              <span>${nomDept(e.dept)}</span>
              ${d.type === "conge" && d.sousType === "annuel" ? `<span>Solde après validation : ${fmtNombre(solde.restant - d.jours)} j</span>` : ""}
              ${d.commentaire ? `<span>« ${echapper(d.commentaire)} »</span>` : ""}
            </div>
          </div>
          <div class="inbox-actions">
            <button class="btn petit danger" data-rejeter="${d.ref}">${ico("croix")} Rejeter</button>
            <button class="btn petit succes" data-approuver="${d.ref}">${ico("check")} Approuver</button>
          </div>
        </article>`;
      }).join("")}
    </div>` : etatVide("check", "File vide — tout est traité", "Aucune demande n'attend votre décision. Les nouvelles demandes arriveront ici en temps réel.")}
  </section>`;
};

function decider(ref, approuve) {
  const d = DEMANDES.find((x) => x.ref === ref);
  if (!d || d.statut !== "en_attente") return;

  if (!approuve) {
    ouvrirCouche(`
      <div class="modale" role="dialog" aria-modal="true">
        <div class="modale-tete">
          <div><h2>Rejeter la demande</h2><div class="sous"><span class="mono">${d.ref}</span> · ${echapper(nomComplet(parMatricule[d.matricule]))}</div></div>
        </div>
        <div class="modale-corps">
          <div class="champ">
            <label for="motif">Motif du refus <span style="color:var(--danger)">*</span></label>
            <textarea class="saisie" id="motif" placeholder="Expliquez la raison du refus — le collaborateur la recevra en notification."></textarea>
            <span class="aide">Un motif clair évite les relances et sécurise l'audit RH.</span>
          </div>
        </div>
        <div class="modale-pied">
          <button class="btn" id="annuler-refus">Annuler</button>
          <button class="btn danger" id="confirmer-refus">${ico("croix")} Confirmer le refus</button>
        </div>
      </div>`);
    $("#annuler-refus").addEventListener("click", fermerCouche);
    $("#confirmer-refus").addEventListener("click", () => {
      const motif = $("#motif").value.trim();
      if (!motif) return toast("Motif obligatoire", "Indiquez la raison du refus.", "danger");
      appliquerDecision(d, false, motif);
      fermerCouche();
    });
    return;
  }
  appliquerDecision(d, true, null);
}

function appliquerDecision(d, approuve, motif) {
  d.statut = approuve ? "approuvee" : "rejetee";
  d.dateValidation = new Date();
  d.validateur = moi().matricule;
  if (!approuve) d.motifRefus = motif;
  d.historique.push({ statut: d.statut, acteur: moi().matricule, commentaire: approuve ? "Demande approuvée" : motif, date: new Date() });

  // Le solde n'est décrémenté qu'à l'approbation finale.
  if (approuve && d.type === "conge" && d.sousType === "annuel") {
    SOLDES[d.matricule].pris = Math.round((SOLDES[d.matricule].pris + d.jours) * 10) / 10;
  }
  NOTIFICATIONS.unshift({
    id: idNotif++, matricule: d.matricule,
    titre: approuve ? "Demande approuvée" : "Demande refusée",
    message: `${libelleType(d.type, d.sousType)} (${d.ref})${approuve ? "" : ` — motif : ${motif}`}`,
    type: approuve ? "succes" : "alerte", lien: "/mes-demandes", lu: false, date: new Date(),
  });
  toast(approuve ? "Demande approuvée" : "Demande rejetée",
    `${d.ref} · ${nomComplet(parMatricule[d.matricule])} a été notifié${approuve ? "e" : ""} en temps réel.`,
    approuve ? "succes" : "info");
  rendre(false);
}
