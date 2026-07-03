"""Real LLM backend via LiteLLM. Model selected by string (Gemini by default).

Switching model/provider = change LLM_MODEL (or GEMINI_MODEL) in env; no code change.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from stewardai.common.audio import Decision, Message
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("llm.litellm")

_DECIDE_TOOLS = [
    {"type": "function", "function": {
        "name": "speak",
        "description": "Say this reply aloud into the meeting. Use only when addressed "
                       "(e.g. the wake word) or when a response is clearly useful.",
        "parameters": {"type": "object",
                       "properties": {"text": {"type": "string"}},
                       "required": ["text"]}}},
    {"type": "function", "function": {
        "name": "stay_silent",
        "description": "Do not respond. Use this by default when not addressed.",
        "parameters": {"type": "object", "properties": {}}}},
]

# For the STREAMING gate (decide_stream): speaking = the model streaming text directly,
# so there is no "speak" tool — only stay_silent (+ the meeting's action tools). The
# model streams text to speak, calls stay_silent to be quiet, or calls an action tool.
_STAY_SILENT_TOOL = {
    "type": "function",
    "function": {
        "name": "stay_silent",
        "description": (
            "Call this to say NOTHING this turn — output no text. Use it by DEFAULT "
            "whenever the latest speech is not directed at you and there is no material "
            "discrepancy to flag. If you should respond, just say your reply as normal "
            "text (or call an action tool) instead of calling this."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def _parse_decision(tool_calls) -> Decision:  # noqa: ANN001
    """Map an LLM tool_calls list to a Decision (defaults to silent).

    Names ``speak``/``stay_silent`` are the gate; ANY other tool name is a Composio
    action the LLM chose to run (→ speak=True + action_slug/action_args)."""
    if not tool_calls:
        return Decision(speak=False)
    call = tool_calls[0]
    name = call.function.name
    try:
        args = json.loads(call.function.arguments or "{}") or {}
    except (ValueError, TypeError):
        args = {}
    if not isinstance(args, dict):
        args = {}
    if name == "stay_silent":
        return Decision(speak=False)
    if name == "speak":
        text = args.get("text", "")
        return Decision(speak=bool(text), text=text)
    # A Composio action tool the LLM decided to invoke.
    return Decision(speak=True, action_slug=name, action_args=args)


class LiteLLMClient:
    name = "litellm"

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        if self._s.gemini_api_key:
            os.environ.setdefault("GEMINI_API_KEY", self._s.gemini_api_key)
        self.model = self._s.resolved_llm_model
        # Cross-provider fallbacks (None when unset): litellm tries these in order when
        # the primary errors — chiefly Gemini's 503 "model overloaded". Each provider
        # needs its own key in env (ANTHROPIC_API_KEY / GROQ_API_KEY / ...).
        self._fallbacks = self._s.resolved_llm_fallbacks or None
        if self._fallbacks:
            _log.info(
                "llm_fallbacks_configured", primary=self.model, fallbacks=self._fallbacks
            )

    async def complete(
        self, messages: list[Message], *, system: str | None = None, temperature: float = 0.4
    ) -> AsyncIterator[str]:
        import litellm  # lazy: base dep, but keep import local for fast module load

        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)

        response = await litellm.acompletion(
            model=self.model,
            messages=payload,
            stream=True,
            temperature=temperature,
            timeout=self._s.llm_timeout_s,  # backstop against a silently hung stream
            fallbacks=self._fallbacks,
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def decide(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
        import litellm  # lazy

        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        # Full input visibility: log the EXACT system prompt + transcript messages
        # sent to decide(), so it's clear what the model saw when it chose to
        # speak or stay silent (debugging wake-word / gating behaviour).
        _log.info(
            "llm_decide_input",
            backend=self.name,
            model=self.model,
            payload=payload,
        )
        # speak/stay_silent gate + (optionally) the meeting's Composio action tools,
        # so a directed request ("check my calendar") can pick a real action instead
        # of only being able to say it will.
        tools = _DECIDE_TOOLS + list(action_tools or [])
        resp = await litellm.acompletion(
            model=self.model, messages=payload, tools=tools,
            tool_choice="required", temperature=0.0, timeout=self._s.llm_timeout_s,
            fallbacks=self._fallbacks,
            # Gemini connections occasionally fail instantly (an httpx pool blip that
            # litellm surfaces as a 0.002s "Timeout"); a couple of retries rides over
            # it so one bad turn doesn't go silent. The gated node also swallows a
            # final failure, so this is belt-and-suspenders, not the only guard.
            num_retries=2,
        )
        msg = resp.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None)
        decision = _parse_decision(tool_calls)
        # Log the chosen tool + raw args so the WHY is explicit (speak / stay_silent / action).
        chosen = tool_calls[0].function.name if tool_calls else None
        raw_args = tool_calls[0].function.arguments if tool_calls else None
        _log.info(
            "llm_decide",
            backend=self.name,
            speak=decision.speak,
            tool=chosen,
            action_slug=decision.action_slug,
            args=raw_args,
            reply=decision.text or None,
        )
        return decision

    async def phrase_result(self, messages, *, system=None, slug=None, result=None):  # noqa: ANN001
        """Turn a tool's raw result into one or two spoken sentences for the user.

        Runs a plain completion (no tools) with the transcript + the action result,
        instructed to state the outcome conversationally and never mention tool
        names/JSON. Used after a live action so the agent actually reports back."""
        import litellm  # lazy

        instr = (system or "") + (
            "\n\nYou just performed an action for the user and received its result "
            "below. Reply in ONE or TWO short spoken sentences stating the outcome. "
            "Do NOT mention tool names, slugs, JSON, or that a tool was called."
        )
        payload = [{"role": "system", "content": instr}]
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        payload.append(
            {"role": "user", "content": f"(result of {slug}: {json.dumps(result)[:2000]})"}
        )
        resp = await litellm.acompletion(
            model=self.model, messages=payload, temperature=0.2,
            timeout=self._s.llm_timeout_s, num_retries=2, fallbacks=self._fallbacks,
        )
        text = (resp.choices[0].message.content or "").strip()
        _log.info("llm_phrase_result", backend=self.name, slug=slug, chars=len(text))
        return text

    async def decide_stream(self, messages, *, system=None, action_tools=None):  # noqa: ANN001
        """Streaming gate + reply. Yields, in order:
          ('text', delta)        — spoken reply text, streamed so TTS starts on the
                                   first sentence instead of waiting for the full reply.
          ('action', slug, args) — the model chose a Composio action (run it + report).
        Yields NOTHING when the model calls ``stay_silent`` (or produces no output).

        One streaming call self-gates: the model either streams text (= speak), calls
        ``stay_silent`` (= silent), or calls an action tool. This is what lets us
        overlap LLM generation with TTS (the old non-streaming decide could not)."""
        import litellm  # lazy

        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        _log.info("llm_decide_input", backend=self.name, model=self.model, payload=payload)

        tools = [_STAY_SILENT_TOOL] + list(action_tools or [])
        response = await litellm.acompletion(
            model=self.model, messages=payload, tools=tools, tool_choice="auto",
            temperature=0.0, timeout=self._s.llm_timeout_s, num_retries=2, stream=True,
            fallbacks=self._fallbacks,
        )
        tool_acc: dict[int, dict] = {}  # streamed tool-call deltas, by index
        text_chars = 0
        async for chunk in response:
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                text_chars += len(content)
                yield ("text", content)
            for tc in getattr(delta, "tool_calls", None) or []:
                idx = getattr(tc, "index", 0) or 0
                acc = tool_acc.setdefault(idx, {"name": "", "args": ""})
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        acc["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        acc["args"] += fn.arguments
        # After the stream: surface any action tool call (stay_silent → nothing).
        chosen = None
        for acc in tool_acc.values():
            name = acc["name"]
            if name and name != "stay_silent":
                chosen = name
                try:
                    args = json.loads(acc["args"] or "{}")
                except (ValueError, TypeError):
                    args = {}
                yield ("action", name, args if isinstance(args, dict) else {})
        _log.info(
            "llm_decide", backend=self.name, speak=bool(text_chars or chosen),
            tool=chosen or (next((a["name"] for a in tool_acc.values() if a["name"]), None)),
            action_slug=chosen, streamed_chars=text_chars,
        )

    async def chat_with_tools(self, oai_messages, *, tools=None):  # noqa: ANN001
        """Streaming chat in OpenAI shape for the NATIVE meeting path (LiveKit owns
        the tool loop). ``oai_messages`` and ``tools`` are already OpenAI-format
        (built by ``agent.native_tools``). Yields, in order:

          ('text', delta)                         — content to speak (streamed, so a
                                                    preamble is spoken before a tool runs)
          ('tool_call', {name, arguments, call_id}) — after the stream, each tool the
                                                    model chose (LiveKit executes it)

        Unlike ``decide_stream`` this preserves ``call_id`` and accepts tool-result
        messages, so the framework's speak→tool→speak follow-up pass works."""
        import litellm  # lazy

        from stewardai.agent.native_tools import (
            accumulate_tool_call_deltas,
            finish_tool_calls,
        )

        kwargs: dict = {
            "model": self.model,
            "messages": oai_messages,
            "temperature": 0.0,
            "timeout": self._s.llm_timeout_s,
            "num_retries": 2,
            "stream": True,
            "fallbacks": self._fallbacks,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        response = await litellm.acompletion(**kwargs)
        acc: dict[int, dict] = {}
        text_chars = 0
        async for chunk in response:
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                text_chars += len(content)
                yield ("text", content)
            accumulate_tool_call_deltas(acc, getattr(delta, "tool_calls", None) or [])
        calls = finish_tool_calls(acc)
        for call in calls:
            yield ("tool_call", call)
        _log.info(
            "llm_chat_with_tools",
            backend=self.name,
            streamed_chars=text_chars,
            tool_calls=[c["name"] for c in calls],
        )

    async def phrase_result_stream(self, messages, *, system=None, slug=None, result=None):  # noqa: ANN001
        """Streaming version of ``phrase_result`` — yields the spoken outcome text as
        it's generated so TTS starts immediately after an action."""
        import litellm  # lazy

        instr = (system or "") + (
            "\n\nYou just performed an action for the user and received its result "
            "below. Reply in ONE or TWO short spoken sentences stating the outcome. "
            "Do NOT mention tool names, slugs, JSON, or that a tool was called."
        )
        payload = [{"role": "system", "content": instr}]
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        payload.append(
            {"role": "user", "content": f"(result of {slug}: {json.dumps(result)[:2000]})"}
        )
        response = await litellm.acompletion(
            model=self.model, messages=payload, temperature=0.2,
            timeout=self._s.llm_timeout_s, num_retries=2, stream=True,
        )
        async for chunk in response:
            c = getattr(chunk.choices[0].delta, "content", None)
            if c:
                yield c

    async def aclose(self) -> None:
        return None

    async def aembed(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        """Embed texts with the configured Gemini embedding model (768-dim).

        Asymmetric task types improve retrieval: index side embeds as
        RETRIEVAL_DOCUMENT, the query side as RETRIEVAL_QUERY. Order-preserving:
        the i-th vector corresponds to the i-th input.
        """
        if not texts:
            return []
        import litellm  # lazy

        task_type = "RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"
        resp = await litellm.aembedding(
            model=self._s.embedding_model,
            input=texts,
            task_type=task_type,
            timeout=self._s.llm_timeout_s,
        )
        # litellm normalizes to an OpenAI-shaped response: resp.data[i]["embedding"].
        return [row["embedding"] for row in resp.data]
