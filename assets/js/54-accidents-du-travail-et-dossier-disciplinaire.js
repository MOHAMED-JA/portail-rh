/* ==========================================================================
   54. ACCIDENTS DU TRAVAIL ET DOSSIER DISCIPLINAIRE
   ========================================================================== */
const STATUTS_AT = { declare: ["attente", "À transmettre"], transmis: ["info", "Transmis CNAM"], clos: ["approuvee", "Clos"] };
const STATUTS_DISC = { instruction: ["attente", "En instruction"], notifiee: ["rejetee", "Notifiée"], annulee: ["annulee", "Annulée"] };
const TYPES_AT = { travail: "Accident du travail", trajet: "Accident de trajet", maladie_professionnelle: "Maladie professionnelle" };
const TYPES_SUIVI_AT = { certificat_initial: "Certificat médical initial", prolongation: "Prolongation d'arrêt", visite_reprise: "Visite de reprise", consolidation: "Consolidation / guérison", autre: "Autre" };
const TYPES_SANCTION = { avertissement: "Avertissement", blame: "Blâme", mise_a_pied: "Mise à pied", mutation_disciplinaire: "Mutation disciplinaire", retrogradation: "Rétrogradation", licenciement: "Licenciement", autre: "Autre mesure" };
const listeMatricules = (id) => `<datalist id="${id}">${EMPLOYES.map((x) => `<option value="${x.matricule}">${echapper(nomComplet(x))}</option>`).join("")}</datalist>`;

/* --- Accidents du travail --------------------------------------------------- */
VUES["/sante-travail"] = function () {
  if (!connecte()) return reserveServeur("Le suivi des accidents du travail");
  const rh = estAdmin(), direction = rh || estDirection();
  const d = chargerEtat("accidents", () => Promise.all([API.appel("/api/sante-travail/accidents"),
    direction ? API.appel("/api/sante-travail/statistiques") : Promise.resolve(null)]).then(([liste, stats]) => ({ liste, stats })));
  if (!d) return squelette(260);
  if (d.erreur) return `<section class="carte">${etatVide("alerte", "Indisponible", echapper(d.erreur))}</section>`;
  const s = d.stats;
  return `${s ? `<section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      ${carteKpi({ cle: "at1", libelle: `Accidents ${s.annee}`, valeur: s.accidents, unite: "", icone: "alerte", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: `${s.avec_arret} avec arrêt · ${s.jours_arret} jour(s) d'arrêt` })}
      ${carteKpi({ cle: "at2", libelle: "Taux de fréquence", valeur: s.taux_frequence == null ? "—" : fmtNombre(s.taux_frequence, 2), unite: "", icone: "rapport", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: s.taux_frequence == null ? "pointages insuffisants (moins de 1 000 h)" : "accidents avec arrêt par million d'heures pointées" })}
      ${carteKpi({ cle: "at3", libelle: "Taux de gravité", valeur: s.taux_gravite == null ? "—" : fmtNombre(s.taux_gravite, 2), unite: "", icone: "horloge", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: s.taux_gravite == null ? "pointages insuffisants (moins de 1 000 h)" : "jours perdus par millier d'heures pointées" })}
      ${carteKpi({ cle: "at4", libelle: "À transmettre en retard", valeur: s.en_retard, unite: "", icone: "bouclier", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `délai : ${s.delai_declaration} jour(s) ouvrable(s)` })}
    </section>` : ""}
    <section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Accidents du travail</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Déclarez sans attendre tout accident du travail ou de trajet. Les informations médicales ne sont visibles que par la RH et l'intéressé.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${estAdmin() && !estGestionnaire() ? `<button class="btn petit fantome" id="at-delai">Délai de transmission</button>` : ""}
      <button class="btn primaire" id="at-declarer">${ico("plus")} Déclarer un accident</button></div></div>
    ${d.liste.length ? `<div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Date</th><th>Collaborateur</th><th>Nature</th><th>Arrêt</th><th>Statut</th><th></th></tr></thead><tbody>
      ${d.liste.map((a) => { const [c, l] = STATUTS_AT[a.statut]; return `<tr><td class="mono">${fmtDate(a.date_accident)}</td>
        <td><strong style="font-size:13px">${echapper(a.employe.prenom + " " + a.employe.nom)}</strong></td><td>${echapper(a.type_libelle)}</td>
        <td>${a.arret ? `${a.jours_arret} j${a.fin_arret ? ` · jusqu'au ${fmtDate(a.fin_arret)}` : ""}` : "Sans arrêt"}</td>
        <td><span class="badge ${c}">${l}</span>${a.en_retard ? ` <span class="badge rejetee">${ico("alerte")} délai dépassé</span>` : ""}</td>
        <td class="droite"><button class="btn petit" data-voir-at="${a.id}">Ouvrir</button></td></tr>`; }).join("")}</tbody></table></div>`
      : etatVide("check", "Aucun accident déclaré", "Les déclarations de votre périmètre apparaîtront ici.")}</section>`;
};

