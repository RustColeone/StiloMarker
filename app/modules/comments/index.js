// Comments (browser): line comments in a cloud workspace, keeping each on its
// line as the text changes, and their server calls. The server's half is
// server/stilo/modules/comments; their messages are protocol/comments.contract.json.
// On the page (it starts itself): the comments are notes on lines in the
// Editor's gutter and overview ruler (editor.lineNotes); clicking a line
// number opens the popover to add, edit or remove one (adapters/popover.js);
// they follow the text as the project changes, and others' changes arrive on
// Sync's stream.
//
// API: load({ force }) the open cloud workspace's comments (Cloud asks when one opens).
// Static: listComments, saveComment, deleteComment, reanchorComments  (server address, token, team, path, …)
//   reanchor(comments, text) -> moves      withComment(comments, comment) -> list
import { defineModule } from "../../kernel/index.js";

export * from "./adapters/api.js";
export { reanchor, withComment } from "./model/anchors.js";
import { createLineComments } from "./adapters/popover.js";

export default defineModule({
  name: "comments",
  level: 4,
  uses: ["shell", "workspace", "editor", "sync"],
  owns: { events: ["comments"], rules: ["anchoring a comment to its line"], elements: ["the comment popover"], data: ["the open workspace's comments"] },
  start(ctx) {
    const shell = ctx.use("shell"), workspace = ctx.use("workspace"), editor = ctx.use("editor"), sync = ctx.use("sync");
    const $ = (id) => document.getElementById(id);
    const parts = () => editor.parts();
    const app = {
      lineComments: { byFile: new Map(), loadedFor: null }, // path -> comments, and for which workspace
      cloudWorkspaceTarget: () => sync.cloudWorkspace(),
      elements: { lineCommentPopover: $("line-comment-popover"), lineCommentInput: $("line-comment-input"), lineCommentMeta: $("line-comment-meta"),
        lineCommentDelete: $("line-comment-delete"), editorGutter: $("editor-gutter"), editorContent: $("editor-content") },
      getEditorText: () => parts().getEditorText(),
      getEditorSelection: () => parts().getEditorSelection(),
      setEditorSelection: (...args) => parts().setEditorSelection(...args),
      renderEditorContent: (...args) => parts().renderEditorContent(...args),
      logDebug: (kind, message, detail) => ctx.log(detail ? `${message}: ${detail}` : message),
      notify: (message) => shell.notify(message),
      showToast: (message, options) => shell.toast(message, options)
    };
    Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
    Object.defineProperty(app, "collaboration", { get: () => sync.session(), enumerable: true });
    Object.defineProperty(app, "workspaceMode", { get: () => sync.mode.get().workspaceMode, enumerable: true });
    const comments = createLineComments(app);

    // In the gutter and on the overview ruler; a line number's click adds or edits one.
    editor.lineNotes.add({
      id: "comments", kind: "comment",
      notes: (file) => (file?.id === workspace.project()?.getActiveFile()?.id ? comments.commentsForActiveFile() : [])
        .map((comment) => ({ line: comment.line, title: `${comment.author ?? ""}: ${comment.text}`.trim() })),
      click: (line) => comments.openCommentPopover(line)
    });
    // Comments follow the text, whoever changed it (this tab's typing or a collaborator's).
    let watched = null;
    const watch = () => {
      const store = workspace.project();
      if (store && store !== watched) { watched = store; store.subscribe(() => comments.scheduleCommentReanchor()); }
    };
    watch();
    // A collaborator added, edited or moved a comment: take the server's list.
    sync.events.on("event", ({ event }) => {
      if (event.type !== "comments" || !comments.commentsAvailable()) return;
      app.lineComments.byFile = new Map(Object.entries(event.files ?? {}));
      comments.renderEditorFromModel();
    });

    // The popover's controls.
    $("line-comment-save")?.addEventListener("click", () => void comments.submitLineComment());
    $("line-comment-cancel")?.addEventListener("click", comments.closeCommentPopover);
    $("line-comment-delete")?.addEventListener("click", () => {
      const id = app.elements.lineCommentPopover?.dataset.commentId;
      if (id) void comments.removeLineComment(id);
    });
    app.elements.lineCommentInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); comments.closeCommentPopover(); return; }
      // Ctrl/Cmd+Enter saves; plain Enter stays a newline inside the note.
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void comments.submitLineComment();
      }
    });
    document.addEventListener("click", (event) => {
      if (app.elements.lineCommentPopover?.hidden) return;
      if (event.target.closest?.("#line-comment-popover, .editor-gutter-line")) return;
      comments.closeCommentPopover();
    });

    return { load: (options) => { watch(); return comments.loadLineComments(options); } };
  }
});
