/* ==========================================================================
   66. GÉNÉRATEUR DE DOCUMENTS RH
       La RH émet en un clic attestations, certificats et ordres de mission :
       numéro, QR code de vérification, registre, annulation. Les demandes de
       documents en attente se traitent directement depuis cet écran. Chaque
       collaborateur retrouve ses documents dans « Mes documents ».
   ========================================================================== */
const GEN_STATUTS_DEMANDE = { demandee: "Demandée", en_cours: "En cours" };

function genEtat() {
  return etat.filtres.generateur || (etat.filtres.generateur = { matricule: "", type: "attestation_travail", demande: null, recherche: "", valeurs: {} });
}

function genChamp(c, valeur) {
  const v = valeur == null ? "" : echapper(String(valeur));
  const type = c.type === "date" ? "date" : c.type === "nombre" ? "text" : "text";
  return `<div class="champ"><label>${echapper(c.libelle)}${c.requis ? " *" : ""}</label>
    <input class="saisie" data-gen-champ="${c.cle}" type="${type}" value="${v}" ${c.type === "nombre" ? 'inputmode="decimal" placeholder="0,000"' : ""}></div>`;
}

VUES["/generateur"] = function () {
  if (!connecte()) return reserveServeur("Le générateur de documents");
  if (!estAdmin()) return etatVide("bouclier", "Réservé à la RH", "Le générateur de documents est réservé à l'administration RH.");
  const f = genEtat();
  const types = chargerEtat("genTypes", () => API.appel("/api/generateur/types"));
  const demandes = chargerEtat("genDemandes", () => sirhAppel("/documents"));
  const registre = chargerEtat("genRegistre", () => API.appel(`/api/generateur/registre${f.recherche ? `?q=${encodeURIComponent(f.recherche)}` : ""}`));
  if (!Array.isArray(types)) return `<section class="carte">${squelette(260)}</section>`;
  const type = types.find((t) => t.type === f.type) || types[0];
  const collegues = EMPLOYES.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  const enAttente = Array.isArray(demandes) ? demandes.filter((d) => GEN_STATUTS_DEMANDE[d.statut]) : [];

  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h2>Émettre un document</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">Numéroté, avec QR code de vérification, inscrit au registre et déposé dans « Mes documents » du collaborateur.</p></div></div>
    ${f.demande ? `<div class="bandeau-info succes" style="margin-bottom:10px">${ico("inbox")}<span style="flex:1">Traitement de la demande n° ${f.demande} : le document lui sera rattaché et le collaborateur prévenu.</span>
      <button class="btn petit" id="gen-sans-demande">Détacher</button></div>` : ""}
    <div class="ligne-champs">
      <div class="champ"><label>Collaborateur *</label><select class="saisie" id="gen-matricule"><option value="">Choisir…</option>
        ${collegues.map((e) => `<option value="${e.matricule}" ${e.matricule === f.matricule ? "selected" : ""}>${echapper(nomComplet(e))} · ${e.matricule}</option>`).join("")}</select></div>
      <div class="champ"><label>Document *</label><select class="saisie" id="gen-type">
        ${types.map((t) => `<option value="${t.type}" ${t.type === type.type ? "selected" : ""}>${echapper(t.libelle)}</option>`).join("")}</select></div>
    </div>
    <div class="ligne-champs" style="flex-wrap:wrap">${type.champs.map((c) => genChamp(c, f.valeurs[c.cle])).join("")}</div>
    <p id="gen-erreur" class="msg-erreur" hidden></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <button class="btn primaire" id="gen-emettre">${ico("doc")} Émettre et télécharger</button>
      <button class="btn" id="gen-bilan" ${f.matricule ? "" : "disabled"}>${ico("rapport")} Bilan social individuel</button></div>
    <p class="aide" style="margin-top:6px">Les montants sont proposés à partir de la rémunération saisie ; vérifiez-les avant d'émettre. Un champ requis vide bloque l'émission : aucune valeur n'est supposée.</p>
  </section>

  <section class="carte"><div class="carte-entete"><h3>Demandes de documents à traiter</h3><span class="aide">${enAttente.length} en attente</span></div>
    ${!Array.isArray(demandes) ? squelette(80) : enAttente.length ? `<div class="tableau-boite"><table style="min-width:560px"><thead><tr><th>Collaborateur</th><th>Document</th><th>Motif</th><th>Demandé le</th><th></th></tr></thead><tbody>
      ${enAttente.map((d) => `<tr><td><strong style="font-size:13px">${echapper(d.employe.prenom + " " + d.employe.nom)}</strong></td><td>${echapper(d.libelle)}</td>
        <td style="font-size:12.5px">${echapper(d.motif || "—")}</td><td class="mono">${fmtDate(String(d.cree_le).slice(0, 10))}</td>
        <td class="droite">${types.some((t) => t.type === d.type) ? `<button class="btn petit primaire" data-gen-demande="${d.id}">${ico("fleche")} Préparer</button>` : `<span class="aide">à traiter à la main</span>`}</td></tr>`).join("")}</tbody></table></div>`
      : etatVide("check", "Aucune demande en attente", "Les nouvelles demandes des collaborateurs apparaîtront ici.")}
  </section>

  <section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><h3>Registre des documents émis</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="saisie" id="gen-recherche" placeholder="N°, nom ou matricule" value="${echapper(f.recherche)}" style="width:200px">
      <input class="saisie" id="gen-code" placeholder="Code de vérification" style="width:170px"><button class="btn petit" id="gen-verifier">${ico("bouclier")} Vérifier</button></div></div>
    ${!Array.isArray(registre) ? squelette(120) : registre.length ? `<div class="tableau-boite"><table style="min-width:720px"><thead><tr><th>N°</th><th>Document</th><th>Collaborateur</th><th>Émis le</th><th>Par</th><th>État</th><th></th></tr></thead><tbody>
      ${registre.map((d) => `<tr><td class="mono">${echapper(d.numero)}</td><td>${echapper(d.libelle)}</td><td>${echapper(d.employe.prenom + " " + d.employe.nom)}</td>
        <td class="mono">${dateServeur(d.emis_le).toLocaleDateString("fr-FR")}</td><td style="font-size:12.5px">${echapper(d.emis_par || "—")}</td>
        <td>${d.annule_le ? `<span class="badge annulee" title="${echapper(d.motif_annulation || "")}">Annulé</span>` : `<span class="badge approuvee">Valide</span>`}</td>
        <td class="droite" style="white-space:nowrap"><button class="btn petit" data-gen-pdf="${d.id}" data-gen-numero="${echapper(d.numero)}">${ico("telecharger")}</button>
          ${d.annule_le ? "" : `<button class="btn petit" data-gen-annuler="${d.id}" title="Annuler">${ico("croix")}</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : etatVide("doc", "Aucun document émis", "Les documents émis apparaîtront ici avec leur numéro.")}
  </section>`;
};

function genValeursSaisies() {
  const valeurs = {};
  $$("[data-gen-champ]").forEach((c) => { valeurs[c.dataset.genChamp] = c.value.trim(); });
  return valeurs;
}

async function genPreRemplir() {
  const f = genEtat();
  if (!f.matricule) return;
  try {
    const connues = await API.appel(`/api/generateur/pre-remplissage/${encodeURIComponent(f.matricule)}?type_document=${f.type}`);
    f.valeurs = { ...connues, ...Object.fromEntries(Object.entries(f.valeurs).filter(([, v]) => v !== "")) };
    rendre(false);
  } catch (souci) { toast("Pré-remplissage impossible", souci.message, "alerte"); }
}

BRANCHEMENTS["/generateur"] = function () {
  const f = etat.filtres.generateur;
  if (!f || !$("#gen-type")) return;
  $("#gen-matricule").addEventListener("change", (e) => { f.matricule = e.target.value; f.valeurs = {}; f.demande = null; genPreRemplir(); rendre(false); });
  $("#gen-type").addEventListener("change", (e) => { f.type = e.target.value; f.valeurs = {}; genPreRemplir(); rendre(false); });
  $$("[data-gen-champ]").forEach((c) => c.addEventListener("input", () => { f.valeurs[c.dataset.genChamp] = c.value; }));
  $("#gen-sans-demande")?.addEventListener("click", () => { f.demande = null; rendre(false); });
  $("#gen-bilan")?.addEventListener("click", () => {
    const annee = new Date().getFullYear();
    telechargerFichier(`/api/bilan-individuel/${encodeURIComponent(f.matricule)}.pdf?annee=${annee}`, `bilan-individuel-${f.matricule}.pdf`, "Bilan social individuel");
  });
  $("#gen-emettre").addEventListener("click", async (ev) => {
    const erreur = $("#gen-erreur");
    erreur.hidden = true;
    if (!f.matricule) { erreur.textContent = "Choisissez le collaborateur."; erreur.hidden = false; return; }
    ev.currentTarget.disabled = true;
    try {
      const doc = await API.appel("/api/generateur/generer", { methode: "POST", corps: { matricule: f.matricule, type_document: f.type, champs: genValeursSaisies(), demande_id: f.demande } });
      toast("Document émis", `${doc.libelle} n° ${doc.numero}`, "succes");
      await telechargerFichier(`/api/generateur/${doc.id}/pdf`, `RH-${doc.numero}.pdf`, doc.libelle);
      f.valeurs = {}; f.demande = null;
      etat.genRegistre = null; etat.genDemandes = null; etat.mesDocumentsDemandes = null;
      rendre(false);
    } catch (souci) { erreur.textContent = souci.message; erreur.hidden = false; ev.currentTarget.disabled = false; }
  });
  $$("[data-gen-demande]").forEach((b) => b.addEventListener("click", () => {
    const d = (etat.genDemandes || []).find((x) => String(x.id) === b.dataset.genDemande);
    if (!d) return;
    f.matricule = d.employe.matricule; f.type = d.type; f.demande = d.id; f.valeurs = d.motif ? { motif: d.motif } : {};
    genPreRemplir();
    rendre(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  $$("[data-gen-pdf]").forEach((b) => b.addEventListener("click", () =>
    telechargerFichier(`/api/generateur/${b.dataset.genPdf}/pdf`, `RH-${b.dataset.genNumero}.pdf`, `Document ${b.dataset.genNumero}`)));
  $$("[data-gen-annuler]").forEach((b) => b.addEventListener("click", async () => {
    const motif = prompt("Motif de l'annulation (il sera visible à la vérification du document) :");
    if (!motif || motif.trim().length < 3) return;
    try { await API.appel(`/api/generateur/${b.dataset.genAnnuler}/annuler`, { methode: "POST", corps: { motif: motif.trim() } });
      etat.genRegistre = null; toast("Document annulé", "Le collaborateur est prévenu.", "succes"); rendre(false); }
    catch (souci) { toast("Annulation impossible", souci.message, "danger"); }
  }));
  const recherche = $("#gen-recherche");
  recherche.addEventListener("change", () => { f.recherche = recherche.value.trim(); etat.genRegistre = null; rendre(false); });
  $("#gen-verifier").addEventListener("click", async () => {
    const code = $("#gen-code").value.trim();
    if (!code) return;
    try {
      const v = await API.appel(`/api/generateur/verifier/${encodeURIComponent(code)}?format=json`);
      if (!v.trouve) toast("Document inconnu", "Aucun document ne porte ce code.", "danger");
      else if (!v.valide) toast("Document annulé", `${v.libelle} n° ${v.numero} (${v.titulaire}) — annulé le ${v.annule_le}.`, "alerte");
      else toast("Document authentique", `${v.libelle} n° ${v.numero}, émis le ${v.emis_le} pour ${v.titulaire}.`, "succes");
    } catch (souci) { toast("Vérification impossible", souci.message, "danger"); }
  });
};

TITRES["/generateur"] = "Générateur de documents";
const menuAvantGenerateur = menuNavigation;
menuNavigation = function () {
  const groupes = menuAvantGenerateur();
  if (!estAdmin()) return groupes;
  const pilotage = groupes.find((g) => g.titre === "Pilotage");
  if (pilotage && !pilotage.items.some((i) => i.route === "/generateur")) pilotage.items.push({ route: "/generateur", libelle: "Générateur de documents", icone: "doc" });
  return groupes;
};
const naviguerAvantGenerateur = naviguer;
naviguer = function (route) {
  if (route === "/generateur") { etat.genRegistre = null; etat.genDemandes = null; }
  if (route === "/documents") etat.mesDocumentsEmis = null;
  return naviguerAvantGenerateur(route);
};
const deconnexionAvantGenerateur = deconnexion;
deconnexion = function (...args) {
  delete etat.filtres.generateur;
  etat.genTypes = null; etat.genRegistre = null; etat.genDemandes = null; etat.mesDocumentsEmis = null;
  return deconnexionAvantGenerateur(...args);
};

/* --- « Mes documents » : documents émis à mon nom -------------------------- */
const vueDocumentsAvantGenerateur = VUES["/documents"];
VUES["/documents"] = function () {
  const base = vueDocumentsAvantGenerateur();
  if (!connecte()) return base;
  const emis = chargerEtat("mesDocumentsEmis", () => API.appel("/api/generateur/mes-documents"));
  if (!Array.isArray(emis) || !emis.length) return base;
  return `<section class="carte"><div class="carte-entete"><h3>Documents émis par la RH</h3><span class="aide">Chaque document porte un QR code de vérification</span></div>
    <div class="tableau-boite"><table style="min-width:auto"><tbody>${emis.map((d) => `<tr>
      <td><strong style="font-size:13px">${echapper(d.libelle)}</strong><div style="font-size:11.5px;color:var(--encre-3)">n° ${echapper(d.numero)} · émis le ${dateServeur(d.emis_le).toLocaleDateString("fr-FR")}</div></td>
      <td class="droite"><button class="btn petit" data-mes-doc="${d.id}" data-mes-numero="${echapper(d.numero)}">${ico("telecharger")} Télécharger</button></td></tr>`).join("")}</tbody></table></div>
  </section>` + base;
};
const brancherDocumentsAvantGenerateur = BRANCHEMENTS["/documents"] || function () {};
BRANCHEMENTS["/documents"] = function () {
  brancherDocumentsAvantGenerateur();
  $$("[data-mes-doc]").forEach((b) => b.addEventListener("click", () =>
    telechargerFichier(`/api/generateur/${b.dataset.mesDoc}/pdf`, `RH-${b.dataset.mesNumero}.pdf`, "Document RH")));
  // Une demande traitée par le générateur pointe vers l'API : le lien simple
  // n'enverrait pas le jeton de connexion, on passe par le téléchargement.
  $$('a[href*="/api/generateur/"]').forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const chemin = a.getAttribute("href").replace(API.base || "", "");
    telechargerFichier(chemin, "document-rh.pdf", "Document RH");
  }));
};
