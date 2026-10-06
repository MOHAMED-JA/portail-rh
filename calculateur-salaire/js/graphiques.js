/*
 * Graphiques : barres de répartition et courbe du net selon le brut.
 * SVG et HTML écrits à la main, sans bibliothèque.
 */
(function (racine) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var fmtEntier = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var fmtTaux = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

  function svgEl(nom, attrs, parent) {
    var n = document.createElementNS(NS, nom);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------- Barre empilée (parts de 0 à 1) ---------- */
  function majBarre(conteneur, parts) {
    Object.keys(parts).forEach(function (cle) {
      var seg = conteneur.querySelector('[data-segment="' + cle + '"]');
      if (!seg) return;
      var part = parts[cle];
      seg.hidden = !(part > 0.0005);
      seg.style.flexGrow = String(Math.max(part, 0));
    });
  }

  /* ---------- Courbe ---------- */

  /* Pas « rond » pour les graduations */
  function pasRond(etendue, nb) {
    var brut = etendue / Math.max(1, nb);
    var p = Math.pow(10, Math.floor(Math.log10(brut)));
    var r = brut / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  }

  function Courbe(svg, info, options) {
    this.svg = svg;
    this.info = info;
    this.options = options || {};
    this.index = null;
    var self = this;

    svg.addEventListener("pointermove", function (e) { self.survol(e); });
    svg.addEventListener("pointerleave", function () { self.masquerCurseur(); });
    svg.addEventListener("blur", function () { self.masquerCurseur(); });
    svg.addEventListener("keydown", function (e) { self.clavier(e); });
    if ("ResizeObserver" in window) {
      var largeur = 0;
      new ResizeObserver(function (entrees) {
        var l = Math.round(entrees[0].contentRect.width);
        if (l !== largeur && self.donnees) { largeur = l; self.dessiner(); }
      }).observe(svg.parentNode);
    }
  }

  /*
   * donnees = { points: [{brut, net, tauxMarginal}], actuel: {brut, net}, unite: "par mois" }
   */
  Courbe.prototype.maj = function (donnees) {
    this.donnees = donnees;
    this.dessiner();
  };

  Courbe.prototype.dessiner = function () {
    var d = this.donnees;
    var svg = this.svg;
    var largeur = Math.max(280, svg.parentNode.clientWidth || 600);
    var hauteur = largeur < 520 ? 210 : 250;
    var m = { haut: 18, droite: 14, bas: 30, gauche: 52 };
    var lp = largeur - m.gauche - m.droite;
    var hp = hauteur - m.haut - m.bas;
    svg.setAttribute("viewBox", "0 0 " + largeur + " " + hauteur);
    svg.setAttribute("width", largeur);
    svg.setAttribute("height", hauteur);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var pts = d.points;
    var xmax = pts[pts.length - 1].brut;
    var ymaxBrut = Math.max(pts[pts.length - 1].brutTotal, 1);
    var pasY = pasRond(ymaxBrut, 4);
    var ymax = Math.ceil(ymaxBrut / pasY) * pasY;
    function X(v) { return m.gauche + (v / xmax) * lp; }
    function Y(v) { return m.haut + hp - (v / ymax) * hp; }
    this.geo = { X: X, Y: Y, m: m, lp: lp, hp: hp, largeur: largeur, hauteur: hauteur, xmax: xmax };

    /* Bandes du taux marginal */
    var gBandes = svgEl("g", { class: "courbe__bandes", "aria-hidden": "true" }, svg);
    var debut = 0;
    var pair = false;
    for (var i = 1; i <= pts.length; i++) {
      if (i === pts.length || pts[i].tauxMarginal !== pts[debut].tauxMarginal) {
        var x0 = X(pts[debut].brut);
        var x1 = i === pts.length ? X(xmax) : X(pts[i].brut);
        if (pair) svgEl("rect", { x: x0, y: m.haut, width: Math.max(0, x1 - x0), height: hp, class: "courbe__bande" }, gBandes);
        if (x1 - x0 > 40) {
          var t = svgEl("text", { x: (x0 + x1) / 2, y: m.haut + 12, class: "courbe__bande-texte", "text-anchor": "middle" }, gBandes);
          t.textContent = fmtTaux.format(pts[debut].tauxMarginal);
        }
        pair = !pair;
        debut = i;
      }
    }

    /* Grille et axes */
    var gAxes = svgEl("g", { class: "courbe__axes", "aria-hidden": "true" }, svg);
    for (var v = 0; v <= ymax + 1e-9; v += pasY) {
      svgEl("line", { x1: m.gauche, x2: m.gauche + lp, y1: Y(v), y2: Y(v), class: "courbe__grille" }, gAxes);
      var ty = svgEl("text", { x: m.gauche - 8, y: Y(v) + 4, "text-anchor": "end", class: "courbe__graduation" }, gAxes);
      ty.textContent = fmtEntier.format(v);
    }
    var pasX = pasRond(xmax, largeur < 520 ? 3 : 6);
    for (var vx = 0; vx <= xmax + 1e-9; vx += pasX) {
      var tx = svgEl("text", { x: X(vx), y: m.haut + hp + 20, "text-anchor": vx === 0 ? "start" : "middle", class: "courbe__graduation" }, gAxes);
      tx.textContent = fmtEntier.format(vx);
    }

    /* Référence : brut total */
    var ref = pts.map(function (p, k) { return (k ? "L" : "M") + X(p.brut).toFixed(1) + " " + Y(p.brutTotal).toFixed(1); }).join(" ");
    svgEl("path", { d: ref, class: "courbe__reference", "aria-hidden": "true" }, svg);
    /* Étiquettes directes placées aux deux tiers de la courbe, loin des bords */
    var repere = pts[Math.round((pts.length - 1) * 0.68)];
    var lr = svgEl("text", { x: X(repere.brut), y: Y(repere.brutTotal) - 8, "text-anchor": "end", class: "courbe__etiquette courbe__etiquette--ref", "aria-hidden": "true" }, svg);
    lr.textContent = "brut";

    /* Courbe du net */
    var chemin = pts.map(function (p, k) { return (k ? "L" : "M") + X(p.brut).toFixed(1) + " " + Y(p.net).toFixed(1); }).join(" ");
    svgEl("path", { d: chemin, class: "courbe__ligne", "aria-hidden": "true" }, svg);
    var ln = svgEl("text", { x: X(repere.brut) + 6, y: Y(repere.net) + 18, "text-anchor": "start", class: "courbe__etiquette", "aria-hidden": "true" }, svg);
    ln.textContent = "net";

    /* Point de la situation actuelle */
    if (d.actuel && d.actuel.brut <= xmax) {
      var g = svgEl("g", { class: "courbe__actuel", "aria-hidden": "true" }, svg);
      svgEl("line", { x1: X(d.actuel.brut), x2: X(d.actuel.brut), y1: Y(d.actuel.net), y2: m.haut + hp, class: "courbe__repere" }, g);
      svgEl("circle", { cx: X(d.actuel.brut), cy: Y(d.actuel.net), r: 5.5, class: "courbe__point" }, g);
    }

    /* Curseur de lecture */
    var gc = svgEl("g", { class: "courbe__curseur", "aria-hidden": "true", visibility: "hidden" }, svg);
    this.curseurLigne = svgEl("line", { y1: m.haut, y2: m.haut + hp, class: "courbe__curseur-ligne" }, gc);
    this.curseurPoint = svgEl("circle", { r: 4.5, class: "courbe__curseur-point" }, gc);
    this.curseur = gc;
    if (this.index !== null) this.afficherCurseur(this.index);
  };

  Courbe.prototype.indexDepuisX = function (xPx) {
    var g = this.geo;
    var v = ((xPx - g.m.gauche) / g.lp) * g.xmax;
    var pts = this.donnees.points;
    var k = Math.round((v / g.xmax) * (pts.length - 1));
    return Math.max(0, Math.min(pts.length - 1, k));
  };

  Courbe.prototype.survol = function (e) {
    if (!this.geo) return;
    var rect = this.svg.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (this.geo.largeur / rect.width);
    this.afficherCurseur(this.indexDepuisX(x));
  };

  Courbe.prototype.clavier = function (e) {
    var n = this.donnees.points.length;
    var k = this.index === null ? this.indexActuel() : this.index;
    var pas = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") k += pas;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") k -= pas;
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = n - 1;
    else if (e.key === "Escape") { this.masquerCurseur(); return; }
    else return;
    e.preventDefault();
    this.afficherCurseur(Math.max(0, Math.min(n - 1, k)), true);
  };

  Courbe.prototype.indexActuel = function () {
    var a = this.donnees.actuel;
    if (!a) return 0;
    return this.indexDepuisX(this.geo.X(a.brut));
  };

  Courbe.prototype.afficherCurseur = function (k, annoncer) {
    this.index = k;
    var p = this.donnees.points[k];
    var g = this.geo;
    var x = g.X(p.brut);
    var y = g.Y(p.net);
    this.curseur.setAttribute("visibility", "visible");
    this.curseurLigne.setAttribute("x1", x);
    this.curseurLigne.setAttribute("x2", x);
    this.curseurPoint.setAttribute("cx", x);
    this.curseurPoint.setAttribute("cy", y);
    var texte = "Brut " + fmtEntier.format(p.brut) + " DT → net " + fmtEntier.format(p.net) + " DT · taux marginal " + fmtTaux.format(p.tauxMarginal);
    this.info.hidden = false;
    this.info.textContent = texte;
    var rect = this.svg.getBoundingClientRect();
    var echelle = rect.width / g.largeur;
    var gauche = x * echelle;
    var largeurInfo = this.info.offsetWidth;
    gauche = Math.max(0, Math.min(rect.width - largeurInfo, gauche - largeurInfo / 2));
    this.info.style.transform = "translate(" + gauche.toFixed(0) + "px, " + Math.max(0, y * echelle - 54).toFixed(0) + "px)";
    if (annoncer && this.options.annoncer) this.options.annoncer(texte);
  };

  Courbe.prototype.masquerCurseur = function () {
    this.index = null;
    if (this.curseur) this.curseur.setAttribute("visibility", "hidden");
    this.info.hidden = true;
  };

  var API = { majBarre: majBarre, Courbe: Courbe, pasRond: pasRond };
  racine.Graphiques = API;
})(typeof self !== "undefined" ? self : this);
