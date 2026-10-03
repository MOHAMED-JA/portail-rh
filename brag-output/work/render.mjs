import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const FPS = 30, DUR = 24.5, N = Math.round(FPS * DUR);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8092/index.html'); await p.waitForFunction(() => window.__ready);
for (let f = 0; f < N; f++) {
  await p.evaluate(t => render(t), f / FPS);
  await p.screenshot({ path: `frames/f${String(f).padStart(4, '0')}.png` });
  if (f % 100 === 0) console.log('frame', f);
}
await b.close();
