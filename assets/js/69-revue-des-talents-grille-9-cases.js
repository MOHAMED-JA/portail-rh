/* ==========================================================================
   69. REVUE DES TALENTS : GRILLE PERFORMANCE × POTENTIEL ET CALIBRATION
       Le supérieur propose le potentiel de ses collaborateurs directs ; la
       performance vient de l'évaluation finalisée ; la RH calibre. La grille
       révèle les notes : RH et Direction générale seulement.
   ========================================================================== */
const TAL_NIVEAUX = { 1: "Faible", 2: "Moyen", 3: "Élevé" };
const TAL_TEINTES = { "3-3": "var(--succes-doux)", "2-3": "var(--succes-doux)", "3-2": "var(--succes-doux)",
  "1-1": "var(--danger-doux)", "1-2": "var(--alerte-doux)", "2-1": "var(--marine-doux)", "1-3": "var(--alerte-doux)",
  "2-2": "var(--marine-doux)", "3-1": "var(--marine-doux)" };

function talEtat() {
  return etat.filtres.talents || (etat.filtres.talents = { annee: new Date().getFullYear() });
}
const talVoitGrille = () => estAdmin() || estDirection();

function talPuce(x, calibrable) {
  const marques = [x.successeur ? "successeur désigné" : "", x.titulaire_poste_cle ? "titulaire d'un poste clé" : "", x.calibre ? "calibré" : ""].filter(Boolean);
  return `<button class="badge neutre" style="cursor:${calibrable ? "pointer" : "default"};margin:2px;font-weight:500" ${calibrable ? `data-tal-calibrer="${x.matricule}"` : ""}
    title="${echapper(`${x.poste || ""}${x.note != null ? ` · note ${fmtNombre(x.note, 2)}/20` : ""}${marques.length ? ` · ${marques.join(", ")}` : ""}`)}">
    ${x.successeur || x.titulaire_poste_cle ? "★ " : ""}${echapper(x.prenom + " " + x.nom)}</button>`;
}

function talGrille(d) {
  const parCle = Object.fromEntries(d.cases.map((c) => [c.cle, c]));
  const ligne = (pot) => [1, 2, 3].map((perf) => {
    const c = parCle[`${perf}-${pot}`];
    return `<div style="background:${TAL_TEINTES[c.cle]};border-radius:12px;padding:10px;min-height:120px">
      <div style="display:flex;justify-content:space-between;gap:6px"><strong style="font-size:13px">${echapper(c.libelle)}</strong><span class="badge neutre">${c.collaborateurs.length}</span></div>
      <div class="aide" style="margin:3px 0 6px">${echapper(c.action)}</div>
      <div>${c.collaborateurs.map((x) => talPuce(x, d.peut_calibrer)).join("")}</div></div>`;
  }).join("");
  return `<div style="display:grid;grid-template-columns:28px repeat(3,minmax(0,1fr));gap:8px;align-items:stretch">
    ${[3, 2, 1].map((pot) => `<div style="writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;font-size:11.5px;color:var(--encre-3)">Potentiel ${TAL_NIVEAUX[pot].toLowerCase()}</div>${ligne(pot)}`).join("")}
    <div></div>${[1, 2, 3].map((p) => `<div style="text-align:center;font-size:11.5px;color:var(--encre-3)">Performance ${TAL_NIVEAUX[p].toLowerCase()}</div>`).join("")}
  </div>`;
}

