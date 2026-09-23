/* ==========================================================================
   35. APPLICATION OPÉRATIONNELLE
   Déconnexion toujours accessible, mots de passe visibles à la demande et
   enregistrés en base, notifications actualisées en continu, organigramme.
   ========================================================================== */
ICONES.oeilBarre = '<path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>';
ICONES.organigramme = '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-2.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5V17"/>';

/* --- Déconnexion : dans l'en-tête et dans le menu mobile ------------------- */
const coqueSansDeconnexion = coque;
coque = function (contenu) {
  return coqueSansDeconnexion(contenu).replace(
    /(<button class="btn icone fantome" data-action="theme"[\s\S]*?<\/button>)/,
    `$1<button class="btn fantome petit" data-action="deconnexion" title="Se déconnecter" aria-label="Se déconnecter">${ico("sortie")}<span class="txt-deconnexion">Déconnexion</span></button>`);
};
const ouvrirMenuMobileSansDeconnexion = ouvrirMenuMobile;
ouvrirMenuMobile = function () {
  ouvrirMenuMobileSansDeconnexion();
  const grilles = $$(".feuille .feuille-grille");
  const derniere = grilles[grilles.length - 1];
  if (!derniere) return;
  const bouton = document.createElement("button");
  bouton.className = "feuille-item";
  bouton.innerHTML = `${ico("sortie")}<span>Déconnexion</span>`;
  bouton.addEventListener("click", () => { fermerCouche(); deconnexion(); });
  derniere.appendChild(bouton);
};

/* --- Mots de passe : afficher / masquer ------------------------------------ */
function equiperMotsDePasse(racine = document) {
  racine.querySelectorAll('input[type="password"]:not([data-oeil])').forEach((champ) => {
    champ.dataset.oeil = "1";
    const boite = document.createElement("span");
    boite.className = "mdp-boite";
    champ.parentNode.insertBefore(boite, champ);
    boite.appendChild(champ);
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "mdp-oeil";
    const maj = () => {
      const visible = champ.type === "text";
      bouton.innerHTML = ico(visible ? "oeilBarre" : "oeil");
      bouton.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
      bouton.title = bouton.getAttribute("aria-label");
    };
    bouton.addEventListener("click", () => { champ.type = champ.type === "password" ? "text" : "password"; maj(); champ.focus(); });
    maj();
    boite.appendChild(bouton);
  });
}
new MutationObserver(() => equiperMotsDePasse()).observe(document.body, { childList: true, subtree: true });
equiperMotsDePasse();

/* --- Mots de passe : enregistrés en base ----------------------------------- */
const MOTS_DE_PASSE_DEMO = {};   // démonstration : valables jusqu'au rechargement
const connecterDemoSansMdp = connecterDemo;
connecterDemo = function (matricule, motDePasse) {
  const attendu = MOTS_DE_PASSE_DEMO[matricule] || "demo2026";
  if (parMatricule[matricule] && motDePasse === attendu) return connecterDemoSansMdp(matricule, "demo2026");
  return connecterDemoSansMdp(matricule, motDePasse === "demo2026" && MOTS_DE_PASSE_DEMO[matricule] ? "__mot_de_passe_remplace__" : motDePasse);
};

const brancherProfilSansMdp = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfilSansMdp();
  const bouton = $("#changer-mdp");
  if (!bouton) return;
  const remplacant = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(remplacant, bouton);
  remplacant.addEventListener("click", async () => {
    const actuel = $("#mdp-actuel").value, nouveau = $("#mdp-nouveau").value, confirme = $("#mdp-confirme").value;
    if (!actuel) return toast("Mot de passe actuel requis", "Saisissez votre mot de passe actuel.", "danger");
    if (nouveau.length < 8) return toast("Mot de passe trop court", "Utilisez au moins 8 caractères.", "danger");
    if (nouveau !== confirme) return toast("Confirmation différente", "Les deux saisies ne correspondent pas.", "danger");
    if (connecte()) {
      try {
        remplacant.disabled = true;
        await API.appel("/api/auth/mot-de-passe", { methode: "POST", corps: { actuel, nouveau } });
      } catch (souci) {
        return toast("Mot de passe inchangé", souci.message, "danger");
      } finally { remplacant.disabled = false; }
    } else {
      if (actuel !== (MOTS_DE_PASSE_DEMO[moi().matricule] || "demo2026")) return toast("Mot de passe incorrect", "Le mot de passe actuel ne correspond pas.", "danger");
      MOTS_DE_PASSE_DEMO[moi().matricule] = nouveau;
    }
    ["mdp-actuel", "mdp-nouveau", "mdp-confirme"].forEach((id) => { $(`#${id}`).value = ""; });
    toast("Mot de passe modifié", connecte()
      ? "Enregistré en base : utilisez-le dès votre prochaine connexion, sur tous les postes."
      : "Mode démonstration : valable jusqu'au rechargement de la page.", "succes");
  });
};

