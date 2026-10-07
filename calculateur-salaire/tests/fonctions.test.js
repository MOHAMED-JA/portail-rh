/*
 * Tests des fonctions avancées : augmentation, courbe net/brut,
 * répartition d'un dinar de coût employeur, lien de partage.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../config/parametres.js");
const C = require("../js/calcul.js");
const E = require("../js/etat.js");

const TOL = 0.0005;
function proche(reel, attendu, message, tolerance = TOL) {
  assert.ok(Math.abs(reel - attendu) <= tolerance, `${message} : obtenu ${reel}, attendu ${attendu}`);
}

const TYPE = { montant: 2500, periode: "mensuel", chefDeFamille: true, enfants: 2 };

/* ---------------- Répartition d'un dinar ---------------- */
test("1 dinar de coût employeur : salarié + caisse + État = 1", () => {
  for (const secteur of ["prive", "public"]) {
    const r = C.calculerDepuisBrut({ ...TYPE, secteur, indemnitesNonImposables: 50, avantagesNature: 80 }, P);
    const d = C.repartitionCoutEmployeur(r);
    proche(d.salarie.part + d.caisse.part + d.etat.part, 1, `somme des parts (${secteur})`);
    proche(d.salarie.montant + d.caisse.montant + d.etat.montant, d.total, `somme des montants (${secteur})`);
  }
});

test("1 dinar de coût employeur : cas typique privé détaillé", () => {
  const d = C.repartitionCoutEmployeur(C.calculerDepuisBrut(TYPE, P));
  // coût 36 171 ; salarié 22 344,22 ; caisse 2 904 + 4 971 + 150 + 150 ; État 4 628,8 + 122,98 + 600 + 300
  proche(d.total, 36171, "coût total");
  proche(d.salarie.montant, 22344.22, "salarié");
  proche(d.caisse.montant, 8175, "caisse");
  proche(d.etat.montant, 5651.78, "État");
});

test("1 dinar de coût employeur : salaire nul → parts nulles", () => {
  const d = C.repartitionCoutEmployeur(C.calculerDepuisBrut({ montant: 0 }, P));
  assert.equal(d.salarie.part, 0);
});

/* ---------------- Courbe ---------------- */
test("courbe net/brut : croissante hors seuil CSS, bornes et taux marginal", () => {
  const pts = C.courbeNetBrut({ periode: "mensuel" }, P, { min: 0, max: 10000, points: 201 });
  assert.equal(pts.length, 201);
  assert.equal(pts[0].net, 0);
  proche(pts[200].brut, 10000, "borne haute");
  let baisses = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].net < pts[i - 1].net) baisses++;
  assert.ok(baisses <= 1, "au plus une baisse (seuil de la CSS)");
  assert.equal(pts[200].tauxMarginal, 0.40);
  // chaque point correspond au calcul direct
  const direct = C.calculerDepuisBrut({ periode: "mensuel", montant: pts[50].brut }, P);
  proche(pts[50].net, direct.annuel.netAPayer / 12, "point = calcul direct");
});

/* ---------------- Augmentation ---------------- */
test("augmentation en net : +100 DT net/mois atteints exactement", () => {
  const a = C.simulerAugmentation(TYPE, P, { mode: "net", valeur: 100 });
  assert.equal(a.verifie, true);
  proche(a.hausseNet, 100, "hausse du net", 0.001);
  // tranche à 30 % : il faut environ 159,3 DT de brut et 192,1 DT de coût employeur
  proche(a.hausseBrut, 159.306, "hausse du brut", 0.01);
  proche(a.hausseCout, 192.075, "hausse du coût", 0.01);
  proche(a.coutParDinarNet, a.hausseCout / a.hausseNet, "coût par dinar net");
});

test("augmentation en brut et en pourcentage : cohérence", () => {
  const b = C.simulerAugmentation(TYPE, P, { mode: "brut", valeur: 250 });
  const p = C.simulerAugmentation(TYPE, P, { mode: "pourcent", valeur: 10 });
  proche(b.hausseBrut, 250, "brut +250");
  proche(p.hausseBrut, 250, "10 % de 2 500");
  proche(b.hausseNet, p.hausseNet, "même hausse nette");
  proche(b.salaireBaseApres, 2750, "nouveau salaire de base");
  assert.ok(b.partNetDeLaHausseBrute > 0.5 && b.partNetDeLaHausseBrute < 0.7);
});

