"""Error hierarchy."""

from __future__ import annotations


class StewardError(Exception):
    """Base class for all StewardAI errors."""


class ConfigError(StewardError):
    """Invalid or missing configuration."""


class BackendUnavailable(StewardError):
    """A selected backend cannot be loaded (e.g. its optional extra isn't installed)."""

    def __init__(self, kind: str, name: str, hint: str = "") -> None:
        msg = f"{kind} backend '{name}' is unavailable."
        if hint:
            msg += f" {hint}"
        super().__init__(msg)
        self.kind = kind
        self.name = name
