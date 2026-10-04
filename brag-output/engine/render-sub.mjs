// usage: node render-sub.mjs <url-path> <framesdir> <duration> <start> <end> [sub=4]
// Rend des sous-images à 30*sub images/s (s<index>.jpg) pour un flou de mouvement par moyenne temporelle.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [path, out, dur, a, z, sub = 4] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const R = 30 * +sub, N = Math.round(R * +dur);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8093/' + path); await p.waitForFunction(() => window.__ready);
for (let f = +a; f < Math.min(N, +z); f++) {
  await p.evaluate(t => render(t), f / R);
  await p.screenshot({ path: `${out}/s${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
  if (f % 600 === 0) console.log('sub', f, '/', N);
}
await b.close(); console.log('done');
