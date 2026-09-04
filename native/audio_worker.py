import argparse
import os
import numpy as np
import soundfile as sf
import torch
from transformers import pipeline

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--prompt', required=True)
p.add_argument('--output', required=True)
p.add_argument('--tokens', type=int, default=256)
a = p.parse_args()

device = 0 if torch.cuda.is_available() else -1
pipe = pipeline('text-to-audio', model=a.model, device=device, trust_remote_code=True, local_files_only=True)
kwargs = {}
if a.tokens:
    kwargs['max_new_tokens'] = max(16, min(a.tokens, 2048))
try:
    result = pipe(a.prompt, **kwargs)
except TypeError:
    result = pipe(a.prompt)
if isinstance(result, dict):
    audio = result.get('audio')
    sr = int(result.get('sampling_rate') or 32000)
else:
    audio = result
    sr = 32000
audio = np.asarray(audio)
while audio.ndim > 2:
    audio = audio[0]
if audio.ndim == 2 and audio.shape[0] < audio.shape[1] and audio.shape[0] <= 8:
    audio = audio.T
os.makedirs(os.path.dirname(a.output), exist_ok=True)
sf.write(a.output, audio, sr)
