// Shell: the app's frame. Owns the menu bar, app-wide shortcuts and the modal
// dialogs, and offers two extension points: commands and menus.
//
// API:
//   commands.add({ id: "owner.action", title, run, keys?: ["Mod+S"],
//                  menu?: { id, group?, order? }, enabled?: () => bool, danger? })
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
//                            for the panes and status without the tree); the
//                            app listens: events.on("render", ({ project, only }) => …)
//   pages                    features as pages in tab hosts, like a browser's tabs:
//                            pages.add({ host, id, label, body, newItem?, shown? }),
//                            show(host, id), active(host), badge(host, id, n) (adapters/pages.js)
//   settingsDialog           the Settings dialog: addPage({ id, label, order, body }), fields.add({ page, id,
//                            order, label, key, control: select|checkbox, options } | { page, id, order,
//                            render(box) }), open(page?), onOpen(listener) (adapters/settings-dialog.js)
//   statusBar                the status bar: add({ id, order, title?, action?, dot?, grow?, hidden? })
//                            -> { set({ text, tone, title, hidden }), element, extra } (adapters/status-bar.js)
//   settings                 the app's settings, read-only (settings.theme);
//                            settings.change({ key: value }, why?) saves a change,
//                            settings.on(listener) hears them (service/settings.js)
// Errors nothing caught go into the kernel's trace; `stiloTrace()` in the
// console prints it.
import { createLiveView, defineModule } from "../../kernel/index.js";
import { createCommands } from "./service/commands.js";
import { createDialogs } from "./adapters/dialogs.js";
import { createKeyboard } from "./adapters/keyboard.js";
import { createMenuBar } from "./adapters/menu-bar.js";
import { createServer } from "./adapters/server.js";
import { watchPageErrors } from "./adapters/page-errors.js";
import { createPages } from "./adapters/pages.js";
import { createSettingsDialog } from "./adapters/settings-dialog.js";
import { createStatusBar } from "./adapters/status-bar.js";
import { applyTheme } from "./adapters/theme.js";
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
    registries: ["commands", "menus", "pages", "settings fields", "status bar items"],
    elements: ["menu bar", "the Settings dialog", "the status bar", "notice dialog", "confirm dialog", "input dialog", "form dialog", "toasts"],
    connection: ["the server address"],
    events: ["render"],
    diagnostics: ["uncaught errors", "stiloTrace()"],
    state: ["the app's settings"]
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
    const pages = createPages({ registry: ctx.registry({ key: "key" }), settings });
    const settingsDialog = createSettingsDialog({ pages, settings, registry: ctx.registry() });
    // The theme follows its setting, and the system's when it is "system".
    applyTheme(settings.theme);
    settings.on((view, changed) => { if (changed.includes("theme")) applyTheme(view.theme); });
    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => applyTheme(settings.theme));
    settingsDialog.addPage({ id: "appearance", label: "Appearance", order: 10, body: globalThis.document?.querySelector("#settings-panel-appearance") });
    settingsDialog.fields.add({ page: "appearance", id: "theme-select", order: 10, label: "Theme", key: "theme", control: "select",
      options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]] });
    // The frame's layout (main.js applies it until the areas are Shell's).
    settingsDialog.fields.add({ page: "appearance", id: "explorer-select", order: 20, label: "Explorer", key: "explorer", control: "select",
      options: [["expanded", "Expanded"], ["collapsed", "Collapsed"]] });
    settingsDialog.fields.add({ page: "appearance", id: "explorer-anchor-select", order: 30, label: "Explorer anchor", key: "explorerAnchor", control: "select",
      options: [["docked", "Docked (resizes content)"], ["floating", "Floating (overlay)"]] });
    settingsDialog.fields.add({ page: "appearance", id: "preview-select", order: 40, label: "Preview", key: "preview", control: "select",
      options: [["shown", "Shown"], ["hidden", "Hidden"]] });

    function notice(message, title = "Message") {
      ctx.log(`notice: ${message}`);
      dialogs.showNotice(message, title);
    }
    const report = (error) => notice(error?.message ?? String(error));
    const root = document.querySelector(".menu-bar");
    const menuBar = root ? createMenuBar({ root, commands, menus, run, report }) : { close() {} };
    createKeyboard({ commands, run, report });

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
      server: createServer(),
      settings,
      pages,
      settingsDialog,
      statusBar: createStatusBar({ registry: ctx.registry() }),
      render: (project, { only } = {}) => events.emit("render", { project, only }),
      events: { on: events.on }
    };
  }
});
