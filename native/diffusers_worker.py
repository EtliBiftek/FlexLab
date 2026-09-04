import argparse
import os
import torch
from diffusers import DiffusionPipeline

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--prompt', required=True)
p.add_argument('--output', required=True)
p.add_argument('--width', type=int, default=1024)
p.add_argument('--height', type=int, default=1024)
p.add_argument('--steps', type=int, default=24)
p.add_argument('--guidance', type=float, default=5.0)
p.add_argument('--negative', default='')
a = p.parse_args()

device = 'cuda' if torch.cuda.is_available() else ('mps' if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu')
dtype = torch.float16 if device == 'cuda' else torch.float32
kwargs = dict(torch_dtype=dtype, local_files_only=True)
if os.path.isdir(a.model):
    pipe = DiffusionPipeline.from_pretrained(a.model, **kwargs)
else:
    try:
        pipe = DiffusionPipeline.from_single_file(a.model, **kwargs)
    except Exception:
        from diffusers import StableDiffusionPipeline
        pipe = StableDiffusionPipeline.from_single_file(a.model, **kwargs)
pipe = pipe.to(device)
if hasattr(pipe, 'enable_attention_slicing'):
    pipe.enable_attention_slicing()
call = dict(prompt=a.prompt, width=max(64, a.width), height=max(64, a.height), num_inference_steps=max(1, a.steps))
if a.negative:
    call['negative_prompt'] = a.negative
try:
    call['guidance_scale'] = a.guidance
    result = pipe(**call)
except TypeError:
    call.pop('guidance_scale', None)
    result = pipe(**call)
image = result.images[0]
os.makedirs(os.path.dirname(a.output), exist_ok=True)
image.save(a.output)
