from pathlib import Path

import pytest

from planner.model import load_input

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


@pytest.fixture
def home_day():  # 在家的一天：没课、没 flex，四个任务都在
    inp = load_input(EXAMPLE)
    inp.fixed, inp.flex = [], []
    return inp


@pytest.fixture
def light_day():  # 只有早上一节 CM（08:00–10:00），回程 12:51
    inp = load_input(EXAMPLE)
    inp.fixed = [e for e in inp.fixed if e.id == "cm-parallele"]
    return inp
