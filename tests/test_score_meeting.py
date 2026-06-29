import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location(
    "score_meeting", pathlib.Path("scripts/score_meeting.py")
)
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)


def test_score_full_match():
    expected = {
        "decisions_keywords": [["launch", "monday"]],
        "action_items": [{"owner": "Sarah", "keywords": ["payments", "migration"]}],
        "discrepancy_keywords": [["friday", "monday"]],
    }
    summary = {
        "decisions": ["Launch moved to Monday"],
        "action_items": [{"owner": "Sarah", "task": "test the payments migration", "due": "Wed"}],
        "discrepancies": ["Friday vs Monday launch date"],
    }
    r = sm.score(summary, expected)
    assert r["action_item_recall"] == 1.0
    assert r["decision_hit"] is True
    assert r["discrepancy_hit"] is True
