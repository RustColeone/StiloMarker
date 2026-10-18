// Legacy (before the module restructure): the debug log panel and editor
// tracing, the accept-connection dialog, and the forced app
// upgrade. Notices, confirms, inputs and toasts moved to the Shell module.
// main.js creates this on first use and passes its shared values in `app`.


import { ignore, trace } from "../kernel/index.js";

export function createDialogs(app) {
  // The Trace tab shows the kernel's trace; it redraws at most once a frame.
  let traceFrame = 0;
  trace.onRecord(() => {
    if (traceFrame || app.debugState.activeTab !== "trace" || !app.settings.debugPanel) return;
    traceFrame = requestAnimationFrame(() => { traceFrame = 0; renderDebugPanel(); });
  });

  function clearDebugLog() {
    if (app.debugState.activeTab === "trace") trace.clear();
    else app.debugState.entries = [];
    renderDebugPanel();
  }

  function buildDebugLogText() {
    if (app.debugState.activeTab === "trace") return trace.text();
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




  function getVisibleDebugEntries() {
    if (app.debugState.activeTab === "trace") {
      return trace.entries().slice(-app.debugState.maxEntries).map((entry) => ({
        kind: entry.kind,
        message: `${entry.owner}: ${entry.message}${entry.count > 1 ? ` (x${entry.count})` : ""}`,
        detail: entry.detail,
        timestamp: new Date(entry.time).toLocaleTimeString()
      }));
    }

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
      app.shell.notify("There are no debug entries to copy.");
      return;
    }

    await app.shell.copyText(text);
    app.shell.notify("Debug log copied to clipboard.");
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
      app.shell.notify(`${message} Please fully close this tab and reopen it to finish updating.`);
      return;
    }
    try { sessionStorage.setItem("mdnotes.upgradeReloaded", "1"); } catch (error) { ignore(error, "session storage is blocked"); }
    try { app.shell.toast("Updating to the latest version…", { duration: 1500 }); } catch (error) { ignore(error, "showing the update toast failed"); }
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
    } catch (error) { ignore(error, "unregistering the service worker failed; reloading anyway"); }
    setTimeout(() => globalThis.location.reload(), 1200);
  }



  return {
    clearDebugLog, copyDebugLogToClipboard, flashStatusPanel, forceAppUpgrade, formatEditorDebugValue, logDebug,
    renderDebugPanel, showAcceptConnectionDialog, traceEditorEvent
  };
}
