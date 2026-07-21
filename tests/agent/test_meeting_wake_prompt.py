"""The meeting system prompt must gate speech on the wake NAME, not on any
"directed question" — otherwise the bot false-wakes on ambient questions between
other participants (see meeting 22f65313: bot answered a question Zeeshan asked John).

Spec: docs/superpowers/specs/2026-07-21-meeting-wake-gating-design.md
"""

from __future__ import annotations

from stewardai.agent.assembly import build_meeting_system


def test_loophole_clause_removed() -> None:
    p = build_meeting_system("Steward")
    # The exact loophole that let a name-less question wake the bot.
    assert "clearly directs a question or request at you" not in p
    assert "or by clearly asking you something" not in p


def test_wake_requires_name() -> None:
    p = build_meeting_system("Steward")
    assert "WAKE only when someone says your name" in p


def test_silence_rules_present() -> None:
    p = build_meeting_system("Steward")
    # another participant named -> their question, not ours
    assert "another participant BY NAME" in p
    # someone else answers a question we thought was ours -> stay quiet
    assert "another participant answers it" in p


def test_followup_continuity_and_conflict_kept() -> None:
    p = build_meeting_system("Steward")
    assert "can you hear me?" in p  # follow-up continuity preserved
    assert "MATERIAL discrepancy" in p  # conflict trigger preserved


def test_wake_scopes_to_current_turn() -> None:
    p = build_meeting_system("Steward")
    assert "answer ONLY the request in the turn that just addressed you" in p
    assert "NOT a backlog" in p


def test_anti_echo_instruction_present() -> None:
    p = build_meeting_system("Steward")
    assert "do NOT continue the transcript" in p
    assert "ONLY the words you will say aloud" in p


def test_uses_display_name() -> None:
    p = build_meeting_system("Jarvis")
    assert 'says your name ("Jarvis")' in p
