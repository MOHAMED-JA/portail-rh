"""Musique originale douce et professionnelle : piano électrique, cordes, mélodie légère, percussions feutrées.
usage: python3 music3.py <config.json> <out.wav>
config: {"dur": s, "bpm": n, "chords": [[midi...]...] (un accord par mesure), "roots": [midi...],
         "melody": [[mesure, temps, midi, durée_en_temps], ...] (motif répété), "melody_bars": [début, fin],
         "strings_from": s, "perc": [[début, fin], ...], "bounds": [s...] (changements de scène),
         "end_at": s, "end_chord": [midi...]}"""
import json, sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

cfg = json.load(open(sys.argv[1])); out = sys.argv[2]
SR = 48000; DUR = cfg['dur']; N = int(SR * DUR); T = np.arange(N) / SR
BEAT = 60 / cfg['bpm']; BAR = 4 * BEAT
rng = np.random.default_rng(23)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
sos = lambda kind, f, o=2: butter(o, f, kind, fs=SR, output='sos')
lp = lambda x, f: sosfilt(sos('low', f), x)
hp = lambda x, f: sosfilt(sos('high', f), x)
bp = lambda x, lo, hi: sosfilt(sos('band', [lo, hi]), x)

def place(buf, sig, at, g=1.0):
    i = int(at * SR)
    if i >= len(buf) or i + len(sig) <= 0: return
    a = max(0, -i); i = max(0, i); j = min(len(buf), i + len(sig) - a)
    buf[i:j] += sig[a:a + j - i] * g

chords, roots = cfg['chords'], cfg['roots']
nbars = int(np.ceil(DUR / BAR)); end_at = cfg['end_at']; end_bar = int(end_at // BAR)
chord_at = lambda b: chords[b % len(chords)]

# --- piano électrique (FM doux, « tine » discrète) ---
def ep(f, L, vel=1.0):
    t = np.arange(int(L * SR)) / SR
    idx = 1.3 * vel * np.exp(-t * 2.6) + 0.15
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    s += 0.05 * vel * np.sin(2 * np.pi * f * 7.02 * t) * np.exp(-t * 14)        # tine
    s += 0.18 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3.5)
    env = np.minimum(1, t / 0.006) * np.exp(-t * 0.9) * np.clip((L - t) / 0.35, 0, 1)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 4.6 * t)
    return s * env * trem * vel
epL = np.zeros(N); epR = np.zeros(N)
for b in range(nbars):
    st = b * BAR
    if st >= DUR - 0.5: break
    if b >= end_bar:   # accord final, égrené vers le haut
        for k, m in enumerate(sorted(cfg['end_chord'])):
            s = ep(hz(m), DUR - st - k * 0.11, 0.85)
            place(epL, s, st + k * 0.11, 0.30 if k % 2 else 0.26); place(epR, s, st + k * 0.11, 0.26 if k % 2 else 0.30)
        break
    ch = sorted(chord_at(b))
    for k, m in enumerate(ch):                                   # temps 1 : accord tenu, légèrement égrené
        s = ep(hz(m), BAR * 1.05, 0.8); d = k * 0.012
        place(epL, s, st + d, 0.24 * (1.1 if k % 2 == 0 else .9)); place(epR, s, st + d, 0.24 * (.9 if k % 2 == 0 else 1.1))
    for m in ch[-2:]:                                            # contretemps du 2 : deux notes aiguës
        s = ep(hz(m), BEAT * 1.6, 0.45); place(epL, s, st + 1.5 * BEAT, 0.12); place(epR, s, st + 1.5 * BEAT, 0.16)
    s = ep(hz(ch[1] + 12), BEAT * 1.8, 0.4)                      # temps 4 : une note qui relance
    place(epL, s, st + 3 * BEAT, 0.13); place(epR, s, st + 3 * BEAT, 0.10)
fade_in = np.interp(T, [0, 1.2], [0.0, 1.0]); epL *= fade_in; epR *= fade_in

# --- cordes : nappe chaude, attaque lente ---
def strings(f, L):
    t = np.arange(int(L * SR)) / SR; s = np.zeros_like(t)
    for det, ph in ((-0.07, 0.3), (0.0, 1.1), (0.07, 2.0)):
        ff = f * 2 ** (det / 12); vib = 1 + 0.0025 * np.sin(2 * np.pi * 5.1 * t + ph)
        ph_acc = 2 * np.pi * np.cumsum(ff * vib) / SR
        s += sum(np.sin(h * ph_acc + h * ph) / h for h in range(1, 8))
    return s * np.minimum(1, t / 1.6) * np.clip((L - t) / 1.6, 0, 1) / 9
strL = np.zeros(N); strR = np.zeros(N)
for b in range(nbars):
    st = b * BAR
    if st + BAR < cfg['strings_from'] or st >= DUR: continue
    ch = sorted(cfg['end_chord'] if b >= end_bar else chord_at(b))
    L = (DUR - st) if b >= end_bar else BAR + 1.6
    for k, m in enumerate([ch[0] - 12, ch[1], ch[2]]):
        s = strings(hz(m), L); place(strL if k % 2 else strR, s, st, 1.0); place(strR if k % 2 else strL, s, st, 0.6)
    if b >= end_bar: break
sg = np.interp(T, [0, cfg['strings_from'], cfg['strings_from'] + 3.0, DUR], [0, 0, 1, 1])
strL = lp(strL, 2200) * sg; strR = lp(strR, 2200) * sg

