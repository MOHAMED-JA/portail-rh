/* ==========================================================================
   71. DÉPARTS ET ENTRETIENS DE SORTIE
       Taux de départ (dont volontaire et dans la première année), motifs
       codifiés recueillis en entretien de sortie, départs regrettés.
       Saisie et détail : RH ; agrégats : Direction générale.
   ========================================================================== */
function depEtat() {
  return etat.filtres.departs || (etat.filtres.departs = { mois: 12 });
}

VUES["/departs"] = function () {
  if (!connecte()) return reserveServeur("L'analyse des départs");
  if (!(estAdmin() || estDirection())) return etatVide("bouclier", "Réservé", "Réservé à la RH et à la Direction générale.");
  const f = depEtat();
  const d = chargerEtat("departsAnalyse", () => API.appel(`/api/departs?mois=${f.mois}`));
  const entete = `<div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Départs et entretiens de sortie</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Combien partent, et surtout pourquoi : les motifs viennent des entretiens de sortie.</p></div>
    <select class="saisie" id="dep-mois" style="width:170px">${[6, 12, 24, 36].map((m) => `<option value="${m}" ${f.mois === m ? "selected" : ""}>${m} derniers mois</option>`).join("")}</select></div>`;
  if (!d) return `<section class="carte">${entete}${squelette(280)}</section>`;
  if (d.erreur) return `<section class="carte">${entete}${etatVide("alerte", "Indisponible", echapper(d.erreur))}</section>`;
  const max = Math.max(1, ...d.par_motif_depart.map((m) => m.nombre));
  return `<section class="carte">${entete}
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      ${carteKpi({ cle: "dp1", libelle: "Taux de départ", valeur: d.taux_depart == null ? "—" : fmtNombre(d.taux_depart, 1), unite: d.taux_depart == null ? "" : "%", icone: "sortie", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${d.departs} départ(s) sur ${d.periode_mois} mois` })}
      ${carteKpi({ cle: "dp2", libelle: "Départs volontaires", valeur: d.taux_depart_volontaire == null ? "—" : fmtNombre(d.taux_depart_volontaire, 1), unite: d.taux_depart_volontaire == null ? "" : "%", icone: "alerte", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "démissions et départs à l'amiable" })}
      ${carteKpi({ cle: "dp3", libelle: "Départs regrettés", valeur: d.departs_regrettes, unite: "", icone: "etoile", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: `${d.departs_precoces} départ(s) dans la première année` })}
      ${carteKpi({ cle: "dp4", libelle: "Recommandation nette", valeur: d.recommandation_nette ?? "—", unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${d.entretiens_realises} entretien(s) réalisé(s)` })}</div>
    <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
      <div><h3 style="margin:0 0 8px;font-size:14px">Motifs exprimés en entretien</h3>
        ${d.par_motif_depart.length ? d.par_motif_depart.map((m) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="flex:0 0 210px;font-size:12.5px">${echapper(m.libelle)}</span>
          <div class="jauge" style="flex:1"><span style="width:${Math.round(100 * m.nombre / max)}%"></span></div><strong class="num">${m.nombre}</strong></div>`).join("")
          : `<p class="aide">Aucun entretien de sortie enregistré sur la période.</p>`}</div>
      <div><h3 style="margin:0 0 8px;font-size:14px">Par direction</h3>
        ${d.par_direction.length ? `<div class="tableau-boite"><table><thead><tr><th>Direction</th><th class="centre">Départs</th><th class="centre">Volontaires</th></tr></thead><tbody>
          ${d.par_direction.map((a) => `<tr><td>${echapper(a.direction)}</td><td class="centre num">${a.departs}</td><td class="centre num">${a.volontaires || "—"}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="aide">Aucun départ sur la période.</p>`}</div></div>
    ${d.collaborateurs ? `<h3 style="margin:16px 0 8px;font-size:14px">${ico("bouclier")} Départs et entretiens (RH uniquement)</h3>
      ${d.collaborateurs.length ? `<div class="tableau-boite"><table style="min-width:700px"><thead><tr><th>Collaborateur</th><th>Direction</th><th>Sortie</th><th>Motif administratif</th><th>Entretien</th><th></th></tr></thead><tbody>
        ${d.collaborateurs.map((c) => `<tr><td><strong style="font-size:13px">${echapper(c.prenom + " " + c.nom)}</strong><div class="aide">${echapper(c.poste || "")}</div></td>
          <td style="font-size:12.5px">${echapper(c.direction)}</td>
          <td class="mono">${fmtDate(c.date_sortie)}${c.programmee ? ` <span class="badge info">prévue</span>` : ""}</td><td style="font-size:12.5px">${echapper(c.motif_sortie_libelle || "—")}</td>
          <td>${c.entretien ? `<span class="badge approuvee">${echapper(c.entretien.motif_libelle)}</span>` : `<span class="badge attente">À mener</span>`}</td>
          <td class="droite"><button class="btn petit" data-dep-entretien="${c.matricule}">${ico(c.entretien ? "crayon" : "plus")}</button></td></tr>`).join("")}</tbody></table></div>`
        : etatVide("check", "Aucun départ", "Aucune sortie enregistrée ou programmée sur la période.")}` : ""}
    <p class="aide" style="margin-top:10px">Taux de départ = départs de la période ÷ effectif moyen. Recommandation nette = % de notes 9-10 moins % de notes 0-6 à la question « recommanderiez-vous Veltaris comme employeur ? ».</p>
  </section>`;
};

function depEntretien(matricule) {
  const d = etat.departsAnalyse;
  const c = d && d.collaborateurs ? d.collaborateurs.find((x) => x.matricule === matricule) : null;
  if (!c) return;
  const x = c.entretien || { motifs_secondaires: [] };
  const motifs = Object.entries(d.motifs_depart);
  const oui = (v) => (v === true ? "oui" : v === false ? "non" : "");
  const choixOuiNon = (id, v) => `<select class="saisie" id="${id}"><option value="" ${v == null ? "selected" : ""}>Non renseigné</option><option value="oui" ${oui(v) === "oui" ? "selected" : ""}>Oui</option><option value="non" ${oui(v) === "non" ? "selected" : ""}>Non</option></select>`;
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(620px,100%)">
    ${enteteTiroir(`Entretien de sortie — ${echapper(c.prenom + " " + c.nom)}`, `${echapper(c.direction)} · sortie le ${fmtDate(c.date_sortie)} · ${echapper(c.motif_sortie_libelle || "")}`)}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <div class="ligne-champs"><div class="champ"><label>Date de l'entretien *</label><input class="saisie" type="date" id="es-date" value="${x.date_entretien || new Date().toISOString().slice(0, 10)}"></div>
        <div class="champ"><label>Motif principal *</label><select class="saisie" id="es-motif">${motifs.map(([k, l]) => `<option value="${k}" ${x.motif_principal === k ? "selected" : ""}>${echapper(l)}</option>`).join("")}</select></div></div>
      <div class="champ"><label>Autres motifs (5 au plus)</label><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:2px 10px">
        ${motifs.map(([k, l]) => `<label style="display:flex;gap:6px;font-size:12.5px"><input type="checkbox" data-es-motif="${k}" ${x.motifs_secondaires.includes(k) ? "checked" : ""}> ${echapper(l)}</label>`).join("")}</div></div>
      <div class="ligne-champs"><div class="champ"><label>Recommanderait Veltaris (0 à 10)</label><input class="saisie" type="number" min="0" max="10" id="es-reco" value="${x.recommanderait ?? ""}"></div>
        <div class="champ"><label>Reviendrait</label>${choixOuiNon("es-revient", x.reviendrait)}</div>
        <div class="champ"><label>Départ regretté (avis RH)</label>${choixOuiNon("es-regret", x.depart_regrette)}</div></div>
      <div class="champ"><label>Ce qui a été apprécié</label><textarea class="saisie" rows="3" id="es-forts">${echapper(x.points_forts || "")}</textarea></div>
      <div class="champ"><label>Ce qui devrait changer</label><textarea class="saisie" rows="3" id="es-axes">${echapper(x.axes_amelioration || "")}</textarea></div>
      <p class="aide">Les appréciations libres sont chiffrées en base et réservées à la RH.</p>
      <p id="es-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="es-fermer">Fermer</button><button class="btn primaire" id="es-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#es-fermer").addEventListener("click", fermerCouche);
  $("#es-enregistrer").addEventListener("click", async () => {
    const booleen = (id) => ($(id).value === "" ? null : $(id).value === "oui");
    const principal = $("#es-motif").value;
    try {
      await API.appel(`/api/departs/${encodeURIComponent(matricule)}/entretien`, { methode: "PUT", corps: {
        date_entretien: $("#es-date").value, motif_principal: principal,
        motifs_secondaires: $$("[data-es-motif]:checked").map((b) => b.dataset.esMotif).filter((k) => k !== principal).slice(0, 5),
        recommanderait: $("#es-reco").value === "" ? null : Number($("#es-reco").value),
        reviendrait: booleen("#es-revient"), depart_regrette: booleen("#es-regret"),
        points_forts: $("#es-forts").value.trim() || null, axes_amelioration: $("#es-axes").value.trim() || null } });
      fermerCouche(); etat.departsAnalyse = null; toast("Entretien enregistré", "", "succes"); rendre(false);
    } catch (souci) { const e = $("#es-erreur"); e.textContent = souci.message; e.hidden = false; }
  });
}

BRANCHEMENTS["/departs"] = function () {
  const f = etat.filtres.departs;
  if (!f) return;
  $("#dep-mois")?.addEventListener("change", (e) => { f.mois = Number(e.target.value); etat.departsAnalyse = null; rendre(false); });
  $$("[data-dep-entretien]").forEach((b) => b.addEventListener("click", () => depEntretien(b.dataset.depEntretien)));
};

TITRES["/departs"] = "Départs et entretiens de sortie";
const menuAvantDeparts = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantDeparts();
  if (!(estAdmin() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/departs")) pilotage.items.push({ route: "/departs", libelle: "Départs", icone: "sortie" });
  return groupes;
};
const naviguerAvantDeparts = naviguer;
naviguer = function (route) { if (route === "/departs") etat.departsAnalyse = null; return naviguerAvantDeparts(route); };
const deconnexionAvantDeparts = deconnexion;
deconnexion = function (...args) { delete etat.filtres.departs; etat.departsAnalyse = null; return deconnexionAvantDeparts(...args); };
