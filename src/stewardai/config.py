"""Application settings, loaded from environment / .env.

The whole app is configured here. CPU<->GPU is a single `device` switch; backends
are selected by name so a `stub` (no heavy deps) and a real backend are swappable.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Compute
    device: Literal["cpu", "cuda"] = "cpu"

    # Backend selection
    stt_backend: str = "stub"
    tts_backend: str = "stub"
    llm_backend: str = "litellm"
    turn_detector: str = "silence"

    # Turn endpointing — LiveKit AgentSession config, NOT custom turn logic.
    # min_delay must exceed STT latency so the linguistic/backchannel EOU check can
    # run before the audio turn detector flushes the turn; otherwise turns fire on
    # pauses/backchannels. CPU Parakeet is ~1.5-2.2s, so keep these high; on GPU
    # (STT ~150ms) drop them (e.g. 0.4 / 2.0) for snappier turns.
    turn_min_delay: float = 2.0
    turn_max_delay: float = 4.0

    # Far-field / noisy-room tuning. English-only STT hallucinates words ("yeah",
    # "thank you") on distant non-English background speech; gate it at the source.
    # Raise vad_activation_threshold so only louder/closer speech counts as speech
    # (0.5 = LiveKit default). vad_min_speech_duration ignores brief blips. A higher
    # interruption_min_words stops a 1-word hallucination from cutting off the agent.
    # NOTE: these reduce — not eliminate — false triggers; loud background still gets
    # through. The real fixes are a close mic / push-to-talk / wake word.
    vad_activation_threshold: float = 0.6
    vad_min_speech_duration: float = 0.2
    interruption_min_words: int = 2
    # LiveKit default True: after a barge-in it pauses, waits, and if it judges the
    # interruption "false" it RESUMES the same reply. We default False so a barge-in
    # definitively stops the agent. (Set True for prod if you want backchannels like
    # "mm-hmm" to not cut the agent off.)
    resume_false_interruption: bool = False
    # Barge-in responsiveness. "vad" = cut off on voice activity (fast, simple);
    # "adaptive" = ML backchannel-vs-interruption (smarter, but ~1-2s slower to fire
    # and suppresses speech early in the agent's turn). min_duration = seconds of
    # speech before a barge-in registers.
    interruption_mode: str = "vad"
    interruption_min_duration: float = 0.25

    # Preemptive generation: start the LLM (and TTS) on the INTERIM streaming-STT
    # transcript BEFORE the end-of-turn is committed, overlapping the LLM's TTFT with the
    # speech/endpointing window. A real latency win with streaming STT (Deepgram); a no-op
    # with batch STT (no interim transcripts to act on). Cost: a speculative generation is
    # discarded if the transcript changes (the user keeps talking), spending extra LLM
    # tokens — a good trade on a cheap fast model (flash), riskier on a busy multi-speaker
    # meeting. Default off; enable per-run with PREEMPTIVE_GENERATION=true.
    preemptive_generation: bool = False

    # LLM (Gemini via LiteLLM)
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    llm_model: str | None = None  # explicit override; else derived from gemini_model
    # KB embeddings (Plan B): single-provider Gemini embedding model. gemini-embedding-001
    # defaults to 3072 dims but supports Matryoshka truncation to embedding_dim (768) via
    # litellm's `dimensions` param, matching the vector(768) column. (text-embedding-004 is
    # not available via embedContent on current Gemini API keys.)
    embedding_model: str = "gemini/gemini-embedding-001"
    embedding_dim: int = 768
    # Agentic chat (Plan C1+): per-role models, all via litellm (any provider swappable).
    # Reasoning uses PRO: with the full agentic toolset (~20 tools incl. Composio's
    # Gmail/Calendar schemas), gemini-2.5-flash intermittently returns an EMPTY response
    # (a known flash weakness with many/complex function declarations); pro is reliable.
    # Override per-env with CHAT_REASONING_MODEL.
    chat_reasoning_model: str = "gemini/gemini-2.5-pro"
    chat_utility_model: str = "gemini/gemini-2.5-flash-lite"
    # Ask (RAG) retrieval depth + allowed browser origins for the /api/ask endpoint.
    ask_top_k: int = 8
    ask_cors_origins: str = ""  # comma-separated portal origins; empty = no CORS added
    # Backstop so a stalled LLM stream can't silently hang a turn forever (the agent
    # would produce no reply and no error). Surfaces as an error instead.
    llm_timeout_s: float = 20.0
    # Keepalive: ping the LLM connection every N seconds so a turn after silence (or the
    # first turn after the admission wait) doesn't pay the ~5-8s cold-connection cost
    # (measured: ~0.5s warm vs ~5-8s cold). 0 disables. Does NOT fix Gemini's inherent
    # per-call variance — only the cold-start spikes.
    llm_keepalive_s: float = 20.0
    # Cross-provider fallback: comma-separated litellm model ids tried IN ORDER when the
    # primary model errors — mainly Gemini's server-side 503 "model overloaded" (a global
    # capacity issue that paid tier does NOT fix). Falling back to a DIFFERENT provider
    # (not overloaded at the same instant) beats retrying into the same pool. Each needs
    # its key in env (ANTHROPIC_API_KEY / GROQ_API_KEY / ...). Empty = no fallback.
    # e.g. "claude-haiku-4-5-20251001" or "groq/llama-3.3-70b-versatile"
    llm_fallback_models: str = ""
    # If the model produces no output within this many seconds on a turn the bot was
    # directly addressed on, speak a short disfluent filler ("Hmm, let me see...") so a
    # slow/overloaded reply isn't dead air. Measured from decide-start (after EOU), so
    # ~this + EOU after the user stops. 0 disables. Only fires on addressed turns.
    slow_reply_filler_s: float = 2.0

    # Bridge
    bridge_transport: Literal["tcp", "unix"] = "tcp"
    bridge_tcp_host: str = "127.0.0.1"
    bridge_tcp_port: int = 8765
    bridge_socket_path: str = "/tmp/stewardai.sock"

    # Vexa bot integration (Redis control channel + meeting identity)
    redis_url: str = "redis://localhost:6379"
    vexa_meeting_id: str | None = None
    # Supabase user UUID for the meeting owner. Set from the meeting record when
    # running a real meeting (VEXA_USER_ID env). Unset for the public /pipeline
    # demo — Composio tools are disabled in that case (no user, no actions).
    vexa_user_id: str | None = None
    vexa_platform: str = "google_meet"
    # Vexa gateway (bot spawning). vexa_api_key authenticates the scheduler's
    # POST {vexa_gateway_url}/bots call via the X-API-Key header.
    vexa_api_key: str | None = None
    vexa_gateway_url: str = "http://localhost:8056"
    # Request an AUTHENTICATED bot (joins Google Meet logged in as the dedicated
    # Steward Google account) instead of the anonymous bot, which Google anti-bot
    # removes ~13s after admission. Requires the account's session cookies staged in
    # MinIO at users/<vexa_user>/browser-userdata (see project_authenticated_bot).
    # Toggle off (VEXA_BOT_AUTHENTICATED=false) to fall back to the anonymous bot.
    vexa_bot_authenticated: bool = True
    # rate the Vexa bot should paplay our PCM at; our pipeline is 16 kHz end-to-end (SAMPLE_RATE).
    playback_sample_rate: int = 16000

    # TTS
    tts_default_voice: str = "stub"

    # Public demo gate (landing "Talk to Steward"). When demo_token_secret is set, the
    # /ws/pipeline endpoint requires a valid signed token (HS256 JWT issued by the portal
    # /api/demo-token route; key = bytes.fromhex(secret)) and caps each session at
    # demo_session_cap_s. Unset (default) = no gate, no cap — local dev as before.
    demo_token_secret: str | None = None
    demo_session_cap_s: float = 75.0

    # Whisper STT (faster-whisper / CTranslate2). Batch model, multilingual.
    # large-v3 (NOT turbo): more accurate and full 99-language support. turbo trades
    # accuracy for speed and sits a notch below large-v3 on WER — for meetings we
    # prefer accuracy. Swap models / backends purely by env (no code change).
    whisper_model: str = "large-v3"
    whisper_compute_type: str | None = None  # None -> int8 (cpu) / float16 (cuda)
    whisper_beam_size: int = 1  # greedy-ish; fastest on CPU. Raise (e.g. 5) for accuracy.
    # None -> auto-detect the language per utterance (multilingual). Pin to a code
    # (e.g. "en") to force one language: faster and avoids mis-detection on short or
    # noisy utterances, at the cost of only recognizing that language.
    whisper_language: str | None = None

    # Parakeet STT (NVIDIA NeMo). v3 = multilingual (25 European langs); v2 is
    # English-only and a touch more accurate on English. Needs the `parakeet` extra
    # (nemo_toolkit[asr] + torch); GPU strongly recommended. Select with
    # STT_BACKEND=parakeet (alias of parakeet_nemo).
    parakeet_model: str = "nvidia/parakeet-tdt-0.6b-v3"

    # Piper TTS (local neural). Voice models (.onnx + .json) download here on first use.
    piper_data_dir: str = "~/.cache/stewardai/piper"

    # Chatterbox TTS (Resemble AI, MIT) — most natural open TTS; needs the
    # `chatterbox` extra. Multilingual (23 langs) by default to match STT; set
    # chatterbox_multilingual=false for the English-only model. chatterbox_language
    # is the language_id for the multilingual model (it has no auto-detect).
    # chatterbox_voice_sample: optional path to a short wav for zero-shot cloning.
    chatterbox_multilingual: bool = True
    chatterbox_language: str = "en"
    chatterbox_voice_sample: str | None = None

    # Cloud STT/TTS (offload local CPU). Set STT_BACKEND=deepgram / TTS_BACKEND=cartesia
    # to use these native LiveKit plugins instead of local whisper/kokoro. They call
    # YOUR Deepgram/Cartesia accounts directly (keys below) — NOT LiveKit Cloud. The
    # gated LLM decide logic is unchanged. Keys live in .env (like GEMINI_API_KEY).
    deepgram_api_key: str | None = None
    deepgram_model: str = "nova-3"
    # Deepgram Aura TTS (TTS_BACKEND=deepgram) — same Deepgram account/key as STT, so
    # STT + TTS bill against ONE Deepgram balance. Pick a voice via DEEPGRAM_TTS_MODEL
    # (e.g. aura-2-andromeda-en, aura-asteria-en, aura-orion-en).
    deepgram_tts_model: str = "aura-2-andromeda-en"
    # Comma-separated domain vocabulary boosted in per-speaker Deepgram transcription
    # (nova-3 keyterms) — e.g. company/product/people names. "Steward" is always
    # included automatically. Participant names are added dynamically as they speak.
    stt_keyterms: str = ""
    # Silence (ms) Deepgram waits before finalizing a per-speaker transcript line.
    # Lower = snappier but choppier; higher = fuller sentences. This is inherent to
    # streaming STT segmentation (separate from the AgentSession turn detector, which
    # governs when Steward *replies*, not how the transcript is chunked).
    stt_endpointing_ms: int = 500
    cartesia_api_key: str | None = None
    cartesia_model: str = "sonic-3"
    cartesia_voice: str | None = None  # None -> Cartesia's default voice

    # Composio integration (third-party app actions: Gmail, Google Calendar, Notion, Slack)
    # Set COMPOSIO_API_KEY to enable; unset (default None) means the integration is disabled.
    composio_api_key: str | None = None

    @property
    def composio_enabled(self) -> bool:
        """True when a Composio API key is configured."""
        return bool(self.composio_api_key)

    # Supabase (service-role key for backend writes that bypass RLS)
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    # Logging
    log_level: str = "info"
    log_format: Literal["json", "console"] = "json"

    @property
    def resolved_llm_model(self) -> str:
        """LiteLLM model string. Gemini models get a `gemini/` prefix if absent."""
        if self.llm_model:
            return self.llm_model
        m = self.gemini_model.strip()
        return m if "/" in m else f"gemini/{m}"

    @property
    def resolved_llm_fallbacks(self) -> list[str]:
        """Fallback litellm model ids (from llm_fallback_models), in order. Empty list
        when unset -> no fallback."""
        return [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
