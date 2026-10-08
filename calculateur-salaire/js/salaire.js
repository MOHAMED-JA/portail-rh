/*
 * Salaire net · Tunisie — interface « Lumineux et vivant »
 * S'appuie uniquement sur le moteur testé : config/parametres.js, js/calcul.js, js/etat.js.
 * Aucun montant décoratif : tout ce qui s'affiche vient du calcul.
 */
(function () {
  "use strict";

  var P = window.PARAMETRES_PAIE;
  var C = window.CalculSalaire;
  var E = window.EtatSimulation;
  var doc = document;
  var racine = doc.documentElement;
  function $(id) { return doc.getElementById(id); }
  var mouvementReduit = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var NS = "http://www.w3.org/2000/svg";

  /* ---------- Formats ---------- */
  function nbsp(s) { return s.replace(/ /g, " "); }
  var f3 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  var f2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var f1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var f0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var fSaisie = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
  var fPct = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  function dt3(v) { return nbsp(f3.format(C.arrondiMillime(v))); }
  function dt0(v) { return nbsp(f0.format(v)); }
  function pct(v) { return nbsp(fPct.format(v * 100)) + " %"; }
  function pct1(v) { return nbsp(f1.format(v * 100)) + " %"; }
  /* Brut trouvé par le calcul inverse : arrondi au millime supérieur, pour que le net soit bien atteint */
  function plafondMillime(v) { return Math.ceil(v * 1000 - 1e-6) / 1000; }
  function signe(v, fn) { return (v >= 0 ? "+" : "−") + (fn || dt3)(Math.abs(v)); }

  function lireMontant(texte) {
    var t = String(texte == null ? "" : texte).replace(/[\s  ]/g, "").replace(",", ".");
    if (t === "") return { vide: true, valide: true, valeur: 0 };
    var n = Number(t);
    if (!isFinite(n) || n < 0 || n > 1e9) return { vide: false, valide: false, valeur: 0 };
    return { vide: false, valide: true, valeur: n };
  }
  function radio(nom) { var r = doc.querySelector('input[name="' + nom + '"]:checked'); return r ? r.value : null; }
  function cocher(nom, valeur) { var r = doc.querySelector('input[name="' + nom + '"][value="' + valeur + '"]'); if (r) r.checked = true; }

  /* ---------- Bascules à pastille glissante ---------- */
  function placerPastille(groupe, animer) {
    var coche = groupe.querySelector("input:checked");
    var pastille = groupe.querySelector(".bascule__pastille");
    if (!coche || !pastille) return;
    var lab = coche.closest("label");
    if (!animer || mouvementReduit.matches) groupe.classList.add("sans-anim");
    pastille.style.setProperty("--x", (lab.offsetLeft - 4) + "px");
    pastille.style.setProperty("--l", lab.offsetWidth + "px");
    if (!animer || mouvementReduit.matches) requestAnimationFrame(function () { groupe.classList.remove("sans-anim"); });
  }
  function placerToutes(animer) { doc.querySelectorAll(".bascule").forEach(function (g) { placerPastille(g, animer); }); }
  doc.querySelectorAll(".bascule").forEach(function (g) {
    g.addEventListener("change", function () { placerPastille(g, true); });
  });
  var tailleTimer = null;
  window.addEventListener("resize", function () { placerToutes(false); clearTimeout(tailleTimer); tailleTimer = setTimeout(function () { if (dernier) calculer(false); }, 200); });

  /* ---------- Formulaire ---------- */
  var form = $("formulaire");
  var compteurs = { enfants: 0, etudiants: 0, handicapes: 0, parents: 0, salaires: P.versements.parDefaut, bSalaires: P.versements.parDefaut };
  var MIN = { enfants: 0, etudiants: 0, handicapes: 0, parents: 0, salaires: P.versements.minimum, bSalaires: P.versements.minimum };
  var MAX = { enfants: 15, etudiants: 15, handicapes: 15, parents: 2, salaires: P.versements.maximum, bSalaires: P.versements.maximum };

  $("taux-at").value = nbsp(fSaisie.format(P.employeur.accidentTravail.tauxParDefaut * 100));
  doc.querySelectorAll("[data-annee]").forEach(function (el) { el.textContent = String(P.annee); });
  $("date-verif").textContent = new Date(P.dateVerification + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  function lireEtat() {
    var at = lireMontant($("taux-at").value);
    function m(id) { var x = lireMontant($(id).value); return x.valide ? x.valeur : 0; }
    return {
      sens: radio("sens"),
      secteur: radio("secteur"),
      periode: radio("periode"),
      montant: lireMontant($("montant").value).valeur,
      nombreSalaires: compteurs.salaires,
      chefDeFamille: $("chef").checked,
      enfants: compteurs.enfants,
      etudiants: compteurs.etudiants,
      handicapes: compteurs.handicapes,
      parents: compteurs.parents,
      primesImposables: m("primes"),
      primesNonCotisables: m("non-cotisables"),
      avantagesNature: m("avantages"),
      indemnitesNonImposables: m("indemnites"),
      tauxAccidentTravailPct: at.vide || !at.valide || Math.abs(at.valeur - P.employeur.accidentTravail.tauxParDefaut * 100) < 1e-9 ? null : Math.min(at.valeur, P.employeur.accidentTravail.tauxMax * 100),
      industrieManufacturiere: $("industrie").checked
    };
  }

  function appliquerEtat(e) {
    function texte(id, v) { $(id).value = v ? nbsp(fSaisie.format(v)) : ""; }
    cocher("sens", e.sens);
    cocher("secteur", e.secteur);
    cocher("periode", e.periode);
    $("montant").value = nbsp(fSaisie.format(e.montant));
    compteurs.salaires = Math.max(MIN.salaires, Math.min(MAX.salaires, e.nombreSalaires || P.versements.parDefaut));
    $("chef").checked = !!e.chefDeFamille;
    ["enfants", "etudiants", "handicapes", "parents"].forEach(function (k) { compteurs[k] = Math.min(MAX[k], e[k] || 0); });
    texte("primes", e.primesImposables);
    texte("non-cotisables", e.primesNonCotisables);
    texte("avantages", e.avantagesNature);
    texte("indemnites", e.indemnitesNonImposables);
    $("taux-at").value = nbsp(fSaisie.format(e.tauxAccidentTravailPct == null ? P.employeur.accidentTravail.tauxParDefaut * 100 : e.tauxAccidentTravailPct));
    $("industrie").checked = !!e.industrieManufacturiere;
    if (e.etudiants || e.handicapes || e.parents || e.primesImposables || e.primesNonCotisables || e.avantagesNature || e.indemnitesNonImposables || e.tauxAccidentTravailPct != null || e.industrieManufacturiere) $("plus").open = true;
    majCompteurs();
  }

  function majCompteurs(saute) {
    Object.keys(compteurs).forEach(function (k) {
      var o = $(k);
      if (!o) return;
      o.textContent = String(compteurs[k]);
      if (saute === k && !mouvementReduit.matches) { o.classList.remove("saute"); void o.offsetWidth; o.classList.add("saute"); }
      doc.querySelectorAll('[data-cible="' + k + '"]').forEach(function (b) {
        var p = Number(b.getAttribute("data-pas"));
        b.disabled = p < 0 ? compteurs[k] <= MIN[k] : compteurs[k] >= MAX[k];
      });
    });
    $("ligne-enfants").hidden = !$("chef").checked;
    var n = compteurs.salaires;
    $("aide-salaires").textContent = n === 12 ? "12 = sans 13ᵉ mois" : n === 13 ? "13 = avec un 13ᵉ mois" : "dont " + (n - 12) + " versements en plus";
    var sens = radio("sens"), periode = radio("periode");
    $("lib-montant").textContent = "Salaire " + (sens === "net" ? "net" : "brut") + (periode === "annuel" ? " par an" : " par mois");
  }

  /* ---------- Calcul ---------- */
  function entreeBrut(etat, r) {
    var e = E.versEntree(etat);
    e.montant = r.periode === "annuel" ? r.annuel.salaireBase : r.annuel.salaireBase / r.entree.nombreSalaires;
    return e;
  }
  function calculerEtat(etat) {
    var entree = E.versEntree(etat);
    var inverse = null;
    if (etat.sens === "net") {
      inverse = C.calculerDepuisNet(entree, P);
      entree = entreeBrut(etat, inverse.resultat);
    }
    var av = C.calculerAvecVersements(entree, P);
    return { r: av.annee, m: av.moisType, v: av.versements, inverse: inverse, entree: entree };
  }

  /* ---------- Chiffres qui défilent ---------- */
  var chiffres = $("chiffres");
  function poserChiffres(entier, animer) {
    var colonnes = chiffres.children;
    var memeForme = colonnes.length === entier.length && Array.prototype.every.call(colonnes, function (col, i) {
      return (col.getAttribute("data-c") === "d") === /\d/.test(entier[i]);
    });
    if (!memeForme) {
      chiffres.textContent = "";
      for (var i = 0; i < entier.length; i++) {
        var col = doc.createElement("span");
        if (/\d/.test(entier[i])) {
          col.className = "chiffre";
          col.setAttribute("data-c", "d");
          var rouleau = doc.createElement("span");
          rouleau.className = "chiffre__rouleau";
          for (var n = 0; n <= 9; n++) { var s = doc.createElement("span"); s.textContent = String(n); rouleau.appendChild(s); }
          col.appendChild(rouleau);
        } else {
          col.className = "chiffre chiffre--fixe";
          col.setAttribute("data-c", "s");
          col.textContent = " ";
        }
        chiffres.appendChild(col);
      }
      animer = false;
    }
    Array.prototype.forEach.call(chiffres.children, function (col, i) {
      if (col.getAttribute("data-c") !== "d") return;
      var r = col.firstChild;
      r.style.transition = animer && !mouvementReduit.matches ? "transform 420ms cubic-bezier(.34,1.45,.64,1) " + ((entier.length - i) * 22) + "ms" : "none";
      r.style.transform = "translateY(" + (-Number(entier[i])) + "em)";
    });
  }

  /* ---------- Blocs de couleur ---------- */
  function poserBlocs(ids, parts, animer) {
    ids.forEach(function (id, i) {
      var b = $(id);
      var avant = Number(b.style.getPropertyValue("--g")) || 0;
      b.style.setProperty("--g", String(Math.max(parts[i], 0.0001)));
      var large = b.parentNode.clientWidth || 600;
      b.classList.toggle("etroit", parts[i] * large < 78);
      if (animer && Math.abs(avant - parts[i]) > 0.0005 && avant > 0) { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); }
    });
  }

  /* ---------- Rendu ---------- */
  var dernier = null;
  var annonceTimer = null;

  function rendre(calc, etat, animer) {
    var r = calc.r, m = calc.m, v = calc.v, a = r.annuel, ma = m.annuel;
    var mensuel = r.periode === "mensuel";
    var n = v.nombre;
    var div = mensuel ? P.moisParAn : 1;
    var base = mensuel ? ma : a;
    var inverse = etat.sens === "net";
    var caisse = r.regime.caisse;

    var principal = inverse ? plafondMillime(mensuel ? a.salaireBase / n : a.salaireBase) : (mensuel ? v.netMensuel : a.netAPayer);
    var lib = inverse ? (mensuel ? "Brut à demander par mois" : "Brut à demander par an") : (mensuel ? (n > 12 ? "Net à payer, mois habituel" : "Net à payer par mois") : "Net à payer par an");
    $("resultat-lib").textContent = lib;
    var texte = dt3(principal);
    var virgule = texte.lastIndexOf(",");
    poserChiffres(texte.slice(0, virgule), animer);
    $("decimales").textContent = texte.slice(virgule);

    var brutPer = mensuel ? ma.brutTotal / 12 : a.brutTotal;
    if (inverse) $("resultat-sous").textContent = "pour toucher " + dt3(etat.montant) + " DT net" + (calc.inverse && calc.inverse.verifie ? " — vérifié au millime." : ".");
    else $("resultat-sous").textContent = "sur " + dt3(brutPer) + " DT brut" + (a.primesImposables + a.primesNonCotisables + a.avantagesNature > 0 ? ", primes et avantages compris" : "") + " · " + r.regime.libelle.toLowerCase() + " · " + n + " salaires par an.";

    var b = Math.max(base.brutTotal, 1e-9);
    var parts = { cnss: base.cotisations / b, irpp: base.irpp / b, css: base.css / b };
    parts.net = Math.max(0, 1 - parts.cnss - parts.irpp - parts.css);
    poserBlocs(["bloc-net", "bloc-cnss", "bloc-irpp", "bloc-css"], [parts.net, parts.cnss, parts.irpp, parts.css], animer);
    $("bloc-cnss-lib").textContent = caisse;
    $("leg-cnss-lib").textContent = "Retraite et santé (" + caisse + ")";
    $("leg-net").textContent = dt3((base.brutTotal - base.cotisations - base.irpp - base.css) / div) + " DT";
    $("leg-cnss").textContent = dt3(base.cotisations / div) + " DT";
    $("leg-irpp").textContent = dt3(base.irpp / div) + " DT";
    $("leg-css").textContent = dt3(base.css / div) + " DT";
    $("leg-net-pct").textContent = pct1(parts.net) + " du brut";
    $("leg-cnss-pct").textContent = pct(r.indicateurs.tauxCotisations) + " de cotisations";
    $("leg-irpp-pct").textContent = base.irpp > 0 ? "taux marginal " + pct(m.indicateurs.tauxMarginalIrpp) : "aucun impôt";
    $("leg-css-pct").textContent = m.indicateurs.cssDispense ? "dispensé (petit revenu)" : pct(P.css.taux) + " du revenu imposable";

    var sup = $("supplement");
    if (mensuel && v.supplementaires > 0) {
      sup.hidden = false;
      sup.innerHTML = "En plus, <strong>" + v.supplementaires + " × " + dt3(v.netSupplementaire) + " DT net</strong> " +
        (v.supplementaires === 1 ? "pour votre 13ᵉ mois" : "pour vos versements supplémentaires") + ", soit <strong>" + dt3(a.netAPayer) + " DT net</strong> sur l'année.";
    } else sup.hidden = true;

    var alertes = [];
    if (r.indicateurs.enfantsIgnores > 0) alertes.push("Seuls les 4 premiers enfants ouvrent droit à la déduction (hors enfants handicapés).");
    if (!inverse && mensuel && a.salaireBase / n > 0 && a.salaireBase / n < P.reperes.smigMensuel40h) alertes.push("Ce salaire de base est inférieur au SMIG (" + dt3(P.reperes.smigMensuel40h) + " DT pour 40 h, " + dt3(P.reperes.smigMensuel48h) + " DT pour 48 h).");
    if (inverse && calc.inverse && !calc.inverse.verifie) alertes.push("Ce net n'est pas atteignable exactement ; le brut affiché donne le net le plus proche.");
    $("alerte").hidden = !alertes.length;
    $("alerte").textContent = alertes.join(" ");

    $("mini-lib").textContent = lib;
    $("mini-val").textContent = texte + " DT";
    clearTimeout(annonceTimer);
    annonceTimer = setTimeout(function () { $("montant-lu").textContent = lib + " : " + texte + " dinars."; }, 600);

    rendreCent(parts);
    rendreHausse(calc, etat);
    rendreEmployeur(r, mensuel, animer);
    rendreOffres(calc, etat);
    rendreDetail(calc);
    rendreCourbe(calc);
    dernier = { calc: calc, etat: etat };
  }

  /* ---------- Sur 100 dinars ---------- */
  var grille = $("grille-cent");
  for (var gi = 0; gi < 100; gi++) grille.appendChild(doc.createElement("span"));
  function rendreCent(parts) {
    var nb = { net: Math.round(parts.net * 100), cnss: Math.round(parts.cnss * 100), irpp: Math.round(parts.irpp * 100) };
    nb.css = Math.max(0, 100 - nb.net - nb.cnss - nb.irpp);
    var ordre = [].concat(Array(nb.net).fill("net"), Array(nb.cnss).fill("cnss"), Array(nb.irpp).fill("irpp"), Array(nb.css).fill("css"));
    Array.prototype.forEach.call(grille.children, function (c, i) { c.setAttribute("data-p", ordre[i] || ""); });
    function b2(k) { return '<b class="t-' + k + '">' + nbsp(f2.format(parts[k] * 100)) + " DT</b>"; }
    $("cent").innerHTML = b2("net") + " restent pour vous, " + b2("cnss") + " financent votre retraite et votre santé, " +
      b2("irpp") + " partent en impôt et " + b2("css") + " en contribution de solidarité. Chaque carré vaut 1 dinar.";
  }

  /* ---------- Augmentation ---------- */
  var BORNES = { brut: [0, 1000, 10], pourcent: [0, 30, 0.5], net: [0, 800, 10] };
  var modeHausse = "brut";
  var hausseCible = null;
  function majCurseur() {
    var c = $("hausse");
    var mensuel = radio("periode") === "mensuel";
    var bornes = BORNES[modeHausse];
    var facteur = modeHausse === "pourcent" || mensuel ? 1 : 12;
    c.min = String(bornes[0]); c.max = String(bornes[1] * facteur); c.step = String(bornes[2] * facteur);
    if (hausseCible !== null) { c.value = String(hausseCible); hausseCible = null; }
    if (Number(c.value) > Number(c.max)) c.value = c.max;
    c.style.setProperty("--p", ((Number(c.value) - Number(c.min)) / (Number(c.max) - Number(c.min)) * 100) + "%");
    var val = Number(c.value);
    $("hausse-val").textContent = "+" + (modeHausse === "pourcent" ? nbsp(fPct.format(val)) + " %" : dt0(val) + " DT " + (modeHausse === "net" ? "net" : "brut"));
  }
  var dernierAug = null;
  function rendreHausse(calc) {
    majCurseur();
    var mensuel = calc.r.periode === "mensuel";
    var per = mensuel ? " par mois" : " par an";
    var val = Number($("hausse").value);
    var aug = C.simulerAugmentation(calc.entree, P, { mode: modeHausse, valeur: val });
    dernierAug = aug;
    var f = aug.avant.entree.facteur;
    var netAvant = aug.avant.annuel.netAPayer / f, netApres = aug.apres.annuel.netAPayer / f;
    var maxi = Math.max(netApres, netAvant, 1);
    $("aa-avant").style.setProperty("--s", String(netAvant / maxi));
    $("aa-apres").style.setProperty("--s", String(netApres / maxi));
    $("aa-avant-val").textContent = dt3(netAvant) + " DT";
    $("aa-apres-val").textContent = dt3(netApres) + " DT";
    var html;
    if (!(val > 0)) html = "Choisissez une hausse pour voir son effet réel sur votre net.";
    else if (modeHausse === "net") html = "Pour gagner <b class=\"hausse\">" + signe(aug.hausseNet) + " DT net</b>" + per + ", demandez <b>" + signe(aug.hausseBrut) + " DT brut</b>. Votre employeur paiera <b>" + signe(aug.hausseCout) + " DT</b> de plus.";
    else html = "Vous gagnez <b class=\"hausse\">" + signe(aug.hausseNet) + " DT net</b>" + per + " : vous gardez <b>" + Math.round(aug.partNetDeLaHausseBrute * 100) + " %</b> du brut ajouté. Pour l'employeur, la hausse coûte <b>" + signe(aug.hausseCout) + " DT</b>.";
    $("verdict-hausse").innerHTML = html;
    $("hausse-annee").textContent = val > 0 && mensuel ? "Sur l'année (" + aug.nombreSalaires + " salaires) : " + signe(aug.hausseNetAnnuelle) + " DT net, " + signe(aug.hausseCoutAnnuel) + " DT de coût employeur." : "";
    $("hausse-vers-offre").disabled = !(aug.hausseBrut > 0.0005);
  }

  /* ---------- Employeur ---------- */
  function rendreEmployeur(r, mensuel, animer) {
    var rep = C.repartitionCoutEmployeur(r);
    var div = mensuel ? 12 : 1;
    $("cout-total").textContent = dt3(rep.total / div);
    $("cout-lib").textContent = "DT " + (mensuel ? "par mois" : "par an") + ", charges comprises";
    $("emp-caisse-lib").textContent = "Pour la " + r.regime.caisse;
    poserBlocs(["emp-salarie", "emp-caisse", "emp-etat"], [rep.salarie.part, rep.caisse.part, rep.etat.part], animer);
    ["salarie", "caisse", "etat"].forEach(function (k) {
      $("emp-" + k + "-val").textContent = dt3(rep[k].montant / div) + " DT";
      $("emp-" + k + "-pct").textContent = nbsp(f2.format(rep[k].part)) + " DT par dinar dépensé";
    });
  }

  /* ---------- Deux offres ---------- */
  var offreBTouchee = false;
  function etatB(etat) {
    var b = JSON.parse(JSON.stringify(etat));
    b.sens = "brut";
    b.periode = "mensuel";
    b.montant = lireMontant($("b-montant").value).valeur;
    b.secteur = radio("b-secteur");
    b.nombreSalaires = compteurs.bSalaires;
    return b;
  }
  function remplirOffre(cle, c, maxi) {
    var a = c.r.annuel;
    $("offre-" + cle + "-net").innerHTML = dt3(c.v.netMensuel) + " <small>DT net / mois</small>";
    $("offre-" + cle + "-barre").style.setProperty("--s", String(c.v.netMensuel / maxi));
    $("offre-" + cle + "-dl").innerHTML = [
      ["Brut par mois", dt3(c.v.brutMensuel) + " DT"],
      ["Net sur l'année", dt3(a.netAPayer) + " DT"],
      ["Coût employeur / an", dt3(a.coutEmployeur) + " DT"],
      ["Prélèvements", pct(c.r.indicateurs.tauxPrelevementGlobal)]
    ].map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
  }
  function rendreOffres(calc, etat) {
    var aBrut = JSON.parse(JSON.stringify(etat));
    aBrut.sens = "brut"; aBrut.periode = "mensuel";
    aBrut.montant = calc.r.annuel.salaireBase / calc.v.nombre;
    var cA = calculerEtat(aBrut);
    var bm = lireMontant($("b-montant").value);
    var ok = bm.valide && !bm.vide && bm.valeur > 0;
    $("b-montant").setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok) { remplirOffre("a", cA, cA.v.netMensuel); $("offre-b-net").textContent = "—"; $("offre-b-dl").textContent = ""; $("ecart").textContent = "Saisissez le salaire brut de l'autre offre."; return; }
    var cB = calculerEtat(etatB(etat));
    var maxi = Math.max(cA.v.netMensuel, cB.v.netMensuel, 1);
    remplirOffre("a", cA, maxi);
    remplirOffre("b", cB, maxi);
    var d = cB.v.netMensuel - cA.v.netMensuel;
    var dAn = cB.r.annuel.netAPayer - cA.r.annuel.netAPayer;
    $("ecart").innerHTML = Math.abs(d) < 0.0005 ? "Les deux offres donnent le même net." :
      "L'autre offre vous apporte <b class=\"" + (d > 0 ? "hausse" : "baisse") + "\">" + signe(d) + " DT net par mois</b>, soit <b>" + signe(dAn) + " DT</b> sur l'année.";
  }

  /* ---------- Détail ligne par ligne ---------- */
  function rendreDetail(calc) {
    var r = calc.r, m = calc.m, a = r.annuel, mensuel = r.periode === "mensuel";
    var ma = mensuel ? m.annuel : a;
    var div = mensuel ? 12 : 1;
    var libMois = calc.v.nombre > 12 ? "Mois habituel" : "Par mois";
    $("col-periode").textContent = mensuel ? libMois : "—";
    $("detail-legende").textContent = mensuel && calc.v.nombre > 12 ? "Mois habituel (retenue mensuelle) et année complète avec " + calc.v.nombre + " salaires." : "Montants en dinars.";
    var lignes = [];
    function L(lib, cle, opts) {
      var o = opts || {};
      var vm = typeof cle === "function" ? cle(ma) / div : ma[cle] / div;
      var va = typeof cle === "function" ? cle(a) : a[cle];
      if (o.siNonNul && Math.abs(va) < 0.0005) return;
      lignes.push({ lib: lib, vm: vm, va: va, classe: o.classe || "" });
    }
    L("Salaire de base", "salaireBase");
    L("Primes imposables", "primesImposables", { siNonNul: true });
    L("Primes non cotisables", "primesNonCotisables", { siNonNul: true });
    L("Avantages en nature", "avantagesNature", { siNonNul: true });
    L("Salaire brut total", "brutTotal", { classe: "cle" });
    a.cotisationsLignes.forEach(function (l, i) {
      L(l.libelle + " (" + pct(l.taux) + ")", function (x) { return x.cotisationsLignes[i].montant; }, { classe: "moins sous" });
    });
    L("Cotisations " + r.regime.caisse, "cotisations", { classe: "moins" });
    L("Frais professionnels (10 %" + (r.indicateurs.fraisPlafonnes ? ", plafonnés" : "") + ")", "fraisProfessionnels", { classe: "moins" });
    a.deductionsLignes.forEach(function (l, i) {
      L("Déduction : " + l.libelle + (l.nombre > 1 ? " × " + l.nombre : ""), function (x) { return x.deductionsLignes[i] ? x.deductionsLignes[i].montant : 0; }, { classe: "moins sous" });
    });
    L("Revenu imposable", "revenuImposable", { classe: "cle" });
    a.irppTranches.forEach(function (t, i) {
      if (!(t.impot > 0)) return;
      L("Tranche " + dt0(t.de) + (t.a ? " à " + dt0(t.a) : " et plus") + " DT à " + pct(t.taux), function (x) { return x.irppTranches[i].impot; }, { classe: "sous" });
    });
    L("Impôt sur le revenu (IRPP)", "irpp", { classe: "moins" });
    L("Contribution sociale de solidarité (CSS)", "css", { classe: "moins" });
    L("Avantages en nature (déjà perçus)", "avantagesNature", { classe: "moins", siNonNul: true });
    L("Indemnités non imposables", "indemnitesNonImposables", { siNonNul: true });
    L("Net à payer", "netAPayer", { classe: "cle" });
    a.chargesPatronalesLignes.forEach(function (l, i) {
      L("Employeur : " + l.libelle + " (" + pct(l.taux) + ")", function (x) { return x.chargesPatronalesLignes[i].montant; }, { classe: "sous" });
    });
    L("Coût total pour l'employeur", "coutEmployeur", { classe: "cle" });
    $("tableau-detail").tBodies[0].innerHTML = lignes.map(function (l) {
      return '<tr class="' + l.classe + '"><td>' + l.lib + '</td><td class="v" data-lib="' + (mensuel ? libMois : "") + '">' + (mensuel ? dt3(l.vm) : "—") + '</td><td class="v" data-lib="Par an">' + dt3(l.va) + "</td></tr>";
    }).join("");
  }

  /* ---------- Courbe net = f(brut) ---------- */
  var courbe = { points: [], index: 0, xmax: 1 };
  var G = { g: 52, d: 16, h: 14, b: 34, l: 640, H: 320 };
  var courbeTracee = false;
  function el(nom, attrs, parent) { var e = doc.createElementNS(NS, nom); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function pasRond(etendue, nb) { var brut = etendue / nb, p = Math.pow(10, Math.floor(Math.log10(brut))), q = brut / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; }
  function rendreCourbe(calc) {
    var mensuel = calc.r.periode === "mensuel";
    var entree = JSON.parse(JSON.stringify(calc.entree));
    if (mensuel) entree.nombreSalaires = P.versements.minimum;
    var actuel = entree.montant;
    var svg = $("courbe");
    var etroit = svg.parentNode.clientWidth < 560;
    G.l = etroit ? 360 : 640; G.H = etroit ? 280 : 320; G.g = etroit ? 46 : 52;
    svg.setAttribute("viewBox", "0 0 " + G.l + " " + G.H);
    svg.classList.toggle("etroit", etroit);
    var cible = Math.max(actuel * 2.5, mensuel ? 3000 : 36000);
    var pas = pasRond(cible, etroit ? 4 : 5);
    var xmax = Math.ceil(cible / pas) * pas;
    var pts = C.courbeNetBrut(entree, P, { min: 0, max: xmax, points: etroit ? 91 : 121 });
    /* Le point de la situation est calculé exactement, puis inséré dans l'échantillon */
    var exact = C.courbeNetBrut(entree, P, { min: actuel, max: actuel + 1e-6, points: 2 })[0];
    var plus = 0;
    while (plus < pts.length && pts[plus].brut < actuel) plus++;
    pts.splice(plus, 0, exact);
    courbe.points = pts; courbe.xmax = xmax; courbe.index = plus;
    svg.textContent = "";
    var W = G.l - G.g - G.d, H = G.H - G.h - G.b;
    function X(v) { return G.g + v / xmax * W; }
    function Y(v) { return G.h + H - v / xmax * H; }
    courbe.X = X; courbe.Y = Y;
    for (var t = 0; t <= xmax + 1e-9; t += pas) {
      el("line", { x1: G.g, x2: G.g + W, y1: Y(t), y2: Y(t), "class": "axe" }, svg);
      el("text", { x: G.g - 8, y: Y(t) + 4, "text-anchor": "end", "class": "grad" }, svg).textContent = dt0(t);
      el("text", { x: X(t), y: G.H - 10, "text-anchor": "middle", "class": "grad" }, svg).textContent = dt0(t);
    }
    el("path", { d: "M" + X(0) + " " + Y(0) + "L" + X(xmax) + " " + Y(xmax), "class": "ligne-brut" }, svg);
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p.brut).toFixed(1) + " " + Y(p.net).toFixed(1); }).join("");
    el("path", { d: d + "L" + X(xmax).toFixed(1) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z", "class": "zone-net" }, svg);
    var ligne = el("path", { d: d, "class": "ligne-net" }, svg);
    if (!courbeTracee && courbeVisible) { courbeTracee = true; tracer(ligne); }
    courbe.ligne = ligne;
    courbe.repere = el("line", { "class": "repere" }, svg);
    courbe.point = el("circle", { r: 7, "class": "point" }, svg);
    lireCourbe(plus, true);
  }
  function tracer(ligne) {
    if (mouvementReduit.matches || !ligne.getTotalLength) return;
    ligne.style.setProperty("--long", String(Math.ceil(ligne.getTotalLength())));
    ligne.classList.add("trace");
  }
  function lireCourbe(i, actuel) {
    var p = courbe.points[i];
    if (!p) return;
    courbe.index = i;
    var x = courbe.X(p.brut), y = courbe.Y(p.net);
    courbe.point.setAttribute("cx", x); courbe.point.setAttribute("cy", y);
    courbe.repere.setAttribute("x1", x); courbe.repere.setAttribute("x2", x);
    courbe.repere.setAttribute("y1", y); courbe.repere.setAttribute("y2", courbe.Y(0));
    var per = radio("periode") === "mensuel" ? "par mois" : "par an";
    $("courbe-info").innerHTML = (actuel ? "Votre situation : " : "Pour ") + "<b>" + dt3(p.brut) + " DT</b> de salaire de base " + per + ", <b>" + dt3(p.net) + " DT</b> net. Taux marginal d'impôt : " + pct(p.tauxMarginal) + ".";
  }
  (function brancherCourbe() {
    var svg = $("courbe");
    function depuisPointeur(e) {
      if (!courbe.points.length) return;
      var rect = svg.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width * G.l;
      var v = (x - G.g) / (G.l - G.g - G.d) * courbe.xmax;
      var best = 0;
      courbe.points.forEach(function (p, i) { if (Math.abs(p.brut - v) < Math.abs(courbe.points[best].brut - v)) best = i; });
      lireCourbe(best, false);
    }
    svg.addEventListener("pointermove", depuisPointeur);
    svg.addEventListener("pointerdown", depuisPointeur);
    svg.addEventListener("keydown", function (e) {
      var i = courbe.index;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") i = Math.min(courbe.points.length - 1, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") i = Math.max(0, i - 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = courbe.points.length - 1;
      else return;
      e.preventDefault();
      lireCourbe(i, false);
    });
  })();

  /* ---------- Apparitions au défilement (une fois) ---------- */
  var courbeVisible = false;
  if ("IntersectionObserver" in window && !mouvementReduit.matches) {
    grille.classList.add("attente");
    var obs = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) {
        if (!en.isIntersecting) return;
        var s = en.target;
        s.classList.add("revelee");
        obs.unobserve(s);
        if (s.id === "section-cent") {
          Array.prototype.forEach.call(grille.children, function (c, i) { c.style.transitionDelay = (i * 7) + "ms"; });
          requestAnimationFrame(function () { grille.classList.remove("attente"); });
          setTimeout(function () { Array.prototype.forEach.call(grille.children, function (c) { c.style.transitionDelay = ""; }); }, 1400);
        }
        if (s.id === "section-courbe") { courbeVisible = true; if (courbe.ligne && !courbeTracee) { courbeTracee = true; tracer(courbe.ligne); } }
      });
    }, { threshold: 0.18 });
    doc.querySelectorAll(".section").forEach(function (s) { s.classList.add("a-reveler"); obs.observe(s); });
  } else courbeVisible = true;

  /* ---------- Cycle de calcul ---------- */
  var adresseTimer = null;
  function requete() {
    var a = lireEtat();
    return E.encoder(a, offreBTouchee ? etatB(a) : null);
  }
  function majAdresse() {
    clearTimeout(adresseTimer);
    adresseTimer = setTimeout(function () { try { history.replaceState(null, "", "?" + requete()); } catch (e) {} }, 400);
  }
  function calculer(animer) {
    var etat = lireEtat();
    var lu = lireMontant($("montant").value);
    var champ = $("montant"), err = $("erreur-montant");
    if (!lu.valide || lu.vide || lu.valeur <= 0) {
      champ.setAttribute("aria-invalid", "true");
      err.textContent = lu.vide ? "Indiquez un montant pour lancer le calcul." : "Montant non reconnu : écrivez un nombre, par exemple 2 500 ou 2 500,750.";
      err.hidden = false;
      $("resultat").setAttribute("data-etat", "invalide");
      return;
    }
    champ.setAttribute("aria-invalid", "false");
    err.hidden = true;
    $("resultat").removeAttribute("data-etat");
    rendre(calculerEtat(etat), etat, animer);
    majAdresse();
  }

  var frappe = null;
  $("montant").addEventListener("input", function () { clearTimeout(frappe); frappe = setTimeout(function () { calculer(false); }, 120); });
  $("montant").addEventListener("blur", function () {
    var lu = lireMontant(this.value);
    if (lu.valide && !lu.vide) this.value = nbsp(fSaisie.format(lu.valeur));
  });
  ["primes", "non-cotisables", "avantages", "indemnites", "taux-at"].forEach(function (id) {
    $(id).addEventListener("input", function () { clearTimeout(frappe); frappe = setTimeout(function () { calculer(false); }, 160); });
  });
  $("industrie").addEventListener("change", function () { calculer(true); });
  $("chef").addEventListener("change", function () { majCompteurs(); calculer(true); });
  doc.querySelectorAll('input[name="secteur"]').forEach(function (r) { r.addEventListener("change", function () { calculer(true); }); });

  /* Changer de sens : le résultat devient le nouveau point de départ */
  doc.querySelectorAll('input[name="sens"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (dernier) {
        var c = dernier.calc, mensuel = c.r.periode === "mensuel";
        var v = this.value === "net" ? C.arrondiMillime(mensuel ? c.v.netMensuel : c.r.annuel.netAPayer) : plafondMillime(mensuel ? c.r.annuel.salaireBase / c.v.nombre : c.r.annuel.salaireBase);
        $("montant").value = nbsp(fSaisie.format(v));
      }
      majCompteurs();
      calculer(true);
    });
  });
  /* Changer de période : convertir les montants, et le net à partir du vrai net annuel */
  doc.querySelectorAll('input[name="periode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var vers = this.value;
      hausseCible = modeHausse === "pourcent" ? 5 : 200 * (vers === "annuel" ? 12 : 1);
      if (dernier) {
        var c = dernier.calc, montant;
        if (dernier.etat.sens === "net") montant = vers === "annuel" ? c.r.annuel.netAPayer : c.v.netMensuel;
        else montant = plafondMillime(vers === "annuel" ? c.r.annuel.salaireBase : c.r.annuel.salaireBase / c.v.nombre);
        $("montant").value = nbsp(fSaisie.format(C.arrondiMillime(montant)));
        ["primes", "non-cotisables", "avantages", "indemnites"].forEach(function (id) {
          var x = lireMontant($(id).value);
          if (x.valide && !x.vide && x.valeur > 0) $(id).value = nbsp(fSaisie.format(C.arrondiMillime(x.valeur * (vers === "annuel" ? 12 : 1 / 12))));
        });
      }
      majCompteurs();
      calculer(true);
    });
  });

  doc.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pas]");
    if (!b || b.disabled) return;
    var k = b.getAttribute("data-cible");
    compteurs[k] = Math.max(MIN[k], Math.min(MAX[k], compteurs[k] + Number(b.getAttribute("data-pas"))));
    majCompteurs(k);
    if (k === "bSalaires") { offreBTouchee = true; if (dernier) { rendreOffres(dernier.calc, dernier.etat); majAdresse(); } }
    else calculer(true);
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  /* Augmentation */
  doc.querySelectorAll('input[name="mode-hausse"]').forEach(function (r) {
    r.addEventListener("change", function () {
      modeHausse = this.value;
      hausseCible = modeHausse === "pourcent" ? 5 : 200 * (radio("periode") === "annuel" ? 12 : 1);
      if (dernier) rendreHausse(dernier.calc);
    });
  });
  $("hausse").addEventListener("input", function () { if (dernier) rendreHausse(dernier.calc); });
  $("hausse-vers-offre").addEventListener("click", function () {
    if (!dernierAug || !dernier) return;
    var c = dernier.calc;
    var mensuel = c.r.periode === "mensuel";
    var brutApres = dernierAug.salaireBaseApres / (mensuel ? 1 : 12);
    $("b-montant").value = nbsp(fSaisie.format(C.arrondiMillime(brutApres)));
    cocher("b-secteur", dernier.etat.secteur);
    compteurs.bSalaires = c.v.nombre;
    majCompteurs();
    placerToutes(false);
    offreBTouchee = true;
    rendreOffres(c, dernier.etat);
    majAdresse();
    $("section-offres").scrollIntoView({ behavior: mouvementReduit.matches ? "auto" : "smooth", block: "start" });
    toast("L'offre augmentée est prête à comparer.");
  });

  /* Offre B */
  $("b-montant").addEventListener("input", function () { offreBTouchee = true; if (dernier) { rendreOffres(dernier.calc, dernier.etat); majAdresse(); } });
  doc.querySelectorAll('input[name="b-secteur"]').forEach(function (r) { r.addEventListener("change", function () { offreBTouchee = true; if (dernier) { rendreOffres(dernier.calc, dernier.etat); majAdresse(); } }); });

  /* ---------- Thème ---------- */
  function themeActuel() { return racine.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function majTheme() {
    var sombre = themeActuel() === "dark";
    var b = $("bascule-theme");
    b.querySelector("use").setAttribute("href", sombre ? "#i-soleil" : "#i-lune");
    b.setAttribute("aria-label", sombre ? "Passer au thème clair" : "Passer au thème sombre");
    doc.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute("content", sombre ? "#0B0D12" : "#F4F5F7"); });
  }
  $("bascule-theme").addEventListener("click", function () {
    var t = themeActuel() === "dark" ? "light" : "dark";
    racine.setAttribute("data-theme", t);
    try { localStorage.setItem("calc-theme", t); } catch (e) {}
    majTheme();
  });
  majTheme();

  /* ---------- Partage, impression, installation ---------- */
  var toastTimer = null;
  function toast(t) {
    var el2 = $("toast");
    el2.textContent = t;
    el2.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el2.classList.remove("visible"); }, 2600);
  }
  function lienPartage() {
    var base = /\/outils\/salaire\//.test(location.pathname) ? "https://mohamed-ja.github.io/portail-rh/calculateur-salaire/" : location.origin + location.pathname;
    return base + "?" + requete();
  }
  function basculerLibelle(texte) {
    var b = $("partager"), l = $("partager-lib");
    b.classList.add("bascule-lib");
    setTimeout(function () { l.textContent = texte; b.classList.remove("bascule-lib"); }, 160);
    setTimeout(function () { b.classList.add("bascule-lib"); setTimeout(function () { l.textContent = "Partager"; b.classList.remove("bascule-lib"); }, 160); }, 2400);
  }
  $("partager").addEventListener("click", function () {
    var lien = lienPartage();
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      navigator.share({ title: doc.title, text: "Mon calcul de salaire net (Tunisie)", url: lien }).catch(function () {});
      return;
    }
    var copie = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(lien) : Promise.reject();
    copie.then(function () { basculerLibelle("Lien copié"); }, function () { window.prompt("Copiez ce lien :", lien); });
  });
  $("imprimer").addEventListener("click", function () { window.print(); });
  var invitation = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invitation = e; $("installer").hidden = false; });
  $("installer").addEventListener("click", function () {
    if (!invitation) return;
    invitation.prompt();
    invitation.userChoice.finally(function () { invitation = null; $("installer").hidden = true; });
  });

  /* ---------- Guide et sources ---------- */
  (function remplirSources() {
    var vues = {}, items = [];
    (function parcourir(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(parcourir); return; }
      if (o.source && (o.libelle || o.taux != null) && !vues[o.source]) { vues[o.source] = 1; items.push([o.libelle || "", o.source]); }
      Object.keys(o).forEach(function (k) { if (k !== "source") parcourir(o[k]); });
    })(P);
    if (P.reperes && P.reperes.smigSource) items.push(["SMIG " + P.annee, P.reperes.smigSource]);
    var ul = $("sources");
    items.forEach(function (it) {
      var li = doc.createElement("li");
      if (it[0]) { var b = doc.createElement("b"); b.textContent = it[0] + " : "; li.appendChild(b); }
      li.appendChild(doc.createTextNode(it[1]));
      ul.appendChild(li);
    });
  })();
  var guide = $("guide"), ouvreur = null;
  function ouvrirGuide(e) { ouvreur = e.currentTarget; guide.showModal(); }
  $("ouvrir-guide").addEventListener("click", ouvrirGuide);
  $("ouvrir-guide-2").addEventListener("click", ouvrirGuide);
  $("fermer-guide").addEventListener("click", function () { guide.close(); });
  guide.addEventListener("close", function () { if (ouvreur) ouvreur.focus(); });
  guide.addEventListener("click", function (e) {
    if (e.target !== guide) return;
    var r = guide.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) guide.close();
  });

  /* ---------- Résultat miniature (téléphone) ----------
     Visible quand le grand montant est encore sous l'écran (pendant la saisie)
     ou quand toute la carte de résultat est passée au-dessus. */
  (function () {
    var mini = $("mini"), net = $("chiffres"), zone = $("resultat"), prevu = false;
    function maj() {
      prevu = false;
      var h = window.innerHeight, rn = net.getBoundingClientRect(), rz = zone.getBoundingClientRect();
      var visible = rn.bottom > h || rz.bottom < 0;
      mini.classList.toggle("visible", visible);
      mini.setAttribute("aria-hidden", visible ? "false" : "true");
      mini.tabIndex = visible ? 0 : -1;
    }
    function planifier() { if (!prevu) { prevu = true; requestAnimationFrame(maj); } }
    window.addEventListener("scroll", planifier, { passive: true });
    window.addEventListener("resize", planifier);
    planifier();
  })();
  $("mini").addEventListener("click", function (e) {
    e.preventDefault();
    $("resultat").scrollIntoView({ behavior: mouvementReduit.matches ? "auto" : "smooth", block: "start" });
    $("resultat").focus({ preventScroll: true });
  });

  /* ---------- Hors connexion (portail public seulement) ---------- */
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    if (/\/outils\//.test(location.pathname)) {
      navigator.serviceWorker.getRegistrations && navigator.serviceWorker.getRegistrations().then(function (l) { l.forEach(function (r) { if (r.scope.indexOf("/outils/") !== -1) r.unregister(); }); }).catch(function () {});
    } else {
      window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
    }
  }

  /* ---------- Espace Finances TN : état et résumé pour l'enregistrement ---------- */
  window.EspaceOutil = {
    outil: "salaire",
    etat: function () { return requete(); },
    resume: function () {
      if (!dernier) return null;
      var c = dernier.calc, etat = dernier.etat, a = c.r.annuel, n = c.v.nombre, mensuel = c.r.periode === "mensuel";
      var net = mensuel ? c.v.netMensuel : a.netAPayer;
      var famille = etat.chefDeFamille ? "chef de famille" + (etat.enfants ? ", " + etat.enfants + " enfant" + (etat.enfants > 1 ? "s" : "") : "") : "célibataire";
      return {
        principal: { libelle: mensuel ? (n > 12 ? "Net du mois habituel" : "Net à payer mensuel") : "Net à payer annuel", valeur: C.arrondiMillime(net), unite: "DT" },
        secondaires: [
          { libelle: mensuel ? "Brut" : "Brut annuel", valeur: C.arrondiMillime(mensuel ? a.salaireBase / n : a.salaireBase), unite: "DT" },
          { libelle: "Coût employeur / an", valeur: Math.round(a.coutEmployeur), unite: "DT" },
          { libelle: "Prélèvements", valeur: Math.round(c.r.indicateurs.tauxPrelevementGlobal * 10000) / 100, unite: "%" }
        ],
        ligne: c.r.regime.libelle + " · " + c.r.regime.caisse + " · " + n + " salaires · " + famille
      };
    },
    nomParDefaut: function () {
      var etat = lireEtat();
      return "Salaire " + dt0(etat.montant || 0) + " DT " + (etat.sens === "net" ? "net" : "brut") +
        (etat.periode === "annuel" ? " / an" : "") + " · " + (etat.secteur === "public" ? "public" : "privé");
    },
    charger: function (texte) {
      var d = E.decoder(texte);
      if (!d.a) return false;
      appliquerEtat(d.a);
      if (d.b) appliquerOffreB(d.b);
      placerToutes(false);
      calculer(true);
      return true;
    }
  };

  function appliquerOffreB(b) {
    $("b-montant").value = nbsp(fSaisie.format(b.montant));
    cocher("b-secteur", b.secteur);
    compteurs.bSalaires = Math.max(MIN.bSalaires, Math.min(MAX.bSalaires, b.nombreSalaires || P.versements.parDefaut));
    offreBTouchee = true;
    majCompteurs();
  }

  /* ---------- Démarrage ---------- */
  var recu = E.decoder(location.search);
  if (recu.a) {
    appliquerEtat(recu.a);
    if (recu.b) appliquerOffreB(recu.b);
  } else majCompteurs();
  placerToutes(false);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { placerToutes(false); });
  if (!mouvementReduit.matches) { doc.body.classList.add("entree"); setTimeout(function () { doc.body.classList.remove("entree"); }, 900); }
  calculer(false);
})();