test("augmentation : valeur nulle → aucune hausse", () => {
  const a = C.simulerAugmentation(TYPE, P, { mode: "brut", valeur: 0 });
  proche(a.hausseNet, 0, "hausse nette");
  assert.equal(a.coutParDinarNet, 0);
});

test("augmentation : secteur public et saisie annuelle", () => {
  const a = C.simulerAugmentation({ ...TYPE, secteur: "public", periode: "annuel", montant: 30000 }, P, { mode: "net", valeur: 1200 });
  assert.equal(a.verifie, true);
  proche(a.hausseNet, 1200, "hausse nette annuelle", 0.001);
});

/* ---------------- Lien de partage ---------------- */
test("lien de partage : aller-retour d'un état complet", () => {
  const etat = {
    ...E.etatParDefaut(),
    sens: "net", secteur: "public", periode: "annuel", montant: 30000.5,
    chefDeFamille: true, enfants: 2, etudiants: 1, handicapes: 1, parents: 2,
    primesImposables: 120, primesNonCotisables: 40.25, avantagesNature: 80,
    indemnitesNonImposables: 30, tauxAccidentTravailPct: 1.5, industrieManufacturiere: true
  };
  const lien = E.encoder(etat);
  const lu = E.decoder("?" + lien);
  assert.deepEqual(lu.a, etat);
  assert.equal(lu.b, null);
});

test("lien de partage : seules les valeurs utiles sont écrites", () => {
  assert.equal(E.encoder(E.etatParDefaut()), "m=2500");
});

test("lien de partage : deux scénarios (comparateur)", () => {
  const a = { ...E.etatParDefaut(), montant: 2000 };
  const b = { ...E.etatParDefaut(), montant: 2000, secteur: "public" };
  const lu = E.decoder(E.encoder(a, b));
  assert.deepEqual(lu.a, a);
  assert.deepEqual(lu.b, b);
});

test("lien de partage : valeurs invalides ignorées, plafonds respectés", () => {
  const lu = E.decoder("m=abc&sec=lune&enf=99&par=7&chef=1&at=-3");
  assert.equal(lu.a.montant, 2500);
  assert.equal(lu.a.secteur, "prive");
  assert.equal(lu.a.enfants, 15);
  assert.equal(lu.a.parents, 2);
  assert.equal(lu.a.chefDeFamille, true);
  assert.equal(lu.a.tauxAccidentTravailPct, null);
  assert.equal(E.decoder("").a, null);
  assert.equal(E.decoder("x=1").a, null);
});

test("lien de partage : l'état décodé donne le même calcul", () => {
  const etat = { ...E.etatParDefaut(), montant: 3200, chefDeFamille: true, enfants: 3 };
  const r1 = C.calculerDepuisBrut(E.versEntree(etat), P);
  const r2 = C.calculerDepuisBrut(E.versEntree(E.decoder(E.encoder(etat)).a), P);
  proche(r1.annuel.netAPayer, r2.annuel.netAPayer, "net identique");
});

/* ---------------- Nombre de salaires par an ---------------- */
test("13 salaires : base annuelle = mensuel × 13, primes mensuelles × 12", () => {
  const r = C.calculerDepuisBrut({ ...TYPE, nombreSalaires: 13, primesImposables: 100 }, P);
  proche(r.annuel.salaireBase, 2500 * 13, "salaire de base annuel");
  proche(r.annuel.primesImposables, 1200, "primes mensuelles sur 12 mois");
  assert.equal(r.entree.nombreSalaires, 13);
});

