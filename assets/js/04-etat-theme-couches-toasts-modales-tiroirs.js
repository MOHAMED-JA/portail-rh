/* ==========================================================================
   4. ÉTAT, THÈME, COUCHES (toasts, modales, tiroirs)
   ========================================================================== */
const etat = {
  utilisateur: null,
  route: "/tableau-bord",
  vuesVisitees: new Set(),   // perception de vitesse : pas de squelette deux fois
  graphiques: [],
  filtres: {},
};

const stockage = {
  lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* mode privé */ } },
};

function appliquerTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  stockage.ecrire("portail-theme", theme);
  etat.graphiques.forEach((g) => g && g.destroy && g.destroy());
  etat.graphiques = [];
  if (etat.utilisateur) rendre(false);
}
function themeActif() {
  const explicite = document.documentElement.getAttribute("data-theme");
  if (explicite) return explicite;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function basculerTheme() { appliquerTheme(themeActif() === "dark" ? "light" : "dark"); }

/* ---------------------------------------------------------------- Toasts */
const ICO_TOAST = { succes: ["check", "var(--succes)", "var(--succes-doux)"], alerte: ["alerte", "var(--alerte)", "var(--alerte-doux)"], danger: ["croix", "var(--danger)", "var(--danger-doux)"], info: ["cloche", "var(--info)", "var(--info-doux)"] };
const toastsRecents = new Map();
function toast(titre, message = "", type = "succes") {
  const cle = `${titre}|${message}`;
  if (Date.now() - (toastsRecents.get(cle) || 0) < 4000) return;
  toastsRecents.set(cle, Date.now());
  const [nomIco, couleur, fond] = ICO_TOAST[type] || ICO_TOAST.info;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-ico" style="background:${fond};color:${couleur}">${ico(nomIco)}</div>
    <div><strong>${echapper(titre)}</strong>${message ? `<p>${echapper(message)}</p>` : ""}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("sortie"); setTimeout(() => el.remove(), 240); }, 4200);
}

/* ------------------------------------------------------- Modales / tiroirs */
function ouvrirCouche(html, { tiroir = false } = {}) {
  const couche = $("#couche");
  couche.innerHTML = tiroir
    ? `<div class="voile" data-fermer="1" style="place-items:stretch;justify-items:end;padding:0">${html}</div>`
    : `<div class="voile" data-fermer="1">${html}</div>`;
  couche.querySelector(".voile").addEventListener("mousedown", (e) => { if (e.target.dataset.fermer) fermerCouche(); });
  document.addEventListener("keydown", echapFermer);
  const premier = couche.querySelector("input,select,textarea,button");
  if (premier) setTimeout(() => premier.focus(), 60);
  return couche;
}
function echapFermer(e) { if (e.key === "Escape") fermerCouche(); }
function fermerCouche() { $("#couche").innerHTML = ""; document.removeEventListener("keydown", echapFermer); }

/* ==========================================================================
   5. SÉLECTEURS DE DONNÉES (périmètre selon le rôle)
   ========================================================================== */
const moi = () => etat.utilisateur;
const estAdmin = () => moi().role === "admin";
const estValideur = () => moi().role === "validateur" || estAdmin();

function equipeDe(matricule) {
  const directs = EMPLOYES.filter((e) => e.validateur === matricule);
  const indirects = EMPLOYES.filter((e) => directs.some((d) => d.matricule === e.validateur));
  return [...new Set([...directs, ...indirects])];
}
function perimetre() {
  if (estAdmin()) return EMPLOYES;
  if (moi().role === "validateur") return [moi(), ...equipeDe(moi().matricule)];
  return [moi()];
}
const perimetreMatricules = () => perimetre().map((e) => e.matricule);

const mesPointages = (matricule = moi().matricule) => POINTAGES.filter((p) => p.matricule === matricule);
const mesDemandes = () => DEMANDES.filter((d) => d.matricule === moi().matricule);
const mesNotifications = () => NOTIFICATIONS.filter((n) => n.matricule === moi().matricule);
const nonLues = () => mesNotifications().filter((n) => !n.lu).length;

function demandesAValider() {
  // Personne ne valide sa propre demande, y compris l'administrateur RH.
  const enAttente = DEMANDES.filter((d) => d.statut === "en_attente" && d.matricule !== moi().matricule);
  if (estAdmin()) return enAttente;
  const equipe = equipeDe(moi().matricule).map((e) => e.matricule);
  return enAttente.filter((d) => equipe.includes(d.matricule));
}
function anomaliesOuvertes() {
  const scope = perimetreMatricules();
  return ANOMALIES.filter((a) => a.statut === "ouverte" && scope.includes(a.matricule));
}
const soldeDe = (matricule) => {
  const s = SOLDES[matricule];
  return { ...s, restant: Math.round((s.acquis + s.report - s.pris) * 10) / 10, total: s.acquis + s.report };
};

