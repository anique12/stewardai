"""Tests for chat message store: create_thread, append_message, list_threads, get_thread_messages.
Uses a fake chained-query client like test_kb_persistence.py.
"""
from __future__ import annotations

from stewardai.agent.chat import store


class _Resp:
    def __init__(self, data=None, count=None):
        self.data = data or []
        self.count = count if count is not None else len(self.data)


class _Query:
    def __init__(self, log, table):
        self._log, self._t, self._op, self._payload = log, table, None, None
        self._raise_on_execute = None

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload = "upsert", payload
        return self

    def select(self, *_args, count=None, **_k):
        self._op, self._count_mode = "select", count
        return self

    def eq(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    async def execute(self):
        if self._raise_on_execute:
            raise self._raise_on_execute
        self._log.append({"table": self._t, "op": self._op, "payload": self._payload})
        if self._op == "select":
            # Return all previously inserted/upserted rows for this table
            inserted = [
                c["payload"]
                for c in self._log
                if c["table"] == self._t and c["op"] in ("insert", "upsert")
            ]
            if not inserted:
                return _Resp([], count=0)
            if isinstance(inserted[0], list):
                all_rows = []
                for batch in inserted:
                    all_rows.extend(batch)
                return _Resp(all_rows, count=len(all_rows))
            else:
                return _Resp(inserted, count=len(inserted))
        rid = f"{self._t}-1"
        return _Resp([{"id": rid}])


class _Client:
    def __init__(self):
        self.calls = []
        self._query = None
        self._raise_on_all_execute = None

    def table(self, name):
        self._query = _Query(self.calls, name)
        if self._raise_on_all_execute:
            self._query._raise_on_execute = self._raise_on_all_execute
        return self._query

    def set_raise_on_execute(self, exc):
        """Set an exception to raise on all execute() calls."""
        self._raise_on_all_execute = exc


def _ops(client, table, op):
    return [c["payload"] for c in client.calls if c["table"] == table and c["op"] == op]


async def test_create_thread_inserts_and_returns_id():
    """create_thread inserts user_id + title, returns the thread id."""
    c = _Client()
    tid = await store.create_thread(c, user_id="u1", title="First chat")
    assert tid == "chat_threads-1"
    assert _ops(c, "chat_threads", "insert")[0] == {"user_id": "u1", "title": "First chat"}


async def test_append_message_inserts_with_seq():
    """append_message inserts role + seq + parts, computing seq from count."""
    c = _Client()
    # First message should get seq=1
    await store.append_message(
        c, user_id="u1", thread_id="t1", role="user", parts=[{"type": "text", "text": "Hello"}]
    )
    inserts = _ops(c, "chat_messages", "insert")
    assert len(inserts) == 1
    assert inserts[0]["role"] == "user"
    assert inserts[0]["seq"] == 1
    assert inserts[0]["parts"] == [{"type": "text", "text": "Hello"}]
    assert inserts[0]["user_id"] == "u1"
    assert inserts[0]["thread_id"] == "t1"


async def test_append_message_increments_seq():
    """Calling append_message twice increments seq."""
    c = _Client()
    await store.append_message(
        c, user_id="u1", thread_id="t1", role="user", parts=[{"type": "text", "text": "Hello"}]
    )
    await store.append_message(
        c, user_id="u1", thread_id="t1", role="assistant", parts=[{"type": "text", "text": "Hi"}]
    )
    inserts = _ops(c, "chat_messages", "insert")
    assert inserts[0]["seq"] == 1
    assert inserts[1]["seq"] == 2


async def test_create_thread_returns_none_on_relation_error():
    """When DB raises 'relation does not exist', create_thread logs and returns None."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"chat_threads\" does not exist"))
    tid = await store.create_thread(c, user_id="u1", title="New chat")
    assert tid is None


async def test_append_message_noop_on_relation_error():
    """When DB raises 'relation does not exist', append_message logs and does NOT raise."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"chat_messages\" does not exist"))
    # Should not raise
    await store.append_message(
        c, user_id="u1", thread_id="t1", role="user", parts=[{"type": "text"}]
    )
    # No inserts should have been recorded
    inserts = _ops(c, "chat_messages", "insert")
    assert len(inserts) == 0


