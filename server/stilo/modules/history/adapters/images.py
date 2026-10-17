"""An image's bytes for a backup: from its data URL in memory, or from the
workspace folder where images are kept as files."""
from stilo.modules.workspace import decode_data_url


def image_bytes(workspace, path: str, node: dict) -> bytes:
    content = node.get("content") or ""
    data = decode_data_url(content) if content else None
    if data is not None:
        return data
    on_disk = workspace.live.store.resolve_asset(path) if hasattr(workspace.live.store, "resolve_asset") else None
    return on_disk.read_bytes() if on_disk is not None else b""
