/* Portail RH — service worker : l'application s'installe sur le téléphone ou
   le poste, et l'écran d'accueil reste disponible même hors connexion. Les
   données (API) ne sont jamais mises en cache : elles viennent toujours du
   serveur. */
const CACHE = "portail-rh-v1-0-0";
const STATIQUES = [
  './',
  './manifest.webmanifest',
  './assets/css/portail-rh.css',
  './assets/marque/logo-picto.png',
  './assets/marque/logo-clair.png',
  './assets/marque/logo-blanc.png',
  './assets/js/00-logos.js',
  './assets/js/01-outils-dates-formats-aleatoire-deterministe-icon.js',
  './assets/js/04-etat-theme-couches-toasts-modales-tiroirs.js',
  './assets/js/08-graphiques-habillage-commun-chart-js.js',
  './assets/js/10-depot-de-demandes-tiroirs-avec-validation-en-dir.js',
  './assets/js/13-presences-pointages-vue-mensuelle-anomalies.js',
  './assets/js/15-mes-documents-rh-signature-electronique.js',
  './assets/js/20-donnees-complementaires-formations-notes-de-frai.js',
  './assets/js/23-formations.js',
  './assets/js/26-rapports-analyses.js',
  './assets/js/29-menu-mobile-plus-toutes-les-rubriques-en-feuille.js',
  './assets/js/30-mode-connecte.js',
  './assets/js/31-telechargements-reels.js',
  './assets/js/32-effectif-reel-ajustements-lorsque-la-base-contie.js',
  './assets/js/33-fiches-d-objectifs-et-d-evaluation.js',
  './assets/js/34-profils-de-connexion-theme-clair-sombre-pieces-j.js',
  './assets/js/35-application-operationnelle.js',
  './assets/js/36-administration-rh-suivi-des-fiches-relances-affe.js',
  './assets/js/37-donnees-de-demonstration-en-mode-connecte.js',
  './assets/js/38-tout-en-base.js',
  './assets/js/39-heures-du-serveur.js',
  './assets/js/40-regles-entreprise-horaires-pointage-autorisati.js',
  './assets/js/41-validation-automatique-apres-48-heures.js',
  './assets/js/42-priere-du-vendredi-acquisition-mensuelle.js',
  './assets/js/43-suppression-d-un-profil-sortie-des-effectifs.js',
  './assets/js/44-sirh-securite-dossier-carriere-alertes-parcours-.js',
  './assets/js/45-theme-ecran-de-connexion-toujours-clair-mode-som.js',
  './assets/js/46-hierarchie-tableau-de-bord-de-l-equipe-superieur.js',
  './assets/js/47-organigramme-dessine-en-arbre-structures-respons.js',
  './assets/js/48-circuit-de-validation-et-direction-generale.js',
  './assets/js/49-securite-double-authentification-historique-des-.js',
  './assets/js/50-roles-rh-gestionnaire-rh-et-administrateur-rh.js',
  './assets/js/51-avances-sur-salaire-et-prets-sociaux.js',
  './assets/js/52-competences-et-succession.js',
  './assets/js/53-offres-de-postes-en-interne-et-mobilite.js',
  './assets/js/54-accidents-du-travail-et-dossier-disciplinaire.js',
  './assets/js/55-analyses-rh-charge-en-periode-de-conges-bradford.js',
  './assets/js/56-mot-de-passe-oublie-reinitialisation-en-libre-se.js',
  './assets/js/57-structures-de-l-entreprise-poles-directions-et-d.js',
  './assets/js/58-import-rh-excel.js',
  './assets/js/59-supervision.js',
  './assets/js/60-remplacement-responsable.js',
  './assets/js/61-qualite-des-donnees.js',
  './assets/js/62-accueil-mobile-raccourcis.js',
  './assets/js/63-confirmation-architecture-responsables.js',
  './assets/js/64-schema-des-structures-organigramme-des-unites.js',
  './assets/js/65-delegation-de-validation-remplacant.js',
  './assets/js/66-generateur-de-documents-rh.js',
  './assets/js/67-habilitations-obligatoires.js',
  './assets/js/68-indicateurs-cles-direction.js',
  './assets/js/69-revue-des-talents-grille-9-cases.js',
  './assets/js/70-remuneration-et-masse-salariale.js',
  './assets/js/71-departs-et-entretiens-de-sortie.js',
  './assets/js/72-adresse-personnelle-et-bilan-individuel.js',
  './assets/js/73-directeur-general-sans-fiche-objectifs.js',
  './assets/js/74-organigramme-regroupement-par-structure.js',
  './assets/js/75-graphiques-couleurs-lumineuses.js',
  './assets/js/76-barre-etat-selon-theme.js'
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIQUES)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/fichiers/")) return;
  const navigation = e.request.mode === "navigate";
  e.respondWith(fetch(e.request).then((r) => {
    // Le serveur renvoie l'accueil pour toute URL inconnue. Ce HTML ne doit
    // jamais être exécuté comme un module JavaScript ou une feuille de style.
    const type = r.headers.get("content-type") || "";
    const actif = /\.(js|css)$/.test(url.pathname);
    if (actif && type.includes("text/html")) return Response.error();
    if (r.ok) {
      const copie = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
    }
    return r;
  }).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(e.request) || (navigation ? await cache.match("./") : null) || Response.error();
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((fenetres) =>
    fenetres.length ? fenetres[0].focus() : self.clients.openWindow("./")));
});
