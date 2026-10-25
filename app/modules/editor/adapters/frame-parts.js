// The Editor's parts in Shell's frame: its two panes (toggled from the View
// menu; on the phone, panes with a caption naming their file), what a resize
// or a layout change means for it, and its page-wide controls (Find, the tab
// strips' overflow menus, Copy on code blocks, the end of a drag).
// Part of the Editor: `app` is its shared context (surface.js).
export function installFrameParts(app, shell) {
  const frame = shell.frame;
  shell.commands.add({ id: "editor.toggle-source", title: "Toggle Source", menu: { id: "view", group: 0, order: 2 }, run: () => frame.toggle("source") });
  shell.commands.add({ id: "editor.toggle-preview", title: "Toggle Preview", menu: { id: "view", group: 0, order: 3 }, run: () => frame.toggle("preview") });
  shell.commands.add({ id: "editor.find-replace", title: "Find & Replace", menu: { id: "edit", group: 0, order: 1 }, run: () => app.openFindBar(true) });

  // On the phone: one pane at a time, the top bar naming its file. Source and
  // Preview are one file's two views: switching (or swiping) between them keeps
  // the file, and both list the open files (the tabs of both groups).
  const project = () => app.controller.getProject();
  const isFile = (id) => project()?.nodes?.[id]?.kind === "file";
  const openFiles = () => {
    const files = app.view.get().groups.flatMap((group) => group.tabs.map((tab) => tab.fileId));
    return [...new Set(files)].filter(isFile)
      .map((id) => ({ id, name: project().nodes[id].name }));
  };
  frame.phonePanes.add({
    id: "source", order: 10, element: () => app.elements.sourceBody, alternate: "preview", // the active editor's
    caption: () => app.controller.getActiveFile()?.name ?? "",
    fileId: () => app.controller.getActiveFile()?.id ?? null,
    canShow: (fileId) => app.canOpenFileInPane(fileId, "source"),
    files: openFiles,
    open: (fileId) => app.setActiveSourceFile(fileId),
    shown({ fileId } = {}) {
      if (fileId && fileId !== app.controller.getActiveFile()?.id && app.canOpenFileInPane(fileId, "source")) app.setActiveSourceFile(fileId);
    }
  });
  frame.phonePanes.add({
    id: "preview", order: 20, element: () => app.elements.previewBody, alternate: "source",
    caption() {
      const paneView = app.shownPaneView(); // a preview tab that is not a file (History's diff)
      return (paneView ? (paneView.tab()?.caption ?? paneView.tab()?.label) : project()?.nodes?.[app.view.get().previewFileId]?.name) ?? "";
    },
    fileId: () => (app.shownPaneView() ? null : app.view.get().previewFileId),
    canShow: (fileId) => app.canOpenFileInPane(fileId, "preview"),
    files: openFiles,
    open: (fileId) => app.setPreviewFile(fileId),
    shown({ fileId } = {}) {
      if (fileId && fileId !== app.view.get().previewFileId && app.canOpenFileInPane(fileId, "preview")) app.setPreviewFile(fileId);
    }
  });
  shell.events.on("render", () => frame.redrawCaption());

  // A splitter moved: the lines are measured and drawn again; any resize: the
  // gutter's scroll follows (in every editor).
  shell.events.on("resized", ({ by }) => app.eachEditor((editor) => {
    // (Not a hidden one: it would measure nothing; it is drawn when it shows.)
    if (by === "splitter" && editor.shown.fileId && editor.elements.editorContent.clientWidth > 0) editor.renderEditorContent(editor.getEditorText());
    editor.syncEditorScroll();
  }));
  shell.events.on("layout", () => app.eachEditor((editor) => editor.refreshFormatToolbar()));
  app.elements.app.dataset.wordWrap = app.settings.wordWrap ? "on" : "off";
  app.eachEditor((editor) => { editor.elements.editorContent.spellcheck = Boolean(app.settings.spellcheck); });
  app.elements.app.style.setProperty("--indent-tab-size", "4");

  // The groups' tab strips' overflow menus.
  for (const group of ["left", "right"]) {
    app.tabOverflowButton(group)?.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = app.tabOverflowButton(group)?.classList.contains("is-open");
      app.closeTabOverflowMenu();
      if (!isOpen) app.openTabOverflowMenu(group);
    });
  }
  document.addEventListener("click", (event) => {
    if (app.elements.tabOverflowMenu?.hidden || event.target.closest?.("#tab-overflow-menu, .tab-overflow-btn")) return;
    app.closeTabOverflowMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !app.elements.tabOverflowMenu?.hidden) app.closeTabOverflowMenu();
  });
  // A drag that ended anywhere leaves no drop marks behind.
  const clearDrops = () => { app.clearPaneDropState(); app.clearEditorDropCaret(); };
  document.addEventListener("dragend", clearDrops);
  document.addEventListener("drop", clearDrops);
  // Copy on a code block in the preview.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-code]");
    const text = button?.closest(".md-code-block")?.querySelector("pre > code")?.textContent ?? "";
    if (!text) return;
    event.preventDefault();
    try {
      await shell.copyText(text);
      const original = button.textContent || "Copy";
      button.textContent = "Copied";
      button.classList.add("is-copied");
      setTimeout(() => { button.textContent = original; button.classList.remove("is-copied"); }, 1200);
    } catch (error) {
      shell.notify(`Could not copy code block: ${error.message}`);
    }
  });
}
