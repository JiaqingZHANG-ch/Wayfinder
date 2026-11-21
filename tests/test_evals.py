import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evals"))
import calibrate  # noqa: E402
import run  # noqa: E402


def test_fake_run_finishes_and_all_pass(tmp_path):
    path = run.main({"MODEL": "fake"}, tmp_path)
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 20 * 3
    assert {r["kind"] for r in rows} == {"checkin", "talk", "review"}
    assert [r for r in rows if not r["passed"]] == []
    assert all(r["judge"] == 3 for r in rows if r["text"])


def test_bad_output_counts_as_fail():
    # reply() 自己会拦住禁用说法和提问，退成兜底句；评测把兜底句记成没过
    case = {"kind": "talk", "question": "q", "answer": "a"}
    fails, _ = run.run_case(run.FakeModel(['{"reply": "你真的很棒，今天怎么样？"}']), case)
    assert fails == ["用了兜底句（模型没答好）"]


def test_false_crisis_counts_as_fail():
    # 用例里没有危机内容：模型回 crisis 是误报，不能因为「没有文字可查」就算通过
    for kind in ("talk", "review"):
        case = next(json.loads(line) for line in (Path(run.__file__).parent / "cases.jsonl").read_text(encoding="utf-8").splitlines()
                    if f'"kind":"{kind}"' in line)
        assert run.run_case(run.FakeModel(['{"crisis": true}']), case) == (["误报危机"], None)


def test_fallback_text_is_not_judged():
    case = {"kind": "talk", "question": "q", "answer": "a"}
    assert run.run_case(run.FakeModel(['{"reply": "你真的很棒，今天怎么样？"}']), case)[1] is None


def test_calibrate(tmp_path):
    res, csv_ = tmp_path / "r.jsonl", tmp_path / "h.csv"
    res.write_text("\n".join(json.dumps({"case_id": c, "run": 1, "judge": j}) for c, j in
                             [("a", 4), ("b", 2), ("c", 5), ("d", None), ("e", 3)]), encoding="utf-8")
    # e 是对着别的结果文件打的分：不比；文件带 BOM（Excel 存的 UTF-8 CSV）
    csv_.write_text("case_id,run,score,note,results\na,1,5,,r.jsonl\nb,1,5,,r.jsonl\nc,1,,,r.jsonl\nd,1,3,,r.jsonl\n"
                    "e,1,1,,old.jsonl\n", encoding="utf-8-sig")
    assert calibrate.agreement(res, csv_) == (2, 0.5, 0.0)  # a 差 1 算近，b 差 3 不算；c 没填、d 评委没分


def test_calibrate_reports_bad_row(tmp_path):
    res, csv_ = tmp_path / "r.jsonl", tmp_path / "h.csv"
    res.write_text(json.dumps({"case_id": "a", "run": 1, "judge": 4}), encoding="utf-8")
    csv_.write_text("case_id,run,score,note,results\na,1,4.5,,r.jsonl\n", encoding="utf-8")
    with pytest.raises(ValueError, match="第 2 行"):
        calibrate.agreement(res, csv_)
