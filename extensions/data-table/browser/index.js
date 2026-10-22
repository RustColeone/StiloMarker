// Tables (.csv, .tsv), an extension. It uses only the core's public
// extension points:
//   Editor     a preview: the table editor (adapters/grid.js), shown when a
//              table opens; a print of its first rows; the source's column
//              colours (adapters/highlight.js)
//   Workspace  the one write path (an edit merges with others' typing) and
//              the project's changes (the grid shows the file as it is now)
//   Explorer   a new table's first content
//   Shell      what went wrong, said
// Its file type is declared in ../extension.json, and its styles are its own
// (table.css). Nothing in the core names it; remove this folder and the app
// runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { getPath } from "../../../app/modules/workspace/index.js";
import { createGrid } from "./adapters/grid.js";
import { highlightTableLine } from "./adapters/highlight.js";
import { delimiterFor, parseTable } from "./model/table.js";

const TYPE = "datatable";
const PRINT_ROWS = 5000;
const NEW_TABLE = "Column 1,Column 2,Column 3\n,,\n";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The first rows as an HTML table (Export PDF).
function printTable(file) {
  const table = parseTable(file.content ?? "", delimiterFor(file.name, file.content ?? ""));
  const rows = table.records.slice(0, PRINT_ROWS)
    .map((record) => `<tr>${record.fields.map((field) => `<td>${escape(field.value)}</td>`).join("")}</tr>`).join("");
  const more = table.records.length - PRINT_ROWS;
  return `<table>${rows}</table>${more > 0 ? `<p>… and ${more.toLocaleString("en-US")} more rows.</p>` : ""}`;
}

export default defineModule({
  name: "data-table",
  level: 6,
  uses: ["shell", "file-types", "workspace", "editor", "explorer"],
  owns: { names: ["the table editor"], data: ["extensions/data-table/extension.json"] },
  start(ctx) {
    const shell = ctx.use("shell"), types = ctx.use("file-types"), workspace = ctx.use("workspace");
    const editor = ctx.use("editor"), explorer = ctx.use("explorer");
    const isTable = (name) => types.is(name, TYPE);

    const read = (id) => {
      const node = workspace.project()?.getProject().nodes[id];
      return node?.kind === "file" ? (node.content ?? "") : null;
    };
    // The grid's edit, from the text it was made on: the text after (merged), or null (said).
    async function write(id, next, base) {
      const project = workspace.project().getProject();
      if (!project.nodes[id]) return null;
      try {
        return (await workspace.write(getPath(project, id), next, { base, source: "table" })).text;
      } catch (error) {
        shell.toast(workspace.isStale(error) ? "The table changed meanwhile where this edit was; nothing was changed." : error.message, { duration: 4000 });
        ctx.log(`table edit not written: ${error.message}`);
        return null;
      }
    }

    // A menu at the pointer ([label, action] items, null between groups).
    function menu(event, items, run) {
      document.querySelector(".datatable-menu")?.remove();
      const box = document.createElement("div");
      box.className = "explorer-context-menu datatable-menu";
      box.setAttribute("role", "menu");
      for (const item of items) {
        if (!item) {
          const line = document.createElement("div");
          line.className = "menu-separator";
          line.setAttribute("role", "separator");
          box.append(line);
          continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item[0];
        button.dataset.action = item[1];
        box.append(button);
      }
      const close = () => {
        box.remove();
        document.removeEventListener("mousedown", outside, true);
        document.removeEventListener("keydown", onKey, true);
      };
      const outside = (down) => { if (!box.contains(down.target)) close(); };
      const onKey = (key) => { if (key.key === "Escape") { key.stopPropagation(); close(); } };
      box.addEventListener("mousedown", (down) => down.preventDefault()); // the grid keeps the keyboard
      box.addEventListener("click", (click) => {
        const button = click.target.closest("[data-action]");
        if (!button) return;
        close();
        run(button.dataset.action);
      });
      document.body.append(box);
      const { innerWidth, innerHeight } = window;
      box.style.left = `${Math.min(event.clientX, innerWidth - box.offsetWidth - 4)}px`;
      box.style.top = `${Math.min(event.clientY, innerHeight - box.offsetHeight - 4)}px`;
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", onKey, true);
    }

    const grids = new Set();
    const seconds = new WeakMap(); // a group's second preview -> its own grid
    let main = null;
    const make = () => {
      const grid = createGrid({ write, read, menu });
      grids.add(grid);
      return grid;
    };
    editor.previews.add({
      id: TYPE, matches: (file) => isTable(file.name), cacheable: false,
      showOnOpen: true, // the table editor is how a table is used
      render(target, project, file, tools) {
        if (tools?.secondary && !seconds.has(target)) seconds.set(target, make());
        const grid = tools?.secondary ? seconds.get(target) : (main ??= make());
        target.append(grid.root);
        grid.show({ id: file.id, name: file.name }, file.content ?? "");
        return { shouldTypeset: false, content: "" };
      },
      printHtml: (project, file) => printTable(file)
    });
    // The file changed (typing in the source, someone else, an edit merged):
    // each grid in view shows it as it is now, once a frame.
    let pending = false;
    workspace.project()?.subscribe?.(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        for (const grid of grids) if (grid.root.isConnected) grid.sync();
      });
    });

    editor.highlighters.add({ id: TYPE, line: highlightTableLine });
    explorer.newFiles.add({ id: TYPE, content: () => NEW_TABLE });
    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./table.css", import.meta.url).href;
      document.head.append(style);
    }
    return { grids: () => [...grids] };
  }
});
