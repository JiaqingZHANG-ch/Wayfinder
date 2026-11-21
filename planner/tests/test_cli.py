import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def test_cli_end_to_end(tmp_path):
    out = tmp_path / "out.json"
    r = subprocess.run([sys.executable, "-m", "planner", "examples/2026-11-16.json", "-o", str(out)],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text(encoding="utf-8"))
    assert any(row[0] == "17:51" and row[1] == "18:16" for row in data["rows"])
