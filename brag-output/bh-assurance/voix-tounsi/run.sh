#!/bin/bash
# Génère la vidéo BH Assurance avec voix off en tounsi (ElevenLabs) et musique douce.
# Prérequis : api.elevenlabs.io autorisé dans le réseau de l'environnement, ELEVENLABS_API_KEY définie,
# pip install numpy scipy soundfile.
set -e
cd "$(dirname "$0")"
python3 tts_elevenlabs.py
[ -f voix.wav ] || exit 0                      # sans ELEVENLABS_VOICE_ID : liste des voix seulement
python3 ../../engine/music2.py ../voix/music-douce.json music-douce.wav
python3 ../voix/mix.py                          # lit voix.wav + music-douce.wav, écrit mix.wav
ffmpeg -loglevel error -y -i mix.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 mix-norm.wav
ffmpeg -loglevel error -y -i ../bh-assurance.mp4 -i mix-norm.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 192k -movflags +faststart -shortest ../bh-assurance-voix-tounsi.mp4
python3 - <<'EOF'
import json, soundfile as sf
L = json.load(open('script.json'))
ts = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(round((x % 1) * 1000)) % 1000:03d}"
out = [f"{i + 1}\n{ts(l['at'])} --> {ts(l['at'] + sf.info(f'line{i}.wav').duration)}\n{l['srt']}\n" for i, l in enumerate(L)]
open('../bh-assurance-sous-titres-tounsi.srt', 'w').write('\n'.join(out))
EOF
echo "OK : ../bh-assurance-voix-tounsi.mp4 et ../bh-assurance-sous-titres-tounsi.srt"
