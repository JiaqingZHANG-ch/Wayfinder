from planner.model import to_min
from planner.solve import block_progress, solve_day


def proj(plan):
    return [b for b in plan.blocks if b.kind == "proj"]


def task(inp, tid):
    return next(t for t in inp.tasks if t.id == tid)


def test_block_progress_decay():
    d = [1.0, 0.85, 0.7]
    assert [block_progress(1.0, n, d) for n in (1, 2, 3)] == [25, 46, 64]  # 第 3 个番茄只加 0.7×25
    assert block_progress(2.0, 1, d) == 50 and block_progress(1.5, 3, d) == 96


def test_blocks_are_pomodoros(home_day):
    heavy = {t.id for t in home_day.tasks if t.heavy}
    blocks = proj(solve_day(home_day))
    assert blocks
    for b in blocks:
        assert b.end - b.start in (30, 60, 90) and b.pomodoros == (b.end - b.start) // 30
        assert b.task_id not in heavy or b.pomodoros >= 2
        assert not any(b.start < edge < b.end for edge in (720, 1080))  # 不跨时段
        eff = 2.0 if b.end <= 720 else 1.5 if b.end <= 1080 else 1.0
        assert b.progress_min == block_progress(eff, b.pomodoros, home_day.energy.pomodoro_decay)


def test_hard_task_lands_in_morning(home_day):
    home_day.tasks = [task(home_day, "gnn")]
    assert min(b.start for b in proj(solve_day(home_day))) < to_min("12:00")


def test_no_extra_pomodoro(home_day):  # 剩 60：早上 2 个番茄（92）够了，第 3 个不许排
    home_day.tasks = [task(home_day, "egg-flow")]
    home_day.tasks[0].remaining_min = 60
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) == 2


def test_tiny_remainder(home_day):  # Review Focus 3
    home_day.tasks = [task(home_day, "egg-flow")]
    home_day.tasks[0].remaining_min = 10
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) <= 1
