import argparse
import base64
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoTokenizer, AutoProcessor, AutoModel, AutoModelForCausalLM

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--embedding', action='store_true')
args = parser.parse_args()

MODEL_PATH = args.model
IS_EMBEDDING = args.embedding
DEVICE = 'cuda' if torch.cuda.is_available() else ('mps' if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu')

processor = None
tokenizer = None
model = None
mode = 'causal'

try:
    processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True, local_files_only=True)
except Exception:
    processor = None

try:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True, local_files_only=True)
except Exception:
    tokenizer = None

if IS_EMBEDDING:
    model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, local_files_only=True, torch_dtype='auto')
    mode = 'embedding'
else:
    try:
        from transformers import AutoModelForImageTextToText
        model = AutoModelForImageTextToText.from_pretrained(MODEL_PATH, trust_remote_code=True, local_files_only=True, torch_dtype='auto', device_map='auto' if DEVICE == 'cuda' else None)
        mode = 'vision'
    except Exception:
        model = AutoModelForCausalLM.from_pretrained(MODEL_PATH, trust_remote_code=True, local_files_only=True, torch_dtype='auto', device_map='auto' if DEVICE == 'cuda' else None)
        mode = 'causal'

if DEVICE != 'cuda':
    model.to(DEVICE)
model.eval()


def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get('type') in ('text', 'input_text'):
                parts.append(str(p.get('text') or p.get('content') or ''))
        return '\n'.join(parts)
    return str(content or '')


def messages_prompt(messages):
    if tokenizer is not None and hasattr(tokenizer, 'apply_chat_template'):
        try:
            simple = [{'role': m.get('role', 'user'), 'content': content_text(m.get('content'))} for m in messages]
            return tokenizer.apply_chat_template(simple, tokenize=False, add_generation_prompt=True)
        except Exception:
            pass
    out = []
    for m in messages:
        out.append(f"{m.get('role', 'user').upper()}: {content_text(m.get('content'))}")
    out.append('ASSISTANT:')
    return '\n'.join(out)


def embed_texts(items):
    tok = tokenizer or processor
    if tok is None:
        raise RuntimeError('Tokenizer/processor bulunamadı.')
    batch = tok(items, return_tensors='pt', padding=True, truncation=True)
    batch = {k: v.to(DEVICE) if hasattr(v, 'to') else v for k, v in batch.items()}
    with torch.no_grad():
        outputs = model(**batch)
    hidden = getattr(outputs, 'last_hidden_state', None)
    if hidden is None:
        hidden = outputs[0]
    mask = batch.get('attention_mask')
    if mask is not None:
        mask = mask.unsqueeze(-1).expand(hidden.size()).float()
        vec = (hidden * mask).sum(1) / torch.clamp(mask.sum(1), min=1e-9)
    else:
        vec = hidden.mean(1)
    vec = torch.nn.functional.normalize(vec.float(), p=2, dim=1)
    return vec.detach().cpu().tolist()


def generate(messages, max_tokens=512, temperature=0.7):
    prompt = messages_prompt(messages)
    tok = tokenizer or processor
    if tok is None:
        raise RuntimeError('Tokenizer/processor bulunamadı.')
    inputs = tok(prompt, return_tensors='pt')
    inputs = {k: v.to(DEVICE) if hasattr(v, 'to') else v for k, v in inputs.items()}
    input_len = inputs.get('input_ids').shape[-1] if inputs.get('input_ids') is not None else 0
    kwargs = dict(max_new_tokens=max(1, min(int(max_tokens or 512), 4096)), do_sample=float(temperature or 0) > 0, temperature=max(float(temperature or 0.7), 0.01), pad_token_id=getattr(tokenizer, 'eos_token_id', None))
    with torch.no_grad():
        output = model.generate(**inputs, **kwargs)
    seq = output[0]
    if input_len:
        seq = seq[input_len:]
    return tok.decode(seq, skip_special_tokens=True).strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        return

    def send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/health':
            return self.send_json(200, {'status': 'ok', 'runtime': 'transformers-python', 'mode': mode})
        return self.send_json(404, {'error': {'message': 'Not found'}})

    def do_POST(self):
        try:
            length = int(self.headers.get('content-length') or 0)
            body = json.loads(self.rfile.read(length) or b'{}')
            if self.path == '/v1/chat/completions':
                text = generate(body.get('messages') or [], body.get('max_tokens') or body.get('max_completion_tokens') or 512, body.get('temperature', 0.7))
                return self.send_json(200, {'id': 'chatcmpl-local', 'object': 'chat.completion', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': text}, 'finish_reason': 'stop'}], 'usage': {}})
            if self.path == '/v1/embeddings':
                inp = body.get('input') or []
                if isinstance(inp, str): inp = [inp]
                vecs = embed_texts([str(x) for x in inp])
                return self.send_json(200, {'object': 'list', 'data': [{'object': 'embedding', 'index': i, 'embedding': v} for i, v in enumerate(vecs)], 'model': body.get('model') or 'local'})
            return self.send_json(404, {'error': {'message': 'Not found'}})
        except Exception as e:
            return self.send_json(500, {'error': {'message': str(e)}})


server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(json.dumps({'ready': True, 'port': args.port, 'mode': mode}), flush=True)
server.serve_forever()
