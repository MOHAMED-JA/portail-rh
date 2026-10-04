"""Voix off Kokoro (ff_siwis), une phrase par scène, placée à l'instant 'at'. Sortie : voix.wav + timing.json"""
import json, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
M = '/home/user/tts/'; k = Kokoro(M + 'kokoro-v1.0.onnx', M + 'voices-v1.0.bin')
L = json.load(open('lignes.json')); AT = json.load(open('placement.json'))
SR = 24000; DUR = 75.2; out = np.zeros(int(DUR * SR), dtype=np.float32); tim = []
for ln in L:
    s, sr = k.create(ln['text'], voice='ff_siwis', speed=1.0, lang='fr-fr'); assert sr == SR
    nz = np.where(np.abs(s) > 0.008)[0]; s = s[max(0, nz[0] - 240): nz[-1] + 1200]
    at = AT[ln['id']]['at']; end = AT[ln['id']]['end']; d = len(s) / SR
    print(f"{ln['id']:7} {at:6.2f} → {at + d:6.2f}  (fin de scène {end:6.2f})  {'TROP LONG' if at + d > end - .15 else 'ok'}")
    a = int(at * SR); out[a:a + len(s)] += s[: len(out) - a]; tim.append({'id': ln['id'], 'at': at, 'end': round(at + d, 2), 'srt': ln['srt']})
sf.write('voix.wav', out, SR); json.dump(tim, open('timing.json', 'w'), ensure_ascii=False, indent=1)
