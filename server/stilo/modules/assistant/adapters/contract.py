"""The workspace agent as both of its runners see it (protocol/agent.json,
shared with the agent the browser runs with the user's own key): its tools
as the model sees them, which of them only read, its limits and its
instructions."""
import copy
import json
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[5] / "protocol" / "agent.json").read_text(encoding="utf-8"))
AGENT_TOOLS = CONTRACT["tools"]
READ_TOOLS = tuple(CONTRACT["readTools"])
LIMITS = CONTRACT["limits"]
INSTRUCTIONS = CONTRACT["instructions"]
EDIT_FILE_TOOL = next(tool for tool in AGENT_TOOLS if tool["function"]["name"] == "edit_file")


def tool_schemas() -> list:
    """Every tool, as a copy the caller may add to."""
    return copy.deepcopy(AGENT_TOOLS)
