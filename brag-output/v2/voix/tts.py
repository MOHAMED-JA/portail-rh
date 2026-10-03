"""Generates each narration line with Kokoro (voice ff_siwis), fitting it in its scene window."""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
M = '/home/user/tts/'
k = Kokoro(M + 'kokoro-v1.0.onnx', M + 'voices-v1.0.bin')
lines = json.load(open(sys.argv[1])); base = float(sys.argv[2]) if len(sys.argv) > 2 else 0.92
SR = 24000; out = np.zeros(int(72 * SR), dtype=np.float32)
for i, ln in enumerate(lines):
    win = ln['end'] - ln['at']; speed = base
    while True:
        s, sr = k.create(ln['text'], voice='ff_siwis', speed=speed, lang='fr-fr', sentence_pause=0.35, clause_pause=0.15)
        d = len(s) / sr
        if d <= win or speed >= 1.12: break
        speed = round(speed + 0.03, 2)
    print(f"{i}: {d:5.2f}s / fenêtre {win:5.2f}s  vitesse {speed}  {'TROP LONG' if d > win else 'ok'}")
    sf.write(f'line{i}.wav', s, sr)
    a = int(ln['at'] * SR); out[a:a + len(s)] += s[: len(out) - a]
sf.write('voix.wav', out[: int(float(sys.argv[3]) * SR)], SR)
