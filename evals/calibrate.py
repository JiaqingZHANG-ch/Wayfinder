"""校准评委：某个结果文件里的评委分，和 human_scores.csv 里你对着同一个结果文件打的分。

用法：uv run python evals/calibrate.py [结果文件路径]    不写就取 results/ 里最新的。
"""
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def agreement(results: Path, scores_csv: Path) -> tuple[int, float | None, float | None]:
    """返回（两边都有分的条数，差不超过 1 分的比例，完全相同的比例；没有可比的就是 None）。
    只比 csv 里 results 列等于这个结果文件名的行：真模型每次写的字不一样，对着别的文件打的分没法比。"""
    judged = {}
    for line in results.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if r["judge"] is not None:
            judged[(r["case_id"], str(r["run"]))] = r["judge"]
    human = {}
    with scores_csv.open(encoding="utf-8-sig", newline="") as f:  # Excel 存的 UTF-8 CSV 带 BOM
        reader = csv.DictReader(f)
        for r in reader:
            if r.get("results") != results.name or not r["score"].strip():
                continue
            try:
                score = int(r["score"])
            except ValueError:
                score = 0
            if not 1 <= score <= 5:
                raise ValueError(f"{scores_csv.name} 第 {reader.line_num} 行（{r['case_id']} 第 {r['run']} 次）"
                                 f"的分数要是 1 到 5 的整数，现在是 {r['score']!r}")
            human[(r["case_id"], r["run"])] = score
    pairs = [(judged[k], v) for k, v in human.items() if k in judged]
    if not pairs:
        return 0, None, None
    return len(pairs), sum(abs(a - b) <= 1 for a, b in pairs) / len(pairs), sum(a == b for a, b in pairs) / len(pairs)


if __name__ == "__main__":
    latest = Path(sys.argv[1]) if len(sys.argv) > 1 else max((HERE / "results").glob("*.jsonl"), default=None)
    if latest is None:
        raise SystemExit("还没有结果：先跑 uv run python evals/run.py")
    n, near, exact = agreement(latest, HERE / "human_scores.csv")
    print(f"{latest.name}：{n} 条两边都有分" + (f"，差不超过 1 分的占 {near:.0%}，完全相同的占 {exact:.0%}"
                                              if near is not None else f"，先去填 human_scores.csv（results 列写 {latest.name}）"))