/* ==========================================================================
   6. COQUE APPLICATIVE — rail, entête, navigation
   ========================================================================== */
function menuNavigation() {
  const groupes = [{
    titre: "Espace personnel",
    items: [
      { route: "/tableau-bord", libelle: "Tableau de bord", icone: "tableau" },
      { route: "/mes-demandes", libelle: "Mes demandes", icone: "demandes" },
      { route: "/presences", libelle: "Présences", icone: "horloge", pastille: anomaliesOuvertes().length },
      { route: "/plannings", libelle: "Plannings", icone: "calendrier" },
      { route: "/notes-de-frais", libelle: "Notes de frais", icone: "portefeuille" },
      { route: "/formations", libelle: "Formations", icone: "diplome" },
      { route: "/entretiens", libelle: "Entretiens", icone: "signature" },
      { route: "/documents", libelle: "Mes documents", icone: "doc" },
    ],
  }, {
    titre: "Équipe",
    items: [
      ...(estValideur() ? [{ route: "/validation", libelle: "À valider", icone: "inbox", pastille: demandesAValider().length }] : []),
      { route: "/annuaire", libelle: "Annuaire", icone: "users" },
      { route: "/calendrier", libelle: "Calendrier d'équipe", icone: "grille" },
    ],
  }];

  if (estValideur()) {
    groupes.push({
      titre: "Pilotage",
      items: [
        { route: "/rapports", libelle: "Rapports", icone: "rapport" },
        ...(estAdmin() ? [
          { route: "/administration", libelle: "Administration", icone: "reglages" },
          { route: "/parametres", libelle: "Paramètres RH", icone: "bouclier" },
        ] : []),
      ],
    });
  }
  return groupes;
}
const itemsNavigation = () => menuNavigation().flatMap((g) => g.items);

function coque(contenu) {
  const u = moi();
  const groupes = menuNavigation();
  const lien = (i) => `
    <button class="nav-lien ${etat.route === i.route ? "actif" : ""}" data-route="${i.route}" title="${i.libelle}">
      ${ico(i.icone)}<span class="txt">${i.libelle}</span>
      ${i.pastille ? `<span class="nav-pastille">${i.pastille}</span>` : ""}
    </button>`;
  const nav = groupes.map((g) => `
    <div class="nav-groupe">${g.titre}</div>
    ${g.items.map(lien).join("")}`).join("");

  // Sur mobile : les quatre rubriques les plus utilisées, le reste dans « Plus ».
  const principales = [
    itemsNavigation()[0],
    itemsNavigation().find((i) => i.route === "/mes-demandes"),
    estValideur() ? itemsNavigation().find((i) => i.route === "/validation") : itemsNavigation().find((i) => i.route === "/presences"),
    itemsNavigation().find((i) => i.route === "/plannings"),
  ].filter(Boolean);
  const navMobile = principales.map((i) => `
    <button class="${etat.route === i.route ? "actif" : ""}" data-route="${i.route}">
      ${ico(i.icone)}<span>${i.libelle.split(" ")[0]}</span>
      ${i.pastille ? `<span class="nav-pastille">${i.pastille}</span>` : ""}
    </button>`).join("")
    + `<button data-action="plus" class="${principales.every((i) => i.route !== etat.route) ? "actif" : ""}">${ico("menu")}<span>Plus</span></button>`;

  return `
  <div class="coque">
    <aside class="rail">
      <div class="marque">
        <span class="logo-plaque">
          <img class="logo-marque" src="${LOGOS.clair}" alt="Veltaris">
          <img class="logo-picto" src="${LOGOS.picto}" alt="Veltaris">
        </span>
        <div class="marque-texte"><strong>Portail RH</strong><span>Direction des RH</span></div>
      </div>
      <nav aria-label="Navigation principale" style="display:flex;flex-direction:column;gap:2px">
        ${nav}
      </nav>
      <div class="rail-pied">
        <div class="carte-user" data-action="profil" title="${nomComplet(u)}">
          <div class="avatar s" style="background:${couleurDept(u.dept)}">${initiales(u)}</div>
          <div class="carte-user-txt"><strong>${nomComplet(u)}</strong><span>${u.matricule} · ${nomDept(u.dept)}</span></div>
        </div>
        <button class="nav-lien" data-action="deconnexion">${ico("sortie")}<span class="txt">Déconnexion</span></button>
      </div>
    </aside>

    <div class="zone">
      <header class="entete">
        <div>
          <div class="fil">${nomDept(u.dept)}</div>
          <h1>${titreVue(etat.route)}</h1>
        </div>
        <div class="entete-actions">
          <button class="recherche-decl" data-action="palette" aria-label="Recherche globale">
            ${ico("loupe")}<span class="txt">Rechercher…</span><span class="raccourci">Ctrl K</span>
          </button>
          <button class="btn icone fantome" data-action="notifications" aria-label="Notifications" style="position:relative">
            ${ico("cloche")}${nonLues() ? `<span class="nav-pastille" style="position:absolute;top:2px;right:2px">${nonLues()}</span>` : ""}
          </button>
          <button class="btn icone fantome" data-action="theme" aria-label="Basculer le thème">
            ${ico(themeActif() === "dark" ? "soleil" : "lune")}
          </button>
        </div>
      </header>
      <main class="contenu" id="contenu">${contenu}</main>
    </div>
  </div>
  <nav class="nav-mobile" aria-label="Navigation mobile">${navMobile}</nav>
  <button class="fab" data-action="nouvelle-demande" aria-label="Nouvelle demande">${ico("plus")}</button>`;
}

