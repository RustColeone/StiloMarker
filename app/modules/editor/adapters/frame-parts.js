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

  // On the phone: one pane at a time, named in the top bar with its file.
  const project = () => app.controller.getProject();
  frame.phonePanes.add({
    id: "source", order: 10, element: () => app.elements.sourcePane,
    caption() { const name = app.controller.getActiveFile()?.name; return name ? `SOURCE — ${name}` : "SOURCE"; },
    fileId: () => app.controller.getActiveFile()?.id ?? null
  });
  frame.phonePanes.add({
    id: "preview", order: 20, element: () => app.elements.previewPane,
    caption() {
      const paneView = app.shownPaneView(); // a preview tab that is not a file (History's diff)
      const name = paneView ? (paneView.tab()?.caption ?? paneView.tab()?.label ?? null) : project()?.nodes?.[app.view.get().previewFileId]?.name;
      return name ? `PREVIEW — ${name}` : "PREVIEW";
    },
    fileId: () => (app.shownPaneView() ? null : app.view.get().previewFileId),
    // One pane at a time: the preview mirrors the file being edited.
    shown() {
      const active = app.controller.getActiveFile();
      if (active && app.isPreviewableFileName(active.name) && app.view.get().previewFileId !== active.id) app.setPreviewFile(active.id);
    }
  });
  shell.events.on("render", () => frame.redrawCaption());

  // A splitter moved: the lines are measured and drawn again; any resize: the gutter's scroll follows.
  shell.events.on("resized", ({ by }) => {
    if (by === "splitter") app.renderEditorContent(app.getEditorText());
    app.syncEditorScroll();
  });
  shell.events.on("layout", () => app.refreshFormatToolbar());
  app.elements.app.dataset.wordWrap = app.settings.wordWrap ? "on" : "off";
  app.elements.app.style.setProperty("--indent-tab-size", "4");

  // The tab strips' overflow menus.
  for (const pane of ["source", "preview"]) {
    app.tabOverflowButton(pane)?.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = app.tabOverflowButton(pane)?.classList.contains("is-open");
      app.closeTabOverflowMenu();
      if (!isOpen) app.openTabOverflowMenu(pane);
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
