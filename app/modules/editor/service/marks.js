// Marks other modules put on files (the Editor's extension point): a range of
// lines tinted in the source editor and its gutter, a badge on the file's tab
// and on its row in the explorer, and an optional bar over the editor while the
// file is shown. One mark per file path:
//   { owner, kind, lineStart, lineEnd, title?, bar?() -> html }
// `kind` names the look (lines, gutter rows and explorer rows get `is-<kind>`);
// `owner` is the module that put it. Every change is in the trace.
export const EMPTY_MARKS = { marks: {} };

export function createMarks(state) {
  const all = () => state.get().marks;
  return Object.freeze({
    get: (path) => all()[path] ?? null,
    paths: () => Object.keys(all()),
    entries: () => Object.entries(all()),
    // Put marks on several files at once: { path: mark }.
    put(byPath, why) {
      const added = Object.fromEntries(Object.entries(byPath).map(([path, mark]) => [path, Object.freeze({ ...mark })]));
      if (Object.keys(added).length) state.set(why ?? "put marks", { marks: { ...all(), ...added } });
    },
    // Take off the marks a test picks: (mark, path) -> boolean. Returns how many.
    remove(test, why) {
      const kept = Object.entries(all()).filter(([path, mark]) => !test(mark, path));
      const removed = Object.keys(all()).length - kept.length;
      if (removed) state.set(why ?? "remove marks", { marks: Object.fromEntries(kept) });
      return removed;
    },
    on: (listener) => state.on(() => listener())
  });
}