async def test_thread_owned_true_when_thread_belongs_to_user():
    """thread_owned returns True once a thread has been created (the fake
    client's select ignores filters but returns the previously inserted row,
    which is enough to exercise the found-a-row path)."""
    c = _Client()
    tid = await store.create_thread(c, user_id="u1", title="First chat")
    owned = await store.thread_owned(c, user_id="u1", thread_id=tid)
    assert owned is True


async def test_thread_owned_false_when_no_matching_thread():
    """thread_owned returns False when the select finds nothing (e.g. the
    thread_id doesn't exist, or exists but isn't this user's)."""
    c = _Client()
    owned = await store.thread_owned(c, user_id="u1", thread_id="not-a-real-thread")
    assert owned is False


async def test_thread_owned_returns_false_on_error():
    """thread_owned swallows DB errors and reports not-owned rather than
    raising, so callers can safely fall back to creating a fresh thread."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"chat_threads\" does not exist"))
    owned = await store.thread_owned(c, user_id="u1", thread_id="t1")
    assert owned is False


async def test_list_threads_returns_empty_on_relation_error():
    """When DB raises 'relation does not exist', list_threads returns empty list."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"chat_threads\" does not exist"))
    threads = await store.list_threads(c, user_id="u1")
    assert threads == []


async def test_get_thread_messages_returns_empty_on_relation_error():
    """When DB raises 'relation does not exist', get_thread_messages returns empty list."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"chat_messages\" does not exist"))
    messages = await store.get_thread_messages(c, user_id="u1", thread_id="t1")
    assert messages == []


# --- tool_permissions allowlist -----------------------------------------


async def test_is_allowed_true_when_row_present():
    """is_allowed returns True once set_allowed has recorded a row."""
    c = _Client()
    await store.set_allowed(c, user_id="u1", tool_name="send_email")
    allowed = await store.is_allowed(c, user_id="u1", tool_name="send_email")
    assert allowed is True


async def test_is_allowed_false_when_empty():
    """is_allowed returns False when no permission row exists."""
    c = _Client()
    allowed = await store.is_allowed(c, user_id="u1", tool_name="send_email")
    assert allowed is False


async def test_is_allowed_false_on_relation_error():
    """is_allowed swallows DB errors (e.g. missing table) and returns False
    rather than raising."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"tool_permissions\" does not exist"))
    allowed = await store.is_allowed(c, user_id="u1", tool_name="send_email")
    assert allowed is False


async def test_set_allowed_upserts_row():
    """set_allowed upserts a row with allowed=True for the given user/tool."""
    c = _Client()
    await store.set_allowed(c, user_id="u1", tool_name="send_email")
    upserts = _ops(c, "tool_permissions", "upsert")
    assert upserts == [
        {"user_id": "u1", "tool_name": "send_email", "scope": None, "allowed": True}
    ]


async def test_set_allowed_no_raise_on_error():
    """set_allowed swallows DB errors rather than raising."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"tool_permissions\" does not exist"))
    # Should not raise
    await store.set_allowed(c, user_id="u1", tool_name="send_email")


async def test_get_allowlist_returns_rows():
    """get_allowlist returns previously set rows for a user."""
    c = _Client()
    await store.set_allowed(c, user_id="u1", tool_name="send_email")
    rows = await store.get_allowlist(c, user_id="u1")
    assert len(rows) == 1
    assert rows[0]["tool_name"] == "send_email"


async def test_get_allowlist_returns_empty_on_relation_error():
    """When DB raises 'relation does not exist', get_allowlist returns empty list."""
    c = _Client()
    c.set_raise_on_execute(Exception("relation \"tool_permissions\" does not exist"))
    rows = await store.get_allowlist(c, user_id="u1")
    assert rows == []
