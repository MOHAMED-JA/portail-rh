/*
 * Salaire net · Tunisie — interface « billet de dinar »
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
  var f0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var fSaisie = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
  var fPct = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  function dt3(v) { return nbsp(f3.format(C.arrondiMillime(v))); }
  function dt0(v) { return nbsp(f0.format(v)); }
  function pct(v) { return nbsp(fPct.format(v * 100)) + " %"; }
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

  /* ---------- Formulaire ---------- */
  var form = $("formulaire");
  var compteurs = { enfants: 0, etudiants: 0, handicapes: 0, parents: 0 };
  var MAX = { enfants: 15, etudiants: 15, handicapes: 15, parents: 2 };

  (function remplirSalaires() {
    ["nombre-salaires", "b-salaires"].forEach(function (id) {
      var s = $(id);
      for (var n = P.versements.minimum; n <= P.versements.maximum; n++) {
        var o = doc.createElement("option");
        o.value = String(n);
        o.textContent = String(n);
        s.appendChild(o);
      }
      s.value = String(P.versements.parDefaut);
    });
  })();
  $("taux-at").value = nbsp(fSaisie.format(P.employeur.accidentTravail.tauxParDefaut * 100));
  doc.querySelectorAll("[data-annee]").forEach(function (el) { el.textContent = String(P.annee); });
  $("date-verif").textContent = new Date(P.dateVerification + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  function lireEtat() {
    var at = lireMontant($("taux-at").value);
    function m(id) { var x = lireMontant($(id).value); return x.valide ? x.valeur : 0; }
    return {
      sens: $("sens").value,
      secteur: $("secteur").value,
      periode: $("periode").value,
      montant: lireMontant($("montant").value).valeur,
      nombreSalaires: Number($("nombre-salaires").value),
      chefDeFamille: $("chef").value === "1",
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
    $("sens").value = e.sens;
    $("secteur").value = e.secteur;
    $("periode").value = e.periode;
    $("montant").value = nbsp(fSaisie.format(e.montant));
    $("nombre-salaires").value = String(e.nombreSalaires || P.versements.parDefaut);
    $("chef").value = e.chefDeFamille ? "1" : "0";
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

  function majCompteurs() {
    Object.keys(compteurs).forEach(function (k) {
      $(k).textContent = String(compteurs[k]);
      doc.querySelectorAll('[data-cible="' + k + '"]').forEach(function (b) {
        var p = Number(b.getAttribute("data-pas"));
        b.disabled = p < 0 ? compteurs[k] <= 0 : compteurs[k] >= MAX[k];
      });
    });
    $("mot-enfants").textContent = compteurs.enfants > 1 ? "enfants" : "enfant";
    $("bloc-enfants").hidden = $("chef").value !== "1";
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

  /* ---------- Guilloches (dessinées par le code) ---------- */
  function rosacePaths(lobes, amplitude, anneaux, rayon) {
    var chemins = [];
    for (var k = 0; k < anneaux; k++) {
      var r0 = rayon * (0.32 + 0.68 * k / Math.max(1, anneaux - 1));
      var a = amplitude * (0.35 + 0.65 * (1 - k / anneaux)) * rayon * 0.16;
      var phase = k * Math.PI / lobes;
      var d = "";
      for (var i = 0; i <= 360; i++) {
        var t = i / 360 * Math.PI * 2;
        var r = r0 + a * Math.sin(lobes * t + phase) + a * 0.35 * Math.sin(lobes * 3 * t - phase);
        d += (i ? "L" : "M") + (r * Math.cos(t)).toFixed(2) + " " + (r * Math.sin(t)).toFixed(2);
      }
      chemins.push(d + "Z");
    }
    return chemins;
  }
  function dessinerRosace(svg, lobes, amplitude, anneaux, rayon, epaisseur) {
    var chemins = rosacePaths(lobes, amplitude, anneaux, rayon);
    var existants = svg.querySelectorAll("path");
    if (existants.length !== chemins.length) {
      svg.textContent = "";
      chemins.forEach(function (d) {
        var p = doc.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "currentColor");
        p.setAttribute("stroke-width", epaisseur);
        p.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(p);
      });
      return;
    }
    existants.forEach(function (p, i) {
      p.setAttribute("d", chemins[i]);
      if (!mouvementReduit.matches) p.style.d = 'path("' + chemins[i] + '")';
    });
  }
  (function dessinerTrame() {
    var svg = $("trame");
    svg.setAttribute("viewBox", "0 0 600 300");
    var d = "";
    for (var j = 0; j < 34; j++) {
      var y0 = 6 + j * 8.8;
      for (var x = 0; x <= 600; x += 6) {
        var y = y0 + 3.2 * Math.sin(x / 38 + j * 0.42) + 1.6 * Math.sin(x / 11 - j);
        d += (x ? "L" : "M") + x + " " + y.toFixed(1);
      }
    }
    var p = doc.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "0.6");
    p.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(p);
    var sceau = $("sceau");
    sceau.setAttribute("viewBox", "-20 -20 40 40");
    var c = doc.createElementNS(NS, "circle");
    c.setAttribute("r", "18.5"); c.setAttribute("fill", "none"); c.setAttribute("stroke", "currentColor"); c.setAttribute("stroke-width", "1.2");
    sceau.appendChild(c);
    rosacePaths(12, 0.9, 4, 16).forEach(function (dd) {
      var q = doc.createElementNS(NS, "path");
      q.setAttribute("d", dd); q.setAttribute("fill", "none"); q.setAttribute("stroke", "currentColor"); q.setAttribute("stroke-width", "0.8");
      sceau.appendChild(q);
    });
  })();

  /* ---------- Compteur de numérotation (chiffres qui roulent) ---------- */
  var chiffres = $("chiffres");
  function poserChiffres(entier, animer) {
    var colonnes = chiffres.children;
    var memeForme = colonnes.length === entier.length && Array.prototype.every.call(colonnes, function (col, i) {
      return (col.getAttribute("data-c") === "d") === /\d/.test(entier[i]);
    });
    if (!memeForme) {
      chiffres.textContent = "";
      for (var i = 0; i < entier.length; i++) {
        var ch = entier[i];
        var col = doc.createElement("span");
        if (/\d/.test(ch)) {
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
      r.style.transition = animer && !mouvementReduit.matches ? "transform 300ms cubic-bezier(.23,1,.32,1) " + ((entier.length - i) * 18) + "ms" : "none";
      r.style.transform = "translateY(" + (-Number(entier[i])) + "em)";
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
    var base = mensuel ? ma : a; /* mois type ×12 en mensuel, année réelle en annuel */
    var inverse = etat.sens === "net";
    var caisse = r.regime.caisse;

    var principal = inverse ? plafondMillime(mensuel ? a.salaireBase / n : a.salaireBase) : (mensuel ? v.netMensuel : a.netAPayer);
    var lib = inverse ? (mensuel ? "Brut à demander par mois" : "Brut à demander par an") : (mensuel ? (n > 12 ? "Net à payer, mois habituel" : "Net à payer par mois") : "Net à payer par an");
    $("billet-libelle").textContent = lib;

    var texte = dt3(principal);
    var virgule = texte.lastIndexOf(",");
    poserChiffres(texte.slice(0, virgule), animer);
    $("decimales").textContent = texte.slice(virgule);

    var brutMois = mensuel ? ma.brutTotal / 12 : a.brutTotal;
    var netMois = mensuel ? v.netMensuel : a.netAPayer;
    if (inverse) {
      var ok = calc.inverse && calc.inverse.verifie;
      $("billet-sous").textContent = "pour toucher " + dt3(etat.montant) + " DT net" + (ok ? " — vérifié au millime." : ".");
    } else {
      $("billet-sous").textContent = "sur " + dt3(brutMois) + " DT brut" + (a.primesImposables + a.primesNonCotisables + a.avantagesNature > 0 ? ", primes et avantages compris." : ".");
    }

    var garde = (base.brutTotal - base.cotisations - base.irpp - base.css) / Math.max(base.brutTotal, 1e-9);
    $("part-gardee").textContent = Math.round(garde * 100) + " %";
    $("part-lib").textContent = "de votre brut vous revient";

    var morceaux = [
      "<strong>" + r.regime.libelle + "</strong> · " + caisse + " " + pct(r.indicateurs.tauxCotisations),
      n + " salaires par an",
      etat.chefDeFamille ? "Chef de famille" + (etat.enfants ? ", " + etat.enfants + (etat.enfants > 1 ? " enfants" : " enfant") : "") : "Sans charge de famille déclarée",
      "Net sur l'année <strong>" + dt3(a.netAPayer) + " DT</strong>"
    ];
    $("billet-bas").innerHTML = morceaux.map(function (x) { return "<span>" + x + "</span>"; }).join("");

    var serie = String(Math.round(mensuel ? a.salaireBase / n : a.salaireBase / 12));
    $("serie").textContent = "N° " + ("0000000" + serie).slice(-7) + " · " + caisse + " · " + n;
    var micro = (dt3(netMois) + " DT NET · " + dt3(brutMois) + " DT BRUT · " + caisse + " " + dt3(base.cotisations / div) + " · IRPP " + dt3(base.irpp / div) + " · CSS " + dt3(base.css / div) + " · ").toUpperCase();
    $("micro").textContent = new Array(8).join(micro);

    dessinerRosace($("rosace"), n, 0.45 + garde, 9, 92, 0.9);

    /* Coupons : retenues de la période (mois habituel ou année) */
    $("coupon-cnss-lib").textContent = "Retraite et santé · " + caisse;
    $("coupon-cnss").textContent = dt3(base.cotisations / div);
    $("coupon-cnss-note").textContent = pct(r.indicateurs.tauxCotisations) + " du salaire soumis à cotisation";
    $("coupon-irpp").textContent = dt3(base.irpp / div);
    $("coupon-irpp-note").textContent = base.irpp > 0 ? "Taux marginal " + pct(m.indicateurs.tauxMarginalIrpp) + " sur la dernière tranche" : "Aucun impôt à ce niveau de revenu";
    $("coupon-css").textContent = dt3(base.css / div);
    $("coupon-css-note").textContent = m.indicateurs.cssDispense ? "Dispensé : revenu imposable sous " + dt0(P.css.seuilDispense) + " DT par an" : pct(P.css.taux) + " du revenu imposable";

    /* Versements en plus (13e mois…) */
    var sup = $("supplement");
    if (mensuel && v.supplementaires > 0) {
      sup.hidden = false;
      sup.innerHTML = "En plus : <strong>" + v.supplementaires + " × " + dt3(v.netSupplementaire) + " DT</strong> net " +
        (v.supplementaires === 1 ? "pour votre 13ᵉ mois" : "pour vos versements supplémentaires") + ", soit " + dt3(a.netAPayer) + " DT net sur l'année.";
    } else sup.hidden = true;

    /* Alertes utiles */
    var alertes = [];
    if (r.indicateurs.enfantsIgnores > 0) alertes.push("Seuls les 4 premiers enfants ouvrent droit à la déduction (hors enfants en situation de handicap).");
    if (!inverse && mensuel && a.salaireBase / n > 0 && a.salaireBase / n < P.reperes.smigMensuel40h) alertes.push("Ce salaire de base est inférieur au SMIG (" + dt3(P.reperes.smigMensuel40h) + " DT pour 40 h, " + dt3(P.reperes.smigMensuel48h) + " DT pour 48 h).");
    if (inverse && calc.inverse && !calc.inverse.verifie) alertes.push("Ce net n'est pas atteignable exactement ; le brut affiché donne le net le plus proche.");
    $("alerte").hidden = !alertes.length;
    $("alerte").textContent = alertes.join(" ");

    /* Billet miniature */
    $("mini-lib").textContent = lib;
    $("mini-val").textContent = texte + " DT";

    /* Annonce pour les lecteurs d'écran, sans bavardage pendant la frappe */
    clearTimeout(annonceTimer);
    annonceTimer = setTimeout(function () { $("montant-lu").textContent = lib + " : " + texte + " dinars."; }, 600);

    rendreCent(base);
    rendreHausse(calc, etat);
    rendreEmployeur(r, mensuel);
    rendreOffres(calc, etat);
    rendreDetail(calc, etat);
    rendreCourbe(calc, etat);
    dernier = { calc: calc, etat: etat };
  }

  function rendreCent(base) {
    var b = Math.max(base.brutTotal, 1e-9);
    var parts = { cnss: base.cotisations / b, irpp: base.irpp / b, css: base.css / b };
    parts.net = Math.max(0, 1 - parts.cnss - parts.irpp - parts.css);
    ["net", "cnss", "irpp", "css"].forEach(function (k) { $("fil-" + k).style.setProperty("--g", String(Math.max(parts[k], 0.0001))); });
    function b2(k) { return '<b class="t-' + k + '">' + nbsp(f2.format(parts[k] * 100)) + "</b>"; }
    $("cent").innerHTML = "Sur 100 dinars de brut, " + b2("net") + " restent pour vous, " + b2("cnss") +
      " financent votre retraite et votre santé, " + b2("irpp") + " partent en impôt et " + b2("css") + " en contribution de solidarité.";
  }

  /* ---------- Et si… (augmentation) ---------- */
  var BORNES = { brut: [0, 1000, 10], pourcent: [0, 30, 0.5], net: [0, 800, 10] };
  var modeHausse = "brut";
  var hausseCible = null; /* appliquée après mise à jour des bornes, pour éviter l'arrondi au pas */
  function majCurseur() {
    var c = $("hausse");
    var mensuel = $("periode").value === "mensuel";
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
  function rendreHausse(calc, etat) {
    majCurseur();
    var mensuel = calc.r.periode === "mensuel";
    var per = mensuel ? " par mois" : " par an";
    var val = Number($("hausse").value);
    var aug = C.simulerAugmentation(calc.entree, P, { mode: modeHausse, valeur: val });
    dernierAug = aug;
    var garde = aug.partNetDeLaHausseBrute;
    var html;
    if (!(val > 0)) html = "Choisissez une hausse pour voir son effet réel sur votre net.";
    else if (modeHausse === "net") html = "Pour gagner <b class=\"plus-net\">" + signe(aug.hausseNet) + " DT net</b>" + per + ", demandez <b>" + signe(aug.hausseBrut) + " DT brut</b>. Votre employeur paiera <b>" + signe(aug.hausseCout) + " DT</b> de plus.";
    else html = "Cette hausse vous rapporte <b class=\"plus-net\">" + signe(aug.hausseNet) + " DT net</b>" + per + " : vous gardez <b>" + Math.round(garde * 100) + " %</b> du brut ajouté. Pour votre employeur, elle coûte <b>" + signe(aug.hausseCout) + " DT</b>.";
    $("verdict-hausse").innerHTML = html;
    $("hausse-annee").textContent = val > 0 && mensuel ? "Sur l'année (" + aug.nombreSalaires + " salaires) : " + signe(aug.hausseNetAnnuelle) + " DT net, " + signe(aug.hausseCoutAnnuel) + " DT de coût employeur." : "";
    $("hausse-vers-offre").disabled = !(aug.hausseBrut > 0.0005);
  }

  /* ---------- Employeur ---------- */
  function rendreEmployeur(r, mensuel) {
    var rep = C.repartitionCoutEmployeur(r);
    var div = mensuel ? 12 : 1;
    $("cout-total").textContent = dt3(rep.total / div);
    $("cout-lib").textContent = "DT " + (mensuel ? "par mois" : "par an") + ", charges comprises";
    $("piece-caisse-titre").textContent = "Pour la " + r.regime.caisse;
    ["salarie", "caisse", "etat"].forEach(function (k) {
      $("piece-" + k).textContent = nbsp(f2.format(rep[k].part));
      $("piece-" + k + "-val").textContent = dt3(rep[k].montant / div) + " DT";
    });
  }

  /* ---------- Deux offres ---------- */
  var offreBTouchee = false;
  function etatB(etat) {
    var b = JSON.parse(JSON.stringify(etat));
    b.sens = "brut";
    b.periode = "mensuel";
    b.montant = lireMontant($("b-montant").value).valeur;
    b.secteur = $("b-secteur").value;
    b.nombreSalaires = Number($("b-salaires").value);
    return b;
  }
  function resumeOffre(c) {
    var a = c.r.annuel;
    return {
      net: c.v.netMensuel,
      lignes: [
        ["Brut par mois", dt3(c.v.brutMensuel) + " DT"],
        ["Net sur l'année", dt3(a.netAPayer) + " DT"],
        ["Coût employeur / an", dt3(a.coutEmployeur) + " DT"],
        ["Prélèvements", pct(c.r.indicateurs.tauxPrelevementGlobal)]
      ]
    };
  }
  function remplirOffre(cle, res) {
    $("offre-" + cle + "-net").innerHTML = dt3(res.net) + " <small>DT net / mois</small>";
    $("offre-" + cle + "-dl").innerHTML = res.lignes.map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
  }
  function rendreOffres(calc, etat) {
    var aBrut = JSON.parse(JSON.stringify(etat));
    aBrut.sens = "brut"; aBrut.periode = "mensuel";
    aBrut.montant = calc.r.annuel.salaireBase / calc.v.nombre;
    var cA = calculerEtat(aBrut);
    var bm = lireMontant($("b-montant").value);
    $("b-montant").setAttribute("aria-invalid", bm.valide && !bm.vide ? "false" : "true");
    remplirOffre("a", resumeOffre(cA));
    if (!bm.valide || bm.vide) { $("offre-b-net").textContent = "—"; $("offre-b-dl").textContent = ""; $("ecart").textContent = "Saisissez le salaire brut de l'autre offre."; return; }
    var cB = calculerEtat(etatB(etat));
    remplirOffre("b", resumeOffre(cB));
    var d = cB.v.netMensuel - cA.v.netMensuel;
    var dAn = cB.r.annuel.netAPayer - cA.r.annuel.netAPayer;
    $("ecart").innerHTML = Math.abs(d) < 0.0005 ? "Les deux offres donnent le même net." :
      "L'autre offre vous apporte <b class=\"" + (d > 0 ? "hausse" : "baisse") + "\">" + signe(d) + " DT net par mois</b>, soit " + signe(dAn) + " DT sur l'année.";
  }

  /* ---------- Détail ligne par ligne ---------- */
  function rendreDetail(calc, etat) {
    var r = calc.r, m = calc.m, a = r.annuel, mensuel = r.periode === "mensuel";
    var ma = mensuel ? m.annuel : a;
    var div = mensuel ? 12 : 1;
    $("col-periode").textContent = mensuel ? (calc.v.nombre > 12 ? "Mois habituel" : "Par mois") : "—";
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
    var tb = $("tableau-detail").tBodies[0];
    tb.innerHTML = lignes.map(function (l) {
      return '<tr class="' + l.classe + '"><td>' + l.lib + '</td><td class="v">' + (mensuel ? dt3(l.vm) : "—") + '</td><td class="v">' + dt3(l.va) + "</td></tr>";
    }).join("");
  }

  /* ---------- Courbe net = f(brut) ---------- */
  var courbe = { points: [], index: 0, xmax: 1, ymax: 1 };
  var G = { g: 52, d: 16, h: 14, b: 34, l: 640, H: 320 };
  function el(nom, attrs, parent) { var e = doc.createElementNS(NS, nom); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function pasRond(etendue, nb) { var brut = etendue / nb, p = Math.pow(10, Math.floor(Math.log10(brut))), q = brut / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; }
  function rendreCourbe(calc, etat) {
    var mensuel = calc.r.periode === "mensuel";
    var entree = JSON.parse(JSON.stringify(calc.entree));
    if (mensuel) entree.nombreSalaires = P.versements.minimum;
    var actuel = entree.montant;
    var cible = Math.max(actuel * 2.5, mensuel ? 3000 : 36000);
    var pas = pasRond(cible, 5);
    var xmax = Math.ceil(cible / pas) * pas;
    var pts = C.courbeNetBrut(entree, P, { min: 0, max: xmax, points: 121 });
    courbe.points = pts; courbe.xmax = xmax; courbe.ymax = xmax;
    /* Le point de la situation est calculé exactement, puis inséré dans l'échantillon */
    var exact = C.courbeNetBrut(entree, P, { min: actuel, max: actuel + 1e-6, points: 2 })[0];
    var plus = 0;
    while (plus < pts.length && pts[plus].brut < actuel) plus++;
    pts.splice(plus, 0, exact);
    courbe.index = plus;
    var svg = $("courbe");
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
    el("path", { d: d, "class": "ligne-net" }, svg);
    courbe.repere = el("line", { "class": "repere" }, svg);
    courbe.point = el("circle", { r: 6, "class": "point" }, svg);
    courbe.zone = el("rect", { x: G.g, y: G.h, width: W, height: H, fill: "transparent" }, svg);
    lireCourbe(plus, true);
  }
  function lireCourbe(i, actuel) {
    var p = courbe.points[i];
    if (!p) return;
    courbe.index = i;
    var x = courbe.X(p.brut), y = courbe.Y(p.net);
    courbe.point.setAttribute("cx", x); courbe.point.setAttribute("cy", y);
    courbe.repere.setAttribute("x1", x); courbe.repere.setAttribute("x2", x);
    courbe.repere.setAttribute("y1", y); courbe.repere.setAttribute("y2", courbe.Y(0));
    var per = $("periode").value === "mensuel" ? "par mois" : "par an";
    $("courbe-info").innerHTML = (actuel ? "Votre situation : " : "Pour ") + "<b>" + dt3(p.brut) + " DT</b> de salaire de base " + per + ", <b>" + dt3(p.net) + " DT</b> net. Taux marginal d'impôt : " + pct(p.tauxMarginal) + ".";
  }
  (function brancherCourbe() {
    var svg = $("courbe");
    function depuisPointeur(e) {
      if (!courbe.points.length) return;
      var rect = svg.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width * G.l;
      var v = (x - G.g) / (G.l - G.g - G.d) * courbe.xmax;
      var i = Math.round(Math.max(0, Math.min(1, v / courbe.xmax)) * (courbe.points.length - 1));
      lireCourbe(i, false);
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
      $("billet").setAttribute("data-etat", "invalide");
      return;
    }
    champ.setAttribute("aria-invalid", "false");
    err.hidden = true;
    $("billet").removeAttribute("data-etat");
    rendre(calculerEtat(etat), etat, animer);
    majAdresse();
  }

  var frappe = null;
  function ajusterLargeur() { var c = $("montant"); c.style.width = Math.max(4.2, c.value.length + 1.2) + "ch"; }
  /* Chaque liste de la phrase prend la largeur du choix affiché, pas du plus long */
  var mesure = doc.createElement("span");
  mesure.setAttribute("aria-hidden", "true");
  mesure.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none";
  doc.body.appendChild(mesure);
  function ajusterListes() {
    doc.querySelectorAll(".blanc select").forEach(function (sel) {
      var cs = getComputedStyle(sel);
      mesure.style.font = cs.font;
      mesure.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
      sel.style.width = Math.ceil(mesure.getBoundingClientRect().width + 26) + "px";
    });
  }
  doc.querySelectorAll(".blanc select").forEach(function (sel) { sel.addEventListener("change", ajusterListes); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(ajusterListes);
  $("montant").addEventListener("input", function () { ajusterLargeur(); clearTimeout(frappe); frappe = setTimeout(function () { calculer(false); }, 120); });
  $("montant").addEventListener("blur", function () {
    var lu = lireMontant(this.value);
    if (lu.valide && !lu.vide) { this.value = nbsp(fSaisie.format(lu.valeur)); ajusterLargeur(); }
  });
  ["sens", "periode", "secteur", "chef", "nombre-salaires"].forEach(function (id) { $(id).addEventListener("change", function () { majCompteurs(); calculer(true); }); });
  ["primes", "non-cotisables", "avantages", "indemnites", "taux-at"].forEach(function (id) {
    $(id).addEventListener("input", function () { clearTimeout(frappe); frappe = setTimeout(function () { calculer(false); }, 160); });
  });
  $("industrie").addEventListener("change", function () { calculer(true); });

  /* Changer de sens : on garde le résultat comme nouveau point de départ */
  $("sens").addEventListener("change", function () {
    if (dernier) {
      var c = dernier.calc, mensuel = c.r.periode === "mensuel";
      var v = this.value === "net" ? C.arrondiMillime(mensuel ? c.v.netMensuel : c.r.annuel.netAPayer) : plafondMillime(mensuel ? c.r.annuel.salaireBase / c.v.nombre : c.r.annuel.salaireBase);
      $("montant").value = nbsp(fSaisie.format(v));
      ajusterLargeur();
    }
  }, true);
  /* Changer de période : convertir les montants, et le net à partir du vrai net annuel */
  $("periode").addEventListener("change", function () {
    var vers = this.value;
    /* La hausse proposée suit la période (200 DT par mois, 2 400 DT par an) */
    hausseCible = modeHausse === "pourcent" ? 5 : 200 * (vers === "annuel" ? 12 : 1);
    if (dernier) {
      var c = dernier.calc;
      var montant;
      if (dernier.etat.sens === "net") montant = vers === "annuel" ? c.r.annuel.netAPayer : c.v.netMensuel;
      else montant = plafondMillime(vers === "annuel" ? c.r.annuel.salaireBase : c.r.annuel.salaireBase / c.v.nombre);
      $("montant").value = nbsp(fSaisie.format(C.arrondiMillime(montant)));
      ["primes", "non-cotisables", "avantages", "indemnites"].forEach(function (id) {
        var x = lireMontant($(id).value);
        if (x.valide && !x.vide && x.valeur > 0) $(id).value = nbsp(fSaisie.format(C.arrondiMillime(x.valeur * (vers === "annuel" ? 12 : 1 / 12))));
      });
      ajusterLargeur();
    }
  }, true);

  form.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pas]");
    if (!b || b.disabled) return;
    var k = b.getAttribute("data-cible");
    compteurs[k] = Math.max(0, Math.min(MAX[k], compteurs[k] + Number(b.getAttribute("data-pas"))));
    majCompteurs();
    calculer(true);
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  /* Augmentation */
  doc.querySelectorAll('input[name="mode-hausse"]').forEach(function (r) {
    r.addEventListener("change", function () {
      modeHausse = this.value;
      hausseCible = modeHausse === "pourcent" ? 5 : 200 * ($("periode").value === "annuel" ? 12 : 1);
      if (dernier) rendreHausse(dernier.calc, dernier.etat);
    });
  });
  $("hausse").addEventListener("input", function () { if (dernier) rendreHausse(dernier.calc, dernier.etat); });
  $("hausse-vers-offre").addEventListener("click", function () {
    if (!dernierAug || !dernier) return;
    var c = dernier.calc;
    var mensuel = c.r.periode === "mensuel";
    var brutApres = dernierAug.salaireBaseApres / (mensuel ? 1 : 12);
    $("b-montant").value = nbsp(fSaisie.format(C.arrondiMillime(brutApres)));
    $("b-secteur").value = dernier.etat.secteur;
    $("b-salaires").value = String(c.v.nombre);
    offreBTouchee = true;
    rendreOffres(c, dernier.etat);
    majAdresse();
    $("section-offres").scrollIntoView({ behavior: mouvementReduit.matches ? "auto" : "smooth", block: "start" });
    toast("L'offre augmentée est prête à comparer.");
  });

  /* Offre B */
  ["b-montant"].forEach(function (id) { $(id).addEventListener("input", function () { offreBTouchee = true; if (dernier) { rendreOffres(dernier.calc, dernier.etat); majAdresse(); } }); });
  ["b-secteur", "b-salaires"].forEach(function (id) { $(id).addEventListener("change", function () { offreBTouchee = true; if (dernier) { rendreOffres(dernier.calc, dernier.etat); majAdresse(); } }); });

  /* ---------- Thème ---------- */
  function themeActuel() { return racine.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function majTheme() {
    var sombre = themeActuel() === "dark";
    var b = $("bascule-theme");
    b.querySelector("use").setAttribute("href", sombre ? "#i-soleil" : "#i-lune");
    b.setAttribute("aria-label", sombre ? "Passer au thème clair" : "Passer au thème sombre");
    doc.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute("content", sombre ? "#0B1411" : "#EAEFE8"); });
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
    b.classList.add("bascule");
    setTimeout(function () { l.textContent = texte; b.classList.remove("bascule"); }, 160);
    setTimeout(function () { b.classList.add("bascule"); setTimeout(function () { l.textContent = "Partager ce calcul"; b.classList.remove("bascule"); }, 160); }, 2400);
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
    var vues = {};
    var items = [];
    (function parcourir(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(parcourir); return; }
      if (o.source && (o.libelle || o.taux != null) && !vues[o.source]) {
        vues[o.source] = 1;
        items.push([o.libelle || "", o.source]);
      }
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

  /* ---------- Billet miniature (téléphone) ---------- */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entrees) {
      /* Le net reste visible : billet miniature dès que le vrai billet est hors de l'écran (au-dessus ou en dessous) */
      var visible = !entrees[0].isIntersecting;
      $("mini").classList.toggle("visible", visible);
      $("mini").setAttribute("aria-hidden", visible ? "false" : "true");
      $("mini").tabIndex = visible ? 0 : -1;
    }, { threshold: 0 }).observe($("billet"));
  }
  $("mini").addEventListener("click", function (e) {
    e.preventDefault();
    $("billet").scrollIntoView({ behavior: mouvementReduit.matches ? "auto" : "smooth", block: "center" });
    $("billet").focus({ preventScroll: true });
  });
  $("billet").addEventListener("animationend", function (e) { if (e.target === this) this.classList.remove("imprime"); });

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
      calculer(true);
      return true;
    }
  };

  function appliquerOffreB(b) {
    $("b-montant").value = nbsp(fSaisie.format(b.montant));
    $("b-secteur").value = b.secteur;
    $("b-salaires").value = String(b.nombreSalaires || P.versements.parDefaut);
    offreBTouchee = true;
  }

  /* ---------- Démarrage ---------- */
  var recu = E.decoder(location.search);
  if (recu.a) {
    appliquerEtat(recu.a);
    if (recu.b) appliquerOffreB(recu.b);
  } else majCompteurs();
  ajusterLargeur();
  ajusterListes();
  calculer(false);
})();
