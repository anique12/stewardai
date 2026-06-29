#!/usr/bin/env python3
"""Score a meeting summary JSON against an expected-keywords JSON.

Usage: python scripts/score_meeting.py <summary.json> <expected.json>
"""
from __future__ import annotations

import json
import sys


def _has_all(text: str, kws: list[str]) -> bool:
    t = text.lower()
    return all(k.lower() in t for k in kws)


def score(summary: dict, expected: dict) -> dict:
    # action items: recall = fraction of expected items matched by owner + task keywords
    exp_items = expected.get("action_items", [])
    got_items = summary.get("action_items", [])
    matched = 0
    for ei in exp_items:
        for gi in got_items:
            owner_ok = ei["owner"].lower() in str(gi.get("owner", "")).lower()
            task_ok = _has_all(str(gi.get("task", "")), ei["keywords"])
            if owner_ok and task_ok:
                matched += 1
                break
    recall = matched / len(exp_items) if exp_items else 1.0
    precision = matched / len(got_items) if got_items else 0.0
    decisions_text = " ".join(summary.get("decisions", []))
    decision_hit = any(
        _has_all(decisions_text, kws)
        for kws in expected.get("decisions_keywords", [])
    )
    disc_text = " ".join(summary.get("discrepancies", []))
    discrepancy_hit = any(
        _has_all(disc_text, kws)
        for kws in expected.get("discrepancy_keywords", [])
    )
    return {
        "action_item_recall": round(recall, 3),
        "action_item_precision": round(precision, 3),
        "decision_hit": decision_hit,
        "discrepancy_hit": discrepancy_hit,
    }


def main() -> None:
    summary = json.load(open(sys.argv[1]))
    expected = json.load(open(sys.argv[2]))
    print(json.dumps(score(summary, expected), indent=2))


if __name__ == "__main__":
    main()
