#!/usr/bin/env bash
# Deploy the StewardAI agent on the Hetzner host. Idempotent; safe to run from CI
# (.github/workflows/deploy-agent.yml) or by hand:
#
#   cd /root/stewardai && bash scripts/deploy.sh
#
# Steps: hard-sync to origin/main, reinstall deps ONLY if the dep manifest changed,
# then restart the systemd services (see scripts/install-systemd.sh for the units).
#
# Restart policy — never cut off a live meeting:
#   * web (landing /pipeline demo) always restarts (no meeting risk).
#   * mux/scheduler/worker restart ONLY when no Google-Meet bot is in a call
#     (no running `meeting-*` container). If a meeting is live, the agents are left
#     on the OLD code and this is reported non-fatally; re-run once it ends (or
#     trigger the workflow again from the Actions tab).
set -euo pipefail
REPO=/root/stewardai
EXTRA="${STEWARD_PIP_EXTRA:-cpu,cloud}"   # box install extra; override via env if needed
cd "$REPO"

before=$(git rev-parse HEAD)
git fetch --quiet origin main
git reset --hard origin/main               # CI is authoritative; box holds no local commits
after=$(git rev-parse HEAD)
echo "deploy: ${before:0:7} -> ${after:0:7}"

if [ "$before" = "$after" ]; then
  echo "deploy: already up to date"
fi

# Reinstall deps only when the manifest actually changed (rare) — keeps deploys fast.
if ! git diff --quiet "$before" "$after" -- pyproject.toml uv.lock 2>/dev/null; then
  echo "deploy: dependency manifest changed -> pip install -e .[$EXTRA]"
  .venv/bin/pip install -e ".[$EXTRA]"
fi

echo "deploy: restarting web (landing /pipeline)"
systemctl restart stewardai-web

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^meeting-'; then
  echo "deploy: WARNING a meeting bot is LIVE -> NOT restarting agents"
  echo "deploy:          (mux/scheduler/worker stay on old code; re-run when clear)"
else
  echo "deploy: restarting agents (mux/scheduler/worker)"
  systemctl restart stewardai-mux stewardai-scheduler stewardai-worker
fi

sleep 4
echo "deploy: service states ->"
systemctl is-active stewardai-web stewardai-mux stewardai-scheduler stewardai-worker
echo "deploy.sh done"
