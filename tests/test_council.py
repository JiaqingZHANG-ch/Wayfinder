import json
import threading
from datetime import date, timedelta

import pytest

from mentor.council import CARDS_DIR, MIN_OPINIONS, Card, load_cards, pick_cards, run_council
from mentor.model import ModelError
from mentor.store import Council, Opinion, Store

D14 = date(2026, 11, 14)
OLD = Council(D14 - timedelta(days=7), "weekly", "旧结论XYZ", "", (Opinion("甲视角（源自某甲）", "a", "b", "c"),))


def card(name: str, domain: str = "判断与决策") -> Card:
    title = f"{name}视角（源自某{name}）"
    return Card(name, title, domain, f"# {title}\n领域：{domain}\n\n## 原则\n1. **{name}的原则**")


A, B, C = card("甲"), card("乙"), card("丙", "习惯养成")


def lens(sees="看到了晚上九点后断", worry="担心一个人待着就打游戏", advice="把读书挪到晚饭前") -> str:
    return json.dumps({"sees": sees, "worry": worry, "advice": advice}, ensure_ascii=False)


def synth(conclusion="明天晚饭前读 10 页", disagreement="") -> str:
    return json.dumps({"conclusion": conclusion, "disagreement": disagreement}, ensure_ascii=False)


class RoutingModel:
    """视角是并行调用的，先后不定；所以按 system 消息里的卡片标题决定回什么。"""

    def __init__(self, lenses: dict[str, list], synthesis: list):
        self.lenses = {title: list(replies) for title, replies in lenses.items()}
        self.synthesis = list(synthesis)
        self.calls: list[tuple[str, list[dict], bool]] = []  # (卡片标题或 "synth", 消息, think)
        self._lock = threading.Lock()

    def complete_json(self, messages, *, think=False):
        system = messages[0]["content"]
        with self._lock:
            who = next((title for title in self.lenses if title in system), "synth")
            self.calls.append((who, messages, think))
            item = (self.synthesis if who == "synth" else self.lenses[who]).pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def count(self, who: str) -> int:
        return sum(1 for name, _, _ in self.calls if name == who)


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "mentor.db")
    s.set_profile("## 处境\n研二，找实习\n\n## 焦虑点\n怕毕业即失业", D14)
    return s


# 卡片

def test_load_cards_parses_title_and_domain_sorted_by_name(tmp_path):
    (tmp_path / "02-b.md").write_text("# 乙视角（源自某乙）\n领域：习惯养成\n\n## 原则\n1. x", encoding="utf-8")
    (tmp_path / "01-a.md").write_text("# 甲视角（源自某甲）\n领域：判断与决策\n\n## 原则\n1. y", encoding="utf-8")
    cards = load_cards(tmp_path)
    assert [(c.slug, c.title, c.domain) for c in cards] == [
        ("01-a", "甲视角（源自某甲）", "判断与决策"), ("02-b", "乙视角（源自某乙）", "习惯养成")]
    assert "## 原则\n1. y" in cards[0].text


@pytest.mark.parametrize("body", ["没有标题\n领域：习惯养成", "# 有标题但没有领域\n\n## 原则"])
def test_load_cards_rejects_file_without_title_or_domain(tmp_path, body):
    (tmp_path / "03-bad.md").write_text(body, encoding="utf-8")
    with pytest.raises(ValueError, match="03-bad.md"):
        load_cards(tmp_path)


def test_non_markdown_files_are_ignored_and_missing_dir_is_empty(tmp_path):
    (tmp_path / "notes.txt").write_text("不是卡片", encoding="utf-8")
    assert load_cards(tmp_path) == []
    assert load_cards(tmp_path / "nope") == []


def test_pick_cards_keeps_all_when_three_domains_or_fewer():
    assert pick_cards([A, B, C]) == [A, B, C]


def test_shipped_cards_are_named_as_perspectives():
    cards = load_cards(CARDS_DIR)
    assert len(cards) >= 4
    assert len({c.domain for c in cards}) >= 2
    assert all("视角（源自" in c.title for c in cards)


# 正常开会

def test_council_saves_opinions_in_card_order_with_conclusion(store):
    model = RoutingModel({A.title: [lens(sees="甲看到")], B.title: [lens(sees="乙看到")], C.title: [lens(sees="丙看到")]},
                         [synth("明天晚饭前读 10 页", "甲说先减量，丙说先换时间")])
    out = run_council(store, model, [A, B, C], D14, "intake")
    assert out == Council(D14, "intake", "明天晚饭前读 10 页", "甲说先减量，丙说先换时间", (
        Opinion(A.title, "甲看到", "担心一个人待着就打游戏", "把读书挪到晚饭前"),
        Opinion(B.title, "乙看到", "担心一个人待着就打游戏", "把读书挪到晚饭前"),
        Opinion(C.title, "丙看到", "担心一个人待着就打游戏", "把读书挪到晚饭前")))
    assert store.latest_council() == out
    assert model.count("synth") == 1


