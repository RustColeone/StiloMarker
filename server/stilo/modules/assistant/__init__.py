"""Assistant (server): the agent's tools and how its proposals are made.
Step 6 brings edit_file here; the rest of the agent (ChatProxy in
mdnotes_server.py) moves in later (docs/ARCHITECTURE.md).

Static, for code from before the restructure: AGENT_TOOLS (every tool the agent
may call), EDIT_FILE_TOOL,
propose_edit(project, proposals, path, edits, proposal_id), apply_edits.
"""
from stilo.kernel import define_module
from .model.edits import EDIT_FILE_TOOL, EditError, apply_edits, propose_edit  # noqa: F401
from .model.tools import AGENT_TOOLS  # noqa: F401


def start(ctx):
    return {"tools": AGENT_TOOLS, "propose_edit": propose_edit}


MODULE = define_module(__file__, start)
