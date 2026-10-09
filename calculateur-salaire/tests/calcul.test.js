/*
 * Tests de la logique de calcul — lancer avec : node --test tests/
 * Les valeurs attendues sont recalculées à la main (détail en commentaire),
 * à partir des paramètres 2026 de config/parametres.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../config/parametres.js");
const C = require("../js/calcul.js");

const TOL = 0.0005; // un demi-millime

function proche(reel, attendu, message, tolerance = TOL) {
  assert.ok(
    Math.abs(reel - attendu) <= tolerance,
    `${message} : obtenu ${reel}, attendu ${attendu}`
  );
}

/* ------------------------------------------------------------------ */
test("paramètres : barème croissant, taux cohérents, année 2026", () => {
  assert.equal(P.annee, 2026);
  const b = P.irpp.bareme;
  assert.equal(b[0].de, 0);
  for (let i = 1; i < b.length; i++) {
    assert.ok(b[i].de > b[i - 1].de, "bornes croissantes");
    assert.ok(b[i].taux > b[i - 1].taux, "taux croissants");
  }
  proche(P.regimes.prive.salarie.reduce((s, c) => s + c.taux, 0), 0.0968, "taux CNSS salarié total");
  proche(P.regimes.prive.employeur.reduce((s, c) => s + c.taux, 0), 0.1707, "taux CNSS patronal total");
  proche(P.regimes.public.salarie.reduce((s, c) => s + c.taux, 0), 0.1295, "taux CNRPS salarié total");
  proche(P.regimes.public.employeur.reduce((s, c) => s + c.taux, 0), 0.185, "taux CNRPS employeur total");
});

test("barème IRPP : exemples par tranche", () => {
  const bareme = P.irpp.bareme;
  proche(C.calculerImpotBareme(5000, bareme).impot, 0, "5 000 DT");
  proche(C.calculerImpotBareme(10000, bareme).impot, 750, "10 000 DT");
  proche(C.calculerImpotBareme(20000, bareme).impot, 3250, "20 000 DT");
  proche(C.calculerImpotBareme(70000, bareme).impot, 20750, "70 000 DT");
  proche(C.calculerImpotBareme(100000, bareme).impot, 32750, "100 000 DT");
});

/* ------------------------------------------------------------------ */
test("cas typique : 2 500 DT/mois, chef de famille, 2 enfants (frais pro plafonnés)", () => {
  const r = C.calculerDepuisBrut(
    { montant: 2500, periode: "mensuel", chefDeFamille: true, enfants: 2 }, P
  );
  const a = r.annuel;
  // brut 30 000 ; CNSS 9,68 % = 2 904 ; après CNSS 27 096
  proche(a.brutTotal, 30000, "brut annuel");
  proche(a.cotisations, 2904, "CNSS");
  // frais pro : 10 % = 2 709,6 → plafond 2 000
  proche(a.fraisProfessionnels, 2000, "frais professionnels plafonnés");
  assert.equal(r.indicateurs.fraisPlafonnes, true);
  // déductions : 300 + 2 × 100 = 500 ; imposable 25 096 − 500 = 24 596
  proche(a.deductions, 500, "déductions famille");
  proche(a.revenuImposable, 24596, "revenu imposable");
  // IRPP : 750 + 2 500 + 4 596 × 30 % = 4 628,8
  proche(a.irpp, 4628.8, "IRPP");
  // CSS : 0,5 % × 24 596 = 122,98
  proche(a.css, 122.98, "CSS");
  // net : 30 000 − 2 904 − 4 628,8 − 122,98 = 22 344,22
  proche(a.salaireNet, 22344.22, "net annuel");
  proche(a.netAPayer / 12, 1862.018333, "net mensuel", 0.001);
  proche(r.indicateurs.tauxMarginalIrpp, 0.30, "taux marginal");
});

test("cas typique : 1 500 DT/mois, célibataire (frais pro non plafonnés)", () => {
  const a = C.calculerDepuisBrut({ montant: 1500, periode: "mensuel" }, P).annuel;
  // 18 000 ; CNSS 1 742,4 ; après 16 257,6 ; frais 1 625,76 ; imposable 14 631,84
  proche(a.fraisProfessionnels, 1625.76, "frais professionnels");
  proche(a.revenuImposable, 14631.84, "revenu imposable");
  // IRPP : 750 + 4 631,84 × 25 % = 1 907,96 ; CSS 73,1592
  proche(a.irpp, 1907.96, "IRPP");
  proche(a.css, 73.1592, "CSS");
  proche(a.salaireNet, 18000 - 1742.4 - 1907.96 - 73.1592, "net annuel");
});

