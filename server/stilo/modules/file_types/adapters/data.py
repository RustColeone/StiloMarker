"""Reads the shared list of file types: protocol/file-types.json, then the
types each extension adds (extensions/<name>/extension.json, 'fileTypes'),
each marked with the extension it came from."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
DATA = ROOT / "protocol" / "file-types.json"
EXTENSIONS = ROOT / "extensions"


def load_types():
    types = json.loads(DATA.read_text(encoding="utf-8"))["types"]
    for manifest in sorted(EXTENSIONS.glob("*/extension.json")):
        extension = json.loads(manifest.read_text(encoding="utf-8"))
        types += [{**entry, "extension": extension["name"]} for entry in extension.get("fileTypes", [])]
    return types
