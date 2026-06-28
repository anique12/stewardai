"""RedisControl message-format tests (no running Redis needed)."""

from __future__ import annotations

import json

from stewardai.bridge.vexa_control import RedisControl, _command


def test_command_shapes():
    assert json.loads(_command("mic_on")) == {"action": "mic_on"}
    assert json.loads(_command("speak_stop")) == {"action": "speak_stop"}


def test_channel_is_meeting_scoped():
    c = RedisControl("redis://localhost:6379", meeting_id="abc123")
    assert c.channel == "bot_commands:meeting:abc123"