test("saisie annuelle = saisie mensuelle × 12", () => {
  const m = C.calculerDepuisBrut({ montant: 3200, periode: "mensuel", chefDeFamille: true, enfants: 1 }, P);
  const y = C.calculerDepuisBrut({ montant: 38400, periode: "annuel", chefDeFamille: true, enfants: 1 }, P);
  proche(m.annuel.netAPayer, y.annuel.netAPayer, "net identique");
  const mens = C.versMensuel(y.annuel, 12);
  proche(mens.netAPayer, y.annuel.netAPayer / 12, "conversion mensuelle");
});

/* ------------------------------------------------------------------ */
test("cas limite : SMIG 48 h (554,736 DT/mois), célibataire", () => {
  const a = C.calculerDepuisBrut({ montant: P.reperes.smigMensuel48h, periode: "mensuel" }, P).annuel;
  const brut = 554.736 * 12;               // 6 656,832
  const cnss = brut * 0.0968;              // 644,3813…
  const rn = (brut - cnss) * 0.9;          // 5 411,2056…
  proche(a.revenuImposable, rn, "revenu imposable");
  proche(a.irpp, (rn - 5000) * 0.15, "IRPP");
  proche(a.css, rn * 0.005, "CSS (au-dessus du seuil de dispense)");
});

test("cas limite : bas salaire 500 DT/mois → revenu ≤ 5 000 DT : ni IRPP ni CSS", () => {
  const r = C.calculerDepuisBrut({ montant: 500, periode: "mensuel" }, P);
  // 6 000 − 580,8 = 5 419,2 ; frais 541,92 ; imposable 4 877,28
  proche(r.annuel.revenuImposable, 4877.28, "revenu imposable");
  assert.equal(r.annuel.irpp, 0);
  assert.equal(r.annuel.css, 0);
  assert.equal(r.indicateurs.cssDispense, true);
  proche(r.annuel.netAPayer / 12, 451.6, "net mensuel");
});

test("cas limite : très haut salaire 20 000 DT/mois (tranche à 40 %)", () => {
  const r = C.calculerDepuisBrut({ montant: 20000, periode: "mensuel" }, P);
  const a = r.annuel;
  // 240 000 ; CNSS 23 232 ; frais plafonnés 2 000 ; imposable 214 768
  proche(a.revenuImposable, 214768, "revenu imposable");
  // 20 750 jusqu'à 70 000 + 144 768 × 40 % = 78 657,2
  proche(a.irpp, 78657.2, "IRPP");
  proche(a.css, 1073.84, "CSS");
  proche(a.salaireNet, 137036.96, "net annuel");
  assert.equal(r.indicateurs.tauxMarginalIrpp, 0.40);
});

test("cas limite : salaire nul", () => {
  const r = C.calculerDepuisBrut({ montant: 0, periode: "mensuel", chefDeFamille: true, enfants: 3 }, P);
  assert.equal(r.annuel.brutTotal, 0);
  assert.equal(r.annuel.netAPayer, 0);
  assert.equal(r.annuel.revenuImposable, 0);
  assert.equal(r.indicateurs.tauxPrelevementGlobal, 0);
});

test("entrées invalides : négatifs et texte ramenés à zéro", () => {
  const r = C.calculerDepuisBrut({ montant: -1000, periode: "mensuel", enfants: -2, primesImposables: "abc" }, P);
  assert.equal(r.annuel.brutTotal, 0);
});

/* ------------------------------------------------------------------ */
test("famille : pas d'enfants vs 2 enfants (écart = 200 DT de base × taux marginal)", () => {
  const sans = C.calculerDepuisBrut({ montant: 2500, periode: "mensuel", chefDeFamille: true }, P).annuel;
  const avec = C.calculerDepuisBrut({ montant: 2500, periode: "mensuel", chefDeFamille: true, enfants: 2 }, P).annuel;
  proche(sans.revenuImposable - avec.revenuImposable, 200, "écart de base");
  // 200 × (30 % IRPP + 0,5 % CSS) = 61
  proche(avec.netAPayer - sans.netAPayer, 61, "gain net annuel");
});