VUES["/revue-talents"] = function () {
  if (!connecte()) return reserveServeur("La revue des talents");
  const f = talEtat();
  const choixAnnee = `<select class="saisie" data-tal-annee style="width:110px">${[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]
    .map((a) => `<option value="${a}" ${a === f.annee ? "selected" : ""}>${a}</option>`).join("")}</select>`;
  let html = "";

  if (estValideur()) {
    const e = chargerEtat("talEquipe", () => API.appel(`/api/revue-talents/equipe?annee=${f.annee}`));
    if (e && !e.erreur && e.collaborateurs.length) {
      html += `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Potentiel de mes collaborateurs</h2>
          <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Votre proposition éclaire la revue des talents ; la RH arrête la position finale en calibration.</p></div>${choixAnnee}</div>
        <div class="tableau-boite"><table style="min-width:620px"><thead><tr><th>Collaborateur</th><th>Potentiel proposé</th><th>Commentaire</th><th></th></tr></thead><tbody>
          ${e.collaborateurs.map((c) => `<tr><td><strong style="font-size:13px">${echapper(c.prenom + " " + c.nom)}</strong><div class="aide">${echapper(c.poste || "")}</div></td>
            <td><select class="saisie" data-tal-pot="${c.matricule}"><option value="">À proposer</option>${[1, 2, 3].map((n) => `<option value="${n}" ${c.potentiel_propose === n ? "selected" : ""}>${TAL_NIVEAUX[n]}</option>`).join("")}</select></td>
            <td><input class="saisie" data-tal-com="${c.matricule}" value="${echapper(c.commentaire || "")}" placeholder="Ce qui fonde votre appréciation"></td>
            <td><button class="btn petit primaire" data-tal-proposer="${c.matricule}">${ico("check")}</button></td></tr>`).join("")}</tbody></table></div>
        <p class="aide" style="margin-top:6px">Potentiel : capacité à tenir, dans les deux à trois ans, un poste de responsabilité ou de complexité supérieure.</p></section>`;
    }
  }

  if (talVoitGrille()) {
    const d = chargerEtat("talGrille", () => API.appel(`/api/revue-talents?annee=${f.annee}`));
    html += `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Revue des talents ${f.annee}</h2>
        <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Performance (évaluation finalisée) × potentiel (proposé par le N+1, calibré par la RH). ★ successeur désigné ou titulaire d'un poste clé.</p></div>${choixAnnee}</div>
      ${!d ? squelette(360) : d.erreur ? etatVide("alerte", "Indisponible", echapper(d.erreur)) : `${talGrille(d)}
        <p class="aide" style="margin-top:8px">${d.positionnes} collaborateur(s) positionné(s).${d.peut_calibrer ? " Cliquez sur un nom pour le calibrer." : " Consultation seule."}</p>
        ${d.non_positionnes.length ? `<h3 style="margin:14px 0 8px;font-size:14px">Non positionnés (${d.non_positionnes.length})</h3>
          <div class="tableau-boite"><table style="min-width:520px"><thead><tr><th>Collaborateur</th><th>Direction</th><th>Il manque</th>${d.peut_calibrer ? "<th></th>" : ""}</tr></thead><tbody>
            ${d.non_positionnes.map((x) => `<tr><td><strong style="font-size:13px">${echapper(x.prenom + " " + x.nom)}</strong></td><td style="font-size:12.5px">${echapper(x.direction)}</td>
              <td style="font-size:12.5px">${x.manque.map(echapper).join(" et ")}</td>
              ${d.peut_calibrer ? `<td class="droite"><button class="btn petit" data-tal-calibrer="${x.matricule}">${ico("crayon")} Positionner</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : ""}`}
    </section>`;
  }
  return html || `<section class="carte">${etatVide("users", "Rien à afficher", "La revue des talents concerne les supérieurs, la RH et la Direction générale.")}</section>`;
};

function talCalibrer(matricule) {
  const d = etat.talGrille;
  if (!d || d.erreur) return;
  const x = [...d.cases.flatMap((c) => c.collaborateurs), ...d.non_positionnes].find((y) => y.matricule === matricule);
  if (!x) return;
  const options = (valeur, auto) => `<option value="">${auto ? `Automatique (${auto ? TAL_NIVEAUX[auto] : "—"})` : "Non déterminé"}</option>${[1, 2, 3].map((n) => `<option value="${n}" ${valeur === n ? "selected" : ""}>${TAL_NIVEAUX[n]}</option>`).join("")}`;
  ouvrirCouche(`<aside class="tiroir" role="dialog" aria-modal="true" style="width:min(520px,100%)">
    ${enteteTiroir(`Calibration — ${echapper(x.prenom + " " + x.nom)}`, `${echapper(x.poste || "")} · ${echapper(x.direction)}`)}
    <div class="tiroir-corps" style="display:grid;gap:12px">
      <p style="font-size:13px">Note de l'évaluation : <strong>${x.note != null ? `${fmtNombre(x.note, 2)}/20` : "aucune évaluation finalisée"}</strong>
        ${x.potentiel_propose ? ` · potentiel proposé par le N+1 : <strong>${TAL_NIVEAUX[x.potentiel_propose]}</strong>` : ""}</p>
      ${x.commentaire_superieur ? `<div class="bandeau-info">${ico("users")}<span>${echapper(x.commentaire_superieur)}</span></div>` : ""}
      <div class="ligne-champs"><div class="champ"><label>Performance</label><select class="saisie" id="tal-perf">${options(x.performance !== x.performance_auto ? x.performance : null, x.performance_auto)}</select></div>
        <div class="champ"><label>Potentiel</label><select class="saisie" id="tal-pot">${options(x.potentiel, null)}</select></div></div>
      <div class="champ"><label>Motif de la calibration</label><textarea class="saisie" id="tal-com" rows="3">${echapper(x.commentaire_calibration || "")}</textarea></div>
      <p class="aide">La calibration est tracée au journal d'audit. Elle n'est pas communiquée au collaborateur.</p>
      <p id="tal-erreur" class="msg-erreur" hidden></p></div>
    <div class="tiroir-pied"><button class="btn" id="tal-fermer">Fermer</button><button class="btn primaire" id="tal-enregistrer">${ico("check")} Enregistrer</button></div>
  </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#tal-fermer").addEventListener("click", fermerCouche);
  $("#tal-enregistrer").addEventListener("click", async () => {
    try {
      await API.appel(`/api/revue-talents/${encodeURIComponent(matricule)}/calibrer`, { methode: "PUT", corps: {
        annee: talEtat().annee, performance: Number($("#tal-perf").value) || null, potentiel: Number($("#tal-pot").value) || null,
        commentaire: $("#tal-com").value.trim() || null } });
      fermerCouche(); etat.talGrille = null; toast("Position enregistrée", "", "succes"); rendre(false);
    } catch (souci) { const e = $("#tal-erreur"); e.textContent = souci.message; e.hidden = false; }
  });
}

BRANCHEMENTS["/revue-talents"] = function () {
  const f = etat.filtres.talents;
  if (!f) return;
  $$("[data-tal-annee]").forEach((s) => s.addEventListener("change", () => { f.annee = Number(s.value); etat.talGrille = null; etat.talEquipe = null; rendre(false); }));
  $$("[data-tal-calibrer]").forEach((b) => b.addEventListener("click", () => talCalibrer(b.dataset.talCalibrer)));
  $$("[data-tal-proposer]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.talProposer;
    const potentiel = Number($(`[data-tal-pot="${m}"]`).value);
    if (!potentiel) return toast("Potentiel à choisir", "Choisissez faible, moyen ou élevé.", "alerte");
    try {
      await API.appel(`/api/revue-talents/${encodeURIComponent(m)}/potentiel`, { methode: "PUT", corps: {
        annee: f.annee, potentiel, commentaire: $(`[data-tal-com="${m}"]`).value.trim() || null } });
      etat.talEquipe = null; etat.talGrille = null; toast("Proposition enregistrée", "", "succes"); rendre(false);
    } catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
};

TITRES["/revue-talents"] = "Revue des talents";
const menuAvantRevueTalents = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantRevueTalents();
  if (!(estValideur() || estDirection())) return groupes;
  let pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (!pilotage) { pilotage = { titre: "Pilotage", items: [] }; groupes.push(pilotage); }
  if (!pilotage.items.some((i) => i.route === "/revue-talents")) pilotage.items.push({ route: "/revue-talents", libelle: "Revue des talents", icone: "etoile" });
  return groupes;
};
const naviguerAvantRevueTalents = naviguer;
naviguer = function (route) { if (route === "/revue-talents") { etat.talGrille = null; etat.talEquipe = null; } return naviguerAvantRevueTalents(route); };
const deconnexionAvantRevueTalents = deconnexion;
deconnexion = function (...args) { delete etat.filtres.talents; etat.talGrille = null; etat.talEquipe = null; return deconnexionAvantRevueTalents(...args); };
