/* ==========================================================================
   56. MOT DE PASSE OUBLIÉ : RÉINITIALISATION EN LIBRE-SERVICE
   Personne ne reste à la porte. Un compte bloqué passe quand même par ici.
   Trois canaux décidés par le serveur : double authentification (code de
   l'application + code de secours), lien par e-mail, ou demande à la RH.
   ========================================================================== */
function boiteOubli(contenu) {
  const boite = document.createElement("div");
  boite.className = "bloc-mdp";
  boite.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-labelledby="oubli-titre" style="max-width:470px">${contenu}</div>`;
  document.body.appendChild(boite);
  return boite;
}

function champsNouveauMdp() {
  return `<div class="champ"><label for="oubli-mdp">Nouveau mot de passe</label>
      <input class="saisie" id="oubli-mdp" type="password" autocomplete="new-password" placeholder="8 caractères minimum"></div>
    <div class="champ"><label for="oubli-mdp2">Confirmation</label>
      <input class="saisie" id="oubli-mdp2" type="password" autocomplete="new-password"></div>
    <span class="aide">Au moins 8 caractères, avec des lettres et des chiffres. Évitez votre matricule.</span>`;
}

function lireNouveauMdp(boite) {
  const mdp = boite.querySelector("#oubli-mdp").value;
  const confirmation = boite.querySelector("#oubli-mdp2").value;
  if (mdp.length < 8 || !/[0-9]/.test(mdp) || !/[a-zA-Z]/.test(mdp)) {
    throw new Error("Le mot de passe doit contenir au moins 8 caractères, dont des lettres et des chiffres.");
  }
  if (mdp !== confirmation) throw new Error("Les deux saisies ne correspondent pas.");
  return mdp;
}

function erreurOubli(boite, message) {
  const zone = boite.querySelector("#oubli-erreur");
  if (!zone) return;
  zone.textContent = message;
  zone.hidden = false;
}

function finOubli(boite, titre, message) {
  boite.querySelector(".modale").innerHTML = `<div class="modale-tete"><div><h2 id="oubli-titre">${titre}</h2></div></div>
    <div class="modale-corps"><p style="font-size:13.5px;line-height:1.55">${echapper(message)}</p></div>
    <div class="modale-pied"><button class="btn primaire" id="oubli-fermer">${ico("check")} Fermer</button></div>`;
  boite.querySelector("#oubli-fermer").addEventListener("click", () => boite.remove());
}

/* --- Étape 2 : le compte a la double authentification --------------------- */
function etapeDoubleAuth(boite, matricule, message) {
  boite.querySelector(".modale").innerHTML = `<div class="modale-tete"><div><h2 id="oubli-titre">Vérification de votre identité</h2>
      <div class="sous">${echapper(message)}</div></div></div>
    <div class="modale-corps">
      <div class="champ"><label for="oubli-code">Code de l'application (6 chiffres)</label>
        <input class="saisie saisie-code" id="oubli-code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"></div>
      <div class="champ"><label for="oubli-secours">Code de secours (XXXX-XXXX)</label>
        <input class="saisie mono" id="oubli-secours" maxlength="9" placeholder="A1B2-C3D4" autocomplete="off"></div>
      <span class="aide">Le code de secours vient de la liste imprimée lors de l'activation ; il ne sert qu'une fois.</span>
      <div style="height:10px"></div>
      ${champsNouveauMdp()}
      <div id="oubli-erreur" class="msg-erreur" hidden></div>
    </div>
    <div class="modale-pied"><button class="btn" id="oubli-annuler">Annuler</button>
      <button class="btn primaire" id="oubli-valider">${ico("bouclier")} Enregistrer</button></div>`;
  boite.querySelector("#oubli-annuler").addEventListener("click", () => boite.remove());
  boite.querySelector("#oubli-valider").addEventListener("click", async () => {
    let nouveau;
    try { nouveau = lireNouveauMdp(boite); } catch (souci) { return erreurOubli(boite, souci.message); }
    const corps = {
      matricule,
      code: boite.querySelector("#oubli-code").value.trim(),
      code_secours: boite.querySelector("#oubli-secours").value.trim(),
      nouveau,
    };
    if (!corps.code || !corps.code_secours) return erreurOubli(boite, "Saisissez le code de l'application et un code de secours.");
    try {
      const r = await API.appel("/api/auth/oubli/double-auth", { methode: "POST", corps });
      finOubli(boite, "Mot de passe enregistré", r.message);
      const champ = $("#matricule");
      if (champ) champ.value = matricule;
    } catch (souci) { erreurOubli(boite, souci.message); }
  });
  setTimeout(() => boite.querySelector("#oubli-code").focus(), 50);
}

/* --- Étape 1 : le matricule ---------------------------------------------- */
function ouvrirOubliMotDePasse(matriculeConnu) {
  const boite = boiteOubli(`<div class="modale-tete"><div><h2 id="oubli-titre">Mot de passe oublié</h2>
      <div class="sous">Saisissez votre matricule : le portail vous indiquera comment reprendre la main, même si votre compte est temporairement bloqué.</div></div></div>
    <div class="modale-corps">
      <div class="champ"><label for="oubli-matricule">Matricule</label>
        <input class="saisie mono" id="oubli-matricule" placeholder="Votre matricule" value="${echapper(matriculeConnu || "")}" autocomplete="username"></div>
      <div id="oubli-erreur" class="msg-erreur" hidden></div>
    </div>
    <div class="modale-pied"><button class="btn" id="oubli-annuler">Annuler</button>
      <button class="btn primaire" id="oubli-suivant">Continuer ${ico("fleche")}</button></div>`);
  boite.querySelector("#oubli-annuler").addEventListener("click", () => boite.remove());
  const suivant = async () => {
    const matricule = boite.querySelector("#oubli-matricule").value.trim().toUpperCase();
    if (!matricule) return erreurOubli(boite, "Saisissez votre matricule.");
    try {
      const r = await API.appel("/api/auth/oubli", { methode: "POST", corps: { matricule } });
      if (r.canal === "totp") return etapeDoubleAuth(boite, matricule, r.message);
      finOubli(boite, r.canal === "email" ? "Lien envoyé" : "Demande transmise", r.message);
    } catch (souci) { erreurOubli(boite, souci.message); }
  };
  boite.querySelector("#oubli-suivant").addEventListener("click", suivant);
  boite.querySelector("#oubli-matricule").addEventListener("keydown", (e) => { if (e.key === "Enter") suivant(); });
  setTimeout(() => boite.querySelector("#oubli-matricule").focus(), 50);
}

/* --- Lien reçu par e-mail : #/reinitialisation?jeton=… -------------------- */
function ouvrirOubliParLien(jeton) {
  const boite = boiteOubli(`<div class="modale-tete"><div><h2 id="oubli-titre">Nouveau mot de passe</h2>
      <div class="sous">Choisissez votre nouveau mot de passe. Ce lien ne sert qu'une fois.</div></div></div>
    <div class="modale-corps">${champsNouveauMdp()}<div id="oubli-erreur" class="msg-erreur" hidden></div></div>
    <div class="modale-pied"><button class="btn" id="oubli-annuler">Annuler</button>
      <button class="btn primaire" id="oubli-valider">${ico("check")} Enregistrer</button></div>`);
  boite.querySelector("#oubli-annuler").addEventListener("click", () => boite.remove());
  boite.querySelector("#oubli-valider").addEventListener("click", async () => {
    let nouveau;
    try { nouveau = lireNouveauMdp(boite); } catch (souci) { return erreurOubli(boite, souci.message); }
    try {
      const r = await API.appel("/api/auth/oubli/lien", { methode: "POST", corps: { jeton, nouveau } });
      finOubli(boite, "Mot de passe enregistré", r.message);
    } catch (souci) { erreurOubli(boite, souci.message); }
  });
}

/* --- Le lien sur l'écran de connexion ------------------------------------- */
const brancherConnexionAvantOubli = brancherConnexion;
brancherConnexion = function () {
  brancherConnexionAvantOubli();
  const formulaire = $("#form-connexion");
  if (!formulaire || !connecteDisponible() || $("#lien-oubli")) return;
  const ligne = document.createElement("p");
  ligne.style.cssText = "text-align:center;margin-top:-4px";
  ligne.innerHTML = `<button type="button" id="lien-oubli" class="lien-discret">Mot de passe oublié ?</button>`;
  formulaire.insertAdjacentElement("afterend", ligne);
  ligne.querySelector("#lien-oubli").addEventListener("click", () => ouvrirOubliMotDePasse($("#matricule")?.value.trim()));
};

let jetonOubliTraite = false;
/* Lien reçu par e-mail : on l'ouvre dès l'affichage de l'écran de connexion. */
const rendreAvantOubli = rendre;
rendre = function (...args) {
  const sortie = rendreAvantOubli(...args);
  const correspondance = /[#&?]jeton=([^&]+)/.exec(location.hash);
  if (correspondance && !jetonOubliTraite && location.hash.includes("reinitialisation")) {
    jetonOubliTraite = true;
    history.replaceState(null, "", location.pathname);
    ouvrirOubliParLien(decodeURIComponent(correspondance[1]));
  }
  return sortie;
};

/* --- Côté RH : les demandes en attente, en tête de l'administration ------- */
const vueAdminAvantOubli = VUES["/administration"];
VUES["/administration"] = function () {
  const html = vueAdminAvantOubli();
  if (!connecte() || !estAdmin()) return html;
  const d = chargerEtat("oublisRH", () => API.appel("/api/auth/oubli/en-attente"));
  if (!Array.isArray(d) || !d.length) return html;
  const banniere = `<div id="banniere-oubli" style="background:var(--alerte-doux);border:1px solid var(--alerte);border-radius:10px;padding:12px 14px;margin-bottom:14px">
    <strong style="font-size:13.5px">${ico("bouclier")} ${d.length} demande(s) de nouveau mot de passe</strong>
    <p style="font-size:12.5px;color:var(--encre-2);margin:4px 0 8px">Ces personnes ne parviennent plus à se connecter. Donnez-leur un mot de passe provisoire depuis l'onglet « Employés » (Modifier → Mot de passe), communiquez-le de vive voix, puis classez la demande.</p>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${d.map((x) => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <strong style="font-size:13px">${echapper(x.employe.prenom + " " + x.employe.nom)}</strong>
        <span class="mono" style="font-size:12px;color:var(--encre-3)">${echapper(x.employe.matricule)}</span>
        <span style="font-size:12px;color:var(--encre-3)">${echapper(x.employe.direction || "")}</span>
        <span style="font-size:12px;color:var(--encre-3)">${dateServeur(x.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
        <button class="btn petit" data-classer-oubli="${x.id}">${ico("check")} Classer</button></div>`).join("")}
    </div></div>`;
  return html.replace('<section class="carte">', `<section class="carte">${banniere}`);
};

const brancherAdminAvantOubli = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  brancherAdminAvantOubli();
  $$("[data-classer-oubli]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await API.appel(`/api/auth/oubli/${b.dataset.classerOubli}/classer`, { methode: "POST" });
      etat.oublisRH = null;
      toast("Demande classée", "", "succes");
      rendre(false);
    } catch (souci) { toast("Refusé", souci.message, "danger"); }
  }));
};

const deconnexionAvantOubli = deconnexion;
deconnexion = function (...args) { etat.oublisRH = null; return deconnexionAvantOubli(...args); };
