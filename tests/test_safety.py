import pytest

from mentor.safety import CRISIS_MESSAGE, is_crisis


@pytest.mark.parametrize("text", [
    "我不想活了",
    "有时候真想死了算了",
    "我想自杀",
    "想伤害自己",
    "活不下去了",
    "想结束自己的生命",
    "我想轻生",
    "昨晚差点割腕",
    "我 想 自 杀",  # 中间夹空格也算
])
def test_crisis_phrases_are_caught(text):
    assert is_crisis(text) is True


@pytest.mark.parametrize("text", [
    "累死了",
    "笑死我了",
    "今天热得想死",
    "尴尬得想死",
    "这游戏难死了",
    "",
    "今天读了20分钟书",
])
def test_everyday_exaggeration_is_not_crisis(text):
    assert is_crisis(text) is False


def test_message_gives_both_hotlines_and_the_resume_hint():
    assert "12356" in CRISIS_MESSAGE
    assert "3114" in CRISIS_MESSAGE
    assert "继续" in CRISIS_MESSAGE
