"""Reads the shared list of file types: protocol/file-types.json, then the
types each extension adds (extensions/<name>/extension.json, 'fileTypes'),
each marked with the extension it came from; and the names kept at a
workspace's top (the same file's 'reserved'). An extension written for
another version of the extension API (protocol/extension-api.json) is left
out, and said, as the browser's copies refuse it."""
import json
from pathlib import Path

from stilo.kernel.log import log

ROOT = Path(__file__).resolve().parents[5]
DATA = ROOT / "protocol" / "file-types.json"
EXTENSIONS = ROOT / "extensions"
API = ROOT / "protocol" / "extension-api.json"


def load_reserved():
    """The names kept for the app's own files at a workspace's top."""
    return json.loads(DATA.read_text(encoding="utf-8"))["reserved"]["names"]


def load_types(extensions=EXTENSIONS):
    types = json.loads(DATA.read_text(encoding="utf-8"))["types"]
    offered = json.loads(API.read_text(encoding="utf-8"))["version"]
    for manifest in sorted(Path(extensions).glob("*/extension.json")):
        extension = json.loads(manifest.read_text(encoding="utf-8"))
        if extension.get("api") != offered:
            log("EXTENSIONS", f"WARNING: {manifest.parent.name} is written for extension API {extension.get('api')}; "
                              f"this server offers {offered}: its file types are left out")
            continue
        types += [{**entry, "extension": extension["name"]} for entry in extension.get("fileTypes", [])]
    return types
