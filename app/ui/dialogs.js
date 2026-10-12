// Dialogs (notice, confirm, input, bookmark entry, accept connection), toasts,
// the debug log panel and editor tracing, and the forced app upgrade.
// main.js creates this on first use and passes its shared values in `app`.


export function createDialogs(app) {
  function buildDebugLogText() {
    return app.debugState.entries.map((entry) => {
      const detail = entry.detail ? ` :: ${entry.detail}` : "";
      return `[${entry.timestamp}] ${entry.kind.toUpperCase()} ${entry.message}${detail}`;
    }).join("\n");
  }

  function logDebug(kind, message, detail = "") {
    app.debugState.entries.push({
      kind,
      message,
      detail,
      timestamp: new Date().toLocaleTimeString()
    });

    if (app.debugState.entries.length > app.debugState.maxEntries) {
      app.debugState.entries.splice(0, app.debugState.entries.length - app.debugState.maxEntries);
    }

    renderDebugPanel();
  }

  function formatEditorDebugValue(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll("\t", "\\t");
  }

  function getEditorTraceDetail(extra = {}) {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const { start, end } = app.getEditorSelection();
    const lineEls = Array.from(app.elements.editorContent.children);
    const lineIndex = app.getEditorLineIndexAtOffset(start);
    const line = lineEls[lineIndex] ?? null;
    const nextLine = lineEls[lineIndex + 1] ?? null;
    const container = range?.startContainer ?? null;
    const containerName = container?.nodeType === Node.TEXT_NODE
      ? "#text"
      : container?.nodeName?.toLowerCase() ?? "null";
    const containerText = container?.nodeType === Node.TEXT_NODE
      ? container.textContent ?? ""
      : "";

    const detail = {
      file: app.controller.getActiveFile()?.name ?? "",
      active: document.activeElement === app.elements.editorContent ? "editor" : document.activeElement?.nodeName?.toLowerCase() ?? "null",
      sel: `${start}-${end}`,
      dom: `${containerName}@${range?.startOffset ?? 0}`,
      domText: formatEditorDebugValue(containerText),
      line: lineIndex,
      lineText: formatEditorDebugValue(line?.textContent ?? ""),
      lineHtml: formatEditorDebugValue(line?.innerHTML ?? ""),
      nextLineText: formatEditorDebugValue(nextLine?.textContent ?? ""),
      autocomplete: app.elements.editorAutocomplete.hidden ? "hidden" : "visible",
      history: `${app.editorHistory.index}/${app.editorHistory.stack.length}`,
      ...extra
    };

    return Object.entries(detail)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ; ");
  }

  function traceEditorEvent(message, extra = {}) {
    // The input handler calls this for every space and Enter, twice. Building the
    // detail walks the whole document, so only do it when someone can see it.
    if (!app.settings.debugPanel) return;
    logDebug("editor", message, getEditorTraceDetail(extra));
  }

  /** Flash the server status panel border green (success) or red (error). */
  function flashStatusPanel(type, panel = app.elements.serverStatusPanel) {
    if (!panel) return;
    panel.classList.remove("settings-status-panel--flash-success", "settings-status-panel--flash-error");
    void panel.offsetWidth; // force reflow so restarting mid-animation works
    panel.classList.add(type === "success"
      ? "settings-status-panel--flash-success"
      : "settings-status-panel--flash-error");
  }

  /** Shown before connecting — resolves true if the user confirms. */
  function showAcceptConnectionDialog() {
    return new Promise((resolve) => {
      if (app.elements.acceptConnectionMessage) {
        app.elements.acceptConnectionMessage.textContent =
          "If you join as a peer, the host\u2019s workspace will replace your current content. Export your work first if you want to keep it.";
      }
      const handleClose = () => {
        app.elements.acceptConnectionDialog.removeEventListener("close", handleClose);
        resolve(app.elements.acceptConnectionDialog.returnValue === "accept");
      };
      app.elements.acceptConnectionDialog.addEventListener("close", handleClose, { once: true });
      app.elements.acceptConnectionDialog.showModal();
    });
  }

  function showNoticeDialog(message, title = "Message") {
    app.elements.noticeDialogTitle.textContent = title;
    app.elements.noticeDialogMessage.textContent = String(message);
    if (!app.elements.noticeDialog.open) {
      app.elements.noticeDialog.showModal();
    }
  }

  function showConfirmDialog({ title = "Confirm Action", message, acceptLabel = "Confirm" }) {
    return new Promise((resolve) => {
      app.elements.confirmDialogTitle.textContent = title;
      app.elements.confirmDialogMessage.textContent = message;
      app.elements.confirmDialogAcceptButton.textContent = acceptLabel;

      const handleClose = () => {
        app.elements.confirmDialog.removeEventListener("close", handleClose);
        resolve(app.elements.confirmDialog.returnValue === "accept");
      };

      app.elements.confirmDialog.addEventListener("close", handleClose, { once: true });
      app.elements.confirmDialog.showModal();
    });
  }

  function showInputDialog({ title = "Rename Item", message = "Enter a value.", label = "Name", value = "", submitLabel = "Save", extension = "" }) {
    return new Promise((resolve) => {
      app.elements.inputDialogTitle.textContent = title;
      app.elements.inputDialogMessage.textContent = message;
      app.elements.inputDialogLabel.textContent = label;
      app.elements.inputDialogSubmitButton.textContent = submitLabel;

      // "Auto file extension": only offered when the caller knows the extension
      // (file renames). On by default — the input then shows just the base name so
      // the extension can't be edited by accident; it's re-appended on save.
      const ext = String(extension || "");
      const hasExt = ext.length > 0;
      const endsWithExt = (v) => v.toLowerCase().endsWith(ext.toLowerCase());
      const stripExt = (v) => (hasExt && endsWithExt(v) ? v.slice(0, -ext.length) : v);
      if (app.elements.inputDialogAutoExtRow) app.elements.inputDialogAutoExtRow.hidden = !hasExt;
      if (app.elements.inputDialogAutoExt) app.elements.inputDialogAutoExt.checked = hasExt;
      app.elements.inputDialogInput.value = hasExt ? stripExt(value) : value;

      const handleToggle = () => {
        if (!hasExt) return;
        const cur = app.elements.inputDialogInput.value;
        app.elements.inputDialogInput.value = app.elements.inputDialogAutoExt.checked
          ? stripExt(cur)
          : (endsWithExt(cur) ? cur : `${cur}${ext}`);
      };

      const handleCancel = () => {
        app.elements.inputDialog.close("cancel");
      };

      const handleClose = () => {
        app.elements.inputDialog.removeEventListener("close", handleClose);
        app.elements.inputDialogCancelButton.removeEventListener("click", handleCancel);
        app.elements.inputDialogAutoExt?.removeEventListener("change", handleToggle);
        let result = app.elements.inputDialog.returnValue === "accept"
          ? app.elements.inputDialogInput.value.trim() || null
          : null;
        // Re-attach the extension when auto is on and the user didn't type it.
        if (result && hasExt && app.elements.inputDialogAutoExt?.checked && !endsWithExt(result)) {
          result = `${result}${ext}`;
        }
        resolve(result);
      };

      app.elements.inputDialog.addEventListener("close", handleClose, { once: true });
      app.elements.inputDialogCancelButton.addEventListener("click", handleCancel);
      app.elements.inputDialogAutoExt?.addEventListener("change", handleToggle);
      app.elements.inputDialog.showModal();
      app.elements.inputDialogInput.focus();
      app.elements.inputDialogInput.select();
    });
  }

  function showBookmarkEntryDialog({ title = "New Bookmark Entry", message = "Add a named image bookmark to this URL album.", name = "", url = "", description = "", submitLabel = "Save" }) {
    return new Promise((resolve) => {
      app.elements.bookmarkEntryDialogTitle.textContent = title;
      app.elements.bookmarkEntryDialogMessage.textContent = message;
      app.elements.bookmarkEntryNameInput.value = name;
      app.elements.bookmarkEntryUrlInput.value = url;
      app.elements.bookmarkEntryDescriptionInput.value = description;
      app.elements.bookmarkEntrySubmitButton.textContent = submitLabel;

      const handleClose = () => {
        app.elements.bookmarkEntryDialog.removeEventListener("close", handleClose);
        if (app.elements.bookmarkEntryDialog.returnValue !== "accept") {
          resolve(null);
          return;
        }
        resolve({
          name: app.elements.bookmarkEntryNameInput.value.trim(),
          url: app.elements.bookmarkEntryUrlInput.value.trim(),
          description: app.elements.bookmarkEntryDescriptionInput.value.trim()
        });
      };

      app.elements.bookmarkEntryDialog.addEventListener("close", handleClose, { once: true });
      app.elements.bookmarkEntryDialog.showModal();
      app.elements.bookmarkEntryNameInput.focus();
      app.elements.bookmarkEntryNameInput.select();
    });
  }

  function getVisibleDebugEntries() {
    if (app.debugState.activeTab === "actions") {
      return app.debugState.entries.filter((entry) => entry.kind === "action");
    }

    if (app.debugState.activeTab === "responses") {
      return app.debugState.entries.filter((entry) => entry.kind !== "action");
    }

    return app.debugState.entries;
  }

  function renderDebugPanel() {
    app.debugTabs.forEach((tab) => {
      const active = tab.id === app.debugState.activeTab;
      tab.element.classList.toggle("is-active", active);
      tab.element.setAttribute("aria-selected", active ? "true" : "false");
    });

    app.elements.debugLogList.replaceChildren();

    if (!app.settings.debugPanel) {
      return;
    }

    const visibleEntries = getVisibleDebugEntries();

    if (visibleEntries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debug-log-entry is-empty";
      empty.textContent = "Log capture is enabled. Matching interactions will appear here.";
      app.elements.debugLogList.append(empty);
      return;
    }

    visibleEntries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `debug-log-entry is-${entry.kind}`;
      row.innerHTML = `<span class="debug-log-time">${app.escapeEditorHtml(entry.timestamp)}</span><span class="debug-log-kind">${app.escapeEditorHtml(entry.kind)}</span><span class="debug-log-message">${app.escapeEditorHtml(entry.message)}</span>${entry.detail ? `<span class="debug-log-detail">${app.escapeEditorHtml(entry.detail)}</span>` : ""}`;
      app.elements.debugLogList.append(row);
    });

    app.elements.debugLogList.scrollTop = app.elements.debugLogList.scrollHeight;
  }

  async function copyDebugLogToClipboard() {
    const text = buildDebugLogText();
    if (!text) {
      notify("There are no debug entries to copy.");
      return;
    }

    await copyTextToClipboard(text);
    notify("Debug log copied to clipboard.");
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "readonly");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }

  function notify(message) {
    logDebug("response", String(message));
    showNoticeDialog(message);
  }

  // The server refused this client as out of date (a stale cached service worker,
  // e.g. a long-lived tab). Sync has already been halted upstream; bring the app up
  // to the current version by unregistering the SW — so the reload fetches fresh
  // files instead of the old cache — then reloading. Guarded to run at most once per
  // tab so a misconfigured minimum can't trap the tab in a reload loop.
  let _appUpgradeInProgress = false;
  async function forceAppUpgrade(detail) {
    if (_appUpgradeInProgress) return;
    _appUpgradeInProgress = true;
    const message = detail || "This app is out of date.";
    logDebug("response", "Upgrade required", message);
    if (sessionStorage.getItem("mdnotes.upgradeReloaded")) {
      // Already auto-refreshed once this tab and still stale — stop and ask the user,
      // rather than looping reloads.
      notify(`${message} Please fully close this tab and reopen it to finish updating.`);
      return;
    }
    try { sessionStorage.setItem("mdnotes.upgradeReloaded", "1"); } catch { /* ignore */ }
    try { showToast("Updating to the latest version…", { duration: 1500 }); } catch { /* ignore */ }
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
    } catch { /* ignore */ }
    setTimeout(() => globalThis.location.reload(), 1200);
  }

  // Lightweight, auto-dismissing feedback for successful actions (open/create/
  // rename/…). Unlike notify(), it never blocks — important on mobile where a modal
  // for every tap would be heavy. Errors should still use notify().
  let toastHost = null;
  function showToast(message, { duration = 2200 } = {}) {
    const text = String(message ?? "").trim();
    if (!text) return;
    toastHost = toastHost || document.getElementById("toast-host");
    if (!toastHost) return;
    const toast = document.createElement("div");
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    toastHost.append(toast);
    // Trigger the enter transition on the next frame.
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    const remove = () => {
      toast.classList.remove("is-visible");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
      // Fallback in case the transitionend never fires.
      setTimeout(() => toast.remove(), 400);
    };
    setTimeout(remove, duration);
  }

  async function confirmAction(message) {
    logDebug("action", "Confirm requested", String(message));
    const result = await showConfirmDialog({ message: String(message) });
    logDebug("response", `Confirm ${result ? "accepted" : "cancelled"}`, String(message));
    return result;
  }

  async function promptForName(message, defaultValue = "", options = {}) {
    logDebug("action", "Prompt requested", `${message} :: ${defaultValue}`);
    const result = await showInputDialog({ title: message, message, value: defaultValue, submitLabel: "Save", ...options });
    logDebug("response", result ? `Prompt value: ${result}` : "Prompt cancelled", message);
    return result;
  }

  return {
    confirmAction, copyDebugLogToClipboard, copyTextToClipboard, flashStatusPanel,
    forceAppUpgrade, formatEditorDebugValue, logDebug, notify, promptForName, renderDebugPanel,
    showAcceptConnectionDialog, showBookmarkEntryDialog, showConfirmDialog, showNoticeDialog,
    showToast, traceEditorEvent
  };
}
