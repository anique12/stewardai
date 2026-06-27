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

## 2. Ship the code (no git remote — tar + scp)
On your **Mac**:
```bash
cd ~/projects
tar --exclude='stewardai/.venv' --exclude='stewardai/.git' --exclude='stewardai/.env' \
    --exclude='stewardai/**/__pycache__' -czf /tmp/stewardai.tgz stewardai
gcloud compute scp /tmp/stewardai.tgz stewardai-gpu:~ --zone=us-central1-a
gcloud compute ssh stewardai-gpu --zone=us-central1-a --command="tar -xzf ~/stewardai.tgz"
```

## 3. Install (on the VM)
```bash
gcloud compute ssh stewardai-gpu --zone=us-central1-a
# now on the VM:
cd ~/stewardai
bash scripts/setup_gpu.sh      # venv + CUDA torch + .[cuda]; ~a few minutes
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

## 6. Test from your laptop (SSH tunnel — don't open 8080 to the internet)
In a second terminal on your **Mac**:
```bash
gcloud compute ssh stewardai-gpu --zone=us-central1-a -- -N -L 8080:localhost:8080
```
Then open **http://localhost:8080/pipeline**, click Talk. Watch the **Latency**
panel — the EOU/STT numbers should now be a fraction of the CPU values. If turns
feel laggy or too eager, tune `TURN_MIN_DELAY` in `.env` and restart `run_gpu.sh`.

## 7. STOP the VM when done (it costs money running)
```bash
gcloud compute instances stop stewardai-gpu --zone=us-central1-a
```
Stopped = ~$4/mo (disk only). Spot on-demand ≈ $0.28/hr while running.

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
