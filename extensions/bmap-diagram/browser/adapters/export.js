// Exporting a diagram as SVG, PNG or JPG (the Explorer's "Export As" for it).
import { downloadBlob, fileBaseName, fileTypeExtension, isBmapFileName } from "../../../../app/modules/workspace/index.js";
import { normalizeBmapAst, parseBmap } from "../model/bmap.js";

export function createDiagramExport(app) {
  /** Rasterize an SVG string to a PNG/JPG Blob. `background` (e.g. white) is
   *  painted first for opaque formats; omit it to keep PNG transparency. */
  function rasterizeSvgToBlob(svgString, { type, background = null, scale = 2 }) {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export produced no data."))),
            type,
            0.92
          );
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to render the diagram for export."));
      };
      image.src = url;
    });
  }

  /** Export a .bmap file as PNG (transparent), JPG (white background), or SVG. */
  async function exportBmapAs(nodeId, format) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId];
    if (!node || node.kind !== "file" || !isBmapFileName(node.name)) {
      app.notify(`Export As is only available for ${fileTypeExtension("bmap")} diagrams.`);
      return;
    }
    try {
      const ast = normalizeBmapAst(parseBmap(node.content ?? ""));
      if (!ast.nodes.length) {
        app.notify("This diagram has no nodes to export.");
        return;
      }
      const { renderBmapToSvg } = await app.loadBmapView();
      const svgString = renderBmapToSvg(ast);
      const baseName = fileBaseName(node.name);

      if (format === "svg") {
        downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), `${baseName}.svg`);
      } else if (format === "png") {
        const blob = await rasterizeSvgToBlob(svgString, { type: "image/png" });
        downloadBlob(blob, `${baseName}.png`);
      } else if (format === "jpg") {
        const blob = await rasterizeSvgToBlob(svgString, { type: "image/jpeg", background: "#ffffff" });
        downloadBlob(blob, `${baseName}.jpg`);
      }
      app.logDebug("action", "Bmap exported", `${node.name} → ${format}`);
    } catch (error) {
      app.notify(error instanceof Error ? error.message : String(error));
      app.logDebug("error", "Bmap export failed", error instanceof Error ? error.message : String(error));
    }
  }

  return exportBmapAs;
}
