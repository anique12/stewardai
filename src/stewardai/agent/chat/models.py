"""Provider-agnostic chat model layer. pick_model routes by role (config-driven);
make_chat_llm builds a ChatLiteLLM so any litellm-supported provider is swappable."""
from __future__ import annotations

from stewardai.config import get_settings


def pick_model(role: str = "reasoning") -> str:
    s = get_settings()
    if role == "utility":
        return s.chat_utility_model
    return s.chat_reasoning_model  # default / "reasoning"


def _supports_reasoning(model: str) -> bool:
    """True if the model exposes thought summaries (so we can show a thinking
    block). Best-effort: a non-reasoning model → False, and we simply don't
    request/show reasoning — nothing breaks."""
    try:
        import litellm

        return bool(litellm.supports_reasoning(model=model))
    except Exception:  # noqa: BLE001 - unknown model / old litellm → assume no
        return False


def _install_gemini_content_shim() -> None:
    """Work around a litellm Gemini bug that breaks multi-round tool turns when
    reasoning is on.

    ``GoogleAIStudioGeminiConfig._transform_messages`` iterates a message's
    ``content`` list assuming every element is a dict (``element.get("type")``).
    With ``reasoning_effort`` set, gemini-2.5-pro's assistant messages come back
    on a later tool-call round as a content list containing a bare STRING, so
    ``str.get`` raises ``AttributeError`` and the whole turn errors. We coerce
    string elements to ``{"type": "text", "text": ...}`` before the original
    runs -- exactly what litellm should do. Idempotent + fully guarded."""
    try:
        import litellm

        cfg = litellm.GoogleAIStudioGeminiConfig
        if getattr(cfg, "_stewardai_content_shim", False):
            return
        orig = cfg._transform_messages

        def _patched(self, messages, *args, **kwargs):  # noqa: ANN001
            _coerce_string_content_elements(messages)
            return orig(self, messages, *args, **kwargs)

        cfg._transform_messages = _patched
        cfg._stewardai_content_shim = True
    except Exception:  # noqa: BLE001 - never let a shim failure break model creation
        pass


def _coerce_string_content_elements(messages) -> None:  # noqa: ANN001
    """In-place: turn any bare-string element of a message's ``content`` list into
    a ``{"type": "text", "text": ...}`` block, so litellm's Gemini transform
    (which calls ``element.get("type")``) doesn't choke on a string."""
    for m in messages or []:
        content = m.get("content") if isinstance(m, dict) else None
        if isinstance(content, list):
            m["content"] = [
                {"type": "text", "text": el} if isinstance(el, str) else el for el in content
            ]


def make_chat_llm(role: str = "reasoning", *, tools=None):  # noqa: ANN001
    import os  # type: ignore

    from langchain_litellm import ChatLiteLLM  # type: ignore  # lazy

    _install_gemini_content_shim()
    s = get_settings()
    if s.gemini_api_key:
        os.environ.setdefault("GEMINI_API_KEY", s.gemini_api_key)
    model = pick_model(role)
    # streaming=True makes ChatLiteLLM route ainvoke() through its internal
    # _astream(), which fires real per-token callback events -- this is what
    # lets LangGraph's astream(stream_mode=["messages"]) yield incremental
    # deltas instead of one whole-message chunk per turn (verified live
    # against gemini/gemini-2.5-flash via create_react_agent).
    kwargs: dict = {"model": model, "temperature": 0, "num_retries": 4, "streaming": True}
    # For the reasoning role on a reasoning-capable model, request thought
    # summaries; they arrive on each chunk's additional_kwargs["reasoning_content"]
    # and drive the UI's "Thinking" block. Skipped (no reasoning, no error) for
    # non-reasoning models — keeps the chat working on any provider/model.
    if role == "reasoning" and _supports_reasoning(model):
        kwargs["model_kwargs"] = {"reasoning_effort": "low"}
    llm = ChatLiteLLM(**kwargs)
    return llm.bind_tools(tools) if tools else llm
