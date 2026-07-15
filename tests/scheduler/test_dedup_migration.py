"""Guard test: the dedup migration declares the schema later tasks depend on.
No DB runs in CI, so we assert on the migration SQL text."""
from pathlib import Path

_SQL = (
    Path(__file__).resolve().parents[2]
    / "portal/supabase/migrations/0019_meeting_dedup.sql"
).read_text()


def test_bot_status_check_includes_grouped():
    for status in ("pending", "joining", "in_meeting", "done", "failed", "grouped"):
        assert f"'{status}'" in _SQL, status


def test_adds_bot_lead_meeting_id_self_ref():
    assert "bot_lead_meeting_id" in _SQL
    assert "references public.meetings(id)" in _SQL
    assert "on delete set null" in _SQL


def test_adds_native_status_index():
    assert "meetings_native_status_idx" in _SQL
    assert "native_meeting_id" in _SQL
