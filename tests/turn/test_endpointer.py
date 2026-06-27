from stewardai.turn.endpointer import SilenceEndpointer


def test_emits_utterance_after_silence(speech_frame, silence_frame):
    ep = SilenceEndpointer(silence_ms=100, min_speech_ms=40)  # 5 silence frames, 2 speech min
    for _ in range(10):
        assert ep.feed(speech_frame()) is None
    results = [ep.feed(silence_frame()) for _ in range(5)]
    assert results[-1] is not None
    assert len(results[-1]) > 0


def test_short_noise_discarded(speech_frame, silence_frame):
    ep = SilenceEndpointer(silence_ms=100, min_speech_ms=200)  # need 10 speech frames
    ep.feed(speech_frame())  # only 1
    results = [ep.feed(silence_frame()) for _ in range(5)]
    assert all(r is None for r in results)