# --- basse ronde : fondamentale, rondes et rappel au 3e temps ---
bass = np.zeros(N)
for b in range(nbars):
    st = b * BAR
    if st >= DUR or st + BAR < cfg['strings_from']: continue
    r = roots[0] if b >= end_bar else roots[b % len(roots)]
    for at, L, g in ((0, BAR * 0.98 if b < end_bar else DUR - st, 1.0), (2.5 * BEAT, 1.2 * BEAT, 0.45)):
        if b >= end_bar and at > 0: continue
        t = np.arange(int(L * SR)) / SR
        s = (np.sin(2 * np.pi * hz(r) * t) + 0.18 * np.sin(4 * np.pi * hz(r) * t)) * np.minimum(1, t / 0.02) * np.exp(-t * 0.7)
        place(bass, s, st + at, g)
bass = lp(bass, 260) * np.interp(T, [0, cfg['strings_from'], cfg['strings_from'] + 2, DUR], [0, 0, 1, 1])

# --- mélodie : quelques notes posées, timbre cloche douce ---
def bellish(f, L):
    t = np.arange(int(L * SR)) / SR
    s = np.sin(2 * np.pi * f * t + 0.5 * np.exp(-t * 4) * np.sin(2 * np.pi * f * 3.5 * t))
    s += 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3)
    return s * np.minimum(1, t / 0.01) * np.exp(-t * 1.5) * np.clip((L - t) / 0.3, 0, 1)
mel = np.zeros(N); mb0, mb1 = cfg['melody_bars']; phrase = max(x[0] for x in cfg['melody']) + 1
for b0 in range(mb0, mb1, phrase):
    for bb, beat, m, d in cfg['melody']:
        at = (b0 + bb) * BAR + beat * BEAT
        if at >= min(DUR, mb1 * BAR): continue
        place(mel, bellish(hz(m), max(1.2, d * BEAT + 0.8)), at, 0.16)

# --- percussions feutrées ---
kick = np.zeros(N); perc = np.zeros(N)
tk = np.arange(int(0.3 * SR)) / SR
kh = np.sin(2 * np.pi * np.cumsum(48 + 55 * np.exp(-tk * 28)) / SR) * np.exp(-tk * 12)
for a, z in cfg['perc']:
    t0 = np.ceil(a / BEAT) * BEAT
    while t0 < z - 1e-6:
        bi = int(round(t0 / BEAT)) % 4
        if bi in (0, 2): place(kick, kh, t0, 0.8 if bi == 0 else 0.55)
        if bi in (1, 3):   # balai sur 2 et 4
            tr = np.arange(int(0.18 * SR)) / SR
            place(perc, bp(rng.standard_normal(len(tr)), 1800, 7000) * np.exp(-tr * 22), t0, 0.32)
        for h in (0, .5):  # shaker très léger
            ts = np.arange(int(0.06 * SR)) / SR
            place(perc, lp(hp(rng.standard_normal(len(ts)), 7000), 11000) * np.exp(-ts * 70), t0 + h * BEAT, 0.06 if h else 0.035)
        t0 += BEAT
pz = np.zeros(N)
for a, z in cfg['perc']: pz += np.interp(T, [a - .01, a + 1.5, z - 1.0, z], [0, 1, 1, 0], left=0, right=0)
kick *= np.clip(pz, 0, 1); perc *= np.clip(pz, 0, 1)

# --- transitions : souffle doux montant juste avant chaque changement de scène ---
fx = np.zeros(N)
for b in cfg['bounds']:
    L = 1.1; tw = np.arange(int(L * SR)) / SR; n = rng.standard_normal(len(tw)); o = np.zeros_like(tw)
    for a in np.linspace(0, L, 20)[:-1]:
        i = int(a * SR); j = int((a + L / 19) * SR); o[i:j] = lp(n, 500 + 3500 * (a / L) ** 2)[i:j]
    place(fx, o * (tw / L) ** 2.2 * np.clip((L - tw) / 0.08, 0, 1), b - L, 0.07)

def reverb(x, secs=3.2, damp=2.2, seed=0):
    r = np.random.default_rng(seed); tr = np.arange(int(secs * SR)) / SR
    ir = lp(r.standard_normal(len(tr)) * np.exp(-tr * damp), 6000)
    w = fftconvolve(x, ir)[:len(x)]; return w / (np.max(np.abs(w)) + 1e-9) * np.max(np.abs(x))

dryL = epL + strL * 0.55 + bass * 0.34 + kick * 0.30 + perc * 0.11 + mel * 0.9 + fx
dryR = epR + strR * 0.55 + bass * 0.34 + kick * 0.30 + perc * 0.11 + mel * 0.9 + fx
send = (epL + epR) * 0.5 + (strL + strR) * 0.3 + mel * 1.2
L_ = dryL + reverb(send, seed=1) * 0.30; R_ = dryR + reverb(send, seed=2) * 0.30
fade = np.interp(T, [0, 0.05, DUR - 2.2, DUR], [0, 1, 1, 0])
st = np.stack([L_ * fade, R_ * fade], 1)
st = np.tanh(st * 1.1) / np.tanh(1.1); st /= np.max(np.abs(st)) / 0.89
wavfile.write(out, SR, (st * 32767).astype(np.int16)); print('ok', out, DUR)
