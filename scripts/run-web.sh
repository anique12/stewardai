#!/usr/bin/env bash
# Launch the StewardAI test-page server (stub backends, no heavy deps).
# Pass extra uvicorn flags through, e.g. --reload.
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/python -m uvicorn web.app:app --host 0.0.0.0 --port 8080 "$@"
