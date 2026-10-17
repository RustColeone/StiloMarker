// Line comments in cloud workspaces: loading them, keeping them anchored to
// their lines as the text changes, and the gutter popover to add, edit or
// remove one. main.js creates this on first use and passes its shared values in `app`.
import { getPath, isTextFileName } from "../../workspace/index.js";
import { deleteComment, listComments, reanchorComments, saveComment } from "./api.js";
import { reanchor, withComment } from "../model/anchors.js";

export function createLineComments(app) {
  function commentsAvailable() {
    // settings alone aren't enough: during boot (before the workspace has actually
    // opened) they still name the cloud workspace while a LOCAL project is on
    // screen — commenting then would file that project's lines under the cloud
    // workspace. Require that we are genuinely in the synced session.
    return Boolean(app.cloudWorkspaceTarget()) && app.workspaceMode === "synced" && Boolean(app.collaboration.isConnected?.());
  }

  function commentsForPath(path) {
    return app.lineComments.byFile.get(path) ?? [];
  }

  function commentsForActiveFile() {
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!activeFile) return [];
    return commentsForPath(getPath(project, activeFile.id));
  }

  async function loadLineComments({ force = false } = {}) {
    const target = commentsAvailable() ? app.cloudWorkspaceTarget() : null;
    if (!target) {
      app.lineComments.byFile.clear();
      app.lineComments.loadedFor = null;
      return;
    }
    const workspaceId = `${target.team}/${target.path}`;
    if (!force && app.lineComments.loadedFor === workspaceId) return;
    try {
      const data = await listComments(target.serverUrl, target.token, target.team, target.path);
      app.lineComments.byFile = new Map(Object.entries(data?.files ?? {}));
      app.lineComments.loadedFor = workspaceId;
      renderEditorFromModel();
    } catch (error) {
      app.logDebug("response", "Could not load line comments", error.message);
    }
  }

  // Re-render the editor (and therefore the gutter markers) from the current model
  // without disturbing the caret.
  function renderEditorFromModel() {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) return;
    if (app.elements.editorContent !== document.activeElement) {
      app.renderEditorContent(app.getEditorText());
      return;
    }
    const { start, end } = app.getEditorSelection();
    app.renderEditorContent(app.getEditorText());
    app.setEditorSelection(start, end);
  }

  // Follow the text: a commented line that moved is found again by its own
  // content (Comments' reanchor).
  let reanchorTimer = null;
  function scheduleCommentReanchor() {
    if (!commentsAvailable() || reanchorTimer) return;
    reanchorTimer = setTimeout(() => {
      reanchorTimer = null;
      void reanchorActiveFileComments();
    }, 400);
  }

  async function reanchorActiveFileComments() {
    const target = commentsAvailable() ? app.cloudWorkspaceTarget() : null;
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!target || !activeFile || !isTextFileName(activeFile.name)) return;
    const path = getPath(project, activeFile.id);
    const list = commentsForPath(path);
    if (!list.length) return;

    const moves = reanchor(list, activeFile.content);
    if (!moves.length) return;
    renderEditorFromModel();
    try {
      await reanchorComments(target.serverUrl, target.token, target.team, target.path, path, moves);
    } catch (error) {
      app.logDebug("response", "Could not persist comment anchors", error.message);
    }
  }

  // ---- Comment editor popover --------------------------------------------------
  let commentPopoverLine = null;

  function closeCommentPopover() {
    commentPopoverLine = null;
    if (app.elements.lineCommentPopover) app.elements.lineCommentPopover.hidden = true;
  }

  function openCommentPopover(lineIndex) {
    const popover = app.elements.lineCommentPopover;
    if (!popover) return;
    if (!commentsAvailable()) {
      app.showToast("Line comments need a cloud workspace");
      return;
    }
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) return;
    const path = getPath(project, activeFile.id);
    const existing = commentsForPath(path).find((c) => c.line === lineIndex) ?? null;

    commentPopoverLine = lineIndex;
    app.elements.lineCommentInput.value = existing?.text ?? "";
    app.elements.lineCommentMeta.textContent = existing
      ? `Line ${lineIndex + 1} · ${existing.author ?? "unknown"}`
      : `Line ${lineIndex + 1}`;
    app.elements.lineCommentDelete.hidden = !existing;
    popover.dataset.commentId = existing?.id ?? "";
    popover.hidden = false;

    // Sit beside the line being commented, clamped to the viewport.
    const row = app.elements.editorGutter?.querySelectorAll(".editor-gutter-line")[lineIndex];
    const rect = (row ?? app.elements.editorGutter).getBoundingClientRect();
    popover.style.top = `${Math.min(rect.top, window.innerHeight - popover.offsetHeight - 12)}px`;
    popover.style.left = `${rect.right + 8}px`;
    app.elements.lineCommentInput.focus();
  }

  async function submitLineComment() {
    const target = commentsAvailable() ? app.cloudWorkspaceTarget() : null;
    const popover = app.elements.lineCommentPopover;
    if (!target || !popover || commentPopoverLine == null) return;
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!activeFile) return;
    const path = getPath(project, activeFile.id);
    const text = app.elements.lineCommentInput.value.trim();
    const id = popover.dataset.commentId || undefined;
    if (!text) {
      if (id) await removeLineComment(id);
      else closeCommentPopover();
      return;
    }
    const lines = String(activeFile.content ?? "").split("\n");
    try {
      const result = await saveComment(target.serverUrl, target.token, target.team, target.path, {
        file: path, id, line: commentPopoverLine, anchorText: lines[commentPopoverLine] ?? "", text
      });
      app.lineComments.byFile.set(path, withComment(commentsForPath(path), result.comment));
      closeCommentPopover();
      renderEditorFromModel();
      app.showToast(id ? "Comment updated" : "Comment added");
    } catch (error) {
      app.notify(error.message);
    }
  }

  async function removeLineComment(id) {
    const target = commentsAvailable() ? app.cloudWorkspaceTarget() : null;
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!target || !activeFile) return;
    const path = getPath(project, activeFile.id);
    try {
      await deleteComment(target.serverUrl, target.token, target.team, target.path, id);
      app.lineComments.byFile.set(path, commentsForPath(path).filter((c) => c.id !== id));
      closeCommentPopover();
      renderEditorFromModel();
      app.showToast("Comment removed");
    } catch (error) {
      app.notify(error.message);
    }
  }

  return {
    closeCommentPopover, commentsAvailable, commentsForActiveFile, loadLineComments,
    openCommentPopover, removeLineComment, renderEditorFromModel, scheduleCommentReanchor,
    submitLineComment
  };
}
