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
await m.fill('#d-fin', '2026-10-30'); await m.dispatchEvent('#d-fin', 'change'); await m.waitForTimeout(400); await clean(m);
await shot(m, 'm1-form1b', { debut: '#d-debut', fin: '#d-fin', simu: '#d-simulation' });
await m.fill('#d-debut', '2026-10-26'); await m.dispatchEvent('#d-debut', 'change'); await m.waitForTimeout(400); await clean(m);
await shot(m, 'm1-form2b', { debut: '#d-debut', fin: '#d-fin', simu: '#d-simulation' });
await b.close();
