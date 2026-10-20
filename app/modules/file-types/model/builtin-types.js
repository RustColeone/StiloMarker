// Written by tools/protocol-sync.mjs from protocol/file-types.json. Do not edit:
// change protocol/file-types.json and run the tool.
export default Object.freeze([
  {
    "id": "md",
    "label": "Markdown",
    "kind": "text",
    "format": "markdown",
    "extensions": {
      ".md": "text/markdown;charset=utf-8"
    },
    "icon": "is-md",
    "filters": [
      "notes"
    ],
    "create": {
      "label": "New Markdown",
      "name": "new markdown",
      "order": 1
    }
  },
  {
    "id": "mtree",
    "label": "MTREE",
    "kind": "text",
    "format": "mtree",
    "extensions": {
      ".mtree": "text/plain;charset=utf-8"
    },
    "icon": "is-mtree",
    "filters": [
      "mtree"
    ],
    "create": {
      "label": "New MTREE",
      "name": "new mtree",
      "order": 2
    }
  },
  {
    "id": "bmap",
    "label": "Diagram",
    "kind": "text",
    "format": "bmap",
    "extensions": {
      ".bmap": "text/plain;charset=utf-8"
    },
    "icon": "is-bmap",
    "filters": [],
    "create": {
      "label": "New Diagram",
      "name": "new diagram",
      "order": 4
    }
  },
  {
    "id": "persona",
    "label": "Character",
    "kind": "text",
    "format": "markdown",
    "extensions": {
      ".persona.skill": "text/markdown;charset=utf-8"
    },
    "icon": "is-persona",
    "filters": [
      "notes"
    ],
    "create": {
      "label": "New Character",
      "name": "new character",
      "order": 5
    }
  },
  {
    "id": "skill",
    "label": "Skill",
    "kind": "text",
    "format": "markdown",
    "extensions": {
      ".skill": "text/markdown;charset=utf-8"
    },
    "icon": "is-file",
    "filters": [
      "notes"
    ]
  },
  {
    "id": "image",
    "label": "Image",
    "kind": "image",
    "format": "image",
    "extensions": {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".bmp": "image/bmp"
    },
    "generated": [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp"
    ],
    "icon": "is-file",
    "filters": [
      "images"
    ]
  },
  {
    "id": "htmlpage",
    "label": "HTML Page",
    "kind": "text",
    "format": "html",
    "extensions": {
      ".html": "text/html;charset=utf-8",
      ".htm": "text/html;charset=utf-8"
    },
    "icon": "is-html",
    "filters": [],
    "create": {
      "label": "New HTML Page",
      "name": "new page",
      "order": 7
    },
    "extension": "html-page"
  },
  {
    "id": "mermaid",
    "label": "Mermaid",
    "kind": "text",
    "format": "mermaid",
    "extensions": {
      ".mmd": "text/plain;charset=utf-8",
      ".mermaid": "text/plain;charset=utf-8"
    },
    "icon": "is-mermaid",
    "filters": [],
    "create": {
      "label": "New Mermaid Diagram",
      "name": "new mermaid",
      "order": 6
    },
    "extension": "mermaid"
  },
  {
    "id": "urldb",
    "label": "URL Album",
    "kind": "text",
    "format": "urldb",
    "extensions": {
      ".urldb": "text/plain;charset=utf-8"
    },
    "icon": "is-urldb",
    "filters": [
      "images"
    ],
    "expandable": true,
    "create": {
      "label": "New URL Album",
      "name": "new url album",
      "order": 3
    },
    "extension": "url-album"
  }
]);
