"""Tests for the usage-attribution contextvar."""
from __future__ import annotations

from stewardai.observability.usage_context import current_usage, usage_scope


def test_current_usage_empty_outside_scope():
    assert current_usage() == {}


def test_scope_sets_fields():
    with usage_scope(user_id="u", feature="chat", request_id="r", thread_id="t"):
        cur = current_usage()
        assert cur["user_id"] == "u"
        assert cur["feature"] == "chat"
        assert cur["request_id"] == "r"
        assert cur["thread_id"] == "t"


def test_nested_scope_restores_prior():
    with usage_scope(user_id="u", feature="chat"):
        with usage_scope(user_id="u2", feature="ask"):
            assert current_usage()["feature"] == "ask"
            assert current_usage()["user_id"] == "u2"
        assert current_usage()["feature"] == "chat"
        assert current_usage()["user_id"] == "u"
    assert current_usage() == {}
