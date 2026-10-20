// Written by tools/protocol-sync.mjs from extensions/*/extension.json. Do not edit:
// change extensions/*/extension.json and run the tool.
export default Object.freeze([
  {
    "key": "bmapGenerateScope",
    "default": "connected",
    "field": {
      "page": "appearance",
      "id": "bmap-generate-scope-select",
      "order": 110,
      "label": "Bmap Generate Context",
      "control": "select",
      "options": [
        [
          "connected",
          "Connected nodes only"
        ],
        [
          "all",
          "All linked files"
        ]
      ]
    },
    "extension": "bmap-diagram"
  },
  {
    "key": "bmapAutoPan",
    "default": true,
    "field": {
      "page": "appearance",
      "id": "bmap-auto-pan-input",
      "order": 120,
      "label": "Auto-pan diagrams to content on open",
      "control": "checkbox"
    },
    "extension": "bmap-diagram"
  }
]);
