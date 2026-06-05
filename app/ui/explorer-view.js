import { ROOT_ID, isUrlDbFileName, listVisibleNodes } from "../domain/project-model.js";

function getFileIconClass(node) {
  if (node.kind === "folder") {
    return node.expanded ? "is-folder-open" : "is-folder";
  }

  if (node.name.endsWith(".md")) {
    return "is-md";
  }

  if (node.name.endsWith(".mtree")) {
    return "is-mtree";
  }

  if (node.name.endsWith(".urldb")) {
    return "is-urldb";
  }

  if (node.name.endsWith(".bmap")) {
    return "is-bmap";
  }

  return "is-file";
}

function createExplorerView({ container, surface, contextMenu, onOpenFile, onOpenUrlDbEntry, onToggleFolder, onSelectNode, onAction, canPasteTarget, canPreviewFile, onDragNodeStart, onDragUrlDbEntryStart, getFilterMode, getAssetPreviewSrc, getUrlDbEntries, getSelectedTarget }) {
  let menuTarget = null;
  let currentProject = null;
  let activeMenuMode = null;
  const previewTooltip = document.createElement("div");
  previewTooltip.className = "explorer-image-tooltip";
  previewTooltip.hidden = true;
  document.body.append(previewTooltip);

  function hideMenu() {
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
    contextMenu.style.removeProperty("left");
    contextMenu.style.removeProperty("top");
    menuTarget = null;
    activeMenuMode = null;
  }

  function hidePreviewTooltip() {
    previewTooltip.hidden = true;
    previewTooltip.replaceChildren();
  }

  function nodeMatchesFilter(node, mode) {
    if (mode === "all") {
      return true;
    }
    if (node.kind === "folder") {
      return node.children.some((childId) => {
        const child = currentProject?.nodes?.[childId];
        return child ? nodeMatchesFilter(child, mode) : false;
      });
    }

    if (mode === "notes") {
      return node.name.endsWith(".md");
    }
    if (mode === "mtree") {
      return node.name.endsWith(".mtree");
    }
    if (mode === "images") {
      return /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(node.name) || isUrlDbFileName(node.name);
    }

    return true;
  }

  function getMenuEntries(node, mode = "default", target = null) {
    const pasteEnabled = canPasteTarget?.(target) === true;
    if (target?.entryId) {
      const entries = [
        ["Copy", "copy"],
        ["Rename", "rename-entry"],
        ["Delete", "delete-entry"]
      ];
      if (pasteEnabled) {
        entries.splice(1, 0, ["Paste", "paste"]);
      }
      return entries;
    }

    const createEntries = [
      ["New Folder", "new-folder"],
      ["New Markdown", "new-md"],
      ["New MTREE", "new-mtree"],
      ["New URL Album", "new-urldb"],
      ["New Diagram", "new-bmap"],
      ["Add File", "add-file"]
    ];

    if (mode === "quick-add") {
      return createEntries;
    }

    if (!node || node.id === ROOT_ID || node.kind === "folder") {
      const entries = [];
      if (node && node.id !== ROOT_ID) {
        entries.push(["Copy", "copy"]);
      }
      if (pasteEnabled) {
        entries.push(["Paste", "paste"]);
      }
      entries.push(...createEntries);
      if (node && node.id !== ROOT_ID) {
        entries.push(["Rename", "rename"]);
        entries.push(["Delete", "delete"]);
      }
      entries.push(["Export", "export"]);
      return entries;
    }

    if (node?.kind === "file") {
      const openEntries = [["Open Source", "open-source"]];
      if (canPreviewFile?.(node.id)) {
        openEntries.push(["Open Preview", "open-preview"]);
      }

      let typeEntries;
      if (node.name.endsWith(".md")) {
        typeEntries = [["Copy", "copy"], ["Rename", "rename"], ["Delete", "delete"], ["Export", "export"]];
      } else if (node.name.endsWith(".mtree")) {
        typeEntries = [["Copy", "copy"], ["Generate Module Map", "generate-module-map"], ["Rename", "rename"], ["Delete", "delete"], ["Export", "export"]];
      } else if (isUrlDbFileName(node.name)) {
        typeEntries = [["Copy", "copy"], ["Add Bookmark Entry", "add-bookmark-entry"], ["Rename", "rename"], ["Delete", "delete"], ["Export", "export"]];
      } else if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(node.name)) {
        typeEntries = [["Copy", "copy"], ["Replace File", "replace-file"], ["Rename", "rename"], ["Delete", "delete"], ["Export", "export"]];
      } else {
        typeEntries = [["Copy", "copy"], ["Rename", "rename"], ["Delete", "delete"], ["Export", "export"]];
      }

      if (pasteEnabled) {
        typeEntries.splice(1, 0, ["Paste", "paste"]);
      }
      return [...openEntries, ...typeEntries];
    }
  }

  function getFilterEntries() {
    const activeFilter = getFilterMode?.() ?? "all";
    return [
      [activeFilter === "all" ? "✓ All" : "All", "filter-all"],
      [activeFilter === "notes" ? "✓ Notes" : "Notes", "filter-notes"],
      [activeFilter === "mtree" ? "✓ MTREE" : "MTREE", "filter-mtree"],
      [activeFilter === "images" ? "✓ Images" : "Images", "filter-images"]
    ];
  }

  function showMenu(x, y, target, mode = "default") {
    menuTarget = target;
    activeMenuMode = mode;
    contextMenu.replaceChildren();

    const node = currentProject?.nodes?.[target?.nodeId] ?? null;
    const entries = mode === "filter" ? getFilterEntries() : getMenuEntries(node, mode, target);

    entries.forEach(([label, action]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        const actionTarget = menuTarget;
        hideMenu();
        onAction(action, actionTarget, { dryRun: false });
      });
      contextMenu.append(button);
    });

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.hidden = false;
  }

  document.addEventListener("click", hideMenu);

  surface.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".tree-row");
    if (row && container.contains(row)) {
      event.preventDefault();
      const target = {
        nodeId: row.dataset.nodeId,
        entryId: row.dataset.entryId || null
      };
      onSelectNode?.(target);
      showMenu(event.clientX, event.clientY, target);
      return;
    }

    if (!surface.contains(event.target)) {
      return;
    }

    event.preventDefault();
    const target = { nodeId: ROOT_ID, entryId: null };
    onSelectNode?.(target);
    showMenu(event.clientX, event.clientY, target);
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest(".tree-row")) {
      return;
    }
    onSelectNode?.({ nodeId: ROOT_ID, entryId: null });
  });

  function showAssetPreview(source, label, anchorElement) {
    if (!source) {
      return;
    }

    const image = document.createElement("img");
    image.src = source;
    image.alt = label;
    previewTooltip.replaceChildren(image);
    const rect = anchorElement.getBoundingClientRect();
    previewTooltip.style.left = `${rect.right + 8}px`;
    previewTooltip.style.top = `${rect.top}px`;
    previewTooltip.hidden = false;
  }

  function attachAssetPreview(row, previewSource, label, assetClass = "is-asset-row") {
    row.classList.add(assetClass);
    row.addEventListener("mouseenter", () => showAssetPreview(previewSource, label, row));
    row.addEventListener("mouseleave", hidePreviewTooltip);
  }

  function render(project, pendingPaths = new Set()) {
    currentProject = project;
    container.replaceChildren();
    const filterMode = getFilterMode?.() ?? "all";
    const rows = listVisibleNodes(project).filter(({ node }) => nodeMatchesFilter(node, filterMode));

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "subtle-label";
      empty.textContent = "No files yet. Right-click to create one.";
      container.append(empty);
      return;
    }

    rows.forEach(({ node, depth, path }) => {
      const row = document.createElement("div");
      const selectedTarget = getSelectedTarget?.() ?? { nodeId: ROOT_ID, entryId: null };
      const isSelectedNode = selectedTarget.nodeId === node.id && !selectedTarget.entryId;
      const hasPendingEdit = pendingPaths.has(path);
      row.className = `tree-row${isSelectedNode ? " is-active" : ""}${hasPendingEdit ? " is-agent-pending" : ""}`;
      row.setAttribute("role", "treeitem");
      row.dataset.nodeId = node.id;
      row.title = path;

      if (node.kind === "file" || node.kind === "folder") {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
          onDragNodeStart?.(node.id, event);
        });
      }

      const indent = document.createElement("span");
      indent.className = "tree-depth";
      indent.style.setProperty("--depth", String(depth));
      row.append(indent);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "icon-button";
      toggle.textContent = node.kind === "folder" || (node.kind === "file" && isUrlDbFileName(node.name))
        ? (node.expanded ? "▾" : "▸")
        : "·";
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        if (node.kind === "folder" || (node.kind === "file" && isUrlDbFileName(node.name))) {
          onToggleFolder(node.id);
        }
      });
      row.append(toggle);

      const icon = document.createElement("span");
      icon.className = `tree-icon ${getFileIconClass(node)}`;
      icon.setAttribute("aria-hidden", "true");
      row.append(icon);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.name;
      row.append(label);

      if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(node.name)) {
        attachAssetPreview(row, getAssetPreviewSrc?.(node.id), node.name);
      }

      row.addEventListener("click", () => {
        onSelectNode?.({ nodeId: node.id, entryId: null });
        if (node.kind === "folder") {
          return;
        }
        onOpenFile(node.id);
      });
      container.append(row);

      if (node.kind === "file" && isUrlDbFileName(node.name) && node.expanded) {
        const entries = getUrlDbEntries?.(node.id) ?? [];
        entries.forEach((entry) => {
          const childRow = document.createElement("div");
          const isSelectedEntry = selectedTarget?.nodeId === node.id && selectedTarget?.entryId === entry.id;
          childRow.className = `tree-row tree-row-derived is-asset-row${isSelectedEntry ? " is-active" : ""}`;
          childRow.setAttribute("role", "treeitem");
          childRow.dataset.nodeId = node.id;
          childRow.dataset.entryId = entry.id;
          childRow.title = entry.description ? `${entry.name}\n${entry.url}\n${entry.description}` : `${entry.name}\n${entry.url}`;
          childRow.draggable = true;
          childRow.addEventListener("dragstart", (event) => {
            onDragUrlDbEntryStart?.(node.id, entry.id, event);
          });

          const childIndent = document.createElement("span");
          childIndent.className = "tree-depth";
          childIndent.style.setProperty("--depth", String(depth + 1));
          childRow.append(childIndent);

          const childToggle = document.createElement("span");
          childToggle.className = "icon-button is-ghost";
          childToggle.textContent = "·";
          childRow.append(childToggle);

          const childIcon = document.createElement("span");
          childIcon.className = "tree-icon is-remote-image";
          childIcon.setAttribute("aria-hidden", "true");
          childRow.append(childIcon);

          const childLabel = document.createElement("span");
          childLabel.className = "tree-label";
          childLabel.textContent = entry.name;
          childRow.append(childLabel);

          attachAssetPreview(childRow, entry.url, entry.name, "is-remote-asset-row");
          childRow.addEventListener("click", () => {
            onSelectNode?.({ nodeId: node.id, entryId: entry.id });
            onOpenUrlDbEntry?.(node.id, entry.id);
          });

          container.append(childRow);
        });
      }
    });
  }

  function showQuickAddMenu(anchorElement, nodeId = ROOT_ID) {
    const rect = anchorElement.getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, { nodeId, entryId: null }, "quick-add");
  }

  function toggleQuickAddMenu(anchorElement, nodeId = ROOT_ID) {
    if (!contextMenu.hidden && activeMenuMode === "quick-add") {
      hideMenu();
      return false;
    }
    showQuickAddMenu(anchorElement, nodeId);
    return true;
  }

  function toggleFilterMenu(anchorElement, nodeId = ROOT_ID) {
    if (!contextMenu.hidden && activeMenuMode === "filter") {
      hideMenu();
      return false;
    }
    const rect = anchorElement.getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, { nodeId, entryId: null }, "filter");
    return true;
  }

  return { render, hideMenu, showQuickAddMenu, toggleQuickAddMenu, toggleFilterMenu };
}

export { createExplorerView };