/* ==========================================================================
   49. SÉCURITÉ : DOUBLE AUTHENTIFICATION, HISTORIQUE DES CONNEXIONS
   ========================================================================== */
const LIBELLES_CONNEXION = { succes: ["approuvee", "Réussie"], mot_de_passe: ["rejetee", "Mot de passe incorrect"],
  code_2fa: ["rejetee", "Code incorrect"], bloque: ["rejetee", "Compte bloqué"], inconnu: ["attente", "Matricule inconnu"],
  compte_inactif: ["neutre", "Compte désactivé"] };
const navigateurLisible = (ua) => {
  if (!ua) return "—";
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const sys = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return sys ? `${nav} · ${sys}` : nav;
};

/* --- Étape du code à la connexion ------------------------------------------ */
function demanderCodeDoubleAuth(jetonEtape) {
  return new Promise((resolve, reject) => {
    const boite = document.createElement("div");
    boite.className = "bloc-mdp";
    boite.innerHTML = `<div class="modale" role="dialog" aria-modal="true" style="max-width:420px">
      <div class="modale-tete"><div><h2>Double authentification</h2>
        <div class="sous">Saisissez le code à 6 chiffres affiché dans votre application d'authentification (Microsoft Authenticator, Google Authenticator…).</div></div></div>
      <div class="modale-corps">
        <div class="champ"><label for="code-2fa">Code</label>
          <input class="saisie saisie-code" id="code-2fa" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="000000"></div>
        <span class="aide">Téléphone indisponible ? Saisissez l'un de vos codes de secours (format XXXX-XXXX).</span>
        <div id="erreur-2fa" class="msg-erreur" hidden></div>
      </div>
      <div class="modale-pied"><button class="btn" id="annuler-2fa">Annuler</button>
        <button class="btn primaire" id="valider-2fa">${ico("bouclier")} Valider</button></div></div>`;
    document.body.appendChild(boite);
    const champ = boite.querySelector("#code-2fa");
    const valider = async () => {
      const code = champ.value.trim();
      if (!code) return;
      try {
        const session = await API.appel("/api/auth/2fa/verifier", { methode: "POST", corps: { jeton_etape: jetonEtape, code } });
        boite.remove();
        resolve(session);
      } catch (souci) {
        const e = boite.querySelector("#erreur-2fa"); e.textContent = souci.message; e.hidden = false;
        champ.value = ""; champ.focus();
        if (/bloqué|expirée/.test(souci.message)) { setTimeout(() => { boite.remove(); reject(souci); }, 1800); }
      }
    };
    boite.querySelector("#valider-2fa").addEventListener("click", valider);
    champ.addEventListener("keydown", (e) => { if (e.key === "Enter") valider(); });
    champ.addEventListener("input", () => { if (/^\d{6}$/.test(champ.value.trim())) valider(); });
    boite.querySelector("#annuler-2fa").addEventListener("click", () => { boite.remove(); reject(new Error("Connexion annulée.")); });
    setTimeout(() => champ.focus(), 50);
  });
}

/* --- Activation (imposée aux comptes désignés, facultative pour les autres) - */
let chargementQr = null;
function chargerQr() {
  if (window.QRCode) return Promise.resolve(true);
  if (!chargementQr) chargementQr = new Promise((ok) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = () => ok(true); s.onerror = () => ok(false);
    document.head.appendChild(s);
  });
  return chargementQr;
}