test("13 salaires : le mois type est inchangé, le 13e mois supporte le complément d'impôt", () => {
  const v12 = C.calculerAvecVersements(TYPE, P);
  const v13 = C.calculerAvecVersements({ ...TYPE, nombreSalaires: 13 }, P);
  proche(v13.versements.netMensuel, v12.versements.netMensuel, "net du mois type");
  proche(v13.versements.netMensuel, 1862.018333, "net mensuel (cas typique)", 0.001);
  assert.equal(v13.versements.supplementaires, 1);
  proche(v13.versements.brutSupplementaire, 2500, "brut du 13e mois");
  // 13e mois : 2 500 brut − 9,68 % − impôt marginal (30 % + 0,5 %) sur la base après cotisations
  // (frais professionnels déjà plafonnés) : 2 500 × 0,9032 × (1 − 0,305) = 1 569,31
  proche(v13.versements.netSupplementaire, 2500 * 0.9032 * (1 - 0.305), "net du 13e mois", 0.01);
  proche(v13.versements.netAnnuel, 12 * v13.versements.netMensuel + v13.versements.netSupplementaire, "net annuel");
  assert.ok(v13.annee.annuel.irpp > v12.annee.annuel.irpp, "impôt annuel plus élevé");
});

test("15 salaires et saisie annuelle : le montant annuel couvre les 15 versements", () => {
  const m = C.calculerDepuisBrut({ ...TYPE, nombreSalaires: 15 }, P);
  const a = C.calculerDepuisBrut({ ...TYPE, periode: "annuel", montant: 2500 * 15, nombreSalaires: 15 }, P);
  proche(a.annuel.netAPayer, m.annuel.netAPayer, "même année");
  const v = C.calculerAvecVersements({ ...TYPE, periode: "annuel", montant: 37500, nombreSalaires: 15 }, P);
  proche(v.versements.brutSupplementaire, 2500, "versement = mensuel");
  proche(v.versements.netMensuel, 1862.018333, "mois type", 0.001);
  assert.equal(v.versements.supplementaires, 3);
});

test("17 et 18 salaires : les versements supplémentaires sont inclus dans la base annuelle", () => {
  for (const nombreSalaires of [17, 18]) {
    const r = C.calculerDepuisBrut({ ...TYPE, nombreSalaires }, P);
    assert.equal(r.entree.nombreSalaires, nombreSalaires);
    proche(r.annuel.salaireBase, 2500 * nombreSalaires, `${nombreSalaires} versements annuels`);
  }
});

test("18 salaires : mois type inchangé et six versements supplémentaires dans le revenu annuel", () => {
  const mensuel = C.calculerAvecVersements({ ...TYPE, nombreSalaires: 18 }, P);
  const annuel = C.calculerAvecVersements({ ...TYPE, periode: "annuel", montant: 45000, nombreSalaires: 18 }, P);
  proche(mensuel.versements.netMensuel, 1862.018333, "net du mois type", 0.001);
  assert.equal(mensuel.versements.supplementaires, 6);
  proche(mensuel.versements.brutSupplementaire, 2500, "brut de chaque versement supplémentaire");
  // 45 000 brut − 4 356 cotisations − 8 937,52 IRPP − 190,72 CSS.
  proche(mensuel.versements.netAnnuel, 31515.76, "net annuel sur 18 salaires");
  proche(mensuel.versements.netAnnuel,
    12 * mensuel.versements.netMensuel + 6 * mensuel.versements.netSupplementaire,
    "les six versements reconstituent le revenu annuel");
  proche(annuel.versements.netAnnuel, mensuel.versements.netAnnuel, "même revenu en saisie annuelle");
  proche(annuel.versements.netMensuel, mensuel.versements.netMensuel, "même mois type en saisie annuelle");
});

test("nombre de salaires hors bornes ramené entre 12 et 18", () => {
  assert.equal(C.calculerDepuisBrut({ ...TYPE, nombreSalaires: 7 }, P).entree.nombreSalaires, 12);
  for (const nombreSalaires of [19, 40]) {
    const r = C.calculerDepuisBrut({ ...TYPE, nombreSalaires }, P);
    assert.equal(r.entree.nombreSalaires, 18);
    proche(r.annuel.salaireBase, 45000, "base annuelle plafonnée à 18 versements");
  }
  assert.equal(C.calculerDepuisBrut({ ...TYPE }, P).entree.nombreSalaires, 12);
});

