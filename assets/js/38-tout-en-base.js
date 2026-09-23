/* ==========================================================================
   38. TOUT EN BASE
   En mode connecté, chaque rubrique lit et écrit dans la base : notes de
   frais, formations, paramètres RH, plannings (déplacement, suppression,
   duplication), justificatifs, import de pointages, demande de correction,
   préférences de notification et journal d'audit.
   ========================================================================== */

/* --- Outils ------------------------------------------------------------------ */
async function televerser(chemin, fichier) {
  const donnees = new FormData();
  donnees.append("fichier", fichier);
  let reponse;
  try {
    reponse = await fetch(API.base + chemin, { method: "POST", headers: { Authorization: `Bearer ${API.token}` }, body: donnees });
  } catch { throw new Error("Le serveur ne répond pas. Relancez DEMARRER.bat."); }
  const corps = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new Error(corps && typeof corps.detail === "string" ? corps.detail : `Erreur ${reponse.status}`);
  return corps;
}
const lienFichier = (chemin) => `${API.base || ""}${chemin}`;
const saisieEnCoursOuModale = () => (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName))
  || !!$("#couche").innerHTML;

/* --- Notes de frais ------------------------------------------------------------ */
function peutDeciderNote(n) {
  const e = parMatricule[n.matricule];
  if (!e) return false;
  if (e.validateur && parMatricule[e.validateur]) return e.validateur === moi().matricule;
  return estAdmin();
}
function versNoteLocale(n) {
  return {
    id: n.id, matricule: n.employe.matricule, reference: n.reference, periode: n.periode, statut: n.statut, total: n.total,
    cree: new Date(n.cree_le), mission: n.mission_reference, motif: n.motif_refus,
    justificatifs: n.justificatifs || [],
    lignes: n.lignes.map((l) => ({ date: l.date, categorie: l.categorie, libelle: l.libelle || "", montant: l.montant })),
  };
}
async function chargerFrais() {
  const notes = await API.appel("/api/frais");
  NOTES_FRAIS.length = 0;
  notes.forEach((n) => NOTES_FRAIS.push(versNoteLocale(n)));
}
async function enregistrerNoteApi(statut, lignes, periode, mission, fichiers) {
  try {
    const note = await API.appel("/api/frais", { methode: "POST", corps: {
      periode, mission_reference: mission || null, transmettre: statut === "en_attente",
      lignes: lignes.map((l) => ({ date: l.date, categorie: l.categorie, libelle: l.libelle || null, montant: Number(l.montant) })),
    } });
    for (const fichier of [...(fichiers || [])]) await televerser(`/api/frais/${note.id}/justificatifs`, fichier);
    await chargerFrais();
    fermerCouche();
    toast(statut === "brouillon" ? "Brouillon enregistré en base" : "Note transmise",
      `${note.reference} · ${dinars(note.total)}${statut === "brouillon" ? "" : " — votre supérieur est notifié."}`, "succes");
    rendre(false);
  } catch (souci) { toast("Note non enregistrée", souci.message, "danger"); }
}
async function actionNoteApi(chemin, titre, message, corps) {
  try {
    await API.appel(chemin, { methode: "POST", corps });
    await chargerFrais();
    fermerCouche();
    toast(titre, message, "succes");
    rendre(false);
  } catch (souci) { toast("Action refusée", souci.message, "danger"); }
}
function deciderNoteApi(n, approuve) {
  const e = parMatricule[n.matricule];
  if (approuve) return actionNoteApi(`/api/frais/${n.id}/approuver`, "Note approuvée", `${n.reference} · ${nomComplet(e)} et la RH sont notifiés.`);
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete"><div><h2>Refuser la note de frais</h2><div class="sous">${n.reference} · ${echapper(nomComplet(e))} · ${dinars(n.total)}</div></div></div>
      <div class="modale-corps"><div class="champ"><label for="frais-motif">Motif du refus</label>
        <textarea class="saisie" id="frais-motif" placeholder="Justificatif manquant, dépense hors mission…"></textarea></div></div>
      <div class="modale-pied"><button class="btn" id="frais-motif-annuler">Annuler</button>
        <button class="btn danger" id="frais-motif-ok">${ico("croix")} Refuser</button></div>
    </div>`);
  $("#frais-motif-annuler").addEventListener("click", fermerCouche);
  $("#frais-motif-ok").addEventListener("click", () => {
    const motif = $("#frais-motif").value.trim();
    if (motif.length < 3) return toast("Motif requis", "Indiquez la raison du refus au collaborateur.", "danger");
    actionNoteApi(`/api/frais/${n.id}/rejeter`, "Note refusée", `${nomComplet(e)} a été notifié.`, { motif });
  });
}
function rembourserNote(n) {
  if (connecte()) return actionNoteApi(`/api/frais/${n.id}/rembourser`, "Note remboursée", `${n.reference} · ${nomComplet(parMatricule[n.matricule])} est notifié.`);
  n.statut = "remboursee";
  notifierDemo(n.matricule, "Note de frais remboursée", `${n.reference} · ${dinars(n.total)} mis en paiement.`, "succes", "/notes-de-frais");
  fermerCouche();
  toast("Note remboursée", n.reference, "succes");
  rendre(false);
}
const brancherFraisAvantBase = BRANCHEMENTS["/notes-de-frais"];
BRANCHEMENTS["/notes-de-frais"] = function () {
  brancherFraisAvantBase();
  $$("[data-frais-rembourser]").forEach((b) => b.addEventListener("click", () => rembourserNote(NOTES_FRAIS.find((n) => n.id === Number(b.dataset.fraisRembourser)))));
};

const ouvrirDetailNoteAvantBase = ouvrirDetailNote;
ouvrirDetailNote = function (id) {
  ouvrirDetailNoteAvantBase(id);
  const n = NOTES_FRAIS.find((x) => x.id === id);
  const corps = $(".modale-corps");
  if (!n || !corps) return;
  const infos = [];
  if (n.motif) infos.push(`<div class="bandeau-info alerte">${ico("alerte")}<span><strong>Motif du refus :</strong> ${echapper(n.motif)}</span></div>`);
  if ((n.justificatifs || []).length) {
    infos.push(`<div style="font-size:12.5px"><strong>Justificatifs :</strong> ${n.justificatifs.map((j) => {
      const [chemin, nom] = j.split("::");
      return `<a href="${lienFichier(chemin)}" target="_blank" rel="noopener">${ico("doc")} ${echapper(nom || "fichier")}</a>`;
    }).join(" · ")}</div>`);
  }
  if (infos.length) corps.insertAdjacentHTML("afterbegin", `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">${infos.join("")}</div>`);
  const pied = $(".modale-pied");
  if (estAdmin() && n.statut === "approuvee" && pied) {
    pied.insertAdjacentHTML("beforeend", `<button class="btn succes" id="note-rembourser">${ico("check")} Marquer remboursée</button>`);
    $("#note-rembourser").addEventListener("click", () => rembourserNote(n));
  }
  const pdf = $("#note-pdf");
  if (pdf) {
    const remplacant = pdf.cloneNode(true);
    remplacant.innerHTML = `${ico("telecharger")} Imprimer / PDF`;
    pdf.parentNode.replaceChild(remplacant, pdf);
    remplacant.addEventListener("click", () => imprimerNote(n));
  }
};
function imprimerNote(n) {
  const e = parMatricule[n.matricule] || { prenom: "", nom: "" };
  const fenetre = window.open("", "_blank");
  if (!fenetre) return toast("Impression bloquée", "Autorisez les fenêtres surgissantes pour imprimer la note.", "alerte");
  fenetre.document.write(`<!doctype html><meta charset="utf-8"><title>${n.reference}</title>
    <style>body{font-family:Segoe UI,Arial,sans-serif;color:#072241;margin:32px}h1{font-size:20px;margin:0 0 4px}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}th,td{border:1px solid #DCE2EC;padding:7px;text-align:left}
    th{background:#072241;color:#fff}td.m{text-align:right}p{color:#4A4E56;margin:2px 0}</style>
    <img src="${LOGOS.clair}" style="height:26px"><h1>Note de frais ${n.reference}</h1>
    <p>${echapper(nomComplet(e))} · période ${n.periode} · statut : ${STATUTS_FRAIS[n.statut][1]}</p>
    <table><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th>Montant</th></tr>
    ${n.lignes.map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${CATEGORIES_FRAIS[l.categorie][0]}</td><td>${echapper(l.libelle || "—")}</td><td class="m">${dinars(l.montant)}</td></tr>`).join("")}
    <tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td class="m"><strong>${dinars(n.total)}</strong></td></tr></table>
    <p style="margin-top:40px">Signature du collaborateur : ____________________ &nbsp;&nbsp; Visa du supérieur : ____________________</p>
    <script>setTimeout(() => print(), 300)<\/script>`);
  fenetre.document.close();
}

/* --- Formations ------------------------------------------------------------------ */
async function chargerFormations() {
  const liste = await API.appel("/api/formations");
  FORMATIONS.length = 0;
  liste.forEach((f) => FORMATIONS.push({ id: f.id, titre: f.titre, theme: THEMES_FORMATION.includes(f.theme) ? f.theme : "Technique",
    jours: f.jours, description: f.description || "", debut: f.debut, fin: f.fin, lieu: f.lieu, places: f.places,
    formateur: f.formateur || "—", inscrits: f.inscrits }));
}
const basculerInscriptionLocale = basculerInscription;
basculerInscription = async function (id) {
  if (!connecte()) return basculerInscriptionLocale(id);
  const formation = FORMATIONS.find((x) => x.id === id);
  const inscrit = formation.inscrits.includes(moi().matricule);
  try {
    await API.appel(`/api/formations/${id}/inscription`, { methode: inscrit ? "DELETE" : "POST" });
    await chargerFormations();
    toast(inscrit ? "Désinscription enregistrée" : "Inscription confirmée",
      inscrit ? `${formation.titre} — votre place est libérée.` : `${formation.titre} · ${fmtDateLongue(formation.debut)} — ${formation.lieu}.`, inscrit ? "info" : "succes");
    rendre(false);
  } catch (souci) { toast("Inscription impossible", souci.message, "danger"); }
};
function ouvrirNouvelleSession() {
  const demain = iso(ajouterJours(AUJOURDHUI, 14));
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete"><div><h2>Nouvelle session de formation</h2><div class="sous">Visible par tous les collaborateurs dès l'enregistrement</div></div></div>
      <div class="modale-corps">
        <div class="champ"><label for="fo-titre">Intitulé</label><input class="saisie" id="fo-titre"></div>
        <div class="ligne-champs">
          <div class="champ"><label for="fo-theme">Thématique</label><select class="saisie" id="fo-theme">${THEMES_FORMATION.map((t) => `<option>${t}</option>`).join("")}</select></div>
          <div class="champ"><label for="fo-places">Places</label><input class="saisie" type="number" id="fo-places" value="12" min="1" max="500"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="fo-debut">Début</label><input class="saisie" type="date" id="fo-debut" value="${demain}"></div>
          <div class="champ"><label for="fo-fin">Fin</label><input class="saisie" type="date" id="fo-fin" value="${demain}"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="fo-lieu">Lieu</label><input class="saisie" id="fo-lieu" value="Siège — Tunis"></div>
          <div class="champ"><label for="fo-formateur">Formateur</label><input class="saisie" id="fo-formateur" placeholder="Organisme ou intervenant"></div>
        </div>
        <div class="champ"><label for="fo-description">Description</label><textarea class="saisie" id="fo-description"></textarea></div>
      </div>
      <div class="modale-pied"><button class="btn" id="fo-annuler">Annuler</button><button class="btn primaire" id="fo-creer">${ico("check")} Publier la session</button></div>
    </div>`);
  $("#fo-annuler").addEventListener("click", fermerCouche);
  $("#fo-creer").addEventListener("click", async () => {
    const donnees = { titre: $("#fo-titre").value.trim(), theme: $("#fo-theme").value, places: Number($("#fo-places").value),
      date_debut: $("#fo-debut").value, date_fin: $("#fo-fin").value, lieu: $("#fo-lieu").value.trim(),
      formateur: $("#fo-formateur").value.trim() || null, description: $("#fo-description").value.trim() || null };
    if (donnees.titre.length < 3 || !donnees.lieu) return toast("Champs manquants", "Intitulé et lieu sont obligatoires.", "danger");
    if (donnees.date_fin < donnees.date_debut) return toast("Dates invalides", "La fin précède le début.", "danger");
    try {
      if (connecte()) { await API.appel("/api/formations", { methode: "POST", corps: donnees }); await chargerFormations(); }
      else FORMATIONS.push({ id: Date.now(), titre: donnees.titre, theme: donnees.theme, description: donnees.description || "",
        debut: donnees.date_debut, fin: donnees.date_fin, jours: joursOuvres(depuisIso(donnees.date_debut), depuisIso(donnees.date_fin)) || 1,
        lieu: donnees.lieu, places: donnees.places, formateur: donnees.formateur || "—", inscrits: [] });
      fermerCouche();
      toast("Session publiée", donnees.titre, "succes");
      rendre(false);
    } catch (souci) { toast("Publication impossible", souci.message, "danger"); }
  });
}
const brancherFormationsAvantBase = BRANCHEMENTS["/formations"];
BRANCHEMENTS["/formations"] = function () {
  brancherFormationsAvantBase();
  if (!estAdmin()) return;
  const mesFormations = $("#formation-miennes");
  if (mesFormations && !$("#formation-nouvelle")) {
    mesFormations.insertAdjacentHTML("afterend", `<button class="btn primaire petit" id="formation-nouvelle">${ico("plus")} Nouvelle session</button>`);
    $("#formation-nouvelle").addEventListener("click", ouvrirNouvelleSession);
  }
  $$("[data-formation]").forEach((b) => {
    b.insertAdjacentHTML("beforebegin", `<button class="btn petit fantome btn-bloc" data-retirer-formation="${b.dataset.formation}" style="margin-top:auto">${ico("poubelle")} Retirer la session</button>`);
    b.style.marginTop = "6px";
  });
  $$("[data-retirer-formation]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.dataset.retirerFormation);
    const formation = FORMATIONS.find((x) => x.id === id);
    if (!confirm(`Retirer « ${formation.titre} » ? Les ${formation.inscrits.length} inscrit(s) seront notifiés.`)) return;
    try {
      if (connecte()) { await API.appel(`/api/formations/${id}`, { methode: "DELETE" }); await chargerFormations(); }
      else FORMATIONS.splice(FORMATIONS.indexOf(formation), 1);
      toast("Session retirée", formation.titre, "info");
      rendre(false);
    } catch (souci) { toast("Retrait impossible", souci.message, "danger"); }
  }));
};

