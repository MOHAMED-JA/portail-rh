"""Original corporate soundtrack, fully synthesized.
usage: python3 music2.py <config.json> <out.wav>
config: {"dur": s, "bpm": n, "chords": [[midi...], ...] (one per bar), "roots": [midi...],
         "bounds": [s...] (scene changes: whoosh), "bells": [s...] (soft accents),
         "drums_from": s, "drums_to": s, "end_chord": [midi...]}"""
import json, sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

cfg = json.load(open(sys.argv[1])); out = sys.argv[2]
SR = 48000; DUR = cfg['dur']; N = int(SR * DUR); T = np.arange(N) / SR
BEAT = 60 / cfg['bpm']; BAR = 4 * BEAT
rng = np.random.default_rng(11)
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

chords = cfg['chords']; roots = cfg['roots']
nbars = int(np.ceil(DUR / BAR))
end_bar = int((cfg.get('end_at', DUR - 3.5)) // BAR)

# --- pad: soft detuned saw stack, low-passed ---
def pad_note(f, L, atk=1.2, rel=1.4):
    tt = np.arange(int(L * SR)) / SR; s = np.zeros_like(tt)
    for det in (-0.08, 0, 0.08):
        ff = f * 2 ** (det / 12)
        for h in range(1, 7): s += np.sin(2 * np.pi * ff * h * tt + h) / (h * 1.2)
    return s * np.minimum(1, tt / atk) * np.clip((L - tt) / rel, 0, 1) / 8
pad = np.zeros(N)
for b in range(nbars):
    st = b * BAR
    if st >= DUR: break
    ch = chords[b % len(chords)] if b < end_bar else cfg['end_chord']
    L = BAR + 1.2 if b < end_bar else DUR - st
    for m in ch: place(pad, pad_note(hz(m), min(L, DUR - st + 0.01)), st)
    if b >= end_bar: break
pad = lp(pad, 1500) * np.interp(T, [0, 2.5, DUR], [0.5, 1, 1])

# --- piano-like pluck arpeggio (8ths) ---
def piano(f, L=1.1):
    tt = np.arange(int(L * SR)) / SR
    s = sum(np.sin(2 * np.pi * f * h * tt) * a * np.exp(-tt * (2.5 + h * 1.6)) for h, a in ((1, 1), (2, .45), (3, .22), (4, .12)))
    return s * np.minimum(1, tt / 0.004)
arpL = np.zeros(N); arpR = np.zeros(N)
pattern = [0, 2, 1, 2, 0, 2, 1, 3]
for b in range(nbars):
    ch = chords[b % len(chords)] if b < end_bar else cfg['end_chord']
    notes = sorted(ch) + [sorted(ch)[0] + 12]
    for k in range(8):
        at = b * BAR + k * BEAT / 2
        if at >= DUR - 1.2: break
        if b >= end_bar and k > 0: break
        m = notes[pattern[k] % len(notes)] + 12
        g = (0.5 if k % 2 == 0 else 0.33) * (1.6 if b >= end_bar else 1)
        s = piano(hz(m), 2.5 if b >= end_bar else 1.1)
        place(arpL, s, at, g * (0.9 if k % 2 else 1.0)); place(arpR, s, at, g * (1.0 if k % 2 else 0.9))
        place(arpL, s, at + BEAT * 0.75, g * 0.18); place(arpR, s, at + BEAT * 1.5, g * 0.12)

# --- drums: soft kick on 1 & 3, rim on 2 & 4, shaker 8ths ---
kick = np.zeros(N); perc = np.zeros(N); duck = np.ones(N)
tt = np.arange(int(0.35 * SR)) / SR
kh = np.sin(2 * np.pi * np.cumsum(42 + 80 * np.exp(-tt * 30)) / SR) * np.exp(-tt * 10)
dc = 1 - 0.4 * np.exp(-np.arange(int(0.5 * SR)) / SR * 8)
d0, d1 = cfg['drums_from'], cfg['drums_to']
t0 = d0
while t0 < d1 - 1e-6 and not cfg.get('no_drums'):
    beat_i = int(round((t0 - d0) / BEAT))
    if beat_i % 2 == 0:
        place(kick, kh, t0); i = int(t0 * SR); j = min(N, i + len(dc)); duck[i:j] = np.minimum(duck[i:j], dc[:j - i])
    else:
        tr = np.arange(int(0.12 * SR)) / SR
        rim = bp(rng.standard_normal(len(tr)), 1500, 4500) * np.exp(-tr * 45)
        place(perc, rim, t0, 0.5)
    for half in (0, 0.5):
        ts = np.arange(int(0.05 * SR)) / SR
        sh = lp(hp(rng.standard_normal(len(ts)), 6000), 11000) * np.exp(-ts * 80)
        place(perc, sh, t0 + half * BEAT, 0.22 if half else 0.12)
    t0 += BEAT

# --- sub bass: root, half notes ---
bass = np.zeros(N)
for b in range(nbars):
    if b * BAR < d0 - 0.01 or b * BAR >= d1: continue
    r = roots[b % len(roots)]
    for k in (0, 2):
        at = b * BAR + k * BEAT; L = 2 * BEAT * 0.95
        tb = np.arange(int(L * SR)) / SR
        s = (np.sin(2 * np.pi * hz(r) * tb) + 0.25 * np.sin(4 * np.pi * hz(r) * tb)) * np.minimum(1, tb / 0.01) * np.exp(-tb * 1.4)
        place(bass, s, at)
bass = lp(bass, 300)

# --- FX: whooshes at scene changes, soft bells, intro swell, low hit at drums start ---
fx = np.zeros(N)
def whoosh(L=0.9):
    tw = np.arange(int(L * SR)) / SR; n = rng.standard_normal(len(tw)); o = np.zeros_like(tw)
    for a in np.linspace(0, L, 24)[:-1]:
        i = int(a * SR); j = int((a + L / 23) * SR); fc = 350 + 2600 * np.sin(np.pi * a / L)
        o[i:j] = bp(n, fc * 0.6, fc * 1.5)[i:j]
    return o * np.sin(np.pi * tw / L) ** 2
for b in cfg['bounds']: place(fx, whoosh(), b - 0.6, 0.22)
def bell(m, L=2.0):
    tb = np.arange(int(L * SR)) / SR
    return sum(np.sin(2 * np.pi * hz(m) * r * tb) * a * np.exp(-tb * d) for r, a, d in ((1, 1, 2.2), (2.76, .3, 4), (5.4, .12, 7))) * np.minimum(1, tb / 0.003)
key = cfg['chords'][0]
for i, at in enumerate(cfg['bells']): place(fx, bell(sorted(key)[i % 3] + 24), at, 0.12)
ti = np.arange(int(min(3.0, d0) * SR)) / SR
nz = rng.standard_normal(len(ti)); swell = np.zeros_like(ti)
for a in np.linspace(0, ti[-1], 20)[:-1]:
    i = int(a * SR); j = int((a + ti[-1] / 19) * SR) + 1
    swell[i:j] = lp(nz, 900 + 3000 * (a / ti[-1]) ** 2)[i:j]
swell *= (ti / ti[-1]) ** 2.5
place(fx, swell, d0 - len(ti) / SR, 0.18)
th = np.arange(int(1.4 * SR)) / SR
place(fx, np.sin(2 * np.pi * (50 + 30 * np.exp(-th * 10)) * th) * np.exp(-th * 3), d0, 0.5)

def reverb(x, secs=2.6):
    tr = np.arange(int(secs * SR)) / SR
    ir = lp(rng.standard_normal(len(tr)) * np.exp(-tr * 2.8), 5500)
    w = fftconvolve(x, ir)[:len(x)]; return w / (np.max(np.abs(w)) + 1e-9) * np.max(np.abs(x))

fxg = cfg.get('fx_gain', 0.6); bassg = cfg.get('bass_gain', 0.36)
bus = pad * 0.30 * duck + bass * bassg * duck + kick * 0.42 + perc * 0.10 + fx * fxg
rv = reverb(pad * 0.25 + (arpL + arpR) * 0.12 + fx * 0.3) * 0.32
L_ = bus + arpL * 0.17 + rv; R_ = bus + arpR * 0.17 + rv
fade = np.interp(T, [0, 0.08, DUR - 1.8, DUR], [0, 1, 1, 0])
st = np.stack([L_ * fade, R_ * fade], 1)
st = np.tanh(st * 1.15) / np.tanh(1.15); st /= np.max(np.abs(st)) / 0.89
wavfile.write(out, SR, (st * 32767).astype(np.int16)); print('ok', out, DUR)