const TITRES = {
  "/tableau-bord": "Tableau de bord", "/mes-demandes": "Mes demandes", "/validation": "Demandes à valider",
  "/presences": "Présences", "/plannings": "Plannings", "/documents": "Mes documents RH",
  "/administration": "Administration RH", "/annuaire": "Annuaire", "/calendrier": "Calendrier d'équipe",
  "/formations": "Formations", "/notes-de-frais": "Notes de frais", "/entretiens": "Entretiens & objectifs",
  "/rapports": "Rapports & analyses", "/parametres": "Paramètres RH", "/profil": "Mon profil",
};
const titreVue = (route) => TITRES[route] || "Portail RH";

/* -------------------------------------------------------------- Squelette */
function squeletteVue() {
  return `<div class="grille" style="gap:16px">
    <div class="squelette" style="height:112px;border-radius:18px"></div>
    <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
      ${Array(4).fill('<div class="squelette" style="height:124px;border-radius:18px"></div>').join("")}
    </div>
    <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      ${Array(2).fill('<div class="squelette" style="height:280px;border-radius:18px"></div>').join("")}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- Routeur */
const VUES = {};   // rempli par les modules de vue
function naviguer(route) {
  if (route === etat.route && $("#contenu")) return;
  etat.route = route;
  location.hash = `#${route}`;
  rendre(true);
}
window.addEventListener("hashchange", () => {
  const route = location.hash.replace("#", "") || "/tableau-bord";
  if (route !== etat.route && etat.utilisateur) { etat.route = route; rendre(true); }
});

let generationRendu = 0;
function rendre(animer = true) {
  const generation = ++generationRendu;
  const routeDemandee = etat.route;
  if (!etat.utilisateur) { $("#app").innerHTML = vueConnexion(); brancherConnexion(); return; }
  etat.graphiques.forEach((g) => g && g.destroy && g.destroy());
  etat.graphiques = [];

  // Une vue absente (module non chargé, par exemple après un cache PWA partiel)
  // doit être signalée ; afficher le tableau de bord sous un autre titre
  // ferait croire que toutes les rubriques contiennent la même chose.
  const rendu = VUES[routeDemandee] || (() => etatVide("alerte", "Rubrique indisponible",
    "Le chargement de cette rubrique est incomplet. Attendez la synchronisation du dossier puis rechargez la page."));
  const premiereFois = !etat.vuesVisitees.has(etat.route);

  if (premiereFois) {
    $("#app").innerHTML = coque(squeletteVue());
    brancherCoque();
    setTimeout(() => {
      // Une navigation ou un rechargement API peut avoir remplacé ce rendu.
      if (generation !== generationRendu || routeDemandee !== etat.route || !etat.utilisateur) return;
      etat.vuesVisitees.add(routeDemandee);
      $("#contenu").innerHTML = `<div class="vue">${rendu()}</div>`;
      brancherActions($("#contenu"));
      brancherVue();
    }, 420);
  } else {
    $("#app").innerHTML = coque(`<div class="${animer ? "vue" : ""}">${rendu()}</div>`);
    brancherCoque();
    brancherVue();
  }
}

function brancherCoque() { brancherActions(document); }

/* Branche navigation et actions globales dans un sous-arbre donné : la coque
   et le contenu sont injectés séparément (squelette puis vue). */
function brancherActions(racine) {
  $$("[data-route]", racine).forEach((b) => b.addEventListener("click", () => naviguer(b.dataset.route)));
  $$("[data-action]", racine).forEach((b) => {
    const action = b.dataset.action;
    b.addEventListener("click", () => {
      if (action === "theme") basculerTheme();
      if (action === "palette") ouvrirPalette();
      if (action === "notifications") ouvrirNotifications();
      if (action === "nouvelle-demande") ouvrirChoixDemande();
      if (action === "deconnexion") deconnexion();
      if (action === "profil") naviguer("/profil");
      if (action === "plus") ouvrirMenuMobile();
    });
  });
}
function brancherVue() {
  if (typeof brancherVueCourante === "function") brancherVueCourante();
}
function deconnexion() {
  etat.utilisateur = null; etat.vuesVisitees.clear(); etat.route = "/tableau-bord";
  location.hash = "";
  rendre();
  toast("Déconnecté", "À bientôt sur le portail RH.", "info");
}