/* --- Paramètres RH ------------------------------------------------------------------ */
let TYPES_INACTIFS = new Set();
function appliquerParametres(p) {
  Object.assign(REGLES, p.regles);
  TYPES_INACTIFS = new Set(p.types_conge_inactifs);
  Object.keys(FERIES_MOBILES).forEach((k) => delete FERIES_MOBILES[k]);
  p.feries_mobiles.forEach((f) => { FERIES_MOBILES[f.date] = f.nom; });
  for (let i = JOURS_FERIES_CONFIG.length - 1; i >= 0; i--) if (JOURS_FERIES_CONFIG[i][2] === "mobile") JOURS_FERIES_CONFIG.splice(i, 1);
  p.feries_mobiles.forEach((f) => JOURS_FERIES_CONFIG.push([fmtDate(f.date), f.nom, "mobile", f.date]));
}
async function chargerParametres() { appliquerParametres(await API.appel("/api/parametres")); }

const ouvrirDemandeAvantTypes = ouvrirDemande;
ouvrirDemande = function (type) {
  ouvrirDemandeAvantTypes(type);
  if (type !== "conge") return;
  $$("#d-type option").forEach((o) => { if (TYPES_INACTIFS.has(o.value)) o.remove(); });
};

const brancherParametresAvantBase = BRANCHEMENTS["/parametres"];
BRANCHEMENTS["/parametres"] = function () {
  brancherParametresAvantBase();
  const f = etat.filtres.parametres;
  const envoyer = async (chemin, methode, corps, titre, message) => {
    try {
      if (connecte()) appliquerParametres(await API.appel(chemin, { methode, corps }));
      toast(titre, message, "succes");
      rendre(false);
    } catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
  };

  if (f.onglet === "types") {
    $$("[data-type-actif]").forEach((c) => {
      const clone = c.cloneNode(true);
      clone.checked = !TYPES_INACTIFS.has(c.dataset.typeActif);
      if (c.dataset.typeActif === "annuel") { clone.disabled = true; clone.title = "Le congé annuel reste toujours proposé"; }
      c.parentNode.replaceChild(clone, c);
      clone.addEventListener("change", () => {
        const inactifs = $$("[data-type-actif]").filter((x) => !x.checked).map((x) => x.dataset.typeActif);
        if (!connecte()) TYPES_INACTIFS = new Set(inactifs);
        envoyer("/api/parametres/types-conge", "PUT", { inactifs }, clone.checked ? "Type réactivé" : "Type désactivé",
          `« ${libelleType("conge", clone.dataset.typeActif)} » ${clone.checked ? "est de nouveau proposé" : "n'est plus proposé"} dans les formulaires.`);
      });
    });
  }
  const bouton = $("#p-enregistrer");
  if (bouton) {
    const clone = bouton.cloneNode(true);
    bouton.parentNode.replaceChild(clone, bouton);
    clone.addEventListener("click", () => {
      const regles = { seuilDoubleValidation: Number($("#p-seuil").value), delaiReponse: Number($("#p-delai").value),
        reportMax: Number($("#p-report").value), heureArrivee: $("#p-arrivee").value,
        toleranceRetard: Number($("#p-tolerance").value), dureeJournee: Number($("#p-duree").value) };
      if (!connecte()) Object.assign(REGLES, regles);
      envoyer("/api/parametres/regles", "PUT", regles, "Règles enregistrées",
        "Double validation, badgeage et tolérance s'appliquent dès maintenant aux nouvelles demandes et pointages.");
    });
  }
  if (f.onglet === "feries") {
    const grille = $("#contenu .grille");
    if (grille) {
      grille.innerHTML = JOURS_FERIES_CONFIG.map(([date, nom, type, isoDate]) => `
        <div style="display:flex;align-items:center;gap:11px;padding:12px;border:1px solid var(--trait);border-radius:var(--r-m)">
          <div class="kpi-ico" style="background:${type === "fixe" ? "var(--marine-doux)" : "var(--rouge-doux)"};color:${type === "fixe" ? "var(--marine)" : "var(--rouge)"}">${ico("calendrier")}</div>
          <div style="min-width:0;flex:1"><strong style="font-size:13px;display:block">${echapper(nom)}</strong>
            <span style="font-size:11.5px;color:var(--encre-3)" class="mono">${date} · ${type === "fixe" ? "date fixe" : "date mobile"}</span></div>
          ${type === "mobile" && isoDate ? `<button class="btn icone fantome" data-retirer-ferie="${isoDate}" title="Retirer">${ico("poubelle")}</button>` : ""}
        </div>`).join("");
      $$("[data-retirer-ferie]").forEach((b) => b.addEventListener("click", () => {
        const jour = b.dataset.retirerFerie;
        if (!connecte()) { const i = JOURS_FERIES_CONFIG.findIndex((x) => x[3] === jour); JOURS_FERIES_CONFIG.splice(i, 1); delete FERIES_MOBILES[jour]; }
        envoyer(`/api/parametres/feries/${jour}`, "DELETE", undefined, "Jour férié retiré", fmtDateLongue(jour));
      }));
    }
    const ajouter = $("#p-ajouter-ferie");
    if (ajouter) {
      const clone = ajouter.cloneNode(true);
      ajouter.parentNode.replaceChild(clone, ajouter);
      clone.addEventListener("click", () => {
        ouvrirCouche(`
          <div class="modale" role="dialog" aria-modal="true">
            <div class="modale-tete"><div><h2>Ajouter un jour férié</h2><div class="sous">Fêtes religieuses : dates fixées chaque année</div></div></div>
            <div class="modale-corps"><div class="ligne-champs">
              <div class="champ"><label for="fe-date">Date</label><input class="saisie" type="date" id="fe-date" value="${iso(AUJOURDHUI)}"></div>
              <div class="champ"><label for="fe-nom">Fête</label><input class="saisie" id="fe-nom" placeholder="Aïd el-Fitr"></div>
            </div></div>
            <div class="modale-pied"><button class="btn" id="fe-annuler">Annuler</button><button class="btn primaire" id="fe-ok">${ico("check")} Ajouter</button></div>
          </div>`);
        $("#fe-annuler").addEventListener("click", fermerCouche);
        $("#fe-ok").addEventListener("click", () => {
          const date = $("#fe-date").value, nom = $("#fe-nom").value.trim();
          if (!date || nom.length < 2) return toast("Champs manquants", "Indiquez la date et le nom de la fête.", "danger");
          if (!connecte()) { FERIES_MOBILES[date] = nom; JOURS_FERIES_CONFIG.push([fmtDate(date), nom, "mobile", date]); }
          fermerCouche();
          envoyer("/api/parametres/feries", "POST", { date, nom }, "Jour férié ajouté", `${nom} — ${fmtDateLongue(date)} : exclu du décompte des congés.`);
        });
      });
    }
  }
};

