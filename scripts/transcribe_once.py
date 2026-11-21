"""转一段录音：python transcribe_once.py <音频文件>，只往 stdout 打文字（UTF-8）。

要在装了 faster-whisper 的环境里跑（后端的 WHISPER_PYTHON 指向它）；WHISPER_MODEL 换模型目录，默认本机 small。
"""
import os
import sys

from faster_whisper import WhisperModel

DEFAULT_MODEL = ("U:/Obsidian/AI知识库/AI工作空间/模型/faster-whisper/models--Systran--faster-whisper-small/"
                 "snapshots/536b0662742c02347bc0e980a01041f333bce120")


def main(path: str) -> None:
    model = WhisperModel(os.environ.get("WHISPER_MODEL") or DEFAULT_MODEL, device="cpu", compute_type="int8")
    # vad_filter：静音段不送进模型，不然 whisper 会在没声音的地方编出字来；initial_prompt 让它出简体
    segments, _ = model.transcribe(path, language="zh", vad_filter=True, initial_prompt="以下是普通话的句子。")
    text = "".join(s.text for s in segments).strip()
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main(sys.argv[1])
