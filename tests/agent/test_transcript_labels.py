"""Transcript speaker-label hygiene in the meeting runner.

- The bot's own line must not carry a "[Name]:" prefix the LLM echoed from the
  transcript context (`_record_bot_line` strips it).
- A turn that finalized before diarization had a name shows generic "[Speaker]:";
  in a 1:1 (one human + the bot) that should be relabeled to the human
  (`_relabel_sole_human`).
"""
from __future__ import annotations

from stewardai.agent.meeting_runner import _LEADING_LABEL_RE, _relabel_sole_human


def _strip_label(text: str) -> str:
    return _LEADING_LABEL_RE.sub("", text).strip()


def test_leading_label_stripped_from_bot_text():
    assert _strip_label("[Anique]: I'm doing well, thanks.") == "I'm doing well, thanks."
    assert _strip_label("[Anique Sabir]: hi") == "hi"


def test_leading_label_leaves_normal_text_untouched():
    assert _strip_label("I'm doing well.") == "I'm doing well."
    # only a LEADING label is stripped; brackets mid-sentence are kept
    assert _strip_label("See [1] for details") == "See [1] for details"


def test_relabel_sole_human_fixes_first_speaker_line():
    transcript = [
        "[Speaker]: Hello, how are you?",
        "[MeetBase]: I'm well.",
        "[Anique Sabir]: Can you draft an email?",
    ]
    out = _relabel_sole_human(transcript, "MeetBase")
    assert out[0] == "[Anique Sabir]: Hello, how are you?"
    assert out[1] == "[MeetBase]: I'm well."  # bot line untouched
    assert out[2] == "[Anique Sabir]: Can you draft an email?"


def test_relabel_noop_with_multiple_humans():
    transcript = [
        "[Speaker]: Hi.",
        "[Anique Sabir]: Hello.",
        "[Bob]: Hey.",
        "[MeetBase]: Welcome.",
    ]
    # Two humans → ambiguous → leave "Speaker" as-is.
    assert _relabel_sole_human(transcript, "MeetBase") == transcript


def test_relabel_noop_when_no_human_named():
    transcript = ["[Speaker]: Hi.", "[MeetBase]: Hello."]
    assert _relabel_sole_human(transcript, "MeetBase") == transcript