/* --- Plannings : déplacement, suppression, duplication en base ------------ */
const deplacerCreneauLocal = deplacerCreneau;
deplacerCreneau = async function (id, matricule, date) {
  if (!connecte()) return deplacerCreneauLocal(id, matricule, date);
  const creneau = PLANNINGS.find((p) => p.id === id || String(p.id) === String(id));
  if (!creneau) return;
  if (PLANNINGS.some((p) => p.matricule === matricule && p.date === date)) return toast("Cellule occupée", "Ce collaborateur a déjà un créneau ce jour-là.", "danger");
  try {
    await API.appel("/api/plannings/creneau", { methode: "PUT", corps: { employe_id: parMatricule[matricule].id, date_jour: date,
      poste: creneau.poste, heure_debut: `${String(creneau.debut).slice(0, 5)}:00`, heure_fin: `${String(creneau.fin).slice(0, 5)}:00`, note: creneau.note || null } });
    await API.appel(`/api/plannings/creneau/${creneau.id}`, { methode: "DELETE" });
    await rafraichirPlannings([...new Set([creneau.semaine, semaineIso(depuisIso(date))])]);
    toast("Créneau déplacé", `${nomComplet(parMatricule[matricule])} · ${fmtDateLongue(date)} — enregistré en base.`, "succes");
    rendre(false);
  } catch (souci) { toast("Déplacement refusé", souci.message, "danger"); }
};
const ouvrirEditionCreneauAvantSuppression = ouvrirEditionCreneau;
ouvrirEditionCreneau = function (id, matricule, date) {
  ouvrirEditionCreneauAvantSuppression(id, matricule, date);
  if (!connecte()) return;
  const bouton = $("#supprimer-creneau");
  const creneau = id ? PLANNINGS.find((p) => p.id === id || String(p.id) === String(id)) : null;
  if (!bouton || !creneau) return;
  const clone = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(clone, bouton);
  clone.addEventListener("click", async () => {
    try {
      await API.appel(`/api/plannings/creneau/${creneau.id}`, { methode: "DELETE" });
      await rafraichirPlannings([creneau.semaine]);
      fermerCouche();
      toast("Créneau supprimé", `${fmtDateLongue(creneau.date)} — supprimé de la base.`, "info");
      rendre(false);
    } catch (souci) { toast("Suppression refusée", souci.message, "danger"); }
  });
};
const dupliquerSemaineLocale = dupliquerSemaine;
dupliquerSemaine = async function () {
  if (!connecte()) return dupliquerSemaineLocale();
  const f = etat.filtres.planning;
  const lundiCible = ajouterJours(lundiDe(AUJOURDHUI), f.decalage * 7);
  const source = semaineIso(ajouterJours(lundiCible, -7)), cible = semaineIso(lundiCible);
  try {
    const r = await API.appel(`/api/plannings/dupliquer?source=${source.replace("-S", "-W")}&cible=${cible.replace("-S", "-W")}`, { methode: "POST" });
    await rafraichirPlannings([cible]);
    toast("Semaine dupliquée", `${(r && (r.crees ?? r.creneaux_crees)) ?? ""} créneau(x) copiés depuis ${source} — enregistrés en base.`, "succes");
    rendre(false);
  } catch (souci) { toast("Duplication impossible", souci.message, "danger"); }
};

