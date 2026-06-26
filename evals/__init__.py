"""Offline evaluation harness for StewardAI voice components.

Runs entirely on the stub backends (no heavy ML deps, no network), so the suite
executes on any laptop. Real WER/latency numbers require real backends + real
labeled audio (see ``evals/datasets/README.md``).
"""
