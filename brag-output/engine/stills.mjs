// usage: node stills.mjs <url-path> <outdir> t1 t2 ...
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [path, out, ...ts] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => m.type() === 'error' && console.log('console', m.text()));
await p.goto('http://localhost:8093/' + path); await p.waitForFunction(() => window.__ready);
for (const t of ts.map(Number)) { await p.evaluate(t => render(t), t); await p.screenshot({ path: `${out}/t${t.toFixed(2).padStart(6, '0')}.jpg`, quality: 85 }); }
await b.close();