async function ouvrirAccident(id) {
  let a;
  try { a = await API.appel(`/api/sante-travail/accidents/${id}`); } catch (souci) { return toast("Indisponible", souci.message, "danger"); }
  const rh = estAdmin();
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(760px,100%)">
    ${enteteTiroir(`${echapper(a.type_libelle)} — ${echapper(a.employe.prenom + " " + a.employe.nom)}`, `Le ${fmtDateLongue(a.date_accident)}${a.heure ? ` à ${a.heure}` : ""}${a.lieu ? ` · ${echapper(a.lieu)}` : ""}`)}
    <div class="tiroir-corps" style="display:flex;flex-direction:column;gap:12px">
      <div class="sirh-section"><h4>Faits</h4><p style="font-size:13px;white-space:pre-line">${echapper(a.circonstances || "—")}</p>
        ${a.temoins ? `<p style="font-size:12.5px"><strong>Témoins :</strong> ${echapper(a.temoins)}</p>` : ""}
        <span class="aide">Déclaré le ${fmtDate(String(a.declare_le).slice(0, 10))} par ${echapper(a.declare_par || "—")} · à transmettre au plus tard le ${fmtDate(a.echeance_transmission)}${a.reference_cnam ? ` · transmis (${echapper(a.reference_cnam)}) le ${fmtDate(a.transmis_le)}` : ""}</span></div>
      <div class="sirh-section"><h4>Arrêt de travail</h4><p style="font-size:13px">${a.arret ? `Du ${fmtDate(a.debut_arret)}${a.fin_arret ? ` au ${fmtDate(a.fin_arret)}` : ""} — ${a.jours_arret} jour(s)` : "Sans arrêt"}${a.date_reprise ? ` · reprise le ${fmtDate(a.date_reprise)}` : ""}</p></div>
      ${a.acces === "complet" ? `<div class="sirh-section"><h4>${ico("bouclier")} Informations médicales (RH et intéressé)</h4>
        <p style="font-size:13px"><strong>Lésions :</strong> ${echapper(a.lesions || "—")}</p>
        ${a.suivis.map((s) => `<div style="font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--trait)"><strong>${fmtDate(s.date)} — ${echapper(s.type_libelle)}</strong>${s.jours_arret ? ` · ${s.jours_arret} j` : ""}
          ${s.commentaire ? `<div>${echapper(s.commentaire)}</div>` : ""}${s.piece_jointe ? ` <a href="${lienFichier(s.piece_jointe)}" target="_blank" rel="noopener">${ico("doc")} pièce</a>` : ""}
          ${rh && !s.piece_jointe ? `<label class="btn petit fantome" style="cursor:pointer">${ico("import")} Joindre<input type="file" accept=".pdf,.doc,.docx" data-piece-suivi="${s.id}" hidden></label>` : ""}</div>`).join("") || `<span class="aide">Aucun élément de suivi.</span>`}</div>` : ""}
      ${rh && a.statut !== "clos" ? `<div class="sirh-section"><h4>Actions RH</h4>
        ${a.statut === "declare" ? `<div class="ligne-champs"><input class="saisie" id="at-ref" placeholder="Référence CNAM"><button class="btn petit primaire" id="at-transmettre">Transmis à la CNAM</button></div>` : ""}
        <div class="ligne-champs" style="flex-wrap:wrap"><input class="saisie" type="date" id="at-s-date" value="${iso(AUJOURDHUI)}" style="max-width:160px">
          <select class="saisie" id="at-s-type" style="max-width:220px">${Object.entries(TYPES_SUIVI_AT).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          <input class="saisie num" type="number" min="0" id="at-s-jours" placeholder="Jours d'arrêt" style="max-width:120px">
          <input class="saisie" id="at-s-com" placeholder="Commentaire"><button class="btn petit" id="at-suivi">${ico("plus")} Suivi</button></div>
        <div class="ligne-champs"><input class="saisie" type="date" id="at-reprise" style="max-width:170px"><button class="btn petit succes" id="at-cloturer">${ico("check")} Reprise : clore le dossier</button></div></div>` : ""}
    </div></aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  const action = async (chemin, corps, message) => {
    try { await API.appel(chemin, { methode: "POST", corps }); toast(message, "", "succes"); etat.accidents = null; ouvrirAccident(id); rendre(false); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  };
  $("#at-transmettre")?.addEventListener("click", () => action(`/api/sante-travail/accidents/${id}/transmettre`, { reference_cnam: $("#at-ref").value.trim() }, "Transmission enregistrée"));
  $("#at-suivi")?.addEventListener("click", () => action(`/api/sante-travail/accidents/${id}/suivi`, { date_suivi: $("#at-s-date").value, type_suivi: $("#at-s-type").value,
    jours_arret: $("#at-s-jours").value ? Number($("#at-s-jours").value) : null, commentaire: $("#at-s-com").value.trim() || null }, "Suivi ajouté"));
  $("#at-cloturer")?.addEventListener("click", () => action(`/api/sante-travail/accidents/${id}/cloturer`, { date_reprise: $("#at-reprise").value }, "Dossier clos"));
  $$("[data-piece-suivi]").forEach((c) => c.addEventListener("change", async () => {
    try { await televerser(`/api/sante-travail/suivis/${c.dataset.pieceSuivi}/piece`, c.files[0]); toast("Pièce jointe", "", "succes"); ouvrirAccident(id); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
}

function ouvrirDeclarationAccident() {
  const pourAutrui = estValideur() || estAdmin();
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(640px,100%)">
    ${enteteTiroir("Déclarer un accident", "La RH est prévenue immédiatement")}
    <div class="tiroir-corps">
      ${pourAutrui ? `<div class="champ"><label>Collaborateur concerné</label><input class="saisie" id="da-matricule" list="da-liste" value="${moi().matricule}">${listeMatricules("da-liste")}</div>` : ""}
      <div class="ligne-champs"><div class="champ"><label>Nature</label><select class="saisie" id="da-type">${Object.entries(TYPES_AT).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div class="champ"><label>Date</label><input class="saisie" type="date" id="da-date" value="${iso(AUJOURDHUI)}" max="${iso(AUJOURDHUI)}"></div>
        <div class="champ" style="max-width:120px"><label>Heure</label><input class="saisie" type="time" id="da-heure"></div></div>
      <div class="champ"><label>Lieu</label><input class="saisie" id="da-lieu"></div>
      <div class="champ"><label>Circonstances</label><textarea class="saisie" id="da-circ" style="min-height:80px"></textarea></div>
      <div class="champ"><label>Témoins</label><input class="saisie" id="da-temoins"></div>
      <div class="champ"><label>Lésions constatées</label><input class="saisie" id="da-lesions"><span class="aide">${ico("bouclier")} Information médicale : visible uniquement par la RH et l'intéressé.</span></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="da-arret" style="width:16px;height:16px"> Arrêt de travail</label>
      <div class="champ" id="da-zone-arret" hidden><label>Début de l'arrêt</label><input class="saisie" type="date" id="da-debut" value="${iso(AUJOURDHUI)}"></div>
    </div>
    <div class="tiroir-pied"><button class="btn" id="da-annuler">Annuler</button><button class="btn primaire" id="da-ok">${ico("fleche")} Déclarer</button></div></aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#da-annuler").addEventListener("click", fermerCouche);
  $("#da-arret").addEventListener("change", (e) => { $("#da-zone-arret").hidden = !e.target.checked; });
  $("#da-ok").addEventListener("click", async () => {
    const corps = { matricule: $("#da-matricule") ? $("#da-matricule").value.trim().toUpperCase() : null, type_accident: $("#da-type").value,
      date_accident: $("#da-date").value, heure: $("#da-heure").value || null, lieu: $("#da-lieu").value.trim() || null,
      circonstances: $("#da-circ").value.trim(), temoins: $("#da-temoins").value.trim() || null, lesions: $("#da-lesions").value.trim() || null,
      arret: $("#da-arret").checked, debut_arret: $("#da-arret").checked ? $("#da-debut").value : null };
    try { await API.appel("/api/sante-travail/accidents", { methode: "POST", corps }); fermerCouche();
      toast("Accident déclaré", "La RH est notifiée.", "succes"); etat.accidents = null; rendre(false); }
    catch (souci) { toast("Déclaration refusée", souci.message, "danger"); }
  });
}

BRANCHEMENTS["/sante-travail"] = function () {
  $("#at-declarer")?.addEventListener("click", ouvrirDeclarationAccident);
  $$("[data-voir-at]").forEach((b) => b.addEventListener("click", () => ouvrirAccident(b.dataset.voirAt)));
  $("#at-delai")?.addEventListener("click", async () => {
    const n = prompt("Délai de transmission de la déclaration à la CNAM (jours ouvrables) :", String(etat.accidents?.stats?.delai_declaration || 2));
    if (!n) return;
    try { await API.appel("/api/sante-travail/delai", { methode: "PUT", corps: { jours_ouvrables: Number(n) } }); etat.accidents = null; rendre(false); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  });
};

/* --- Dossier disciplinaire (RH) ------------------------------------------------ */
VUES["/discipline"] = function () {
  if (!connecte()) return reserveServeur("Le dossier disciplinaire");
  if (!estAdmin()) return `<section class="carte">${etatVide("bouclier", "Réservé à la RH", "Le dossier disciplinaire n'est accessible qu'à l'administration RH.")}</section>`;
  const f = etat.filtres.discipline || (etat.filtres.discipline = { recherche: "" });
  const liste = chargerEtat("discipline", () => API.appel("/api/discipline"));
  if (!liste) return squelette(240);
  if (liste.erreur) return `<section class="carte">${etatVide("bouclier", "Indisponible", echapper(liste.erreur))}</section>`;
  const q = f.recherche.toLowerCase();
  const lignes = liste.filter((s) => !q || `${s.employe.prenom} ${s.employe.nom} ${s.employe.matricule}`.toLowerCase().includes(q));
  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Dossier disciplinaire</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">${ico("bouclier")} Confidentiel — RH uniquement ; les faits et observations sont chiffrés. L'intéressé retrouve les mesures notifiées dans « Mes données ».</p></div>
      <div style="display:flex;gap:8px"><input class="saisie" id="disc-recherche" placeholder="Nom ou matricule" value="${echapper(f.recherche)}" style="max-width:200px">
      <button class="btn primaire" id="disc-ouvrir">${ico("plus")} Ouvrir une procédure</button></div></div>
    ${lignes.length ? `<div style="display:flex;flex-direction:column;gap:10px">${lignes.map((s) => { const [c, l] = STATUTS_DISC[s.statut]; return `<article class="sirh-section">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${echapper(s.type_libelle)}${s.jours_mise_a_pied ? ` (${s.jours_mise_a_pied} j)` : ""} — ${echapper(s.employe.prenom + " " + s.employe.nom)}</strong>
        <div style="font-size:11.5px;color:var(--encre-3)">Faits du ${fmtDate(s.date_faits)}${s.date_entretien ? ` · entretien le ${fmtDate(s.date_entretien)}` : ""}${s.date_notification ? ` · notifiée le ${fmtDate(s.date_notification)}` : ""}${s.reference ? ` · réf. ${echapper(s.reference)}` : ""}</div></div>
        <span class="badge ${c}">${l}</span></div>
      <p style="font-size:13px;white-space:pre-line">${echapper(s.faits)}</p>
      ${s.observations ? `<p style="font-size:12.5px;color:var(--encre-2);white-space:pre-line">${echapper(s.observations)}</p>` : ""}
      <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
        ${s.piece_jointe ? `<a class="btn petit fantome" href="${lienFichier(s.piece_jointe)}" target="_blank" rel="noopener">${ico("doc")} Pièce</a>`
          : `<label class="btn petit fantome" style="cursor:pointer">${ico("import")} Joindre<input type="file" accept=".pdf,.doc,.docx" data-piece-disc="${s.id}" hidden></label>`}
        ${s.statut === "instruction" ? `<button class="btn petit" data-notifier-disc="${s.id}">Enregistrer la notification</button>` : ""}
        ${s.statut !== "annulee" ? `<button class="btn petit fantome" data-annuler-disc="${s.id}">Annuler</button>` : ""}</div></article>`; }).join("")}</div>`
      : etatVide("check", "Aucune procédure", "Aucune procédure disciplinaire enregistrée.")}</section>`;
};

BRANCHEMENTS["/discipline"] = function () {
  const f = etat.filtres.discipline;
  if (!f) return;
  const recharger = () => { etat.discipline = null; rendre(false); };
  const r = $("#disc-recherche");
  r?.addEventListener("input", debounce(() => { f.recherche = r.value; rendre(false); const c = $("#disc-recherche"); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }, 250));
  $("#disc-ouvrir")?.addEventListener("click", () => {
    ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(620px,100%)">${enteteTiroir("Ouvrir une procédure", "Confidentiel — RH")}
      <div class="tiroir-corps"><div class="champ"><label>Collaborateur</label><input class="saisie" id="ds-mat" list="ds-liste">${listeMatricules("ds-liste")}</div>
        <div class="ligne-champs"><div class="champ"><label>Mesure envisagée</label><select class="saisie" id="ds-type">${Object.entries(TYPES_SANCTION).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
          <div class="champ" style="max-width:140px" id="ds-zone-jours" hidden><label>Jours</label><input class="saisie num" type="number" min="1" id="ds-jours"></div></div>
        <div class="ligne-champs"><div class="champ"><label>Date des faits</label><input class="saisie" type="date" id="ds-date" max="${iso(AUJOURDHUI)}"></div>
          <div class="champ"><label>Entretien préalable</label><input class="saisie" type="date" id="ds-entretien"></div></div>
        <div class="champ"><label>Faits reprochés</label><textarea class="saisie" id="ds-faits" style="min-height:110px"></textarea></div>
        <div class="champ"><label>Référence</label><input class="saisie" id="ds-ref"></div>
        <div class="champ"><label>Observations</label><textarea class="saisie" id="ds-obs"></textarea></div>
        <span class="aide">Catégories de mesures à aligner sur le règlement intérieur et la convention collective.</span></div>
      <div class="tiroir-pied"><button class="btn" id="ds-annuler">Annuler</button><button class="btn primaire" id="ds-ok">${ico("check")} Enregistrer</button></div></aside>`, { tiroir: true });
    $("#fermer-tiroir").addEventListener("click", fermerCouche); $("#ds-annuler").addEventListener("click", fermerCouche);
    $("#ds-type").addEventListener("change", (e) => { $("#ds-zone-jours").hidden = e.target.value !== "mise_a_pied"; });
    $("#ds-ok").addEventListener("click", async () => {
      const corps = { matricule: $("#ds-mat").value.trim().toUpperCase(), type_sanction: $("#ds-type").value, date_faits: $("#ds-date").value,
        faits: $("#ds-faits").value.trim(), date_entretien: $("#ds-entretien").value || null, jours_mise_a_pied: $("#ds-jours").value ? Number($("#ds-jours").value) : null,
        reference: $("#ds-ref").value.trim() || null, observations: $("#ds-obs").value.trim() || null };
      try { await API.appel("/api/discipline", { methode: "POST", corps }); fermerCouche(); toast("Procédure enregistrée", "", "succes"); recharger(); }
      catch (souci) { toast("Refusé", souci.message, "danger"); }
    });
  });
  $$("[data-notifier-disc]").forEach((b) => b.addEventListener("click", async () => {
    const j = prompt("Date de notification (AAAA-MM-JJ) :", iso(AUJOURDHUI)); if (!j) return;
    try { await API.appel(`/api/discipline/${b.dataset.notifierDisc}/notifier`, { methode: "POST", corps: { date_notification: j } }); recharger(); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
  $$("[data-annuler-disc]").forEach((b) => b.addEventListener("click", async () => {
    const motif = prompt("Motif de l'annulation :"); if (!motif) return;
    try { await API.appel(`/api/discipline/${b.dataset.annulerDisc}/annuler`, { methode: "POST", corps: { motif } }); recharger(); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
  $$("[data-piece-disc]").forEach((c) => c.addEventListener("change", async () => {
    try { await televerser(`/api/discipline/${c.dataset.pieceDisc}/piece`, c.files[0]); recharger(); } catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
};

TITRES["/sante-travail"] = "Accidents du travail";
TITRES["/discipline"] = "Dossier disciplinaire";
const menuAvantSante = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantSante();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/sante-travail")) perso.items.push({ route: "/sante-travail", libelle: "Accidents du travail", icone: "alerte" });
  const pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (pilotage && estAdmin() && !pilotage.items.some((i) => i.route === "/discipline")) {
    const i = pilotage.items.findIndex((x) => x.route === "/administration");
    pilotage.items.splice(i >= 0 ? i + 1 : pilotage.items.length, 0, { route: "/discipline", libelle: "Disciplinaire", icone: "bouclier" });
  }
  return groupes;
};
const naviguerAvantSante = naviguer;
naviguer = function (route) {
  if (route === "/sante-travail") etat.accidents = null;
  if (route === "/discipline") etat.discipline = null;
  return naviguerAvantSante(route);
};
const deconnexionAvantSante = deconnexion;
deconnexion = function (...args) { etat.accidents = null; etat.discipline = null; delete etat.filtres.discipline; return deconnexionAvantSante(...args); };
