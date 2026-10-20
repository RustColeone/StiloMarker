// Settings → Appearance → Theme: every theme as a small card drawn in its own
// colours (a sidebar, a heading, two lines of text, the status bar), System
// first (Light and Dark split across it). A radio group: a click or an arrow
// key picks a theme and it applies at once; the card in use is marked.
import { paletteOf, themeFor } from "../model/themes.js";

// The colours a card is drawn with, from a theme's tokens.
function cardColours(theme) {
  const palette = paletteOf(theme);
  return {
    "--card-bg": palette.bg, "--card-side": palette.sidebar, "--card-page": palette.editor, "--card-border": palette.border,
    "--card-heading": palette["syntax-heading"], "--card-text": palette["text-muted"], "--card-link": palette["syntax-link"],
    "--card-accent": palette.accent, "--card-bar": palette["status-bg"]
  };
}

export function createThemePicker({ themes, settings, doc = globalThis.document }) {
  let cards = [];

  function art(theme, className = "") {
    const box = doc.createElement("span");
    box.className = `theme-card-art ${className}`.trim();
    box.setAttribute("aria-hidden", "true");
    for (const [name, value] of Object.entries(cardColours(theme))) box.style.setProperty(name, value);
    box.innerHTML = '<span class="theme-card-side"><i></i><i></i><i></i></span><span class="theme-card-page">' +
      '<i class="is-heading"></i><i></i><i class="is-short"></i><i class="is-link"></i></span><span class="theme-card-bar"></span>';
    return box;
  }

  function card(choice) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "theme-card";
    button.dataset.themeChoice = choice.id;
    button.setAttribute("role", "radio");
    const frame = doc.createElement("span");
    frame.className = "theme-card-frame";
    if (choice.id === "system") {
      frame.append(art(themeFor("light", themes)), art(themeFor("dark", themes, true), "is-second"));
    } else {
      frame.append(art(choice));
    }
    const name = doc.createElement("span");
    name.className = "theme-card-name";
    name.textContent = choice.label;
    button.append(frame, name);
    button.addEventListener("click", () => pick(choice.id));
    return button;
  }

  function pick(id) {
    if (settings.theme !== id) settings.change({ theme: id }, "Settings: Theme");
    mark();
  }

  // The card in use is checked, and the one Tab reaches.
  function mark() {
    const current = cards.some((button) => button.dataset.themeChoice === settings.theme) ? settings.theme : "system";
    for (const button of cards) {
      const checked = button.dataset.themeChoice === current;
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = checked ? 0 : -1;
    }
  }

  settings.on((view, changed) => { if (changed.includes("theme")) mark(); });

  // A field Shell's Settings dialog asks to be drawn (fields.add({ render })).
  function render(holder) {
    holder.classList.add("theme-field");
    const label = doc.createElement("div");
    label.className = "theme-field-label";
    label.id = "theme-picker-label";
    label.textContent = "Theme";
    const group = doc.createElement("div");
    group.className = "theme-picker";
    group.id = "theme-picker";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", "theme-picker-label");
    cards = [{ id: "system", label: "System" }, ...themes].map(card);
    group.append(...cards);
    // Arrow keys move the choice, as in any radio group.
    group.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const at = cards.indexOf(doc.activeElement);
      const next = cards[(Math.max(at, 0) + step + cards.length) % cards.length];
      pick(next.dataset.themeChoice);
      next.focus();
    });
    holder.append(label, group);
    mark();
  }

  return { render };
}
