// Comments (browser): line comments in a cloud workspace, keeping each on its
// line as the text changes, and their server calls. The server's half is
// server/stilo/modules/comments; their messages are protocol/comments.contract.json.
// The gutter popover that shows them: createLineComments(app) (adapters/popover.js).
//
// Static, for code from before the restructure:
//   listComments, saveComment, deleteComment, reanchorComments  (server address, token, team, path, …)
//   reanchor(comments, text) -> moves      withComment(comments, comment) -> list
//   createLineComments(app)   the gutter popover (it takes the app's shared values)
import { defineModule } from "../../kernel/index.js";

export * from "./adapters/api.js";
export { reanchor, withComment } from "./model/anchors.js";
export { createLineComments } from "./adapters/popover.js";

export default defineModule({
  name: "comments",
  level: 4,
  uses: ["shell", "workspace"],
  owns: { events: ["comments"], rules: ["anchoring a comment to its line"] },
  start() {
    return {};
  }
});
