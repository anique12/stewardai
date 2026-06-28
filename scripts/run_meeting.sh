#!/usr/bin/env bash
# Run the StewardAI meeting voice agent (Vexa topology-A).
#
# The agent starts a TCP server on BRIDGE_TCP_PORT and waits for the patched
# Vexa bot's forwarder to connect. Inbound meeting audio is transcribed and fed
# to the gated LLM (speak only when addressed); when it speaks, TTS PCM is streamed
# back over the SAME connection and the bot mic is toggled via Redis.
#
# Configure via .env: VEXA_MEETING_ID, STT_BACKEND, TTS_BACKEND, GEMINI_API_KEY,
# BRIDGE_TCP_HOST/PORT, REDIS_URL, DEVICE. See docs/RUNBOOK-vexa-meeting.md.
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate

# CTranslate2 (faster-whisper) needs the pip-installed cuDNN/cuBLAS on the lib
# path on a GPU box; harmless (and skipped) when those wheels aren't present.
CUDNN_LIB="$(python -c 'import os,nvidia.cudnn; print(os.path.join(os.path.dirname(nvidia.cudnn.__file__),"lib"))' 2>/dev/null || true)"
CUBLAS_LIB="$(python -c 'import os,nvidia.cublas; print(os.path.join(os.path.dirname(nvidia.cublas.__file__),"lib"))' 2>/dev/null || true)"
export LD_LIBRARY_PATH="${CUDNN_LIB}:${CUBLAS_LIB}:${LD_LIBRARY_PATH:-}"

exec python -m stewardai.agent.meeting_runner
