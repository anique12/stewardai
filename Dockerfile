# StewardAI agent + web image (Linux).
# Base build (no EXTRA) = stubs + real LLM + web + evals (no heavy ML).
# GPU box: build with --build-arg EXTRA=cuda  (and run with --gpus all).
# CPU real backends: --build-arg EXTRA=cpu
FROM python:3.12-slim

ARG EXTRA=""
WORKDIR /app

# libsndfile1 -> soundfile; pulseaudio-utils -> paplay/pactl (Vexa sink playback); ffmpeg -> audio
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 pulseaudio-utils ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src
COPY web ./web
COPY evals ./evals

# For EXTRA=cuda, install CUDA torch from the proper index FIRST, then the project.
RUN if [ "$EXTRA" = "cuda" ]; then \
        pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu121 ; \
    fi \
    && pip install --no-cache-dir -e ".${EXTRA:+[$EXTRA]}"

ENV PYTHONUNBUFFERED=1
EXPOSE 8080

# Default: the web test-page server. Override command for the agent worker.
CMD ["python", "-m", "uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "8080"]
