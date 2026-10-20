// Shell: the app's frame. Owns the menu bar, app-wide shortcuts and the modal
// dialogs, and offers two extension points: commands and menus.
//
// API:
//   commands.add({ id: "owner.action", title, run, keys?: ["Mod+S"],
//                  menu?: { id, group?, order? }, enabled?: () => bool, danger?,
//                  keywords?: ["other", "words"], args? })
//                            any command can be typed on the Log's command line
//                            (adapters/command-line.js) but one whose run() needs
//                            its caller's arguments (args: true)
//   menus.add({ id, label, order })
//   run(id, ...args)              -> Promise<boolean>
//   closeMenus()
//   notice(message, title?)       a blocking message, also logged
//   notify(message)               the same, titled "Message"
//   confirm(message | {title, message, acceptLabel}) -> Promise<boolean>
//   input({title, message, label, value, submitLabel, suffix}) -> Promise<string|null>
//   form({eyebrow, title, message, fields: [{ name, label, value, type: text|url, multiline, placeholder }],
//         submitLabel}) -> Promise<{ name: value } | null>
//   toast(message, {duration})
//   copyText(text)
//   server.configure({ address: () => string })   where the server is (a setting)
//   server.url()                                   its normalized address
//   server.request(path, { method, query, body, failure, timeout })
// Static, for code from before the restructure: normalizeServerUrl,
// parseResponse, throwForResponse, patchStoredSettings (a guarded merge into
// the stored settings, for the page going away). Static, for any page with a
// conversation: shouldSubmitChat, isChatNearBottom, paintConversation,
// contextChipsHtml (adapters/conversation.js).
//   render(project, { only? })  ask for the app to be drawn again (only: "status"
//                            for the panes and status without the tree); each module
//                            draws its part: events.on("render", ({ project, only }) => …).
//                            A full redraw waits while a module is busy (adapters/render.js)
//   holdRendering(busyNow)   a module busy in a way a redraw would disturb (the Editor typing)
//   clearAppStorage()        remove every key the app keeps in this browser
//   registerOffline()        keep the app's files for offline use (the service worker)
//   events "clearing-caches" before Clear All Cache reloads: drop what you cache
//   pages                    features as pages in tab hosts, like a browser's tabs:
//                            pages.add({ host, id, label, body, newItem?, shown? }),
//                            show(host, id), active(host), badge(host, id, n) (adapters/pages.js)
//   settingsDialog           the Settings dialog: addPage({ id, label, order, body }), fields.add({ page, id,
//                            order, label, key, control: select|checkbox, options } | { page, id, order,
//                            render(box) }), open(page?), onOpen(listener) (adapters/settings-dialog.js)
//   statusBar                the status bar: add({ id, order, title?, action?, dot?, grow?, hidden? })
//                            -> { set({ text, tone, title, hidden }), element, extra } (adapters/status-bar.js)
//   frame                    the areas around the editor: toggle(area), shown(area), isPhone(),
//                            revealSection(id), phonePanes.add(pane), showPane(id)…; events "area",
//                            "resized", "layout" (adapters/frame/index.js)
//   log(kind, message, detail?)  a line in the log panel (kind "action", "response", "error"…);
//                            logLines() -> [{ kind, message, detail, timestamp }] (for tests)
//   flash(panel, "success" | "error")   flash a status panel's border
//   upgradeApp(detail)       the server refused this tab as too old: update it (once per tab)
//   beforeReload             what Reload Window keeps before it reloads (adapters/reload.js):
//                            add({ id, label, order?, keep: async () => problem text | nothing });
//                            a problem asks the user before reloading
//   reloading()              Reload Window is reloading: the page must not ask "Leave site?"
//   themes()                 the themes Settings offers: Light, Dark and those extensions
//                            contribute (manifest contributes.themes; model/themes.js)
//   settings                 the app's settings, read-only (settings.theme);
//                            settings.change({ key: value }, why?) saves a change,
//                            settings.on(listener) hears them (service/settings.js)
// Errors nothing caught go into the kernel's trace; `stiloTrace()` in the
// console prints it.
import { createLiveView, defineModule, ignore } from "../../kernel/index.js";
import { createCommands } from "./service/commands.js";
import { createDialogs } from "./adapters/dialogs.js";
import { createKeyboard } from "./adapters/keyboard.js";
import { createMenuBar } from "./adapters/menu-bar.js";
import { createServer } from "./adapters/server.js";
import { watchPageErrors } from "./adapters/page-errors.js";
import { createPages } from "./adapters/pages.js";
import contributed from "./model/contributed-settings.js";
import { createSettingsDialog } from "./adapters/settings-dialog.js";
import { createStatusBar } from "./adapters/status-bar.js";
import { applyTheme } from "./adapters/theme.js";
import { createThemePicker } from "./adapters/theme-picker.js";
import { usableThemes } from "./model/themes.js";
import contributedThemes from "./model/contributed-themes.js";
import { addMaintenanceCommands, clearAppStorage } from "./adapters/maintenance.js";
import { createRender } from "./adapters/render.js";
import { createFrame } from "./adapters/frame/index.js";
import { registerOfflineShell, upgradeApp } from "./adapters/offline.js";
import { APP_VERSION } from "./model/version.js";
import { createLogPanel, flash } from "./adapters/log-panel.js";
import { createCommandLine, listCommands } from "./adapters/command-line.js";
import { checkReloadStep, createReload } from "./adapters/reload.js";
import { loadSettings, patchStoredSettings } from "./adapters/settings-store.js";
import { SECRET_SETTINGS, keysToSave } from "./service/settings.js";

