# Deploy v1 to the GPU (L4) box

v1 = the working spike, GPU profile: **faster-whisper turbo (STT) + Piper (TTS) +
Gemini API (LLM) + LiveKit AgentSession**, `DEVICE=cuda`. Native install on a GCP
Deep Learning VM (no Docker — that's v2). LLM stays on the API; the GPU runs only
the local audio models.

Topology: this **one GPU VM** runs the whole agent. Vexa (later) lives on a
separate CPU VM and bridges audio in.

---

## 0. Prereqs
- GPU quota granted (`NVIDIA_L4_GPUS` ≥ 1 **and** `GPUS_ALL_REGIONS` ≥ 1). ✓
- `gcloud` authed to project `stewardai-500712`.

## 1. Create the VM (Deep Learning VM image = CUDA + driver preinstalled)
Use the **Ubuntu 24.04** CUDA image — it ships **Python 3.12** (our code needs ≥3.11;
the `-2204-` images are Python 3.10, too old). Driver is baked in (no install metadata).
```bash
gcloud compute instances create stewardai-gpu \
  --zone=us-central1-a \
  --machine-type=g2-standard-8 \
  --accelerator=type=nvidia-l4,count=1 \
  --maintenance-policy=TERMINATE \
  --provisioning-model=SPOT --instance-termination-action=STOP \
  --image-family=common-cu129-ubuntu-2404-nvidia-580 \
  --image-project=deeplearning-platform-release \
  --boot-disk-size=120GB
```
- **On-demand instead of Spot** (recommended for stable testing): drop the
  `--provisioning-model=SPOT --instance-termination-action=STOP` line.
- Image families change over time — if it errors, list them with
  `gcloud compute images list --project deeplearning-platform-release --format="value(family)" | grep -i cu1`
  and pick the newest `common-cuXXX-ubuntu-2404-...`.

## 2. Code is on GitHub
Repo: `github.com/anique12/stewardai` (private). Iterate later with `git push`
(Mac) → `git pull` (VM). The VM needs read auth for a private repo: a fine-grained
PAT (Contents: read, this repo only) in the clone URL, or make it public:
`gh repo edit anique12/stewardai --visibility public --accept-visibility-change-consequences`.

## 3. SSH in + clone + install  (zone = us-central1-a)
From Cloud Shell:
```bash
gcloud compute ssh stewardai-gpu --zone=us-central1-a
# on the VM:
git clone https://github_pat_TOKEN@github.com/anique12/stewardai.git   # or public URL
cd stewardai
bash scripts/setup_gpu.sh      # system deps + venv + CUDA torch + .[cuda]; a few min
```

## 4. Configure `.env` (on the VM)
```bash
cp .env.example .env
nano .env    # set:
#   GEMINI_API_KEY=<your key>
#   DEVICE=cuda
#   STT_BACKEND=faster_whisper
#   WHISPER_MODEL=large-v3-turbo
#   TTS_BACKEND=piper
#   TTS_DEFAULT_VOICE=en_US-lessac-medium
#   TURN_MIN_DELAY=0.5        # GPU STT is fast; retune after you see the metrics
#   TURN_MAX_DELAY=2.0
```

## 5. Run (on the VM)
```bash
bash scripts/run_gpu.sh
```
First start downloads the whisper-turbo CT2 model (~1.6GB) + the Piper voice, then
warms both — give it a few minutes. Watch for `warmup_done` in the logs.

## 6. Open the page in the browser (via Cloud Shell — port forward + Web Preview)
The `/pipeline` page needs the mic, which requires a secure context (HTTPS/localhost),
so don't hit the VM's public IP over HTTP. With the server running on the VM, open a
**second Cloud Shell tab** and tunnel its port 8080 to the VM (force IPv4 — `localhost`
resolves to `::1`, which Cloud Shell can't bind):
```bash
gcloud compute ssh stewardai-gpu --zone=us-central1-a -- -N -L 127.0.0.1:8080:127.0.0.1:8080
```
Leave it running, then click **Web Preview → port 8080** (top-right of Cloud Shell) and
add **`/pipeline`** to the URL. Watch the **Latency** panel; tune `TURN_MIN_DELAY` /
interruption settings in `.env` and restart `run_gpu.sh` as needed.

(From a Mac with gcloud installed instead: same command, then open `http://localhost:8080/pipeline`.)

---

## Day-to-day commands (zone = us-central1-a)
```bash
# SSH into the box
gcloud compute ssh stewardai-gpu --zone=us-central1-a

# find the zone if unsure
gcloud compute instances list

# START (before a session) / STOP (after — saves money)
gcloud compute instances start stewardai-gpu --zone=us-central1-a
gcloud compute instances stop  stewardai-gpu --zone=us-central1-a

# port-forward for the browser (Cloud Shell), then Web Preview -> 8080
gcloud compute ssh stewardai-gpu --zone=us-central1-a -- -N -L 127.0.0.1:8080:127.0.0.1:8080
```
Stopped = ~$4/mo (disk only); running on-demand ≈ $0.85/hr (Spot ≈ $0.28/hr). **Stop it
when you're done.** Note: an L4 stockout can block `start` in this zone — if so, snapshot
the disk and recreate in another zone (see Gotchas).

---

## Gotchas
- **`Unable to load libcudnn` / CTranslate2 cuDNN error:** `run_gpu.sh` already
  puts the pip cuDNN/cuBLAS on `LD_LIBRARY_PATH`. If it still fails, confirm the
  wheels installed: `python -c "import nvidia.cudnn, nvidia.cublas; print('ok')"`,
  and that CT2 wants cuDNN 9 (we pin `nvidia-cudnn-cu12>=9,<10`).
- **First turn slow:** that's the one-time model download + warmup; subsequent
  turns are warm.
- **Spot preemption:** Spot VMs can be reclaimed; for a stable test session use an
  on-demand box (step 1 note).
- **STT model choice:** to A/B Parakeet here later: `pip install -e ".[cuda,parakeet]"`
  then set `STT_BACKEND=parakeet_nemo`. (v2 isolates NeMo in its own image.)
```
