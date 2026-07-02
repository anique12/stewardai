#!/usr/bin/env bash
# Configure .env for the GPU deployment (local whisper STT + kokoro TTS).
#
# Idempotent: upserts each config key (replaces if present, appends if missing).
# Does NOT touch or overwrite your SECRET keys — it only reports which are missing.
# Run once on the GPU box after cloning + scripts/setup_gpu.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import pathlib, re

env = pathlib.Path(".env")
text = env.read_text() if env.exists() else ""

# Non-secret config for the GPU (local whisper + kokoro) deployment.
config = {
    # compute + local STT/TTS
    "DEVICE": "cuda",
    "STT_BACKEND": "whisper",
    "TTS_BACKEND": "kokoro",
    "WHISPER_MODEL": "large-v3",          # or distil-large-v3 for lower latency
    "TTS_DEFAULT_VOICE": "af_heart",
    "LLM_BACKEND": "litellm",
    # turn timing / recognition
    "TURN_MIN_DELAY": "0.8",
    "TURN_MAX_DELAY": "3.0",
    "INTERRUPTION_MIN_DURATION": "0.6",
    "STT_KEYTERMS": "Anique,Sabir,Steward",
    # bridge + co-located Vexa infra (adjust ports to your Vexa compose)
    "BRIDGE_TRANSPORT": "tcp",
    "BRIDGE_TCP_HOST": "0.0.0.0",
    "BRIDGE_TCP_PORT": "8765",
    "VEXA_PLATFORM": "google_meet",
    "VEXA_GATEWAY_URL": "http://localhost:8056",
    "REDIS_URL": "redis://localhost:6380",
    "PLAYBACK_SAMPLE_RATE": "16000",
    # logging
    "LOG_LEVEL": "info",
    "LOG_FORMAT": "json",
}

seen, out = set(), []
for line in text.splitlines():
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if m and m.group(1) in config:
        k = m.group(1)
        out.append(f"{k}={config[k]}")
        seen.add(k)
    else:
        out.append(line)
for k, v in config.items():
    if k not in seen:
        out.append(f"{k}={v}")

env.write_text("\n".join(out).rstrip("\n") + "\n")

print("Configured .env for GPU (whisper + kokoro):")
for k, v in config.items():
    print(f"  {k}={v}")

new = env.read_text()
secrets = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
           "COMPOSIO_API_KEY", "VEXA_API_KEY"]
missing = [k for k in secrets if not re.search(rf"^{k}=.+", new, re.M)]
print()
if missing:
    print("!! MISSING secrets — add these to .env yourself:")
    for k in missing:
        print(f"     {k}=...")
else:
    print("All required secrets present.")
print("(Local STT/TTS: DEEPGRAM_API_KEY / CARTESIA_API_KEY are NOT needed.)")
PY
