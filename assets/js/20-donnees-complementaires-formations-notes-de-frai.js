/* ==========================================================================
   20. DONNÉES COMPLÉMENTAIRES — formations, notes de frais, entretiens
   ========================================================================== */
const BRANCHEMENTS = {};   // branchements d'événements des nouvelles rubriques

const LIEUX = ["Siège — Tunis", "Agence Lac 2", "Centre de formation Charguia", "À distance", "Hôtel Laico Tunis"];
const CATALOGUE_FORMATIONS = [
  ["Solvabilité II — fondamentaux", "Technique", 2, "Contrôle prudentiel, provisionnement et reporting réglementaire."],
  ["Lutte anti-blanchiment (LAB/FT)", "Conformité", 1, "Obligation annuelle CGA — vigilance, déclaration de soupçon."],
  ["Souscription IARD entreprises", "Technique", 3, "Analyse de risque industriel et tarification."],
  ["Excel avancé pour la gestion", "Bureautique", 2, "Tableaux croisés, Power Query, tableaux de bord."],
  ["Relation client difficile", "Relationnel", 2, "Gestion des réclamations et désamorçage de conflit."],
  ["Cybersécurité — bonnes pratiques", "Sécurité", 1, "Hameçonnage, mots de passe, données personnelles."],
  ["Management d'équipe de proximité", "Management", 3, "Animation, délégation, entretiens de recadrage."],
  ["Assurance vie et épargne retraite", "Technique", 2, "Produits, fiscalité tunisienne et conseil patrimonial."],
];

const FORMATIONS = CATALOGUE_FORMATIONS.map(([titre, theme, jours, description], index) => {
  const debut = ajouterJours(AUJOURDHUI, entre(-40, 70));
  return {
    id: index + 1, titre, theme, jours, description,
    debut: iso(debut), fin: iso(ajouterJours(debut, jours - 1)),
    lieu: piocher(LIEUX), places: entre(8, 20), formateur: piocher(["Cabinet Actuaris", "IFID", "Interne — DRH", "CFPA Tunis"]),
    inscrits: [],
  };
});
// Inscriptions de démonstration réparties sur l'effectif.
FORMATIONS.forEach((f) => {
  EMPLOYES.forEach((e) => { if (rnd() < 0.18 && f.inscrits.length < f.places) f.inscrits.push(e.matricule); });
});

const CATEGORIES_FRAIS = {
  transport: ["Transport", "avion", "var(--info)", "var(--info-doux)"],
  repas: ["Repas", "users", "var(--alerte)", "var(--alerte-doux)"],
  hebergement: ["Hébergement", "batiment", "var(--violet)", "var(--violet-doux)"],
  carburant: ["Carburant", "avion", "var(--succes)", "var(--succes-doux)"],
  divers: ["Divers", "doc", "var(--encre-3)", "var(--surface-3)"],
};

const NOTES_FRAIS = [];
let idFrais = 1;
EMPLOYES.forEach((e) => {
  for (let i = 0; i < entre(0, 3); i++) {
    const mois = entre(Math.max(0, AUJOURDHUI.getMonth() - 3), AUJOURDHUI.getMonth());
    const lignes = Array.from({ length: entre(1, 4) }, () => {
      const categorie = piocher(Object.keys(CATEGORIES_FRAIS));
      return {
        date: iso(new Date(ANNEE, mois, entre(1, 28))),
        categorie,
        libelle: {
          transport: "Taxi vers agence client", repas: "Déjeuner avec courtier",
          hebergement: "Nuitée — mission Sousse", carburant: "Plein véhicule de service",
          divers: "Frais de parking et péage",
        }[categorie],
        montant: entre(15, 320) + 0.5,
      };
    });
    const statut = mois < AUJOURDHUI.getMonth() ? piocher(["remboursee", "remboursee", "approuvee"]) : piocher(["en_attente", "approuvee", "brouillon"]);
    NOTES_FRAIS.push({
      id: idFrais++, matricule: e.matricule, reference: `NF-${ANNEE}-${1400 + idFrais}`,
      periode: `${String(mois + 1).padStart(2, "0")}/${ANNEE}`, lignes, statut,
      total: Math.round(lignes.reduce((s, l) => s + l.montant, 0) * 100) / 100,
      cree: new Date(ANNEE, mois, entre(20, 28)),
    });
  }
});

