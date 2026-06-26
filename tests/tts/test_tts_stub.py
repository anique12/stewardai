from stewardai.common.audio import BYTES_PER_FRAME
from stewardai.tts.stub import StubTTS


async def test_synthesize_yields_frames():
    tts = StubTTS()
    frames = [f async for f in tts.synthesize("hello world", voice="stub")]
    assert len(frames) >= 1
    assert len(frames[0].pcm) == BYTES_PER_FRAME
    assert all(len(f.pcm) <= BYTES_PER_FRAME for f in frames)


def test_voices_listed():
    assert "stub" in StubTTS().voices
