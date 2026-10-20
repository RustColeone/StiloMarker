// The Mermaid library, imported from jsDelivr the first time a diagram shows
// (pinned; strict mode: labels are sanitized and click handlers are off), and
// a diagram drawn with it, themed as the app is: draw(code) -> the SVG, or a
// thrown error carrying Mermaid's reason. A failed import is tried again on
// the next diagram (the network may be back).
export const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs";

export function createMermaid({ doc = globalThis.document, importer = (url) => import(url) } = {}) {
  let loading = null;
  let theme = null;
  let count = 0;

  function load() {
    loading ??= importer(MERMAID_URL).then((module) => module.default ?? module).catch((error) => {
      loading = null;
      throw new Error(`Mermaid could not be loaded (${error.message || error}). Check your connection.`);
    });
    return loading;
  }

  async function draw(code) {
    const mermaid = await load();
    const wanted = doc?.documentElement.dataset.theme === "dark" ? "dark" : "default";
    if (theme !== wanted) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: wanted });
      theme = wanted;
    }
    count += 1;
    const id = `stilo-mermaid-${count}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      doc?.getElementById(`d${id}`)?.remove(); // what a failed render leaves in the page
    }
  }

  return { draw };
}
