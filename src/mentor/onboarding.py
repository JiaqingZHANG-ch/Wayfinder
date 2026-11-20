"""轻量建档的对话部分（合并版设计 二、六之二）：问方向，一次只问一个问题，问题由程序定，模型只回应一句。

每一轮发给模型的只有三样（第 4 周循环 ⑤ 要逐段讲清楚为什么）：
  1. 说话规则（tone.RULES）——所有对话共用；
  2. 已经确认的档案——没确认的不算事实，不给模型看；
  3. 这一轮用户在回答的那一个问题和他的回答——不带整段历史，最后一轮才带上前面几问的原话。
"""
import json
from typing import Literal

from .model import ModelError, ModelPort
from .safety import model_output_is_crisis
from .tone import RULES, banned_hits

QUESTIONS = (
    "最近一次觉得「这样过就对了」，是哪一天、在做什么？",
    "接下来三个月，你最想多花时间在哪一件事上？",
)
MAX_DIRECTION = 40  # 方向只写一句话
FALLBACK = "这句话我记下了。"  # 模型没答好时的回应；对账用的「今天记下了」放在建档里不顺


def build_messages(question: str, answer: str, confirmed: list[dict],
                   earlier: list[tuple[str, str]] = ()) -> list[dict[str, str]]:
    """这一轮发给模型的全部内容。earlier 只在最后一轮给：[(问题, 用户原话), ...]。"""
    profile = "\n".join(f"- {p['level']}：{p['content']}" for p in confirmed) or "（还没有）"
    task = "只用一句话回应他的回答，不提新问题，不给建议。"
    shape = '{"reply": "……"}'
    if earlier:
        task += f"再用一句话（{MAX_DIRECTION} 字以内）写出他自己说的方向，只用他说过的内容，不加新东西。"
        shape = '{"reply": "……", "direction": "……"}'
    system = (
        "你是一个安静的成长导师，正在第一次认识用户。\n"
        f"{RULES}\n\n"
        f"用户已经确认过的档案：\n{profile}\n\n"
        f"这一轮：{task}只回 JSON：{shape}。"
        "如果用户的话里有想伤害自己的意思，只回 {\"crisis\": true}。"
    )
    lines = [f"前面的问题「{q}」，他答：{a}" for q, a in earlier]
    lines.append(f"这一问「{question}」，他答：{answer}")
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n".join(lines)}]


def run_round(model: ModelPort, question: str, answer: str, confirmed: list[dict],
              earlier: list[tuple[str, str]] = ()) -> tuple[Literal["ok", "crisis"], dict | None]:
    """跑一轮。返回 ("ok", {"reply", "direction"}) 或 ("crisis", None)。

    模型连不上、格式不对、两次都命中禁用说法：回应用兜底句，方向用用户自己最后那句原话，建档照样往下走。
    """
    final = bool(earlier)
    messages = build_messages(question, answer, confirmed, earlier)
    for _ in range(2):  # 命中禁用说法就重来一次
        try:
            raw = model.complete_json(messages)
        except ModelError:
            break
        if model_output_is_crisis(raw):  # 先查危机，再查格式
            return "crisis", None
        try:
            obj = json.loads(raw)
            reply, direction = obj["reply"], obj.get("direction") if final else None
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
        if not isinstance(reply, str) or not reply.strip():
            continue
        if final and (not isinstance(direction, str) or not direction.strip()):
            continue
        if banned_hits(reply) or (final and banned_hits(direction)):
            continue
        return "ok", {"reply": reply.strip(), "direction": direction.strip()[:MAX_DIRECTION] if final else None}
    return "ok", {"reply": FALLBACK, "direction": answer.strip()[:MAX_DIRECTION] if final else None}
