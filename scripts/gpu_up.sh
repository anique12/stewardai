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
# Persist the steward bot image in ~/vexa/.env so any later `make up`/recreate uses it.
# A bare `export` does NOT survive a recreate — runtime-api then falls back to the stock
# :latest bot (no full-duplex forwarder), which was the root cause of a long GPU debug.
if [ -f "$VEXA_DIR/.env" ]; then
  if grep -q '^BROWSER_IMAGE=' "$VEXA_DIR/.env"; then
    sed -i 's|^BROWSER_IMAGE=.*|BROWSER_IMAGE=vexaai/vexa-bot:steward|' "$VEXA_DIR/.env"
  else
    echo 'BROWSER_IMAGE=vexaai/vexa-bot:steward' >> "$VEXA_DIR/.env"
  fi
fi
# The steward compose override (host redis publish + profiles.yaml mount carrying the
# bridge env) is required for the bot to reach the mux. Recreate it if a fresh clone is
# missing it (it was historically gitignored) — else the base profiles.yaml with NO
# bridge env gets mounted and the bot never connects to the mux.
OVERRIDE_FILE="$VEXA_DIR/deploy/compose/docker-compose.override.yml"
if [ ! -f "$OVERRIDE_FILE" ]; then
  echo "   creating missing docker-compose.override.yml"
  cat > "$OVERRIDE_FILE" <<'OVR'
services:
  redis:
    ports:
      - "6380:6379"
  runtime-api:
    user: "0:0"
    environment:
      - MIN_AUDIO_DURATION_SEC=${MIN_AUDIO_DURATION_SEC:-0.5}
      - SUBMIT_INTERVAL_SEC=${SUBMIT_INTERVAL_SEC:-0.5}
      - IDLE_TIMEOUT_SEC=${IDLE_TIMEOUT_SEC:-0.5}
    volumes:
      - ./profiles.yaml:/app/profiles.yaml:ro
OVR
fi
# Use our freshly-built bot image (with the mic fix) instead of the DockerHub default.
export BROWSER_IMAGE="vexaai/vexa-bot:steward"
# Run up + init-db + setup-api-key, but NOT the final 'test' target — its
# transcription self-test hits vexa.ai and 403s (we bypass Vexa transcription),
# which would otherwise abort this script. These sub-targets are idempotent.
( cd "$VEXA_DIR" && make -C deploy/compose up init-db setup-api-key )

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
