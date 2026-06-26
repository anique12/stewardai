#!/usr/bin/env bash
# Launch the StewardAI roomless LiveKit voice agent (needs the [cpu]/[cuda] extra).
# Reads .env for backend selection + bridge transport. Extra args pass through.
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/python -m stewardai.agent.assembly "$@"
