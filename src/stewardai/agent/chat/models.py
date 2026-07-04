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


def make_chat_llm(role: str = "reasoning", *, tools=None):  # noqa: ANN001
    import os  # type: ignore

    from langchain_litellm import ChatLiteLLM  # type: ignore  # lazy

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