const OBJECTIFS_MODELES = [
  ["Réduire le délai de règlement des sinistres", "Porter le délai moyen sous 12 jours sur le portefeuille auto."],
  ["Digitaliser les dossiers clients", "80 % des nouveaux contrats sans pièce papier."],
  ["Développer le portefeuille entreprises", "Trois nouveaux contrats flotte signés dans l'année."],
  ["Fiabiliser le reporting mensuel", "Clôture des états de gestion avant le 5 du mois."],
  ["Monter en compétence sur la réglementation", "Valider les deux formations conformité obligatoires."],
];

const ENTRETIENS = EMPLOYES.map((e) => ({
  matricule: e.matricule,
  campagne: `Entretien annuel ${ANNEE}`,
  statut: piocher(["a_planifier", "planifie", "planifie", "realise"]),
  date: iso(ajouterJours(AUJOURDHUI, entre(-60, 45))),
  evaluateur: e.validateur,
  objectifs: OBJECTIFS_MODELES.slice(0, entre(3, 5)).map(([titre, description]) => ({
    titre, description, avancement: entre(10, 100),
    poids: piocher([20, 25, 30]),
  })),
  souhaits: piocher([
    "Évoluer vers un poste de référent technique.",
    "Suivre la formation Solvabilité II niveau 2.",
    "Prendre en charge l'animation d'une agence.",
    "Renforcer mes compétences en pilotage budgétaire.",
  ]),
  commentaireManager: null,
}));

const JOURS_FERIES_CONFIG = [
  ["01/01", "Nouvel An", "fixe"], ["14/01", "Fête de la Révolution", "fixe"],
  ["20/03", "Fête de l'Indépendance", "fixe"], ["09/04", "Jour des Martyrs", "fixe"],
  ["01/05", "Fête du Travail", "fixe"], ["25/07", "Fête de la République", "fixe"],
  ["13/08", "Fête de la Femme", "fixe"], ["15/10", "Fête de l'Évacuation", "fixe"],
  ["17/12", "Fête de la Révolution et de la Jeunesse", "fixe"],
  ["20/03", "Aïd el-Fitr", "mobile"], ["27/05", "Aïd el-Idha", "mobile"],
  ["16/06", "Ras el-Am el-Hejri", "mobile"], ["25/08", "Mouled", "mobile"],
];

/* ==========================================================================
   21. ANNUAIRE
   ========================================================================== */
