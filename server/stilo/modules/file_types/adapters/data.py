"""Reads the shared list of file types (protocol/file-types.json)."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[5] / "protocol" / "file-types.json"


def load_types():
    return json.loads(DATA.read_text(encoding="utf-8"))["types"]
