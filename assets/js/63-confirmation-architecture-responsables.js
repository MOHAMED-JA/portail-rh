/* ============================================================================
   63. CONFIRMATION DE L'ARCHITECTURE ET DES RESPONSABLES
   Une question persistée par structure, réservée à l'administration RH.
   ============================================================================ */
let questionnaireArchitecture = null;
let chargementQuestionnaireArchitecture = false;

async function chargerQuestionnaireArchitecture() {
  if (chargementQuestionnaireArchitecture || !connecte()) return;
  chargementQuestionnaireArchitecture = true;
  try { questionnaireArchitecture = await API.appel("/api/architecture/confirmations"); }
  finally { chargementQuestionnaireArchitecture = false; }
}

function nomCandidatArchitecture(candidat) {
  return `${candidat.identite} · ${candidat.matricule} · ${LIBELLE_NIVEAU[candidat.niveau] || candidat.niveau}`;
}

function cheminStructureArchitecture(question) {
  const questions = questionnaireArchitecture.questions;
  const parId = new Map(questions.map((q) => [q.structure_id, q]));
  const chemin = [];
  let courant = question;
  const vus = new Set();
  while (courant && !vus.has(courant.structure_id)) {
    vus.add(courant.structure_id); chemin.unshift(courant.structure); courant = parId.get(courant.parent_id);
  }
  return chemin.join(" → ");
}

function ouvrirQuestionnaireArchitecture() {
  if (!questionnaireArchitecture) return;
  const questions = questionnaireArchitecture.questions;
  const aConfirmer = questions.filter((q) => !q.confirmee);
  if (!aConfirmer.length) {
    ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true"><div class="modale-tete"><h2>Architecture confirmée</h2><button class="btn icone fantome" id="fermer-confirmation-architecture" style="margin-left:auto" aria-label="Fermer">${ico("croix")}</button></div><div class="modale-corps">${etatVide("check", "Toutes les structures ont été confirmées", "Les corrections ultérieures restent possibles depuis le bouton Modifier la structure.")}</div></div>`);
    $("#fermer-confirmation-architecture").addEventListener("click", fermerCouche);
    return;
  }
  const index = Math.max(0, Math.min(etat.questionArchitectureIndex || 0, Math.max(aConfirmer.length - 1, 0)));
  const question = aConfirmer[index] || questions[0];
  if (!question) return;
  const actuel = question.responsable_actuel;
  const candidats = questionnaireArchitecture.candidats;
  const avancement = questionnaireArchitecture.confirmees;
  ouvrirCouche(`<div class="modale" role="dialog" aria-modal="true">
    <div class="modale-tete"><div><h2>Confirmation de l'organigramme</h2><div class="sous">${avancement} / ${questionnaireArchitecture.total} structure(s) confirmée(s)</div></div><button class="btn icone fantome" id="fermer-confirmation-architecture" style="margin-left:auto" aria-label="Fermer">${ico("croix")}</button></div>
    <form id="form-confirmation-architecture" class="modale-corps" style="display:grid;gap:14px">
      <div class="bandeau-info">${ico("organigramme")}<span><strong>Question ${aConfirmer.length ? index + 1 : questionnaireArchitecture.total} :</strong> qui dirige cette structure ? Les choix sont enregistrés, tracés et vous pourrez les corriger ultérieurement.</span></div>
      <div><strong>${echapper(question.structure)}</strong><div class="sous" style="margin-top:4px">${echapper(cheminStructureArchitecture(question))}</div></div>
      ${actuel ? `<div class="carte" style="padding:12px"><div class="sous">Responsable actuellement renseigné</div><strong>${echapper(nomCandidatArchitecture(actuel))}</strong></div>` : `<div class="carte" style="padding:12px"><span class="badge or">Aucun responsable actuellement renseigné</span></div>`}
      <label>Réponse
        <select class="saisie" id="choix-responsable-architecture" required>
          <option value="${actuel ? actuel.id : ""}">${actuel ? `Conserver : ${echapper(nomCandidatArchitecture(actuel))}` : "Choisir un responsable"}</option>
          <option value="__aucun__">Aucun responsable pour le moment</option>
          ${candidats.filter((c) => !actuel || c.id !== actuel.id).map((c) => `<option value="${c.id}">${echapper(nomCandidatArchitecture(c))}</option>`).join("")}
        </select>
      </label>
      <p id="erreur-confirmation-architecture" role="alert"></p>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><button class="btn" type="button" id="precedente-confirmation-architecture" ${index === 0 ? "disabled" : ""}>Précédente</button><div style="display:flex;gap:8px"><button class="btn" type="button" id="plus-tard-confirmation-architecture">Plus tard</button><button class="btn primaire" type="submit">Confirmer ce choix</button></div></div>
    </form></div>`);
  $("#fermer-confirmation-architecture").addEventListener("click", fermerCouche);
  $("#precedente-confirmation-architecture").addEventListener("click", () => { etat.questionArchitectureIndex = Math.max(0, index - 1); ouvrirQuestionnaireArchitecture(); });
  $("#plus-tard-confirmation-architecture").addEventListener("click", () => { etat.questionArchitectureIndex = Math.min(index + 1, Math.max(aConfirmer.length - 1, 0)); ouvrirQuestionnaireArchitecture(); });
  $("#form-confirmation-architecture").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const bouton = ev.currentTarget.querySelector('[type="submit"]'); bouton.disabled = true;
    const valeur = $("#choix-responsable-architecture").value;
    const responsableId = valeur === "__aucun__" || valeur === "" ? null : Number(valeur);
    try {
      await API.appel(`/api/architecture/confirmations/${question.structure_id}`, { methode: "PUT", corps: { responsable_id: responsableId } });
      questionnaireArchitecture = null; await chargerQuestionnaireArchitecture();
      structuresOrganisation = null; await chargerStructuresOrganisation();
      etat.questionArchitectureIndex = 0;
      fermerCouche(); ouvrirQuestionnaireArchitecture();
    } catch (souci) { $("#erreur-confirmation-architecture").textContent = souci.message; bouton.disabled = false; }
  });
}

const vueOrganigrammeAvantConfirmationArchitecture = VUES["/organigramme"];
VUES["/organigramme"] = function () {
  const html = vueOrganigrammeAvantConfirmationArchitecture();
  if (!estAdmin() || estGestionnaire()) return html;
  return html.replace('<button class="btn petit" id="org-actualiser">Actualiser</button>', '<button class="btn petit" id="org-actualiser">Actualiser</button><button class="btn petit primaire" id="org-confirmations">Confirmer les responsables</button>');
};

const brancherOrganigrammeAvantConfirmationArchitecture = BRANCHEMENTS["/organigramme"];
BRANCHEMENTS["/organigramme"] = function () {
  brancherOrganigrammeAvantConfirmationArchitecture();
  $("#org-confirmations")?.addEventListener("click", async () => {
    await chargerQuestionnaireArchitecture(); ouvrirQuestionnaireArchitecture();
  });
};
