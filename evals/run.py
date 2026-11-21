"""评测：每个用例跑 3 次，先判代码能判的规则，再请同一个模型给「像不像人说话」打 1–5 分。

用法（仓库根目录）：uv run python evals/run.py        MODEL=fake 时用用例里写好的 fake 回答，只验管线。
"""
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

from mentor.checkin import Item, parse_sentence  # noqa: E402
from mentor.deep_talk import FALLBACK, reply  # noqa: E402
from mentor.model import FakeModel, ModelError, make_model  # noqa: E402
from mentor.review import allowed_numbers, fallback_summary, numbers_in, week_stats, write_review  # noqa: E402
from mentor.tone import banned_hits  # noqa: E402

RUNS = 3
DAY = date(2026, 11, 20)
HABITS = [{"id": "reading", "title": "看书", "minutes": 30, "floor_min": 10},
          {"id": "english", "title": "背单词", "minutes": 20, "floor_min": 10}]
TASKS = [{"id": "exam-prep", "title": "高数期末复习"}]


def _logs(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        items = {k: {"status": v} for k, v in r["items"].items()}
        items["exam-prep"] = {"status": "done", "vs_plan": r.get("vs", "same")}
        out.append({"date": f"2026-11-{r['d']:02d}", "energy_after_class": None, "blocker": r.get("blocker", ""),
                    "note": r.get("note", ""), "tomorrow_task": "", "yesterday_done": None, "items": items})
    return out


def _tone_fails(text: str) -> list[str]:
    return [f"禁用说法：{h}" for h in banned_hits(text)]


def run_case(model, case: dict) -> tuple[list[str], str | None]:
    """返回（没过的规则，可以请评委打分的文字；没有就 None）。"""
    kind = case["kind"]
    if kind == "checkin":
        items = {k: Item(*v) for k, v in case["items"].items()}
        outcome, res = parse_sentence(model, case["sentence"], DAY, items)
        if outcome != "ok":
            return [f"没解析出来：{outcome}"], None
        want, fails = case["expect"], []
        got = {k: v["status"] for k, v in res["items"].items()}
        if got != want["items"]:
            fails.append(f"状态不对：{got}")
        if "energy" in want and res["energy_after_class"] != want["energy"]:
            fails.append(f"电量不对：{res['energy_after_class']}")
        return fails, None
    if kind == "talk":
        status, text = reply(model, case["question"], case["answer"])
        if status == "crisis":  # 用例里都没有危机内容，模型回危机就是误报
            return ["误报危机"], None
        fails = _tone_fails(text)
        fails += ["提问了"] * (("？" in text) or ("?" in text))
        fails += ["写了「用户」"] * ("用户" in text)
        fails += ["用了兜底句（模型没答好）"] * (text == FALLBACK)
        return fails, None if text == FALLBACK else text  # 兜底句不是模型写的，不送评委
    stats = week_stats(_logs(case["logs"]), HABITS, TASKS)
    status, rv = write_review(model, stats, HABITS)
    if status == "crisis":
        return ["误报危机"], None
    text = rv["summary"] if rv else ""
    fails = _tone_fails(text)
    stray = numbers_in(text) - allowed_numbers(stats)
    fails += [f"数字不在统计里：{sorted(stray)}"] * bool(stray)
    fails += ["用了拼接兜底句（模型没写好）"] * (text == fallback_summary(stats))
    return fails, None if text == fallback_summary(stats) else text


def judge(model, rubric: str, text: str) -> int | None:
    try:
        score = json.loads(model.complete_json([{"role": "system", "content": rubric},
                                                {"role": "user", "content": text}]))["score"]
    except (ModelError, ValueError, KeyError, TypeError):
        return None
    return score if type(score) is int and 1 <= score <= 5 else None


def main(env=os.environ, out_dir: Path = HERE / "results") -> Path:
    cases = [json.loads(line) for line in (HERE / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rubric = (HERE / "rubric.md").read_text(encoding="utf-8")
    shared = make_model(env)
    fake = isinstance(shared, FakeModel)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{datetime.now():%Y%m%d-%H%M%S}.jsonl"
    tally = defaultdict(lambda: [0, 0])
    with path.open("w", encoding="utf-8") as f:
        for case in cases:
            for run in range(1, RUNS + 1):
                model = FakeModel([case["fake"]]) if fake else shared
                try:
                    fails, text = run_case(model, case)
                except ModelError as e:
                    fails, text = [f"模型出错：{e}"], None
                score = judge(FakeModel(['{"score": 3}']) if fake else shared, rubric, text) if text else None
                f.write(json.dumps({"case_id": case["id"], "kind": case["kind"], "run": run, "passed": not fails,
                                    "fails": fails, "text": text, "judge": score}, ensure_ascii=False) + "\n")
                tally[case["kind"]][0] += not fails
                tally[case["kind"]][1] += 1
    for kind, (ok, n) in tally.items():
        print(f"{kind}: {ok}/{n} 通过 ({ok / n:.0%})")
    print(f"结果：{path}")
    return path


if __name__ == "__main__":
    main()
