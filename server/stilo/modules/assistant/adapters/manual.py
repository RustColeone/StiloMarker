"""The workspace manual the agent is given (server/MANUAL.md), or nothing."""
from pathlib import Path

MANUAL = Path(__file__).resolve().parents[4] / "MANUAL.md"


def read_manual() -> str:
    try:
        return MANUAL.read_text(encoding="utf-8")
    except OSError:
        return ""