/* --- Demandes : justificatif enregistré sur le serveur ------------------------ */
const soumettreDemandeApiSansPiece = soumettreDemandeApi;
soumettreDemandeApi = async function (type, f) {
  const champ = $("#d-justificatif");
  if (champ && champ.files[0]) {
    const envoi = await televerser("/api/demandes/piece-jointe", champ.files[0]);
    f.pieceJointe = envoi.chemin;
  }
  return soumettreDemandeApiSansPiece(type, f);
};
const ouvrirDetailDemandeAvantLien = ouvrirDetailDemande;
ouvrirDetailDemande = function (ref) {
  ouvrirDetailDemandeAvantLien(ref);
  const d = DEMANDES.find((x) => x.ref === ref);
  if (!d || !d.justificatif || !String(d.justificatif).startsWith("/fichiers/")) return;
  $$("#couche *").forEach((el) => {
    if (el.children.length === 0 && el.textContent.trim() === d.justificatif) {
      el.innerHTML = `<a href="${lienFichier(d.justificatif)}" target="_blank" rel="noopener">${ico("doc")} Ouvrir le justificatif</a>`;
    }
  });
};

/* --- Administration : import de pointages et journal d'audit en base -------- */
async function chargerJournal() {
  const lignes = await API.appel("/api/administration/audit?limite=300");
  JOURNAL.length = 0;
  lignes.forEach((a) => JOURNAL.push({
    action: a.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), cible: a.cible, detail: a.detail,
    date: new Date(a.horodatage), acteur: a.acteur ? a.acteur.matricule : null,
    acteurNom: a.acteur ? `${a.acteur.prenom} ${a.acteur.nom}` : "Système",
  }));
}
const brancherAdministrationAvantImport = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdministrationAvantImport) brancherAdministrationAvantImport();
  if (!etat.filtres.admin || etat.filtres.admin.onglet !== "import" || !connecte()) return;
  const champ = $("#fichier-import");
  if (champ) {
    champ.setAttribute("accept", ".csv");
    const libelle = champ.closest(".champ") && champ.closest(".champ").querySelector("label");
    if (libelle) libelle.textContent = "Fichier CSV (séparateur ; ou ,)";
  }
  const bouton = $("#lancer-import");
  if (!bouton) return;
  const clone = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(clone, bouton);
  clone.addEventListener("click", async () => {
    const fichier = champ.files[0];
    if (!fichier) return toast("Aucun fichier", "Sélectionnez l'export CSV de la pointeuse.", "danger");
    if (!fichier.name.toLowerCase().endsWith(".csv")) return toast("Format non compatible", "L'import de pointages attend un fichier CSV.", "danger");
    clone.disabled = true; clone.textContent = "Import en cours…";
    try {
      const r = await televerser("/api/administration/import-pointages", fichier);
      await Promise.all([rafraichirPresences(), chargerJournal()]);
      toast("Import terminé", `${r.importes} pointage(s) importé(s), ${r.ignores} ligne(s) ignorée(s)${r.erreurs && r.erreurs.length ? ` — ${r.erreurs[0]}` : ""}.`, r.ignores ? "alerte" : "succes");
    } catch (souci) { toast("Import refusé", souci.message, "danger"); }
    rendre(false);
  });
};

