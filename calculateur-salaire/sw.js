/*
 * Service worker du calculateur : fonctionnement hors connexion.
 * Stratégie « réseau d'abord » pour la page (mises à jour immédiates),
 * « cache d'abord, puis mise à jour en arrière-plan » pour les fichiers statiques.
 * Changez VERSION à chaque publication pour renouveler le cache.
 */
var VERSION = "calc-salaire-v5";
var FICHIERS = [
  "./",
  "index.html",
  "css/styles.css",
  "css/workspace.css",
  "config/parametres.js",
  "js/calcul.js",
  "js/etat.js",
  "js/graphiques.js",
  "js/app.js",
  "js/workspace.js",
  "manifest.webmanifest",
  "assets/icone.svg",
  "assets/qr-installation.png",
  "assets/fonts/manrope-var.woff2",
  "assets/fonts/jetbrains-mono-var.woff2",
  "assets/icones/icone-192.png",
  "assets/icones/icone-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FICHIERS.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (c) { return c.indexOf("calc-salaire-") === 0 && c !== VERSION; })
      .map(function (c) { return caches.delete(c); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  var portee = new URL(self.registration.scope);
  if (url.pathname.indexOf(portee.pathname) !== 0) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (r) {
      var copie = r.clone();
      caches.open(VERSION).then(function (c) { c.put("index.html", copie); });
      return r;
    }).catch(function () {
      return caches.match("index.html");
    }));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (enCache) {
    var reseau = fetch(req).then(function (r) {
      if (r.ok) {
        var copie = r.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copie); });
      }
      return r;
    }).catch(function () { return enCache; });
    return enCache || reseau;
  }));
});
