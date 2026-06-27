#!/usr/bin/env bash
# Run the StewardAI web test pages locally (Mac/CPU dev), using .env (DEVICE=cpu).
# First start loads + warms the real backends (Parakeet + Kokoro on CPU) — give it
# ~30-90s, watch for `warmup_done`. Then open http://localhost:8080/pipeline
# (localhost is a secure context, so the mic works with no tunnel).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] && source .venv/bin/activate
exec python -m uvicorn web.app:app --host 127.0.0.1 --port 8080
