"""校准评委：最近一次结果里的评委分，和 human_scores.csv 里你打的分，差不超过 1 分的比例。"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def agreement(results: Path, scores_csv: Path) -> tuple[int, float | None]:
    """返回（两边都有分的条数，差不超过 1 分的比例；没有可比的就是 None）。"""
    judged = {}
    for line in results.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if r["judge"] is not None:
            judged[(r["case_id"], str(r["run"]))] = r["judge"]
    with scores_csv.open(encoding="utf-8", newline="") as f:
        human = {(r["case_id"], r["run"]): int(r["score"]) for r in csv.DictReader(f) if r["score"].strip()}
    pairs = [(judged[k], v) for k, v in human.items() if k in judged]
    return len(pairs), (sum(abs(a - b) <= 1 for a, b in pairs) / len(pairs) if pairs else None)


if __name__ == "__main__":
    latest = max((HERE / "results").glob("*.jsonl"), default=None)
    if latest is None:
        raise SystemExit("还没有结果：先跑 uv run python evals/run.py")
    n, share = agreement(latest, HERE / "human_scores.csv")
    print(f"{latest.name}：{n} 条两边都有分" + (f"，差不超过 1 分的占 {share:.0%}" if share is not None else "，先去填 human_scores.csv"))
