# Deploying StewardAI

Two independent targets:

| Component | Where | How |
|---|---|---|
| **Portal** (Next.js app + landing) | **Vercel** | Auto-deploys on push to `main` (Root Directory = `portal`). |
| **Agent backend** (mux / scheduler / worker / web demo) | **Hetzner** `178.105.237.89`, `/root/stewardai` | systemd services; deployed by CI on push to `main` (agent paths only). |

## Agent backend (Hetzner)

Four systemd units (defined in `deploy/systemd/`, logs kept at `/tmp/steward-*.log`
so the Loki/Alloy tail still works):

| Service | Module | Port | Log |
|---|---|---|---|
| `stewardai-mux` | `stewardai.agent.meeting_runner` | 8765 | `/tmp/steward-mux.log` |
| `stewardai-scheduler` | `stewardai.scheduler.meeting_scheduler` | — | `/tmp/steward-sched.log` |
| `stewardai-worker` | `stewardai.scheduler.action_worker` | — | `/tmp/steward-worker.log` |
| `stewardai-web` | `uvicorn web.app:app` (landing `/pipeline`) | 8080 | `/tmp/steward-web.log` |

### CI/CD (GitHub Actions)

`.github/workflows/deploy-agent.yml` runs on push to `main` touching `src/**`,
`web/**`, `scripts/deploy.sh`, `deploy/systemd/**`, `pyproject.toml`, or `uv.lock`
(and via the manual **Run workflow** button). It SSHes to the box and runs
`scripts/deploy.sh`, which:

1. hard-syncs to `origin/main`,
2. reinstalls deps **only if** the manifest changed (`pip install -e .[cpu,cloud]`),
3. restarts `stewardai-web` always, and the agents **only when no meeting is live**
   (no running `meeting-*` bot container) so a live meeting is never cut off.

**Required repo secrets** (Settings → Secrets and variables → Actions):
`HETZNER_HOST`, `HETZNER_USER`, `HETZNER_SSH_KEY` (a dedicated ed25519 deploy key
whose public half is in the box's `/root/.ssh/authorized_keys`).

The deploy key is **command-restricted**: its `authorized_keys` line is prefixed with
`restrict,command="cd /root/stewardai && bash scripts/deploy.sh"`, so even if the
private key leaked it can only run the deploy — no shell, scp, port/agent/X11
forwarding, or PTY. Revoke it by deleting that one line (admin key is separate).

### First-time setup (already done)

```bash
# On the box, once, to convert the old bare processes to systemd:
cd /root/stewardai && bash scripts/install-systemd.sh
```

### Manual deploy / ops

```bash
ssh root@178.105.237.89 'cd /root/stewardai && bash scripts/deploy.sh'   # same as CI
systemctl status stewardai-mux                                            # health
systemctl restart stewardai-web                                           # single service
journalctl -u stewardai-mux -f                                            # or tail /tmp/steward-mux.log
```

If a deploy skipped the agents because a meeting was live, just re-run the workflow
(or `scripts/deploy.sh`) once the meeting ends.
