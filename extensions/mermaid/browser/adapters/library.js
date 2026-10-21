// The Mermaid library, loaded the first time a diagram shows (pinned, served
// from this extension's vendor/ folder, listed in the app's vendor/README.md;
// strict mode: labels are sanitized and click handlers are off), and a
// diagram drawn with it, themed as the app is:
// draw(code) -> the SVG, or a thrown error carrying Mermaid's reason. A failed
// load is tried again on the next diagram.
export const MERMAID_URL = new URL("../vendor/mermaid/11.17.2/mermaid.min.js", import.meta.url).href;

// The library's own file (it sets globalThis.mermaid), added to the page once.
function loadScript(url, doc) {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  return new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = new URL(url, doc.baseURI).href;
    script.onload = () => (globalThis.mermaid ? resolve(globalThis.mermaid) : reject(new Error("the library did not start")));
    script.onerror = () => { script.remove(); reject(new Error("the library's file did not load")); };
    doc.head.append(script);
  });
}

export function createMermaid({ doc = globalThis.document, importer = (url) => loadScript(url, doc) } = {}) {
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
