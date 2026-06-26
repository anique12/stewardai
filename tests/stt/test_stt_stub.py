from stewardai.stt.stub import StubSTT


async def test_stub_returns_default_transcript():
    t = await StubSTT().transcribe(b"\x00\x00" * 320)
    assert t.is_final
    assert t.text


async def test_stub_canned():
    t = await StubSTT(canned="hi there").transcribe(b"")
    assert t.text == "hi there"
