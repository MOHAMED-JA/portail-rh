/*
 * État d'une simulation et lien de partage
 * ----------------------------------------
 * Un « état » est la liste des valeurs saisies dans le formulaire, sous forme
 * simple (textes et nombres). Il se convertit en paramètres d'adresse
 * (?m=2500&chef=1…) pour partager une simulation, et inversement.
 * Fonctions pures : aucune dépendance au navigateur (testées sous Node).
 */
(function (racine) {
  "use strict";

  /* Champ de l'état → clé courte dans l'adresse, type, valeur par défaut */
  var CHAMPS = [
    { nom: "sens", cle: "sens", type: "choix", valeurs: ["brut", "net"], defaut: "brut" },
    { nom: "secteur", cle: "sec", type: "choix", valeurs: ["prive", "public"], defaut: "prive" },
    { nom: "periode", cle: "per", type: "choix", valeurs: ["mensuel", "annuel"], defaut: "mensuel" },
    { nom: "montant", cle: "m", type: "montant", defaut: 2500 },
    { nom: "nombreSalaires", cle: "ns", type: "entier", min: 12, max: 18, defaut: 12 },
    { nom: "chefDeFamille", cle: "chef", type: "booleen", defaut: false },
    { nom: "enfants", cle: "enf", type: "entier", max: 15, defaut: 0 },
    { nom: "etudiants", cle: "etu", type: "entier", max: 15, defaut: 0 },
    { nom: "handicapes", cle: "han", type: "entier", max: 15, defaut: 0 },
    { nom: "parents", cle: "par", type: "entier", max: 2, defaut: 0 },
    { nom: "primesImposables", cle: "pri", type: "montant", defaut: 0 },
    { nom: "primesNonCotisables", cle: "nco", type: "montant", defaut: 0 },
    { nom: "avantagesNature", cle: "ava", type: "montant", defaut: 0 },
    { nom: "indemnitesNonImposables", cle: "ind", type: "montant", defaut: 0 },
    { nom: "tauxAccidentTravailPct", cle: "at", type: "montant", defaut: null },
    { nom: "industrieManufacturiere", cle: "man", type: "booleen", defaut: false }
  ];

  function etatParDefaut() {
    var e = {};
    CHAMPS.forEach(function (c) { e[c.nom] = c.defaut; });
    return e;
  }

  function nombreValide(texte) {
    var n = Number(String(texte).replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function valeurDepuisTexte(champ, texte) {
    if (texte === null || texte === undefined) return undefined;
    switch (champ.type) {
      case "choix":
        return champ.valeurs.indexOf(texte) !== -1 ? texte : undefined;
      case "booleen":
        return texte === "1" || texte === "true";
      case "entier": {
        var n = nombreValide(texte);
        if (n === null) return undefined;
        n = Math.floor(n);
        if (champ.min !== undefined) n = Math.max(n, champ.min);
        return champ.max !== undefined ? Math.min(n, champ.max) : n;
      }
      case "montant": {
        var v = nombreValide(texte);
        return v === null ? undefined : Math.round(v * 1000) / 1000;
      }
    }
    return undefined;
  }

  function valeurVersTexte(champ, valeur) {
    if (champ.type === "booleen") return valeur ? "1" : null;
    if (valeur === null || valeur === undefined) return null;
    if (champ.type === "montant" || champ.type === "entier") return String(Math.round(valeur * 1000) / 1000);
    return String(valeur);
  }

  /*
   * Convertit un ou deux états (scénarios A et B) en chaîne de paramètres.
   * Seules les valeurs différentes des valeurs par défaut sont écrites ;
   * le scénario B est préfixé par « b_ ».
   */
  function encoder(etatA, etatB) {
    var morceaux = [];
    function ajouter(etat, prefixe) {
      CHAMPS.forEach(function (c) {
        var v = etat[c.nom];
        if (v === c.defaut && c.nom !== "montant") return;
        var t = valeurVersTexte(c, v);
        if (t !== null) morceaux.push(prefixe + c.cle + "=" + encodeURIComponent(t));
      });
    }
    ajouter(etatA, "");
    if (etatB) {
      morceaux.push("cmp=1");
      ajouter(etatB, "b_");
    }
    return morceaux.join("&");
  }

  /* Lit une chaîne de paramètres (avec ou sans « ? ») → { a, b } */
  function decoder(chaine) {
    var params = {};
    String(chaine || "").replace(/^\?/, "").split("&").forEach(function (paire) {
      if (!paire) return;
      var i = paire.indexOf("=");
      var cle = decodeURIComponent(i === -1 ? paire : paire.slice(0, i));
      var val = i === -1 ? "" : decodeURIComponent(paire.slice(i + 1).replace(/\+/g, " "));
      params[cle] = val;
    });

    function lire(prefixe) {
      var e = etatParDefaut();
      var trouve = false;
      CHAMPS.forEach(function (c) {
        var v = valeurDepuisTexte(c, params[prefixe + c.cle]);
        if (v !== undefined) { e[c.nom] = v; trouve = true; }
      });
      return { etat: e, trouve: trouve };
    }

    var a = lire("");
    var b = params.cmp === "1" ? lire("b_") : null;
    return { a: a.trouve ? a.etat : null, b: b ? b.etat : null };
  }

  /* État → entrée du moteur de calcul (js/calcul.js) */
  function versEntree(etat) {
    return {
      montant: etat.montant,
      nombreSalaires: etat.nombreSalaires,
      periode: etat.periode,
      secteur: etat.secteur,
      chefDeFamille: etat.chefDeFamille,
      enfants: etat.enfants,
      etudiants: etat.etudiants,
      handicapes: etat.handicapes,
      parents: etat.parents,
      primesImposables: etat.primesImposables,
      primesNonCotisables: etat.primesNonCotisables,
      avantagesNature: etat.avantagesNature,
      indemnitesNonImposables: etat.indemnitesNonImposables,
      tauxAccidentTravail: etat.tauxAccidentTravailPct === null || etat.tauxAccidentTravailPct === undefined
        ? undefined : etat.tauxAccidentTravailPct / 100,
      industrieManufacturiere: etat.industrieManufacturiere
    };
  }

  var API = {
    CHAMPS: CHAMPS,
    etatParDefaut: etatParDefaut,
    encoder: encoder,
    decoder: decoder,
    versEntree: versEntree
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    racine.EtatSimulation = API;
  }
})(typeof self !== "undefined" ? self : this);

