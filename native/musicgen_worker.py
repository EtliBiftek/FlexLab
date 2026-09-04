import argparse
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--prompt', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--tokens', type=int, default=256)
    ap.add_argument('--guidance', type=float, default=3.0)
    args = ap.parse_args()

    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    from scipy.io import wavfile

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if device == 'cuda' else torch.float32
    print(f'FLEXLAB device={device}', flush=True)
    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True)
    model = MusicgenForConditionalGeneration.from_pretrained(
        args.model,
        local_files_only=True,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    ).to(device)
    inputs = processor(text=[args.prompt], padding=True, return_tensors='pt')
    inputs = {k: v.to(device) if hasattr(v, 'to') else v for k, v in inputs.items()}
    with torch.inference_mode():
        audio_values = model.generate(
            **inputs,
            do_sample=True,
            guidance_scale=args.guidance,
            max_new_tokens=max(32, min(args.tokens, 1500)),
        )
    audio = audio_values[0, 0].detach().float().cpu().numpy()
    rate = int(model.config.audio_encoder.sampling_rate)
    peak = max(float(abs(audio).max()), 1e-8)
    pcm16 = (audio / max(1.0, peak) * 32767.0).astype('int16')
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    wavfile.write(args.output, rate, pcm16)
    print(f'FLEXLAB output={args.output}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'FLEXLAB_ERROR {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        raise
