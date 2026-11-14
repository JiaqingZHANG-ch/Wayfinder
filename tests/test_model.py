import io
import json
import urllib.error

import pytest

from mentor.model import DeepSeekModel, ModelError

KEY = "sk-test-SECRET-123"
MESSAGES = [{"role": "system", "content": "指示"}, {"role": "user", "content": "你好"}]


class FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._payload


class RecordingOpener:
    def __init__(self, payload=None, error=None):
        self.payload, self.error, self.requests = payload, error, []

    def __call__(self, req, timeout=None):
        self.requests.append((req, timeout))
        if self.error is not None:
            raise self.error
        return FakeResponse(self.payload)


def reply(content) -> bytes:
    return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")


def test_sends_messages_and_returns_content():
    opener = RecordingOpener(reply('{"reply": "好"}'))
    out = DeepSeekModel(KEY, opener=opener).complete_json(MESSAGES)
    assert out == '{"reply": "好"}'
    req, timeout = opener.requests[0]
    assert req.full_url == "https://api.deepseek.com/chat/completions"
    assert req.get_method() == "POST"
    assert req.get_header("Authorization") == f"Bearer {KEY}"
    assert timeout == 90.0
    body = json.loads(req.data)
    assert body["messages"] == MESSAGES
    assert body["model"] == "deepseek-v4-pro"
    assert body["response_format"] == {"type": "json_object"}
    assert body["thinking"] == {"type": "disabled"}


def test_http_error_becomes_model_error_without_key():
    err = urllib.error.HTTPError("https://api.deepseek.com/chat/completions", 401, KEY, {}, io.BytesIO(b""))
    model = DeepSeekModel(KEY, opener=RecordingOpener(error=err))
    with pytest.raises(ModelError) as info:
        model.complete_json(MESSAGES)
    assert "401" in str(info.value)
    assert KEY not in str(info.value)
    assert info.value.__cause__ is None  # 原始异常里可能带着请求头，不外带
    assert KEY not in repr(model)


@pytest.mark.parametrize("error", [urllib.error.URLError("dns"), TimeoutError(), ConnectionResetError()])
def test_network_error_and_timeout_become_model_error(error):
    with pytest.raises(ModelError):
        DeepSeekModel(KEY, opener=RecordingOpener(error=error)).complete_json(MESSAGES)


@pytest.mark.parametrize("payload", [b"not json", b'{"choices": []}', b'{"nope": 1}', reply(""), reply(None)])
def test_bad_shape_and_empty_content_become_model_error(payload):
    with pytest.raises(ModelError):
        DeepSeekModel(KEY, opener=RecordingOpener(payload)).complete_json(MESSAGES)


def test_from_env_missing_key():
    with pytest.raises(ModelError, match="缺少环境变量 DEEPSEEK_API_KEY"):
        DeepSeekModel.from_env({})
    with pytest.raises(ModelError):
        DeepSeekModel.from_env({"DEEPSEEK_API_KEY": "   "})


def test_from_env_uses_key():
    assert isinstance(DeepSeekModel.from_env({"DEEPSEEK_API_KEY": KEY}), DeepSeekModel)
