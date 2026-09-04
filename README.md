# FlexLab

FlexLab is a desktop-first local multimodal AI studio: download models, run them locally, and expose them to other apps through OpenAI-, Anthropic-, and LM Studio-compatible APIs.

## What is real

- GGUF LLM/VLM/embedding/reranker execution through `llama.cpp` / `llama-server`
- Hugging Face public, gated and private downloads with token auth, revision pinning, resumable downloads and SHA-256 checks when LFS hashes are available
- GGUF metadata parsing for architecture, context and capability detection
- Multi-instance model loading, JIT loading, idle TTL and auto-eviction
- RAM/VRAM hardware detection and load-time memory estimates
- Reasoning controls and vision/mmproj support when the model/runtime supports them
- `@Web` retrieval augmented chat for any local LLM
- MCP tools for `/api/v1/chat`
- Image generation/editing through `stable-diffusion.cpp`, including multi-component Qwen Image/Edit, FLUX, Mage-Flow, SD3 and related pipelines when required files are present
- MusicGen generation through a local Python/PyTorch worker
- Hashed multi-token API authentication, optional LAN serving and CORS controls
- Electron desktop application with tray, Windows startup option, updater integration and GitHub Actions Windows builds

FlexLab does not silently fall back to a cloud model. Unsupported or incomplete local pipelines return an explicit error.

## Development

```bash
npm install
npm run dev:real
```

Desktop development:

```bash
npm run desktop:dev
```

Validation/build:

```bash
npm run typecheck
npm run check:native
npm test
npm run desktop:build
```

The Windows build is written to `release/`.

## API

By default the native daemon listens on `http://127.0.0.1:1234`.

Important endpoints include:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `POST /v1/messages`
- `POST /reranking`
- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /api/v1/chat`
- `POST /api/v1/models/load`
- `POST /api/v1/models/unload`
- `POST /api/v1/models/download`

Management endpoints are loopback-only and require a random per-launch management token shared only with the FlexLab desktop renderer. Public APIs can be protected with scoped `flx-` tokens.

## Data

FlexLab stores its local state under `~/.flexlab-studio`. A legacy `~/.helix-studio` directory is migrated automatically when possible.