test("famille : plafond de 4 enfants atteint, étudiants retenus en priorité", () => {
  const r = C.calculerDepuisBrut(
    { montant: 3000, periode: "mensuel", chefDeFamille: true, enfants: 4, etudiants: 2 }, P
  );
  // 2 étudiants × 1 000 + 2 enfants × 100 (4 rangs) ; 2 enfants ignorés ; + 300 chef
  proche(r.annuel.deductions, 300 + 2000 + 200, "déductions");
  assert.equal(r.indicateurs.enfantsIgnores, 2);
});

test("famille : enfant handicapé hors limite de rang", () => {
  const r = C.calculerDepuisBrut(
    { montant: 3000, periode: "mensuel", chefDeFamille: true, enfants: 4, handicapes: 1 }, P
  );
  proche(r.annuel.deductions, 300 + 400 + 2000, "déductions");
});

test("famille : enfants sans statut de chef de famille → non déduits", () => {
  const r = C.calculerDepuisBrut({ montant: 3000, periode: "mensuel", chefDeFamille: false, enfants: 2 }, P);
  assert.equal(r.annuel.deductions, 0);
  assert.equal(r.indicateurs.enfantsIgnores, 2);
});

test("famille : parents à charge, 5 % plafonné à 450 DT par parent", () => {
  const bas = C.calculerDepuisBrut({ montant: 600, periode: "mensuel", parents: 1 }, P).annuel;
  proche(bas.deductionsLignes[0].montant, bas.revenuNet * 0.05, "5 % du revenu net");
  const haut = C.calculerDepuisBrut({ montant: 5000, periode: "mensuel", parents: 3 }, P).annuel;
  proche(haut.deductions, 900, "plafond 450 × 2 parents maximum");
});

/* ------------------------------------------------------------------ */
test("options : primes imposables, avantages en nature, indemnités non imposables", () => {
  const base = C.calculerDepuisBrut({ montant: 2000, periode: "mensuel" }, P).annuel;
  const r = C.calculerDepuisBrut(
    { montant: 1700, primesImposables: 200, avantagesNature: 100, indemnitesNonImposables: 50, periode: "mensuel" }, P
  ).annuel;
  // même brut soumis (2 000) → mêmes retenues
  proche(r.retenues, base.retenues, "retenues identiques");
  // net à payer : sans l'avantage en nature (non versé), avec l'indemnité
  proche(r.netAPayer, base.netAPayer - 1200 + 600, "net à payer");
  proche(r.coutEmployeur, base.coutEmployeur + 600, "coût employeur");
});

test("coût employeur : CNSS 17,07 % + AT + TFP + FOPROLOS", () => {
  const r = C.calculerDepuisBrut({ montant: 1000, periode: "mensuel", tauxAccidentTravail: 0.01 }, P).annuel;
  // 12 000 × (17,07 % + 1 % + 2 % + 1 %) = 12 000 × 21,07 %
  proche(r.chargesPatronales, 12000 * 0.2107, "charges patronales");
  const ind = C.calculerDepuisBrut({ montant: 1000, periode: "mensuel", tauxAccidentTravail: 0.01, industrieManufacturiere: true }, P).annuel;
  proche(ind.chargesPatronales, 12000 * 0.2007, "TFP réduite à 1 % (17,07 + 1 + 1 + 1)");
});

/* ------------------------------------------------------------------ */
test("secteur public (CNRPS) : 2 500 DT/mois, chef de famille, 2 enfants", () => {
  const r = C.calculerDepuisBrut(
    { montant: 2500, periode: "mensuel", secteur: "public", chefDeFamille: true, enfants: 2 }, P
  );
  const a = r.annuel;
  assert.equal(r.regime.caisse, "CNRPS");
  // 30 000 × 12,95 % = 3 885 ; après cotisations 26 115 ; frais plafonnés 2 000
  proche(a.cotisations, 3885, "cotisations CNRPS");
  proche(a.fraisProfessionnels, 2000, "frais professionnels");
  // imposable 24 115 − 500 = 23 615 ; IRPP 750 + 2 500 + 3 615 × 30 % = 4 334,5
  proche(a.revenuImposable, 23615, "revenu imposable");
  proche(a.irpp, 4334.5, "IRPP");
  proche(a.css, 118.075, "CSS");
  proche(a.salaireNet, 21662.425, "net annuel");
  // même brut, net inférieur au privé (22 344,22)
  assert.ok(a.salaireNet < 22344.22);
});