/* --- Notifications : actualisation continue et lecture enregistrée --------- */
function majCloche() {
  const bouton = $('[data-action="notifications"]');
  if (!bouton) return;
  const n = nonLues();
  let pastille = bouton.querySelector(".nav-pastille");
  if (!n) { if (pastille) pastille.remove(); return; }
  if (!pastille) {
    pastille = document.createElement("span");
    pastille.className = "nav-pastille";
    pastille.style.cssText = "position:absolute;top:2px;right:2px";
    bouton.appendChild(pastille);
  }
  pastille.textContent = n;
}

let synchroEnCours = false;
async function synchroniserNotifications() {
  if (!connecte() || !etat.utilisateur || synchroEnCours) return;
  synchroEnCours = true;
  try {
    const recues = await API.appel("/api/notifications?limite=60");
    const connues = new Set(NOTIFICATIONS.map((n) => n.id));
    const nouvelles = recues.filter((n) => !connues.has(n.id));
    NOTIFICATIONS.length = 0;
    recues.forEach((n) => NOTIFICATIONS.push(versNotificationLocale(n, moi().matricule)));
    majCloche();
    if (!nouvelles.length) return;
    nouvelles.slice(0, 3).forEach((n) => toast(n.titre, n.message.length > 160 ? n.message.slice(0, 157) + "…" : n.message, n.type_notif === "alerte" ? "alerte" : "info"));
    // Une décision prise par un autre compte : les données affichées sont relues.
    viderCacheFiches();
    await Promise.all([rafraichirCompteurFiches(), rafraichirDemandes().catch(() => {}), rafraichirSolde()]);
    const saisieEnCours = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if (!saisieEnCours && !$("#couche").innerHTML) rendre(false);
    else majCloche();
  } catch { /* serveur momentanément injoignable : la puce d'état le signale */ }
  finally { synchroEnCours = false; }
}
setInterval(synchroniserNotifications, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) synchroniserNotifications(); });

document.addEventListener("click", (e) => {
  if (!connecte()) return;
  const notif = e.target.closest("[data-notif]");
  if (notif) API.appel(`/api/notifications/${notif.dataset.notif}/lu`, { methode: "POST" }).catch(() => {});
  if (e.target.closest("[data-tout-lu], #tout-lu-tiroir")) API.appel("/api/notifications/tout-lu", { methode: "POST" }).catch(() => {});
}, true);

/* À la connexion : les notifications non lues sont annoncées. */
const connecterSansAnnonce = connecter;
connecter = async function (...args) {
  await connecterSansAnnonce(...args);
  if (!etat.utilisateur) return;
  const nonLuesListe = mesNotifications().filter((n) => !n.lu);
  if (nonLuesListe.length) {
    setTimeout(() => toast(`${nonLuesListe.length} notification(s) non lue(s)`,
      `${nonLuesListe[0].titre} — cliquez sur la cloche pour les consulter.`, "info"), 700);
  }
};

