#!/usr/bin/env bash
# Set up the StewardAI venv.
#   scripts/setup.sh        # base: stubs + real LLM + web + evals (no heavy ML)
#   scripts/setup.sh cpu    # + real Parakeet/Kokoro/LiveKit on CPU
#   scripts/setup.sh cuda   # + real backends on GPU (CUDA torch)
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-base}"
PY="$(command -v python3.12 || command -v python3.11 || command -v python3)"
echo "Using $("$PY" --version) -> .venv"
"$PY" -m venv .venv
.venv/bin/python -m pip install -U pip

case "$MODE" in
  base) .venv/bin/pip install -e ".[dev]" ;;
  cpu)  .venv/bin/pip install -e ".[dev,cpu]" ;;
  cuda)
    .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cu121
    .venv/bin/pip install -e ".[dev,cuda]"
    ;;
  *) echo "Unknown mode: $MODE (use base|cpu|cuda)"; exit 1 ;;
esac

echo
echo "Done ($MODE). Next:"
echo "  cp .env.example .env   # then add GEMINI_API_KEY"
echo "  scripts/run-web.sh     # http://localhost:8080  (stub STT/TTS + real Gemini)"
echo "  .venv/bin/python -m pytest -m 'not heavy' -q"
