#!/usr/bin/env bash
# One-time (idempotent) migration of the StewardAI host processes from bare
# `setsid` background jobs to systemd management on the Hetzner box.
#
#   Run on the box:  cd /root/stewardai && bash scripts/install-systemd.sh
#
# After this, the 4 services survive reboots + auto-restart on crash, and deploys
# are just `systemctl restart` (see scripts/deploy.sh). Logs stay at
# /tmp/steward-*.log so the existing Loki/Alloy tail keeps working.
set -euo pipefail
REPO=/root/stewardai
cd "$REPO"

echo "== installing unit files =="
cp deploy/systemd/stewardai-mux.service \
   deploy/systemd/stewardai-scheduler.service \
   deploy/systemd/stewardai-worker.service \
   deploy/systemd/stewardai-web.service \
   /etc/systemd/system/
systemctl daemon-reload

echo "== stopping any bare (non-systemd) processes so systemd can own the ports =="
pkill -f "stewardai.agent.meeting_runner"      2>/dev/null || true
pkill -f "stewardai.scheduler.meeting_scheduler" 2>/dev/null || true
pkill -f "stewardai.scheduler.action_worker"   2>/dev/null || true
pkill -f "uvicorn web.app:app"                 2>/dev/null || true
for port in 8765 8080; do
  for _ in $(seq 1 30); do ss -ltn 2>/dev/null | grep -q ":$port " || break; sleep 0.5; done
done

echo "== enabling + starting units =="
systemctl enable --now \
  stewardai-mux stewardai-scheduler stewardai-worker stewardai-web

sleep 5
systemctl is-active stewardai-mux stewardai-scheduler stewardai-worker stewardai-web
echo "install-systemd.sh done"
