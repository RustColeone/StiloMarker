"use strict";
// The architecture page: Stilo Marker's own structure (data.js, made by tools/architecture.py) as diagrams to click
// through, from the whole system down to one function, whose code shows in the pane on the right (the text comes from
// source.js, loaded the first time code is shown). diagram.js lays the diagrams out and draws them; this file decides
// what each level shows, and fills the pane, the search and the trail. The two guides (how an extension goes in, how a
// change goes in) are drawn from the same data.
(() => {
  const A = window.ARCH;
  const $ = (selector) => document.querySelector(selector);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const files = A.files;
  const modules = A.modules;  // folder → { end, name, level, uses, owns, about, twin?, contract? }
  const END = { browser: "Browser module", server: "Server module", extension: "Extension" };
  const GUIDE_EXTENSIONS = "guide/extensions";
  const GUIDE_CHANGES = "guide/changes";
  const GUIDES = { [GUIDE_EXTENSIONS]: "How an extension goes in", [GUIDE_CHANGES]: "How a change goes in" };

  // ---- the index: every symbol by file, who calls it (inside its file), the modules by name ------------------
  const symbolOf = new Map();
  const calledBy = new Map();
  for (const [path, file] of Object.entries(files)) {
    for (const symbol of file.symbols) symbolOf.set(`${path}::${symbol.id}`, symbol);
    for (const symbol of file.symbols) {
      for (const callee of symbol.calls || []) {
        const key = `${path}::${callee}`;
        if (!calledBy.has(key)) calledBy.set(key, []);
        calledBy.get(key).push(symbol.id);
      }
    }
  }
  const sameName = (name) => String(name).replace(/_/g, "-");
  const moduleNamed = (end, name) => Object.keys(modules).find((folder) => modules[folder].end === end && sameName(modules[folder].name) === sameName(name));
  const usesOf = (folder) => (modules[folder].uses || []).map((name) => moduleNamed(modules[folder].end === "server" ? "server" : "browser", name)).filter(Boolean);
  const usedBy = (folder) => Object.keys(modules).filter((other) => usesOf(other).includes(folder));
  const moduleOf = (path) => Object.keys(modules).find((folder) => path === folder || path.startsWith(`${folder}/`));
  const link = (path, symbol = "") => `#/${path}${symbol ? `::${symbol}` : ""}`;
  const route = () => {
    let raw = "";
    try { raw = decodeURIComponent(location.hash.replace(/^#\/?/, "")); } catch { raw = ""; }
    const [path, symbol] = raw.split("::");
    return { path: path || "", symbol: symbol || "" };
  };
  const filesUnder = (folder) => Object.keys(files).filter((path) => path.startsWith(`${folder}/`));
  const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? "" : /(s|sh|ch|x)$/.test(word) ? "es" : "s"}`;
  const childrenOf = (path, id) => files[path].symbols.filter((symbol) => symbol.parent === id);
  const github = (path, start, end) => `${A.repo}/blob/${A.branch}/${path}${start ? `#L${start}${end ? `-L${end}` : ""}` : ""}`;
  const firstLine = (text) => String(text || "").split(/\n|(?<=\.) /)[0];
  const display = (symbol) => (symbol.kind === "class" ? `class ${symbol.name}` : symbol.kind === "definition" ? "defineModule({…})"
    : symbol.kind === "object" ? `${symbol.name} = {…}` : `${symbol.name}()`);
  const levelsOf = (end) => [...new Set(Object.values(modules).filter((module) => module.end === end).map((module) => module.level))].sort((a, b) => b - a);
  const inLevel = (end, level) => Object.keys(modules).filter((folder) => modules[folder].end === end && modules[folder].level === level)
    .sort((a, b) => modules[a].name.localeCompare(modules[b].name));
  const sizeOf = (folder) => filesUnder(folder).reduce((sum, path) => sum + (files[path].language === "json" ? 0 : files[path].lines), 0);

  // ---- charts: what each level shows (diagram.js lays them out and draws them) -----------------------------
  const { Chart } = window.Diagram;
  const once = () => { const seen = new Set(); return (key) => (seen.has(key) ? false : (seen.add(key), true)); };
  const KIND = { browser: "module", server: "server", extension: "extension" };
  const symbolNode = (chart, path, symbol, current = "") => chart.node(display(symbol), {
    kind: symbol.kind, target: link(path, symbol.id), current: symbol.id === current, tip: firstLine(symbol.doc),
    sub: symbol.kind === "class" ? plural(childrenOf(path, symbol.id).length, "method") : "" });
  const moduleNode = (chart, folder) => {
    const module = modules[folder];
    const sub = module.end === "extension" ? (module.fileTypes.length ? module.fileTypes.map((type) => type.extensions.join(" ")).join(" · ") : "extension")
      : module.twin ? "both ends" : `${module.end} only`;
    return chart.node(module.name, { kind: KIND[module.end], target: link(folder), tip: firstLine(module.about), sub });
  };
  const partNode = (chart, id, kind) => {
    const part = A.parts.find((item) => item.id === id);
    return chart.node(part.label, { kind, sub: part.note, target: link(part.target), tip: firstLine(files[part.target]?.doc) });
  };

  // The whole system: each end's modules by level, stacked (calls go down; the kernel under them starts them, lowest
  // first), and what lies between the ends. A module's uses are drawn when it is hovered.
  function topChart() {
    const chart = new Chart("RIGHT", { overview: true });
    const boxes = {};
    const end = (key, title, folder, startId, kernelId, extensions) => chart.group(title, () => {
      const rows = [];
      if (extensions) {
        rows.push(chart.group("Level 6 · extensions/", () => extensions.forEach((item) => { boxes[item] = moduleNode(chart, item); }),
                              { kind: "extensions", pack: true, aspect: 5, target: link("extensions") }));
      }
      for (const level of levelsOf(key)) {
        rows.push(chart.group(`Level ${level}`, () => inLevel(key, level).forEach((item) => { boxes[item] = moduleNode(chart, item); }),
                              { kind: "level", pack: true, aspect: 12 }));
      }
      const kernel = partNode(chart, kernelId, "kernel");
      const start = partNode(chart, startId, "boot");
      rows.forEach((row, index) => chart.edge(row, rows[index + 1] || kernel, index + 1 < rows.length ? {} : { dashed: true, label: "started by" }));
      chart.edge(start, kernel, { label: "starts" });
    }, { kind: key, separate: true, direction: "DOWN", target: link(folder) });
    const extensions = Object.keys(modules).filter((folder) => modules[folder].end === "extension").sort((a, b) => modules[a].name.localeCompare(modules[b].name));
    const desktop = partNode(chart, "DESK", "desktop");
    const worker = partNode(chart, "SW", "worker");
    const protocol = partNode(chart, "PROTO", "contracts");
    const spec = partNode(chart, "SPEC", "spec");
    const browser = end("browser", "Browser · app/", "app", "MAIN", "BK", extensions);
    const server = end("server", "Server · server/stilo/", "server", "SRV", "SK");
    chart.edge(browser, server, { arrow: "both", label: "HTTP · the event stream" });
    chart.edge(desktop, browser, { dashed: true, label: "opens" });
    chart.edge(desktop, server, { dashed: true, label: "can run" });
    chart.edge(worker, browser, { dashed: true, label: "keeps offline" });
    chart.edge(protocol, browser, { dashed: true, label: "both read" });
    chart.edge(protocol, server, { dashed: true });
    chart.edge(spec, browser, { dashed: true, label: "both pass" });
    chart.edge(spec, server, { dashed: true });
    for (const folder of Object.keys(boxes)) {
      for (const used of usesOf(folder)) if (boxes[used]) chart.edge(boxes[folder], boxes[used], { quiet: true });
    }
    chart.group("Start here", () => {
      chart.node(GUIDES[GUIDE_EXTENSIONS], { kind: "guide", sub: "add a feature as an extension", target: link(GUIDE_EXTENSIONS) });
      chart.node(GUIDES[GUIDE_CHANGES], { kind: "guide", sub: "the project's rules, and this page", target: link(GUIDE_CHANGES) });
      for (const root of ["tools", "tests"].filter((item) => A.folders[item])) {
        chart.node(`${root}/`, { kind: "folder", sub: plural(filesUnder(root).length, "file"), target: link(root) });
      }
    }, { kind: "plain", pack: true });
    return chart;
  }

  // A module: its files by layer (index, service/, model/, adapters/...), which import which, and the modules it
  // reaches (dotted, one box each).
  function moduleChart(path) {
    const chart = new Chart("RIGHT");
    const ids = new Map();
    const layers = new Map();
    for (const file of filesUnder(path)) {
      const parts = file.slice(path.length + 1).split("/");
      const layer = parts.length > 1 ? parts[0] : "";
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer).push(file);
    }
    const fileNode = (file, base) => ids.set(file, chart.node(file.slice(base.length + 1), { kind: files[file].language === "json" ? "data" : "file",
      target: link(file), tip: firstLine(files[file].doc), sub: plural(files[file].lines, "line") }));
    const order = ["", "service", "model", "adapters"];
    const sorted = [...layers.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 9) - ((order.indexOf(b) + 1) || 9) || a.localeCompare(b));
    chart.group(`${path}/`, () => {
      for (const layer of sorted) {
        if (!layer) { layers.get(layer).forEach((file) => fileNode(file, path)); continue; }
        chart.group(`${layer}/`, () => layers.get(layer).forEach((file) => fileNode(file, `${path}/${layer}`)),
          { kind: "folder", target: link(`${path}/${layer}`) });
      }
    }, { kind: "frame" });
    const fresh = once();
    const outside = new Map();
    for (const file of filesUnder(path)) {
      for (const item of files[file].imports) {
        if (!item.path || !ids.has(file)) continue;
        if (ids.has(item.path)) {
          if (fresh(`${file}>${item.path}`)) chart.edge(ids.get(file), ids.get(item.path));
          continue;
        }
        const other = moduleOf(item.path) || item.path.split("/").slice(0, item.path.startsWith("app/") ? 2 : 1).join("/");
        if (!outside.has(other)) {
          outside.set(other, modules[other] ? chart.node(modules[other].name, { kind: "external", sub: `${modules[other].end} · level ${modules[other].level}`, target: link(other) })
            : chart.node(files[other] ? other : `${other}/`, { kind: "external", sub: "elsewhere", target: link(other) }));
        }
        if (fresh(`${file}>${other}`)) chart.edge(ids.get(file), outside.get(other), { dashed: true });
      }
    }
    return chart;
  }

  // A folder: its files and folders, and which import which. A big one (the tests) is packed in a grid, its imports
  // shown on hover only, so it lays out at once. current: a file of it to outline (a contract, a manifest).
  function folderChart(path, current = "") {
    const chart = new Chart("RIGHT");
    const big = A.folders[path].children.length > 40;
    const ids = new Map();
    const childOf = (file) => file.startsWith(`${path}/`) ? `${path}/${file.slice(path.length + 1).split("/")[0]}` : "";
    chart.group(`${path}/`, () => {
      for (const child of A.folders[path].children) {
        const short = child.split("/").pop();
        if (files[child]) {
          const items = files[child].symbols.filter((symbol) => !symbol.parent).length;
          ids.set(child, chart.node(short, { kind: files[child].language === "json" ? "data" : "file", target: link(child), tip: firstLine(files[child].doc), current: child === current,
                                             sub: files[child].language === "json" ? plural(files[child].lines, "line") : `${plural(items, "item")} · ${plural(files[child].lines, "line")}` }));
        } else if (modules[child]) {
          ids.set(child, moduleNode(chart, child));
        } else {
          ids.set(child, chart.node(`${short}/`, { kind: "folder", target: link(child), sub: plural(filesUnder(child).length, "file") }));
        }
      }
    }, { kind: "folder", pack: big, aspect: 1.6 });
    const outside = new Map();
    const fresh = once();
    for (const file of filesUnder(path)) {
      const from = ids.get(childOf(file));
      for (const item of files[file].imports) {
        if (!item.path) continue;
        const inside = childOf(item.path);
        if (inside) {
          const to = ids.get(inside);
          if (to && to !== from && fresh(`${from}>${to}`)) chart.edge(from, to, { quiet: big });
        } else if (!big) {
          const key = moduleOf(item.path) || item.path.split("/")[0];
          if (!outside.has(key)) outside.set(key, chart.node(modules[key]?.name || (files[key] ? key : `${key}/`), { kind: "external", target: link(key), sub: "elsewhere" }));
          if (fresh(`${from}>${key}`)) chart.edge(from, outside.get(key), { dashed: true });
        }
      }
    }
    return chart;
  }

  function usesNodes(chart, path, pairs) {  // calls into other files: one box per file, dotted, shown on hover
    const nodes = new Map();
    const counts = new Map();
    for (const [, use] of pairs) counts.set(use.path, (counts.get(use.path) || 0) + 1);
    const kept = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key]) => key));
    const fresh = once();
    for (const [from, use] of pairs) {
      if (!kept.has(use.path) || use.path === path || !from) continue;
      if (!nodes.has(use.path)) nodes.set(use.path, chart.node(use.path.split("/").pop(), { kind: "external", sub: use.path, target: link(use.path) }));
      if (fresh(`${from}>${use.path}`)) chart.edge(from, nodes.get(use.path), { dashed: true });
    }
  }

  // A file: its functions, and each class, module definition or function with functions inside it as a box around
  // them (grouped by the function they are written in, or by a Python class's `# ---- name ----` comments).
  function fileChart(path, current = "") {
    const chart = new Chart("RIGHT", { compact: true });
    const ids = new Map();       // symbol id → its box (a container: its group)
    const container = new Map(); // inner id → the top-level symbol around it
    for (const symbol of files[path].symbols.filter((item) => !item.parent)) {
      const inner = childrenOf(path, symbol.id);
      if (!inner.length) { ids.set(symbol.id, symbolNode(chart, path, symbol, current)); continue; }
      const sections = new Map();
      for (const item of inner) {
        const key = item.section || "";
        if (!sections.has(key)) sections.set(key, []);
        sections.get(key).push(item);
      }
      const title = symbol.kind === "class" ? symbol.signature.replace(/:$/, "") : symbol.kind === "definition" ? `defineModule({ name: "${modules[moduleOf(path)]?.name ?? ""}" })` : display(symbol);
      ids.set(symbol.id, chart.group(title, () => {
        for (const [section, items] of sections) {
          const drawAll = () => items.forEach((item) => { ids.set(item.id, symbolNode(chart, path, item, current)); container.set(item.id, symbol.id); });
          if (!section) { drawAll(); continue; }
          chart.group(items[0].within ? `inside ${section}()` : section, drawAll, { kind: "section" });
        }
      }, { kind: symbol.kind === "class" ? "class" : "container", target: link(path, symbol.id), current: symbol.id === current, tip: firstLine(symbol.doc) }));
    }
    const fresh = once();
    const uses = [];
    for (const symbol of files[path].symbols.filter((item) => item.kind !== "class")) {
      const from = ids.get(symbol.id);
      for (const callee of symbol.calls || []) {
        const to = ids.get(callee);
        if (!to || to === from || container.get(callee) === symbol.id || container.get(symbol.id) === callee) continue;  // (never into its own box)
        if (fresh(`${from}>${to}`)) chart.edge(from, to);
      }
      for (const use of symbol.uses || []) uses.push([from, use]);
    }
    usesNodes(chart, path, uses);
    return chart;
  }

  // ---- the guides --------------------------------------------------------------------------------------------
  const fileLink = (path) => (files[path] ? link(path) : "");
  const symbolLink = (path, id) => (symbolOf.has(`${path}::${id}`) ? link(path, id) : fileLink(path));
  const extensions = () => Object.keys(modules).filter((folder) => modules[folder].end === "extension").sort((a, b) => sizeOf(a) - sizeOf(b));
  const withCode = () => extensions().filter((folder) => modules[folder].entry);

  function extensionsChart() {
    const chart = new Chart("DOWN", { overview: true });
    const example = withCode()[0];
    const folder = chart.group("Your extension: one folder in extensions/", () => {
      chart.node("extension.json", { kind: "data", sub: "name · about · api: 1 · browser · fileTypes · contributes",
                                     target: example ? fileLink(`${example}/extension.json`) : "" });
      chart.node("browser/index.js", { kind: "definition", sub: "export default defineModule({ name, level: 6, uses, start(ctx) })",
                                       target: example ? fileLink(modules[example].entry) : "" });
      chart.node("browser/adapters/ · model/ · its .css", { kind: "folder", sub: "the rest of its code, and libraries in vendor/" });
    }, { kind: "extensions", pack: true, aspect: 1 });
    const sync = chart.node("node tools/protocol-sync.mjs", { kind: "boot", sub: "writes the browser's copies: the modules to start, file types, offline files",
                                                            target: fileLink("tools/protocol-sync.mjs") });
    const kernel = chart.node("Kernel · startModules", { kind: "kernel", sub: "starts it on level 6, after every core module",
                                                        target: symbolLink("app/kernel/index.js", "startModules") });
    const server = chart.node("Server · File types", { kind: "server", sub: "reads the manifests' fileTypes too",
                                                       target: link(moduleNamed("server", "file_types") || "server") });
    const api = chart.group(`What start(ctx) may use: extension API v${A.extensionApi.version}`, () => {
      for (const [name, entry] of Object.entries(A.extensionApi.modules)) {
        const folder = moduleNamed("browser", name);
        chart.node(`ctx.use("${name}")`, { kind: "module", sub: `${entry.alias}: ${entry.members.slice(0, 4).join(", ")}${entry.members.length > 4 ? ", …" : ""}`,
                                           target: folder ? link(folder) : "" });
      }
    }, { kind: "level", pack: true, aspect: 2.4, target: fileLink("protocol/extension-api.json") });
    const test = chart.node("tests/extension-api.test.mjs", { kind: "check", sub: "holds every extension to the list", target: fileLink("tests/extension-api.test.mjs") });
    chart.edge(folder, sync, { label: "then run" });
    chart.edge(sync, kernel, { label: "app/extensions.js" });
    chart.edge(folder, server, { dashed: true, label: "fileTypes" });
    chart.edge(kernel, api, { label: "start(ctx)" });
    chart.edge(api, test, { dashed: true, label: "checked by" });
    return chart;
  }

  function changesChart() {
    const chart = new Chart("DOWN", { overview: true });
    const steps = [
      ["Find the owner", "the module that owns what changes · its level", "module", "#/app/modules"],
      ["Write it in its layer", "model/ rules · service/ state · adapters/ input and output", "folder", ""],
      ["Say what it is", "a file's opening comment · a comment above each function", "file", ""],
      ["Test it", "node --test tests/ · python tests · browser tests", "check", link("tests")],
      ["A version of its own", "node tools/release-version.mjs X.Y.Z · docs/ISSUES.md", "boot", fileLink("tools/release-version.mjs")],
      ["python3 tools/architecture.py", "this page, made again; commit data.js and source.js", "boot", fileLink("tools/architecture.py")],
    ];
    const nodes = steps.map(([title, sub, kind, target]) => chart.node(title, { kind, sub, target }));
    nodes.forEach((node, index) => chart.edge(nodes[index - 1], node));
    const rules = chart.node("The ten rules", { kind: "check", sub: "tests/structure/structure.test.mjs checks each one", target: fileLink("tests/structure/structure.test.mjs") });
    const page = chart.node("tests/architecture.test.py", { kind: "check", sub: "fails while this page is out of date", target: fileLink("tests/architecture.test.py") });
    chart.edge(rules, nodes[3], { dashed: true, label: "part of it" });
    chart.edge(page, nodes[5], { dashed: true, label: "checks it" });
    return chart;
  }

  const prose = (text) => {  // `code` in a guide's text, shown as code
    const node = make("div", "doc");
    String(text).split(/(`[^`]+`)/).forEach((part) => node.append(part.startsWith("`") && part.endsWith("`") ? make("code", "", part.slice(1, -1)) : part));
    return node;
  };

  function paneExtensions() {
    const pane = [...heading("Guide", GUIDES[GUIDE_EXTENSIONS])];
    pane.push(prose("New features come as extensions wherever they can. An extension is one folder under `extensions/<name>/`: " +
      "a manifest, and a browser module started on level 6, above every core module. It adds its feature through the " +
      "modules' extension points only, so deleting the folder (and running `node tools/protocol-sync.mjs`) leaves an app " +
      "that works without it. The boxes on the left open the real code; the full reference is docs/EXTENSIONS.md."));
    pane.push(make("h3", "", "The steps (docs/EXTENSIONS.md)"));
    const list = make("ol", "steps");
    for (const step of A.extensionSteps) list.append(listItem(step));
    pane.push(list);
    const details = [
      ["The manifest", "`extension.json`: `name` (the folder's), `about`, `api: 1`, `browser` (its module, `browser/index.js`; none for data only), " +
        "`fileTypes` (in the shape of `protocol/file-types.json`; both ends read them) and `contributes` (`settings`, `themes`)."],
      ["The module", "`export default defineModule({ name, level: 6, uses: [...], owns, start(ctx) })`. `ctx.use(name)` hands it a module " +
        "named in `uses`; `ctx.log(message)` writes to the app's log. It imports only `app/kernel/index.js` and modules' `index.js`, and of those " +
        "only what the extension API lists. It calls each module by its alias (`shell`, `types`, `workspace`, `editor`...), also in its adapters."],
      ["The rules it shares with the core", "Files under 800 lines; no catch that swallows an error without a word (`ignore(error, why)` from the kernel); " +
        "its own stylesheet, using the theme's tokens (`var(--accent)`, `var(--border)`). No code outside its folder may spell its name or its file types' ids."],
      ["Needing more", "Something the API does not list is a request to the core: add it to `protocol/extension-api.json` and docs/EXTENSIONS.md " +
        "(a new member is not a new version), with the module's own tests."],
    ];
    for (const [title, text] of details) pane.push(make("h3", "", title), prose(text));
    pane.push(make("h3", "", `What it may use (extension API v${A.extensionApi.version})`));
    for (const [name, entry] of Object.entries(A.extensionApi.modules)) {
      const folder = moduleNamed("browser", name);
      const row = make("div", "api-row");
      const anchor = make("a", "", entry.alias);
      if (folder) anchor.href = link(folder);
      row.append(anchor);
      const chips = make("div", "chips");
      for (const member of [...entry.members, ...entry.static.map((item) => `${item} (static)`)]) chips.append(make("span", "chip", member));
      row.append(chips);
      pane.push(row);
    }
    pane.push(make("h3", "", "Examples to copy, smallest first"));
    pane.push(linkList(extensions().map((folder) => [modules[folder].name, link(folder), `${plural(sizeOf(folder), "line")} · ${firstLine(modules[folder].about)}`])));
    const example = withCode()[0];
    if (example && files[modules[example].entry]) {
      const entry = modules[example].entry;
      pane.push(make("h3", "", `The smallest with code: ${entry}`), code(entry, 1, files[entry].lines));
    }
    pane.push(make("h3", "", "Read more"));
    pane.push(linkList([["Extensions: the API, version 1", github("docs/EXTENSIONS.md")], ["Architecture: the rules", github("docs/ARCHITECTURE.md")]]));
    return pane;
  }

  function paneChanges() {
    const pane = [...heading("Guide", GUIDES[GUIDE_CHANGES])];
    pane.push(prose("How code is added to Stilo Marker, and how this page stays true. This page is the project's reference: " +
      "every box on it is read from the code, so a change is documented by writing it well and making the page again."));
    const steps = [
      ["1. Find the owner", "Every piece of state, stored file, registry, network message and name belongs to one module (rule 4); " +
        "a module's pane here lists what it owns. Change it there. A module calls only the modules it lists in `uses`, all on " +
        "lower levels; news goes up as events or extension points. A new feature that can be an extension is one (the other guide)."],
      ["2. Write it in its layer", "Inside a module: `index.js` (`__init__.py` on the server) is its public API, and its opening comment " +
        "lists it; `model/` holds pure rules, `service/` its state and use cases, `adapters/` all input and output (the page, the network, " +
        "storage). A rule written in both languages lives in a `model/` on each end, with its cases in `spec/`."],
      ["3. Say what it is, where this page reads it", "A file starts with a comment (a docstring in Python) saying what it is and what it " +
        "offers; a function has a comment (a docstring) above it when its name does not say enough. They are this page's text: " +
        "the pane shows them beside the code."],
      ["4. Test it", "`node --test tests/`, the Python tests (`tests/*.test.py`) and the browser tests (`tests/*-browser.py`); " +
        "tests/README.md lists what each covers. A fix comes with a test that fails without it."],
      ["5. A version of its own", "One version per change to the app: `node tools/release-version.mjs X.Y.Z` (it also renames the " +
        "service worker's cache, so browsers fetch the new files) and an entry in docs/ISSUES.md saying what was wrong and what " +
        "changed. A change to the docs alone takes no version; its commit starts with `docs:`."],
      ["6. Make this page again, last", "`python3 tools/architecture.py`, and commit `docs/architecture/data.js` and `source.js` with " +
        "the change (after the version: the version is in the code). `tests/architecture.test.py` fails while they are out of date. " +
        "When the shape changes (a new box on the top map, a new step here), change `PARTS` in `tools/architecture.py` or the guides " +
        "in `docs/architecture/app.js` in the same commit."],
    ];
    for (const [title, text] of steps) pane.push(make("h3", "", title), prose(text));
    pane.push(make("h3", "", "The ten rules (docs/ARCHITECTURE.md; tests/structure checks each)"));
    const list = make("ol", "steps");
    for (const rule of A.rules) list.append(listItem(rule));
    pane.push(list);
    pane.push(make("h3", "", "Read more"));
    pane.push(linkList([["Architecture: the shape and the rules", github("docs/ARCHITECTURE.md")], ["The tests and what each covers", github("tests/README.md")],
                        ["Known issues and every version's changes", github("docs/ISSUES.md")], ["This page: how it is made", github("docs/architecture/README.md")]]));
    return pane;
  }

  const listItem = (text) => {
    const item = make("li");
    item.append(...prose(text).childNodes);
    return item;
  };

  // ---- drawing, with zoom controls -------------------------------------------------------------------------
  let view = null;
  async function draw(chart) {
    const holder = $("#chart");
    holder.replaceChildren(make("div", "chart-wait", "Laying out…"));
    $("#zoom").hidden = true;
    try {
      const drawn = await window.Diagram.draw(holder, chart, {
        onGo: (target) => { location.hash = target; },
        onZoom: (scale) => { $("#zoom-level").textContent = `${Math.round(scale * 100)}%`; },
      });
      if (!drawn) return;  // a newer chart was asked for meanwhile
      view = drawn;
      $("#zoom").hidden = false;
    } catch (error) {
      holder.replaceChildren(make("div", "chart-wait", /load/.test(String(error?.message))
        ? "The diagrams need their layout library (ELK), loaded from the internet, and it could not be reached. The details on the right still work."
        : `This diagram could not be drawn: ${error?.message || error}`));
    }
  }
  $("#zoom-in").addEventListener("click", () => view?.zoomBy(1.25));
  $("#zoom-out").addEventListener("click", () => view?.zoomBy(0.8));
  $("#zoom-fit").addEventListener("click", () => view?.fit(1.5));
  $("#zoom-level").addEventListener("click", () => view?.zoomBy(1 / (view?.scale || 1)));  // back to 100%

  // ---- the pane on the right ------------------------------------------------------------------------------
  const linkList = (items) => {
    const list = make("ul", "links");
    for (const [label, href, note] of items) {
      const item = make("li");
      const anchor = make("a", "", label);
      anchor.href = href;
      if (/^https?:/.test(href)) { anchor.target = "_blank"; anchor.rel = "noopener"; }
      if (note) anchor.append(make("small", "", note));
      item.append(anchor);
      list.append(item);
    }
    return list;
  };
  const heading = (kind, title) => [make("span", "kind", kind), make("h2", "", title)];
  // A comment as written was wrapped by hand: a line joins the one before it when that one ran long (it was wrapped)
  // and this one is plain prose; an indented or listed line, or one after a short line, starts a new line.
  const reflow = (text) => String(text).split("\n").reduce((out, line, index, lines) => {
    const before = lines[index - 1];
    const joins = index > 0 && before.trim() && line.trim() && before.length >= 60 && !/^\s|^[-*•|]|^\d+\. /.test(line);
    return index === 0 ? line : `${out}${joins ? " " : "\n"}${joins ? line.trim() : line}`;
  }, "");
  const doc = (text, path = "") => text ? make("div", "doc", reflow(text))
    : make("p", "meta", files[path]?.language === "python" ? "No docstring." : "No comment says what it is.");
  const source = (path, start, end, label = "View on GitHub") => {
    const anchor = make("a", "", label);
    anchor.href = github(path, start, end);
    anchor.target = "_blank";
    anchor.rel = "noopener";
    return anchor;
  };

  // The code's colours: one pattern per language, each group a kind of token.
  const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const SYNTAX = {
    python: [/("""[\s\S]*?"""|'''[\s\S]*?'''|\b[rbfuRBFU]{0,2}"(?:\\.|[^"\\\n])*"|\b[rbfuRBFU]{0,2}'(?:\\.|[^'\\\n])*')|(#[^\n]*)|(@[\w.]+)|\b(def|class)(\s+)(\w+)|\b(False|None|True|and|as|assert|async|await|break|continue|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|self|cls)\b|\b(\d+(?:\.\d+)?)\b/g,
             ["str", "com", "dec", "def", "kw", "num"]],
    javascript: [/(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(@[\w.]+)|\b(function\*?|class)(\s+)([\w$]+)|\b(async|await|break|case|catch|const|continue|default|delete|do|else|export|extends|false|finally|for|from|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield|function|class)\b|\b(\d+(?:\.\d+)?)\b/g,
                 ["str", "com", "dec", "def", "kw", "num"]],
    json: [/("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?)\b/g, ["key"]],
  };
  function highlight(text, language) {
    const [pattern] = SYNTAX[language] || SYNTAX.javascript;
    let html = "", last = 0, match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text))) {
      html += escapeHtml(text.slice(last, match.index));
      if (language === "json") {
        if (match[1]) html += `<span class="${match[2] ? "def" : "str"}">${escapeHtml(match[1])}</span>${match[2] || ""}`;
        else if (match[3]) html += `<span class="kw">${match[3]}</span>`;
        else html += `<span class="num">${match[4]}</span>`;
      } else if (match[1]) html += `<span class="str">${escapeHtml(match[1])}</span>`;
      else if (match[2]) html += `<span class="com">${escapeHtml(match[2])}</span>`;
      else if (match[3]) html += `<span class="dec">${escapeHtml(match[3])}</span>`;
      else if (match[4]) html += `<span class="kw">${match[4]}</span>${match[5]}<span class="def">${escapeHtml(match[6])}</span>`;
      else if (match[7]) html += `<span class="kw">${match[7]}</span>`;
      else html += `<span class="num">${match[8]}</span>`;
      last = pattern.lastIndex;
    }
    return html + escapeHtml(text.slice(last));
  }

  // Every file's text is in source.js, loaded the first time code is shown.
  let sourceReady = null;
  function loadSource() {
    if (window.ARCH_SOURCE) return Promise.resolve(window.ARCH_SOURCE);
    sourceReady ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "source.js";
      script.onload = () => (window.ARCH_SOURCE ? resolve(window.ARCH_SOURCE) : reject(new Error("source.js held no code")));
      script.onerror = () => { sourceReady = null; script.remove(); reject(new Error("source.js could not be loaded")); };
      document.head.append(script);
    });
    return sourceReady;
  }
  function code(path, start, end) {
    const block = make("div", "code");
    const fill = (all) => {
      const lines = String(all[path] ?? "").split("\n").slice(start - 1, end);
      const numbers = make("pre", "gutter", lines.map((_, index) => start + index).join("\n"));
      const body = make("pre", "source");
      const inner = make("code");
      inner.innerHTML = highlight(lines.join("\n"), files[path]?.language);  // escaped above: only our own spans are HTML
      body.append(inner);
      block.replaceChildren(numbers, body);
    };
    if (window.ARCH_SOURCE) fill(window.ARCH_SOURCE);
    else {
      block.append(make("pre", "source", "Loading the code…"));
      loadSource().then(fill, (error) => block.replaceChildren(make("pre", "source", `${error.message}; the code is on GitHub (the link above).`)));
    }
    return block;
  }
  const counts = () => {
    const all = Object.values(files).filter((file) => file.language !== "json");
    const symbols = all.flatMap((file) => file.symbols);
    return `${plural(all.length, "file")} of code · ${plural(symbols.filter((item) => item.kind === "class").length, "class")} · ` +
      `${plural(symbols.filter((item) => item.kind !== "class").length, "function")} · ${plural(all.reduce((sum, file) => sum + file.lines, 0), "line")}`;
  };
  const moduleList = (end) => {
    const items = [];
    for (const level of levelsOf(end)) for (const folder of inLevel(end, level)) items.push([modules[folder].name, link(folder), `level ${level} · ${firstLine(modules[folder].about).slice(0, 80)}`]);
    return linkList(items);
  };

  function paneTop() {
    const pane = [...heading("Architecture", "Stilo Marker")];
    pane.push(make("div", "doc", "A Markdown workspace for writing, alone or together: a browser app and a Python server, each a " +
      "tiny kernel that starts modules in one-way levels, and extensions above the browser's modules. Every box here is a " +
      "real module, folder, file or function, read from the code by tools/architecture.py. Click a box (or search above) " +
      "to go deeper: the system, a module (its files by layer), a file (the functions inside each function drawn inside it), " +
      "and one function, whose code shows here. Hover a module to see the modules it uses."));
    pane.push(make("p", "meta", counts()));
    pane.push(make("h3", "", "Read first"));
    pane.push(linkList([[GUIDES[GUIDE_EXTENSIONS], link(GUIDE_EXTENSIONS), "add a feature without touching the core"],
                        [GUIDES[GUIDE_CHANGES], link(GUIDE_CHANGES), "the project's rules, and keeping this page true"],
                        ["Architecture: the shape and the ten rules", github("docs/ARCHITECTURE.md")],
                        ["Extensions: the API, version 1", github("docs/EXTENSIONS.md")]]));
    pane.push(make("h3", "", "Browser modules (app/modules/)"), moduleList("browser"));
    pane.push(make("h3", "", "Server modules (server/stilo/modules/)"), moduleList("server"));
    pane.push(make("h3", "", "Extensions (extensions/)"), linkList(extensions().map((folder) => [modules[folder].name, link(folder), firstLine(modules[folder].about).slice(0, 90)])));
    return pane;
  }

  function paneModule(path) {
    const module = modules[path];
    const pane = [...heading(`${END[module.end]} · level ${module.level}`, module.name)];
    if (module.about) pane.push(make("div", "doc", reflow(module.about)));
    const chips = make("div", "chips");
    chips.append(make("span", "chip", `${path}/`));
    if (module.end === "extension" && module.api) chips.append(make("span", "chip", `extension API v${module.api}`));
    pane.push(chips);
    const facts = [];
    if (module.twin) facts.push([`Its other half: ${modules[module.twin].name} (${modules[module.twin].end})`, link(module.twin), modules[module.twin].twin ? "the same name on the other end" : ""]);
    if (module.contract) facts.push([`Its network messages: ${module.contract}`, link(module.contract), "routes, operations, events and their version"]);
    if (module.entry) facts.push([`Its browser module: ${module.entry}`, link(module.entry)]);
    const definition = module.end === "server" ? `${path}/module.json` : module.end === "extension" ? `${path}/extension.json` : `${path}/index.js`;
    if (files[definition]) facts.push([`Its definition: ${definition.split("/").pop()}`, module.end === "browser" ? symbolLink(definition, "defineModule") : link(definition)]);
    if (facts.length) pane.push(linkList(facts));
    if (module.fileTypes?.length) {
      pane.push(make("h3", "", "File types it adds"));
      const types = make("div", "chips");
      for (const type of module.fileTypes) types.append(make("span", "chip", `${type.label} (${type.extensions.join(" ")})`));
      pane.push(types);
    }
    if (module.contributes?.length) pane.push(make("h3", "", "Contributes"), make("p", "doc", module.contributes.join(", ")));
    const uses = usesOf(path);
    if (uses.length) pane.push(make("h3", "", "Uses (lower levels only)"), linkList(uses.map((folder) => [modules[folder].name, link(folder), `level ${modules[folder].level}`])));
    const users = usedBy(path);
    if (users.length) pane.push(make("h3", "", "Used by"), linkList(users.map((folder) => [modules[folder].name, link(folder), `${modules[folder].end} · level ${modules[folder].level}`])));
    for (const [key, items] of Object.entries(module.owns || {})) {
      if (!Array.isArray(items) || !items.length) continue;
      pane.push(make("h3", "", `Owns: ${key}`));
      const owned = make("div", "chips");
      for (const item of items) owned.append(make("span", "chip", item));
      pane.push(owned);
    }
    pane.push(make("h3", "", "Contents"));
    pane.push(linkList(filesUnder(path).map((child) => [child.slice(path.length + 1), link(child), firstLine(files[child].doc).slice(0, 90)])));
    pane.push(source(path, 0, 0, "Folder on GitHub"));
    pane.at(-1).href = `${A.repo}/tree/${A.branch}/${path}`;
    return pane;
  }

  function paneFolder(path) {
    const pane = [...heading("Folder", `${path}/`)];
    if (A.folders[path].readme) pane.push(make("div", "doc", reflow(A.folders[path].readme)));
    const folderLink = source(path, 0, 0, "Folder on GitHub");
    folderLink.href = `${A.repo}/tree/${A.branch}/${path}`;
    pane.push(folderLink, make("h3", "", "Contents"));
    pane.push(linkList(A.folders[path].children.map((child) => files[child]
      ? [child.split("/").pop(), link(child), firstLine(files[child].doc).slice(0, 90)]
      : [`${child.split("/").pop()}/`, link(child), modules[child] ? firstLine(modules[child].about).slice(0, 90) : plural(filesUnder(child).length, "file")])));
    return pane;
  }

  function paneFile(path) {
    const file = files[path];
    const pane = [...heading("File", path), make("p", "meta", plural(file.lines, "line")), source(path), doc(file.doc, path)];
    const owner = moduleOf(path);
    if (owner && owner !== path) pane.push(linkList([[`In the ${modules[owner].name} module (${modules[owner].end}, level ${modules[owner].level})`, link(owner)]]));
    if (file.language === "json") {
      pane.push(make("h3", "", "The file"), code(path, 1, file.lines));
      return pane;
    }
    const own = file.imports.filter((item) => item.path);
    if (own.length) pane.push(make("h3", "", "Imports from this repository"), linkList(own.map((item) => [item.path, link(item.path), item.module])));
    const other = file.imports.filter((item) => !item.path).map((item) => item.module);
    if (other.length) {
      const chips = make("div", "chips");
      for (const name of other) chips.append(make("span", "chip", name));
      pane.push(make("h3", "", "Other imports"), chips);
    }
    const importers = Object.keys(files).filter((other) => files[other].imports.some((item) => item.path === path));
    if (importers.length) pane.push(make("h3", "", "Imported by"), linkList(importers.map((other) => [other, link(other)])));
    const top = file.symbols.filter((symbol) => !symbol.parent);
    if (top.length) {
      pane.push(make("h3", "", "Classes and functions"));
      pane.push(linkList(top.map((symbol) => [display(symbol), link(path, symbol.id),
        childrenOf(path, symbol.id).length ? plural(childrenOf(path, symbol.id).length, "function") + " inside" : firstLine(symbol.doc).slice(0, 70)])));
    }
    return pane;
  }

  function paneContainer(path, symbol) {
    const inner = childrenOf(path, symbol.id);
    const kind = { class: "Class", definition: "Module definition", object: "Object" }[symbol.kind] || "Function";
    const pane = [...heading(kind, display(symbol)), make("div", "signature", symbol.signature),
                  make("p", "meta", `${path} · lines ${symbol.line}–${symbol.end}`), source(path, symbol.line, symbol.end), doc(symbol.doc, path)];
    const groups = new Map();
    for (const item of inner) {
      const key = item.section ? (item.within ? `Inside ${item.section}()` : item.section) : symbol.kind === "class" ? "Methods" : "Inside it";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [title, items] of groups) {
      pane.push(make("h3", "", title));
      pane.push(linkList(items.map((item) => [`${item.name}()`, link(path, item.id), firstLine(item.doc).slice(0, 70)])));
    }
    if (symbol.kind !== "class") pane.push(...callLists(path, symbol));
    const firstInner = inner[0]?.line;
    const headEnd = Math.min(firstInner && firstInner > symbol.line ? firstInner - 1 : symbol.end, symbol.line + 80);
    pane.push(make("h3", "", inner.length ? "Its code, up to the first function inside it" : "Code"), code(path, symbol.line, headEnd));
    return pane;
  }

  function callLists(path, symbol) {
    const out = [];
    const named = (id) => { const target = symbolOf.get(`${path}::${id}`); return [target ? display(target) : `${id}()`, link(path, id)]; };
    if (symbol.calls?.length) out.push(make("h3", "", "Calls, in this file"), linkList(symbol.calls.map(named)));
    const callers = calledBy.get(`${path}::${symbol.id}`) || [];
    if (callers.length) out.push(make("h3", "", "Called by, in this file"), linkList(callers.map(named)));
    if (symbol.uses?.length) {
      out.push(make("h3", "", "Uses from other files"));
      out.push(linkList(symbol.uses.map((use) => [use.name, symbolOf.has(`${use.path}::${use.name}`) ? link(use.path, use.name) : link(use.path), use.path])));
    }
    return out;
  }

  function paneFunction(path, symbol) {
    const where = symbol.parent ? `${symbol.parent}${symbol.section && symbol.within ? ` › ${symbol.section}` : ""} › ${symbol.name}` : symbol.id;
    const pane = [...heading(symbol.kind === "method" ? "Method" : "Function", where), make("div", "signature", symbol.signature),
                  make("p", "meta", `${path} · lines ${symbol.line}–${symbol.end}`), source(path, symbol.line, symbol.end)];
    if (symbol.decorators?.length) {
      const chips = make("div", "chips");
      for (const name of symbol.decorators) chips.append(make("span", "chip", `@${name}`));
      pane.push(chips);
    }
    pane.push(doc(symbol.doc, path), ...callLists(path, symbol), make("h3", "", "Code"), code(path, symbol.line, symbol.end));
    return pane;
  }

  // ---- where you are --------------------------------------------------------------------------------------
  function crumbs(path, symbol) {
    const items = [["Architecture", "#/"]];
    if (GUIDES[path]) items.push([GUIDES[path], link(path)]);
    const parts = path && !GUIDES[path] ? path.split("/") : [];
    parts.forEach((part, index) => items.push([part, link(parts.slice(0, index + 1).join("/"))]));
    if (symbol?.parent) items.push([symbol.parent, link(path, symbol.parent)]);
    if (symbol) items.push([symbol.name, link(path, symbol.id)]);
    const nav = $("#crumbs");
    nav.replaceChildren();
    items.forEach(([label, href], index) => {
      if (index) nav.append(make("span", "sep", "›"));
      if (index === items.length - 1) nav.append(make("span", "here", label));
      else { const anchor = make("a", "", label); anchor.href = href; nav.append(anchor); }
    });
  }

  function show() {
    const { path, symbol: name } = route();
    hideResults();
    let chart, pane, title, hint, symbol = null;
    if (!path) {
      [chart, pane, title, hint] = [topChart(), paneTop(), "The whole system",
                                    "Each end's modules by level, lowest at the bottom; what lies between the ends. Hover a module for the modules it uses; click a box to go in."];
    } else if (path === GUIDE_EXTENSIONS) {
      [chart, pane, title, hint] = [extensionsChart(), paneExtensions(), GUIDES[path], "From one folder to a running module. Click a box for the real code; the steps are on the right."];
    } else if (path === GUIDE_CHANGES) {
      [chart, pane, title, hint] = [changesChart(), paneChanges(), GUIDES[path], "From finding the owner to a version of its own. The steps and the rules are on the right."];
    } else if (files[path]) {
      symbol = name ? symbolOf.get(`${path}::${name}`) || null : null;
      const where = path.split("/").pop();
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      chart = files[path].language === "json" && A.folders[folder] ? folderChart(folder, path) : fileChart(path, symbol?.id || "");
      if (symbol && (symbol.kind === "class" || childrenOf(path, symbol.id).length)) {
        [pane, title, hint] = [paneContainer(path, symbol), display(symbol), `In ${where}, outlined; what is inside it is drawn inside it.`];
      } else if (symbol) {
        [pane, title, hint] = [paneFunction(path, symbol), display(symbol), `In ${where}, outlined; its code is on the right.`];
      } else {
        [pane, title, hint] = [paneFile(path), where, files[path].language === "json" ? "Data, not code: its text is on the right; the chart shows its folder."
                               : "Its functions, each with the functions written inside it drawn inside it; arrows: who calls whom. Hover a box for its calls into other files."];
      }
    } else if (modules[path]) {
      [chart, pane, title, hint] = [moduleChart(path), paneModule(path), modules[path].name,
                                    "Its files by layer, and which import which (dotted: the other modules it reaches). Click a file to go in."];
    } else if (A.folders[path]) {
      [chart, pane, title, hint] = [folderChart(path), paneFolder(path), `${path}/`,
                                    "Its files and folders, and which import which (dotted: imports from elsewhere). Click one to go in."];
    } else {
      [chart, pane, title, hint] = [topChart(), [...heading("Not found", path), make("p", "meta", "Nothing here by that name; the chart shows the whole system.")],
                                    "Not found", ""];
    }
    $("#chart-title").textContent = title;
    $("#chart-hint").textContent = hint;
    document.title = `${title} · Stilo Marker architecture`;
    crumbs(path, symbol);
    $("#pane").replaceChildren(...pane);
    $("#pane").scrollTop = 0;
    draw(chart);
  }

  // ---- search -----------------------------------------------------------------------------------------------
  const entries = [
    { label: GUIDES[GUIDE_EXTENSIONS], where: "guide: adding an extension, a mod, a plugin", href: link(GUIDE_EXTENSIONS), key: "how an extension goes in mod plugin module guide" },
    { label: GUIDES[GUIDE_CHANGES], where: "guide: the project's rules, tests, versions, this page", href: link(GUIDE_CHANGES), key: "how a change goes in rules guideline contribute version" },
    ...Object.keys(modules).map((folder) => ({ label: modules[folder].name, where: `${END[modules[folder].end]} · ${folder}`, href: link(folder), key: `${modules[folder].name} ${folder}`.toLowerCase() })),
    ...Object.keys(A.folders).filter((path) => !modules[path]).map((path) => ({ label: `${path.split("/").pop()}/`, where: path, href: link(path), key: path.toLowerCase() })),
    ...Object.keys(files).map((path) => ({ label: path.split("/").pop(), where: path, href: link(path), key: path.toLowerCase() })),
    ...[...symbolOf.entries()].map(([key, symbol]) => ({ label: display(symbol), where: `${key.split("::")[0]}${symbol.parent ? ` · in ${symbol.parent}` : ""}`,
                                                         href: link(key.split("::")[0], symbol.id), key: symbol.name.toLowerCase() })),
  ];
  const results = $("#results");
  let active = 0;
  function hideResults() { results.hidden = true; }
  function search() {
    const words = $("#search").value.trim().toLowerCase();
    if (!words) { hideResults(); return; }
    const found = entries.filter((entry) => entry.key.includes(words))
      .sort((a, b) => (b.key.startsWith(words) - a.key.startsWith(words)) || (b.key.endsWith(words) - a.key.endsWith(words)) || a.key.length - b.key.length).slice(0, 40);
    active = 0;
    results.replaceChildren(...found.map((entry, index) => {
      const item = make("li");
      const anchor = make("a", index === 0 ? "is-active" : "", entry.label);
      anchor.href = entry.href;
      anchor.append(make("small", "", entry.where));
      item.append(anchor);
      return item;
    }));
    if (!found.length) results.replaceChildren(make("li", "", "Nothing by that name."));
    results.hidden = false;
  }
  $("#search").addEventListener("input", search);
  $("#search").addEventListener("keydown", (event) => {
    const anchors = [...results.querySelectorAll("a")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!anchors.length) return;
      anchors[active]?.classList.remove("is-active");
      active = (active + (event.key === "ArrowDown" ? 1 : anchors.length - 1)) % anchors.length;
      anchors[active].classList.add("is-active");
      anchors[active].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && anchors[active]) {
      location.hash = anchors[active].getAttribute("href");
      $("#search").value = "";
    } else if (event.key === "Escape") {
      hideResults();
    }
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".search")) hideResults(); });

  // ---- start --------------------------------------------------------------------------------------------------
  window.addEventListener("hashchange", show);
  show();
})();
