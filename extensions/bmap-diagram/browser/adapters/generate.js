// Quick Generate: a diagram node's text (and the files it links to) sent to
// the server's agent, which writes a new Markdown file beside the diagram.
// One at a time.
import { sendGenerationRequest } from "../../../../app/modules/assistant/index.js";
import { suggestUniqueFileName } from "../../../../app/modules/explorer/index.js";
import { findChildByName, getPath } from "../../../../app/modules/workspace/index.js";

// A node's name as a file name: no path or reserved characters, at most 80 long.
export function generatedFileName(name) {
  const cleaned = String(name ?? "").trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || "generated";
}

export function createGenerate({ shell, workspace, identity, sync, editor, log }) {
  let inFlight = false;

  return async function quickGenerate(diagramFileId, request) {
    const subject = String(request?.subject ?? "").trim();
    if (!subject) {
      shell.notify("This node has no name or text to generate from. Add some content first.");
      log("action", "Quick Generate skipped", "node has no subject text");
      return;
    }
    if (inFlight) {
      log("action", "Quick Generate skipped", "another generation is already in flight");
      return;
    }
    // An empty address is the page's own origin (a same-origin proxy), which is valid.
    const serverUrl = shell.settings.serverUrl?.trim() || globalThis.location?.origin || "";
    if (!serverUrl) {
      shell.notify("Could not determine server URL. Set one in Settings to use Quick Generate.");
      log("action", "Quick Generate skipped", "no server URL");
      return;
    }
    const controller = workspace.project();
    const project = controller.getProject();
    const diagram = project.nodes[diagramFileId];
    if (!diagram || diagram.kind !== "file") return;
    const parentId = diagram.parentId ?? project.rootId;
    const parentPath = parentId === project.rootId ? "" : getPath(project, parentId);
    const fileName = suggestUniqueFileName(project, parentId, `${generatedFileName(request?.nodeName || request?.nodeId || "generated")}.md`);
    const contextFiles = Array.isArray(request?.contextFiles) ? request.contextFiles : [];

    inFlight = true;
    log("action", "Quick Generate started", `node="${request?.nodeName}" file="${fileName}" context=${contextFiles.length} scope=${shell.settings.bmapGenerateScope}`);
    log("request", "POST /api/generate", `subject=${subject.slice(0, 80)}${subject.length > 80 ? "…" : ""}`);
    try {
      const result = await sendGenerationRequest(serverUrl, {
        subject, contextFiles, bmapOverview: String(request?.bmapOverview ?? ""),
        projectName: project.name ?? "Workspace", accountToken: identity.token()
      });
      const content = String(result?.content ?? "").trim();
      log("response", "Quick Generate response received", `model=${result?.model ?? "?"} provider=${result?.provider ?? "?"} length=${content.length} chars`);
      if (!content) {
        shell.notify("Generation returned no content.");
        log("error", "Quick Generate empty response", "provider returned no content");
        return;
      }
      controller.createFile(parentId, fileName, content);
      void sync.publish({ type: "create-file", parentPath, name: fileName, content });
      log("action", "Quick Generate file created", fileName);
      const created = findChildByName(controller.getProject(), parentId, fileName);
      if (created?.kind === "file") editor.parts().openFileFromExplorer(created.id);
      shell.notify(`Generated: ${fileName}`);
      log("action", "Quick Generate complete", fileName);
    } catch (error) {
      shell.notify(error?.message ?? "Generation failed.");
      log("error", "Quick Generate failed", error?.message ?? String(error));
    } finally {
      inFlight = false;
    }
  };
}
