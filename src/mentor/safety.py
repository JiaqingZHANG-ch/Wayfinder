"""危机检查：用户的话里出现伤害自己的意思时，程序直接给固定话术，不交给模型临场发挥。"""
import json
import re

# 号码核实于 2026-11-14：12356（国家卫健委，全国统一心理援助热线）；3114（3114.fr，全天、免费）
CRISIS_MESSAGE: str = (
    "听到你这么说，我很担心你。这件事比今天的计划重要得多，但我只是一个程序，帮不了你这个。\n"
    "请现在联系能帮到你的人：\n"
    "· 在中国大陆：拨打 12356 心理援助热线；有紧急危险拨 120 或 110\n"
    "· 在法国：拨打 3114（预防自杀热线，全天免费）；有紧急危险拨 112\n"
    "· 也请告诉一个你信任的人，让他现在陪着你。\n"
    "今天的带练先停在这里。等你觉得可以了，点下面的「继续」。"
)

# 按国家显示的热线（第 8 周）。只放核实过的号码；国家没填或不在表里，就把两边都列出来（上面那段）。
HOTLINES: dict[str, str] = {
    "CN": "· 拨打 12356 心理援助热线；有紧急危险拨 120 或 110\n",
    "FR": "· 拨打 3114（预防自杀热线，全天免费）；有紧急危险拨 112\n",
}


def crisis_message(country: str) -> str:
    if country not in HOTLINES:
        return CRISIS_MESSAGE
    head, sep, rest = CRISIS_MESSAGE.partition("请现在联系能帮到你的人：\n")
    return head + sep + HOTLINES[country] + rest[rest.index("· 也请"):]


# 只有这几种身体或场面上的夸张说法（热得想死）不算；「难受得想死」「我觉得想死」都算。
# 单个「死」字（累死了）不算；「不想活动」不是「不想活」。宁可多拦：误拦只需点一次「继续」。
# shortcut: 只认简体中文的明确说法，含蓄表达、繁体和外语靠模型返回的 crisis 标记兜底；有实例再扩词表
_HYPERBOLE = re.compile(r"(?:热|冷|累|困|饿|渴|撑|忙|尴尬|笑|羞|辣|酸|无聊)得想死")
_CRISIS = re.compile(r"自杀|自残|轻生|不想活(?!动)|活不下去|结束生命|结束自己|伤害自己|割腕|想死")


def is_crisis(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return _CRISIS.search(_HYPERBOLE.sub("", compact)) is not None


def model_output_is_crisis(raw: str) -> bool:
    """模型的一段输出该不该按危机处理：标了 crisis，或者整段话里任何地方出现了危机字眼。

    要在校验格式之前查。模型看出来了却没按约定回（只回一个标记、把话写在别的字段里、干脆不回 json）是常事，
    这时候不能把它当成「格式不对」丢掉。
    """
    try:
        obj = json.loads(raw)
    except (ValueError, RecursionError):
        return is_crisis(raw)
    flag = obj.get("crisis") if isinstance(obj, dict) else None
    # 标记写成 "true"、1 也算；再把每段文字取出来查（解开了 \uXXXX 转义和 \n 换行）
    return (flag is not None and flag is not False) or any(is_crisis(t) for t in all_strings(obj))


def all_strings(x) -> list[str]:
    """一个 JSON 值里的全部字符串（包括键）。要逐段查：整段 dump 成 JSON 时换行变成 \\n 两个字，「想\\n死」会漏。"""
    if isinstance(x, str):
        return [x]
    if isinstance(x, dict):
        return [s for k, v in x.items() for s in all_strings(k) + all_strings(v)]
    if isinstance(x, list):
        return [s for v in x for s in all_strings(v)]
    return []