/* --- Mon profil : demande de correction et préférences en base ------------- */
const brancherProfilAvantBase = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantBase();
  const bouton = $("#profil-correction");
  if (bouton) {
    const clone = bouton.cloneNode(true);
    bouton.parentNode.replaceChild(clone, bouton);
    clone.addEventListener("click", () => {
      ouvrirCouche(`
        <div class="modale" role="dialog" aria-modal="true">
          <div class="modale-tete"><div><h2>Demander une correction</h2><div class="sous">Votre message est transmis à l'administration RH</div></div></div>
          <div class="modale-corps"><div class="champ"><label for="corr-message">Que faut-il corriger ?</label>
            <textarea class="saisie" id="corr-message" placeholder="Ex. : mon poste est « Chargé de recouvrement », mon téléphone a changé…"></textarea></div></div>
          <div class="modale-pied"><button class="btn" id="corr-annuler">Annuler</button><button class="btn primaire" id="corr-envoyer">${ico("fleche")} Envoyer</button></div>
        </div>`);
      $("#corr-annuler").addEventListener("click", fermerCouche);
      $("#corr-envoyer").addEventListener("click", async () => {
        const message = $("#corr-message").value.trim();
        if (message.length < 5) return toast("Message trop court", "Précisez l'information à corriger.", "danger");
        try {
          if (connecte()) await API.appel("/api/parametres/correction", { methode: "POST", corps: { message } });
          else EMPLOYES.filter((e) => e.role === "admin" && e.matricule !== moi().matricule).forEach((a) =>
            notifierDemo(a.matricule, "Demande de correction de profil", `${nomComplet(moi())} (${moi().matricule}) : ${message}`, "validation", "/administration"));
          fermerCouche();
          toast("Demande envoyée", "L'administration RH a reçu votre demande de correction.", "succes");
        } catch (souci) { toast("Envoi impossible", souci.message, "danger"); }
      });
    });
  }
  if (!connecte()) return;
  API.appel("/api/parametres/preferences").then((prefs) => {
    stockage.ecrire("portail-notifs", prefs);
    $$("[data-pref]").forEach((c) => { c.checked = !!prefs[c.dataset.pref]; });
  }).catch(() => {});
  $$("[data-pref]").forEach((c) => c.addEventListener("change", () => {
    const prefs = Object.fromEntries($$("[data-pref]").map((x) => [x.dataset.pref, x.checked]));
    API.appel("/api/parametres/preferences", { methode: "PUT", corps: prefs }).catch((souci) => toast("Préférence non enregistrée", souci.message, "danger"));
  }));
};

/* --- Chargement à la connexion et actualisation continue ---------------------- */
const chargerDonneesAvantModules = chargerDonneesApi;
chargerDonneesApi = async function () {
  await chargerDonneesAvantModules();
  await Promise.all([chargerFrais(), chargerFormations(), chargerParametres()].map((p) => p.catch(() => {})));
};
const naviguerAvantModules = naviguer;
naviguer = function (route) {
  if (connecte()) {
    const actions = { "/notes-de-frais": chargerFrais, "/formations": chargerFormations, "/parametres": chargerParametres };
    if (route === "/administration" && estAdmin()) actions[route] = chargerJournal;
    if (actions[route]) actions[route]().then(() => { if (etat.route === route && !saisieEnCoursOuModale()) rendre(false); }).catch(() => {});
  }
  return naviguerAvantModules(route);
};
setInterval(async () => {
  if (!connecte() || !etat.utilisateur) return;
  const suivies = { "/notes-de-frais": chargerFrais, "/formations": chargerFormations };
  const action = suivies[etat.route];
  if (!action) return;
  try { await action(); } catch { return; }
  if (!saisieEnCoursOuModale()) rendre(false);
}, 30000);
