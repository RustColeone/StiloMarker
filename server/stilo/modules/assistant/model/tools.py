"""The agent's tools: what it may call, as the model sees them
(OpenAI function-calling definitions). The executor that runs them is still
in ChatProxy (mdnotes_server.py) and moves here later."""
from .edits import EDIT_FILE_TOOL

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List all files and folders in the workspace with their paths and types.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the full content of a file at the given path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file, e.g. 'folder/notes.md'"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_file",
            "description": "Propose creating a new file with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "parentPath": {"type": "string", "description": "Parent folder path; empty string for root."},
                    "name": {"type": "string", "description": "File name including extension."},
                    "content": {"type": "string", "description": "Initial file content."},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_file",
            "description": "Propose replacing the entire content of an existing file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file."},
                    "content": {"type": "string", "description": "New full content for the file."},
                },
                "required": ["path", "content"],
            },
        },
    },
    EDIT_FILE_TOOL,
    {
        "type": "function",
        "function": {
            "name": "rename_node",
            "description": "Propose renaming a file or folder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Current path of the file or folder."},
                    "name": {"type": "string", "description": "New name."},
                },
                "required": ["path", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_node",
            "description": "Propose deleting a file or folder (recursive for folders).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path of the file or folder to delete."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_folder",
            "description": "Propose creating a new folder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "parentPath": {"type": "string", "description": "Parent folder path; empty string for root."},
                    "name": {"type": "string", "description": "Folder name."},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_node",
            "description": "Propose moving a file or folder to a different parent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Current path of the item."},
                    "parentPath": {"type": "string", "description": "Destination parent folder path; empty for root."},
                    "index": {"type": "integer", "description": "Optional insertion index within the new parent."},
                },
                "required": ["path", "parentPath"],
            },
        },
    },
]