function afficherCodesSecours(codes, titre = "Vos codes de secours") {
  return new Promise((resolve) => {
    const boite = document.createElement("div");
    boite.className = "bloc-mdp";
    boite.innerHTML = `<div class="modale" role="dialog" aria-modal="true" style="max-width:460px">
      <div class="modale-tete"><div><h2>${titre}</h2>
        <div class="sous">Chaque code permet une connexion si votre téléphone est perdu ou indisponible. Ils ne seront plus jamais affichés : notez-les et conservez-les en lieu sûr.</div></div></div>
      <div class="modale-corps"><div class="codes-secours">${codes.map((c) => `<span>${c}</span>`).join("")}</div>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px"><input type="checkbox" id="codes-notes" style="width:16px;height:16px"> J'ai noté mes codes de secours</label></div>
      <div class="modale-pied"><button class="btn" id="copier-codes">${ico("copie")} Copier</button>
        <button class="btn primaire" id="fermer-codes" disabled>${ico("check")} Continuer</button></div></div>`;
    document.body.appendChild(boite);
    boite.querySelector("#codes-notes").addEventListener("change", (e) => { boite.querySelector("#fermer-codes").disabled = !e.target.checked; });
    boite.querySelector("#copier-codes").addEventListener("click", () => {
      navigator.clipboard?.writeText(codes.join("\n")).then(() => toast("Codes copiés", "Collez-les dans un endroit sûr.", "succes")).catch(() => {});
    });
    boite.querySelector("#fermer-codes").addEventListener("click", () => { boite.remove(); resolve(); });
  });
}

