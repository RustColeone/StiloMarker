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
// the stored settings, for the page going away).
//   settings                 the app's settings, read-only (settings.theme);
//                            settings.change({ key: value }, why?) saves a change,
//                            settings.on(listener) hears them (service/settings.js)
// Errors nothing caught go into the kernel's trace; `stiloTrace()` in the
// console prints it.
import { defineModule } from "../../kernel/index.js";
import { createCommands } from "./service/commands.js";
import { createDialogs } from "./adapters/dialogs.js";
import { createKeyboard } from "./adapters/keyboard.js";
import { createMenuBar } from "./adapters/menu-bar.js";
import { createServer } from "./adapters/server.js";
import { watchPageErrors } from "./adapters/page-errors.js";
import { loadSettings, patchStoredSettings } from "./adapters/settings-store.js";
import { SECRET_SETTINGS, createSettingsView, keysToSave } from "./service/settings.js";

export { normalizeServerUrl, parseResponse, throwForResponse } from "./adapters/server.js";
export { patchStoredSettings } from "./adapters/settings-store.js";

export default defineModule({
  name: "shell",
  level: 1,
  uses: [],
  owns: {
    registries: ["commands", "menus"],
    elements: ["menu bar", "notice dialog", "confirm dialog", "input dialog", "form dialog", "toasts"],
    connection: ["the server address"],
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
    const settings = createSettingsView(settingsState);
    const { commands, menus, run } = createCommands(ctx);
    const dialogs = createDialogs();

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
      settings
    };
  }
});