/* --- Organigramme ----------------------------------------------------------- */
async function rafraichirAnnuaire() {
  if (!connecte()) return;
  const annuaire = await API.appel("/api/administration/annuaire");
  annuaire.forEach((e) => {
    const existant = parMatricule[e.matricule];
    const donnees = { id: e.id, prenom: e.prenom, nom: e.nom, poste: e.poste, dept: e.departement, validateur: e.validateur,
      email: e.email, telephone: e.telephone, entree: e.date_entree, niveau: e.niveau || "collaborateur", roleApi: e.role };
    if (existant) {
      const role = existant.role;
      Object.assign(existant, donnees);
      existant.role = role;   // le profil de la session reste inchangé
    } else {
      const nouveau = { ...donnees, matricule: e.matricule, role: ROLES_API[e.role] || "employe", statut: "actif" };
      EMPLOYES.push(nouveau);
      parMatricule[nouveau.matricule] = nouveau;
      if (!SOLDES[nouveau.matricule]) SOLDES[nouveau.matricule] = { annee: ANNEE, acquis: 0, report: 0, pris: 0 };
    }
  });
  const actifs = new Set(annuaire.map((e) => e.matricule));
  for (let i = EMPLOYES.length - 1; i >= 0; i--) {
    if (!actifs.has(EMPLOYES[i].matricule) && EMPLOYES[i] !== etat.utilisateur) {
      delete parMatricule[EMPLOYES[i].matricule];
      EMPLOYES.splice(i, 1);
    }
  }
}

