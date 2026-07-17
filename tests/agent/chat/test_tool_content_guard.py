from stewardai.agent.chat.composio_tools import _MAX_TOOL_CONTENT_CHARS, _content_len


def test_string_data_size_is_measured():
    # Docs/reads return their text as a string `data` field — the path _trim_result
    # does NOT truncate, so it must be measured for the oversized guard.
    assert _content_len({"data": "x" * 30000}) == 30000
    assert _content_len({"data": "short"}) == 5


def test_structured_and_non_dict_results():
    assert _content_len({"data": [1, 2, 3]}) == len(str([1, 2, 3]))
    assert _content_len("hello") == 5
    assert _content_len({"no_data_key": True}) == len(str({"no_data_key": True}))


def test_ceiling_splits_normal_from_oversized():
    assert 10000 <= _MAX_TOOL_CONTENT_CHARS  # a normal doc still processes
    assert 30000 > _MAX_TOOL_CONTENT_CHARS   # a very long doc is declined
