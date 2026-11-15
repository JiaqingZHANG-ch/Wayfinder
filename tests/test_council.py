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
# 五个领域、每个领域两张：领域多于三个时要先分诊
FIVE = [card(name, domain) for name, domain in (
    ("甲", "判断与决策"), ("乙", "判断与决策"), ("丙", "习惯养成"), ("丁", "习惯养成"), ("戊", "学习与技能"),
    ("己", "学习与技能"), ("庚", "方向与职业"), ("辛", "方向与职业"), ("壬", "情绪与焦虑"), ("癸", "情绪与焦虑"))]


def triage(*names) -> str:
    return json.dumps({"domains": list(names)}, ensure_ascii=False)


def lens(sees="看到了晚上九点后断", worry="担心一个人待着就打游戏", advice="把读书挪到晚饭前") -> str:
    return json.dumps({"sees": sees, "worry": worry, "advice": advice}, ensure_ascii=False)


def synth(conclusion="明天晚饭前读 10 页", disagreement="") -> str:
    return json.dumps({"conclusion": conclusion, "disagreement": disagreement}, ensure_ascii=False)


class RoutingModel:
    """视角是并行调用的，先后不定；所以按 system 消息里的卡片标题决定回什么。"""

    def __init__(self, lenses: dict[str, list], synthesis: list, triage: list | tuple = ()):
        self.lenses = {title: list(replies) for title, replies in lenses.items()}
        self.synthesis = list(synthesis)
        self.triage = list(triage)
        self.calls: list[tuple[str, list[dict], bool]] = []  # (卡片标题、"triage" 或 "synth", 消息, think)
        self._lock = threading.Lock()

    def complete_json(self, messages, *, think=False):
        system = messages[0]["content"]
        with self._lock:
            # 分诊的指示里列了所有卡片标题，所以先认它
            who = "triage" if '"domains"' in system else next((t for t in self.lenses if t in system), "synth")
            self.calls.append((who, messages, think))
            replies = {"triage": self.triage, "synth": self.synthesis}.get(who)
            item = (self.lenses[who] if replies is None else replies).pop(0)
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


def test_shipped_cards_cover_five_domains_two_perspectives_each():
    from collections import Counter
    cards = load_cards(CARDS_DIR)
    assert Counter(c.domain for c in cards) == {
        "判断与决策": 2, "习惯养成": 2, "学习与技能": 2, "方向与职业": 2, "情绪与焦虑": 2}
    assert all("视角（源自" in c.title for c in cards)
    assert len({c.title for c in cards}) == 10


def test_shipped_cards_contain_no_crisis_words():
    # 卡片全文会放进给模型的指示里；里面有这类字眼会诱导视角说出来，而视角一说出来当天的带练就会被中断
    from mentor.safety import is_crisis
    assert [c.slug for c in load_cards(CARDS_DIR) if is_crisis(c.text)] == []


# 分诊：领域多于三个时，先挑此刻最相关的 2–3 个领域

def test_pick_cards_keeps_all_when_three_domains_or_fewer():
    model = RoutingModel({}, [])
    assert pick_cards([A, B, C], model, "这个人的情况") == [A, B, C]
    assert model.calls == []  # 不用分诊就不花这一次调用


def test_triage_picks_the_named_domains_in_card_order():
    model = RoutingModel({}, [], [triage("情绪与焦虑", "习惯养成")])
    assert pick_cards(FIVE, model, "这个人的情况") == [FIVE[2], FIVE[3], FIVE[8], FIVE[9]]
    (who, messages, think), = model.calls
    assert who == "triage" and think is False
    assert all(c.domain in messages[0]["content"] and c.title in messages[0]["content"] for c in FIVE)
    assert messages[1] == {"role": "user", "content": "这个人的情况"}


@pytest.mark.parametrize("bad", [
    "不是json", triage("习惯养成"), triage("判断与决策", "习惯养成", "学习与技能", "方向与职业"),
    triage("习惯养成", "习惯养成"), triage("习惯养成", "不存在的领域"), '{"domains": "习惯养成"}',
    '{"domains": [["习惯养成"], "情绪与焦虑"]}', "[]",
])
def test_triage_bad_output_twice_falls_back_to_the_first_two_domains(bad):
    model = RoutingModel({}, [], [bad, bad])
    assert pick_cards(FIVE, model, "x") == FIVE[:4]
    assert model.count("triage") == 2


def test_triage_second_try_is_used():
    model = RoutingModel({}, [], ["", triage("方向与职业", "学习与技能", "情绪与焦虑")])
    assert pick_cards(FIVE, model, "x") == FIVE[4:]


def test_triage_model_error_falls_back_to_the_first_two_domains():
    model = RoutingModel({}, [], [ModelError("网络错误")])
    assert pick_cards(FIVE, model, "x") == FIVE[:4]


def test_council_with_five_domains_only_asks_the_chosen_perspectives(store):
    chosen = FIVE[4:6] + FIVE[8:]
    model = RoutingModel({c.title: [lens()] for c in FIVE}, [synth()], [triage("学习与技能", "情绪与焦虑")])
    out = run_council(store, model, FIVE, D14, "intake")
    assert [o.title for o in out.opinions] == [c.title for c in chosen]
    assert sorted(who for who, _, _ in model.calls) == sorted(["triage", "synth"] + [c.title for c in chosen])
    assert "研二，找实习" in model.calls[0][1][1]["content"]  # 分诊看的是同一份材料