VUES["/annuaire"] = function () {
  const f = etat.filtres.annuaire || (etat.filtres.annuaire = { recherche: "", dept: "", vue: "cartes" });
  let liste = EMPLOYES.filter((e) => e.statut === "actif");
  if (f.recherche) {
    const q = f.recherche.toLowerCase();
    liste = liste.filter((e) => nomComplet(e).toLowerCase().includes(q) || e.matricule.toLowerCase().includes(q)
      || e.poste.toLowerCase().includes(q) || nomDept(e.dept).toLowerCase().includes(q));
  }
  if (f.dept) liste = liste.filter((e) => e.dept === f.dept);

  const absentsAujourdhui = new Set(DEMANDES.filter((d) => d.statut === "approuvee" && d.type === "conge"
    && depuisIso(d.debut) <= AUJOURDHUI && depuisIso(d.fin) >= AUJOURDHUI).map((d) => d.matricule));
  const enMission = new Set(DEMANDES.filter((d) => d.statut === "approuvee" && d.type === "mission"
    && depuisIso(d.debut) <= AUJOURDHUI && depuisIso(d.fin) >= AUJOURDHUI).map((d) => d.matricule));

  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "an1", libelle: "Effectif actif", valeur: EMPLOYES.filter((e) => e.statut === "actif").length, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${DEPARTEMENTS.length} départements` })}
    ${carteKpi({ cle: "an2", libelle: "Présents aujourd'hui", valeur: EMPLOYES.length - absentsAujourdhui.size - enMission.size, unite: "", icone: "check", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: fmtDateLongue(AUJOURDHUI) })}
    ${carteKpi({ cle: "an3", libelle: "En congé", valeur: absentsAujourdhui.size, unite: "", icone: "calendrier", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "Congés approuvés en cours" })}
    ${carteKpi({ cle: "an4", libelle: "En mission", valeur: enMission.size, unite: "", icone: "avion", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "Hors des locaux" })}
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <h2>Annuaire des collaborateurs</h2>
      <div class="barre-filtres" style="margin-left:auto">
        <input class="saisie" id="annuaire-recherche" placeholder="Nom, matricule, poste…" value="${echapper(f.recherche)}" style="min-width:210px">
        <select class="saisie" id="annuaire-dept">
          <option value="">Tous les départements</option>
          ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
        </select>
        <span class="compteur-resultats">${liste.length} personne(s)</span>
      </div>
    </div>

    ${liste.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(252px,1fr))">
      ${liste.map((e) => {
        const statut = absentsAujourdhui.has(e.matricule) ? ["attente", "En congé"]
          : enMission.has(e.matricule) ? ["violet", "En mission"] : ["approuvee", "Présent"];
        return `<article class="carte" style="box-shadow:none;padding:15px;cursor:pointer;border-top:3px solid ${couleurDept(e.dept)}" data-fiche-annuaire="${e.matricule}">
          <div style="display:flex;align-items:center;gap:11px;margin-bottom:11px">
            <div class="avatar l" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
            <div style="min-width:0">
              <strong style="display:block;font-size:14px">${echapper(nomComplet(e))}</strong>
              <span style="font-size:12px;color:var(--encre-3);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${echapper(e.poste)}</span>
              <span class="badge ${statut[0]}" style="margin-top:5px">${statut[1]}</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--encre-2);display:flex;flex-direction:column;gap:4px;padding-top:11px;border-top:1px solid var(--trait)">
            <span class="mono">${e.matricule}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${echapper(e.email)}</span>
            <span class="puce-type"><span class="point" style="background:${couleurDept(e.dept)}"></span>${nomDept(e.dept)}</span>
          </div>
        </article>`;
      }).join("")}
    </div>` : etatVide("users", "Aucun collaborateur trouvé", "Ajustez la recherche ou changez de département.")}
  </section>`;
};

BRANCHEMENTS["/annuaire"] = function () {
  const f = etat.filtres.annuaire;
  const recherche = $("#annuaire-recherche");
  recherche.addEventListener("input", debounce((e) => {
    f.recherche = e.target.value; rendre(false);
    const champ = $("#annuaire-recherche");
    champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
  }, 260));
  $("#annuaire-dept").addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
  $$("[data-fiche-annuaire]").forEach((c) => c.addEventListener("click", () => ouvrirFicheAnnuaire(c.dataset.ficheAnnuaire)));
};

function ouvrirFicheAnnuaire(matricule) {
  const e = parMatricule[matricule];
  const validateur = e.validateur ? parMatricule[e.validateur] : null;
  const equipe = EMPLOYES.filter((x) => x.validateur === matricule);
  const solde = soldeDe(matricule);
  const prochainsConges = DEMANDES.filter((d) => d.matricule === matricule && d.statut === "approuvee"
    && depuisIso(d.fin) >= AUJOURDHUI).slice(0, 3);
  const formationsSuivies = FORMATIONS.filter((fo) => fo.inscrits.includes(matricule));

  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true">
      ${enteteTiroir(nomComplet(e), `${e.poste} · ${nomDept(e.dept)}`)}
      <div class="tiroir-corps">
        <div style="display:flex;align-items:center;gap:15px">
          <div class="avatar xl" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <span class="badge neutre mono">${e.matricule}</span>
            <span style="font-size:12.5px;color:var(--encre-2)">${echapper(e.email)}</span>
            <span style="font-size:12.5px;color:var(--encre-2)" class="mono">${echapper(e.telephone || "—")}</span>
          </div>
        </div>

        <div class="tableau-boite">
          <table style="min-width:auto"><tbody>
            <tr><td style="width:42%;color:var(--encre-3);font-weight:600;font-size:12.5px">Département</td><td>${nomDept(e.dept)}</td></tr>
            <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Responsable (N+1)</td><td>${validateur ? echapper(nomComplet(validateur)) : "—"}</td></tr>
            <tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Dans l'entreprise depuis</td><td>${e.entree ? `${fmtDateLongue(e.entree)} · ${ANNEE - Number(e.entree.slice(0, 4))} an(s)` : "Non renseignée"}</td></tr>
            ${estValideur() ? `<tr><td style="color:var(--encre-3);font-weight:600;font-size:12.5px">Solde de congés</td><td><strong>${fmtNombre(solde.restant)} j</strong> restants sur ${fmtNombre(solde.total)} j</td></tr>` : ""}
          </tbody></table>
        </div>

        ${equipe.length ? `<div>
          <h3 style="margin-bottom:10px">Équipe encadrée · ${equipe.length}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${equipe.map((m) => `<span class="badge neutre" style="padding:5px 10px"><span class="avatar s" style="background:${couleurDept(m.dept)};width:20px;height:20px;font-size:9px">${initiales(m)}</span> ${echapper(nomComplet(m))}</span>`).join("")}
          </div>
        </div>` : ""}

        ${prochainsConges.length ? `<div>
          <h3 style="margin-bottom:10px">Absences à venir</h3>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${prochainsConges.map((d) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid var(--trait);border-radius:var(--r-m);font-size:12.5px">
              <span>${echapper(libelleType(d.type, d.sousType))}</span>
              <span style="color:var(--encre-3)">${fmtDate(d.debut)} → ${fmtDate(d.fin)}</span>
            </div>`).join("")}
          </div>
        </div>` : ""}

        ${formationsSuivies.length ? `<div>
          <h3 style="margin-bottom:10px">Formations</h3>
          <div style="display:flex;flex-wrap:wrap;gap:7px">
            ${formationsSuivies.map((fo) => `<span class="badge info">${echapper(fo.titre)}</span>`).join("")}
          </div>
        </div>` : ""}
      </div>
      <div class="tiroir-pied">
        <button class="btn" id="fermer-fiche">Fermer</button>
        <button class="btn primaire" id="ecrire-fiche">${ico("doc")} Envoyer un message</button>
      </div>
    </aside>`, { tiroir: true });

  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#fermer-fiche").addEventListener("click", fermerCouche);
  $("#ecrire-fiche").addEventListener("click", () => {
    fermerCouche();
    toast("Message", `Un courriel à ${e.email} sera ouvert dans votre messagerie.`, "info");
  });
}

/* ==========================================================================
   22. CALENDRIER D'ÉQUIPE
   ========================================================================== */
VUES["/calendrier"] = function () {
  const f = etat.filtres.calendrier || (etat.filtres.calendrier = { mois: AUJOURDHUI.getMonth(), dept: "" });
  let equipe = perimetre();
  if (f.dept) equipe = equipe.filter((e) => e.dept === f.dept);
  const matricules = equipe.map((e) => e.matricule);

  const premier = new Date(ANNEE, f.mois, 1);
  const nbJours = new Date(ANNEE, f.mois + 1, 0).getDate();
  const decalage = (premier.getDay() + 6) % 7;   // grille commençant le lundi

  const absencesDuJour = (jour) => {
    const cle = iso(jour);
    return DEMANDES.filter((d) => d.statut === "approuvee" && matricules.includes(d.matricule)
      && d.debut <= cle && d.fin >= cle);
  };

  const cellules = [];
  for (let i = 0; i < decalage; i++) cellules.push('<div class="cal-cellule vide"></div>');
  for (let jour = 1; jour <= nbJours; jour++) {
    const date = new Date(ANNEE, f.mois, jour);
    const absences = absencesDuJour(date);
    const ferie = estFerie(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const aujourdhui = iso(date) === iso(AUJOURDHUI);
    const taux = equipe.length ? absences.length / equipe.length : 0;

    cellules.push(`<div class="cal-cellule ${weekend ? "weekend" : ""} ${aujourdhui ? "aujourdhui" : ""} ${taux > 0.25 ? "tendu" : ""}" data-jour="${iso(date)}">
      <div class="cal-tete">
        <span class="cal-num">${jour}</span>
        ${ferie ? `<span class="badge or" style="font-size:9.5px;padding:1px 6px">Férié</span>` : ""}
      </div>
      ${absences.length ? `<div class="cal-avatars">
        ${absences.slice(0, 4).map((d) => {
          const e = parMatricule[d.matricule];
          const couleur = d.type === "mission" ? "var(--violet)" : couleurDept(e.dept);
          return `<span class="avatar s" style="background:${couleur};width:22px;height:22px;font-size:9px" title="${echapper(nomComplet(e))} — ${echapper(libelleType(d.type, d.sousType))}">${initiales(e)}</span>`;
        }).join("")}
        ${absences.length > 4 ? `<span class="avatar s" style="width:22px;height:22px;font-size:9px;background:var(--surface-3);color:var(--encre-2)">+${absences.length - 4}</span>` : ""}
      </div>` : ""}
      ${taux > 0.25 ? `<small style="display:block;margin-top:5px;color:var(--danger);font-weight:700">Conflit · ${Math.round(taux * 100)} % absents</small>` : ""}
    </div>`);
  }

  const totalMois = DEMANDES.filter((d) => d.statut === "approuvee" && matricules.includes(d.matricule)
    && depuisIso(d.debut).getMonth() <= f.mois && depuisIso(d.fin).getMonth() >= f.mois).length;

  return `
  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn petit icone" id="cal-precedent" aria-label="Mois précédent">${ico("chevronG")}</button>
        <strong style="font-family:var(--police-titre);font-size:17px;min-width:158px;text-align:center;text-transform:capitalize">${MOIS[f.mois]} ${ANNEE}</strong>
        <button class="btn petit icone" id="cal-suivant" aria-label="Mois suivant">${ico("chevronD")}</button>
        ${f.mois !== AUJOURDHUI.getMonth() ? `<button class="btn petit fantome" id="cal-aujourdhui">Ce mois-ci</button>` : ""}
      </div>
      <div class="barre-filtres" style="margin-left:auto">
        ${estValideur() ? `<select class="saisie" id="cal-dept">
          <option value="">Tout mon périmètre</option>
          ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
        </select>` : ""}
        <span class="compteur-resultats">${totalMois} absence(s) sur le mois</span>
      </div>
    </div>

    <div class="cal-grille">
      ${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((j) => `<div class="cal-entete">${j}</div>`).join("")}
      ${cellules.join("")}
    </div>

    <div class="legende" style="margin-top:14px">
      <span class="badge neutre"><span class="point" style="background:var(--marine)"></span>Congé</span>
      <span class="badge neutre"><span class="point" style="background:var(--violet)"></span>Mission</span>
      <span class="badge or">Jour férié</span>
      <span class="badge rejetee">Plus d'un quart de l'équipe absente</span>
    </div>
    <p style="font-size:12px;color:var(--encre-3);margin-top:10px">${ico("oeil")} Cliquez sur une journée pour voir le détail des absences.</p>
  </section>`;
};

BRANCHEMENTS["/calendrier"] = function () {
  const f = etat.filtres.calendrier;
  $("#cal-precedent").addEventListener("click", () => { f.mois = (f.mois + 11) % 12; rendre(false); });
  $("#cal-suivant").addEventListener("click", () => { f.mois = (f.mois + 1) % 12; rendre(false); });
  const auj = $("#cal-aujourdhui");
  if (auj) auj.addEventListener("click", () => { f.mois = AUJOURDHUI.getMonth(); rendre(false); });
  const dept = $("#cal-dept");
  if (dept) dept.addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
  $$("[data-jour]").forEach((c) => c.addEventListener("click", () => ouvrirJourneeCalendrier(c.dataset.jour)));
};

function ouvrirJourneeCalendrier(cle) {
  const equipe = perimetre();
  const matricules = equipe.map((e) => e.matricule);
  const absences = DEMANDES.filter((d) => d.statut === "approuvee" && matricules.includes(d.matricule)
    && d.debut <= cle && d.fin >= cle);
  const date = depuisIso(cle);
  const absents = new Set(absences.map((d) => d.matricule));
  const structures_absentes = new Set(absences.map((d) => parMatricule[d.matricule]?.dept).filter(Boolean));
  const remplacants = equipe.filter((e) => !absents.has(e.matricule) && structures_absentes.has(e.dept))
    .sort((a, b) => (a.niveau === "collaborateur") - (b.niveau === "collaborateur") || nomComplet(a).localeCompare(nomComplet(b)))
    .slice(0, 5);

  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2 style="text-transform:capitalize">${JOURS[date.getDay()]} ${fmtDateLongue(cle)}</h2>
        <div class="sous">${absences.length} absence(s) · ${estFerie(date) || (date.getDay() % 6 === 0 ? "week-end" : "jour ouvré")}</div></div>
        <button class="btn icone fantome" id="fermer-journee" style="margin-left:auto" aria-label="Fermer">${ico("croix")}</button>
      </div>
      <div class="modale-corps">
        ${absences.length ? `<div style="display:flex;flex-direction:column;gap:8px">
          ${absences.map((d) => {
            const e = parMatricule[d.matricule];
            return `<div style="display:flex;align-items:center;gap:11px;padding:11px;border:1px solid var(--trait);border-radius:var(--r-m)">
              <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
              <div style="flex:1;min-width:0">
                <strong style="font-size:13px;display:block">${echapper(nomComplet(e))}</strong>
                <span style="font-size:11.5px;color:var(--encre-3)">${nomDept(e.dept)} · ${fmtDate(d.debut)} → ${fmtDate(d.fin)}</span>
              </div>
              <span class="badge ${d.type === "mission" ? "violet" : "info"}">${echapper(libelleType(d.type, d.sousType))}</span>
            </div>`;
          }).join("")}
        </div>
        <div class="bandeau-info" style="margin-top:14px">${ico("users")}<span><strong>Remplaçants suggérés</strong> · disponibles dans la même structure, avec priorité aux niveaux d'encadrement. La désignation reste à confirmer par le manager.</span></div>
        ${remplacants.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${remplacants.map((e) => `<span class="badge neutre" title="${echapper(nomDept(e.dept))}">${echapper(nomComplet(e))} · ${echapper(e.niveau || "collaborateur")}</span>`).join("")}</div>` : `<p style="font-size:12px;color:var(--encre-3);margin-top:10px">Aucun remplaçant disponible dans la même structure sur cette journée.</p>`}`
        : etatVide("check", "Personne n'est absent", "Toute l'équipe est disponible cette journée-là.")}
      </div>
    </div>`);
  $("#fermer-journee").addEventListener("click", fermerCouche);
}
