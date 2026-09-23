/* ==========================================================================
   65. DÉLÉGATION DE VALIDATION : un remplaçant pendant l'absence du valideur.
       Sans elle, les demandes d'une équipe attendent le retour du supérieur
       puis se valident d'office : personne ne les a lues. Le remplaçant décide
       au nom du titulaire, pendant la seule période déclarée.
   ========================================================================== */
const vueValidationAvantDelegation = VUES["/validation"];
// Toutes les routes n ont pas d ecouteurs : sans ce garde-fou, la chaine casse.
const brancherValidationAvantDelegation = BRANCHEMENTS["/validation"] || function () {};

function chargerDelegations() {
  return chargerEtat("delegations", () => API.appel("/api/delegations"));
}

function periodeLisible(d) {
  return `du ${fmtDate(d.debut)} au ${fmtDate(d.fin)}`;
}

function carteDelegation() {
  const d = chargerDelegations();
  if (!Array.isArray(d)) {
    return `<section class="carte"><div class="carte-entete"><h2>Mon remplaçant</h2></div>
      ${d && d.erreur ? `<p class="aide">${echapper(d.erreur)}</p>` : squelette(90)}</section>`;
  }
  const moiId = moi().id;
  const miennes = d.filter((x) => x.titulaire.id === moiId && !x.annulee);
  const pourAutrui = d.filter((x) => x.suppleant.id === moiId && !x.annulee && x.en_cours);
  const enCours = miennes.find((x) => x.en_cours);
  const aVenir = miennes.filter((x) => !x.en_cours);

  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div><h2>Mon remplaçant</h2>
        <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Pendant une absence, vos demandes
          sont décidées par la personne que vous désignez — au lieu d'attendre votre retour puis d'être
          validées automatiquement.</p></div>
      <button class="btn petit primaire" id="deleg-declarer">${ico("plus")} Déclarer une absence</button>
    </div>
    ${enCours ? `<div class="bandeau-info succes" style="margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <span style="flex:1 1 240px"><strong>${echapper(enCours.suppleant.nom)}</strong> décide à votre place
          ${periodeLisible(enCours)}${enCours.motif ? ` — ${echapper(enCours.motif)}` : ""}.</span>
        <button class="btn petit" data-deleg-annuler="${enCours.id}">Reprendre la main</button>
      </div>` : `<p class="aide" style="margin-bottom:10px">Aucun remplaçant en fonction aujourd'hui.</p>`}
    ${aVenir.length ? `<div class="tableau-boite"><table style="min-width:420px"><thead><tr>
        <th>Remplaçant</th><th>Période</th><th>Motif</th><th></th></tr></thead><tbody>
        ${aVenir.map((x) => `<tr><td><strong style="font-size:12.5px">${echapper(x.suppleant.nom)}</strong></td>
          <td>${periodeLisible(x)}</td><td style="font-size:12.5px">${echapper(x.motif || "—")}</td>
          <td class="centre"><button class="btn petit" data-deleg-annuler="${x.id}">Annuler</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}
    ${pourAutrui.length ? `<p class="aide" style="margin-top:10px">${ico("bouclier")} Vous remplacez
      ${pourAutrui.map((x) => `<strong>${echapper(x.titulaire.nom)}</strong> ${periodeLisible(x)}`).join(", ")} :
      ${pourAutrui.length > 1 ? "leurs demandes figurent" : "ses demandes figurent"} dans votre file ci-dessous.</p>` : ""}
  </section>`;
}

VUES["/validation"] = function () {
  if (!connecte()) return vueValidationAvantDelegation();
  return `${carteDelegation()}${vueValidationAvantDelegation()}`;
};

function declarerDelegation() {
  const collegues = EMPLOYES.filter((e) => e.matricule !== moi().matricule);
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  ouvrirCouche(`<div class="couche-entete"><h2>Déclarer une absence</h2></div>
    <form id="form-delegation" style="padding:20px;display:grid;gap:14px">
      <label>Qui décide à ma place<select class="saisie" name="suppleant" required>
        <option value="">Choisir un collègue…</option>
        ${collegues.map((e) => `<option value="${e.id}">${echapper(nomComplet(e))} · ${echapper(e.matricule)}</option>`).join("")}
      </select></label>
      <div class="ligne-champs">
        <label>Du<input class="saisie" type="date" name="debut" required value="${demain}"></label>
        <label>Au<input class="saisie" type="date" name="fin" required></label>
      </div>
      <label>Motif (facultatif)<input class="saisie" name="motif" maxlength="120" placeholder="Congé annuel, mission…"></label>
      <p class="aide">Le remplaçant décide de vos demandes pendant cette période, et uniquement d'elles :
        il n'accède ni à vos données personnelles, ni au reste de vos droits, et ne peut pas déléguer à son tour.
        Chaque décision reste inscrite à son nom. Vous pouvez reprendre la main à tout moment.</p>
      <p id="deleg-erreur" class="msg-erreur" hidden></p>
      <div style="display:flex;gap:10px">
        <button class="btn primaire" type="submit">Déclarer</button>
        <button class="btn" id="deleg-annuler-form" type="button">Annuler</button></div>
    </form>`);
  $("#deleg-annuler-form").addEventListener("click", fermerCouche);
  $("#form-delegation").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const bouton = form.querySelector('[type="submit"]');
    const erreur = $("#deleg-erreur");
    const valeurs = new FormData(form);
    bouton.disabled = true;
    try {
      await API.appel("/api/delegations", { methode: "POST", corps: {
        suppleant_id: Number(valeurs.get("suppleant")),
        debut: valeurs.get("debut"), fin: valeurs.get("fin"),
        motif: valeurs.get("motif").trim() || null } });
      etat.delegations = null;
      fermerCouche();
      toast("Remplaçant déclaré", "Il est prévenu et verra vos demandes.", "succes");
      rendre(false);
    } catch (souci) {
      erreur.textContent = souci.message;
      erreur.hidden = false;
      bouton.disabled = false;
    }
  });
}

BRANCHEMENTS["/validation"] = function () {
  brancherValidationAvantDelegation();
  $("#deleg-declarer")?.addEventListener("click", declarerDelegation);
  $$("[data-deleg-annuler]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Annuler ce remplacement ? Vous redevenez seul décisionnaire.")) return;
    try {
      await API.appel(`/api/delegations/${b.dataset.delegAnnuler}`, { methode: "DELETE" });
      etat.delegations = null;
      toast("Remplacement annulé", "", "succes");
      rendre(false);
    } catch (souci) { toast("Annulation impossible", souci.message, "danger"); }
  }));
};

const deconnexionAvantDelegation = deconnexion;
deconnexion = function (...args) { etat.delegations = null; return deconnexionAvantDelegation(...args); };
