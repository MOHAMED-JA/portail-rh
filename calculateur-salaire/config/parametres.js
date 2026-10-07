/*
 * Paramètres légaux du calcul de paie — Tunisie
 * ------------------------------------------------
 * C'est le SEUL fichier à modifier chaque année (après la loi de finances).
 * Aucun taux, plafond ou tranche n'est écrit dans la logique de calcul (js/calcul.js).
 *
 * Unités : montants en dinars tunisiens (DT), annuels sauf mention contraire.
 *          Taux exprimés en fraction (0.0918 = 9,18 %).
 *
 * Mise à jour : voir la section « Mettre à jour les paramètres » du README.
 * Après chaque modification, lancer les tests : `node --test tests/`.
 */
(function (racine) {
  "use strict";

  var PARAMETRES = {
    annee: 2026,
    dateVerification: "2026-10-06",
    devise: "DT",
    moisParAn: 12,

    /* ---------------------------------------------------------------
     * Régimes de cotisations sociales
     * Le calcul de l'impôt (IRPP, CSS) est identique dans les deux secteurs ;
     * seules les cotisations et les charges employeur changent.
     * Assiette : rémunération soumise à cotisation (brut hors éléments
     * déclarés « non soumis à cotisation »). Pas de plafond.
     * ------------------------------------------------------------- */
    regimeParDefaut: "prive",
    regimes: {
      prive: {
        libelle: "Secteur privé",
        caisse: "CNSS",
        description: "Régime des salariés non agricoles (RSNA)",
        salarie: [
          {
            code: "regime_general",
            libelle: "Régime général (retraite, maladie, famille…)",
            taux: 0.0918,
            source: "Loi n° 60-30 du 14/12/1960 et textes modificatifs ; CNSS"
          },
          {
            code: "perte_emploi",
            libelle: "Fonds d’assurance perte d’emploi",
            taux: 0.005,
            source: "Loi n° 2024-48 du 09/12/2024 (LF 2025), art. 17"
          }
        ],
        employeur: [
          {
            code: "regime_general",
            libelle: "Régime général (part patronale)",
            taux: 0.1657,
            source: "Loi n° 60-30 du 14/12/1960 et textes modificatifs ; CNSS"
          },
          {
            code: "perte_emploi",
            libelle: "Fonds d’assurance perte d’emploi",
            taux: 0.005,
            source: "Loi n° 2024-48 du 09/12/2024 (LF 2025), art. 17"
          }
        ],
        /* Charges employeur hors caisse applicables à ce secteur */
        chargesEmployeur: { accidentTravail: true, tfp: true, foprolos: true }
      },
      public: {
        libelle: "Secteur public",
        caisse: "CNRPS",
        description: "Agents de l’État, des collectivités locales et des établissements publics",
        salarie: [
          {
            code: "retraite",
            libelle: "Retraite (pensions civiles)",
            taux: 0.092,
            source: "Loi n° 85-12 du 05/03/1985 ; loi n° 2019-37 du 30/04/2019 (9,2 % depuis le 01/01/2020)"
          },
          {
            code: "maladie",
            libelle: "Assurance maladie (prévoyance sociale)",
            taux: 0.0275,
            source: "Décret n° 2007-1406 du 18/06/2007"
          },
          {
            code: "capital_deces",
            libelle: "Capital décès",
            taux: 0.01,
            source: "Décret n° 74-572 du 22/05/1974 ; décret n° 93-308 du 01/02/1993"
          }
        ],
        employeur: [
          {
            code: "retraite",
            libelle: "Retraite (part employeur)",
            taux: 0.145,
            source: "Loi n° 2019-37 du 30/04/2019 (14,5 % depuis juin 2019)"
          },
          {
            code: "maladie",
            libelle: "Assurance maladie (part employeur)",
            taux: 0.04,
            source: "Décret n° 2007-1406 du 18/06/2007"
          }
        ],
        /* État et collectivités : pas de TFP ; accidents du travail : régime propre */
        chargesEmployeur: { accidentTravail: false, tfp: false, foprolos: true }
      }
    },

    /* ---------------------------------------------------------------
     * Charges employeur hors caisse (pour le coût employeur indicatif)
     * ------------------------------------------------------------- */
    employeur: {
      accidentTravail: {
        libelle: "Accidents du travail (taux selon l’activité)",
        tauxParDefaut: 0.005,
        tauxMin: 0,
        tauxMax: 0.05,
        source: "Décret n° 95-538 du 01/04/1995 (taux selon la classe d’activité)"
      },
      tfp: {
        libelle: "Taxe de formation professionnelle (TFP)",
        taux: 0.02,
        tauxIndustrieManufacturiere: 0.01,
        source: "Taxe sur la masse salariale brute : 2 % (1 % pour les industries manufacturières) — à vérifier selon l’activité et les exonérations"
      },
      foprolos: {
        libelle: "FOPROLOS (logement social)",
        taux: 0.01,
        source: "Loi n° 77-54 du 03/08/1977"
      }
    },

    /* ---------------------------------------------------------------
     * Impôt sur le revenu (IRPP) — traitements et salaires
     * ------------------------------------------------------------- */
    irpp: {
      /* Frais professionnels : 10 % du revenu net après cotisations, plafonnés */
      fraisProfessionnels: {
        taux: 0.10,
        plafondAnnuel: 2000,
        source: "Code de l’IRPP et de l’IS, art. 26-I ; plafond : loi n° 2016-78 (LF 2017), art. 14"
      },

      /* Déductions pour situation et charges de famille (art. 40) */
      deductions: {
        chefDeFamille: {
          montant: 300,
          source: "Code de l’IRPP, art. 40-I ; loi n° 2017-66 (LF 2018), art. 54"
        },
        enfant: {
          montant: 100,
          ageMaximum: 20,
          source: "Code de l’IRPP, art. 40-II ; loi n° 2017-66 (LF 2018), art. 54"
        },
        enfantEtudiant: {
          montant: 1000,
          ageMaximum: 25,
          source: "Code de l’IRPP, art. 40-III ; loi n° 2013-54 (LF 2014), art. 94"
        },
        /* Enfants « ordinaires » + étudiants : limités aux 4 premiers enfants */
        nombreMaxEnfants: 4,
        enfantHandicape: {
          montant: 2000,
          source: "Code de l’IRPP, art. 40-III ; loi n° 2017-66 (LF 2018), art. 55 (sans condition d’âge ni de rang)"
        },
        parentACharge: {
          taux: 0.05,
          plafondParParent: 450,
          nombreMax: 2,
          source: "Code de l’IRPP, art. 40-IV ; loi n° 2019-78 (LF 2020), art. 41"
        },
        /* Les déductions pour enfants sont accordées au chef de famille */
        enfantsReservesAuChefDeFamille: true
      },

      /* Barème annuel progressif : chaque taux s'applique à la part du revenu
       * comprise entre `de` et la borne `de` de la tranche suivante. */
      bareme: [
        { de: 0, taux: 0 },
        { de: 5000, taux: 0.15 },
        { de: 10000, taux: 0.25 },
        { de: 20000, taux: 0.30 },
        { de: 30000, taux: 0.33 },
        { de: 40000, taux: 0.36 },
        { de: 50000, taux: 0.38 },
        { de: 70000, taux: 0.40 }
      ],
      baremeSource: "Code de l’IRPP, art. 44 ; loi n° 2024-48 (LF 2025)"
    },

    /* ---------------------------------------------------------------
     * Contribution sociale de solidarité (CSS) — personnes physiques
     * Calcul : taux × revenu net imposable annuel (barème majoré d'un demi-point).
     * Dispense : salariés dont le revenu net imposable annuel ≤ seuil.
     * ------------------------------------------------------------- */
    css: {
      taux: 0.005,
      seuilDispense: 5000,
      source: "Loi n° 2017-66 (LF 2018), art. 53 ; décret-loi n° 2022-79 (LF 2023), art. 22 ; loi n° 2025-17 (LF 2026), art. 87 et note DGELF de janvier 2026 ; dispense : loi n° 2019-78 (LF 2020), art. 39"
    },

    /* ---------------------------------------------------------------
     * Nombre de salaires versés par an (usage de l'entreprise ou de la
     * convention collective) : 12 = salaire mensuel seul ; 13 = 12 salaires
     * + un 13e mois ; 14, 15… = primes versées comme des mois de salaire.
     * Chaque versement supplémentaire est égal au salaire de base mensuel.
     * ------------------------------------------------------------- */
    versements: {
      parDefaut: 12,
      minimum: 12,
      maximum: 18
    },

    /* Repères (affichage seulement, n'interviennent pas dans le calcul) */
    reperes: {
      smigMensuel48h: 554.736,
      smigMensuel40h: 470.251,
      smigSource: "Décret n° 2026-67 (JORT du 30/04/2026), effet au 01/01/2026"
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PARAMETRES;
  } else {
    racine.PARAMETRES_PAIE = PARAMETRES;
  }
})(typeof self !== "undefined" ? self : this);

