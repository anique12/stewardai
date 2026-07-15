from __future__ import annotations

from stewardai.email.suppressions import is_suppressed


class _Client:
    def __init__(self, hit):
        self._hit = hit

    def table(self, _):
        return self

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def limit(self, *_):
        return self

    async def execute(self):
        return type("R", (), {"data": [{"email": "x@y.com"}] if self._hit else []})()


async def test_suppressed_true_when_present():
    assert await is_suppressed(_Client(True), "x@y.com") is True


async def test_suppressed_false_when_absent():
    assert await is_suppressed(_Client(False), "x@y.com") is False
