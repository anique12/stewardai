# Eval datasets

This directory holds the tiny sample dataset used by the **STT eval**
(`evals/stt_eval.py`).

## What ships here

- `clip_01.wav` … `clip_04.wav` — 4 short, 16 kHz **mono s16le** WAV clips.
- `refs.json` — maps each clip to its reference (ground-truth) transcript.

The clips are **generated on first use** (idempotent) by
`evals.datasets.ensure_dataset()`, so the repository carries no binary blobs and
`*.wav` can stay git-ignored. They are synthesized from
`stewardai.tts.stub.StubTTS` (a quiet sine tone), and each reference is set to the
**deterministic output of `stewardai.stt.stub.StubSTT`**
(`"Hello, can you hear me?"`).

## This is a wiring check, not a quality measurement

Because the stub STT returns a fixed string regardless of audio content, feeding a
stub clip through the stub STT yields **WER == 0** by construction. That validates
the whole eval path (dataset → transcribe → `jiwer.wer` → report) end-to-end —
**it does not measure real transcription accuracy.**

> **Real WER requires a real STT backend *and* real labeled audio.** The stub
> dataset's WER number is meaningless for model quality.

## Dropping in a real labeled set

1. Put real recordings here as `clip_NN.wav` — **16 kHz, mono, s16le PCM**.
   (`evals.datasets.read_clip` will down-mix and linearly resample other formats,
   but providing the canonical format avoids surprises.)
2. Replace `refs.json` with the human-verified transcripts:
   ```json
   {
     "clip_01.wav": "the actual words spoken in clip 1",
     "clip_02.wav": "the actual words spoken in clip 2"
   }
   ```
   The eval iterates clips in **`refs.json` key order**, so only clips listed there
   are scored.
3. Select a real STT backend and run the eval against your set, e.g.:
   ```python
   import asyncio
   from stewardai.config import Settings
   from evals.stt_eval import run_stt_eval

   settings = Settings(stt_backend="parakeet_nemo")  # real backend + its extra
   report = asyncio.run(run_stt_eval("path/to/real_dataset", settings=settings))
   print(report["wer"])
   ```
4. Because real `*.wav` files are git-ignored by default, either commit them with a
   `.gitignore` negation (e.g. `!evals/datasets/*.wav`) or keep the set out-of-tree
   and pass its path to `run_stt_eval(dataset_dir=...)`.