test("secteur public : coût employeur sans TFP ni accidents du travail", () => {
  const a = C.calculerDepuisBrut({ montant: 2500, periode: "mensuel", secteur: "public" }, P).annuel;
  // 30 000 × (14,5 % + 4 %) + FOPROLOS 1 % = 5 550 + 300
  proche(a.chargesPatronales, 5850, "charges patronales");
  const codes = a.chargesPatronalesLignes.map((l) => l.code);
  assert.ok(!codes.includes("tfp") && !codes.includes("accident_travail"));
});

test("primes non soumises à cotisation : imposables mais hors assiette CNRPS", () => {
  const a = C.calculerDepuisBrut(
    { montant: 2000, primesNonCotisables: 500, periode: "mensuel", secteur: "public" }, P
  ).annuel;
  proche(a.brutTotal, 30000, "brut total");
  proche(a.assietteCotisations, 24000, "assiette des cotisations");
  proche(a.cotisations, 24000 * 0.1295, "cotisations sur l'assiette seulement");
});

test("secteur inconnu → secteur privé par défaut", () => {
  const r = C.calculerDepuisBrut({ montant: 1000, periode: "mensuel", secteur: "xyz" }, P);
  assert.equal(r.secteur, "prive");
  assert.equal(r.regime.caisse, "CNSS");
});

/* ------------------------------------------------------------------ */
test("net → brut : cas typique, vérification du net recalculé", () => {
  const r = C.calculerDepuisNet({ montant: 1862.018333, periode: "mensuel", chefDeFamille: true, enfants: 2 }, P);
  assert.equal(r.verifie, true);
  proche(r.brut, 2500, "brut retrouvé", 0.001);
  proche(r.netRecalcule, 1862.018333, "net recalculé");
});

test("net → brut : net demandé inférieur à ce que donnent les seules primes", () => {
  const r = C.calculerDepuisNet({ montant: 100, periode: "mensuel", primesImposables: 1000 }, P);
  assert.equal(r.brut, 0);
  assert.equal(r.verifie, false);
  assert.ok(r.message);
});

test("aller-retour brut → net → brut sur 1 600 cas (privé et public)", () => {
  const profils = [
    {},
    { chefDeFamille: true },
    { chefDeFamille: true, enfants: 2 },
    { chefDeFamille: true, enfants: 3, etudiants: 1, handicapes: 1, parents: 2 },
    { primesImposables: 150, avantagesNature: 80, indemnitesNonImposables: 40 },
    { periode: "annuel", chefDeFamille: true, enfants: 1 },
    { secteur: "public" },
    { secteur: "public", chefDeFamille: true, enfants: 2, primesNonCotisables: 120, parents: 1 }
  ];
  let ecartMax = 0;
  let cas = 0;
  for (const profil of profils) {
    const annuel = profil.periode === "annuel";
    for (let i = 0; i < 200; i++) {
      // de 300 à ~60 000 DT/mois, progression géométrique
      const mensuel = 300 * Math.pow(200, i / 199);
      const montant = annuel ? mensuel * 12 : mensuel;
      const entree = Object.assign({ periode: "mensuel" }, profil, { montant });
      const direct = C.calculerDepuisBrut(entree, P);
      const net = direct.annuel.netAPayer / direct.entree.facteur;
      const inverse = C.calculerDepuisNet(Object.assign({}, entree, { montant: net }), P);

      assert.equal(inverse.verifie, true, `net non retrouvé pour ${montant}`);
      ecartMax = Math.max(ecartMax, Math.abs(inverse.ecart));

      if (Math.abs(inverse.brut - montant) > 0.001) {
        // Seule exception admise : deux bruts donnent le même net de part et
        // d'autre du seuil de dispense de CSS (petit saut du net).
        const ri1 = direct.annuel.revenuImposable;
        const ri2 = inverse.resultat.annuel.revenuImposable;
        const seuil = P.css.seuilDispense;
        assert.ok((ri1 - seuil) * (ri2 - seuil) <= 0,
          `brut différent hors zone du seuil CSS : ${montant} → ${inverse.brut}`);
      }
      cas++;
    }
  }
  assert.equal(cas, 1600);
  assert.ok(ecartMax <= TOL, `écart maximal ${ecartMax}`);
});

