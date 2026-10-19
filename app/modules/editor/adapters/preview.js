// The preview pane: a file shown as it reads, not as it is written. Markdown
// (links resolved inside the project, math typeset when present), images and
// plain mind-map trees are built in; other kinds of file add a preview to the
// `previews` extension point:
//   previews.add({ id, matches(file) -> bool, render(target, project, file, tools) -> { shouldTypeset, content },
//                  cacheable?: bool, printHtml?(project, file, tools) -> html,
//                  showOnOpen?: bool (opening the file shows it here too: a diagram's editor) })
// tools.markdownHtml(project, file, text) renders Markdown with the project's
// link and image resolution; tools.part is the id of the one part of the file
// to show (a file with parts, Workspace's `parts`), or null for all of it. A cacheable preview is a pure function of the
// file's text, the project's paths and the connection, so it is not rebuilt
// while none of those changed.
import { getNodeIdByPath, getPath, isImageFileName, isMarkdownFileName, isMtreeFileName } from "../../workspace/index.js";
import { renderMarkdown } from "../model/markdown.js";
import { ignore } from "../../../kernel/index.js";

export function createPreview(app, previews) {
  let mathJaxLoadPromise = null; // MathJax loads once, on the first formula
  function hasMathMarkup(value) {
    return /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$(?!\s)[^$\n]+\$/.test(value);
  }

  function ensureMathJax() {
    if (globalThis.MathJax?.typesetPromise) return Promise.resolve(globalThis.MathJax);
    if (mathJaxLoadPromise) return mathJaxLoadPromise;
    globalThis.MathJax = globalThis.MathJax ?? {
      tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] },
      svg: { fontCache: "global" },
      startup: { typeset: false }
    };
    mathJaxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
      script.async = true;
      script.onload = () => resolve(globalThis.MathJax);
      script.onerror = () => reject(new Error("MathJax failed to load."));
      document.head.append(script);
    });
    return mathJaxLoadPromise;
  }

  async function typesetPreview(content, target = app.elements.preview) {
    if (!hasMathMarkup(content)) return;
    try {
      const mathJax = await ensureMathJax();
      mathJax?.typesetClear?.([target]);
      if (mathJax?.typesetPromise) await mathJax.typesetPromise([target]);
    } catch (error) {
      ignore(error, "MathJax is unavailable; the preview shows the formulas as text");
    }
  }

  // Markdown with links and images resolved inside the project.
  function markdownHtml(project, file, text) {
    return renderMarkdown(text, {
      resolveUrl: (url) => app.resolveProjectAssetUrl(project, file.id, url),
      resolveLink(token) {
        const url = token.href;
        if (token.type === "image") return app.resolveProjectAssetUrl(project, file.id, url);
        if (/^(https?:\/\/|mailto:|data:|blob:)/i.test(url)) return { href: url, external: true };
        if (url.startsWith("#")) return { href: url, external: false };
        const baseSegments = getPath(project, file.id).split("/").filter(Boolean);
        baseSegments.pop();
        const nodeId = getNodeIdByPath(project, app.normalizePath([...baseSegments, url].join("/")));
        if (nodeId) return { href: "#", external: false, attributes: { "data-open-file-id": nodeId } };
        return { href: "#", external: false, attributes: { "data-unresolved-link": url } };
      }
    });
  }
  const tools = { markdownHtml };

  // The built-in previews, after any added ones (an added preview wins).
  const builtIn = [
    { id: "image", matches: (file) => isImageFileName(file.name), cacheable: false,
      render(target, project, file) {
        const frame = document.createElement("div");
        frame.className = "asset-preview";
        const image = document.createElement("img");
        image.src = app.imageSrcFor(project, file);
        image.alt = file.name;
        frame.append(image);
        target.append(frame);
        return { shouldTypeset: false, content: "" };
      },
      printHtml: (project, file) => `<div class="asset-preview"><img src="${app.escapeHtmlAttribute(file.content)}" alt="${app.escapeHtmlAttribute(file.name)}"></div>` },
    { id: "mtree", matches: (file) => isMtreeFileName(file.name), cacheable: true,
      render(target, project, file) {
        target.innerHTML = `<pre><code>${app.escapeEditorHtml(file.content)}</code></pre>`;
        return { shouldTypeset: false, content: "" };
      },
      printHtml: (project, file) => `<pre><code>${app.escapeEditorHtml(file.content)}</code></pre>` },
    { id: "markdown", matches: () => true, cacheable: true,
      render(target, project, file) {
        target.innerHTML = markdownHtml(project, file, file.content);
        return { shouldTypeset: true, content: file.content };
      },
      printHtml: (project, file) => renderMarkdown(file.content, { resolveUrl: (url) => app.resolveProjectAssetUrl(project, file.id, url) }) }
  ];
  const previewFor = (file) => [...previews.all(), ...builtIn].find((entry) => entry.matches(file));

  // Inputs of the last cacheable render. A 90k-character chapter is ~11k
  // nodes: rebuilding it for a presence ping, a collaborator's keystroke or
  // typing in another file used to re-lay-out the whole preview. Any other
  // kind of preview clears the key, so returning to a file renders it again.
  let previewRenderKey = null;

  function previewRenderKeyFor(project, file) {
    const structure = Object.values(project.nodes).map((node) => `${node.id}/${node.parentId ?? ""}/${node.name}`).join("|");
    const where = app.workspace.location; // images' addresses depend on the connection
    return `${file.id}\u0000${file.name}\u0000${where.shared()}\u0000${where.assetsKey()}\u0000${structure}\u0000${file.content}`;
  }

  function renderPreviewContent(target, project, file) {
    const preview = file ? previewFor(file) : null;
    const key = preview?.cacheable ? previewRenderKeyFor(project, file) : null;
    if (key !== null && key === previewRenderKey && target.childNodes.length > 0) return { shouldTypeset: false, content: "" };
    previewRenderKey = key;
    target.replaceChildren();
    if (!file) return { shouldTypeset: false, content: "" };
    return preview.render(target, project, file, { ...tools, part: app.view.get().previewFileId === file.id ? app.view.get().previewPart ?? null : null });
  }

  function printPreviewAsPdf() {
    const project = app.controller.getProject();
    const previewFile = app.view.get().previewFileId ? project.nodes[app.view.get().previewFileId] : null;
    if (!previewFile) {
      app.notify("Open a markdown or image file before exporting PDF.");
      return;
    }
    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    Object.assign(printFrame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", opacity: "0", pointerEvents: "none" });
    document.body.append(printFrame);
    const printWindow = printFrame.contentWindow;
    if (!printWindow) {
      printFrame.remove();
      app.notify("Unable to prepare PDF export in this browser.");
      return;
    }
    const preview = previewFor(previewFile);
    const previewHtml = preview.printHtml ? preview.printHtml(project, previewFile, tools) : app.elements.preview.innerHTML;
    const title = previewFile.name.replace(/\.md$/i, "") || "MDNotes";
    const includeMath = isMarkdownFileName(previewFile.name) && hasMathMarkup(previewFile.content);
    const cleanupPrintFrame = () => { globalThis.setTimeout(() => printFrame.remove(), 250); };
    printWindow.document.write(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body { font-family: "Segoe UI", sans-serif; margin: 32px; color: #1f1f1f; line-height: 1.6; }
        pre, code { font-family: "Cascadia Code", Consolas, monospace; }
        pre { padding: 12px; background: #f5f5f5; border: 1px solid #ddd; overflow: auto; }
        code { background: #f5f5f5; padding: 1px 4px; }
        blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #0e639c; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 6px 8px; border: 1px solid #ddd; }
        img { display: block; max-width: 100%; height: auto; }
        mjx-container { break-inside: avoid; page-break-inside: avoid; }
        mjx-container[jax="SVG"] { overflow: visible; }
        mjx-container[jax="SVG"] > svg { max-width: 100%; }
        @page { size: A4; margin: 14mm; }
      </style>
      ${includeMath ? '<script>window.MathJax={tex:{inlineMath:[["$","$"],["\\(","\\)"]],displayMath:[["$$","$$"],["\\[","\\]"]]},svg:{fontCache:"global"},startup:{typeset:false}};<\/script><script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"><\/script>' : ""}
    </head>
    <body>
      <main id="print-root">${previewHtml}</main>
    </body>
  </html>`);
    printWindow.document.close();
    const finalizePrint = () => {
      printWindow.addEventListener("afterprint", cleanupPrintFrame, { once: true });
      printWindow.focus();
      printWindow.print();
      globalThis.setTimeout(cleanupPrintFrame, 1500);
    };
    if (includeMath) {
      const waitForMath = () => {
        if (printWindow.MathJax?.typesetPromise) {
          printWindow.MathJax.typesetPromise([printWindow.document.getElementById("print-root")]).finally(finalizePrint);
          return;
        }
        printWindow.setTimeout(waitForMath, 120);
      };
      printWindow.setTimeout(waitForMath, 120);
      return;
    }
    printWindow.setTimeout(finalizePrint, 80);
  }

  return { printPreviewAsPdf, renderPreviewContent, typesetPreview };
}
