// Capture des écrans réels du Portail RH (serveur local à date fixe), joués comme une seule histoire.
// Sortie : cap/<etat>.png (+ boites.json : rectangles des éléments, en px CSS du viewport)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const D = '/home/user/deps/node_modules/';
const FAM = { inter: 'Inter', 'league-spartan': 'League Spartan', 'ibm-plex-mono': 'IBM Plex Mono' };
const fontCss = Object.keys(FAM).map(f => [400, 500, 600, 700].map(w => { const p = `${D}@fontsource/${f}/files/${f}-latin-${w}-normal.woff2`;
  return fs.existsSync(p) ? `@font-face{font-family:'${FAM[f]}';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')})}` : ''; }).join('')).join('');
const MAT = { Utilisateur: 'VT0010', 'Supérieur hiérarchique': 'VT0003', 'Administrateur RH': 'VT0002' };
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const boites = fs.existsSync('cap/boites.json') ? JSON.parse(fs.readFileSync('cap/boites.json')) : {};
const b = await chromium.launch({ channel: 'chromium', args: ['--lang=fr-FR'], env: { ...process.env, LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr' } });
const errs = [];
async function ctx(kind) {
  const mob = kind === 'mobile';
  const c = await b.newContext({ viewport: mob ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: mob ? 3 : 2,
    locale: 'fr-FR', timezoneId: 'Europe/Paris', isMobile: mob, hasTouch: mob });
  await c.clock.install({ time: new Date('2026-10-06T08:25:00+02:00') });
  await c.route(/cdnjs\.cloudflare\.com.*chart/, r => r.fulfill({ path: D + 'chart.js/dist/chart.umd.js', contentType: 'application/javascript' }));
  await c.route(/fonts\.googleapis\.com/, r => r.fulfill({ body: fontCss, contentType: 'text/css' }));
  await c.route(/fonts\.gstatic\.com/, r => r.abort());
  const p = await c.newPage();
  p.on('pageerror', e => errs.push(kind + ': ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(kind + ': ' + m.text()));
  await p.goto('http://127.0.0.1:8100/'); await p.waitForTimeout(1200);
  return p;
}
const clean = p => p.evaluate(() => { document.querySelectorAll('.toasts > *').forEach(e => e.remove()); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
async function login(p, prof) {
  await p.click('text=' + prof); await p.waitForTimeout(300);
  await p.fill('input[placeholder*=matricule]', MAT[prof]); await p.fill('input[type=password]', 'demo2026');
  await p.click('button:has-text("Se connecter")'); await p.waitForTimeout(2500); await clean(p);
}
async function logout(p) { await clean(p); await p.locator('text=Déconnexion >> visible=true').first().click(); await p.waitForTimeout(1500); }
async function nav(p, t) { await p.locator('nav >> text="' + t + '"').first().click(); await p.waitForTimeout(2200); await clean(p); }
async function box(p, sel) { const l = typeof sel === 'string' ? p.locator(sel).first() : sel; const r = await l.boundingBox({ timeout: 2000 }).catch(() => null); return r && { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }
async function shot(p, name, sels = {}) {
  if (ONLY && !ONLY.some(o => name.startsWith(o))) { /* on rejoue l'histoire sans réécrire */ }
  await p.screenshot({ path: `cap/${name}.png` });
  boites[name] = {}; for (const [k, s] of Object.entries(sels)) boites[name][k] = await box(p, s);
  fs.writeFileSync('cap/boites.json', JSON.stringify(boites, null, 1)); console.log('ok', name);
}
const typeSlow = async (l, txt) => { await l.fill(''); await l.type(txt, { delay: 5 }); };

// ---------- 1. Collaborateur sur téléphone : demande de congé ----------
const m = await ctx('mobile');
await login(m, 'Utilisateur');
await m.waitForTimeout(1200);
const bConge = m.locator('button >> visible=true', { hasText: /^\s*Congé\s*$/ }).first();
await shot(m, 'm1-dash', { conge: bConge });
const carteConge = m.locator('text=Demander un congé >> visible=true').first();
await carteConge.evaluate(e => e.scrollIntoView({ block: 'center' })); await m.waitForTimeout(700);
await shot(m, 'm1-dash2', { carte: carteConge });
await carteConge.click(); await m.waitForSelector('#d-debut', { timeout: 10000 }).catch(() => console.log('PAS DE TIROIR')); await m.waitForTimeout(900);
await shot(m, 'm1-form0', { debut: '#d-debut', fin: '#d-fin', simu: '#d-simulation', soumettre: '#soumettre-demande' });
await m.fill('#d-debut', '2026-10-26'); await m.dispatchEvent('#d-debut', 'change'); await m.waitForTimeout(250); await clean(m);
await shot(m, 'm1-form1', { debut: '#d-debut', fin: '#d-fin', simu: '#d-simulation' });
await m.fill('#d-fin', '2026-10-30'); await m.dispatchEvent('#d-fin', 'change'); await m.waitForTimeout(400); await clean(m);
await shot(m, 'm1-form2', { debut: '#d-debut', fin: '#d-fin', simu: '#d-simulation', jours: '#d-simulation strong', apres: '#d-simulation div[style*="text-align:right"] strong' });
await m.evaluate(() => document.querySelector('.tiroir-corps').scrollTop = 1e4); await m.waitForTimeout(300);
await shot(m, 'm1-form3', { simu: '#d-simulation', com: '#d-commentaire', soumettre: '#soumettre-demande' });
await m.fill('#d-commentaire', 'Vacances en famille.'); await m.waitForTimeout(200); await clean(m);
await shot(m, 'm1-form4', { com: '#d-commentaire', soumettre: '#soumettre-demande' });
await m.click('#soumettre-demande'); await m.waitForTimeout(1600);
await shot(m, 'm1-envoye', { toast: '#toasts > * >> nth=0' });
console.log('toast:', await m.evaluate(() => document.querySelector('#toasts').innerText));
await clean(m);

// ---------- 2. Manager sur ordinateur : validation ----------
const d = await ctx('desktop');
await login(d, 'Supérieur hiérarchique');
await nav(d, 'À valider');
const tabConges = d.locator('main button:has-text("Congés")').first(); if (await tabConges.count()) { await tabConges.click(); await d.waitForTimeout(600); }
const carte = d.locator('main .carte:has-text("Vacances en famille"), main article:has-text("Vacances en famille"), main li:has-text("Vacances en famille")').last();
await carte.scrollIntoViewIfNeeded(); await d.waitForTimeout(400);
console.log('carte html classes:', await carte.evaluate(e => e.className));
await shot(d, 'd2-liste', { carte, approuver: carte.locator('button:has-text("Approuver")') });
await carte.locator('button:has-text("Approuver")').click(); await d.waitForTimeout(1200);
await d.waitForTimeout(200); await d.evaluate(() => document.activeElement && document.activeElement.blur());
await shot(d, 'd2-approuve', { toast: '#toasts > * >> nth=0', carteRestante: 'main .inbox-item >> nth=0' });
console.log('toast2:', await d.evaluate(() => document.querySelector('#toasts').innerText));
await logout(d);

// ---------- 3. Collaborateur : statut de la demande ----------
await m.locator('.barre-mobile button:has-text("Tableau"), nav button:has-text("Tableau") >> visible=true').first().click().catch(e => console.log('pas tableau')); await m.waitForTimeout(1500);
await m.locator('.barre-mobile button:has-text("Mes"), nav button:has-text("Mes") >> visible=true').last().click().catch(e => console.log('pas mes')); await m.waitForTimeout(2000); await clean(m);
await m.locator('nav button:has-text("Tableau") >> visible=true').first().click().catch(e => console.log('pas tableau')); await m.waitForTimeout(2000); await clean(m);
await shot(m, 'm3-dash', { solde: 'text=SOLDE 2026 >> visible=true', cloche: 'button[data-action=notifications] >> visible=true' });
await m.locator('button[data-action=notifications] >> visible=true').first().click().catch(e => console.log('pas cloche')); await m.waitForTimeout(1000);
await shot(m, 'm3-notif', {});
console.log('notif:', (await m.evaluate(() => document.querySelector('#couche').innerText)).slice(0, 600));
await m.keyboard.press('Escape'); await m.waitForTimeout(400); await clean(m);

// ---------- 4. Présences (collaborateur, ordinateur) ----------
await login(d, 'Utilisateur');
await nav(d, 'Présences');
const badger = d.locator('main button:has-text("Badger") >> visible=true').first();
await shot(d, 'd4-pointages', { badger, tableau: 'main table' });
await badger.click(); await d.waitForTimeout(1500);
await shot(d, 'd4-badge', { toast: '#toasts > * >> nth=0', badger: 'main button:has-text("Badger") >> visible=true' });
console.log('badge:', (await d.evaluate(() => document.querySelector('#toasts').innerText + '\n' + document.querySelector('main').innerText)).slice(0, 500));
await clean(d);
await d.locator('main button:has-text("Vue mensuelle")').first().click(); await d.waitForTimeout(1500);
await shot(d, 'd4-mois', {});
await d.locator('main button:has-text("Anomalies")').first().click(); await d.waitForTimeout(1500);
await shot(d, 'd4-anomalies', {});

// ---------- 5. Fiche d'objectifs (collaborateur) ----------
await nav(d, "Fiche d'objectifs");
await d.click('#obj-ajouter'); await d.click('#obj-ajouter'); await d.waitForTimeout(300);
const O = [['Livrer le nouveau portail client', 'Mise en production avant fin juin, sans incident bloquant.', 'Date de mise en production', 40],
  ['Automatiser les tests de non-régression', 'Couvrir les parcours critiques par des tests automatisés.', 'Taux de couverture ≥ 80 %', 35],
  ['Former deux collègues aux outils DevOps', 'Transmettre les pratiques de déploiement continu.', 'Sessions réalisées', 25]];
const I = d.locator('main input[placeholder="Intitulé de l\'objectif"]'), DS = d.locator('main textarea'), M = d.locator('main input[placeholder^="Indicateur"]'), W = d.locator('main input.num');
for (let k = 0; k < 3; k++) { await W.nth(k).fill('0'); await W.nth(k).dispatchEvent('input'); }
await clean(d); await d.evaluate(() => window.scrollTo(0, 0));
await shot(d, 'd5-obj0', { total: 'text=Total des pondérations', o1: I.nth(0), o2: I.nth(1), o3: I.nth(2) });
for (let k = 0; k < 3; k++) {
  await I.nth(k).fill(O[k][0]); await DS.nth(k).fill(O[k][1]); await M.nth(k).fill(O[k][2]);
  await W.nth(k).fill(String(O[k][3])); await W.nth(k).dispatchEvent('input'); await W.nth(k).dispatchEvent('change'); await clean(d); await d.waitForTimeout(300);
  await shot(d, 'd5-obj' + (k + 1), { o: I.nth(k), w: W.nth(k), total: 'text=Total des pondérations', soumettre: '#obj-soumettre' });
}
await d.locator('#obj-soumettre').scrollIntoViewIfNeeded(); await d.waitForTimeout(300);
await shot(d, 'd5-obj-bas', { total: 'text=Total des pondérations', soumettre: '#obj-soumettre' });
await d.click('#obj-soumettre'); await d.waitForTimeout(1200);
const c5 = d.locator('#couche button.primaire >> visible=true'); if (await c5.count()) { await c5.first().click(); await d.waitForTimeout(1200); }
await shot(d, 'd5-soumise', { toast: '#toasts > * >> nth=0' });
await logout(d);

// ---------- 6. Manager : validation des objectifs puis évaluation ----------
await login(d, 'Supérieur hiérarchique');
await nav(d, "Fiche d'objectifs");
await d.locator('main button:has-text("Fiches de mon équipe")').first().click().catch(() => {}); await d.waitForTimeout(1200);
await shot(d, 'd6-equipe', { ligne: 'tr:has-text("Julien Garnier")' });
await d.locator('tr:has-text("Julien Garnier") >> text=Ouvrir').first().click(); await d.waitForTimeout(1800);
await d.locator('#obj-valider').scrollIntoViewIfNeeded(); await d.waitForTimeout(300);
await shot(d, 'd6-fiche', { valider: '#obj-valider' });
await d.click('#obj-valider'); await d.waitForTimeout(1000);
await shot(d, 'd6-valider-modal', { confirmer: '#couche button.primaire >> visible=true' });
await d.locator('#couche button.primaire >> visible=true').first().click(); await d.waitForTimeout(1500);
await shot(d, 'd6-validee', { toast: '#toasts > * >> nth=0' });
await nav(d, "Fiche d'évaluation");
await d.locator('main button:has-text("Fiches de mon équipe")').first().click().catch(() => {}); await d.waitForTimeout(800);
const ouv = d.locator('tr:has-text("Julien Garnier") >> text=Ouvrir'); if (await ouv.count()) { await ouv.first().click(); await d.waitForTimeout(1800); }
const N = d.locator('main input.saisie-note');
await N.nth(0).evaluate(e => e.scrollIntoView({ block: 'start' })); await d.evaluate(() => window.scrollBy(0, -140)); await d.waitForTimeout(300);
await shot(d, 'd6-eval0', { n1: N.nth(0), n2: N.nth(1), n3: N.nth(2) });
const notes = [16, 15, 17];
for (let k = 0; k < 3; k++) { await N.nth(k).fill(String(notes[k])); await N.nth(k).dispatchEvent('input'); await N.nth(k).dispatchEvent('change'); await d.waitForTimeout(250); await clean(d);
  await shot(d, 'd6-eval' + (k + 1), { n: N.nth(k) }); }
await d.fill('#eval-appreciation', 'Très bonne année : objectifs atteints et équipe accompagnée.'); await clean(d);
await d.locator('text=Note finale').first().evaluate(e => e.scrollIntoView({ block: 'center' })); await d.waitForTimeout(300);
await shot(d, 'd6-eval-note', {});
console.log('eval:', (await d.evaluate(() => document.querySelector('main').innerText)).slice(0, 1600));
await d.click('#eval-approuver'); await d.waitForTimeout(1000);
const c6 = d.locator('#couche button.primaire >> visible=true'); if (await c6.count()) { await c6.first().click(); await d.waitForTimeout(1500); }
await shot(d, 'd6-eval-approuvee', { toast: '#toasts > * >> nth=0' });
await clean(d);

// ---------- 8. Organigramme ----------
await nav(d, 'Organigramme');
await d.waitForTimeout(800);
const replier = d.locator('main button:has-text("Replier") >> visible=true').first();
await shot(d, 'd8-org', {});
await d.locator('main button:text-is("Replier")').first().click().catch(e => console.log('pas replier')); await d.waitForTimeout(900);
await shot(d, 'd8-org-replie', {});
await d.locator('main button:has-text("Tout déplier")').first().click().catch(e => console.log('pas deplier')); await d.waitForTimeout(1200);
await d.locator('main button:has-text("Ajuster")').first().click().catch(e => console.log('pas ajuster')); await d.waitForTimeout(1200);
await shot(d, 'd8-org-deplie', {});
await logout(d);

// ---------- 9. Assistant RH (collaborateur) ----------
await login(d, 'Utilisateur');
await d.locator('#bouton-assistant').click(); await d.waitForTimeout(1200);
const saisie = d.locator('#assistant-saisie');
await shot(d, 'd9-a0', { saisie, envoyer: '#couche button:has-text("Envoyer")' });
await saisie.fill('Combien de jours de congé me reste-t-il ?'); await d.waitForTimeout(200);
await shot(d, 'd9-a0b', { saisie, envoyer: '#couche button:has-text("Envoyer")' });
await saisie.press('Enter'); await d.waitForTimeout(2200);
await shot(d, 'd9-a1', { saisie });
await saisie.fill('Poser 3 jours la semaine prochaine'); await d.waitForTimeout(200);
await shot(d, 'd9-a1b', { saisie, envoyer: '#couche button:has-text("Envoyer")' });
await saisie.press('Enter'); await d.waitForTimeout(2200);
await shot(d, 'd9-a2', { saisie, ouvrir: '#couche button:has-text("formulaire pré-rempli")' });
console.log('assistant:', (await d.evaluate(() => document.querySelector('#couche').innerText)).slice(-900));
await d.keyboard.press('Escape'); await d.waitForTimeout(500);
await logout(d);

// ---------- 10. Pilotage RH ----------
await login(d, 'Administrateur RH');
await nav(d, 'Tableau de bord équipe'); await d.waitForTimeout(2500);
await shot(d, 'd10-equipe', {});
await d.evaluate(() => window.scrollBy(0, 560)); await d.waitForTimeout(2200);
await shot(d, 'd10-equipe2', {});
await nav(d, 'Prévisions RH'); await d.waitForTimeout(3500);
await shot(d, 'd10-prev', {});
await d.locator('text=Taux de présence prévu').first().evaluate(e => e.scrollIntoView({ block: 'start' })); await d.evaluate(() => window.scrollBy(0, -90)); await d.waitForTimeout(3000);
await shot(d, 'd10-prev2', {});
await d.locator('text=Présence prévue par mois').first().evaluate(e => e.scrollIntoView({ block: 'start' })); await d.evaluate(() => window.scrollBy(0, -90)); await d.waitForTimeout(1500);
await shot(d, 'd10-prev3', {});
await nav(d, 'Indicateurs clés'); await d.waitForTimeout(2000);
await shot(d, 'd10-ind', {});

// ---------- 11. Sécurité ----------
await nav(d, 'Administration');
await d.locator('main button:has-text("Sécurité")').first().click(); await d.waitForTimeout(1800);
await shot(d, 'd11-secu', {});
console.log('secu:', (await d.evaluate(() => document.querySelector('main').innerText)).slice(0, 1500));
await d.locator('main button:has-text("Journal d\'audit")').first().click(); await d.waitForTimeout(1800);
await shot(d, 'd11-audit', {});
console.log('audit:', (await d.evaluate(() => document.querySelector('main').innerText)).slice(0, 1200));
fs.writeFileSync('cap/erreurs.txt', errs.join('\n'));
await b.close();
