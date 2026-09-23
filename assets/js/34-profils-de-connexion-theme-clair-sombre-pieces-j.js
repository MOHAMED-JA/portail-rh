/* ==========================================================================
   34. PROFILS DE CONNEXION, THÈME CLAIR / SOMBRE, PIÈCES JOINTES
   ========================================================================== */

/* --- Trois profils sur la page de garde : Utilisateur, Supérieur, RH ------- */
const PROFILS = [
  { role: "employe", libelle: "Utilisateur", description: "Mon espace, mes demandes, mes fiches", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", demo: "VT0010" },
  { role: "validateur", libelle: "Supérieur hiérarchique", description: "Validation des demandes et des fiches", icone: "inbox", couleur: "var(--succes)", fond: "var(--succes-doux)", demo: "VT0003" },
  { role: "admin", libelle: "Administrateur RH", description: "Pilotage, profils, note de comportement", icone: "bouclier", couleur: "var(--violet)", fond: "var(--violet-doux)", demo: "VT0002" },
];
const RANG_PROFIL = { employe: 0, validateur: 1, admin: 2 };
const libelleProfil = (role) => (PROFILS.find((p) => p.role === role) || PROFILS[0]).libelle;

function selecteurTheme() {
  const t = themeActif();
  return `<div class="segment" id="theme-connexion" role="group" aria-label="Thème de l'interface">
    <button type="button" data-theme-connexion="light" class="${t === "light" ? "actif" : ""}">${ico("soleil")} Clair</button>
    <button type="button" data-theme-connexion="dark" class="${t === "dark" ? "actif" : ""}">${ico("lune")} Sombre</button>
  </div>`;
}

/* Page de garde réécrite : choix du profil et du thème, sans liste de
   comptes de démonstration (ils n'existent pas dans la base réelle). */
vueConnexion = function () {
  const connexionReelle = connecteDisponible();
  return `
  <div class="connexion">
    <section class="connexion-marque sur-sombre">
      <div class="marque" style="position:relative;z-index:2">
        <span class="logo-plaque">
          <img class="logo-marque" src="${LOGOS.clair}" alt="Veltaris" style="height:30px;display:block">
        </span>
        <div class="marque-texte" style="color:#fff;border-left-color:rgba(255,255,255,.3)">
          <strong>Portail RH</strong><span style="color:rgba(255,255,255,.72)">Direction des RH</span>
        </div>
      </div>
      <div class="contenu-marque">
        <h2>Vos congés, présences, objectifs et évaluations, en trois clics.</h2>
        <p>Déposez une demande, suivez vos pointages, rédigez votre fiche d'objectifs et consultez votre évaluation — depuis votre poste comme depuis votre téléphone.</p>
        <div class="puces-marque">
          <span class="puce-marque">${ico("check")} Validation en temps réel</span>
          <span class="puce-marque">${ico("cible")} Objectifs pondérés</span>
          <span class="puce-marque">${ico("bouclier")} Droit du travail tunisien</span>
        </div>
      </div>
    </section>

    <section class="connexion-panneau">
      <div class="connexion-boite">
        <div class="connexion-outils">${selecteurTheme()}</div>
        <div>
          <h1 style="font-size:24px">Connexion</h1>
          <p style="color:var(--encre-3);font-size:13.5px;margin-top:5px">Choisissez votre profil, puis identifiez-vous avec votre matricule Veltaris.</p>
        </div>
        <div class="champ" style="gap:8px">
          <label>Profil</label>
          <div class="profils-connexion" role="radiogroup" aria-label="Profil de connexion">
            ${PROFILS.map((p) => `<button type="button" class="profil-choix ${etat.profilChoisi === p.role ? "actif" : ""}" data-profil="${p.role}" role="radio" aria-checked="${etat.profilChoisi === p.role}">
              <span class="kpi-ico" style="background:${p.fond};color:${p.couleur}">${ico(p.icone)}</span>
              <strong>${p.libelle}</strong><span>${p.description}</span>
            </button>`).join("")}
          </div>
        </div>
        <form id="form-connexion" style="display:flex;flex-direction:column;gap:14px">
          <div class="champ">
            <label for="matricule">Matricule</label>
            <input class="saisie mono" id="matricule" name="matricule" placeholder="${connexionReelle ? "Votre matricule" : "VT0010"}" autocomplete="username" required>
          </div>
          <div class="champ">
            <label for="motdepasse">Mot de passe</label>
            <input class="saisie" id="motdepasse" name="motdepasse" type="password" ${connexionReelle ? "" : 'value="demo2026"'} autocomplete="current-password" required>
          </div>
          <div id="erreur-connexion" class="msg-erreur" hidden></div>
          <button class="btn primaire btn-bloc" type="submit">Se connecter ${ico("fleche")}</button>
        </form>
        <p style="font-size:11.5px;color:var(--encre-3);text-align:center">${connexionReelle
          ? "Mot de passe provisoire communiqué par la RH, à changer depuis « Mon profil »."
          : `Mode démonstration : cliquez sur un profil pour ouvrir le compte correspondant (mot de passe <span class="mono">demo2026</span>).`}</p>
      </div>
    </section>
  </div>`;
};

const brancherConnexionSansProfils = brancherConnexion;
brancherConnexion = function () {
  brancherConnexionSansProfils();
  $$("[data-theme-connexion]").forEach((b) => b.addEventListener("click", () => {
    appliquerTheme(b.dataset.themeConnexion);
    if (!etat.utilisateur) rendre();
  }));
  $$("[data-profil]").forEach((b) => b.addEventListener("click", () => {
    etat.profilChoisi = b.dataset.profil;
    const profil = PROFILS.find((p) => p.role === etat.profilChoisi);
    if (!connecteDisponible()) {
      $("#matricule").value = profil.demo;
      $("#motdepasse").value = "demo2026";
      return connecter(profil.demo, "demo2026");
    }
    $$("[data-profil]").forEach((x) => { x.classList.toggle("actif", x === b); x.setAttribute("aria-checked", x === b); });
    $("#matricule").focus();
  }));
};

/* Contrôle du profil choisi : un compte ne peut pas se connecter avec un
   profil supérieur au sien ; un profil inférieur restreint la session. */
function appliquerProfilChoisi() {
  const u = etat.utilisateur;
  if (!u || !etat.profilChoisi) return;
  const reel = etat.roleReel && etat.roleReel.matricule === u.matricule ? etat.roleReel.role : u.role;
  if (RANG_PROFIL[etat.profilChoisi] > RANG_PROFIL[reel]) {
    throw new Error(`Votre compte n'a pas le profil « ${libelleProfil(etat.profilChoisi)} » : choisissez « ${libelleProfil(reel)} ».`);
  }
  if (RANG_PROFIL[etat.profilChoisi] < RANG_PROFIL[reel]) {
    etat.roleReel = { matricule: u.matricule, role: reel };
    u.role = etat.profilChoisi;
  }
}
function restaurerRoleReel() {
  if (!etat.roleReel) return;
  const e = parMatricule[etat.roleReel.matricule];
  if (e) e.role = etat.roleReel.role;
  etat.roleReel = null;
}

const connecterDemoSansProfil = connecterDemo;
connecterDemo = function (matricule, motDePasse) {
  const employe = parMatricule[matricule];
  if (employe && etat.profilChoisi && RANG_PROFIL[etat.profilChoisi] > RANG_PROFIL[employe.role]) {
    const erreur = $("#erreur-connexion");
    erreur.textContent = `Ce compte n'a pas le profil « ${libelleProfil(etat.profilChoisi)} ».`;
    erreur.hidden = false;
    return;
  }
  connecterDemoSansProfil(matricule, motDePasse);
  if (etat.utilisateur && etat.profilChoisi && RANG_PROFIL[etat.profilChoisi] < RANG_PROFIL[etat.utilisateur.role]) {
    appliquerProfilChoisi();
    rendre(false);
  }
  if (etat.utilisateur) toast(`Profil ${libelleProfil(etat.utilisateur.role)}`, "Vous pouvez changer de profil en vous déconnectant.", "info");
};

const chargerDonneesSansProfil = chargerDonneesApi;
chargerDonneesApi = async function () {
  await chargerDonneesSansProfil();
  if (etat.roleReel && etat.roleReel.matricule === etat.utilisateur.matricule) {
    etat.utilisateur.role = etat.profilChoisi || etat.roleReel.role;
    return;
  }
  try {
    appliquerProfilChoisi();
  } catch (souci) {
    API.token = null;
    etat.utilisateur = null;
    throw souci;
  }
};

const deconnexionSansProfil = deconnexion;
deconnexion = function () {
  restaurerRoleReel();
  return deconnexionSansProfil();
};

/* --- Erreurs de validation de l'API lisibles (listes Pydantic) ------------ */
const appelSansDetail = API.appel;
API.appel = async function (chemin, options) {
  try {
    return await appelSansDetail.call(API, chemin, options);
  } catch (souci) {
    if (/^Erreur 422$/.test(souci.message)) souci.message = "Données refusées : vérifiez les champs obligatoires et leur format.";
    throw souci;
  }
};

/* --- Pièces jointes : PDF, DOC et DOCX uniquement ------------------------- */
const EXTENSIONS_PIECES = [".pdf", ".doc", ".docx"];
document.addEventListener("change", (e) => {
  const champ = e.target;
  if (!(champ instanceof HTMLInputElement) || champ.type !== "file" || champ.hasAttribute("data-formats-donnees")) return;
  const refuses = [...champ.files].filter((f) => !EXTENSIONS_PIECES.some((ext) => f.name.toLowerCase().endsWith(ext)));
  if (!refuses.length) return;
  champ.value = "";
  e.stopImmediatePropagation();
  const apercu = champ.parentElement && champ.parentElement.querySelector(".aide[id$='apercu']");
  if (apercu) apercu.innerHTML = "";
  toast("Format non compatible",
    `${refuses.map((f) => f.name).join(", ")} — seuls les fichiers PDF, DOC et DOCX sont acceptés.`, "danger");
}, true);
document.addEventListener("click", (e) => {
  const champ = e.target;
  if (champ instanceof HTMLInputElement && champ.type === "file" && !champ.hasAttribute("data-formats-donnees")) {
    champ.setAttribute("accept", EXTENSIONS_PIECES.join(","));
  }
}, true);

/* --- Thème : bouton de l'en-tête explicite (Clair / Sombre) ---------------- */
const coqueSansLibelleTheme = coque;
coque = function (contenu) {
  return coqueSansLibelleTheme(contenu).replace(
    /<button class="btn icone fantome" data-action="theme" aria-label="Basculer le thème">/,
    `<button class="btn icone fantome" data-action="theme" aria-label="Passer en mode ${themeActif() === "dark" ? "clair" : "sombre"}" title="Passer en mode ${themeActif() === "dark" ? "clair" : "sombre"}">`);
};

/* Premier affichage : sans préférence enregistrée, le mode clair s'impose
   (charte Veltaris) ; le mode sombre reste à un clic. */
if (!stockage.lire("portail-theme", null)) document.documentElement.setAttribute("data-theme", "light");
if (!etat.utilisateur) rendre();
