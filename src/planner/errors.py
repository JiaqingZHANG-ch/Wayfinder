class PlanInfeasible(Exception):
    """这一天按规则排不出来；消息写给人看，说明是哪里冲突。"""


class InputError(ValueError):
    """plan_input.json 本身有错（缺字段、时间格式不对、取值拼错）。"""
