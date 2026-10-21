"""Assistant (server): the workspace agent. One turn of it (the model, the
workspace's files, its tools, the proposals the user keeps or drops), a
character's reply for Chats, Quick Generate's one-shot note, the agent's
conversations a workspace shares (chat.json), and their routes. The
providers, connected tools (MCP) and generated images are Models'. The
browser's half is app/modules/assistant (and Models' agent connection).

Static, for code from before the restructure: AGENT_TOOLS (every tool the
agent may call), EDIT_FILE_TOOL, propose_edit(project, proposals, path,
edits, proposal_id), apply_edits, Agent, AgentThreads.

API (started by the kernel; config: data_dir, agent (an Agent to use, for
tests)): agent (service/agent.py: chat, build_persona_payload, generate,
public_status, start_providers...), threads (service/threads.py), tools,
propose_edit.
"""
from pathlib import Path
from types import SimpleNamespace

from stilo.kernel import define_module
from stilo.modules.models import GeneratedImages
from stilo.modules.sync import VERSION
from .adapters.routes import add_routes
from .adapters.contract import AGENT_TOOLS, EDIT_FILE_TOOL  # noqa: F401
from .model.edits import EditError, apply_edits, propose_edit  # noqa: F401
from .service.agent import Agent
from .service.threads import THREADS_FILE, AgentThreads


def start(ctx):
    for used in ("file_types", "workspace", "characters", "models"):
        ctx.use(used)
    sync, identity = ctx.use("sync"), ctx.use("identity")
    agent = ctx.config.get("agent") or Agent()
    # With no project from the browser, the agent works on the PIN session's.
    agent.default_workspace = sync.directory.default
    data_dir = ctx.config.get("data_dir")
    if data_dir is not None and agent.generated is None:
        agent.generated = GeneratedImages(Path(data_dir) / "_generated")
    threads = AgentThreads()
    ctx.use("projects").reserve(THREADS_FILE)  # never listed as an entry
    add_routes(ctx.use("transport"), agent=agent, threads=threads, identity=identity, directory=sync.directory, version=VERSION)
    return SimpleNamespace(agent=agent, threads=threads, tools=AGENT_TOOLS, propose_edit=propose_edit)


MODULE = define_module(__file__, start)
