#!/usr/bin/env bash
# One-time setup on the GPU (L4) box. Assumes a GCP Deep Learning VM image with
# CUDA + driver preinstalled (e.g. common-cu129-ubuntu-2404-nvidia-580 — Ubuntu
# 24.04 / Python 3.12). Confirm the GPU with `nvidia-smi`.
# Run from the repo root after the code is on the VM:  bash scripts/setup_gpu.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> nvidia-smi (driver/GPU check)"
nvidia-smi || { echo "No GPU/driver visible — wrong image?"; exit 1; }

# System deps: espeak-ng is REQUIRED by Piper + Kokoro (phonemization);
# libsndfile1 for soundfile; ffmpeg for audio; venv/pip for the env.
echo "==> apt system deps (espeak-ng, libsndfile1, ffmpeg, venv)"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
    espeak-ng libsndfile1 ffmpeg python3-venv python3-pip git

# Use the SYSTEM python 3.12 (Ubuntu 24.04), not the DLVM's conda env.
PYBIN=/usr/bin/python3
echo "==> python: $($PYBIN --version)"

echo "==> venv + deps"
"$PYBIN" -m venv .venv
source .venv/bin/activate
pip install -U pip wheel

# CUDA torch from the CUDA index (works with the recent driver), then the cuda extra.
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -e ".[cuda]"

echo "==> verifying CUDA + cuDNN wheels"
python - <<'PY'
import torch, importlib.util
print("torch:", torch.__version__, "cuda available:", torch.cuda.is_available())
for mod in ("nvidia.cudnn", "nvidia.cublas"):
    print(f"{mod}:", "OK" if importlib.util.find_spec(mod) else "MISSING")
PY

echo
echo "==> Done. Next:"
echo "   cp .env.example .env   # set: DEVICE=cuda, STT_BACKEND=faster_whisper,"
echo "                          # WHISPER_MODEL=large-v3-turbo, TTS_BACKEND=piper,"
echo "                          # TURN_MIN_DELAY=0.5, GEMINI_API_KEY=..."
echo "   bash scripts/run_gpu.sh"
