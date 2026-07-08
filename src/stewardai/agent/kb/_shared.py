from __future__ import annotations

from typing import Any

# space_facts.kind has a DB CHECK constraint; only these values are allowed.
FACT_KINDS = frozenset({"action_item", "decision", "date", "risk", "open_question"})


def coerce_seq(value: Any) -> int | None:
    """Keep only real integer transcript indices; everything else → None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None
