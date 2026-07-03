"""Pure, testable filing logic: score candidate Spaces and choose an action.

No DB or LLM here — callers precompute signal scores (from filing_hints + entity
overlap) and pass them in. Keeping this pure makes the confidence-graduated rule
(recurring -> auto -> auto_created -> suggested -> unfiled) trivial to unit-test.
"""
from __future__ import annotations

from dataclasses import dataclass

HIGH_CONFIDENCE = 0.75
LOW_CONFIDENCE = 0.40


@dataclass(frozen=True)
class SpaceCandidate:
    space_id: str
    score: float
    reason: str


@dataclass(frozen=True)
class FilingDecision:
    action: str  # "recurring" | "auto" | "auto_created" | "suggested" | "unfiled"
    space_id: str | None
    confidence: float
    reason: str
    new_space_name: str | None = None


def score_candidates(*, hint_scores: dict[str, float]) -> list[SpaceCandidate]:
    """Turn {space_id: raw_score} into clamped, descending SpaceCandidates."""
    cands = [
        SpaceCandidate(space_id=sid, score=max(0.0, min(1.0, s)), reason="signal match")
        for sid, s in hint_scores.items()
    ]
    return sorted(cands, key=lambda c: c.score, reverse=True)


def decide_filing(
    *,
    recurring_space_id: str | None,
    candidates: list[SpaceCandidate],
    new_thread_name: str | None,
) -> FilingDecision:
    """Apply the confidence-graduated rule. Order matters:

    1. recurring series -> inherit (silent).
    2. top existing candidate >= HIGH -> auto-file (an existing match always beats
       spawning a duplicate).
    3. else a confident brand-new thread -> auto-create.
    4. else top candidate >= LOW -> suggest (Unfiled tray with a one-tap guess).
    5. else -> unfiled.
    """
    if recurring_space_id:
        return FilingDecision("recurring", recurring_space_id, 1.0, "recurring series")
    top = candidates[0] if candidates else None
    if top and top.score >= HIGH_CONFIDENCE:
        return FilingDecision("auto", top.space_id, top.score, top.reason)
    if new_thread_name:
        return FilingDecision("auto_created", None, HIGH_CONFIDENCE, "new thread",
                              new_space_name=new_thread_name)
    if top and top.score >= LOW_CONFIDENCE:
        return FilingDecision("suggested", top.space_id, top.score, top.reason)
    return FilingDecision("unfiled", None, top.score if top else 0.0, "no confident match")
