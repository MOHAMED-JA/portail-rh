/* ==========================================================================
   83 — Assistant RH (version 1.38.0)
   Bouton « Assistant » dans l'en-tête : on pose une question en français
   (« Combien de jours me reste-t-il ? », « Qui est absent demain ? »,
   « Poser 3 jours la semaine prochaine »…). Le serveur répond à partir des
   données du portail, sans IA externe (/api/assistant). Une action guidée
   ouvre le formulaire pré-rempli : rien n'est déposé sans le clic de
   l'utilisateur. La conversation reste en mémoire le temps de la session.
   ========================================================================== */
ICONES.bulle = '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>';

const ASSISTANT = { fil: [], suggestions: [], enCours: false };

function bulleAssistant(message) {
  if (message.auteur === "moi") return `<div class="assistant-bulle moi">${echapper(message.texte)}</div>`;
  if (message.attente) return `<div class="assistant-bulle rh attente" aria-live="polite">…</div>`;
  const r = message.reponse;
  const details = (r.details || []).length
    ? `<ul>${r.details.map((d) => `<li>${echapper(d)}</li>`).join("")}</ul>` : "";
  const boutons = [
    r.action ? `<button class="btn petit primaire" data-assistant-action="${ASSISTANT.fil.indexOf(message)}">${ico("crayon")} Ouvrir le formulaire pré-rempli</button>` : "",
    ...(r.liens || []).map((l) => `<button class="btn petit" data-assistant-route="${echapper(l.route)}">${echapper(l.libelle)} ${ico("fleche")}</button>`),
  ].join("");
  return `<div class="assistant-bulle rh${r.erreur ? " erreur" : ""}" aria-live="polite">
    <p>${echapper(r.texte)}</p>${details}${boutons ? `<div class="assistant-liens">${boutons}</div>` : ""}</div>`;
}

function contenuAssistant() {
  if (!connecte()) {
    return etatVide("bulle", "Disponible avec le serveur",
      "L'assistant répond à partir de la base du portail : lancez DEMARRER.bat puis reconnectez-vous.");
  }
  const accueil = ASSISTANT.fil.length ? "" : `<div class="assistant-bulle rh"><p>Bonjour ${echapper(moi().prenom)} ! Posez votre
    question sur vos congés, autorisations, demandes, votre valideur ou les règles RH. Je peux aussi préparer une demande :
    vous la vérifiez et la soumettez vous-même.</p></div>`;
  return `${accueil}${ASSISTANT.fil.map(bulleAssistant).join("")}`;
}

function suggestionsAssistant() {
  return ASSISTANT.suggestions.slice(0, 6)
    .map((s) => `<button type="button" class="assistant-suggestion" data-assistant-question="${echapper(s)}">${echapper(s)}</button>`).join("");
}

function redessinerAssistant() {
  const fil = $("#assistant-fil");
  if (!fil) return;
  fil.innerHTML = contenuAssistant();
  const zone = $("#assistant-suggestions");
  if (zone) zone.innerHTML = suggestionsAssistant();
  fil.scrollTop = fil.scrollHeight;
  brancherAssistant();
}

function brancherAssistant() {
  $$("[data-assistant-question]").forEach((b) => { b.onclick = () => envoyerQuestionAssistant(b.dataset.assistantQuestion); });
  $$("[data-assistant-route]").forEach((b) => { b.onclick = () => { fermerCouche(); naviguer(b.dataset.assistantRoute); }; });
  $$("[data-assistant-action]").forEach((b) => {
    b.onclick = () => preremplirDemande(ASSISTANT.fil[Number(b.dataset.assistantAction)].reponse.action);
  });
}

async function envoyerQuestionAssistant(question) {
  const texte = (question || "").trim();
  if (!texte || ASSISTANT.enCours || !connecte()) return;
  ASSISTANT.enCours = true;
  ASSISTANT.fil.push({ auteur: "moi", texte });
  const attente = { auteur: "rh", attente: true };
  ASSISTANT.fil.push(attente);
  const saisie = $("#assistant-saisie");
  if (saisie) saisie.value = "";
  redessinerAssistant();
  try {
    const reponse = await API.appel("/api/assistant", { methode: "POST", corps: { question: texte.slice(0, 500) } });
    ASSISTANT.fil.splice(ASSISTANT.fil.indexOf(attente), 1, { auteur: "rh", reponse });
    ASSISTANT.suggestions = reponse.suggestions || ASSISTANT.suggestions;
  } catch (souci) {
    ASSISTANT.fil.splice(ASSISTANT.fil.indexOf(attente), 1,
      { auteur: "rh", reponse: { texte: `Réponse impossible : ${souci.message}`, erreur: true } });
  } finally {
    ASSISTANT.enCours = false;
    redessinerAssistant();
    const champ = $("#assistant-saisie");
    if (champ) champ.focus();
  }
}

