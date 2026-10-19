"""The agent's tools: reading the project (list_files, read_file), proposing
changes to it (never applied here: they come back as proposals the user keeps
or drops), and making a picture (generate_image) when the server has an image
model. A mixin of the Agent (service/agent.py), which holds the request's
state (`_req`)."""
import copy
import json
import uuid

from stilo.kernel.log import ignore as _ignore
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.models import IMAGE_SIZES
from stilo.modules.workspace import UPDATE_FILE, node_id_by_path
from ..model.edits import propose_edit
from ..model.tools import AGENT_TOOLS


class AgentTools:
    READ_TOOLS = ("list_files", "read_file")

    @staticmethod
    def _get_tool_schemas() -> list:
        """The agent's tools (Assistant module)."""
        return copy.deepcopy(AGENT_TOOLS)

    @staticmethod
    def _walk_project_tree(project: dict) -> list:
        """Return [(path, kind), ...] for every non-root node in depth-first order."""
        nodes = project.get("nodes", {})
        root_id = project.get("rootId", "root")
        results = []

        def _walk(node_id: str, prefix: str):
            node = nodes.get(node_id)
            if not node:
                return
            is_root = node.get("parentId") is None
            if is_root:
                node_path = ""
            else:
                node_path = f"{prefix}/{node['name']}" if prefix else node["name"]
                results.append((node_path, node.get("kind", "file")))
            for child_id in node.get("children", []):
                _walk(child_id, node_path)

        _walk(root_id, "")
        return results

    def _build_project_tree(self, project: dict) -> str:
        """Return a compact text tree listing paths and kinds."""
        entries = self._walk_project_tree(project)
        if not entries:
            return ""
        return "\n".join(
            f"folder: {path}" if kind == "folder" else f"file: {path}"
            for path, kind in entries
        )

    @staticmethod
    def _get_node_id_by_path_in(project: dict, path: str):
        return node_id_by_path(project, path)

    def _extract_tool_calls(self, response_payload: dict) -> list:
        """Extract the tool_calls list from a chat completion response, or [] if none."""
        choices = response_payload.get("choices") or []
        if not choices:
            return []
        message = choices[0].get("message") or {}
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or not tool_calls:
            return []
        return tool_calls

    def _describe_tool_call(self, tc: dict) -> dict:
        """Build a small, UI-friendly summary of a tool call for progress streaming."""
        fn = tc.get("function") or {}
        name = str(fn.get("name", "") or "")
        mcp = getattr(self._req, "mcp_turn", None)
        if mcp and name in mcp.routes:
            return mcp.describe(name)
        try:
            args = json.loads(fn.get("arguments", "{}") or "{}")
        except (json.JSONDecodeError, TypeError):
            args = {}
        if not isinstance(args, dict):
            args = {}
        target = str(args.get("path", "") or args.get("name", "") or args.get("parentPath", "")).strip()
        return {"name": name, "target": target}

    @staticmethod
    def _image_tool_schema() -> dict:
        extensions = FILE_TYPES.generated_extensions()
        writable, usual = ", ".join(extensions[:-1]) + " or " + extensions[-1], extensions[0]
        return {
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": (
                    "Generate a picture with an image model and propose saving it to the workspace as a "
                    "new image file. Use it only when the user asks for an image, illustration, concept "
                    "art, portrait, map or similar. Each image costs money; make at most the number the "
                    "user asked for."),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": (
                            "A detailed visual description: subject, setting, composition, lighting, mood "
                            "and art style. Draw details from the workspace files when relevant.")},
                        "name": {"type": "string", "description": f"File name ending in {writable}, e.g. 'mara-portrait{usual}'."},
                        "parentPath": {"type": "string", "description": "Folder to save into; empty string for root."},
                        "orientation": {"type": "string", "enum": ["square", "portrait", "landscape"],
                                        "description": "Shape of the image (default square)."},
                    },
                    "required": ["prompt", "name"],
                },
            },
        }

    def _generate_image(self, args: dict, proposed_operations: list, proposal_id: str) -> dict:
        if not self.images_available():
            return {"error": "Image generation is not available."}
        made = getattr(self._req, "images_made", 0)
        if made >= self.openai.max_images_per_turn:
            return {"error": f"Image limit reached ({self.openai.max_images_per_turn} per request). Ask the user before making more."}
        prompt = str(args.get("prompt", "")).strip()[:4000]
        name = str(args.get("name", "")).strip().replace("\\", "/").split("/")[-1]
        if not prompt:
            return {"error": "A prompt is required."}
        # A file an image model can write (File types say which), else the usual one.
        writable = FILE_TYPES.generated_extensions()
        stem, dot, extension = name.rpartition(".")
        extension = f".{extension.lower()}" if dot else ""
        if extension not in writable or not stem:
            stem = stem or name or "image"
            name, extension = f"{stem}{writable[0]}", writable[0]
        mime = FILE_TYPES.mime_of(name)
        output_format = mime.split("/", 1)[1]   # what the provider calls it: png, jpeg...
        size = IMAGE_SIZES.get(str(args.get("orientation", "square")), IMAGE_SIZES["square"])
        self._req.images_made = made + 1  # counts attempts: a failure also costs a slot
        try:
            data = self.openai.generate_image(prompt, size, output_format)
        except RuntimeError as error:
            return {"error": str(error)}
        identity = self._req.identity
        image_id = self.generated.store(data, mime, extension, identity["username"], prompt)
        parent_path = str(args.get("parentPath", "")).strip().strip("/")
        proposed_operations.append({
            "proposalId": proposal_id,
            "type": "create-file",
            "parentPath": parent_path,
            "name": name,
            "content": "",
            "generatedImage": {"id": image_id, "mime": mime, "size": size,
                               "model": self.openai.image_model, "prompt": prompt[:300]},
        })
        path = f"{parent_path}/{name}" if parent_path else name
        return {"status": "proposed", "proposalId": proposal_id, "path": path,
                "note": "The image is saved when the user keeps the edit. To show it in a note, link it "
                        "with a relative Markdown image link."}

    def _execute_tool_call(self, tc: dict, project_snapshot: dict, proposed_operations: list,
                           read_only: bool = False) -> dict:
        """
        Execute one tool call against the project snapshot.
        Read tools return their result immediately.
        Write tools are collected into proposed_operations and return a synthetic ack.
        With read_only (Roleplay characters) write tools are refused outright,
        even if the model calls one it was never offered.
        """
        fn = tc.get("function") or {}
        name = fn.get("name", "")
        try:
            args = json.loads(fn.get("arguments", "{}") or "{}")
        except json.JSONDecodeError:
            args = {}

        mcp = getattr(self._req, "mcp_turn", None)
        if mcp and name in mcp.routes:
            return mcp.call(name, args)
        if not isinstance(args, dict):
            return {"error": "Tool arguments must be an object."}
        if read_only and name not in self.READ_TOOLS:
            return {"error": "Characters can read workspace files but cannot change them."}
        proposal_id = f"op-{uuid.uuid4().hex[:8]}"

        # --- Read tools ---
        if name == "list_files":
            entries = self._walk_project_tree(project_snapshot)
            return {"files": [{"path": p, "kind": k} for p, k in entries]}

        if name == "read_file":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            if not node_id:
                return {"error": f"File not found: {path}"}
            node = project_snapshot["nodes"].get(node_id, {})
            if node.get("kind") != "file":
                return {"error": f"Not a file: {path}"}
            return {"content": node.get("content", "")}

        # --- Write tools — collected as proposals, never applied here ---
        if name == "generate_image":
            return self._generate_image(args, proposed_operations, proposal_id)

        if name == "create_file":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "create-file",
                "parentPath": str(args.get("parentPath", "")),
                "name": str(args.get("name", "")),
                "content": str(args.get("content", "")),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "edit_file":
            return propose_edit(project_snapshot, proposed_operations, args.get("path"), args.get("edits"), proposal_id)

        if name == "update_file":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            pre_image = ""
            if node_id:
                pre_image = project_snapshot["nodes"].get(node_id, {}).get("content", "")
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": UPDATE_FILE,
                "path": path,
                "content": str(args.get("content", "")),
                "preImage": pre_image,
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "rename_node":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            pre_image = ""
            if node_id:
                pre_image = project_snapshot["nodes"].get(node_id, {}).get("name", "")
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "rename-node",
                "path": path,
                "name": str(args.get("name", "")),
                "preImage": pre_image,
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "delete_node":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "delete-node",
                "path": str(args.get("path", "")).strip(),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "create_folder":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "create-folder",
                "parentPath": str(args.get("parentPath", "")),
                "name": str(args.get("name", "")),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "move_node":
            op: dict = {
                "proposalId": proposal_id,
                "type": "move-node",
                "path": str(args.get("path", "")).strip(),
                "parentPath": str(args.get("parentPath", "")),
            }
            if "index" in args:
                try:
                    op["index"] = int(args["index"])
                except (TypeError, ValueError) as error:
                    _ignore(error, "the agent's move-node index is not a number; the node goes last")
            proposed_operations.append(op)
            return {"status": "proposed", "proposalId": proposal_id}

        return {"error": f"Unknown tool: {name}"}

