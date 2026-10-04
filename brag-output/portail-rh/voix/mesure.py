import json, sys, soundfile as sf
from kokoro_onnx import Kokoro
M = '/home/user/tts/'; k = Kokoro(M + 'kokoro-v1.0.onnx', M + 'voices-v1.0.bin')
L = json.load(open('lignes.json')); sp = float(sys.argv[1]) if len(sys.argv) > 1 else 0.95
only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
for ln in L:
    if only and ln['id'] not in only: continue
    s, sr = k.create(ln['text'], voice='ff_siwis', speed=sp, lang='fr-fr')
    sf.write(f"brut-{ln['id']}.wav", s, sr); print(f"{ln['id']:7} {len(s)/sr:5.2f}s")
