"""DeepSeek 客户端。写法沿用 warehouse-night-desk 的 polish.py：不跟随重定向，报错里不带密钥。"""
import http.client
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Protocol


class ModelError(Exception): ...


class ModelPort(Protocol):
    # schema：要求的 JSON 结构（JSON Schema）。Ollama 按它约束输出；DeepSeek 只有 JSON 模式，忽略它
    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False,
                      schema: dict | None = None) -> str: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """跟随重定向会把带 Bearer key 的请求交给别的地址；不跟随时 302 就当 HTTP 错误报出来。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DeepSeekModel:
    def __init__(self, api_key: str, *, base_url: str = "https://api.deepseek.com",
                 model: str = "deepseek-v4-pro", timeout: float = 90.0, opener=urllib.request.urlopen) -> None:
        if opener is urllib.request.urlopen:
            opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(debuglevel=0)).open
        self._key, self._base, self._model, self._timeout, self._open = api_key, base_url, model, timeout, opener

    def __repr__(self) -> str:  # 不带密钥
        return f"DeepSeekModel(model={self._model!r})"

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "DeepSeekModel":
        key = env.get("DEEPSEEK_API_KEY", "").strip()
        if not key:
            raise ModelError("缺少环境变量 DEEPSEEK_API_KEY")
        return cls(key)

    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False,
                      schema: dict | None = None) -> str:
        # 日常对话用非思考模式换响应速度；智囊团的视角（think=True）用思考模式，慢但对着记录说话更准。
        # 思考的 token 也算在 max_tokens 里：2026-11-14 实测上限 4000 时推理会把它用光、答案为空，所以给 16000。
        body = {"model": self._model, "messages": messages,
                "response_format": {"type": "json_object"}, "max_tokens": 16000 if think else 2000,
                "thinking": {"type": "enabled" if think else "disabled"}}
        req = urllib.request.Request(
            f"{self._base}/chat/completions", data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"})
        try:
            with self._open(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            e.close()
            raise ModelError(f"HTTP {e.code}") from None
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError):
            raise ModelError("网络错误") from None
        except (ValueError, KeyError, IndexError, TypeError):
            raise ModelError("模型返回格式不对") from None
        if content is None:
            return ""  # 空答案（比如推理用光了 token）不是连不上：原样交回，调用方按「不合约定」重试
        if not isinstance(content, str):
            raise ModelError("模型返回格式不对")
        return content


class OllamaModel:
    """本机 Ollama（默认 http://127.0.0.1:11434）。不带密钥，数据不出电脑。"""

    def __init__(self, model: str = "qwen3:14b", *, base_url: str = "http://127.0.0.1:11434",
                 timeout: float = 120.0, opener=urllib.request.urlopen) -> None:
        if opener is urllib.request.urlopen:
            opener = urllib.request.build_opener(_NoRedirect).open
        self._model, self._base, self._timeout, self._open = model, base_url.rstrip("/"), timeout, opener

    def __repr__(self) -> str:
        return f"OllamaModel(model={self._model!r})"

    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False,
                      schema: dict | None = None) -> str:
        body = {"model": self._model, "messages": messages, "stream": False,
                "format": schema if schema is not None else "json"}
        if think:  # 不支持思考的模型收到 think 会报错，所以只在要的时候才带
            body["think"] = True
        req = urllib.request.Request(f"{self._base}/api/chat", data=json.dumps(body).encode("utf-8"),
                                     method="POST", headers={"Content-Type": "application/json"})
        try:
            with self._open(req, timeout=self._timeout) as resp:
                content = json.loads(resp.read())["message"]["content"]
        except urllib.error.HTTPError as e:
            e.close()
            raise ModelError(f"Ollama HTTP {e.code}（模型 {self._model} 下载了吗？）") from None
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError):
            raise ModelError("连不上 Ollama：它开着吗？") from None
        except (ValueError, KeyError, TypeError):
            raise ModelError("模型返回格式不对") from None
        if not isinstance(content, str):
            raise ModelError("模型返回格式不对")
        return content


class FakeModel:
    """测试和离线开发用：按顺序交回写好的回答，并记下每次收到的请求。回答用完了就报 ModelError。"""

    def __init__(self, replies: list[str] | None = None) -> None:
        self.replies, self.calls = list(replies or []), []

    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False,
                      schema: dict | None = None) -> str:
        self.calls.append({"messages": messages, "think": think, "schema": schema})
        if not self.replies:
            raise ModelError("假模型没有准备回答")
        return self.replies.pop(0)


class RecordingModel:
    """包一层：每次调模型记一条（发了什么、回了什么、哪个模型、用了多久、出了什么错），事后能用 replay 原样重放。"""

    def __init__(self, inner: ModelPort, record: Callable[[dict], None]) -> None:
        self.inner, self.record = inner, record

    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False,
                      schema: dict | None = None) -> str:
        start, reply, error = time.monotonic(), None, None
        try:
            reply = self.inner.complete_json(messages, think=think, schema=schema)
            return reply
        except ModelError as e:
            error = str(e)
            raise
        finally:
            self.record({"model": repr(self.inner), "messages": messages, "think": think, "schema": schema,
                         "reply": reply, "error": error, "ms": round((time.monotonic() - start) * 1000)})


def replay(call: dict) -> "FakeModel":
    """拿一条调用记录造一个假模型：同样的输入走一遍，模型这一步回的还是当时那句。"""
    return FakeModel([] if call["reply"] is None else [call["reply"]])


def make_model(env: Mapping[str, str]) -> ModelPort:
    """唯一的模型出口：MODEL=fake（默认）| ollama | deepseek。ollama 的模型名用 OLLAMA_MODEL 改。"""
    kind = env.get("MODEL", "fake").strip().lower()
    if kind == "fake":
        return FakeModel()
    if kind == "ollama":
        return OllamaModel(env.get("OLLAMA_MODEL", "").strip() or "qwen3:14b")
    if kind == "deepseek":
        return DeepSeekModel.from_env(env)
    raise ModelError(f"MODEL 只能是 fake、ollama 或 deepseek，现在是 {kind!r}")
