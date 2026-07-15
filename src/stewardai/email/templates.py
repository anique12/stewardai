"""Jinja2 email rendering. Each kind extends base.html and defines subject + content."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(_DIR)),
    autoescape=select_autoescape(["html"]),
)


def render(kind: str, payload: dict) -> tuple[str, str]:
    """Return (subject, html) for an email kind. Raises KeyError on unknown kind."""
    try:
        tmpl = _env.get_template(f"{kind}.html")
    except Exception as exc:  # noqa: BLE001
        raise KeyError(f"no email template for kind={kind}") from exc
    html = tmpl.render(**payload)
    # subject block is rendered separately
    subject_block = tmpl.blocks.get("subject")
    subject = ""
    if subject_block is not None:
        ctx = tmpl.new_context(payload)
        subject = "".join(subject_block(ctx)).strip()
    return subject, html
