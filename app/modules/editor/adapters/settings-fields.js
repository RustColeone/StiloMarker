// The Editor's settings, as fields in Settings → Appearance (Shell's dialog):
// the source font's size and family, word wrap, what Tab inserts, the
// formatting toolbar. Shell draws and saves the plain ones; the font picker is
// drawn here, because it says which fonts this device really has. What a
// change does to the editor is in surface.js (it listens to the settings).
import { clampSourceFontSize, cssFontFamily } from "../model/font.js";

const SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28];
const FAMILIES = ["Cascadia Code", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Roboto Mono",
  "Consolas", "Menlo", "Monaco", "SF Mono", "Ubuntu Mono", "Courier New"];
const CUSTOM = "__custom__";

// Push the typography settings onto the :root variables the editor and its gutter read.
export function applyEditorFont(settings, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;
  root.style.setProperty("--editor-font-size", `${clampSourceFontSize(settings.sourceFontSize)}px`);
  root.style.setProperty("--editor-font-family", cssFontFamily(settings.sourceFontFamily));
}

// A font the browser can't find is silently replaced by the fallback, so
// choosing it looked like "the setting does nothing". Detect availability the
// way font-detection libraries do: draw a sample with the candidate falling
// back to each generic family; if its width never differs from the bare
// generic, the browser substituted it. Results are cached.
function createFontProbe(doc) {
  const cache = new Map();
  const base = {};
  let context = null;
  return function isFontInstalled(name) {
    const clean = String(name ?? "").replace(/["'\\]/g, "").trim();
    if (!clean) return true;
    if (cache.has(clean)) return cache.get(clean);
    context ??= doc.createElement("canvas").getContext("2d");
    if (!context) return true; // no canvas: don't claim it's missing
    const sample = "mmmmmmmmmmlli10OoWW@#";
    const measure = (font) => {
      context.font = `72px ${font}`;
      return context.measureText(sample).width;
    };
    const installed = ["monospace", "serif", "sans-serif"].some((generic) => {
      base[generic] ??= measure(generic);
      return measure(`"${clean}", ${generic}`) !== base[generic];
    });
    cache.set(clean, installed);
    return installed;
  };
}

export function addEditorSettings({ dialog, settings, doc = globalThis.document }) {
  const isFontInstalled = createFontProbe(doc);
  const page = "appearance";
  dialog.fields.add({ page, id: "source-font-size-select", order: 50, label: "Source Font Size", key: "sourceFontSize", control: "select",
    options: SIZES.map((size) => [String(size), `${size} px${size === 13 ? " (default)" : ""}`]),
    read: (s) => { const size = clampSourceFontSize(s.sourceFontSize); return String(SIZES.includes(size) ? size : 13); },
    write: (value) => ({ sourceFontSize: clampSourceFontSize(value) }) });

  // The family: the curated list (marking fonts this device lacks), or a name typed under "Custom…".
  let fontField = null;
  dialog.fields.add({ page, id: "source-font-family", order: 60, key: "sourceFontFamily", render(box) {
    box.innerHTML = `<label>Source Font <select id="source-font-family-select"></select></label>
      <label id="source-font-custom-row" hidden>Custom Font Name
        <input id="source-font-custom-input" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. Operator Mono"></label>
      <p id="source-font-status" class="subtle-label source-font-status" aria-live="polite"></p>`;
    const select = box.querySelector("select");
    const customRow = box.querySelector("#source-font-custom-row");
    const custom = box.querySelector("input");
    const status = box.querySelector("#source-font-status");
    select.append(...[["", "Default (system monospace)"], ...FAMILIES.map((name) => [name, name]), [CUSTOM, "Custom\u2026"]].map(([value, label]) => {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      option.dataset.label = label;
      return option;
    }));
    function show() {
      const family = String(settings.sourceFontFamily ?? "").trim();
      const curated = family === "" || FAMILIES.includes(family);
      select.value = curated ? family : CUSTOM;
      custom.value = curated ? "" : family;
      customRow.hidden = select.value !== CUSTOM;
      // A missing font stays selectable only if it is the saved choice.
      for (const option of select.options) {
        if (!option.value || option.value === CUSTOM) continue;
        const installed = isFontInstalled(option.value);
        option.textContent = installed ? option.dataset.label : `${option.dataset.label} (not installed)`;
        option.disabled = !installed && select.value !== option.value;
      }
      // Which font is really on screen, and a plain warning when the chosen one is missing.
      const missing = family && !isFontInstalled(family);
      status.classList.toggle("is-warning", Boolean(missing));
      status.textContent = !family ? "Using the default monospace font."
        : missing ? `\u201c${family}\u201d isn\u2019t installed on this device, so the default monospace font is shown instead.`
          : `Using ${family}.`;
    }
    select.addEventListener("change", () => {
      if (select.value === CUSTOM) { customRow.hidden = false; custom.focus(); return; } // wait for a name
      settings.change({ sourceFontFamily: select.value }, "Settings: Source Font");
    });
    // On blur or Enter, so a half-typed name doesn't repaint the editor on every key.
    custom.addEventListener("change", () => settings.change({ sourceFontFamily: custom.value.trim() }, "Settings: Custom Font Name"));
    fontField = { show };
    show();
  } });
  settings.on((view, changed) => { if (changed.includes("sourceFontFamily")) fontField?.show(); });
  dialog.onOpen(() => fontField?.show());

  dialog.fields.add({ page, id: "word-wrap-select", order: 70, label: "Word Wrap", key: "wordWrap", control: "select",
    options: [["on", "On"], ["off", "Off"]], read: (s) => (s.wordWrap ? "on" : "off"), write: (value) => ({ wordWrap: value === "on" }) });
  dialog.fields.add({ page, id: "indent-style-select", order: 80, label: "Tab Key Inserts", key: "indentStyle", control: "select",
    options: [["tab", "Tab"], ["spaces", "4 Spaces"]] });
  dialog.fields.add({ page, id: "format-toolbar-input", order: 90, label: "Show markdown formatting toolbar", key: "showFormatToolbar", control: "checkbox" });
  dialog.fields.add({ page, id: "spellcheck-input", order: 95, label: "Check spelling (the browser's dictionary)", key: "spellcheck", control: "checkbox" });
}
