# 评测

20 个用例（对账句子 8、长谈回应 6、复盘正文 6），每个跑 3 次。不进 CI，不改提示词。

## 跑

```
uv run python evals/run.py                      # MODEL=fake：只验管线，用例里自带假回答
MODEL=ollama uv run python evals/run.py         # 真模型（或 MODEL=deepseek）
```

先判代码能判的规则（对账：状态和电量对；长谈：不提问、无禁用说法、不写「用户」；复盘：数字都在统计里；模型退到兜底句算没过），再请同一个模型按 `evals/rubric.md` 给「像不像人说话」打 1–5 分（对账不打分）。结果在 `evals/results/<时间>.jsonl`（不入库），终端打印每类通过率。

## 填分

打开最近一次结果，看每条的 `text`，在 `evals/human_scores.csv` 里按 `case_id,run,score,note` 填你自己的 1–5 分，不想打的行不写。

## 校准

```
uv run python evals/calibrate.py
```

打印「评委和你差不超过 1 分」的比例。比例高之前，不要拿评委的分当结论；换模型或改 rubric 后重新校准。
