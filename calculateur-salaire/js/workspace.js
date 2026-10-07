/* Navigation de l'espace de simulation ; indépendante du moteur de paie. */
(function () {
  "use strict";
  var doc = document;
  var mobile = window.matchMedia("(max-width: 899.98px)");
  var mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)");
  var form = doc.getElementById("formulaire");
  var dialogueSaisie = doc.getElementById("dialog-saisie");
  var dialogueGuide = doc.getElementById("dialog-guide");
  var vueActive = "synthese";

  function entrer(panneau) {
    if (mouvementReduit.matches || !panneau.animate) return;
    panneau.getAnimations().forEach(function (a) { a.cancel(); });
    panneau.animate([{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 210, easing: "cubic-bezier(.2,.7,.2,1)" });
  }

  function selectionnerVue(vue, focus) {
    var panneau = doc.getElementById("vue-" + vue);
    if (!panneau) return;
    var change = vueActive !== vue;
    vueActive = vue;
    doc.querySelectorAll("[data-view]").forEach(function (bouton) {
      var actif = bouton.getAttribute("data-view") === vue;
      bouton.setAttribute("aria-selected", String(actif));
      bouton.tabIndex = actif ? 0 : -1;
      doc.getElementById(bouton.getAttribute("aria-controls")).hidden = !actif;
      if (actif && focus) bouton.focus();
    });
    if (change) entrer(panneau);
  }

  function selectionnerFormulaire(vue, focus) {
    doc.querySelectorAll("[data-form-view]").forEach(function (bouton) {
      var actif = bouton.getAttribute("data-form-view") === vue;
      var panneau = doc.getElementById(bouton.getAttribute("aria-controls"));
      bouton.setAttribute("aria-selected", String(actif));
      bouton.tabIndex = actif ? 0 : -1;
      panneau.hidden = !actif;
      if (actif) {
        if (focus) bouton.focus();
        entrer(panneau);
      }
    });
    doc.querySelector(".form-pages").scrollTop = 0;
  }

  function clavierOnglets(groupe, attribut, selectionner) {
    groupe.addEventListener("keydown", function (e) {
      var boutons = Array.from(groupe.querySelectorAll("[" + attribut + "]"));
      var index = boutons.indexOf(e.target);
      if (index < 0) return;
      var prochain;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") prochain = (index + 1) % boutons.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") prochain = (index + boutons.length - 1) % boutons.length;
      else if (e.key === "Home") prochain = 0;
      else if (e.key === "End") prochain = boutons.length - 1;
      else return;
      e.preventDefault();
      selectionner(boutons[prochain].getAttribute(attribut), true);
    });
  }
  doc.querySelectorAll("[data-view]").forEach(function (b) {
    b.addEventListener("click", function () { selectionnerVue(b.getAttribute("data-view")); });
  });
  doc.querySelectorAll("[data-open-view]").forEach(function (b) {
    b.addEventListener("click", function () { selectionnerVue(b.getAttribute("data-open-view"), true); });
  });
  doc.querySelectorAll("[data-form-view]").forEach(function (b) {
    b.addEventListener("click", function () { selectionnerFormulaire(b.getAttribute("data-form-view")); });
  });
  clavierOnglets(doc.querySelector(".workspace-nav"), "data-view", selectionnerVue);
  clavierOnglets(doc.querySelector(".form-tabs"), "data-form-view", selectionnerFormulaire);

  function ouvrirDialogue(dialogue) {
    if (!dialogue.open) dialogue.showModal();
    doc.documentElement.classList.add("dialogue-ouvert");
  }
  [dialogueSaisie, dialogueGuide].forEach(function (dialogue) {
    dialogue.addEventListener("close", function () {
      if (dialogue === dialogueSaisie && !doc.getElementById("nombre-salaires").disabled) doc.getElementById("annuler-salaires").click();
      if (!dialogueSaisie.open && !dialogueGuide.open) doc.documentElement.classList.remove("dialogue-ouvert");
    });
    dialogue.addEventListener("click", function (e) {
      if (e.target !== dialogue) return;
      var r = dialogue.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialogue.close();
    });
  });
  doc.querySelectorAll("[data-close-dialog]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });
  function placerFormulaire() {
    var destination = doc.getElementById(mobile.matches ? "saisie-mobile-hote" : "saisie-hote");
    if (form.parentNode !== destination) destination.appendChild(form);
    if (!mobile.matches && dialogueSaisie.open) dialogueSaisie.close();
  }
  mobile.addEventListener("change", placerFormulaire);
  placerFormulaire();
  doc.getElementById("ouvrir-saisie").addEventListener("click", function () { ouvrirDialogue(dialogueSaisie); });
  doc.getElementById("voir-resultat-mobile").addEventListener("click", function () { dialogueSaisie.close(); });
  doc.getElementById("ouvrir-guide").addEventListener("click", function () { ouvrirDialogue(dialogueGuide); });
  doc.querySelectorAll("[data-open-guide]").forEach(function (b) {
    b.addEventListener("click", function () { ouvrirDialogue(dialogueGuide); });
  });

  function ouvrirComparaison() {
    if (dialogueSaisie.open) dialogueSaisie.close();
    selectionnerVue("comparer", true);
    synchroniserResume();
    planifierResume();
  }
  doc.getElementById("ajouter-b").addEventListener("click", ouvrirComparaison);
  doc.getElementById("aug-vers-b").addEventListener("click", ouvrirComparaison);
  doc.getElementById("creer-comparaison").addEventListener("click", function () { doc.getElementById("ajouter-b").click(); });
  doc.getElementById("retirer-b").addEventListener("click", synchroniserResume);

  function synchroniserResume() {
    var secteur = doc.querySelector('input[name="secteur"]:checked').value === "public" ? "Public" : "Privé";
    var periode = doc.querySelector('input[name="periode"]:checked').value === "annuel" ? "/ an" : "/ mois";
    var etat;
    try { etat = window.EtatSimulation.decoder(location.search); } catch (e) { etat = null; }
    var actif = doc.getElementById("onglet-B").getAttribute("aria-selected") === "true" ? "b" : "a";
    var salaires = etat && etat[actif] ? etat[actif].nombreSalaires : 12;
    doc.getElementById("resume-saisie-mobile").textContent = doc.getElementById("montant").value + " DT " + periode + " · " + secteur + " · " + salaires + " salaires";
    var famille = doc.getElementById("chef").checked || Number(doc.getElementById("parents").value) > 0;
    var complements = ["primes", "non-cotisables", "avantages", "indemnites"].some(function (id) {
      return Number(doc.getElementById(id).value.replace(/\s/g, "").replace(",", ".")) > 0;
    });
    [["famille", famille], ["complements", complements]].forEach(function (x) {
      var badge = doc.getElementById("badge-" + x[0]);
      badge.hidden = !x[1];
      badge.textContent = "•";
      badge.setAttribute("aria-label", "Informations renseignées");
    });
    doc.getElementById("comparaison-vide").hidden = !doc.getElementById("comparateur").hidden;
  }
  var resumeTimer;
  function planifierResume() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(synchroniserResume, 600);
  }
  form.addEventListener("input", planifierResume);
  form.addEventListener("change", planifierResume);
  form.addEventListener("click", planifierResume);
  form.addEventListener("reset", function () { selectionnerFormulaire("salaire"); planifierResume(); });
  new MutationObserver(synchroniserResume).observe(doc.getElementById("comparateur"), { attributes: true, attributeFilter: ["hidden"] });
  synchroniserResume();
  planifierResume();
})();
