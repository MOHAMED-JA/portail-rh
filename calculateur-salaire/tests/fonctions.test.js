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
