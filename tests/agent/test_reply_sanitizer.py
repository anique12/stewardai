"""The reply sanitizer strips transcript-echo artifacts the gating model sometimes
leaks into its spoken reply — e.g. "Hello, how are you? [StewardAI]: I'm doing well"
(meeting a1330b42), where the model echoed the user's line + a self-label before its
answer. Only the actual reply should reach TTS.
"""

from __future__ import annotations

from stewardai.agent.nodes import _ReplySanitizer


def _run(chunks: list[str], last_user: str = "") -> str:
    s = _ReplySanitizer(last_user)
    out = "".join(s.feed(c) for c in chunks)
    return out + s.flush()


def test_drops_echo_and_self_label() -> None:
    # The exact observed failure, streamed as one chunk.
    got = _run(
        ["Hello. Hey there. How are you doing? [StewardAI]: I'm doing well, thanks!"],
        last_user="[Anique]: Hello. Hey there. How are you doing?",
    )
    assert got == "I'm doing well, thanks!"


def test_drops_echo_across_chunks_and_split_label() -> None:
    got = _run(
        ["Hello there. ", "[Stew", "ardAI]: ", "How can I ", "help?"],
        last_user="Hello there.",
    )
    assert got == "How can I help?"


def test_plain_reply_passes_through() -> None:
    # A normal reply that does not echo the user is released immediately (no latency).
    got = _run(["I scheduled it ", "for Friday at 3pm."], last_user="schedule it for Friday")
    assert got == "I scheduled it for Friday at 3pm."


def test_strips_inline_labels_after_head() -> None:
    got = _run(["[StewardAI]: Sure. ", "Then [Anique]: asked about it."])
    assert "[Anique]:" not in got
    assert got.startswith("Sure.")


def test_only_self_label_no_echo() -> None:
    got = _run(["[StewardAI]: Done."])
    assert got == "Done."


def test_long_plain_reply_not_dropped() -> None:
    long = "This is a normal answer without any labels " * 6
    assert _run([long], last_user="something unrelated") == long
