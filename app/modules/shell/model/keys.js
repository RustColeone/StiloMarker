// Keyboard shortcuts as text, e.g. "Mod+S" or "Shift+Mod+Enter". "Mod" is
// Ctrl or Cmd (either works on every platform, as the app always allowed).
// Pure: no page access, so it runs in Node tests.

const MODIFIERS = new Set(["mod", "shift", "alt"]);

export function parseChord(text) {
  const raw = String(text ?? "").trim();
  // "Mod++" is the plus key; any other empty part ("Mod+", "+S") is a mistake.
  const plusKey = raw.endsWith("++");
  const parts = (plusKey ? raw.slice(0, -2) : raw).split("+").map((part) => part.trim());
  const key = plusKey ? "+" : parts.pop();
  if (!raw || !key || parts.some((part) => !part)) throw new Error(`Empty shortcut part in "${text}"`);
  if (MODIFIERS.has(key.toLowerCase())) throw new Error(`"${text}" names no key, only modifiers`);
  const chord = { key: key.toLowerCase(), mod: false, shift: false, alt: false };
  for (const part of parts) {
    const name = part.toLowerCase();
    if (!MODIFIERS.has(name)) throw new Error(`Unknown modifier "${part}" in "${text}"`);
    chord[name] = true;
  }
  return Object.freeze(chord);
}

// Does a keydown-like event ({key, ctrlKey, metaKey, shiftKey, altKey}) press
// this chord? Shift is checked only when the chord names it, so "Mod+S" still
// saves with Shift held, as before.
export function chordMatches(chord, event) {
  if (String(event.key ?? "").toLowerCase() !== chord.key) return false;
  if (chord.mod !== Boolean(event.ctrlKey || event.metaKey)) return false;
  if (chord.alt !== Boolean(event.altKey)) return false;
  if (chord.shift && !event.shiftKey) return false;
  return true;
}

// A shortcut as the user reads it: "Mod" is Cmd on a Mac, Ctrl elsewhere.
export function chordLabel(text, mac = false) {
  return String(text ?? "").replace(/\bMod\b/g, mac ? "Cmd" : "Ctrl");
}
