"""Voix off en tounsi via ElevenLabs, phrase par phrase, calée sur les scènes de la vidéo.

Variables d'environnement :
  ELEVENLABS_API_KEY   (obligatoire)
  ELEVENLABS_VOICE_ID  (facultatif ; sans elle, la liste des voix du compte est affichée)
  ELEVENLABS_MODEL     (facultatif, défaut eleven_v3 ; repli possible : eleven_multilingual_v2)
Sortie : voix.wav (24 kHz, mono, 77 s) et line<i>.wav
"""
import json, os, sys, urllib.request, urllib.error
import numpy as np, soundfile as sf

KEY = os.environ.get('ELEVENLABS_API_KEY')
if not KEY: sys.exit("ELEVENLABS_API_KEY absente : ajoutez-la dans les réglages de l'environnement.")
VOICE = os.environ.get('ELEVENLABS_VOICE_ID'); MODEL = os.environ.get('ELEVENLABS_MODEL', 'eleven_v3')
API = 'https://api.elevenlabs.io/v1'
SR = 24000

def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"Erreur ElevenLabs {e.code} : {e.read().decode(errors='replace')[:400]}")

if not VOICE:
    voices = json.loads(call('/voices'))['voices']
    print("Voix disponibles (définissez ELEVENLABS_VOICE_ID) :")
    for v in voices: print(f"  {v['voice_id']}  {v['name']:24} {v.get('labels', {})}")
    sys.exit(0)

lines = json.load(open('script.json'))
out = np.zeros(int(78 * SR), dtype=np.float32)
for i, ln in enumerate(lines):
    win = ln['end'] - ln['at']; speed = 0.95
    while True:
        settings = {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.15, 'use_speaker_boost': True}
        if MODEL != 'eleven_v3': settings['speed'] = speed      # v3 n'accepte pas le réglage de vitesse
        body = {'text': ln['tts'], 'model_id': MODEL, 'voice_settings': settings}
        if MODEL != 'eleven_v3':
            body['previous_text'] = lines[i - 1]['tts'] if i else None
            body['next_text'] = lines[i + 1]['tts'] if i + 1 < len(lines) else None
        pcm = call(f'/text-to-speech/{VOICE}?output_format=pcm_24000', body)
        s = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
        # retire les silences de début et de fin
        nz = np.where(np.abs(s) > 0.01)[0]; s = s[max(0, nz[0] - 600): nz[-1] + 2400] if len(nz) else s
        d = len(s) / SR
        if d <= win or MODEL == 'eleven_v3' or speed >= 1.15: break
        speed = round(speed + 0.05, 2)
    flag = 'ok' if d <= win else f'TROP LONG de {d - win:.1f} s : raccourcir le texte'
    print(f"{i}: {d:5.2f} s / fenêtre {win:5.2f} s  {flag}")
    sf.write(f'line{i}.wav', s, SR)
    a = int(ln['at'] * SR); out[a:a + len(s)] += s[: len(out) - a]
sf.write('voix.wav', out[: int(77 * SR)], SR)
print('voix.wav écrit')
