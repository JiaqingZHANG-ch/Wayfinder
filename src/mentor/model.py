"""DeepSeek 客户端。写法沿用 warehouse-night-desk 的 polish.py：不跟随重定向，报错里不带密钥。"""
import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Mapping
from typing import Protocol


class ModelError(Exception): ...


class ModelPort(Protocol):
    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False) -> str: ...


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

    def complete_json(self, messages: list[dict[str, str]], *, think: bool = False) -> str:
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
