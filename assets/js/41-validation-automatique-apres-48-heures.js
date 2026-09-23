/* ==========================================================================
   41. VALIDATION AUTOMATIQUE APRÈS 48 HEURES
   Le serveur valide d'office les congés et autorisations restés sans réponse
   (délai et activation : Paramètres RH → Workflow & règles). L'échéance est
   affichée au demandeur comme au valideur.
   ========================================================================== */
if (REGLES.delaiReponse === undefined) REGLES.delaiReponse = 48;
if (REGLES.validationAutomatique === undefined) REGLES.validationAutomatique = true;
const versDemandeLocaleAvantEcheance = versDemandeLocale;
versDemandeLocale = function (d) {
  return { ...versDemandeLocaleAvantEcheance(d), validationAuto: d.validation_auto_le ? dateServeur(d.validation_auto_le) : null };
};
const fmtEcheance = (date) => `${fmtDateLongue(iso(date))} à ${String(date.getHours()).padStart(2, "0")}h${String(date.getMinutes()).padStart(2, "0")}`;
const ouvrirDetailDemandeAvantEcheance = ouvrirDetailDemande;
ouvrirDetailDemande = function (ref) {
  ouvrirDetailDemandeAvantEcheance(ref);
  const d = DEMANDES.find((x) => x.ref === ref);
  const corps = $("#couche .tiroir-corps, #couche .modale-corps");
  if (!d || !corps || d.statut !== "en_attente" || !d.validationAuto) return;
  corps.insertAdjacentHTML("afterbegin", `<div class="bandeau-info" style="margin-bottom:12px">${ico("horloge")}<span>
    Sans réponse, cette demande sera <strong>validée automatiquement le ${fmtEcheance(d.validationAuto)}</strong>
    (délai de ${REGLES.delaiReponse} h).</span></div>`);
};
/* File « À valider » : l'échéance de chaque demande en attente. */
const brancherAvantEcheance = brancherVueCourante;
brancherVueCourante = function () {
  brancherAvantEcheance();
  if (etat.route !== "/validation") return;
  $$("[data-demande-ref]").forEach((el) => {
    const d = DEMANDES.find((x) => x.ref === el.dataset.demandeRef);
    if (!d || !d.validationAuto || el.querySelector(".echeance-auto")) return;
    const heures = Math.max(0, Math.round((d.validationAuto - Date.now()) / 3600000));
    const cible = el.querySelector(".meta") || el;
    cible.insertAdjacentHTML("beforeend", `<span class="echeance-auto badge ${heures <= 12 ? "attente" : "neutre"}" title="Validation automatique le ${fmtEcheance(d.validationAuto)}">${ico("horloge")} Validation auto. dans ${heures} h</span>`);
  });
};
