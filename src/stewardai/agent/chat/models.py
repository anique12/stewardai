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
    llm = ChatLiteLLM(model=pick_model(role), temperature=0, num_retries=4)
    return llm.bind_tools(tools) if tools else llm