function preremplirDemande(action) {
  if (!action) return;
  fermerCouche();
  ouvrirDemande(action.type);
  const choix = $("#d-type");
  if (choix && action.sous_type && [...choix.options].some((o) => o.value === action.sous_type)) choix.value = action.sous_type;
  [["d-debut", action.date_debut], ["d-fin", action.date_fin], ["d-h-debut", action.heure_debut], ["d-h-fin", action.heure_fin]]
    .forEach(([id, valeur]) => { const champ = $(`#${id}`); if (champ && valeur) champ.value = valeur; });
  ["d-type", "d-debut", "d-fin", "d-h-debut", "d-h-fin"].forEach((id) => {
    const champ = $(`#${id}`);
    if (champ) champ.dispatchEvent(new Event("change"));
  });
  const demi = action.demi_journee && $(`#d-demi [data-demi="${action.demi_journee}"]`);
  if (demi) demi.click();
  toast("Formulaire pré-rempli par l'assistant", "Vérifiez les informations, puis soumettez la demande.", "info");
}

async function ouvrirAssistant() {
  ouvrirCouche(`
    <aside class="tiroir assistant-tiroir" role="dialog" aria-modal="true" aria-label="Assistant RH">
      ${enteteTiroir("Assistant RH", "Réponses tirées du portail — aucune donnée ne sort de Veltaris")}
      <div class="tiroir-corps assistant-fil" id="assistant-fil">${contenuAssistant()}</div>
      <div class="assistant-suggestions" id="assistant-suggestions">${suggestionsAssistant()}</div>
      <div class="tiroir-pied assistant-pied">
        <input class="saisie" id="assistant-saisie" maxlength="500" autocomplete="off"
          placeholder="${connecte() ? "Posez votre question…" : "Disponible avec le serveur"}" ${connecte() ? "" : "disabled"}>
        <button class="btn primaire" id="assistant-envoyer" ${connecte() ? "" : "disabled"}>${ico("fleche")} Envoyer</button>
      </div>
    </aside>`, { tiroir: true });
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  const saisie = $("#assistant-saisie");
  $("#assistant-envoyer").addEventListener("click", () => envoyerQuestionAssistant(saisie.value));
  saisie.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); envoyerQuestionAssistant(saisie.value); } });
  redessinerAssistant();
  if (connecte()) {
    setTimeout(() => saisie.focus(), 80);
    if (!ASSISTANT.suggestions.length) {
      try {
        ASSISTANT.suggestions = (await API.appel("/api/assistant/suggestions")).suggestions;
        redessinerAssistant();
      } catch { /* les suggestions sont un confort : la saisie libre reste possible */ }
    }
  }
}

/* --- Bouton dans l'en-tête, à côté des notifications -------------------------- */
const rendreAvantAssistant = rendre;
rendre = function (...args) {
  rendreAvantAssistant(...args);
  const notifications = $('.entete-actions [data-action="notifications"]');
  if (!etat.utilisateur || !notifications || $("#bouton-assistant")) return;
  notifications.insertAdjacentHTML("beforebegin",
    `<button class="btn fantome bouton-assistant" id="bouton-assistant" aria-label="Assistant RH" title="Assistant RH">
      ${ico("bulle")}<span class="txt">Assistant</span></button>`);
  $("#bouton-assistant").addEventListener("click", ouvrirAssistant);
};

/* Nouvelle session (déconnexion, autre compte) : la conversation repart de zéro. */
const deconnexionAvantAssistant = deconnexion;
deconnexion = function (...args) {
  ASSISTANT.fil = [];
  ASSISTANT.suggestions = [];
  return deconnexionAvantAssistant(...args);
};