export { normalizeServerUrl, parseResponse, throwForResponse } from "./adapters/server.js";
export { patchStoredSettings } from "./adapters/settings-store.js";
export { contextChipsHtml, isChatNearBottom, paintConversation, shouldSubmitChat } from "./adapters/conversation.js";

export default defineModule({
  name: "shell",
  level: 1,
  uses: [],
  owns: {
    registries: ["commands", "menus", "pages", "settings fields", "status bar items", "phone panes", "reload steps"],
    elements: ["menu bar", "the Settings dialog", "the status bar", "the log panel", "the Log's command line", "the frame: areas, splitters, phone panes and gestures", "notice dialog", "confirm dialog", "input dialog", "form dialog", "toasts"],
    connection: ["the server address"],
    events: ["render", "clearing-caches", "area", "resized", "layout"],
    diagnostics: ["uncaught errors", "stiloTrace()"],
    state: ["the app's settings"],
    storage: ["the theme kept for the next page"]
  },
  start(ctx) {
    watchPageErrors();
    // The settings: loaded once; each change saves just the keys it changed
    // (keysToSave), so a tab never writes back what another tab changed since.
    const settingsState = ctx.state(loadSettings(), { secret: SECRET_SETTINGS });
    settingsState.on((current, changed) => {
      const keys = keysToSave(changed);
      if (keys.length) patchStoredSettings(() => Object.fromEntries(keys.map((key) => [key, current[key]])));
    });
    const settings = createLiveView(settingsState);
    const events = ctx.emitter();
    const { commands, menus, run } = createCommands(ctx);
    const dialogs = createDialogs();
    // The pages in the areas' hosts; whether an area shows (and the phone,
    // where the left's sections start collapsed) the frame tells, made below.
    let frame = null;
    const AREA_OF_HOST = { left: "left", side: "right", bottom: "bottom" };
    const pages = createPages({ registry: ctx.registry({ key: "key" }), settings, events, isPhone: () => frame?.isPhone() ?? false,
      areaShown: (host) => frame?.shown(AREA_OF_HOST[host]) ?? false,
      showArea: (host) => { if (frame && !frame.shown(AREA_OF_HOST[host])) frame.toggle(AREA_OF_HOST[host]); } });
    const settingsDialog = createSettingsDialog({ pages, settings, registry: ctx.registry() });
    // The theme follows its setting, and the system's when it is "system":
    // Light, Dark, or one an extension contributes (model/themes.js).
    const themes = usableThemes(contributedThemes, (id, why) => ctx.log(`theme ${id} left out: ${why}`));
    applyTheme(settings.theme, themes);
    settings.on((view, changed) => { if (changed.includes("theme")) applyTheme(view.theme, themes); });
    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => applyTheme(settings.theme, themes));
    settingsDialog.addPage({ id: "appearance", label: "Appearance", order: 10, body: globalThis.document?.querySelector("#settings-panel-appearance") });
    settingsDialog.fields.add({ page: "appearance", id: "theme-picker", order: 10, render: createThemePicker({ themes, settings }).render });
    // The frame's layout (main.js applies it until the areas are Shell's).
    settingsDialog.fields.add({ page: "appearance", id: "explorer-select", order: 20, label: "Explorer", key: "explorer", control: "select",
      options: [["expanded", "Expanded"], ["collapsed", "Collapsed"]] });
    settingsDialog.fields.add({ page: "appearance", id: "explorer-anchor-select", order: 30, label: "Explorer anchor", key: "explorerAnchor", control: "select",
      options: [["docked", "Docked (resizes content)"], ["floating", "Floating (overlay)"]] });
    settingsDialog.fields.add({ page: "appearance", id: "preview-select", order: 40, label: "Preview", key: "preview", control: "select",
      options: [["shown", "Shown"], ["hidden", "Hidden"]] });
    // The fields of the settings extensions contribute (their manifests): a
    // select shows its default while what is kept is none of its options, a
    // checkbox its default until it is set.
    for (const { key, default: fallback, field } of contributed) {
      if (!field) continue;
      settingsDialog.fields.add({ ...field, key, read(view) {
        const value = view[key];
        if (field.control === "select") return (field.options ?? []).some(([option]) => option === value) ? value : fallback;
        return value === undefined || value === null ? fallback : field.control === "checkbox" ? Boolean(value) : value;
      } });
    }

    function notice(message, title = "Message") {
      ctx.log(`notice: ${message}`);
      dialogs.showNotice(message, title);
    }
    const report = (error) => notice(error?.message ?? String(error));
    const root = document.querySelector(".menu-bar");
    const menuBar = root ? createMenuBar({ root, commands, menus, run, report }) : { close() {} };
    createKeyboard({ commands, run, report });
    // The menu bar's menus; their items are other modules' commands.
    menus.add({ id: "file", label: "File", order: 1 });
    menus.add({ id: "edit", label: "Edit", order: 2 });
    menus.add({ id: "create", label: "Create", order: 3 });
    menus.add({ id: "view", label: "View", order: 4 });
    menus.add({ id: "settings", label: "Settings", order: 5 });
    // The app's version, wherever the page shows it.
    globalThis.document?.querySelectorAll("[data-app-version]").forEach((label) => { label.textContent = `v${APP_VERSION}`; });

    async function confirm(request) {
      const options = typeof request === "string" ? { message: request } : request;
      ctx.log(`confirm requested: ${options.message}`);
      const accepted = await dialogs.showConfirm(options);
      ctx.log(`confirm ${accepted ? "accepted" : "cancelled"}: ${options.message}`);
      return accepted;
    }

    async function input(options) {
      ctx.log(`input requested: ${options.title ?? ""} :: ${options.value ?? ""}`);
      const value = await dialogs.showInput(options);
      ctx.log(value ? `input value: ${value}` : "input cancelled");
      return value;
    }

    async function form(options) {
      ctx.log(`form requested: ${options.title ?? ""}`);
      const values = await dialogs.showForm(options);
      ctx.log(values ? `form sent: ${options.title ?? ""}` : "form cancelled");
      return values;
    }

    const redraw = createRender(events);
    addMaintenanceCommands({ commands, confirm, notify: (message) => notice(message), closeMenus: () => menuBar.close(), events,
      log: (message) => ctx.log(message) });

    // The frame: the areas around the editor and what shows in them (desktop and phone).
    frame = createFrame({ settings, events, registry: ctx.registry(), pages, commands, run, closeMenus: () => menuBar.close(),
      openSettings: (page) => settingsDialog.open(page), log: (message) => ctx.log(message) });
    frame.apply();
    // The log panel (the bottom area): drawn when the layout changes or the
    // bottom area shows or hides (on the phone, a sheet).
    const logPanel = createLogPanel({ shown: () => frame.shown("bottom"), copyText: dialogs.copyText, notify: (message) => notice(message) });
    events.on("layout", () => logPanel.render());
    events.on("area", ({ area }) => { if (area === "bottom") logPanel.render(); });
    // The bottom area's page: its filters, Copy and Clear beside its tab.
    const doc = globalThis.document;
    if (doc) {
      pages.add({ host: "bottom", id: "log", order: 10, label: "Log", title: "What the app did, and the kernel's trace",
        body: doc.getElementById("log-page"), toolbar: doc.getElementById("log-toolbar"), shown: (visible) => { if (visible) logPanel.render(); } });
    }
    logPanel.render();
    // The Log's command line, and the commands that help when the app seems
    // stuck: Run Command… (F1) goes to it wherever the Log page is; Reload
    // Window reloads keeping the work (the modules' beforeReload steps).
    const commandLine = createCommandLine({ commands, run, log: logPanel.log, showAll: logPanel.showAll });
    const reloadSteps = ctx.registry({ validate: checkReloadStep });
    const reload = createReload({ steps: reloadSteps, confirm, log: logPanel.log });
    function showLog() {
      const area = pages.areaOf("log") ?? "bottom";
      if (!frame.shown(area)) frame.toggle(area);
      const host = pages.hostOf("log") ?? "bottom";
      if (host === "left") pages.reveal(host, "log");
      else pages.show(host, "log");
    }
    commands.add({ id: "shell.run-command", title: "Run Command…", keywords: ["palette", "console", "terminal"], keys: ["F1"],
      menu: { id: "view", group: 0, order: 6 }, run() {
        showLog();
        globalThis.requestAnimationFrame?.(() => commandLine.focus());
      } });
    commands.add({ id: "shell.reload-window", title: "Reload Window", keywords: ["refresh", "restart", "stuck", "frozen"],
      menu: { id: "settings", group: 0, order: 2.5 }, run: () => reload.reloadWindow() });
    commands.add({ id: "shell.pick-theme", title: "Change Theme…", keywords: ["colour", "color", "dark", "light", "appearance"],
      run() {
        settingsDialog.open("appearance");
        globalThis.document?.querySelector('#theme-picker [aria-checked="true"]')?.focus();
      } });
    commands.add({ id: "shell.list-commands", title: "Help: List Commands", keywords: ["commands"],
      run: () => { showLog(); logPanel.showAll(); listCommands({ commands, log: logPanel.log }); } });
    // The server is where the settings say.
    const server = createServer();
    server.configure({ address: () => settings.serverUrl });
    // Once the app is there: its files kept for offline use (in a page).
    ctx.whenStarted(() => {
      logPanel.log("response", "Debug log initialized", `panel=${settings.debugPanel ? "visible" : "hidden"}`);
      if (globalThis.window) void registerOfflineShell();
    });

    return {
      commands: { add: commands.add, get: commands.get, all: commands.all, onChange: commands.onChange },
      menus: { add: menus.add, all: menus.all },
      run,
      closeMenus: () => menuBar.close(),
      notice,
      notify: (message) => notice(message),
      confirm,
      input,
      form,
      toast: dialogs.showToast,
      copyText: dialogs.copyText,
      server,
      settings,
      pages,
      settingsDialog,
      statusBar: createStatusBar({ registry: ctx.registry() }),
      frame,
      log: logPanel.log,
      logLines: logPanel.lines,
      flash,
      upgradeApp: (detail) => upgradeApp(detail, { log: logPanel.log, notify: (message) => notice(message), toast: dialogs.showToast, ignore }),
      beforeReload: { add: reloadSteps.add },
      reloading: reload.reloading,
      themes: () => themes,
      render: redraw.render,
      holdRendering: redraw.holdWhile,
      clearAppStorage,
      registerOffline: () => registerOfflineShell(),
      events: { on: events.on }
    };
  }
});
