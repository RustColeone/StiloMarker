// Written by tools/protocol-sync.mjs from protocol/agent.json. Do not edit:
// change protocol/agent.json and run the tool.
export default Object.freeze([
  {
    "type": "function",
    "function": {
      "name": "list_files",
      "description": "List all files and folders in the workspace with their paths and types.",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "Read the full content of a file at the given path.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Path to the file, e.g. 'folder/notes.md'"
          }
        },
        "required": [
          "path"
        ]
      }
    }
  }
]);