function imposerDoubleAuth(obligatoire) {
  return new Promise(async (resolve, reject) => {
    let prep;
    try { prep = await API.appel("/api/auth/2fa/initier", { methode: "POST" }); }
    catch (souci) { toast("Activation impossible", souci.message, "danger"); return reject(souci); }
    const boite = document.createElement("div");
    boite.className = "bloc-mdp";
    boite.innerHTML = `<div class="modale" role="dialog" aria-modal="true" style="max-width:560px">
      <div class="modale-tete"><div><h2>Activer la double authentification</h2>
        <div class="sous">${obligatoire ? "Obligatoire pour ce compte, conformément à la politique de sécurité RH." : "Protège votre compte même si votre mot de passe est découvert."}</div></div></div>
      <div class="modale-corps">
        <ol style="font-size:13px;color:var(--encre-2);padding-left:18px;margin:0 0 12px;display:flex;flex-direction:column;gap:4px">
          <li>Installez <strong>Microsoft Authenticator</strong> ou <strong>Google Authenticator</strong> sur votre téléphone.</li>
          <li>Dans l'application : « Ajouter un compte » puis scannez le QR code (ou saisissez la clé).</li>
          <li>Saisissez ci-dessous le code à 6 chiffres affiché.</li></ol>
        <div class="qr-boite"><div id="qr-2fa"><span class="aide">Chargement…</span></div>
          <div style="flex:1;min-width:200px"><span class="aide">Clé à saisir manuellement :</span>
            <div class="cle-2fa">${prep.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
            <span class="aide" style="display:block;margin-top:6px">Compte : ${echapper(prep.emetteur)}</span></div></div>
        <div class="champ" style="margin-top:14px"><label for="code-activation">Code affiché par l'application</label>
          <input class="saisie saisie-code" id="code-activation" inputmode="numeric" maxlength="6" placeholder="000000"></div>
        <div id="erreur-activation" class="msg-erreur" hidden></div>
      </div>
      <div class="modale-pied">${obligatoire ? `<button class="btn" id="quitter-2fa">${ico("sortie")} Se déconnecter</button>` : `<button class="btn" id="quitter-2fa">Plus tard</button>`}
        <button class="btn primaire" id="activer-2fa">${ico("bouclier")} Activer</button></div></div>`;
    document.body.appendChild(boite);
    chargerQr().then((ok) => {
      const zone = boite.querySelector("#qr-2fa");
      if (!zone) return;
      zone.innerHTML = "";
      if (ok && window.QRCode) new QRCode(zone, { text: prep.uri, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
      else zone.innerHTML = `<span class="aide" style="color:#333;text-align:center">QR code indisponible hors connexion Internet : utilisez la clé.</span>`;
    });
    const champ = boite.querySelector("#code-activation");
    const activer = async () => {
      try {
        const r = await API.appel("/api/auth/2fa/activer", { methode: "POST", corps: { code: champ.value.trim() } });
        boite.remove();
        await afficherCodesSecours(r.codes_secours);
        toast("Double authentification activée", "Le code de votre téléphone sera demandé à chaque connexion.", "succes");
        resolve(true);
      } catch (souci) { const e = boite.querySelector("#erreur-activation"); e.textContent = souci.message; e.hidden = false; }
    };
    boite.querySelector("#activer-2fa").addEventListener("click", activer);
    champ.addEventListener("keydown", (e) => { if (e.key === "Enter") activer(); });
    boite.querySelector("#quitter-2fa").addEventListener("click", () => {
      boite.remove();
      if (obligatoire) { API.token = null; deconnexion(); reject(new Error("Double authentification non activée.")); }
      else resolve(false);
    });
    setTimeout(() => champ.focus(), 60);
  });
}

const chargerDonneesAvantDoubleAuth = chargerDonneesApi;
chargerDonneesApi = async function () {
  let m = await API.appel("/api/auth/moi");
  if (m.doit_changer_mdp) { await imposerChangementMdp(); m = await API.appel("/api/auth/moi"); }
  if (m.double_auth_requise) await imposerDoubleAuth(true);
  // Reprendre toute la chaîne de chargement capturée avant ce module. Cette
  // référence reste valide même après un rechargement PWA partiel.
  return chargerDonneesAvantDoubleAuth();
};

/* --- Mon profil : sécurité du compte ----------------------------------------- */
const brancherProfilAvantSecurite = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilAvantSecurite();
  if (!connecte() || $("#profil-securite")) return;
  const zone = $("#profil-sirh") || $("#contenu .vue");
  if (!zone) return;
  zone.insertAdjacentHTML("afterend", `<section class="carte" id="profil-securite" style="margin-top:16px">
    <div class="carte-entete"><h3>Sécurité du compte</h3><span class="carte-sous" id="etat-2fa"></span></div>
    <div id="actions-2fa" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
    <h4 style="font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--encre-3);margin:4px 0 8px">Mes dernières connexions</h4>
    <div id="mes-connexions">${squelette(90)}</div></section>`);
  const rafraichir = async () => {
    const m = await API.appel("/api/auth/moi");
    $("#etat-2fa").innerHTML = m.totp_active ? `<span class="badge approuvee">${ico("bouclier")} Double authentification active</span>`
      : `<span class="badge attente">Double authentification inactive</span>`;
    const obligatoire = m.double_auth_obligatoire;
    $("#actions-2fa").innerHTML = m.totp_active
      ? `<button class="btn petit" id="regen-codes">${ico("copie")} Nouveaux codes de secours</button>
         ${obligatoire ? "" : `<button class="btn petit fantome" id="desactiver-2fa">Désactiver</button>`}`
      : `<button class="btn petit primaire" id="activer-2fa-profil">${ico("bouclier")} Activer la double authentification</button>`;
    const demanderCode = (titre) => { const c = prompt(`${titre}\nCode à 6 chiffres de votre application :`); return c && c.trim(); };
    $("#activer-2fa-profil")?.addEventListener("click", async () => { if (await imposerDoubleAuth(false)) rafraichir(); });
    $("#regen-codes")?.addEventListener("click", async () => {
      const code = demanderCode("Nouveaux codes de secours (les anciens ne fonctionneront plus)."); if (!code) return;
      try { const r = await API.appel("/api/auth/2fa/codes-secours", { methode: "POST", corps: { code } }); await afficherCodesSecours(r.codes_secours, "Nouveaux codes de secours"); }
      catch (souci) { toast("Refusé", souci.message, "danger"); }
    });
    $("#desactiver-2fa")?.addEventListener("click", async () => {
      const code = demanderCode("Désactiver la double authentification."); if (!code) return;
      try { await API.appel("/api/auth/2fa/desactiver", { methode: "POST", corps: { code } }); toast("Désactivée", "", "info"); rafraichir(); }
      catch (souci) { toast("Refusé", souci.message, "danger"); }
    });
    const liste = await API.appel("/api/auth/mes-connexions");
    $("#mes-connexions").innerHTML = liste.length ? `<div class="tableau-boite"><table style="min-width:520px"><thead><tr><th>Date</th><th>Résultat</th><th>Appareil</th><th>Adresse</th></tr></thead><tbody>
      ${liste.map((c) => { const [cl, l] = LIBELLES_CONNEXION[c.resultat] || ["neutre", c.resultat]; return `<tr>
        <td class="mono">${dateServeur(c.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
        <td><span class="badge ${cl}">${l}</span>${c.double_auth ? ` <span class="badge info">${ico("bouclier")} code</span>` : ""}</td>
        <td>${navigateurLisible(c.navigateur)}</td><td class="mono">${echapper(c.ip || "—")}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="aide" style="margin-top:6px">Une connexion que vous ne reconnaissez pas ? Changez votre mot de passe et prévenez la RH.</p>`
      : `<p class="aide">Aucune connexion enregistrée.</p>`;
  };
  rafraichir().catch(() => {});
};

/* --- Administration : onglet Sécurité ------------------------------------------ */
function adminSecurite() {
  if (!connecte()) return reserveServeur("Le suivi de la sécurité");
  const f = etat.filtres.securite || (etat.filtres.securite = { resultat: "", matricule: "" });
  const d = chargerEtat("securiteRH", () => {
    const q = new URLSearchParams(); if (f.resultat) q.set("resultat", f.resultat); if (f.matricule) q.set("matricule", f.matricule);
    return Promise.all([API.appel("/api/securite/etat"), API.appel(`/api/securite/connexions?${q}`)]).then(([etatSecu, connexions]) => ({ etatSecu, connexions }));
  });
  if (!d) return squelette(300);
  if (d.erreur) return etatVide("bouclier", "Sécurité indisponible", echapper(d.erreur));
  const e = d.etatSecu;
  const matriculesObligatoires = new Set(e.double_auth_matricules_obligatoires || []);
  const detailDoubleAuth = e.double_auth_obligatoire_rh
    ? `obligatoire : ${(e.double_auth_matricules_obligatoires || []).join(", ") || "comptes désignés"}`
    : "facultative";
  const kpi = (cle, libelle, valeur, icone, couleur, fond, detail) => carteKpi({ cle, libelle, valeur, unite: "", icone, couleur, fond, detail });
  return `<section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:14px">
      ${kpi("se1", "Connexions (24 h)", e.connexions_24h, "users", "var(--succes)", "var(--succes-doux)", "réussies")}
      ${kpi("se2", "Échecs (24 h)", e.echecs_24h, "alerte", "var(--danger)", "var(--danger-doux)", "mot de passe, code, matricule inconnu")}
      ${kpi("se3", "Comptes bloqués", e.comptes_bloques.length, "bouclier", "var(--alerte)", "var(--alerte-doux)", e.comptes_bloques.map((x) => x.nom).join(", ") || "aucun")}
      ${kpi("se4", "Double authentification", e.double_auth_actives, "bouclier", "var(--marine)", "var(--marine-doux)", detailDoubleAuth)}
    </section>
    <div class="sirh-grille" style="margin-bottom:14px">
      <div class="sirh-section"><h4>Comptes de l'administration RH</h4>
        ${e.comptes_rh.map((c) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;padding:4px 0">
          <span>${echapper(c.nom)} <span class="mono" style="color:var(--encre-3)">${c.matricule}</span></span>
          <span style="display:flex;gap:6px;align-items:center">${c.double_auth ? `<span class="badge approuvee">Active</span>` : matriculesObligatoires.has(c.matricule) ? `<span class="badge attente">À activer</span>` : `<span class="badge neutre">Facultative</span>`}
          ${c.double_auth && c.matricule !== moi().matricule ? `<button class="btn petit fantome" data-reinit-2fa="${c.matricule}" title="Téléphone perdu">Réinitialiser</button>` : ""}</span></div>`).join("")}
        <span class="aide">Réinitialiser : le compte reconfigure sa double authentification à la prochaine connexion. Un administrateur ne peut pas réinitialiser la sienne.</span></div>
      <div class="sirh-section"><h4>Clés de sécurité</h4>
        <div style="font-size:13px">Signature des sessions : <strong>${e.cle_signature}</strong></div>
        <div style="font-size:13px">Chiffrement des données sensibles : <strong>${e.cle_chiffrement}</strong></div>
        <span class="aide">${ico("alerte")} Sans la clé de chiffrement, les données de santé et les secrets de double authentification sont illisibles :
          elle doit être sauvegardée à part de la base (coffre-fort de la DSI).</span></div>
    </div>
    <div class="barre-filtres" style="margin-bottom:10px">
      <select class="saisie" id="se-resultat" style="max-width:240px"><option value="">Tous les résultats</option>
        ${Object.entries(LIBELLES_CONNEXION).map(([k, [, l]]) => `<option value="${k}" ${f.resultat === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input class="saisie" id="se-matricule" placeholder="Matricule" value="${echapper(f.matricule)}" style="max-width:160px">
      <button class="btn petit" id="se-filtrer">${ico("loupe")} Filtrer</button>
      <span class="aide">30 derniers jours · 500 lignes au plus</span></div>
    ${d.connexions.length ? `<div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Date</th><th>Compte</th><th>Résultat</th><th>Appareil</th><th>Adresse</th></tr></thead><tbody>
      ${d.connexions.map((c) => { const [cl, l] = LIBELLES_CONNEXION[c.resultat] || ["neutre", c.resultat]; return `<tr>
        <td class="mono">${dateServeur(c.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}</td>
        <td><strong style="font-size:12.5px">${echapper(c.nom || "—")}</strong> <span class="mono" style="color:var(--encre-3)">${echapper(c.matricule)}</span></td>
        <td><span class="badge ${cl}">${l}</span>${c.double_auth ? ` <span class="badge info">code</span>` : ""}</td>
        <td>${navigateurLisible(c.navigateur)}</td><td class="mono">${echapper(c.ip || "—")}</td></tr>`; }).join("")}</tbody></table></div>`
      : etatVide("bouclier", "Aucune connexion", "Aucune connexion ne correspond aux filtres.")}`;
}

VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  const onglets = [["employes", "Employés"], ["affectations", "Affectations"], ["alertes", "Alertes RH"], ["report", "Report des congés"],
    ["documents", "Documents demandés"], ["suivi", "Suivi des fiches"], ["sorties", "Sorties"], ["departements", "Départements"],
    ["synthese", "Synthèse"], ["organigramme", "Organigramme"], ["journal", "Journal d'audit"], ["securite", "Sécurité"], ["import", "Import & exports"]]
    .filter(([cle]) => !(estGestionnaire() && ["sorties", "departements", "journal", "securite"].includes(cle)));
  if (estGestionnaire() && ["sorties", "departements", "journal", "securite"].includes(f.onglet)) f.onglet = "employes";
  const vues = { employes: () => adminEmployes(f), affectations: () => adminAffectations(f), suivi: () => adminSuivi(f), sorties: () => adminSorties(f),
    alertes: adminAlertes, report: adminReport, documents: adminDocuments, securite: adminSecurite,
    departements: adminDepartements, synthese: adminSynthese, organigramme: adminOrganigramme, journal: adminJournal, import: adminImport };
  const corps = (vues[f.onglet] || vues.employes)();
  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div class="segment" id="onglets-admin" style="flex-wrap:wrap">
        ${onglets.map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("")}
      </div>
    </div>
    ${corps}
  </section>`;
};
const brancherAdminAvantSecurite = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  brancherAdminAvantSecurite();
  $$("#onglets-admin button").forEach((b) => b.addEventListener("click", () => { etat.securiteRH = null; }));
  const filtrer = $("#se-filtrer");
  if (filtrer) filtrer.addEventListener("click", () => {
    const f = etat.filtres.securite; f.resultat = $("#se-resultat").value; f.matricule = $("#se-matricule").value.trim().toUpperCase();
    etat.securiteRH = null; rendre(false);
  });
  $$("[data-reinit-2fa]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Réinitialiser la double authentification de ${b.dataset.reinit2fa} ? Le compte devra la reconfigurer.`)) return;
    try { await API.appel(`/api/securite/2fa/${b.dataset.reinit2fa}/reinitialiser`, { methode: "POST" }); etat.securiteRH = null; toast("Réinitialisée", "", "succes"); rendre(false); }
    catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
};
