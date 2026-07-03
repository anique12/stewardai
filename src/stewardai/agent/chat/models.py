"""Provider-agnostic chat model layer. pick_model routes by role (config-driven);
make_chat_llm builds a ChatLiteLLM so any litellm-supported provider is swappable."""
from __future__ import annotations

from stewardai.config import get_settings


def pick_model(role: str = "reasoning") -> str:
    s = get_settings()
    if role == "utility":
        return s.chat_utility_model
    return s.chat_reasoning_model  # default / "reasoning"


def make_chat_llm(role: str = "reasoning", *, tools=None):  # noqa: ANN001
    import os  # type: ignore

    from langchain_litellm import ChatLiteLLM  # type: ignore  # lazy

    s = get_settings()
    if s.gemini_api_key:
        os.environ.setdefault("GEMINI_API_KEY", s.gemini_api_key)
    # streaming=True makes ChatLiteLLM route ainvoke() through its internal
    # _astream(), which fires real per-token callback events -- this is what
    # lets LangGraph's astream(stream_mode=["messages"]) yield incremental
    # deltas instead of one whole-message chunk per turn (verified live
    # against gemini/gemini-2.5-flash via create_react_agent).
    llm = ChatLiteLLM(model=pick_model(role), temperature=0, num_retries=4, streaming=True)
    return llm.bind_tools(tools) if tools else llm
