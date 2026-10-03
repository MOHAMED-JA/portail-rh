// usage: node render.mjs <url-path> <framesdir> <duration>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [path, out, dur] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const FPS = 30, N = Math.round(FPS * +dur);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8093/' + path); await p.waitForFunction(() => window.__ready);
for (let f = 0; f < N; f++) {
  await p.evaluate(t => render(t), f / FPS);
  await p.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 });
  if (f % 300 === 0) console.log(path, 'frame', f, '/', N);
}
await b.close(); console.log('done', N);
