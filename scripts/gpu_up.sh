#!/usr/bin/env bash
# Full GPU startup for the StewardAI meeting agent:
#   1) build the Vexa bot image (vexaai/vexa-bot:steward)
#   2) bring up the Vexa stack (gateway, runtime-api, redis, postgres, ...)
#   3) start the agent on the GPU — multiplexer + scheduler + action worker
#      with local whisper (STT) + kokoro (TTS)
#
# Prereqs:
#   - scripts/setup_gpu.sh already run  (creates .venv + installs .[cuda] + CUDA torch)
#   - .env configured                    (scripts/gpu_env.sh + your secret keys)
#   - Docker running
#   - vexa repo checked out to the steward branch (feat/steward-fullduplex or main)
#
# Override with env vars: VEXA_DIR (default ~/vexa), LOG_DIR (default /tmp).
set -euo pipefail
cd "$(dirname "$0")/.."
VEXA_DIR="${VEXA_DIR:-$HOME/vexa}"
LOG_DIR="${LOG_DIR:-/tmp}"

[ -d .venv ] || { echo "!! .venv missing — run scripts/setup_gpu.sh first"; exit 1; }
[ -f .env ]  || { echo "!! .env missing — run scripts/gpu_env.sh + add your secrets"; exit 1; }
[ -d "$VEXA_DIR/services/vexa-bot" ] || { echo "!! VEXA_DIR=$VEXA_DIR has no services/vexa-bot — set VEXA_DIR"; exit 1; }
docker info >/dev/null 2>&1 || { echo "!! Docker is not running"; exit 1; }

echo "== 1/4  build the Vexa bot image (vexaai/vexa-bot:steward) =="
docker build -f "$VEXA_DIR/services/vexa-bot/Dockerfile" \
  -t vexaai/vexa-bot:steward "$VEXA_DIR/services/vexa-bot"

echo "== 2/4  bring up the Vexa stack (its own Makefile — creates ~/vexa/.env, sets"
echo "        IMAGE_TAG/BROWSER_IMAGE, pulls core images, inits DB, sets API key) =="
# Ensure ~/vexa/.env exists (env target creates it from the template, no preflight).
( cd "$VEXA_DIR" && make -C deploy/compose env >/dev/null 2>&1 || true )
# StewardAI bypasses Vexa's own transcription (our agent does STT via whisper), so
# skip the transcription-token preflight with Vexa's CI escape hatch.
if [ -f "$VEXA_DIR/.env" ]; then
  if grep -q '^TRANSCRIPTION_SERVICE_TOKEN=' "$VEXA_DIR/.env"; then
    sed -i 's|^TRANSCRIPTION_SERVICE_TOKEN=.*|TRANSCRIPTION_SERVICE_TOKEN=ci-placeholder|' "$VEXA_DIR/.env"
  else
    echo 'TRANSCRIPTION_SERVICE_TOKEN=ci-placeholder' >> "$VEXA_DIR/.env"
  fi
fi
# Use our freshly-built bot image (with the mic fix) instead of the DockerHub default.
export BROWSER_IMAGE="vexaai/vexa-bot:steward"
( cd "$VEXA_DIR" && make all )

echo "== 3/4  activate venv + expose CUDA libs to CTranslate2 (faster-whisper) =="
# shellcheck disable=SC1091
source .venv/bin/activate
CUDNN_LIB="$(python -c 'import os,nvidia.cudnn; print(os.path.join(os.path.dirname(nvidia.cudnn.__file__),"lib"))' 2>/dev/null || true)"
CUBLAS_LIB="$(python -c 'import os,nvidia.cublas; print(os.path.join(os.path.dirname(nvidia.cublas.__file__),"lib"))' 2>/dev/null || true)"
export LD_LIBRARY_PATH="${CUDNN_LIB}:${CUBLAS_LIB}:${LD_LIBRARY_PATH:-}"

echo "== 4/4  start the agent (mux + scheduler + worker); logs in $LOG_DIR =="
nohup python -m stewardai.agent.meeting_runner        >> "$LOG_DIR/steward-mux.log"    2>&1 & echo "  mux        pid $!"
nohup python -m stewardai.scheduler.meeting_scheduler >> "$LOG_DIR/steward-sched.log"  2>&1 & echo "  scheduler  pid $!"
nohup python -m stewardai.scheduler.action_worker     >> "$LOG_DIR/steward-worker.log" 2>&1 & echo "  worker     pid $!"

echo ""
echo "Up. First run downloads whisper large-v3 (~3GB) + compiles kokoro on first synth."
echo "  watch latency:  tail -f $LOG_DIR/steward-mux.log | grep --line-buffered turn_latency"
echo "  stop agent:     pkill -f 'stewardai.agent.meeting_runner|stewardai.scheduler'"