/* ==========================================================================
   7. CONNEXION
   ========================================================================== */
const COMPTES_DEMO = [
  { matricule: "VT0010", libelle: "Employé", description: "Julien Garnier · DSI" },
  { matricule: "VT0003", libelle: "Validateur (N+1)", description: "Karim Delorme · Responsable DSI" },
  { matricule: "VT0002", libelle: "Administrateur RH", description: "Nadia Roche · Direction RH" },
];

function vueConnexion() {
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
        <h2>Vos congés, présences et missions, en trois clics.</h2>
        <p>Déposez une demande, suivez vos pointages et consultez votre planning — depuis votre poste comme depuis votre téléphone.</p>
        <div class="puces-marque">
          <span class="puce-marque">${ico("check")} Validation en temps réel</span>
          <span class="puce-marque">${ico("horloge")} Badgeage 2× par demi-journée</span>
          <span class="puce-marque">${ico("bouclier")} Droit du travail tunisien</span>
        </div>
      </div>
    </section>

    <section class="connexion-panneau">
      <div class="connexion-boite">
        <div>
          <h1 style="font-size:24px">Connexion</h1>
          <p style="color:var(--encre-3);font-size:13.5px;margin-top:5px">Identifiez-vous avec votre matricule Veltaris.</p>
        </div>
        <form id="form-connexion" style="display:flex;flex-direction:column;gap:14px">
          <div class="champ">
            <label for="matricule">Matricule</label>
            <input class="saisie mono" id="matricule" name="matricule" placeholder="VT0010" autocomplete="username" required>
          </div>
          <div class="champ">
            <label for="motdepasse">Mot de passe</label>
            <input class="saisie" id="motdepasse" name="motdepasse" type="password" value="demo2026" autocomplete="current-password" required>
          </div>
          <div id="erreur-connexion" class="msg-erreur" hidden></div>
          <button class="btn primaire btn-bloc" type="submit">Se connecter ${ico("fleche")}</button>
        </form>
        <div class="separateur">Comptes de démonstration</div>
        <div class="comptes-demo">
          ${COMPTES_DEMO.map((c) => {
            const e = parMatricule[c.matricule];
            return `<button class="compte-demo" data-compte="${c.matricule}">
              <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
              <div><strong>${c.libelle}</strong><span>${c.description}</span></div>
              <span class="badge neutre mono" style="margin-left:auto">${c.matricule}</span>
            </button>`;
          }).join("")}
        </div>
        <p style="font-size:11.5px;color:var(--encre-3);text-align:center">Mot de passe de démonstration : <span class="mono">demo2026</span></p>
      </div>
    </section>
  </div>`;
}

function brancherConnexion() {
  $$("[data-compte]").forEach((b) => b.addEventListener("click", () => {
    $("#matricule").value = b.dataset.compte;
    $("#motdepasse").value = "demo2026";
    connecter(b.dataset.compte, "demo2026");
  }));
  $("#form-connexion").addEventListener("submit", (e) => {
    e.preventDefault();
    connecter($("#matricule").value.trim().toUpperCase(), $("#motdepasse").value);
  });
}
function connecterDemo(matricule, motDePasse) {
  const employe = parMatricule[matricule];
  const erreur = $("#erreur-connexion");
  if (!employe || motDePasse !== "demo2026") {
    erreur.textContent = "Matricule ou mot de passe incorrect. Essayez un compte de démonstration ci-dessous.";
    erreur.hidden = false;
    return;
  }
  etat.utilisateur = employe;
  etat.route = "/tableau-bord";
  etat.vuesVisitees.clear();
  rendre();
  toast(`Bienvenue ${employe.prenom}`, "Votre espace RH est à jour.", "succes");
  simulerTempsReel();
}

/* Notification poussée : dans l'application réelle, ce flux arrive par
   WebSocket depuis le backend à chaque changement de statut. */
let minuterieTempsReel = null;
function simulerTempsReel() {
  clearTimeout(minuterieTempsReel);
  minuterieTempsReel = setTimeout(() => {
    if (!etat.utilisateur) return;
    const notif = {
      id: idNotif++, matricule: moi().matricule, titre: "Planning mis à jour",
      message: "Votre planning de la semaine prochaine vient d'être publié par la RH.",
      type: "info", lien: "/plannings", lu: false, date: new Date(),
    };
    NOTIFICATIONS.unshift(notif);
    toast(notif.titre, notif.message, "info");
    if ($("#contenu")) rendre(false);
  }, 22000);
}
