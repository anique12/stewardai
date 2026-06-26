"""Eval-harness wiring tests (stub backends, no heavy deps, no network)."""

from __future__ import annotations

import jiwer
from evals.e2e_eval import run_e2e_eval
from evals.run import main, run_all
from evals.stt_eval import run_stt_eval
from evals.tts_eval import run_tts_eval


def test_jiwer_identity_is_zero():
    assert jiwer.wer("hello world", "hello world") == 0


async def test_run_stt_eval_returns_expected_keys(tmp_path):
    report = await run_stt_eval(dataset_dir=tmp_path)
    assert set(report) >= {"n", "wer", "p50_latency_ms"}
    assert report["n"] >= 3
    # Stub clips transcribe to their reference -> perfect WER (wiring check).
    assert report["wer"] == 0
    assert isinstance(report["p50_latency_ms"], float)
    assert len(report["per_clip"]) == report["n"]


async def test_run_tts_eval_returns_expected_keys():
    report = await run_tts_eval()
    assert set(report) >= {"sentences", "p50_ttfa_ms", "rtf"}
    assert report["sentences"] >= 1
    assert report["rtf"] > 0


async def test_run_e2e_eval_detects_utterances():
    report = await run_e2e_eval()
    assert report["utterances"] == report["detected"]  # endpointer fires on each
    assert report["endpointer_recall"] == 1.0
    assert report["p50_v2v_ms"] >= 0.0


async def test_run_all_report_has_top_level_keys():
    report = await run_all()
    assert set(report) >= {"stt", "tts", "e2e"}
    assert set(report["stt"]) >= {"n", "wer", "p50_latency_ms"}
    assert set(report["tts"]) >= {"sentences", "p50_ttfa_ms", "rtf"}
    assert set(report["e2e"]) >= {"utterances", "detected", "p50_v2v_ms"}


async def test_main_writes_report(tmp_path, monkeypatch):
    import evals.run as run_mod

    report_path = tmp_path / "report.json"
    monkeypatch.setattr(run_mod, "REPORT_PATH", report_path)
    report = await main()
    assert set(report) >= {"stt", "tts", "e2e"}
    assert report_path.exists()
    import json

    on_disk = json.loads(report_path.read_text())
    assert on_disk["stt"]["n"] == report["stt"]["n"]
