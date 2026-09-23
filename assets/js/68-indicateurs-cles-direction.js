/* ==========================================================================
   68. INDICATEURS CLÉS POUR LA DIRECTION
       Calculés sur les données du portail : étendue de l'encadrement,
       délais de décision des responsables, valeur des congés non pris.
       RH et Direction générale.
   ========================================================================== */
const indHeures = (h) => (h == null ? "—" : h < 48 ? `${fmtNombre(h, 1)} h` : `${fmtNombre(h / 24, 1)} j`);
const indDinars = (v) => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} DT`);

VUES["/indicateurs"] = function () {
  if (!connecte()) return reserveServeur("Les indicateurs clés");
  if (!(estAdmin() || estDirection())) return etatVide("bouclier", "Réservé", "Indicateurs réservés à la RH et à la Direction générale.");
  const f = etat.filtres.indicateurs || (etat.filtres.indicateurs = { onglet: "organisation" });
  const d = chargerEtat("indicateursCles", () => API.appel("/api/indicateurs"));
  const onglets = [["organisation", "Encadrement"], ["decisions", "Délais de décision"], ["conges", "Congés non pris"]];
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Indicateurs clés</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Calculés sur les données réelles du portail — ils éclairent la décision, ils ne la remplacent pas.</p></div>
    <div class="segment">${onglets.map(([k, l]) => `<button data-ind-onglet="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div></div>`;
  if (!d) return `<section class="carte">${entete}${squelette(260)}</section>`;
  if (d.erreur) return `<section class="carte">${entete}${etatVide("rapport", "Indisponible", echapper(d.erreur))}</section>`;
  let corps = "";

  if (f.onglet === "organisation") {
    const o = d.organisation;
    corps = `<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      ${carteKpi({ cle: "io1", libelle: "Responsables", valeur: o.responsables, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `taux d'encadrement ${o.taux_encadrement == null ? "—" : fmtNombre(o.taux_encadrement, 1)} %` })}
      ${carteKpi({ cle: "io2", libelle: "Encadrés par responsable", valeur: o.moyenne_encadres == null ? "—" : fmtNombre(o.moyenne_encadres, 1), unite: "", icone: "organigramme", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `médiane ${o.mediane_encadres == null ? "—" : fmtNombre(o.mediane_encadres, 1)} · maximum ${o.maximum_encadres ?? "—"}` })}
      ${carteKpi({ cle: "io3", libelle: `Plus de ${o.seuil_etendue} encadrés`, valeur: o.etendue_large, unite: "", icone: "alerte", couleur: o.etendue_large ? "var(--alerte)" : "var(--succes)", fond: o.etendue_large ? "var(--alerte-doux)" : "var(--succes-doux)", detail: "encadrement difficile au quotidien" })}
      ${carteKpi({ cle: "io4", libelle: "Niveaux hiérarchiques", valeur: o.niveaux_hierarchiques, unite: "", icone: "grille", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${o.une_personne} responsable(s) d'une seule personne` })}</div>
      ${o.sans_superieur ? `<div class="bandeau-info alerte" style="margin-bottom:10px">${ico("alerte")}<span>${o.sans_superieur} collaborateur(s) sans supérieur enregistré : leurs demandes remontent à la RH.</span></div>` : ""}
      <div class="tableau-boite"><table style="min-width:640px"><thead><tr><th>Responsable</th><th>Niveau</th><th>Direction</th><th class="centre">Directs</th><th class="centre">Toute la ligne</th><th></th></tr></thead><tbody>
        ${o.detail.map((r) => `<tr><td><strong style="font-size:13px">${echapper(r.responsable.prenom + " " + r.responsable.nom)}</strong><div class="aide">${echapper(r.responsable.poste || "")}</div></td>
          <td style="font-size:12.5px">${echapper(r.responsable.niveau || "")}</td><td style="font-size:12.5px">${echapper(r.responsable.direction)}</td>
          <td class="centre num">${r.directs}</td><td class="centre num">${r.ligne}</td>
          <td>${r.alerte === "etendue_large" ? `<span class="badge attente">Étendue large</span>` : r.alerte === "une_personne" ? `<span class="badge neutre">Une personne</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="aide" style="margin-top:8px">Au-delà de ${o.seuil_etendue} collaborateurs directs, le suivi individuel (entretiens, validations) devient difficile ; un responsable d'une seule personne signale souvent un niveau hiérarchique superflu.</p>`;
  } else if (f.onglet === "decisions") {
    const x = d.decisions;
    corps = `<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      ${carteKpi({ cle: "id1", libelle: "Délai moyen de décision", valeur: indHeures(x.delai_moyen_heures), unite: "", icone: "horloge", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `médiane ${indHeures(x.delai_median_heures)} · ${x.decisions} décision(s) sur 12 mois` })}
      ${carteKpi({ cle: "id2", libelle: "Validées d'office", valeur: x.taux_automatique ?? "—", unite: x.taux_automatique == null ? "" : "%", icone: "alerte", couleur: x.taux_automatique ? "var(--alerte)" : "var(--succes)", fond: x.taux_automatique ? "var(--alerte-doux)" : "var(--succes-doux)", detail: "sans réponse du responsable" })}
      ${carteKpi({ cle: "id3", libelle: "En attente", valeur: x.en_attente, unite: "", icone: "inbox", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${x.en_attente_hors_delai} au-delà de ${x.delai_cible_heures} h` })}
      ${carteKpi({ cle: "id4", libelle: "Délai cible", valeur: `${x.delai_cible_heures} h`, unite: "", icone: "check", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: "au-delà : validation automatique" })}</div>
      ${x.detail.length ? `<div class="tableau-boite"><table style="min-width:680px"><thead><tr><th>Responsable</th><th>Direction</th><th class="centre">Décisions</th><th class="centre">Délai moyen</th><th class="centre">Au-delà de ${x.delai_cible_heures} h</th><th class="centre">Validées d'office</th><th class="centre">Refus</th></tr></thead><tbody>
        ${x.detail.map((v) => `<tr><td><strong style="font-size:13px">${echapper(v.valideur.prenom + " " + v.valideur.nom)}</strong></td><td style="font-size:12.5px">${echapper(v.valideur.direction)}</td>
          <td class="centre num">${v.decisions}</td><td class="centre"><span class="badge ${v.delai_moyen_heures > x.delai_cible_heures ? "attente" : "approuvee"}">${indHeures(v.delai_moyen_heures)}</span></td>
          <td class="centre num">${v.hors_delai || "—"}</td><td class="centre num">${v.automatiques ? `${v.automatiques} (${v.taux_automatique} %)` : "—"}</td><td class="centre num">${v.refus || "—"}</td></tr>`).join("")}</tbody></table></div>`
        : etatVide("inbox", "Aucune décision sur 12 mois", "Les délais apparaîtront avec les premières demandes décidées.")}
      <p class="aide" style="margin-top:8px">Délai mesuré entre le dépôt de la demande et la décision. Une part élevée de validations d'office signale un responsable qui ne lit pas les demandes de son équipe.</p>`;
  } else {
    const c = d.conges;
    const effectifTotal = c.par_direction.reduce((s, a) => s + a.effectif, 0);
    const valorise = (a) => a.non_valorises < a.effectif;
    corps = `<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      ${carteKpi({ cle: "ic1", libelle: "Jours non pris", valeur: fmtNombre(c.jours), unite: "j", icone: "calendrier", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `exercice ${c.annee}` })}
      ${carteKpi({ cle: "ic2", libelle: "Valeur financière", valeur: c.non_valorises < effectifTotal ? indDinars(c.valeur) : "—", unite: "", icone: "portefeuille", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: c.non_valorises < effectifTotal ? `charges comprises (${fmtNombre(c.reglages.taux_charges, 2)} %)` : "saisir les rémunérations" })}
      ${carteKpi({ cle: "ic3", libelle: "Jours perdus au 31/12", valeur: fmtNombre(c.jours_perdus_prevus), unite: "j", icone: "alerte", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: "au-delà du plafond de report" })}
      ${carteKpi({ cle: "ic4", libelle: "Non valorisés", valeur: c.non_valorises, unite: "", icone: "users", couleur: "var(--encre-3)", fond: "var(--fond-2, var(--marine-doux))", detail: "rémunération non saisie" })}</div>
      <div class="tableau-boite"><table style="min-width:620px"><thead><tr><th>Direction</th><th class="centre">Effectif</th><th class="centre">Jours non pris</th><th class="centre">Valeur</th><th class="centre">Perdus au 31/12</th><th class="centre">Non valorisés</th></tr></thead><tbody>
        ${c.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.effectif}</td><td class="centre num">${fmtNombre(a.jours)}</td>
          <td class="centre num">${valorise(a) ? indDinars(a.valeur) : "—"}</td><td class="centre num">${a.jours_perdus_prevus || "—"}</td><td class="centre num">${a.non_valorises || "—"}</td></tr>`).join("")}</tbody></table></div>
      ${c.collaborateurs ? `<h3 style="margin:16px 0 8px;font-size:14px">${ico("bouclier")} Soldes les plus élevés (RH uniquement)</h3>
        <div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Direction</th><th class="centre">Jours</th><th class="centre">Valeur</th><th class="centre">Perdus au 31/12</th></tr></thead><tbody>
          ${c.collaborateurs.map((l) => `<tr><td><strong style="font-size:13px">${echapper(l.employe.prenom + " " + l.employe.nom)}</strong></td><td style="font-size:12.5px">${echapper(l.employe.direction)}</td>
            <td class="centre num">${fmtNombre(l.jours)}</td><td class="centre num">${indDinars(l.valeur)}</td><td class="centre num">${l.perdu_prevu || "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="aide" style="margin-top:8px">Valeur = jours restants × coût d'une journée (salaire mensuel et primes fixes, charges patronales comprises, ÷ ${c.reglages.jours_par_mois} jours). Les collaborateurs sans rémunération saisie ne sont pas valorisés.</p>`;
  }
  return `<section class="carte">${entete}${corps}</section>`;
};

BRANCHEMENTS["/indicateurs"] = function () {
  const f = etat.filtres.indicateurs;
  if (!f) return;
  $$("[data-ind-onglet]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.indOnglet; rendre(false); }));
};

TITRES["/indicateurs"] = "Indicateurs clés";
const menuAvantIndicateurs = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantIndicateurs();
  if (!(estAdmin() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/indicateurs")) pilotage.items.splice(1, 0, { route: "/indicateurs", libelle: "Indicateurs clés", icone: "tableau" });
  return groupes;
};
const naviguerAvantIndicateurs = naviguer;
naviguer = function (route) { if (route === "/indicateurs") etat.indicateursCles = null; return naviguerAvantIndicateurs(route); };
const deconnexionAvantIndicateurs = deconnexion;
deconnexion = function (...args) { delete etat.filtres.indicateurs; etat.indicateursCles = null; return deconnexionAvantIndicateurs(...args); };
