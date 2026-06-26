import json

from stewardai.common.logging import TurnTimer, current_turn, get_logger, new_turn


def test_new_turn_sets_contextvar():
    tid = new_turn()
    assert current_turn() == tid
    assert len(tid) == 12


def test_log_line_is_json_with_turn_id(capsys):
    new_turn()
    get_logger("test").info("hello", foo=1)
    line = capsys.readouterr().out.strip().splitlines()[-1]
    data = json.loads(line)
    assert data["event"] == "hello"
    assert data["foo"] == 1
    assert "turn_id" in data


def test_turn_timer_records_stages():
    new_turn()
    timer = TurnTimer()
    with timer.stage("stt"):
        pass
    timer.mark("llm_ttft")
    summary = timer.summary()
    assert "t_stt" in summary
    assert "t_llm_ttft" in summary
    assert "t_total" in summary
