/*
 * Moteur de calcul de paie — Tunisie
 * ----------------------------------
 * Fonctions pures : aucune dépendance au navigateur, aucun paramètre légal en dur.
 * Tous les taux, plafonds et tranches viennent de l'objet `params`
 * (config/parametres.js).
 *
 * Le calcul se fait sur une base ANNUELLE (comme la retenue à la source :
 * le salaire mensuel est annualisé, l'impôt annuel est ensuite ramené au mois).
 */
(function (racine) {
  "use strict";

  /* ---------- Outils ---------- */

  function nombre(valeur) {
    var n = Number(valeur);
    return Number.isFinite(n) ? n : 0;
  }

  function positif(valeur) {
    return Math.max(0, nombre(valeur));
  }

  function entier(valeur, max) {
    var n = Math.floor(positif(valeur));
    return typeof max === "number" ? Math.min(n, max) : n;
  }

  function somme(liste, cle) {
    return liste.reduce(function (total, element) {
      return total + element[cle];
    }, 0);
  }

  /* Arrondi au millime (3 décimales), pour l'affichage et les comparaisons */
  function arrondiMillime(valeur) {
    return Math.round((valeur + Number.EPSILON) * 1000) / 1000;
  }

  /* ---------- Normalisation des entrées ---------- */

  /*
   * entree = {
   *   montant, periode: "mensuel" | "annuel", secteur: "prive" | "public",
   *   primesImposables, primesNonCotisables, avantagesNature,
   *   indemnitesNonImposables,                                       (même période que montant)
   *   chefDeFamille, enfants, etudiants, handicapes, parents,
   *   tauxAccidentTravail, industrieManufacturiere,
   *   nombreSalaires                     (versements du salaire de base par an : 12, 13, 14…)
   * }
   * En saisie mensuelle, le salaire de base est versé `nombreSalaires` fois par an ;
   * primes, avantages et indemnités mensuels restent comptés 12 fois.
   */
  function nombreDeSalaires(e, params) {
    var v = params.versements;
    var n = Math.floor(nombre(e.nombreSalaires) || v.parDefaut);
    return Math.min(Math.max(n, v.minimum), v.maximum);
  }

  function normaliser(entree, params) {
    var e = entree || {};
    var facteur = e.periode === "annuel" ? 1 : params.moisParAn;
    var at = params.employeur.accidentTravail;
    var taux = e.tauxAccidentTravail === undefined || e.tauxAccidentTravail === null || e.tauxAccidentTravail === ""
      ? at.tauxParDefaut
      : nombre(e.tauxAccidentTravail);

    var secteur = params.regimes[e.secteur] ? e.secteur : params.regimeParDefaut;
    var nombreSalaires = nombreDeSalaires(e, params);

    return {
      periode: e.periode === "annuel" ? "annuel" : "mensuel",
      secteur: secteur,
      facteur: facteur,
      nombreSalaires: nombreSalaires,
      salaireBase: positif(e.montant) * (e.periode === "annuel" ? 1 : nombreSalaires),
      primesImposables: positif(e.primesImposables) * facteur,
      primesNonCotisables: positif(e.primesNonCotisables) * facteur,
      avantagesNature: positif(e.avantagesNature) * facteur,
      indemnitesNonImposables: positif(e.indemnitesNonImposables) * facteur,
      chefDeFamille: Boolean(e.chefDeFamille),
      enfants: entier(e.enfants),
      etudiants: entier(e.etudiants),
      handicapes: entier(e.handicapes),
      parents: entier(e.parents, params.irpp.deductions.parentACharge.nombreMax),
      tauxAccidentTravail: Math.min(Math.max(taux, at.tauxMin), at.tauxMax),
      industrieManufacturiere: Boolean(e.industrieManufacturiere)
    };
  }

  /* ---------- Briques de calcul ---------- */

  function calculerImpotBareme(revenu, bareme) {
    var tranches = [];
    var impot = 0;
    for (var i = 0; i < bareme.length; i++) {
      var de = bareme[i].de;
      var a = i + 1 < bareme.length ? bareme[i + 1].de : Infinity;
      var part = Math.max(0, Math.min(revenu, a) - de);
      var montant = part * bareme[i].taux;
      impot += montant;
      tranches.push({ de: de, a: a, taux: bareme[i].taux, base: part, impot: montant });
    }
    return { impot: impot, tranches: tranches };
  }

  function tauxMarginal(revenu, bareme) {
    var taux = 0;
    for (var i = 0; i < bareme.length; i++) {
      if (revenu > bareme[i].de) taux = bareme[i].taux;
    }
    return taux;
  }

  function calculerDeductions(e, revenuNet, params) {
    var d = params.irpp.deductions;
    var lignes = [];
    var enfantsAutorises = e.chefDeFamille || !d.enfantsReservesAuChefDeFamille;

    if (e.chefDeFamille) {
      lignes.push({ code: "chef", libelle: "Chef de famille", nombre: 1, montant: d.chefDeFamille.montant });
    }

    var enfantsIgnores = 0;
    if (enfantsAutorises) {
      /* Les 4 premiers rangs : on retient d'abord les étudiants (déduction la plus forte) */
      var places = d.nombreMaxEnfants;
      var etudiants = Math.min(e.etudiants, places);
      var enfants = Math.min(e.enfants, places - etudiants);
      enfantsIgnores = e.etudiants + e.enfants - etudiants - enfants;

      if (etudiants > 0) {
        lignes.push({ code: "etudiants", libelle: "Enfants étudiants non boursiers", nombre: etudiants, montant: etudiants * d.enfantEtudiant.montant });
      }
      if (enfants > 0) {
        lignes.push({ code: "enfants", libelle: "Enfants à charge", nombre: enfants, montant: enfants * d.enfant.montant });
      }
      if (e.handicapes > 0) {
        lignes.push({ code: "handicapes", libelle: "Enfants handicapés", nombre: e.handicapes, montant: e.handicapes * d.enfantHandicape.montant });
      }
    } else {
      enfantsIgnores = e.enfants + e.etudiants + e.handicapes;
    }

    if (e.parents > 0) {
      var parParent = Math.min(revenuNet * d.parentACharge.taux, d.parentACharge.plafondParParent);
      lignes.push({ code: "parents", libelle: "Parents à charge", nombre: e.parents, montant: e.parents * parParent });
    }

    return { lignes: lignes, total: somme(lignes, "montant"), enfantsIgnores: enfantsIgnores };
  }

  /* ---------- Calcul principal : brut → net ---------- */

  function calculerDepuisBrut(entree, params) {
    var e = normaliser(entree, params);
    var p = params;

    var regime = p.regimes[e.secteur];
    var brutTotal = e.salaireBase + e.primesImposables + e.primesNonCotisables + e.avantagesNature;
    var assietteCotisations = brutTotal - e.primesNonCotisables;

    /* 1. Cotisations salariales (CNSS ou CNRPS selon le secteur) */
    var cotisationsLignes = regime.salarie.map(function (c) {
      return { code: c.code, libelle: c.libelle, taux: c.taux, montant: assietteCotisations * c.taux };
    });
    var cotisations = somme(cotisationsLignes, "montant");
    var tauxCotisations = somme(regime.salarie, "taux");

    /* 2. Revenu après cotisations, puis frais professionnels */
    var revenuApresCotisations = brutTotal - cotisations;
    var fp = p.irpp.fraisProfessionnels;
    var fraisProfessionnels = Math.min(revenuApresCotisations * fp.taux, fp.plafondAnnuel);
    var fraisPlafonnes = revenuApresCotisations * fp.taux > fp.plafondAnnuel;
    var revenuNet = revenuApresCotisations - fraisProfessionnels;

    /* 3. Déductions pour situation de famille */
    var deductions = calculerDeductions(e, revenuNet, p);
    var revenuImposable = Math.max(0, revenuNet - deductions.total);

    /* 4. IRPP selon le barème annuel */
    var bareme = calculerImpotBareme(revenuImposable, p.irpp.bareme);
    var irpp = bareme.impot;

    /* 5. Contribution sociale de solidarité */
    var cssDispense = revenuImposable <= p.css.seuilDispense;
    var css = cssDispense ? 0 : revenuImposable * p.css.taux;

    /* 6. Net */
    var retenues = cotisations + irpp + css;
    var salaireNet = brutTotal - retenues;
    var netAPayer = salaireNet - e.avantagesNature + e.indemnitesNonImposables;

    /* 7. Coût employeur indicatif */
    var emp = p.employeur;
    var applicables = regime.chargesEmployeur;
    var employeurLignes = regime.employeur.map(function (c) {
      return { code: "caisse_" + c.code, libelle: regime.caisse + " — " + c.libelle, taux: c.taux, montant: assietteCotisations * c.taux };
    });
    if (applicables.accidentTravail) {
      employeurLignes.push({ code: "accident_travail", libelle: emp.accidentTravail.libelle, taux: e.tauxAccidentTravail, montant: assietteCotisations * e.tauxAccidentTravail });
    }
    if (applicables.tfp) {
      var tauxTfp = e.industrieManufacturiere ? emp.tfp.tauxIndustrieManufacturiere : emp.tfp.taux;
      employeurLignes.push({ code: "tfp", libelle: emp.tfp.libelle, taux: tauxTfp, montant: brutTotal * tauxTfp });
    }
    if (applicables.foprolos) {
      employeurLignes.push({ code: "foprolos", libelle: emp.foprolos.libelle, taux: emp.foprolos.taux, montant: brutTotal * emp.foprolos.taux });
    }
    var chargesPatronales = somme(employeurLignes, "montant");

    return {
      annee: p.annee,
      periode: e.periode,
      secteur: e.secteur,
      regime: { libelle: regime.libelle, caisse: regime.caisse },
      entree: e,
      annuel: {
        salaireBase: e.salaireBase,
        primesImposables: e.primesImposables,
        primesNonCotisables: e.primesNonCotisables,
        avantagesNature: e.avantagesNature,
        indemnitesNonImposables: e.indemnitesNonImposables,
        brutTotal: brutTotal,
        assietteCotisations: assietteCotisations,
        cotisations: cotisations,
        cotisationsLignes: cotisationsLignes,
        revenuApresCotisations: revenuApresCotisations,
        fraisProfessionnels: fraisProfessionnels,
        revenuNet: revenuNet,
        deductions: deductions.total,
        deductionsLignes: deductions.lignes,
        revenuImposable: revenuImposable,
        irpp: irpp,
        irppTranches: bareme.tranches,
        css: css,
        retenues: retenues,
        salaireNet: salaireNet,
        netAPayer: netAPayer,
        chargesPatronales: chargesPatronales,
        chargesPatronalesLignes: employeurLignes,
        coutEmployeur: brutTotal + chargesPatronales + e.indemnitesNonImposables
      },
      indicateurs: {
        tauxCotisations: tauxCotisations,
        fraisPlafonnes: fraisPlafonnes,
        cssDispense: cssDispense,
        enfantsIgnores: deductions.enfantsIgnores,
        tauxMarginalIrpp: tauxMarginal(revenuImposable, p.irpp.bareme),
        tauxPrelevementGlobal: brutTotal > 0 ? retenues / brutTotal : 0
      }
    };
  }

  /* Convertit tous les montants annuels d'un résultat en montants mensuels */
  function versMensuel(annuel, mois) {
    var sortie = {};
    Object.keys(annuel).forEach(function (cle) {
      var v = annuel[cle];
      if (typeof v === "number") {
        sortie[cle] = v / mois;
      } else if (Array.isArray(v)) {
        sortie[cle] = v.map(function (ligne) {
          var copie = Object.assign({}, ligne);
          ["montant", "base", "impot"].forEach(function (k) {
            if (typeof copie[k] === "number") copie[k] = copie[k] / mois;
          });
          return copie;
        });
      }
    });
    return sortie;
  }

  /* ---------- Calcul inverse : net → brut ---------- */

  /*
   * Cherche le salaire de base brut qui donne le net à payer demandé,
   * les autres éléments (primes, avantages, situation familiale) restant fixes.
   *
   * Méthode : dichotomie. Le net est croissant avec le brut, à une exception :
   * la dispense de CSS crée un petit saut vers le bas quand le revenu imposable
   * franchit le seuil. On maintient l'invariant net(bas) < cible ≤ net(haut),
   * qui ne peut pas converger vers ce saut descendant : la dichotomie aboutit
   * donc toujours sur une solution exacte. On vérifie ensuite en recalculant.
   */
  function calculerDepuisNet(entree, params, options) {
    var n = nombreDeSalaires(entree || {}, params);
    if ((entree || {}).periode !== "annuel" && n !== params.versements.minimum) {
      /* Saisie mensuelle : le net visé est celui du mois type ; on cherche le
       * salaire de base sur 12 mois puis on recalcule l'année avec ses N versements. */
      var inv = calculerDepuisNetSimple(Object.assign({}, entree, { nombreSalaires: params.versements.minimum }), params, options);
      inv.resultat = calculerDepuisBrut(Object.assign({}, entree, { montant: inv.brut }), params);
      return inv;
    }
    return calculerDepuisNetSimple(entree, params, options);
  }

  function calculerDepuisNetSimple(entree, params, options) {
    var opts = options || {};
    var tolerance = opts.tolerance || 0.0005; /* un demi-millime */
    var maxIterations = opts.maxIterations || 200;

    var cible = positif(entree.montant);
    var base = Object.assign({}, entree);

    function netPour(brut) {
      base.montant = brut;
      return calculerDepuisBrut(base, params);
    }

    function netPeriode(resultat) {
      return resultat.annuel.netAPayer / resultat.entree.facteur;
    }

    var bas = 0;
    var resBas = netPour(bas);
    if (netPeriode(resBas) >= cible - tolerance) {
      /* Le net demandé est atteint (ou dépassé) sans salaire de base */
      var ecartZero = netPeriode(resBas) - cible;
      return {
        resultat: resBas,
        brut: 0,
        netCible: cible,
        netRecalcule: netPeriode(resBas),
        ecart: ecartZero,
        verifie: Math.abs(ecartZero) <= tolerance,
        iterations: 0,
        message: Math.abs(ecartZero) <= tolerance ? null : "Le net demandé est inférieur au net obtenu avec les seuls primes et indemnités saisies."
      };
    }

    /* Borne haute : on double jusqu'à dépasser la cible */
    var haut = Math.max(cible * 2, 1);
    var garde = 0;
    while (netPeriode(netPour(haut)) < cible && garde < 60) {
      bas = haut;
      haut *= 2;
      garde++;
    }

    var iterations = 0;
    while (iterations < maxIterations && haut - bas > 1e-9 * Math.max(1, haut)) {
      var milieu = (bas + haut) / 2;
      if (netPeriode(netPour(milieu)) < cible) {
        bas = milieu;
      } else {
        haut = milieu;
      }
      iterations++;
    }

    var resultat = netPour(haut);
    var netRecalcule = netPeriode(resultat);
    var ecart = netRecalcule - cible;

    return {
      resultat: resultat,
      brut: haut,
      netCible: cible,
      netRecalcule: netRecalcule,
      ecart: ecart,
      verifie: Math.abs(ecart) <= tolerance,
      iterations: iterations,
      message: null
    };
  }

  /* ---------- Mois type et versements supplémentaires ---------- */

  /*
   * Sépare l'année en un « mois type » (salaire régulier, impôt calculé sur
   * 12 mois comme la retenue mensuelle) et les versements supplémentaires
   * (13e mois, primes…), qui supportent le complément d'impôt de l'année.
   * Retourne { annee, moisType, versements: { nombre, supplementaires,
   * netMensuel, brutSupplementaire, netSupplementaire, netAnnuel } }.
   */
  function calculerAvecVersements(entree, params) {
    var annee = calculerDepuisBrut(entree, params);
    var e = annee.entree;
    var min = params.versements.minimum;
    var mensuelBase = e.salaireBase / e.nombreSalaires;
    var entreeMois = Object.assign({}, entree, {
      nombreSalaires: min,
      montant: e.periode === "annuel" ? mensuelBase * min : mensuelBase
    });
    var moisType = e.nombreSalaires === min ? annee : calculerDepuisBrut(entreeMois, params);
    var supp = e.nombreSalaires - min;
    return {
      annee: annee,
      moisType: moisType,
      versements: {
        nombre: e.nombreSalaires,
        supplementaires: supp,
        netMensuel: moisType.annuel.netAPayer / min,
        brutMensuel: moisType.annuel.brutTotal / min,
        brutSupplementaire: mensuelBase,
        netSupplementaire: supp > 0 ? (annee.annuel.netAPayer - moisType.annuel.netAPayer) / supp : 0,
        netAnnuel: annee.annuel.netAPayer
      }
    };
  }

  /* ---------- Répartition d'un dinar de coût employeur ---------- */

  /*
   * Ventile le coût total employeur entre le salarié, la caisse sociale et l'État.
   * Salarié : salaire net + indemnités non imposables (avantages en nature compris).
   * Caisse  : cotisations salariales + cotisations patronales de la caisse + accidents du travail.
   * État    : IRPP + CSS + TFP + FOPROLOS.
   */
  function repartitionCoutEmployeur(resultat) {
    var a = resultat.annuel;
    var caissePatronale = 0;
    var etatPatronal = 0;
    a.chargesPatronalesLignes.forEach(function (l) {
      if (l.code === "tfp" || l.code === "foprolos") etatPatronal += l.montant;
      else caissePatronale += l.montant;
    });
    var salarie = a.salaireNet + a.indemnitesNonImposables;
    var caisse = a.cotisations + caissePatronale;
    var etat = a.irpp + a.css + etatPatronal;
    var total = a.coutEmployeur;
    function part(x) { return total > 0 ? x / total : 0; }
    return {
      total: total,
      salarie: { montant: salarie, part: part(salarie) },
      caisse: { montant: caisse, part: part(caisse) },
      etat: { montant: etat, part: part(etat) }
    };
  }

  /* ---------- Courbe du net en fonction du brut ---------- */

  /*
   * Échantillonne le net à payer (par période saisie) pour des salaires de base
   * allant de `min` à `max`, les autres éléments restant fixes.
   */
  function courbeNetBrut(entree, params, options) {
    var o = options || {};
    var n = Math.max(2, o.points || 100);
    var min = o.min || 0;
    var max = o.max > min ? o.max : min + 1;
    var points = [];
    for (var i = 0; i < n; i++) {
      var brut = min + (max - min) * i / (n - 1);
      var r = calculerDepuisBrut(Object.assign({}, entree, { montant: brut }), params);
      var f = r.entree.facteur;
      points.push({
        brut: brut,
        brutTotal: r.annuel.brutTotal / f,
        net: r.annuel.netAPayer / f,
        tauxMarginal: r.indicateurs.tauxMarginalIrpp
      });
    }
    return points;
  }

  /* ---------- Simulation d'une augmentation ---------- */

  /*
   * augmentation = { mode: "net" | "brut" | "pourcent", valeur }
   *   net      : hausse du net à payer souhaitée (même période que l'entrée)
   *   brut     : hausse du salaire de base brut
   *   pourcent : hausse du salaire de base brut en % (10 = +10 %)
   * L'entrée décrit la situation actuelle « brut → net ».
   */
  function simulerAugmentation(entreeAnnee, params, augmentation) {
    var aug = augmentation || {};
    var valeur = positif(aug.valeur);
    /* En saisie mensuelle, on raisonne sur le mois type (12 salaires) ;
     * l'effet sur l'année entière (avec ses N versements) est donné à part. */
    var mensuel = (entreeAnnee || {}).periode !== "annuel";
    var entree = mensuel ? Object.assign({}, entreeAnnee, { nombreSalaires: params.versements.minimum }) : entreeAnnee;
    var avant = calculerDepuisBrut(entree, params);
    var f = avant.entree.facteur;
    var baseAvant = avant.annuel.salaireBase / f;
    var apres;
    var verifie = true;

    if (aug.mode === "net") {
      var inv = calculerDepuisNet(Object.assign({}, entree, { montant: avant.annuel.netAPayer / f + valeur }), params);
      apres = inv.resultat;
      verifie = inv.verifie;
    } else {
      var hausse = aug.mode === "pourcent" ? baseAvant * valeur / 100 : valeur;
      apres = calculerDepuisBrut(Object.assign({}, entree, { montant: baseAvant + hausse }), params);
    }

    function ecart(cle) { return (apres.annuel[cle] - avant.annuel[cle]) / f; }
    var hausseNet = ecart("netAPayer");
    var hausseCout = ecart("coutEmployeur");
    var anneeAvant = calculerDepuisBrut(entreeAnnee, params);
    var anneeApres = calculerDepuisBrut(Object.assign({}, entreeAnnee, { montant: apres.annuel.salaireBase / f }), params);
    return {
      nombreSalaires: anneeAvant.entree.nombreSalaires,
      hausseNetAnnuelle: anneeApres.annuel.netAPayer - anneeAvant.annuel.netAPayer,
      hausseCoutAnnuel: anneeApres.annuel.coutEmployeur - anneeAvant.annuel.coutEmployeur,
      avant: avant,
      apres: apres,
      verifie: verifie,
      salaireBaseApres: apres.annuel.salaireBase / f,
      hausseBrut: ecart("brutTotal"),
      hausseNet: hausseNet,
      hausseCout: hausseCout,
      hausseRetenues: ecart("retenues"),
      coutParDinarNet: hausseNet > 0 ? hausseCout / hausseNet : 0,
      partNetDeLaHausseBrute: ecart("brutTotal") > 0 ? hausseNet / ecart("brutTotal") : 0
    };
  }

  var API = {
    calculerAvecVersements: calculerAvecVersements,
    repartitionCoutEmployeur: repartitionCoutEmployeur,
    courbeNetBrut: courbeNetBrut,
    simulerAugmentation: simulerAugmentation,
    calculerDepuisBrut: calculerDepuisBrut,
    calculerDepuisNet: calculerDepuisNet,
    calculerImpotBareme: calculerImpotBareme,
    versMensuel: versMensuel,
    arrondiMillime: arrondiMillime
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    racine.CalculSalaire = API;
  }
})(typeof self !== "undefined" ? self : this);
