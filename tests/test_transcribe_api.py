"""POST /transcribe：没配转写 501，太大 413，配了就跑脚本拿文字（这里用假的 subprocess）。"""
import subprocess
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mentor.model import FakeModel
from server import api
from server.db import Db


@pytest.fixture
def client(tmp_path):
    return TestClient(api.create_app(Db(tmp_path / "app.db"), FakeModel(),
                                     now=lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)))


def post(client, data=b"fake m4a"):
    return client.post("/transcribe", files={"audio": ("say.m4a", data, "audio/m4a")})


def test_not_configured_is_501(client, monkeypatch):
    monkeypatch.delenv("WHISPER_PYTHON", raising=False)
    r = post(client)
    assert r.status_code == 501 and r.json()["detail"] == "这台电脑没装语音转写，先打字或用键盘上的话筒"


def test_too_big_is_413(client, monkeypatch):
    monkeypatch.setenv("WHISPER_PYTHON", "whisper-python")
    monkeypatch.setattr(api.subprocess, "run", lambda *a, **k: pytest.fail("不该跑转写"))
    assert post(client, b"x" * (api.MAX_AUDIO + 1)).status_code == 413


def test_runs_script_and_returns_text(client, monkeypatch):
    monkeypatch.setenv("WHISPER_PYTHON", "whisper-python")
    seen = {}

    def fake_run(args, **kw):
        seen["args"], seen["timeout"] = args, kw["timeout"]
        seen["audio"] = Path(args[2]).read_bytes()
        return subprocess.CompletedProcess(args, 0, stdout="今天写报告\n", stderr="")

    monkeypatch.setattr(api.subprocess, "run", fake_run)
    r = post(client)
    assert r.status_code == 200 and r.json() == {"text": "今天写报告"}
    assert seen["args"][:2] == ["whisper-python", str(api.TRANSCRIBE_SCRIPT)] and seen["timeout"] == 120
    assert seen["audio"] == b"fake m4a"
    assert not Path(seen["args"][2]).exists()  # 临时文件用完删掉


def test_script_failure_and_timeout(client, monkeypatch):
    monkeypatch.setenv("WHISPER_PYTHON", "whisper-python")
    monkeypatch.setattr(api.subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 1, "", "boom"))
    assert post(client).status_code == 502

    def slow(args, **kw):
        raise subprocess.TimeoutExpired(args, kw["timeout"])

    monkeypatch.setattr(api.subprocess, "run", slow)
    assert post(client).status_code == 504


def test_oversized_body_rejected_before_reading_it(client, monkeypatch):
    # 只看 Content-Length 就拦：不去解析（落盘）请求体
    monkeypatch.setenv("WHISPER_PYTHON", "whisper-python")
    monkeypatch.setattr(api.Request, "form", lambda *a, **k: pytest.fail("不该读请求体"))
    r = post(client, b"x" * (api.MAX_AUDIO + api.MULTIPART_SLACK))
    assert r.status_code == 413


def test_other_sites_cannot_post(client, monkeypatch):
    # multipart 不走 CORS 预检：别的网页带着自己的 Origin 发来，拒掉；白名单里的和不带 Origin 的（手机 App）照常
    monkeypatch.setenv("WHISPER_PYTHON", "whisper-python")
    monkeypatch.setattr(api.subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 0, "好", ""))
    files = {"audio": ("say.m4a", b"fake", "audio/m4a")}
    assert client.post("/transcribe", files=files, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/transcribe", files=files, headers={"Origin": api.WEB_ORIGINS[0]}).status_code == 200
    assert post(client).status_code == 200
