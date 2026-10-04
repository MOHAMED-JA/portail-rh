"""Voice + soft music mix: the music ducks smoothly under the narration."""
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt, fftconvolve

SR = 48000
v, vsr = sf.read('voix.wav'); v = resample_poly(v, SR, vsr)
m, msr = sf.read('musique.wav'); assert msr == SR
n = len(m); v = np.pad(v, (0, max(0, n - len(v))))[:n]

# voice: remove rumble, soft compression, a touch of room
v = sosfilt(butter(2, 90, 'high', fs=SR, output='sos'), v)
env = np.sqrt(np.convolve(v ** 2, np.ones(int(0.02 * SR)) / int(0.02 * SR), 'same')) + 1e-6
thr = np.percentile(env[env > 1e-3], 70)
gain = np.where(env > thr, (thr / env) ** 0.35, 1.0)
v = v * gain
rng = np.random.default_rng(3); tr = np.arange(int(0.6 * SR)) / SR
ir = sosfilt(butter(2, 4000, 'low', fs=SR, output='sos'), rng.standard_normal(len(tr)) * np.exp(-tr * 9))
wet = fftconvolve(v, ir)[:n]; wet *= np.max(np.abs(v)) / (np.max(np.abs(wet)) + 1e-9)
v = v + 0.07 * wet
v /= np.max(np.abs(v)) + 1e-9

# ducking envelope from the voice (attack 80 ms, release 450 ms)
e = np.abs(v); e = np.convolve(e, np.ones(int(0.05 * SR)) / int(0.05 * SR), 'same')
act = (e > 0.02).astype(float)
sm = np.zeros(n); a_up = 1 - np.exp(-1 / (0.08 * SR)); a_dn = 1 - np.exp(-1 / (0.45 * SR))
acc = 0.0
for i in range(0, n, 48):            # 1 ms steps
    target = act[i]; acc += (target - acc) * (1 - (1 - (a_up if target > acc else a_dn)) ** 48)
    sm[i:i + 48] = acc
duck = 1 - 0.68 * sm                # about -10 dB under the voice

mix = m * duck[:, None] * 0.45 + v[:, None] * 0.62
mix /= np.max(np.abs(mix)) / 0.89
sf.write('mix.wav', mix, SR)
print('ok', n / SR)
