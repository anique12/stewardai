#!/usr/bin/env bash
# Run the StewardAI web/agent server on the GPU box.
# Exposes the pip-installed cuDNN/cuBLAS to CTranslate2 (faster-whisper) so it
# doesn't fall back to a mismatched system cuDNN.
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate

# Point CTranslate2 at the pip nvidia libs (cuDNN 9 + cuBLAS for CUDA 12).
CUDNN_LIB="$(python -c 'import os,nvidia.cudnn; print(os.path.join(os.path.dirname(nvidia.cudnn.__file__),"lib"))' 2>/dev/null || true)"
CUBLAS_LIB="$(python -c 'import os,nvidia.cublas; print(os.path.join(os.path.dirname(nvidia.cublas.__file__),"lib"))' 2>/dev/null || true)"
export LD_LIBRARY_PATH="${CUDNN_LIB}:${CUBLAS_LIB}:${LD_LIBRARY_PATH:-}"

exec python -m uvicorn web.app:app --host 0.0.0.0 --port 8080
