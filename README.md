# 成长导师（暂用名）

会记住你、每天跟你对一次账、每周帮你复盘的 AI 导师。这是只在本机运行的单人版（第一阶段第一步）。

设计与计划在知识库：`17-AI学习/AI应用开发与FDE实战/AI从0开发/成长导师/`。

## 启动

```powershell
.\start.ps1
```

然后用浏览器打开 <http://127.0.0.1:8765>。需要环境变量 `DEEPSEEK_API_KEY`。

## 数据

- 全部存在 `var/mentor.db`（不进 git）。想从头再来，关掉程序后删掉这个文件即可。
- 你说的话会发给 DeepSeek 用来生成回复；除此之外不离开这台电脑。

## 代码

| 文件 | 负责什么 |
|---|---|
| `src/mentor/store.py` | 数据库：档案、对话、每日记录、每周复盘 |
| `src/mentor/safety.py` | 危机关键词检查与固定的求助话术 |
| `src/mentor/model.py` | DeepSeek 客户端 |
| `src/mentor/prompts.py` | 给模型的固定指示，以及每次带给它的档案和近期记录 |
| `src/mentor/mentor.py` | 判断这次聊什么、处理一轮对话、校验并保存结果 |
| `src/mentor/ui.py` | 对话、档案、记录三个页面 |

前五个文件不依赖界面，将来换成 App 可以原样留用。

## 测试

```powershell
uv run pytest -q
```

测试不联网、不调用模型。
