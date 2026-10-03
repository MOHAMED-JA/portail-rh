"""Original soundtrack for the video: 24.5 s, 120 BPM, A minor. Everything synthesized here."""
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 48000
DUR = 24.5
N = int(SR * DUR)
t_all = np.arange(N) / SR
rng = np.random.default_rng(7)
BEAT = 0.5

def hz(m):  # midi -> Hz
    return 440.0 * 2 ** ((m - 69) / 12)

def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)

def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)

def place(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain

L = np.zeros(N); Rr = np.zeros(N)
def stereo(sig, at, gain=1.0, pan=0.0):
    place(L, sig, at, gain * np.sqrt(0.5 * (1 - pan)))
    place(Rr, sig, at, gain * np.sqrt(0.5 * (1 + pan)))

# chord progression, one chord per bar (2 s): Am F C G | Am F C G | ... ; outro Am(add9)
A, F, C, G = [57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]
prog = [A, F, C, G] * 3
roots = [45, 41, 48, 43] * 3

# ---------- pad ----------
def saw_pad(freq, length, atk=0.6, rel=0.8):
    tt = np.arange(int(length * SR)) / SR
    s = np.zeros_like(tt)
    for det in (-0.07, 0.0, 0.07):
        f = freq * 2 ** (det / 12)
        for h in range(1, 9):
            s += np.sin(2 * np.pi * f * h * tt + h * 1.3) / h
    env = np.minimum(1, tt / atk) * np.minimum(1, (length - tt) / rel).clip(0)
    return s * env / 9

pad = np.zeros(N)
for bar in range(12):
    st = bar * 2.0
    if st >= DUR:
        break
    length = 2.6 if bar < 10 else DUR - st
    chord = prog[bar] if bar < 10 else [57, 64, 71, 72]  # outro: A E B C -> Am add9 color
    for m in chord:
        place(pad, saw_pad(hz(m), min(length, DUR - st)), st)
# filter opens over the hook, stays warm
pad = lp(pad, 1400)
hook_open = np.interp(t_all, [0, 3.8, 4.0, 24.5], [0.35, 0.8, 1.0, 1.0])
pad *= hook_open

# ---------- kick + sidechain ----------
kick = np.zeros(N)
duck = np.ones(N)
def kick_hit():
    tt = np.arange(int(0.35 * SR)) / SR
    f = 45 + 95 * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 9) + 0.15 * np.sin(2 * ph) * np.exp(-tt * 30)
kh = kick_hit()
duck_curve = 1 - 0.55 * np.exp(-np.arange(int(0.45 * SR)) / SR * 9)
beats = np.arange(4.0, 20.0 - 1e-6, BEAT)
for b in beats:
    place(kick, kh, b)
    i = int(b * SR); j = min(N, i + len(duck_curve))
    duck[i:j] = np.minimum(duck[i:j], duck_curve[: j - i])

# ---------- sub bass (8ths) ----------
bass = np.zeros(N)
for bar in range(2, 10):
    r = roots[bar] - 12 + 12  # A2 region
    for k in range(8):
        at = bar * 2.0 + k * 0.25
        tt = np.arange(int(0.24 * SR)) / SR
        f = hz(r)
        s = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)
        s *= np.minimum(1, tt / 0.005) * np.exp(-tt * 6)
        place(bass, s, at, 0.9 if k % 2 == 0 else 0.6)
bass = lp(bass, 400)

# ---------- hats ----------
hats = np.zeros(N)
for b in beats:
    tt = np.arange(int(0.06 * SR)) / SR
    n = lp(hp(rng.standard_normal(len(tt)), 6500), 11000) * np.exp(-tt * 70)
    place(hats, n, b + 0.25, 1.0)
    place(hats, n * 0.35, b + 0.125)  # ghost 16th

# ---------- arp (16ths), with ping-pong delay ----------
arpL = np.zeros(N); arpR = np.zeros(N)
def pluck(freq, length=0.22):
    tt = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * freq * tt) + 0.35 * np.sin(2 * np.pi * 2 * freq * tt) + 0.12 * np.sin(2 * np.pi * 3 * freq * tt)
    return s * np.minimum(1, tt / 0.003) * np.exp(-tt * 14)
