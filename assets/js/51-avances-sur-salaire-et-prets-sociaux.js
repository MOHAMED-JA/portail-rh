/* ==========================================================================
   51. AVANCES SUR SALAIRE ET PRÊTS SOCIAUX
   Demande du collaborateur, décision RH, échéancier → export paie.
   Confidentiel : intéressé et RH uniquement.
   ========================================================================== */
const STATUTS_PRET = { demande: ["attente", "En attente"], accorde: ["info", "En remboursement"], refuse: ["rejetee", "Refusé"],
  solde: ["approuvee", "Remboursé"], annule: ["annulee", "Annulé"] };
const dt = (v) => `${fmtNombre(v, 3)} DT`;
const moisLisible = (iso) => new Date(`${String(iso).slice(0, 7)}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function tableauEcheances(p) {
  return `<div class="tableau-boite" style="max-height:260px;overflow:auto"><table style="min-width:420px"><thead><tr><th>N°</th><th>Mois</th><th class="droite">Capital</th><th class="droite">Intérêts</th><th class="droite">Retenue</th><th></th></tr></thead><tbody>
    ${p.echeances.map((e) => `<tr style="${e.statut !== "prevue" ? "opacity:.55;text-decoration:line-through" : ""}"><td class="num">${e.numero}</td><td>${moisLisible(e.mois)}</td>
      <td class="droite num">${fmtNombre(e.capital, 3)}</td><td class="droite num">${fmtNombre(e.interets, 3)}</td><td class="droite num"><strong>${fmtNombre(e.montant, 3)}</strong></td>
      <td>${e.statut === "reportee" ? `<span class="badge attente">Reportée</span>` : e.statut === "annulee" ? `<span class="badge annulee">Annulée</span>`
        : e.passee ? `<span class="badge approuvee">Retenue</span>` : estAdmin() && p.statut === "accorde" && p.employe.matricule !== moi().matricule
        ? `<button class="btn petit fantome" data-reporter="${p.id}:${e.numero}">Reporter</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function cartePret(p, rh) {
  const [c, l] = STATUTS_PRET[p.statut] || ["neutre", p.statut];
  return `<article class="carte" style="box-shadow:none;border:1px solid var(--trait)">
    <div class="carte-entete" style="flex-wrap:wrap;gap:8px"><div><h3>${echapper(p.libelle)} — ${dt(p.montant)}</h3>
      <span class="carte-sous">${rh ? `${echapper(p.employe.prenom + " " + p.employe.nom)} · ` : ""}${p.nb_mensualites} mensualité(s)${p.taux_annuel ? ` · ${fmtNombre(p.taux_annuel, 2)} %/an` : " · sans intérêts"} · demandé le ${fmtDate(String(p.demande_le).slice(0, 10))}</span></div>
      <span class="badge ${c}">${l}</span></div>
    ${p.motif ? `<p style="font-size:12.5px;color:var(--encre-2);margin-bottom:8px">« ${echapper(p.motif)} »</p>` : ""}
    ${p.commentaire_rh ? `<p style="font-size:12.5px;margin-bottom:8px"><strong>RH :</strong> ${echapper(p.commentaire_rh)}</p>` : ""}
    ${p.echeances.length ? `<div class="grille" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        ${[["Mensualité", dt(p.mensualite || 0)], ["Déjà retenu", dt(p.rembourse)], ["Reste dû", dt(p.reste_du)]].map(([k, v]) =>
          `<div class="sirh-section" style="padding:8px"><h4>${k}</h4><strong>${v}</strong></div>`).join("")}</div>
      <details><summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--marine)">Échéancier (${p.echeances.length} ligne(s))</summary>${tableauEcheances(p)}</details>` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
      ${!rh && p.statut === "demande" ? `<button class="btn petit fantome" data-annuler-pret="${p.id}">Annuler ma demande</button>` : ""}
      ${rh && p.statut === "demande" && p.employe.matricule !== moi().matricule ? `<button class="btn petit danger" data-decision-pret="${p.id}" data-accord="0">${ico("croix")} Refuser</button>
        <button class="btn petit succes" data-decision-pret="${p.id}" data-accord="1">${ico("check")} Accorder</button>` : ""}
      ${rh && p.statut === "accorde" ? `<button class="btn petit fantome" data-solder="${p.id}">Remboursement anticipé</button>` : ""}
    </div></article>`;
}

VUES["/prets"] = function () {
  if (!connecte()) return reserveServeur("Les avances et prêts");
  const f = etat.filtres.prets || (etat.filtres.prets = { onglet: estAdmin() ? "traiter" : "mes", type: "avance", montant: "", mensualites: "" });
  const d = chargerEtat("pretsDonnees", () => Promise.all([
    API.appel("/api/prets/types"), API.appel("/api/prets/mes"), estAdmin() ? API.appel("/api/prets") : Promise.resolve([]),
  ]).then(([types, mes, tous]) => ({ types, mes, tous })));
  if (!d) return squelette(300);
  if (d.erreur) return `<section class="carte">${etatVide("portefeuille", "Indisponible", echapper(d.erreur))}</section>`;
  const actifs = Object.entries(d.types).filter(([, t]) => t.actif);
  if (!d.types[f.type] || !d.types[f.type].actif) f.type = actifs.length ? actifs[0][0] : f.type;
  const t = d.types[f.type] || {};
  const onglets = estAdmin() ? [["traiter", `À traiter (${d.tous.filter((p) => p.statut === "demande").length})`], ["tous", "Tous les prêts"], ["mes", "Mes demandes"], ...(estGestionnaire() ? [] : [["parametres", "Plafonds et taux"]])] : [];
  let corps = "";
  if (f.onglet === "mes") {
    corps = `<div class="grille" style="grid-template-columns:minmax(280px,380px) 1fr;gap:16px;align-items:start">
      <section class="sirh-section"><h4>Nouvelle demande</h4>
        <div class="champ"><label for="pr-type">Type</label><select class="saisie" id="pr-type">${actifs.map(([k, x]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${echapper(x.libelle)}</option>`).join("")}</select>
          <span class="aide">Plafond ${fmtNombre(t.plafond, 0)} DT · ${t.mensualites_max} mensualité(s) au plus · ${t.taux ? `${fmtNombre(t.taux, 2)} % par an` : "sans intérêts"}</span></div>
        <div class="ligne-champs"><div class="champ"><label for="pr-montant">Montant (DT)</label><input class="saisie num" type="number" min="1" step="0.001" max="${t.plafond}" id="pr-montant" value="${f.montant}"></div>
          <div class="champ"><label for="pr-mensualites">Mensualités</label><input class="saisie num" type="number" min="1" max="${t.mensualites_max}" id="pr-mensualites" value="${f.mensualites}"></div></div>
        <div id="pr-simulation" class="aide" style="min-height:18px"></div>
        <div class="champ"><label for="pr-motif">Motif</label><textarea class="saisie" id="pr-motif" style="min-height:60px" placeholder="Rentrée scolaire, frais médicaux, logement…"></textarea></div>
        <button class="btn primaire" id="pr-demander">${ico("fleche")} Envoyer la demande à la RH</button>
        <span class="aide">${ico("bouclier")} Confidentiel : seule la RH voit votre demande. Les retenues sont prélevées sur salaire chaque mois.</span></section>
      <div style="display:flex;flex-direction:column;gap:12px">${d.mes.length ? d.mes.map((p) => cartePret(p, false)).join("") : etatVide("portefeuille", "Aucune demande", "Vos avances et prêts apparaîtront ici avec leur échéancier.")}</div></div>`;
  } else if (f.onglet === "parametres") {
    corps = `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Type</th><th>Plafond (DT)</th><th>Mensualités max.</th><th>Taux annuel (%)</th><th>Proposé</th></tr></thead><tbody>
      ${Object.entries(d.types).map(([k, x]) => `<tr><td><strong>${echapper(x.libelle)}</strong></td>
        <td><input class="saisie num" type="number" min="1" data-pp="${k}:plafond" value="${x.plafond}" style="width:120px"></td>
        <td><input class="saisie num" type="number" min="1" max="120" data-pp="${k}:mensualites_max" value="${x.mensualites_max}" style="width:90px"></td>
        <td><input class="saisie num" type="number" min="0" max="30" step="0.01" data-pp="${k}:taux" value="${x.taux}" style="width:90px"></td>
        <td><input type="checkbox" data-pp="${k}:actif" ${x.actif ? "checked" : ""} style="width:17px;height:17px"></td></tr>`).join("")}</tbody></table></div>
      <button class="btn primaire" id="pr-enregistrer-types" style="margin-top:10px">${ico("check")} Enregistrer</button>
      <p class="aide" style="margin-top:6px">Valeurs par défaut à ajuster selon la politique de Veltaris. Un changement ne modifie pas les prêts déjà accordés.</p>`;
  } else {
    const liste = f.onglet === "traiter" ? d.tous.filter((p) => p.statut === "demande") : d.tous;
    const encours = d.tous.filter((p) => p.statut === "accorde");
    corps = `<section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:12px">
        ${carteKpi({ cle: "pr1", libelle: "Demandes à traiter", valeur: d.tous.filter((p) => p.statut === "demande").length, unite: "", icone: "inbox", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "avances et prêts sociaux" })}
        ${carteKpi({ cle: "pr2", libelle: "Prêts en cours", valeur: encours.length, unite: "", icone: "portefeuille", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${dt(encours.reduce((s, p) => s + p.reste_du, 0))} restant dû` })}
        ${carteKpi({ cle: "pr3", libelle: "Retenues du mois prochain", valeur: fmtNombre(encours.reduce((s, p) => s + (p.echeances.find((e) => e.statut === "prevue" && !e.passee) || {}).montant || 0, 0), 3), unite: "DT", icone: "calendrier", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "reprises dans l'export paie" })}
      </section>
      <div style="display:flex;flex-direction:column;gap:12px">${liste.length ? liste.map((p) => cartePret(p, true)).join("") : etatVide("check", "Rien à traiter", "Aucune demande en attente.")}</div>`;
  }
  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Avances et prêts</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Avance sur salaire ou prêt social — retenues mensuelles sur salaire.</p></div>
      ${onglets.length ? `<div class="segment" id="onglets-prets">${onglets.map(([k, l]) => `<button data-onglet-pret="${k}" class="${f.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>` : ""}</div>
    ${corps}</section>`;
};

BRANCHEMENTS["/prets"] = function () {
  const f = etat.filtres.prets;
  if (!f) return;
  const recharger = () => { etat.pretsDonnees = null; rendre(false); };
  $$("[data-onglet-pret]").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.ongletPret; rendre(false); }));
  const type = $("#pr-type");
  if (type) {
    type.addEventListener("change", () => { f.type = type.value; rendre(false); });
    const simuler = debounce(async () => {
      f.montant = $("#pr-montant").value; f.mensualites = $("#pr-mensualites").value;
      const m = Number(f.montant), n = Number(f.mensualites), zone = $("#pr-simulation");
      if (!zone) return;
      if (!(m > 0 && n > 0)) { zone.textContent = ""; return; }
      try {
        const s = await API.appel(`/api/prets/simulation?type_pret=${f.type}&montant=${m}&nb_mensualites=${n}`);
        zone.innerHTML = `Retenue mensuelle : <strong>${dt(s.mensualite)}</strong>${s.interets ? ` · intérêts ${dt(s.interets)} · total ${dt(s.total)}` : ""} · à partir de ${moisLisible(s.echeances[0].mois)}`;
      } catch { zone.textContent = ""; }
    }, 300);
    $("#pr-montant").addEventListener("input", simuler);
    $("#pr-mensualites").addEventListener("input", simuler);
    simuler();
    $("#pr-demander").addEventListener("click", async () => {
      try {
        await API.appel("/api/prets", { methode: "POST", corps: { type_pret: f.type, montant: Number($("#pr-montant").value),
          nb_mensualites: Number($("#pr-mensualites").value), motif: $("#pr-motif").value.trim() || null } });
        f.montant = f.mensualites = "";
        toast("Demande envoyée", "La RH est notifiée ; vous serez prévenu(e) de sa décision.", "succes"); recharger();
      } catch (souci) { toast("Demande refusée", souci.message, "danger"); }
    });
  }
  $$("[data-annuler-pret]").forEach((b) => b.addEventListener("click", async () => {
    await API.appel(`/api/prets/${b.dataset.annulerPret}/annuler`, { methode: "POST" }); recharger();
  }));
  $$("[data-decision-pret]").forEach((b) => b.addEventListener("click", () => {
    const p = [...etat.pretsDonnees.tous].find((x) => x.id === Number(b.dataset.decisionPret));
    const accorde = b.dataset.accord === "1";
    ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><div><h2>${accorde ? "Accorder" : "Refuser"} — ${echapper(p.libelle)}</h2>
        <div class="sous">${echapper(p.employe.prenom + " " + p.employe.nom)} · ${dt(p.montant)} sur ${p.nb_mensualites} mois</div></div></div>
      <div class="modale-corps">${accorde ? `<div class="ligne-champs"><div class="champ"><label>Montant accordé (DT)</label><input class="saisie num" type="number" step="0.001" id="dp-montant" value="${p.montant}"></div>
          <div class="champ"><label>Mensualités</label><input class="saisie num" type="number" id="dp-n" value="${p.nb_mensualites}"></div></div>
        <div class="champ"><label>Première retenue</label><input class="saisie" type="month" id="dp-mois" value="${iso(new Date(AUJOURDHUI.getFullYear(), AUJOURDHUI.getMonth() + 1, 1)).slice(0, 7)}"></div>` : ""}
        <div class="champ"><label>${accorde ? "Commentaire (facultatif)" : "Motif du refus"}</label><textarea class="saisie" id="dp-commentaire"></textarea></div></div>
      <div class="modale-pied"><button class="btn" id="dp-annuler">Annuler</button><button class="btn primaire" id="dp-ok">${ico("check")} Confirmer</button></div></div>`);
    $("#dp-annuler").addEventListener("click", fermerCouche);
    $("#dp-ok").addEventListener("click", async () => {
      const corps = { accorde, commentaire: $("#dp-commentaire").value.trim() || null };
      if (accorde) Object.assign(corps, { montant: Number($("#dp-montant").value), nb_mensualites: Number($("#dp-n").value), premiere_echeance: `${$("#dp-mois").value}-01` });
      try { await API.appel(`/api/prets/${p.id}/decision`, { methode: "POST", corps }); fermerCouche(); toast(accorde ? "Accordé" : "Refusé", "Le collaborateur est notifié.", "succes"); recharger(); }
      catch (souci) { toast("Décision refusée", souci.message, "danger"); }
    });
  }));
  $$("[data-reporter]").forEach((b) => b.addEventListener("click", async () => {
    const [id, numero] = b.dataset.reporter.split(":");
    if (!confirm("Reporter cette retenue en fin d'échéancier ?")) return;
    try { await API.appel(`/api/prets/${id}/reporter/${numero}`, { methode: "POST" }); recharger(); } catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
  $$("[data-solder]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Remboursement anticipé : les retenues à venir seront annulées. Confirmer ?")) return;
    try { await API.appel(`/api/prets/${b.dataset.solder}/solder`, { methode: "POST" }); recharger(); } catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
  const enregistrer = $("#pr-enregistrer-types");
  if (enregistrer) enregistrer.addEventListener("click", async () => {
    const corps = {};
    $$("[data-pp]").forEach((c) => {
      const [k, champ] = c.dataset.pp.split(":");
      corps[k] = corps[k] || {};
      corps[k][champ] = c.type === "checkbox" ? c.checked : Number(c.value);
    });
    try { await API.appel("/api/prets/types", { methode: "PUT", corps }); toast("Paramètres enregistrés", "", "succes"); recharger(); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  });
};

TITRES["/prets"] = "Avances et prêts";
const deconnexionAvantPrets = deconnexion;
deconnexion = function (...args) { delete etat.filtres.prets; etat.pretsDonnees = null; return deconnexionAvantPrets(...args); };
const menuAvantPrets = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantPrets();
  const perso = groupes.find((g) => g.titre === "Espace personnel");
  if (perso && !perso.items.some((i) => i.route === "/prets")) {
    const i = perso.items.findIndex((x) => x.route === "/notes-de-frais");
    perso.items.splice(i >= 0 ? i + 1 : perso.items.length, 0, { route: "/prets", libelle: "Avances et prêts", icone: "portefeuille" });
  }
  return groupes;
};
const naviguerAvantPrets = naviguer;
naviguer = function (route) { if (route === "/prets") etat.pretsDonnees = null; return naviguerAvantPrets(route); };
