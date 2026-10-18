// The source editor's typography, as rules: the font size kept to a sane range
// and a user-typed family name made safe for CSS. Pure.
const SOURCE_FONT_SIZE_MIN = 10;
const SOURCE_FONT_SIZE_MAX = 28;

export function clampSourceFontSize(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 13;
  return Math.min(SOURCE_FONT_SIZE_MAX, Math.max(SOURCE_FONT_SIZE_MIN, n));
}

/** A user-supplied family name as a safe CSS font-family value. Strips the
 *  characters that could break out of the declaration, then quotes it and keeps
 *  the default mono stack as the fallback for a font that isn't installed. */
export function cssFontFamily(name) {
  const clean = String(name ?? "").replace(/["';{}<>\\]/g, "").trim();
  return clean ? `"${clean}", var(--font-mono)` : "var(--font-mono)";
}
