"""Agent-specific fixtures.

Heavy fixtures require livekit.agents (installed in the [cpu]/[cuda] extra).
"""

from __future__ import annotations

import pytest


@pytest.fixture
def make_chat_ctx():
    """Factory: ``make_chat_ctx(text)`` returns a ``ChatContext`` with one user message.

    Verified against livekit-agents v1.x:
        ``ChatContext.empty()`` + ``.add_message(role="user", content=<str>)``
    Content is stored as ``["<str>"]`` (list-of-str), which ``_chat_ctx_to_messages``
    already handles via ``_content_to_text``.
    """
    from livekit.agents import llm  # type: ignore

    def _factory(text: str):
        ctx = llm.ChatContext.empty()
        ctx.add_message(role="user", content=text)
        return ctx

    return _factory
