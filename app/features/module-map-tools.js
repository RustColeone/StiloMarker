// Module map tools: the dialog that turns a .mtree file into a Markdown module
// map section. Loaded the first time the dialog opens; the app passes in what
// it needs through `deps`.

import { buildModuleMapSection, replaceOrAppendModuleMap } from "../services/mtree-module-map-service.js";
import { query } from "../ui/dom.js";
import { builtinTypes } from "../modules/file-types/index.js";

export function createModuleMapTools(deps) {
  const {
    controller, getPath, getNode, findChildByName, notify, publishOperation,
    setActiveSourceFile, setPreviewFile, highlightMarkdownSource, renderMarkdown,
    typesetPreview, handleIndentKeydown
  } = deps;

  const el = {
    dialog: query("#mtree-tools-dialog"),
    sourceText: query("#mtree-source-text"),
    simplify: query("#mtree-simplify-input"),
    continuation: query("#mtree-continuation-input"),
    includeNavigation: query("#mtree-include-navigation-input"),
    includeModules: query("#mtree-include-modules-input"),
    includeParents: query("#mtree-include-parents-input"),
    includeChildren: query("#mtree-include-children-input"),
    includeDescriptions: query("#mtree-include-descriptions-input"),
    includeEmpty: query("#mtree-include-empty-input"),
    targetSelect: query("#mtree-target-file-select"),
    outputName: query("#mtree-output-name-input"),
    qualityText: query("#mtree-quality-text"),
    warningList: query("#mtree-warning-list"),
    outputHighlight: query("#mtree-output-highlight"),
    outputText: query("#mtree-output-text"),
    renderPreview: query("#mtree-render-preview"),
    createButton: query("#mtree-create-button"),
    keepButton: query("#mtree-keep-button"),
    undoButton: query("#mtree-undo-button")
  };

  const state = {
    sourceFileId: null,
    generatedSection: "",
    draftSection: "",
    warnings: [],
    quality: null,
    selectedTargetFileId: "__new__"
  };

  function defaultName(fileName) {
    const baseName = builtinTypes.baseName(fileName) || "module-map";
    return `${baseName}.module-map.md`;
  }

  function renderWarnings(warnings) {
    el.warningList.replaceChildren();
    if (warnings.length === 0) {
      const empty = document.createElement("span");
      empty.className = "subtle-label";
      empty.textContent = "No warnings.";
      el.warningList.append(empty);
      return;
    }
    warnings.forEach((warning) => {
      const row = document.createElement("div");
      row.className = "subtle-label";
      row.textContent = warning;
      el.warningList.append(row);
    });
  }

  function renderQuality(quality) {
    if (!quality) {
      el.qualityText.textContent = "No module map generated yet.";
      return;
    }
    const warningCount = quality.missingDescriptionModules.length + quality.recursionModules.length;
    const passedCount = Math.max(0, quality.totalModules - warningCount);
    el.qualityText.textContent = `${passedCount}/${quality.totalModules} modules passed checks.`;
  }

  function markdownTargets(project) {
    return Object.values(project.nodes)
      .filter((node) => node.kind === "file" && node.name.endsWith(".md"))
      .sort((left, right) => getPath(project, left.id).localeCompare(getPath(project, right.id)));
  }

  function populateTargetPicker(selectedFileId = "__new__") {
    const project = controller.getProject();
    const markdownFiles = markdownTargets(project);
    el.targetSelect.replaceChildren();
    const createNewOption = document.createElement("option");
    createNewOption.value = "__new__";
    createNewOption.textContent = "Create new markdown file";
    el.targetSelect.append(createNewOption);
    markdownFiles.forEach((file) => {
      const option = document.createElement("option");
      option.value = file.id;
      option.textContent = getPath(project, file.id);
      el.targetSelect.append(option);
    });
    const nextValue = markdownFiles.some((file) => file.id === selectedFileId) ? selectedFileId : "__new__";
    state.selectedTargetFileId = nextValue;
    el.targetSelect.value = nextValue;
    el.outputName.disabled = nextValue !== "__new__";
  }

  function syncViewportMetrics() {
    const scrollbarWidth = Math.max(0, el.outputText.offsetWidth - el.outputText.clientWidth);
    el.outputText.style.setProperty("--mtree-scrollbar-width", `${scrollbarWidth}px`);
  }

  function syncOutputScroll() {
    el.outputHighlight.style.transform = `translate(${-el.outputText.scrollLeft}px, ${-el.outputText.scrollTop}px)`;
  }

  function refreshDraftPresentation() {
    const draft = state.draftSection || "";
    syncViewportMetrics();
    el.outputHighlight.innerHTML = `${highlightMarkdownSource(draft)}<div class="editor-line"> </div>`;
    el.renderPreview.innerHTML = renderMarkdown(draft);
    void typesetPreview(draft, el.renderPreview);
    syncOutputScroll();
    el.keepButton.disabled = draft === state.generatedSection;
    el.undoButton.disabled = draft === state.generatedSection;
  }

  function renderDraft() {
    el.outputText.value = state.draftSection || "";
    refreshDraftPresentation();
  }

  function ensureOutputName(fileName) {
    const currentValue = el.outputName.value.trim();
    if (currentValue) {
      return currentValue.toLowerCase().endsWith(".md") ? currentValue : `${currentValue}.md`;
    }
    const suggested = defaultName(fileName);
    el.outputName.value = suggested;
    return suggested;
  }

  function generate() {
    const project = controller.getProject();
    const sourceFile = state.sourceFileId ? project.nodes[state.sourceFileId] : null;
    if (!sourceFile || sourceFile.kind !== "file" || !builtinTypes.is(sourceFile.name, "mtree")) {
      throw new Error(`Select a ${builtinTypes.extensionsOf("mtree")[0]} file before generating a module map.`);
    }
    const result = buildModuleMapSection(sourceFile.content, {
      simplify: el.simplify.checked,
      splitContinuationTrees: el.continuation.checked,
      includeNavigation: el.includeNavigation.checked,
      includeModules: el.includeModules.checked,
      includeParents: el.includeParents.checked,
      includeChildren: el.includeChildren.checked,
      includeDescriptions: el.includeDescriptions.checked,
      includeEmptySections: el.includeEmpty.checked
    });
    state.generatedSection = result.section;
    state.draftSection = result.section;
    state.warnings = result.warnings;
    state.quality = result.quality;
    renderWarnings(result.warnings);
    renderQuality(result.quality);
    renderDraft();
    ensureOutputName(sourceFile.name);
    return result;
  }

  function open(fileId) {
    const project = controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || !builtinTypes.is(file.name, "mtree")) {
      notify(`Module map tools are only available for ${builtinTypes.extensionsOf("mtree")[0]} files.`);
      return;
    }
    Object.assign(state, { sourceFileId: fileId, generatedSection: "", draftSection: "", warnings: [], quality: null, selectedTargetFileId: "__new__" });
    el.sourceText.textContent = `Generate a module map from ${getPath(project, fileId) || file.name}.`;
    el.outputName.value = defaultName(file.name);
    populateTargetPicker();
    renderWarnings([]);
    renderQuality(null);
    renderDraft();
    el.dialog.showModal();
    try {
      generate();
    } catch (error) {
      notify(error.message);
    }
  }

  function regenerate() {
    if (!el.dialog.open || !state.sourceFileId) return;
    try {
      generate();
    } catch (error) {
      notify(error.message);
    }
  }

  /** Write the draft into the chosen Markdown file (or a new one). */
  function write() {
    const project = controller.getProject();
    const sourceFile = state.sourceFileId ? project.nodes[state.sourceFileId] : null;
    if (!sourceFile || sourceFile.kind !== "file" || !builtinTypes.is(sourceFile.name, "mtree")) {
      notify("Module map source file is no longer available.");
      return;
    }
    if (!state.generatedSection) {
      try {
        generate();
      } catch (error) {
        notify(error.message);
        return;
      }
    }
    const draftSection = el.outputText.value;
    state.draftSection = draftSection;
    const parentId = getNode(project, sourceFile.id).parentId;
    const selectedTargetFileId = el.targetSelect.value;

    const updateTarget = (target, label) => {
      const nextContent = replaceOrAppendModuleMap(target.content, draftSection);
      controller.updateContent(target.id, nextContent);
      publishOperation({ type: "update-file", path: getPath(project, target.id), content: nextContent });
      setActiveSourceFile(target.id);
      setPreviewFile(target.id);
      el.dialog.close();
      notify(`Updated ${label} with the generated module map.`);
    };

    if (selectedTargetFileId !== "__new__") {
      const targetFile = project.nodes[selectedTargetFileId];
      if (!targetFile || targetFile.kind !== "file" || !targetFile.name.endsWith(".md")) {
        notify("Selected target markdown file is no longer available.");
        populateTargetPicker();
        return;
      }
      updateTarget(targetFile, targetFile.name);
      return;
    }

    const outputName = ensureOutputName(sourceFile.name);
    const sibling = findChildByName(project, parentId, outputName);
    if (sibling && sibling.kind !== "file") {
      notify(`Cannot write module map to ${outputName} because a folder already uses that name.`);
      return;
    }
    if (sibling && !sibling.name.endsWith(".md")) {
      notify("Module map output must be a .md file.");
      return;
    }
    if (sibling) {
      updateTarget(sibling, outputName);
      return;
    }

    controller.createFile(parentId, outputName, replaceOrAppendModuleMap("", draftSection));
    const nextProject = controller.getProject();
    const createdFile = findChildByName(nextProject, parentId, outputName);
    if (createdFile) {
      publishOperation({
        type: "create-file",
        parentPath: parentId === nextProject.rootId ? "" : getPath(nextProject, parentId),
        name: outputName,
        content: createdFile.content
      });
      setActiveSourceFile(createdFile.id);
      setPreviewFile(createdFile.id);
    }
    el.dialog.close();
    notify(`Created ${outputName} from ${sourceFile.name}.`);
  }

  el.targetSelect.addEventListener("change", (event) => {
    state.selectedTargetFileId = event.target.value;
    el.outputName.disabled = event.target.value !== "__new__";
  });
  el.outputText.addEventListener("input", (event) => {
    state.draftSection = event.target.value;
    refreshDraftPresentation();
  });
  el.outputText.addEventListener("scroll", syncOutputScroll);
  el.outputText.addEventListener("keydown", handleIndentKeydown);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      syncViewportMetrics();
      syncOutputScroll();
    }).observe(el.outputText);
  }
  el.keepButton.addEventListener("click", () => {
    state.generatedSection = state.draftSection;
    renderDraft();
  });
  el.undoButton.addEventListener("click", () => {
    state.draftSection = state.generatedSection;
    renderDraft();
  });
  el.createButton.addEventListener("click", write);
  [el.simplify, el.continuation, el.includeNavigation, el.includeModules,
    el.includeParents, el.includeChildren, el.includeDescriptions, el.includeEmpty]
    .forEach((input) => input.addEventListener("change", regenerate));

  return { open, write, isOpen: () => el.dialog.open, contains: (node) => el.dialog.contains(node) };
}
