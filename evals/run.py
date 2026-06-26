"""Run all evals and write a JSON report.

Usage (from repo root):

    python -m evals.run

Runs the STT, TTS, and E2E evals on the stub backends and writes a pretty
``evals/report.json``, printing a one-line-per-metric summary.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from stewardai.config import Settings

from .e2e_eval import run_e2e_eval
from .stt_eval import run_stt_eval
from .tts_eval import run_tts_eval

REPORT_PATH = Path(__file__).resolve().parent / "report.json"


async def run_all(settings: Settings | None = None) -> dict:
    """Run every eval and return the combined report dict."""
    stt = await run_stt_eval(settings=settings)
    tts = await run_tts_eval(settings=settings)
    e2e = await run_e2e_eval(settings=settings)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "backends": "stub",
        "stt": stt,
        "tts": tts,
        "e2e": e2e,
    }


def _print_summary(report: dict) -> None:
    stt, tts, e2e = report["stt"], report["tts"], report["e2e"]
    print("=== StewardAI eval summary (stub backends) ===")
    print(f"STT : n={stt['n']}  wer={stt['wer']}  p50_latency_ms={stt['p50_latency_ms']}")
    print(
        f"TTS : sentences={tts['sentences']}  "
        f"p50_ttfa_ms={tts['p50_ttfa_ms']}  rtf={tts['rtf']}"
    )
    print(
        f"E2E : utterances={e2e['utterances']}  detected={e2e['detected']}  "
        f"recall={e2e['endpointer_recall']}  p50_v2v_ms={e2e['p50_v2v_ms']}"
    )
    print(f"report -> {REPORT_PATH}")


def write_report(report: dict, path: Path | None = None) -> Path:
    out = path if path is not None else REPORT_PATH
    out.write_text(json.dumps(report, indent=2, sort_keys=False) + "\n")
    return out


async def main() -> dict:
    report = await run_all()
    write_report(report)
    _print_summary(report)
    return report


if __name__ == "__main__":
    asyncio.run(main())