test("net → brut : autour du seuil de dispense de CSS, le net cible est toujours atteint", () => {
  // Balayage fin des nets mensuels entre 440 et 520 DT
  for (const secteur of ["prive", "public"]) {
    for (let net = 440; net <= 520; net += 0.25) {
      const r = C.calculerDepuisNet({ montant: net, periode: "mensuel", secteur }, P);
      assert.equal(r.verifie, true, `${secteur} net ${net}`);
    }
  }
});

/* ---------- Cas réel : 4 000 DT brut × 17 salaires, chef de famille, secteur privé ---------- */
test("4 000 DT × 17 : impôt sur le revenu annuel cumulé, mois habituel et mois de prime", () => {
  const e = { montant: 4000, periode: "mensuel", nombreSalaires: 17, secteur: "prive", chefDeFamille: true };
  const av = C.calculerAvecVersements(e, P), a = av.annee.annuel, m = av.moisType.annuel;
  /* Année : brut 68 000 ; CNSS 9,68 % = 6 582,4 ; frais pro plafonnés 2 000 ; chef de famille 300 → imposable 59 117,6 */
  proche(a.brutTotal, 68000, "brut annuel");
  proche(a.cotisations, 6582.4, "CNSS salariale");
  proche(a.revenuImposable, 59117.6, "revenu imposable");
  /* Barème : 0 + 750 + 2 500 + 3 000 + 3 300 + 3 600 + 38 % × 9 117,6 = 16 614,688 */
  proche(a.irpp, 16614.688, "IRPP annuel");
  assert.equal(av.annee.indicateurs.tauxMarginalIrpp, 0.38);
  /* Part de l'impôt sur 100 DT de brut, sur l'année : 24,43 DT (et non la part d'un mois habituel, plus faible) */
  proche(a.irpp / a.brutTotal * 100, 24.4334, "IRPP pour 100 DT", 0.001);
  assert.ok(m.irpp / m.brutTotal < a.irpp / a.brutTotal, "un mois habituel supporte moins d'impôt que la moyenne de l'année");
  /* Les mois de prime supportent le supplément d'impôt de l'année */
  const impotSupp = (a.irpp + a.css - m.irpp - m.css) / 5;
  assert.ok(impotSupp > (m.irpp + m.css) / 12, "impôt plus élevé les mois de prime");
  proche(av.versements.netMensuel * 12 + av.versements.netSupplementaire * 5, a.netAPayer, "net annuel = 12 mois + 5 versements", 0.01);
});

test("Coût employeur : charges légales, fiche habituelle et autres charges de l'entreprise", () => {
  const base = { montant: 4000, periode: "mensuel", nombreSalaires: 17, secteur: "prive", chefDeFamille: true };
  const av = C.calculerAvecVersements(base, P);
  /* 16,57 + 0,5 + 0,5 (AT) + 2 (TFP) + 1 (FOPROLOS) = 20,57 % du brut */
  proche(av.annee.annuel.chargesPatronales, 68000 * 0.2057, "charges patronales annuelles");
  proche(av.annee.annuel.coutEmployeur, 81987.6, "coût employeur annuel");
  proche(av.moisType.annuel.coutEmployeur / 12, 4822.8, "coût d'une fiche de paie habituelle");
  /* Assurance groupe 3 % du brut + retraite complémentaire 50 DT par mois (12 mois) */
  const avec = C.calculerAvecVersements(Object.assign({}, base, { autresChargesPct: 3, autresChargesMontant: 50 }), P);
  const autres = avec.annee.annuel.chargesPatronalesLignes.find((l) => l.code === "autres");
  proche(autres.montant, 68000 * 0.03 + 600, "autres charges annuelles");
  proche(avec.annee.annuel.coutEmployeur, 81987.6 + 2640, "coût employeur avec autres charges");
  proche(avec.annee.annuel.netAPayer, av.annee.annuel.netAPayer, "le net du salarié ne change pas");
  const rep = C.repartitionCoutEmployeur(avec.annee);
  proche(rep.caisse.dontComplementaire, 2640, "protection complémentaire dans la répartition");
  proche(rep.salarie.part + rep.caisse.part + rep.etat.part, 1, "répartition complète", 1e-9);
});