def test_triage_crisis_flag_voids_council_and_pauses(store):
    model = RoutingModel({c.title: [lens()] for c in FIVE}, [synth()], ['{"domains": [], "crisis": true}'])
    assert run_council(store, model, FIVE, D14, "intake") is None
    assert model.count("triage") == len(model.calls) == 1  # 一个视角都没问
    assert store.latest_council() is None and store.is_paused(D14) is True


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


# 危机内容不进智囊团：这类话只能由程序给固定的求助信息，不能让几个视角自由发挥

def test_profile_with_crisis_words_runs_nothing(store):
    store.set_profile("## 焦虑点\n有时候真的不想活了", D14)
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert model.calls == [] and store.latest_council() is None


def test_day_with_a_crisis_runs_nothing_even_after_resume(store):
    store.log_crisis(D14, "x")
    store.resume(D14)
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert model.calls == []
    later = RoutingModel({A.title: [lens()], B.title: [lens()]}, [synth()])
    assert run_council(store, later, [A, B], D14 + timedelta(days=1), "weekly") is not None  # 第二天照常


@pytest.mark.parametrize("flag", ["true", '"true"', "1"])
def test_lens_crisis_flag_voids_council_and_pauses(store, flag):
    flagged = '{"sees": "a", "worry": "b", "advice": "c", "crisis": %s}' % flag
    model = RoutingModel({A.title: [flagged], B.title: [lens()], C.title: [lens()]}, [synth()])
    assert run_council(store, model, [A, B, C], D14, "intake") is None
    assert store.latest_council() is None and model.count("synth") == 0
    assert store.is_paused(D14) is True  # 页面随后显示固定的求助信息


def test_synthesis_crisis_flag_voids_council_and_pauses(store):
    model = RoutingModel({A.title: [lens()], B.title: [lens()]}, ['{"conclusion": "a", "disagreement": "", "crisis": true}'])
    assert run_council(store, model, [A, B], D14, "intake") is None
    assert store.latest_council() is None and store.is_paused(D14) is True


@pytest.mark.parametrize("where", ["lens", "synth"])
def test_output_with_crisis_words_voids_council_and_pauses(store, where):
    bad_lens = lens(advice="别再想自杀的事") if where == "lens" else lens()
    bad_synth = synth("你说过不想活了") if where == "synth" else synth()
    model = RoutingModel({A.title: [bad_lens], B.title: [lens()], C.title: [lens()]}, [bad_synth])
    assert run_council(store, model, [A, B, C], D14, "intake") is None
    assert store.latest_council() is None and store.is_paused(D14) is True


@pytest.mark.parametrize("where", ["triage", "lens", "synth"])
def test_bare_crisis_flag_without_other_fields_still_voids_and_pauses(store, where):
    # 指示里说的是「不要分析，加上 crisis」，模型很可能只回这一个字段
    bare = '{"crisis": true}'
    model = RoutingModel({c.title: [bare if where == "lens" else lens()] for c in FIVE},
                         [bare if where == "synth" else synth()],
                         [bare if where == "triage" else triage("判断与决策", "习惯养成")])
    assert run_council(store, model, FIVE, D14, "intake") is None
    assert store.latest_council() is None and store.is_paused(D14) is True


def test_prompts_tell_the_model_to_flag_crisis():
    import mentor.council as council
    assert "crisis" in council._LENS and "crisis" in council._SYNTH and "crisis" in council._TRIAGE


# 时限与意外

def test_slow_lens_is_dropped_after_the_time_limit(store, monkeypatch):
    import time

    import mentor.council as council
    monkeypatch.setattr(council, "LENS_SECONDS", 0.3)

    class Slow(RoutingModel):
        def complete_json(self, messages, *, think=False):
            if A.title in messages[0]["content"]:
                time.sleep(1.5)
            return super().complete_json(messages, think=think)

    model = Slow({A.title: [lens()], B.title: [lens()], C.title: [lens()]}, [synth()])
    started = time.monotonic()
    out = run_council(store, model, [A, B, C], D14, "intake")
    assert time.monotonic() - started < 1.2  # 没有等那个慢的
    assert [o.title for o in out.opinions] == [B.title, C.title]


def test_unexpected_error_in_one_lens_only_drops_that_lens(store):
    model = RoutingModel({A.title: [RuntimeError("意外")], B.title: [lens()], C.title: [lens()]}, [synth()])
    assert [o.title for o in run_council(store, model, [A, B, C], D14, "intake").opinions] == [B.title, C.title]


def test_shipped_cards_do_not_invite_speaking_as_the_author_or_labelling_the_person():
    for c in load_cards(CARDS_DIR):
        style = c.text.split("## 说话方式")[1].split("##")[0]
        assert "自嘲" not in style and "承认自己" not in style, c.slug
        uses = [line for line in c.text.splitlines() if line.strip().startswith("用在这个人身上")]
        assert not any("自怜" in line or "其实一份简历都没投" in line for line in uses), c.slug


def test_unknown_trigger_raises(store):
    with pytest.raises(ValueError):
        run_council(store, RoutingModel({}, []), [A, B], D14, "daily")
