/*
 * Interface du calculateur : lecture du formulaire, rendu des résultats.
 * La logique de calcul est dans js/calcul.js, les paramètres légaux dans
 * config/parametres.js.
 */
(function () {
  "use strict";

  var P = window.PARAMETRES_PAIE;
  var C = window.CalculSalaire;
  var doc = document;
  var racine = doc.documentElement;

  var mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- Formatage ---------- */

  var fmtMontant = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  var fmtPourcent = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 });
  var fmtTaux = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
  var fmtEntier = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  var fmtSaisie = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

  function montant(v) { return fmtMontant.format(C.arrondiMillime(v)); }
  function dt(v) { return fmtEntier.format(v) + " DT"; }

  /* Lecture tolérante : « 2 500,5 », « 2500.5 », « 2 500 » */
  function lireMontant(texte) {
    var brut = String(texte || "").trim();
    if (brut === "") return { valeur: 0, vide: true, valide: true };
    var nettoye = brut.replace(/[\s  ]/g, "").replace(/DT$/i, "");
    if (nettoye.indexOf(",") !== -1) nettoye = nettoye.replace(/\./g, "").replace(",", ".");
    if (!/^\d*\.?\d*$/.test(nettoye) || nettoye === ".") return { valeur: 0, vide: false, valide: false };
    return { valeur: Number(nettoye), vide: false, valide: true };
  }

  function el(id) { return doc.getElementById(id); }

  /* ---------- Paramètres affichés dans l'interface (depuis la config) ---------- */

  function remplirTextesParametres() {
    var d = P.irpp.deductions;
    var textes = {
      chef: dt(d.chefDeFamille.montant),
      ageEnfant: String(d.enfant.ageMaximum),
      ageEtudiant: String(d.enfantEtudiant.ageMaximum),
      atMin: fmtSaisie.format(P.employeur.accidentTravail.tauxMin * 100),
      atMax: fmtSaisie.format(P.employeur.accidentTravail.tauxMax * 100),
      tfp: fmtTaux.format(P.employeur.tfp.taux),
      tfpReduite: fmtTaux.format(P.employeur.tfp.tauxIndustrieManufacturiere)
    };
    doc.querySelectorAll("[data-param]").forEach(function (n) {
      var cle = n.getAttribute("data-param");
      if (textes[cle] !== undefined) n.textContent = textes[cle];
    });
    doc.querySelectorAll("[data-annee]").forEach(function (n) { n.textContent = P.annee; });

    var date = new Date(P.dateVerification + "T12:00:00");
    el("date-verification").textContent = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

    var tauxCnss = P.cnss.salarie.map(function (c) { return fmtTaux.format(c.taux); }).join(" + ");
    el("resume-regles").textContent =
      "barème IRPP à " + P.irpp.bareme.length + " tranches (0 à " + fmtTaux.format(P.irpp.bareme[P.irpp.bareme.length - 1].taux) +
      "), CNSS salariale " + tauxCnss + ", frais professionnels " + fmtTaux.format(P.irpp.fraisProfessionnels.taux) +
      " plafonnés à " + dt(P.irpp.fraisProfessionnels.plafondAnnuel) + " par an, CSS " + fmtTaux.format(P.css.taux);

    var parents = el("parents");
    parents.max = String(d.parentACharge.nombreMax);
    el("taux-at").value = fmtSaisie.format(P.employeur.accidentTravail.tauxParDefaut * 100);
  }

  /* ---------- Lecture du formulaire ---------- */

  var form = el("formulaire");

  function valeurRadio(nom) {
    var coche = form.querySelector('input[name="' + nom + '"]:checked');
    return coche ? coche.value : null;
  }

  function lireEntier(id) {
    var champ = el(id);
    var v = Math.floor(Number(champ.value));
    var max = Number(champ.max);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (Number.isFinite(max) && max > 0 && v > max) v = max;
    return v;
  }

  function lireFormulaire() {
    var m = lireMontant(el("montant").value);
    var at = lireMontant(el("taux-at").value);
    return {
      sens: valeurRadio("sens"),
      validite: m,
      entree: {
        montant: m.valeur,
        periode: valeurRadio("periode"),
        chefDeFamille: el("chef").checked,
        enfants: lireEntier("enfants"),
        etudiants: lireEntier("etudiants"),
        handicapes: lireEntier("handicapes"),
        parents: lireEntier("parents"),
        primesImposables: lireMontant(el("primes").value).valeur,
        avantagesNature: lireMontant(el("avantages").value).valeur,
        indemnitesNonImposables: lireMontant(el("indemnites").value).valeur,
        tauxAccidentTravail: at.vide || !at.valide ? undefined : at.valeur / 100,
        industrieManufacturiere: el("industrie").checked
      }
    };
  }

  /* ---------- Compteurs animés ---------- */

  var animations = new WeakMap();

  var valeursAffichees = new WeakMap();

  function animerNombre(noeud, cible) {
    /* Repart de la valeur réellement affichée : l'animation reste fluide si on la relance en cours de route */
    var depart = valeursAffichees.has(noeud) ? valeursAffichees.get(noeud) : 0;
    noeud.setAttribute("data-valeur", String(cible));
    var precedente = animations.get(noeud);
    if (precedente) cancelAnimationFrame(precedente);

    if (mouvementReduit.matches || doc.hidden || Math.abs(cible - depart) < 0.0005) {
      valeursAffichees.set(noeud, cible);
      noeud.textContent = montant(cible);
      return;
    }
    var duree = 420;
    var t0 = performance.now();
    function pas(t) {
      var x = Math.min(1, (t - t0) / duree);
      var e = 1 - Math.pow(1 - x, 4); /* ease-out quartique */
      var courant = depart + (cible - depart) * e;
      valeursAffichees.set(noeud, courant);
      noeud.textContent = montant(courant);
      if (x < 1) animations.set(noeud, requestAnimationFrame(pas));
      else animations.delete(noeud);
    }
    animations.set(noeud, requestAnimationFrame(pas));
  }

  /* ---------- Rendu ---------- */

  function ligne(corps, options) {
    var tr = doc.createElement("tr");
    if (options.classe) tr.className = options.classe;
    var th = doc.createElement("th");
    th.scope = "row";
    if (options.signe) {
      var s = doc.createElement("span");
      s.className = "signe";
      s.setAttribute("aria-hidden", "true");
      s.textContent = options.signe;
      th.appendChild(s);
    }
    th.appendChild(doc.createTextNode(options.libelle));
    if (options.etiquette) {
      var et = doc.createElement("span");
      et.className = "etiquette";
      et.textContent = options.etiquette;
      th.appendChild(et);
    }
    tr.appendChild(th);
    (options.valeurs || []).forEach(function (v) {
      var td = doc.createElement("td");
      td.className = "num";
      td.textContent = typeof v === "number" ? montant(v) : v;
      tr.appendChild(td);
    });
    corps.appendChild(tr);
  }

  function rendreEtapes(r) {
    var a = r.annuel;
    var mois = P.moisParAn;
    var corps = el("etapes-corps");
    corps.textContent = "";
    function v(x) { return [x / mois, x]; }
    var ind = r.indicateurs;
    var fp = P.irpp.fraisProfessionnels;

    ligne(corps, { libelle: "Salaire de base brut", valeurs: v(a.salaireBase) });
    if (a.primesImposables > 0) ligne(corps, { signe: "+", libelle: "Primes et indemnités imposables", valeurs: v(a.primesImposables) });
    if (a.avantagesNature > 0) ligne(corps, { signe: "+", libelle: "Avantages en nature", valeurs: v(a.avantagesNature) });
    ligne(corps, { classe: "total", signe: "=", libelle: "Salaire brut", valeurs: v(a.brutTotal) });

    ligne(corps, { classe: "retenue", signe: "−", libelle: "Cotisations CNSS (" + fmtPourcent.format(ind.tauxCnss) + ")", valeurs: v(a.cnss) });
    a.cnssLignes.forEach(function (c) {
      ligne(corps, { classe: "sous-ligne", libelle: c.libelle + " · " + fmtPourcent.format(c.taux), valeurs: v(c.montant) });
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Revenu après cotisations", valeurs: v(a.revenuApresCnss) });

    ligne(corps, {
      signe: "−",
      libelle: "Frais professionnels (" + fmtTaux.format(fp.taux) + ")",
      etiquette: ind.fraisPlafonnes ? "plafond " + dt(fp.plafondAnnuel) + "/an atteint" : null,
      valeurs: v(a.fraisProfessionnels)
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Revenu net", valeurs: v(a.revenuNet) });

    if (a.deductionsLignes.length === 0) {
      ligne(corps, { signe: "−", libelle: "Déductions familiales (aucune)", valeurs: v(0) });
    }
    a.deductionsLignes.forEach(function (d) {
      var lib = d.libelle + (d.code === "chef" ? "" : " × " + d.nombre);
      ligne(corps, { signe: "−", libelle: lib, valeurs: v(d.montant) });
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Revenu net imposable", valeurs: v(a.revenuImposable) });

    ligne(corps, { classe: "retenue", signe: "−", libelle: "IRPP (barème progressif)", valeurs: v(a.irpp) });
    ligne(corps, {
      classe: "retenue",
      signe: "−",
      libelle: "Contribution sociale de solidarité (" + fmtPourcent.format(P.css.taux) + ")",
      etiquette: ind.cssDispense ? "dispense ≤ " + dt(P.css.seuilDispense) : null,
      valeurs: v(a.css)
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Salaire net", valeurs: v(a.salaireNet) });

    if (a.avantagesNature > 0) ligne(corps, { signe: "−", libelle: "Avantages en nature (non versés)", valeurs: v(a.avantagesNature) });
    if (a.indemnitesNonImposables > 0) ligne(corps, { signe: "+", libelle: "Indemnités non imposables", valeurs: v(a.indemnitesNonImposables) });
    ligne(corps, { classe: "total final", signe: "=", libelle: "Net à payer", valeurs: v(a.netAPayer) });

    /* Détail par tranche */
    var tc = el("tranches-corps");
    tc.textContent = "";
    a.irppTranches.forEach(function (t) {
      var bornes = t.a === Infinity ? "au-delà de " + dt(t.de) : dt(t.de) + " à " + dt(t.a);
      ligne(tc, { libelle: bornes, valeurs: [fmtTaux.format(t.taux), montant(t.base), montant(t.impot)] });
    });
    ligne(tc, { classe: "total", libelle: "Total IRPP annuel", valeurs: ["", montant(a.revenuImposable), montant(a.irpp)] });
  }

  function rendreEmployeur(r) {
    var a = r.annuel;
    var mois = P.moisParAn;
    var corps = el("employeur-corps");
    corps.textContent = "";
    function v(x) { return [x / mois, x]; }
    ligne(corps, { libelle: "Salaire brut", valeurs: v(a.brutTotal) });
    a.chargesPatronalesLignes.forEach(function (c) {
      ligne(corps, { signe: "+", libelle: c.libelle + " · " + fmtPourcent.format(c.taux), valeurs: v(c.montant) });
    });
    if (a.indemnitesNonImposables > 0) ligne(corps, { signe: "+", libelle: "Indemnités non imposables", valeurs: v(a.indemnitesNonImposables) });
    ligne(corps, { classe: "total final", signe: "=", libelle: "Coût total employeur", valeurs: v(a.coutEmployeur) });
  }

  var SEGMENTS = [
    { cle: "net", nom: "Salaire net", champ: "salaireNet", couleur: "--c-net" },
    { cle: "cnss", nom: "CNSS", champ: "cnss", couleur: "--c-cnss" },
    { cle: "irpp", nom: "IRPP", champ: "irpp", couleur: "--c-irpp" },
    { cle: "css", nom: "CSS", champ: "css", couleur: "--c-css" }
  ];

  function rendreRepartition(r) {
    var a = r.annuel;
    var total = a.brutTotal;
    var debut = 0;
    var legende = el("legende");
    legende.textContent = "";
    var description = [];

    SEGMENTS.forEach(function (s) {
      var valeur = a[s.champ];
      var part = total > 0 ? valeur / total : 0;
      var seg = doc.querySelector('.barre__segment[data-segment="' + s.cle + '"]');
      seg.style.setProperty("--debut", String(debut));
      seg.style.setProperty("--part", String(part));
      debut += part;

      var li = doc.createElement("li");
      var pastille = doc.createElement("span");
      pastille.className = "legende__pastille";
      pastille.style.background = "var(" + s.couleur + ")";
      pastille.setAttribute("aria-hidden", "true");
      var nom = doc.createElement("span");
      nom.className = "legende__nom";
      nom.textContent = s.nom;
      var val = doc.createElement("span");
      val.className = "legende__valeur chiffre";
      val.textContent = montant(valeur / P.moisParAn);
      var pct = doc.createElement("span");
      pct.className = "legende__part";
      pct.textContent = fmtPourcent.format(part);
      val.appendChild(pct);
      li.append(pastille, nom, val);
      legende.appendChild(li);

      description.push(s.nom + " " + fmtPourcent.format(part));
    });

    el("barre-description").textContent =
      "Répartition du salaire brut mensuel de " + montant(total / P.moisParAn) + " DT : " + description.join(", ") + ".";
  }

  function rendreAlertes(r, inverse) {
    var liste = el("alertes");
    liste.textContent = "";
    var messages = [];
    var ind = r.indicateurs;
    if (ind.enfantsIgnores > 0) {
      messages.push(r.entree.chefDeFamille
        ? ind.enfantsIgnores + " enfant(s) non pris en compte : la déduction est limitée aux " + P.irpp.deductions.nombreMaxEnfants + " premiers enfants (hors enfants handicapés)."
        : "Les enfants saisis ne sont pas déduits : cochez «\u00a0Chef de famille\u00a0» si vous l’êtes.");
    }
    if (inverse && inverse.message) messages.push(inverse.message);
    var smig = P.reperes.smigMensuel40h;
    var brutMensuel = r.annuel.brutTotal / P.moisParAn;
    if (brutMensuel > 0 && brutMensuel < smig) {
      messages.push("Ce brut est inférieur au SMIG mensuel (" + montant(smig) + " DT en régime 40 h, " + montant(P.reperes.smigMensuel48h) + " DT en 48 h), sauf temps partiel.");
    }
    messages.forEach(function (m) {
      var li = doc.createElement("li");
      li.innerHTML = '<svg class="icone" aria-hidden="true"><use href="#i-alerte"/></svg>';
      var span = doc.createElement("span");
      span.textContent = m;
      li.appendChild(span);
      liste.appendChild(li);
    });
  }

  /* ---------- Calcul et affichage ---------- */

  var annonceTimer = null;

  function mettreAJourLibelles(sens, periode) {
    var mensuel = periode === "mensuel";
    el("libelle-montant").textContent = (sens === "brut" ? "Salaire brut " : "Salaire net souhaité ") + (mensuel ? "mensuel" : "annuel");
    el("aide-montant").textContent = sens === "brut"
      ? "Salaire de base, hors primes. Décimales avec une virgule."
      : "Net à payer visé. Les primes et la situation familiale saisies sont prises en compte.";
    doc.querySelectorAll("[data-periode-texte]").forEach(function (n) { n.textContent = mensuel ? "par mois" : "par an"; });
  }

  function calculer() {
    var lu = lireFormulaire();
    var sens = lu.sens;
    mettreAJourLibelles(sens, lu.entree.periode);

    el("compteurs-enfants").toggleAttribute("data-inactif", !lu.entree.chefDeFamille);

    var boite = el("montant").closest(".saisie-montant");
    var erreur = el("erreur-montant");
    if (!lu.validite.valide) {
      boite.setAttribute("data-invalide", "");
      el("montant").setAttribute("aria-invalid", "true");
      erreur.textContent = "Montant non reconnu. Saisissez un nombre positif, par exemple 2 500 ou 2 500,750.";
      erreur.hidden = false;
      return;
    }
    boite.removeAttribute("data-invalide");
    el("montant").removeAttribute("aria-invalid");
    erreur.hidden = true;

    var resultat;
    var inverse = null;
    if (sens === "net") {
      inverse = C.calculerDepuisNet(lu.entree, P);
      resultat = inverse.resultat;
    } else {
      resultat = C.calculerDepuisBrut(lu.entree, P);
    }
    afficher(resultat, sens, inverse);
  }

  function afficher(r, sens, inverse) {
    var a = r.annuel;
    var mois = P.moisParAn;
    var mensuel = r.periode === "mensuel";

    var principal = sens === "brut" ? a.netAPayer : a.salaireBase;
    el("libelle-principal").textContent = sens === "brut"
      ? "Net à payer " + (mensuel ? "par mois" : "par an")
      : "Salaire de base brut nécessaire " + (mensuel ? "par mois" : "par an");
    animerNombre(el("montant-principal"), mensuel ? principal / mois : principal);
    el("texte-secondaire").textContent = "soit";
    animerNombre(el("montant-secondaire"), mensuel ? principal : principal / mois);
    el("montant-secondaire").nextSibling.textContent = mensuel ? " DT par an" : " DT par mois";

    el("libelle-repere-1").textContent = sens === "brut" ? "Brut total mensuel" : "Net à payer mensuel";
    el("repere-1").textContent = montant((sens === "brut" ? a.brutTotal : a.netAPayer) / mois) + " DT";
    el("repere-taux").textContent = fmtPourcent.format(r.indicateurs.tauxPrelevementGlobal);
    el("repere-marginal").textContent = fmtTaux.format(r.indicateurs.tauxMarginalIrpp);

    var verif = el("verification");
    if (inverse) {
      verif.hidden = false;
      var ok = inverse.verifie;
      verif.setAttribute("data-etat", ok ? "ok" : "echec");
      verif.querySelector("use").setAttribute("href", ok ? "#i-check" : "#i-alerte");
      el("verification-texte").textContent = ok
        ? "Vérifié : avec ce brut, le net recalculé est de " + montant(inverse.netRecalcule) + " DT, égal au net saisi (écart " + montant(Math.abs(inverse.ecart)) + " DT)."
        : "Le net saisi ne peut pas être atteint exactement : net recalculé " + montant(inverse.netRecalcule) + " DT.";
    } else {
      verif.hidden = true;
    }

    el("barre-mobile-libelle").textContent = el("libelle-principal").textContent;
    el("barre-mobile-montant").textContent = montant(mensuel ? principal / mois : principal) + "\u00a0DT";

    rendreAlertes(r, inverse);
    rendreRepartition(r);
    rendreEtapes(r);
    rendreEmployeur(r);

    /* Annonce pour lecteurs d'écran, après une pause de saisie */
    clearTimeout(annonceTimer);
    annonceTimer = setTimeout(function () {
      el("annonce").textContent = sens === "brut"
        ? "Net à payer : " + montant(a.netAPayer / mois) + " dinars par mois, " + montant(a.netAPayer) + " par an."
        : "Salaire de base brut nécessaire : " + montant(a.salaireBase / mois) + " dinars par mois." + (inverse && inverse.verifie ? " Vérification réussie." : "");
    }, 900);
  }

  /* ---------- Événements ---------- */

  var calculTimer = null;
  function planifierCalcul() {
    clearTimeout(calculTimer);
    calculTimer = setTimeout(calculer, 90);
  }

  form.addEventListener("input", planifierCalcul);
  form.addEventListener("change", planifierCalcul);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    calculer();
    el("resultats").focus({ preventScroll: false });
  });

  /* Mise en forme du montant à la sortie du champ : « 2500 » → « 2 500 » */
  ["montant", "primes", "avantages", "indemnites"].forEach(function (id) {
    el(id).addEventListener("blur", function () {
      var m = lireMontant(this.value);
      if (m.valide && !m.vide) this.value = fmtSaisie.format(m.valeur);
    });
  });

  /* Conversion du montant quand on change de période */
  form.querySelectorAll('input[name="periode"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      var vers = this.value;
      var facteur = vers === "annuel" ? P.moisParAn : 1 / P.moisParAn;
      ["montant", "primes", "avantages", "indemnites"].forEach(function (id) {
        var champ = el(id);
        var m = lireMontant(champ.value);
        if (m.valide && !m.vide && m.valeur > 0) champ.value = fmtSaisie.format(C.arrondiMillime(m.valeur * facteur));
      });
    });
  });

  /* En changeant de sens, on reprend le résultat courant comme point de départ */
  form.querySelectorAll('input[name="sens"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      var principal = Number(el("montant-principal").getAttribute("data-valeur")) || 0;
      if (principal > 0) el("montant").value = fmtSaisie.format(C.arrondiMillime(principal));
    });
  });

  /* Boutons − / + des compteurs */
  form.addEventListener("click", function (e) {
    var bouton = e.target.closest(".bouton-pas");
    if (!bouton) return;
    var champ = el(bouton.getAttribute("data-cible"));
    var pas = Number(bouton.getAttribute("data-pas"));
    var max = Number(champ.max);
    var v = Math.max(0, Math.min(max, (Number(champ.value) || 0) + pas));
    champ.value = String(v);
    majBoutonsPas();
    planifierCalcul();
  });

  function majBoutonsPas() {
    form.querySelectorAll(".bouton-pas").forEach(function (b) {
      var champ = el(b.getAttribute("data-cible"));
      var v = Number(champ.value) || 0;
      b.disabled = Number(b.getAttribute("data-pas")) < 0 ? v <= Number(champ.min) : v >= Number(champ.max);
    });
  }
  form.addEventListener("input", function (e) {
    if (e.target.type === "number") majBoutonsPas();
  });

  form.addEventListener("reset", function () {
    setTimeout(function () {
      remplirTextesParametres();
      majBoutonsPas();
      calculer();
    }, 0);
  });

  /* Thème clair / sombre */
  var boutonTheme = el("bouton-theme");
  function appliquerTheme(theme) {
    racine.setAttribute("data-theme", theme);
    var clair = theme === "light";
    boutonTheme.setAttribute("aria-label", clair ? "Passer au thème sombre" : "Passer au thème clair");
    boutonTheme.querySelector("use").setAttribute("href", clair ? "#i-lune" : "#i-soleil");
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", clair ? "#eef2f8" : "#070b14");
  }
  boutonTheme.addEventListener("click", function () {
    var suivant = racine.getAttribute("data-theme") === "light" ? "dark" : "light";
    appliquerTheme(suivant);
    try { localStorage.setItem("calc-theme", suivant); } catch (e) { /* stockage indisponible */ }
  });

  /* Barre de synthèse mobile : visible seulement quand le résultat principal est hors écran */
  var barreMobile = el("barre-mobile");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entrees) {
      var visible = entrees[0].isIntersecting;
      barreMobile.toggleAttribute("data-cache", visible);
      barreMobile.setAttribute("aria-hidden", visible ? "true" : "false");
      if (visible) barreMobile.setAttribute("tabindex", "-1");
      else barreMobile.removeAttribute("tabindex");
    }).observe(doc.querySelector(".synthese__montant"));
  }

  /* ---------- Démarrage ---------- */
  appliquerTheme(racine.getAttribute("data-theme") === "light" ? "light" : "dark");
  remplirTextesParametres();
  majBoutonsPas();
  racine.classList.add("js-attente");
  calculer();
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { racine.classList.remove("js-attente"); });
  });
})();
