"""命令行：python -m planner INPUT.json -o OUTPUT.json"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .check import check_plan
from .errors import InputError, PlanInfeasible
from .model import load_input
from .output import to_r2
from .solve import solve_day


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="planner", description="排出一天的逐时安排")
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, required=True)
    args = ap.parse_args(argv)

    try:
        inp = load_input(args.input)
    except (InputError, OSError) as e:
        print(e if isinstance(e, InputError) else f"输入有误：读不了文件 {args.input}（{e}）", file=sys.stderr)
        return 3
    try:
        plan = solve_day(inp)
    except PlanInfeasible as e:
        print(f"排不出来：{e}", file=sys.stderr)
        return 1
    problems = check_plan(inp, plan)
    if problems:
        print("自检没通过，不输出：\n" + "\n".join(problems), file=sys.stderr)
        return 2
    args.output.write_text(json.dumps(to_r2(plan, inp), ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
