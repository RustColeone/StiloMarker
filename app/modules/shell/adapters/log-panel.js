// The log panel (the frame's bottom area): what the app did, kept in this tab
// (log(kind, message, detail) from any module), and the kernel's trace in its
// own tab; filtered by tab, copied, cleared. It draws only while shown:
// shown() is the frame's (the setting on the desktop, the sheet on the phone).
import { trace } from "../../../kernel/index.js";

const MAX_ENTRIES = 300;
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function createLogPanel({ shown, copyText, notify, doc = globalThis.document }) {
  const $ = (id) => doc?.getElementById(id);
  const list = $("debug-log-list");
  const tabs = [...($("debug-tab-strip")?.querySelectorAll(".debug-tab") ?? [])].map((element) => ({ id: element.dataset.tab, element }));
  let entries = [];
  let activeTab = "all";

  function log(kind, message, detail = "") {
    entries.push({ kind, message, detail, timestamp: new Date().toLocaleTimeString() });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    render();
  }

  function visible() {
    if (activeTab === "trace") {
      return trace.entries().slice(-MAX_ENTRIES).map((entry) => ({
        kind: entry.kind, message: `${entry.owner}: ${entry.message}${entry.count > 1 ? ` (x${entry.count})` : ""}`,
        detail: entry.detail, timestamp: new Date(entry.time).toLocaleTimeString()
      }));
    }
    if (activeTab === "actions") return entries.filter((entry) => entry.kind === "action");
    if (activeTab === "responses") return entries.filter((entry) => entry.kind !== "action");
    return entries;
  }

  function render() {
    for (const tab of tabs) {
      const active = tab.id === activeTab;
      tab.element.classList.toggle("is-active", active);
      tab.element.setAttribute("aria-selected", String(active));
    }
    if (!list) return;
    list.replaceChildren();
    if (!shown()) return;
    const rows = visible();
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "debug-log-entry is-empty";
      empty.textContent = "Log capture is enabled. Matching interactions will appear here.";
      list.append(empty);
      return;
    }
    for (const entry of rows) {
      const row = doc.createElement("div");
      row.className = `debug-log-entry is-${entry.kind}`;
      row.innerHTML = `<span class="debug-log-time">${escapeHtml(entry.timestamp)}</span><span class="debug-log-kind">${escapeHtml(entry.kind)}</span><span class="debug-log-message">${escapeHtml(entry.message)}</span>${entry.detail ? `<span class="debug-log-detail">${escapeHtml(entry.detail)}</span>` : ""}`;
      list.append(row);
    }
    list.scrollTop = list.scrollHeight;
  }

  function text() {
    if (activeTab === "trace") return trace.text();
    return entries.map((entry) => `[${entry.timestamp}] ${entry.kind.toUpperCase()} ${entry.message}${entry.detail ? ` :: ${entry.detail}` : ""}`).join("\n");
  }

  // The Trace tab follows the trace, at most once a frame.
  let frame = 0;
  trace.onRecord(() => {
    if (frame || activeTab !== "trace" || !shown()) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  });
  for (const tab of tabs) tab.element.addEventListener("click", () => { activeTab = tab.id; render(); });
  $("debug-copy-button")?.addEventListener("click", async () => {
    const value = text();
    if (!value) { notify("There are no debug entries to copy."); return; }
    try {
      await copyText(value);
      notify("Debug log copied to clipboard.");
    } catch (error) {
      notify(error.message);
    }
  });
  $("debug-clear-button")?.addEventListener("click", () => {
    if (activeTab === "trace") trace.clear();
    else entries = [];
    render();
  });

  // The All tab: what a typed command did shows there.
  function showAll() {
    if (activeTab === "all") return;
    activeTab = "all";
    render();
  }

  return { log, render, showAll, lines: () => entries.map((entry) => ({ ...entry })) };
}

// Flash a status panel's border: green ("success") or red ("error").
export function flash(panel, type) {
  if (!panel) return;
  panel.classList.remove("settings-status-panel--flash-success", "settings-status-panel--flash-error");
  void panel.offsetWidth; // a reflow, so a flash restarts mid-animation
  panel.classList.add(type === "success" ? "settings-status-panel--flash-success" : "settings-status-panel--flash-error");
}
