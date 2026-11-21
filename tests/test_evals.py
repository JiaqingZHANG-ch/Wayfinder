import json
import sys
from pathlib import Path

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


def test_calibrate(tmp_path):
    res, csv_ = tmp_path / "r.jsonl", tmp_path / "h.csv"
    res.write_text("\n".join(json.dumps({"case_id": c, "run": 1, "judge": j}) for c, j in
                             [("a", 4), ("b", 2), ("c", 5), ("d", None)]), encoding="utf-8")
    csv_.write_text("case_id,run,score,note\na,1,5,\nb,1,5,\nc,1,,\nd,1,3,\n", encoding="utf-8")
    assert calibrate.agreement(res, csv_) == (2, 0.5)  # a 差 1 算近，b 差 3 不算；c 没填、d 评委没分