pattern = [0, 1, 2, 1, 2, 0, 1, 2]
for bar in range(2, 12):
    chord = prog[bar] if bar < 10 else [57, 64, 71]
    for k in range(16 if bar < 10 else 8):
        if bar >= 10 and k % 2:  # outro thins out
            continue
        at = bar * 2.0 + k * 0.125
        if at >= DUR - 0.3:
            break
        m = chord[pattern[k % 8]] + 12
        s = pluck(hz(m))
        g = 0.55 if k % 4 == 0 else 0.38
        place(arpL, s, at, g); place(arpR, s, at, g)
        place(arpL, s, at + 0.375, g * 0.33)   # dotted-8th echoes, alternating sides
        place(arpR, s, at + 0.75, g * 0.2)
arpL = lp(arpL, 5000); arpR = lp(arpR, 5000)

# ---------- FX: riser, impacts, whooshes, UI blips ----------
fx = np.zeros(N)
# riser over the hook
tt = np.arange(int(3.9 * SR)) / SR
noise = rng.standard_normal(len(tt))
riser = np.zeros_like(tt)
for a, b in zip(np.linspace(0, 3.9, 40)[:-1], np.linspace(0, 3.9, 40)[1:]):
    i, j = int(a * SR), int(b * SR)
    fc = 300 + 5000 * (a / 3.9) ** 2
    riser[i:j] = bp(noise, fc * 0.7, min(fc * 1.4, 20000))[i:j]
riser *= (tt / 3.9) ** 2.2
place(fx, riser, 0.1, 0.35)

def impact():
    tt = np.arange(int(1.6 * SR)) / SR
    boom = np.sin(2 * np.pi * (55 + 40 * np.exp(-tt * 12)) * tt) * np.exp(-tt * 2.6)
    burst = lp(rng.standard_normal(len(tt)), 900) * np.exp(-tt * 7)
    return boom + 0.35 * burst
place(fx, impact(), 4.0, 0.75)
place(fx, impact(), 20.0, 0.65)

def whoosh(length=0.8):
    tt = np.arange(int(length * SR)) / SR
    n = rng.standard_normal(len(tt)); out = np.zeros_like(tt)
    for a in np.linspace(0, length, 25)[:-1]:
        i = int(a * SR); j = int((a + length / 24) * SR)
        fc = 400 + 3500 * np.sin(np.pi * a / length)
        out[i:j] = bp(n, fc * 0.6, fc * 1.5)[i:j]
    return out * np.sin(np.pi * tt / length) ** 2
for b in (9.5, 15.0):
    place(fx, whoosh(), b - 0.55, 0.4)
place(fx, whoosh(1.0), 19.4, 0.3)

def blip(m, length=0.12, g=1.0):
    tt = np.arange(int(length * SR)) / SR
    return g * np.sin(2 * np.pi * hz(m) * tt) * np.exp(-tt * 40) * np.minimum(1, tt / 0.002)
# hook numbers lock (A, C, E)
for at, m in ((0.9, 81), (1.3, 84), (1.7, 88)):
    place(fx, blip(m, 0.3, 0.4), at)
# typing ticks (24 chars over 0.85 s) — quiet, in key (A6/E6)
for i in range(24):
    place(fx, blip(93 if i % 2 else 88, 0.04, 0.12), 4.85 + i * 0.85 / 24)
place(fx, blip(81, 0.25, 0.35) + blip(88, 0.25, 0.25), 5.75)  # Remplir
# shimmer as counters land
for at in (6.7, 12.4, 16.9):
    for k, m in enumerate((81, 84, 88, 93)):
        place(fx, blip(m, 0.35, 0.15), at + k * 0.05)

# ---------- reverb ----------
def reverb(x, secs=2.2, mix=0.25):
    tt = np.arange(int(secs * SR)) / SR
    ir = rng.standard_normal(len(tt)) * np.exp(-tt * 3.2)
    ir = lp(ir, 6000)
    wet = fftconvolve(x, ir)[: len(x)]
    wet /= np.max(np.abs(wet)) + 1e-9
    return wet * mix * np.max(np.abs(x))

# ---------- mix ----------
mono_bus = pad * 0.30 * duck + bass * 0.42 * duck + kick * 0.62 + hats * 0.06 + fx * 0.55
left = mono_bus + arpL * 0.16
right = mono_bus + arpR * 0.16
rv = reverb(pad * 0.3 + fx * 0.4 + (arpL + arpR) * 0.08)
left += rv; right += rv
# master fade-in/out
fade = np.interp(t_all, [0, 0.05, 23.2, 24.5], [0, 1, 1, 0])
left *= fade; right *= fade
st = np.stack([left, right], axis=1)
st = np.tanh(st * 1.2) / np.tanh(1.2)
st /= np.max(np.abs(st)) / 0.89
wavfile.write('music.wav', SR, (st * 32767).astype(np.int16))
print('ok', st.shape)
