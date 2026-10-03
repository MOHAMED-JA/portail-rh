// Shared, deterministic motion engine: every frame is a pure function of t.
(function () {
  const W = 1080, H = 1350;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const p = (t, a, d) => clamp((t - a) / d);
  const eo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const lerp = (a, b, k) => a + (b - a) * k;
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const fr = (v, d = 0) => { const s = v.toFixed(d).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? ',' + s[1] : ''); };
  const dt = (v) => { const s = v.toFixed(3).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1]; };

  // ---- kinetic typography (kinetic-typography skill: mask, char stagger, blur-in) ----
  function lineReveal(root, t, start, stagger = 0.09, dur = 0.75) {
    $$('.line > span', root).forEach((s, i) => {
      const k = eo(p(t, start + i * stagger, dur));
      s.style.transform = `translateY(${(1 - k) * 112}%)`;
    });
  }
  function splitChars(el) {
    el.setAttribute('aria-label', el.textContent);
    const tmp = document.createElement('div'); tmp.innerHTML = el.innerHTML; el.innerHTML = '';
    const out = [];
    const walk = (node, parent) => node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        for (const c of n.textContent) {
          const s = document.createElement('span');
          s.className = 'ch' + (parent.classList && parent.classList.contains('grad') ? ' ' + parent.className : '');
          s.textContent = c; s.setAttribute('aria-hidden', 'true'); parent.appendChild(s); out.push(s);
        }
      } else { const c = n.cloneNode(false); parent.appendChild(c); walk(n, c); }
    });
    walk(tmp, el); el._chars = out; return out;
  }
  function charReveal(el, t, start, stagger = 0.02, dur = 0.5) {
    (el._chars || splitChars(el)).forEach((c, i) => {
      const k = eo(p(t, start + i * stagger, dur));
      c.style.opacity = k; c.style.transform = `translateY(${(1 - k) * 16}px)`; c.style.filter = k < 1 ? `blur(${(1 - k) * 7}px)` : 'none';
    });
  }
  function wordReveal(el, t, start, stagger = 0.05, dur = 0.6) {
    if (!el._words) {
      el.setAttribute('aria-label', el.textContent);
      const words = el.textContent.trim().split(/\s+/);
      el.innerHTML = words.map((w) => `<span class="wd" aria-hidden="true">${w}</span>`).join(' ');
      el._words = $$('.wd', el);
    }
    el._words.forEach((w, i) => {
      const k = eo(p(t, start + i * stagger, dur));
      w.style.opacity = k; w.style.transform = `translateY(${(1 - k) * 0.5}em)`; w.style.filter = k < 1 ? `blur(${(1 - k) * 6}px)` : 'none';
    });
  }
  function rise(el, t, a, d = 0.7, dy = 40, s0 = 1) {
    const k = eo(p(t, a, d)); el.style.opacity = k;
    el.style.transform = `translateY(${(1 - k) * dy}px) scale(${lerp(s0, 1, k)})`; return k;
  }
  function tilt(el, t, a, d = 0.9, dy = 110, rx = 26) {
    const k = eo(p(t, a, d)); el.style.opacity = k;
    el.style.transform = `perspective(1500px) translateY(${(1 - k) * dy}px) rotateX(${(1 - k) * rx + 2}deg)`; return k;
  }
  function fade(el, t, a, d = 0.4, out = null) {
    let k = p(t, a, d); if (out) k = Math.min(k, 1 - p(t, out[0], out[1]));
    el.style.opacity = k; el.style.visibility = k > 0 ? 'visible' : 'hidden'; return k;
  }
  function exitStyle(el, t, b, d = 0.42) {
    const k = eio(p(t, b - d, d));
    el.style.transform = k > 0 ? `translateY(${-50 * k}px) scale(${1 - 0.03 * k})` : '';
    el.style.filter = k > 0 ? `blur(${9 * k}px)` : 'none';
  }

  // ---- icons (line icons, 24px grid) ----
  const ICONS = {
    percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    wallet: '<rect x="2" y="6" width="20" height="14" rx="2.5"/><path d="M2 11h20M16.5 15.5h2M6 6V4.5h12V6"/>',
    scale: '<path d="M12 3v18M7 21h10M4 7h16M4 7l-2.5 6a3.2 3.2 0 0 0 5 0zM20 7l-2.5 6a3.2 3.2 0 0 0 5 0z"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    trend: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/><path d="M15 7h5v5"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="16" r="1.2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    car: '<path d="M5 17H3v-5l2.2-5.2A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.3L21 12v5h-2M3 12h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
    list: '<path d="M3 6h11M3 12h11M3 18h11M17 6l1.8 1.8L22 4.5M17 16l1.8 1.8L22 14.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    plane: '<path d="M2 16.5 22 8l-3-2-9 3.5L5 6 3 7l4 4.5-4 1.5-1.5-1L0 13z" transform="translate(1 1)"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    landmark: '<path d="M3 22h18M5 18h14M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l9 6H3z"/>',
    piggy: '<path d="M19 9.5c1 .6 2 1.6 2 3.5h-1.6c-.4 1.4-1.3 2.6-2.4 3.4V20h-3v-2h-4v2H7v-3.6A6 6 0 0 1 4 11.5C4 8 7.1 6 10.5 6c1.6 0 2.9.3 4 .8L17 5v3.3c.8.3 1.5.7 2 1.2z"/><circle cx="16" cy="11" r=".6"/>',
    truck: '<path d="M1 5h13v11H1zM14 9h4.5L22 12.5V16h-8"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    crane: '<path d="M6 22V3l12 4H6M6 7l4 4M14 7v6M12 13h4v3h-4zM3 22h8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    star: '<path d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z"/>',
  };
  const icon = (name, size = 28, color = 'currentColor', sw = 1.7) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  function hydrateIcons() { $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, +(el.dataset.size || 28), el.dataset.color || 'currentColor'); }); }

  // ---- background: deep navy, soft aurora, fine dot grid ----
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function makeBg(canvas, opts) {
    const c = canvas.getContext('2d');
    const base = opts.base || ['#050914', '#0a1124'];
    const stars = Array.from({ length: opts.stars ?? 40 }, (_, i) => ({ x: hash(i) * W, y: hash(i + 99) * H, r: 0.5 + hash(i + 7) * 1.3, s: 4 + hash(i + 3) * 14, ph: hash(i + 5) * 6.28 }));
    return function draw(t, pal, intensity = 1) {
      const g0 = c.createLinearGradient(0, 0, 0, H); g0.addColorStop(0, base[0]); g0.addColorStop(1, base[1]);
      c.globalCompositeOperation = 'source-over'; c.fillStyle = g0; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      const blobs = [
        [0.15 + 0.07 * Math.sin(t * 0.25), 0.12 + 0.04 * Math.cos(t * 0.21), 680, 0.30],
        [0.90 + 0.05 * Math.cos(t * 0.2), 0.48 + 0.06 * Math.sin(t * 0.23), 620, 0.22],
        [0.35 + 0.08 * Math.sin(t * 0.17 + 2), 0.98 + 0.03 * Math.cos(t * 0.3), 720, 0.24],
      ];
      blobs.forEach(([x, y, r, a], i) => {
        const [R, G, B] = pal[i]; a *= intensity;
        const g = c.createRadialGradient(x * W, y * H, 0, x * W, y * H, r);
        g.addColorStop(0, `rgba(${R},${G},${B},${a})`); g.addColorStop(0.55, `rgba(${R},${G},${B},${a * 0.22})`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      });
      c.globalCompositeOperation = 'source-over';
      // dot grid, slow drift
      const off = (t * 6) % 40;
      c.fillStyle = 'rgba(200,210,240,0.055)';
      for (let y = -40 + off; y < H; y += 40) for (let x = 20; x < W; x += 40) c.fillRect(x, y, 1.6, 1.6);
      stars.forEach((s) => {
        const y = ((s.y - t * s.s) % H + H) % H; const a = 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.6 + s.ph));
        c.fillStyle = `rgba(220,228,255,${a})`; c.beginPath(); c.arc(s.x, y, s.r, 0, 6.283); c.fill();
      });
      const v = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = v; c.fillRect(0, 0, W, H);
    };
  }
  // palette blending across scene boundaries
  function palAt(t, scenes, PAL) {
    const keys = Object.keys(scenes); let cur = keys[0];
    for (const s of keys) if (t >= scenes[s][0]) cur = s;
    const idx = keys.indexOf(cur); const nxt = keys[idx + 1];
    const k = nxt ? eio(p(t, scenes[cur][1] - 0.5, 0.9)) : 0;
    return PAL[cur].map((col, i) => { const a = hex(col), b = hex(nxt ? PAL[nxt][i] : col); return a.map((v, j) => Math.round(lerp(v, b[j], k))); });
  }
  function makeSweep(canvas, color = '235,225,255') {
    const c = canvas.getContext('2d');
    return function (t, bounds) {
      c.clearRect(0, 0, W, H);
      bounds.forEach((b) => {
        const k = p(t, b - 0.3, 0.55); if (k <= 0 || k >= 1) return;
        const y = lerp(-60, H + 60, eio(k)); const a = Math.sin(k * Math.PI);
        const g = c.createLinearGradient(0, y - 110, 0, y + 110);
        g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.5, `rgba(${color},${0.13 * a})`); g.addColorStop(1, `rgba(${color},0)`);
        c.fillStyle = g; c.fillRect(0, y - 110, W, 220);
        c.fillStyle = `rgba(255,255,255,${0.5 * a})`; c.fillRect(0, y - 0.75, W, 1.5);
      });
    };
  }
  function sceneOpacity(t, [a, b]) { return clamp(Math.min(a === 0 ? 1 : p(t, a, 0.28), 1 - p(t, b - 0.32, 0.32))); }

  function boot(render) {
    window.render = render;
    hydrateIcons();
    const imgs = $$('img').map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })));
    Promise.all([document.fonts.ready, ...imgs]).then(() => document.fonts.load('650 40px Geist')).then(() => {
      const q = new URLSearchParams(location.search).get('t');
      render(q !== null ? parseFloat(q) : 0); window.__ready = true;
    });
  }
  window.E = { W, H, $, $$, clamp, p, eo, eio, lerp, hash, fr, dt, lineReveal, splitChars, charReveal, wordReveal, rise, tilt, fade, exitStyle, icon, makeBg, palAt, makeSweep, sceneOpacity, boot };
})();