def test_each_lens_sees_only_its_own_card_and_no_earlier_council(store):
    store.save_council(OLD)
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    run_council(store, model, [A, B], D14, "intake")
    for who, messages, _ in model.calls:
        text = json.dumps(messages, ensure_ascii=False)
        if who == "synth":
            assert A.title in text and B.title in text  # 合成时才把各位的意见放在一起
            continue
        other = B.title if who == A.title else A.title
        assert other not in text
        assert "旧结论XYZ" not in text
        assert "研二，找实习" in text  # 这个人的情况每个视角都拿到了


def test_lenses_think_and_synthesis_does_not(store):
    # 视角要对着记录里的日期和数字说话，用思考模式更准；合成只是归并，用快的
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    run_council(store, model, [A, B], D14, "weekly")
    assert len(model.calls) == 3
    assert all(think == (who != "synth") for who, _, think in model.calls)


def test_empty_reply_is_retried(store):
    model = RoutingModel({A.title: ["", lens(sees="重试后")], B.title: [lens()]}, ["", synth("重试后的结论")])
    out = run_council(store, model, [A, B], D14, "weekly")
    assert out.opinions[0].sees == "重试后" and out.conclusion == "重试后的结论"


# 降级

def test_bad_lens_is_dropped_others_proceed(store):
    model = RoutingModel({A.title: [lens()], B.title: ["不是json", '{"sees": 1}'], C.title: [lens()]}, [synth()])
    out = run_council(store, model, [A, B, C], D14, "intake")
    assert [o.title for o in out.opinions] == [A.title, C.title]
    assert model.count(B.title) == 2  # 试了两次才放弃


def test_lens_second_try_is_used(store):
    model = RoutingModel({A.title: ["   ", lens(sees="第二次")], B.title: [lens()]}, [synth()])
    assert run_council(store, model, [A, B], D14, "intake").opinions[0].sees == "第二次"


def test_lens_model_error_is_dropped(store):
    model = RoutingModel({A.title: [ModelError("网络错误")], B.title: [lens()], C.title: [lens()]}, [synth()])
    out = run_council(store, model, [A, B, C], D14, "intake")
    assert [o.title for o in out.opinions] == [B.title, C.title]
    assert model.count(A.title) == 1  # 连不上就不再试


def test_fewer_than_two_opinions_gives_no_council(store):
    assert MIN_OPINIONS == 2
    model = RoutingModel({A.title: [lens()], B.title: ["x", "y"]}, [synth()])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert store.latest_council() is None and model.count("synth") == 0
    assert run_council(store, RoutingModel({}, []), [], D14, "intake") is None  # 一张卡片都没有


def test_bad_synthesis_twice_gives_no_council(store):
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, ["不是json", '{"conclusion": ""}'])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert store.latest_council() is None and model.count("synth") == 2


def test_synthesis_second_try_is_used(store):
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, ["[]", synth("第二次的结论")])
    assert run_council(store, model, [A, B], D14, "intake").conclusion == "第二次的结论"


def test_synthesis_model_error_gives_no_council(store):
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [ModelError("HTTP 500")])
    assert run_council(store, model, [A, B], D14, "intake") is None


@pytest.mark.parametrize("bad", [
    lens(sees="字" * 301), lens(advice="  "), json.dumps({"sees": "a", "worry": "b"}),
    json.dumps({"sees": "a", "worry": "b", "advice": ["c"]}), "null",
])
def test_overlong_or_empty_lens_fields_count_as_bad(store, bad):
    model = RoutingModel({A.title: [bad, bad], B.title: [lens()], C.title: [lens()]}, [synth()])
    assert [o.title for o in run_council(store, model, [A, B, C], D14, "intake").opinions] == [B.title, C.title]


@pytest.mark.parametrize("bad", [synth("字" * 601), synth("好", "字" * 401), json.dumps({"conclusion": "好"}),
                                 json.dumps({"conclusion": "好", "disagreement": None})])
def test_overlong_or_missing_synthesis_fields_count_as_bad(store, bad):
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [bad, bad])
    assert run_council(store, model, [A, B], D14, "intake") is None


# 重复与暂停

def test_same_day_same_trigger_returns_stored_without_calls(store):
    first = run_council(store, RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()]), [A, B], D14, "intake")
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth("不该出现")])
    assert run_council(store, model, [A, B], D14, "intake") == first
    assert model.calls == []


def test_other_trigger_same_day_runs_again(store):
    run_council(store, RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()]), [A, B], D14, "intake")
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth("周复盘的结论")])
    assert run_council(store, model, [A, B], D14, "weekly").conclusion == "周复盘的结论"


def test_paused_day_runs_nothing(store):
    store.log_crisis(D14, "x")
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert model.calls == []


def test_unknown_trigger_raises(store):
    with pytest.raises(ValueError):
        run_council(store, RoutingModel({}, []), [A, B], D14, "daily")