function arbreOrganisation() {
  const actifs = EMPLOYES.filter((e) => e.statut !== "sorti");
  const enfants = {};
  const racines = [];
  actifs.forEach((e) => {
    const chef = e.validateur && parMatricule[e.validateur] && e.validateur !== e.matricule ? e.validateur : null;
    if (chef) (enfants[chef] = enfants[chef] || []).push(e); else racines.push(e);
  });
  const tri = (a, b) => (enfants[b.matricule] || []).length - (enfants[a.matricule] || []).length
    || (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr");
  Object.values(enfants).forEach((liste) => liste.sort(tri));
  racines.sort(tri);
  return { racines, enfants };
}

function effectifSous(matricule, enfants) {
  return (enfants[matricule] || []).reduce((s, e) => s + 1 + effectifSous(e.matricule, enfants), 0);
}

VUES["/organigramme"] = function () {
  const f = etat.filtres.orga || (etat.filtres.orga = { recherche: "", dept: "", deplies: null });
  const { racines, enfants } = arbreOrganisation();
  if (!f.deplies) {
    // Premier affichage : la direction et le chemin jusqu'à l'utilisateur sont dépliés.
    f.deplies = new Set(racines.map((e) => e.matricule));
    let c = moi();
    while (c && c.validateur && parMatricule[c.validateur]) { f.deplies.add(c.validateur); c = parMatricule[c.validateur]; }
  }
  const q = f.recherche.trim().toLowerCase();
  const correspond = (e) => (!q || `${e.prenom} ${e.nom} ${e.matricule} ${e.poste || ""} ${nomDept(e.dept)}`.toLowerCase().includes(q))
    && (!f.dept || e.dept === f.dept);
  const filtre = q || f.dept;
  const visible = {};
  const marquer = (e) => {
    const sous = (enfants[e.matricule] || []).map(marquer).some(Boolean);
    visible[e.matricule] = correspond(e) || sous;
    return visible[e.matricule];
  };
  racines.forEach(marquer);
  const trouves = filtre ? EMPLOYES.filter((e) => e.statut !== "sorti" && correspond(e)).length : 0;

  const noeud = (e, profondeur) => {
    if (filtre && !visible[e.matricule]) return "";
    const sous = enfants[e.matricule] || [];
    const ouvert = filtre ? true : f.deplies.has(e.matricule);
    const total = effectifSous(e.matricule, enfants);
    const feuilles = sous.every((x) => !(enfants[x.matricule] || []).length);
    return `<div class="orga-branche">
      <div class="orga-noeud ${e.matricule === moi().matricule ? "moi" : ""} ${filtre && correspond(e) ? "trouve" : ""}" id="orga-${echapper(e.matricule)}">
        <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
        <div class="orga-txt">
          <strong>${echapper(nomComplet(e))}${e.matricule === moi().matricule ? " <span class='badge info' style='padding:1px 7px'>Vous</span>" : ""}</strong>
          <span class="orga-poste">${echapper(e.poste || "Poste non renseigné")} · ${echapper(nomDept(e.dept))}</span>
        </div>
        ${sous.length ? `<button class="orga-bascule" data-orga="${echapper(e.matricule)}" aria-expanded="${ouvert}">
          ${ico(ouvert ? "haut" : "bas")}${sous.length} direct(s)${total > sous.length ? ` · ${total}` : ""}</button>` : ""}
      </div>
      ${sous.length && ouvert ? `<div class="orga-enfants ${feuilles && sous.length > 6 ? "grille-orga" : ""}">${sous.map((x) => noeud(x, profondeur + 1)).join("")}</div>` : ""}
    </div>`;
  };

  const departements = [...new Set(EMPLOYES.map((e) => e.dept).filter(Boolean))];
  const responsables = EMPLOYES.filter((e) => (enfants[e.matricule] || []).length).length;
  return `<div style="display:flex;flex-direction:column;gap:16px">
    <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${carteKpi({ cle: "or1", libelle: "Collaborateurs", valeur: EMPLOYES.filter((e) => e.statut !== "sorti").length, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "Effectif en base" })}
      ${carteKpi({ cle: "or2", libelle: "Responsables", valeur: responsables, unite: "", icone: "organigramme", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: "Encadrent au moins une personne" })}
      ${carteKpi({ cle: "or3", libelle: "Départements", valeur: departements.length, unite: "", icone: "batiment", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: connecte() ? "Mis à jour à chaque ouverture" : "Données de démonstration" })}
    </section>
    <section class="carte">
      <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
        <h2>Organigramme Veltaris</h2>
        <span class="carte-sous">Construit à partir des rattachements hiérarchiques enregistrés par la RH</span>
      </div>
      <div class="orga-outils" style="margin-bottom:14px">
        <input class="saisie" id="orga-recherche" placeholder="Rechercher un nom, un poste, un matricule…" value="${echapper(f.recherche)}">
        <select class="saisie" id="orga-dept"><option value="">Tous les départements</option>
          ${departements.map((d) => `<option value="${echapper(d)}" ${f.dept === d ? "selected" : ""}>${echapper(nomDept(d))}</option>`).join("")}</select>
        <button class="btn petit" id="orga-moi">${ico("users")} Ma position</button>
        <button class="btn petit fantome" id="orga-tout">${ico("bas")} Tout déplier</button>
        <button class="btn petit fantome" id="orga-rien">${ico("haut")} Tout replier</button>
        ${filtre ? `<span class="badge ${trouves ? "info" : "attente"}">${trouves} résultat(s)</span>` : ""}
      </div>
      <div class="orga-arbre">${racines.map((e) => noeud(e, 0)).join("") || etatVide("users", "Organigramme vide", "Aucun collaborateur en base.")}</div>
    </section>
  </div>`;
};

BRANCHEMENTS["/organigramme"] = function () {
  const f = etat.filtres.orga;
  $$("[data-orga]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.orga;
    if (f.deplies.has(m)) f.deplies.delete(m); else f.deplies.add(m);
    rendre(false);
  }));
  const recherche = $("#orga-recherche");
  recherche.addEventListener("input", debounce(() => {
    f.recherche = recherche.value; rendre(false);
    const champ = $("#orga-recherche"); champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
  }, 250));
  $("#orga-dept").addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
  $("#orga-tout").addEventListener("click", () => { f.deplies = new Set(EMPLOYES.map((e) => e.matricule)); rendre(false); });
  $("#orga-rien").addEventListener("click", () => { f.deplies = new Set(); rendre(false); });
  $("#orga-moi").addEventListener("click", () => {
    f.recherche = ""; f.dept = "";
    let c = moi();
    while (c && c.validateur && parMatricule[c.validateur]) { f.deplies.add(c.validateur); c = parMatricule[c.validateur]; }
    rendre(false);
    setTimeout(() => { const el = document.getElementById(`orga-${moi().matricule}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
  });
};
TITRES["/organigramme"] = "Organigramme";

const menuNavigationSansOrga = menuNavigation;
menuNavigation = function () {
  const groupes = menuNavigationSansOrga();
  const equipe = groupes.find((g) => g.titre === "Équipe");
  if (equipe && !equipe.items.some((i) => i.route === "/organigramme")) {
    const index = equipe.items.findIndex((i) => i.route === "/annuaire");
    equipe.items.splice(index + 1, 0, { route: "/organigramme", libelle: "Organigramme", icone: "organigramme" });
  }
  return groupes;
};

/* L'organigramme reflète la base à chaque ouverture. */
const naviguerSansOrga = naviguer;
naviguer = function (route) {
  if (route === "/organigramme" && connecte()) {
    rafraichirAnnuaire().then(() => { if (etat.route === "/organigramme") rendre(false); }).catch(() => {});
  }
  return naviguerSansOrga(route);
};
