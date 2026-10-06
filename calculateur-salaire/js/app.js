/*
 * Interface du calculateur : lecture du formulaire, rendu des résultats.
 * La logique de calcul est dans js/calcul.js, les paramètres légaux dans
 * config/parametres.js.
 */
(function () {
  "use strict";

  var P = window.PARAMETRES_PAIE;
  var C = window.CalculSalaire;
  var E = window.EtatSimulation;
  var G = window.Graphiques;
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

  function tauxRegime(regime) {
    return regime.salarie.reduce(function (t, c) { return t + c.taux; }, 0);
  }

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

    var prive = P.regimes.prive;
    var pub = P.regimes.public;
    el("resume-regles").textContent =
      "barème IRPP à " + P.irpp.bareme.length + " tranches (0 à " + fmtTaux.format(P.irpp.bareme[P.irpp.bareme.length - 1].taux) +
      "), cotisations salariales " + prive.caisse + " " + fmtPourcent.format(tauxRegime(prive)) +
      " (privé) ou " + pub.caisse + " " + fmtPourcent.format(tauxRegime(pub)) + " (public), frais professionnels " + fmtTaux.format(P.irpp.fraisProfessionnels.taux) +
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

  /* Formulaire → état (voir js/etat.js) */
  function lireEtat() {
    var at = lireMontant(el("taux-at").value);
    return {
      sens: valeurRadio("sens"),
      secteur: valeurRadio("secteur"),
      periode: valeurRadio("periode"),
      montant: lireMontant(el("montant").value).valeur,
      chefDeFamille: el("chef").checked,
      enfants: lireEntier("enfants"),
      etudiants: lireEntier("etudiants"),
      handicapes: lireEntier("handicapes"),
      parents: lireEntier("parents"),
      primesImposables: lireMontant(el("primes").value).valeur,
      primesNonCotisables: lireMontant(el("non-cotisables").value).valeur,
      avantagesNature: lireMontant(el("avantages").value).valeur,
      indemnitesNonImposables: lireMontant(el("indemnites").value).valeur,
      /* null = taux par défaut de la configuration (non écrit dans le lien) */
      tauxAccidentTravailPct: at.vide || !at.valide || Math.abs(at.valeur - P.employeur.accidentTravail.tauxParDefaut * 100) < 1e-9 ? null : at.valeur,
      industrieManufacturiere: el("industrie").checked
    };
  }

  /* État → formulaire */
  function appliquerEtat(etat) {
    function radio(nom, valeur) {
      var r = form.querySelector('input[name="' + nom + '"][value="' + valeur + '"]');
      if (r) r.checked = true;
    }
    function texte(id, v) { el(id).value = v ? fmtSaisie.format(v) : ""; }
    radio("sens", etat.sens);
    radio("secteur", etat.secteur);
    radio("periode", etat.periode);
    el("montant").value = fmtSaisie.format(etat.montant);
    el("chef").checked = etat.chefDeFamille;
    ["enfants", "etudiants", "handicapes", "parents"].forEach(function (id) { el(id).value = String(etat[id]); });
    texte("primes", etat.primesImposables);
    texte("non-cotisables", etat.primesNonCotisables);
    texte("avantages", etat.avantagesNature);
    texte("indemnites", etat.indemnitesNonImposables);
    el("taux-at").value = fmtSaisie.format(etat.tauxAccidentTravailPct === null
      ? P.employeur.accidentTravail.tauxParDefaut * 100 : etat.tauxAccidentTravailPct);
    el("industrie").checked = etat.industrieManufacturiere;
    majBoutonsPas();
  }

  function cloner(etat) { return JSON.parse(JSON.stringify(etat)); }

  /* Calcule un état : brut → net, ou net → brut avec vérification */
  function calculerEtat(etat) {
    var entree = E.versEntree(etat);
    if (etat.sens === "net") {
      var inverse = C.calculerDepuisNet(entree, P);
      return { r: inverse.resultat, inverse: inverse };
    }
    return { r: C.calculerDepuisBrut(entree, P), inverse: null };
  }

  /* Entrée « brut → net » équivalente au résultat (utile après un calcul inverse) */
  function entreeBrut(etat, r) {
    var entree = E.versEntree(etat);
    entree.montant = r.annuel.salaireBase / r.entree.facteur;
    return entree;
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

  /* Mémorise les valeurs affichées d'un tableau avant de le reconstruire */
  function instantane(corps) {
    var vues = {};
    corps.querySelectorAll("tr[data-cle]").forEach(function (tr) {
      vues[tr.getAttribute("data-cle")] = Array.prototype.map.call(tr.querySelectorAll("td"), function (td) { return td.textContent; }).join("|");
    });
    return vues;
  }

  /* Après reconstruction : les lignes dont la valeur a changé s'éclairent brièvement */
  function signalerChangements(corps, avant) {
    if (!avant || !Object.keys(avant).length) return;
    corps.querySelectorAll("tr[data-cle]").forEach(function (tr) {
      var cle = tr.getAttribute("data-cle");
      var apres = Array.prototype.map.call(tr.querySelectorAll("td"), function (td) { return td.textContent; }).join("|");
      if (avant[cle] !== undefined && avant[cle] !== apres) tr.classList.add("ligne-maj");
    });
  }

  function ligne(corps, options) {
    var tr = doc.createElement("tr");
    if (options.classe) tr.className = options.classe;
    tr.setAttribute("data-cle", options.cle || options.libelle);
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
    var avant = instantane(corps);
    corps.textContent = "";
    function v(x) { return [x / mois, x]; }
    var ind = r.indicateurs;
    var fp = P.irpp.fraisProfessionnels;

    ligne(corps, { libelle: "Salaire de base brut", valeurs: v(a.salaireBase) });
    if (a.primesImposables > 0) ligne(corps, { signe: "+", libelle: "Primes et indemnités imposables", valeurs: v(a.primesImposables) });
    if (a.primesNonCotisables > 0) ligne(corps, { signe: "+", libelle: "Primes non soumises à cotisation", valeurs: v(a.primesNonCotisables) });
    if (a.avantagesNature > 0) ligne(corps, { signe: "+", libelle: "Avantages en nature", valeurs: v(a.avantagesNature) });
    ligne(corps, { classe: "total", signe: "=", libelle: "Salaire brut", valeurs: v(a.brutTotal) });

    var caisse = r.regime.caisse;
    var libCotis = "Cotisations " + caisse + " (" + fmtPourcent.format(ind.tauxCotisations) +
      (a.primesNonCotisables > 0 ? " de " + montant(a.assietteCotisations / mois) + " DT/mois" : "") + ")";
    ligne(corps, { classe: "retenue", signe: "−", cle: "cotisations", libelle: libCotis, valeurs: v(a.cotisations) });
    a.cotisationsLignes.forEach(function (c) {
      ligne(corps, { classe: "sous-ligne", cle: "cotis-" + c.code, libelle: c.libelle + " · " + fmtPourcent.format(c.taux), valeurs: v(c.montant) });
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Revenu après cotisations", valeurs: v(a.revenuApresCotisations) });

    ligne(corps, {
      signe: "−",
      cle: "frais",
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
      ligne(corps, { signe: "−", cle: "ded-" + d.code, libelle: lib, valeurs: v(d.montant) });
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Revenu net imposable", valeurs: v(a.revenuImposable) });

    ligne(corps, { classe: "retenue", signe: "−", libelle: "IRPP (barème progressif)", valeurs: v(a.irpp) });
    ligne(corps, {
      classe: "retenue",
      signe: "−",
      cle: "css",
      libelle: "Contribution sociale de solidarité (" + fmtPourcent.format(P.css.taux) + ")",
      etiquette: ind.cssDispense ? "dispense ≤ " + dt(P.css.seuilDispense) : null,
      valeurs: v(a.css)
    });
    ligne(corps, { classe: "total", signe: "=", libelle: "Salaire net", valeurs: v(a.salaireNet) });

    if (a.avantagesNature > 0) ligne(corps, { signe: "−", libelle: "Avantages en nature (non versés)", valeurs: v(a.avantagesNature) });
    if (a.indemnitesNonImposables > 0) ligne(corps, { signe: "+", libelle: "Indemnités non imposables", valeurs: v(a.indemnitesNonImposables) });
    ligne(corps, { classe: "total final", signe: "=", libelle: "Net à payer", valeurs: v(a.netAPayer) });
    signalerChangements(corps, avant);

    /* Détail par tranche */
    var tc = el("tranches-corps");
    var avantTranches = instantane(tc);
    tc.textContent = "";
    a.irppTranches.forEach(function (t) {
      var bornes = t.a === Infinity ? "au-delà de " + dt(t.de) : dt(t.de) + " à " + dt(t.a);
      ligne(tc, { libelle: bornes, valeurs: [fmtTaux.format(t.taux), montant(t.base), montant(t.impot)] });
    });
    ligne(tc, { classe: "total", libelle: "Total IRPP annuel", valeurs: ["", montant(a.revenuImposable), montant(a.irpp)] });
    signalerChangements(tc, avantTranches);
  }

  function rendreEmployeur(r) {
    var a = r.annuel;
    var mois = P.moisParAn;
    var corps = el("employeur-corps");
    var avant = instantane(corps);
    corps.textContent = "";
    function v(x) { return [x / mois, x]; }
    ligne(corps, { libelle: "Salaire brut", valeurs: v(a.brutTotal) });
    a.chargesPatronalesLignes.forEach(function (c) {
      ligne(corps, { signe: "+", cle: "emp-" + c.code, libelle: c.libelle + " · " + fmtPourcent.format(c.taux), valeurs: v(c.montant) });
    });
    if (a.indemnitesNonImposables > 0) ligne(corps, { signe: "+", libelle: "Indemnités non imposables", valeurs: v(a.indemnitesNonImposables) });
    ligne(corps, { classe: "total final", signe: "=", libelle: "Coût total employeur", valeurs: v(a.coutEmployeur) });
    signalerChangements(corps, avant);
    rendreDinar(r);
  }

  /* ---------- Où va 1 dinar de coût employeur ---------- */
  var fmtDinar = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  function rendreDinar(r) {
    var d = C.repartitionCoutEmployeur(r);
    var caisse = r.regime.caisse;
    var parts = [
      { cle: "salarie", nom: "Pour le salarié", detail: "salaire net et indemnités", couleur: "--c-net", v: d.salarie },
      { cle: "caisse", nom: "Pour la caisse sociale", detail: caisse + ", parts salariale et patronale", couleur: "--c-cnss", v: d.caisse },
      { cle: "etat", nom: "Pour l’État", detail: "IRPP, CSS et taxes", couleur: "--c-irpp", v: d.etat }
    ];
    var valeurs = {};
    parts.forEach(function (p) { valeurs[p.cle] = p.v.part; });
    G.majBarre(el("barre-dinar"), valeurs);

    var legende = el("legende-dinar");
    legende.textContent = "";
    var description = [];
    parts.forEach(function (p) {
      var li = doc.createElement("li");
      var pastille = doc.createElement("span");
      pastille.className = "legende__pastille";
      pastille.style.background = "var(" + p.couleur + ")";
      pastille.setAttribute("aria-hidden", "true");
      var nom = doc.createElement("span");
      nom.className = "legende__nom";
      nom.textContent = p.nom;
      var val = doc.createElement("span");
      val.className = "legende__valeur chiffre";
      val.textContent = fmtDinar.format(p.v.part) + "\u00a0DT";
      var det = doc.createElement("span");
      det.className = "legende__detail";
      det.textContent = p.detail;
      li.append(pastille, nom, val, det);
      legende.appendChild(li);
      description.push(p.nom + " : " + fmtDinar.format(p.v.part) + " dinar");
    });
    el("dinar-description").textContent = "Sur 1 dinar de coût employeur : " + description.join(" ; ") + ".";
  }

  var SEGMENTS = [
    { cle: "net", nom: "Salaire net", champ: "salaireNet", couleur: "--c-net" },
    { cle: "cnss", nom: "Cotisations", champ: "cotisations", couleur: "--c-cnss" },
    { cle: "irpp", nom: "IRPP", champ: "irpp", couleur: "--c-irpp" },
    { cle: "css", nom: "CSS", champ: "css", couleur: "--c-css" }
  ];

  function rendreRepartition(r) {
    var a = r.annuel;
    var total = a.brutTotal;
    var legende = el("legende");
    legende.textContent = "";
    var description = [];

    var parts = {};
    SEGMENTS.forEach(function (s) {
      var valeur = a[s.champ];
      var part = total > 0 ? valeur / total : 0;
      parts[s.cle] = part;

      var li = doc.createElement("li");
      var pastille = doc.createElement("span");
      pastille.className = "legende__pastille";
      pastille.style.background = "var(" + s.couleur + ")";
      pastille.setAttribute("aria-hidden", "true");
      var nom = doc.createElement("span");
      nom.className = "legende__nom";
      nom.textContent = s.cle === "cnss" ? "Cotisations " + r.regime.caisse : s.nom;
      var val = doc.createElement("span");
      val.className = "legende__valeur chiffre";
      val.textContent = montant(valeur / P.moisParAn);
      var pct = doc.createElement("span");
      pct.className = "legende__part";
      pct.textContent = fmtPourcent.format(part);
      val.appendChild(pct);
      li.append(pastille, nom, val);
      legende.appendChild(li);

      description.push(nom.textContent + " " + fmtPourcent.format(part));
    });

    G.majBarre(el("barre"), parts);
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

  function mettreAJourLibelles(sens, periode, secteur) {
    var mensuel = periode === "mensuel";
    var regime = P.regimes[secteur] || P.regimes[P.regimeParDefaut];
    el("aide-secteur").textContent = "Cotisations salariales " + regime.caisse + " : " +
      fmtPourcent.format(tauxRegime(regime)) + ". L’impôt est identique dans les deux secteurs.";
    var publicSect = secteur === "public";
    el("options-prive").hidden = publicSect;
    el("note-employeur-public").hidden = !publicSect;
    el("libelle-montant").textContent = (sens === "brut" ? "Salaire brut " : "Salaire net souhaité ") + (mensuel ? "mensuel" : "annuel");
    el("aide-montant").textContent = sens === "brut"
      ? "Salaire de base, hors primes. Décimales avec une virgule."
      : "Net à payer visé. Les primes et la situation familiale saisies sont prises en compte.";
    doc.querySelectorAll("[data-periode-texte]").forEach(function (n) { n.textContent = mensuel ? "par mois" : "par an"; });
  }

  /* ---------- Scénarios A et B ---------- */
  var scenarios = { A: null, B: null };
  var actif = "A";

  function majOnglets() {
    var avecB = !!scenarios.B;
    el("scenarios").hidden = !avecB;
    el("ajouter-b").hidden = avecB;
    ["A", "B"].forEach(function (k) {
      var o = el("onglet-" + k);
      var choisi = k === actif;
      o.setAttribute("aria-selected", String(choisi));
      o.tabIndex = choisi ? 0 : -1;
    });
    var badge = el("badge-scenario");
    badge.hidden = !avecB;
    badge.textContent = "Scénario " + actif;
  }

  function changerScenario(k, focus) {
    if (k === actif || (k === "B" && !scenarios.B)) return;
    scenarios[actif] = lireEtat();
    actif = k;
    appliquerEtat(scenarios[k]);
    majOnglets();
    calculer();
    if (focus) el("onglet-" + k).focus();
  }

  function ajouterB(etatB) {
    scenarios[actif] = lireEtat();
    if (actif === "B") { scenarios.A = scenarios.B; }
    scenarios.B = etatB || cloner(scenarios.A);
    actif = "A";
    changerScenario("B");
    majOnglets();
  }

  function retirerB() {
    if (actif === "B") { actif = "A"; appliquerEtat(scenarios.A); }
    scenarios.B = null;
    majOnglets();
    calculer();
    el("ajouter-b").focus();
  }

  function rendreComparateur() {
    var panneau = el("comparateur");
    if (!scenarios.B) { panneau.hidden = true; return; }
    panneau.hidden = false;
    var ra = calculerEtat(scenarios.A).r;
    var rb = calculerEtat(scenarios.B).r;
    var corps = el("comparateur-corps");
    var avant = instantane(corps);
    corps.textContent = "";
    function m(r, cle) { return r.annuel[cle] / r.entree.facteur / (r.periode === "annuel" ? 12 : 1); }
    function signe(x, fmt) { return Math.abs(x) < 0.0005 ? "=" : (x > 0 ? "+" : "−") + fmt(Math.abs(x)); }
    ligne(corps, { libelle: "Caisse (secteur)", valeurs: [ra.regime.caisse, rb.regime.caisse, ra.secteur === rb.secteur ? "=" : "≠"] });
    [
      ["Salaire de base brut", "salaireBase"],
      ["Salaire brut total", "brutTotal"],
      ["Cotisations salariales", "cotisations"],
      ["IRPP", "irpp"],
      ["CSS", "css"],
      ["Net à payer", "netAPayer", "total final"],
      ["Coût employeur", "coutEmployeur", "total"]
    ].forEach(function (l) {
      var va = m(ra, l[1]);
      var vb = m(rb, l[1]);
      ligne(corps, { classe: l[2], libelle: l[0], valeurs: [montant(va), montant(vb), signe(vb - va, montant)] });
    });
    var ta = ra.indicateurs.tauxPrelevementGlobal;
    var tb = rb.indicateurs.tauxPrelevementGlobal;
    ligne(corps, { libelle: "Taux de prélèvement", valeurs: [fmtPourcent.format(ta), fmtPourcent.format(tb),
      signe((tb - ta) * 100, function (x) { return fmtSaisie.format(Math.round(x * 100) / 100) + "\u00a0pt"; })] });
    signalerChangements(corps, avant);
  }

  /* ---------- Augmentation ---------- */
  var resultatCourant = null;

  function rendreAugmentation() {
    if (!resultatCourant) return;
    var mode = form.ownerDocument.querySelector('input[name="mode-aug"]:checked').value;
    var lu = lireMontant(el("aug-valeur").value);
    var etat = scenarios[actif];
    var r = resultatCourant;
    var mensuel = r.periode === "mensuel";
    var unite = mensuel ? "par mois" : "par an";
    el("aug-unite").textContent = mode === "pourcent" ? "%" : "DT";
    el("aug-libelle").textContent = mode === "net" ? "Hausse du net souhaitée " + unite
      : mode === "brut" ? "Hausse du salaire de base brut " + unite : "Hausse du salaire de base brut en %";
    el("aug-aide").textContent = mode === "net" ? "Exemple : 100 DT de plus sur la fiche de paie."
      : mode === "brut" ? "Montant ajouté au salaire de base." : "Exemple : 5 pour une hausse de 5 %.";
    if (!lu.valide) {
      el("aug-phrase").textContent = "Montant non reconnu : saisissez un nombre positif.";
      return;
    }
    var aug = C.simulerAugmentation(entreeBrut(etat, r), P, { mode: mode, valeur: lu.valeur });
    rendreAugmentation.dernier = aug;
    function plus(x) { return (x >= 0 ? "+" : "−") + montant(Math.abs(x)) + "\u00a0DT"; }
    el("aug-base").textContent = montant(aug.salaireBaseApres) + "\u00a0DT";
    el("aug-brut-val").textContent = plus(aug.hausseBrut);
    el("aug-net-val").textContent = plus(aug.hausseNet);
    el("aug-cout-val").textContent = plus(aug.hausseCout);
    el("aug-phrase").textContent = aug.hausseNet > 0.0005
      ? "Pour 1 DT net de plus, l’employeur dépense " + fmtDinar.format(aug.coutParDinarNet) + " DT ; le salarié garde " +
        fmtPourcent.format(aug.partNetDeLaHausseBrute) + " de la hausse brute."
      : "Saisissez une hausse pour voir son effet.";
    el("aug-vers-b").disabled = !(aug.hausseBrut > 0.0005);
  }

  /* ---------- Courbe du net selon le brut ---------- */
  var courbe = null;

  function rendreCourbe() {
    if (!resultatCourant) return;
    var r = resultatCourant;
    var etat = scenarios[actif];
    var entree = entreeBrut(etat, r);
    var f = r.entree.facteur;
    var base = r.annuel.salaireBase / f;
    var plancher = r.periode === "annuel" ? 36000 : 3000;
    var cible = Math.max(base * 2.5, plancher);
    var pas = G.pasRond(cible, 5);
    var xmax = Math.ceil(cible / pas) * pas;
    var points = C.courbeNetBrut(entree, P, { min: 0, max: xmax, points: 121 });
    if (!courbe) {
      courbe = new G.Courbe(el("courbe-svg"), el("courbe-info"), {
        annoncer: function (t) { el("courbe-lecture").textContent = t; }
      });
    }
    var net = r.annuel.netAPayer / f;
    courbe.maj({ points: points, actuel: { brut: base, net: net } });

    var pasTest = r.periode === "annuel" ? 1200 : 100;
    var suivant = C.calculerDepuisBrut(Object.assign({}, entree, { montant: base + pasTest }), P);
    var gain = suivant.annuel.netAPayer / f - net;
    var unite = r.periode === "annuel" ? "par an" : "par mois";
    el("courbe-lecture").textContent = "Avec " + montant(base) + " DT de salaire de base " + unite + ", le net à payer est de " +
      montant(net) + " DT. " + fmtEntier.format(pasTest) + " DT de brut en plus rapporteraient " + montant(gain) + " DT net.";
    el("courbe-description").textContent = "Le net croît moins vite que le brut ; l’écart se creuse à chaque tranche de l’impôt. " +
      "Point actuel : " + fmtEntier.format(base) + " DT brut, " + fmtEntier.format(net) + " DT net.";
  }

  /* ---------- Lien de partage et adresse de la page ---------- */
  function requeteCourante() {
    scenarios[actif] = lireEtat();
    return E.encoder(scenarios.A, scenarios.B);
  }

  function lienPartage() {
    return location.origin + location.pathname + "?" + requeteCourante();
  }

  var adresseTimer = null;
  function majAdresse() {
    clearTimeout(adresseTimer);
    adresseTimer = setTimeout(function () {
      try { history.replaceState(null, "", "?" + requeteCourante()); } catch (e) { /* fichier local */ }
    }, 400);
  }

  var toastTimer = null;
  function toast(message) {
    var t = el("toast");
    t.textContent = message;
    t.setAttribute("data-visible", "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.removeAttribute("data-visible"); }, 2800);
  }

  function copier(texte) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texte);
    return new Promise(function (ok, ko) {
      var zone = doc.createElement("textarea");
      zone.value = texte;
      zone.setAttribute("readonly", "");
      zone.style.position = "fixed";
      zone.style.opacity = "0";
      doc.body.appendChild(zone);
      zone.select();
      try { doc.execCommand("copy") ? ok() : ko(); } catch (e) { ko(e); }
      doc.body.removeChild(zone);
    });
  }

  function partager() {
    var url = lienPartage();
    var tactile = window.matchMedia("(pointer: coarse)").matches;
    if (navigator.share && tactile) {
      navigator.share({ title: "Calculateur de salaire Tunisie", text: "Ma simulation de salaire brut ⇄ net", url: url })
        .catch(function () { /* partage annulé */ });
      return;
    }
    copier(url).then(function () { toast("Lien copié : collez-le pour partager ce calcul."); },
      function () { toast("Copie impossible : copiez l’adresse de la page."); });
  }

  function calculer() {
    var etat = lireEtat();
    scenarios[actif] = etat;
    var sens = etat.sens;
    mettreAJourLibelles(sens, etat.periode, etat.secteur);

    el("compteurs-enfants").toggleAttribute("data-inactif", !etat.chefDeFamille);

    var validite = lireMontant(el("montant").value);
    var boite = el("montant").closest(".saisie-montant");
    var erreur = el("erreur-montant");
    if (!validite.valide) {
      boite.setAttribute("data-invalide", "");
      el("montant").setAttribute("aria-invalid", "true");
      erreur.textContent = "Montant non reconnu. Saisissez un nombre positif, par exemple 2 500 ou 2 500,750.";
      erreur.hidden = false;
      return;
    }
    boite.removeAttribute("data-invalide");
    el("montant").removeAttribute("aria-invalid");
    erreur.hidden = true;

    var calcul = calculerEtat(etat);
    resultatCourant = calcul.r;
    afficher(calcul.r, sens, calcul.inverse);
    rendreComparateur();
    rendreAugmentation();
    rendreCourbe();
    majAdresse();
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
  ["montant", "primes", "non-cotisables", "avantages", "indemnites"].forEach(function (id) {
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
      ["montant", "primes", "non-cotisables", "avantages", "indemnites"].forEach(function (id) {
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

  /* Scénarios */
  el("ajouter-b").addEventListener("click", function () { ajouterB(); toast("Scénario B créé : modifiez-le pour comparer."); });
  el("retirer-b").addEventListener("click", retirerB);
  doc.querySelectorAll('[role="tab"][data-scenario]').forEach(function (o) {
    o.addEventListener("click", function () { changerScenario(o.getAttribute("data-scenario")); });
    o.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        var cible = e.key === "Home" ? "A" : e.key === "End" ? "B" : (actif === "A" ? "B" : "A");
        changerScenario(cible, true);
      }
    });
  });

  /* Partage */
  el("partager").addEventListener("click", partager);

  /* Augmentation */
  doc.querySelectorAll('input[name="mode-aug"]').forEach(function (r) {
    r.addEventListener("change", function () {
      el("aug-valeur").value = r.value === "pourcent" ? "5" : "100";
      rendreAugmentation();
    });
  });
  el("aug-valeur").addEventListener("input", rendreAugmentation);
  el("aug-vers-b").addEventListener("click", function () {
    var aug = rendreAugmentation.dernier;
    if (!aug) return;
    var base = lireEtat();
    var etatB = cloner(base);
    etatB.sens = "brut";
    etatB.montant = C.arrondiMillime(aug.salaireBaseApres);
    /* A = situation actuelle, B = après augmentation */
    appliquerEtat(base);
    scenarios.A = base;
    scenarios.B = null;
    actif = "A";
    ajouterB(etatB);
    el("resultats").scrollIntoView({ behavior: mouvementReduit.matches ? "auto" : "smooth", block: "start" });
    toast("Scénario B : situation après augmentation.");
  });

  /* Installation (application web progressive) */
  var invitation = null;
  function boutonsInstaller(visibles) {
    el("bouton-installer").hidden = !visibles;
    el("bouton-installer-2").hidden = !visibles;
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    invitation = e;
    boutonsInstaller(true);
  });
  window.addEventListener("appinstalled", function () {
    invitation = null;
    boutonsInstaller(false);
    toast("Application installée.");
  });
  ["bouton-installer", "bouton-installer-2"].forEach(function (id) {
    el(id).addEventListener("click", function () {
      if (!invitation) return;
      invitation.prompt();
      invitation.userChoice.finally(function () { invitation = null; boutonsInstaller(false); });
    });
  });
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* hors ligne indisponible */ });
    });
  }

  /* ---------- Démarrage ---------- */
  appliquerTheme(racine.getAttribute("data-theme") === "light" ? "light" : "dark");
  remplirTextesParametres();
  majBoutonsPas();
  /* Simulation reçue par lien de partage */
  var recu = E.decoder(location.search);
  if (recu.a) {
    appliquerEtat(recu.a);
    scenarios.A = recu.a;
    if (recu.b) { scenarios.B = recu.b; }
  }
  majOnglets();
  racine.classList.add("js-attente");
  calculer();
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { racine.classList.remove("js-attente"); });
  });
})();