test("net → brut avec 13 salaires : le net mensuel visé donne le même salaire de base", () => {
  const inv = C.calculerDepuisNet({ ...TYPE, montant: 1862.018333, nombreSalaires: 13 }, P);
  assert.equal(inv.verifie, true);
  proche(inv.brut, 2500, "salaire de base", 0.001);
  assert.equal(inv.resultat.entree.nombreSalaires, 13);
  proche(inv.resultat.annuel.salaireBase, 2500 * 13, "année sur 13 salaires", 0.02);
});

test("net → brut annuel avec 14 salaires : aller-retour exact", () => {
  const direct = C.calculerDepuisBrut({ ...TYPE, periode: "annuel", montant: 42000, nombreSalaires: 14 }, P);
  const inv = C.calculerDepuisNet({ ...TYPE, periode: "annuel", montant: direct.annuel.netAPayer, nombreSalaires: 14 }, P);
  assert.equal(inv.verifie, true);
  proche(inv.brut, 42000, "brut annuel retrouvé", 0.01);
});

test("net → brut avec 18 salaires : salaire mensuel et brut annuel retrouvés", () => {
  const mensuel = C.calculerDepuisNet({ ...TYPE, montant: 1862.018333, nombreSalaires: 18 }, P);
  assert.equal(mensuel.verifie, true);
  proche(mensuel.brut, 2500, "salaire de base mensuel", 0.001);
  assert.equal(mensuel.resultat.entree.nombreSalaires, 18);
  proche(mensuel.resultat.annuel.salaireBase, 45000, "base annuelle sur 18 salaires", 0.02);

  const annuel = C.calculerDepuisNet({ ...TYPE, periode: "annuel", montant: 31515.76, nombreSalaires: 18 }, P);
  assert.equal(annuel.verifie, true);
  proche(annuel.brut, 45000, "brut annuel retrouvé", 0.01);
  assert.equal(annuel.resultat.entree.nombreSalaires, 18);
});

test("augmentation avec 13 salaires : effet sur le mois type et sur l'année", () => {
  const a = C.simulerAugmentation({ ...TYPE, nombreSalaires: 13 }, P, { mode: "net", valeur: 100 });
  proche(a.hausseNet, 100, "hausse du net mensuel", 0.001);
  assert.equal(a.nombreSalaires, 13);
  assert.ok(a.hausseNetAnnuelle > 1200, "le 13e mois augmente aussi");
  proche(a.hausseBrut * 13, a.apres.annuel.salaireBase * 13 / 12 - a.avant.annuel.salaireBase * 13 / 12, "cohérence", 0.01);
});

test("lien de partage : nombre de salaires conservé et borné", () => {
  const etat = { ...E.etatParDefaut(), nombreSalaires: 13 };
  assert.equal(E.encoder(etat), "m=2500&ns=13");
  assert.equal(E.decoder("ns=13").a.nombreSalaires, 13);
  assert.equal(E.decoder("ns=3").a.nombreSalaires, 12);
  assert.equal(E.decoder("ns=17").a.nombreSalaires, 17);
  assert.equal(E.decoder("ns=18").a.nombreSalaires, 18);
  assert.equal(E.decoder("ns=19").a.nombreSalaires, 18);
  assert.equal(E.decoder("ns=99").a.nombreSalaires, 18);
  assert.equal(E.versEntree(E.decoder("ns=14").a).nombreSalaires, 14);
});

test("lien de partage : 18 salaires conservés dans les deux scénarios et leur calcul", () => {
  const a = { ...E.etatParDefaut(), montant: 2500, nombreSalaires: 18 };
  const b = { ...a, montant: 3000, secteur: "public" };
  const lu = E.decoder(E.encoder(a, b));
  assert.deepEqual(lu.a, a);
  assert.deepEqual(lu.b, b);
  proche(C.calculerDepuisBrut(E.versEntree(lu.a), P).annuel.salaireBase, 45000, "scénario A sur 18 salaires");
  proche(C.calculerDepuisBrut(E.versEntree(lu.b), P).annuel.salaireBase, 54000, "scénario B sur 18 salaires");
});

