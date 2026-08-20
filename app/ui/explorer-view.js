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

function createExplorerView({ container, surface, contextMenu, onOpenFile, onOpenUrlDbEntry, onToggleFolder, onSelectNode, onAction, canPasteTarget, canPreviewFile, canManagePreview, onDragNodeStart, onDragUrlDbEntryStart, getFilterMode, getAssetPreviewSrc, getUrlDbEntries, getSelectedTarget }) {
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
      } else if (node.name.endsWith(".bmap")) {
        typeEntries = [
          ["Copy", "copy"],
          ["Export", "export"],
          ["Export As", null, [
            ["Image (PNG)", "export-bmap-png"],
            ["Image (JPG)", "export-bmap-jpg"],
            ["Vector (SVG)", "export-bmap-svg"],
          ]],
          ["Rename", "rename"],
          ["Delete", "delete"],
        ];
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

  function getProjectRootMenuEntries() {
    const entries = [["Export as Zip", "export"]];
    if (canManagePreview?.() === true) {
      entries.push(["Manage Preview", "manage-preview"]);
    }
    return entries;
  }

  function showMenu(x, y, target, mode = "default") {
    menuTarget = target;
    activeMenuMode = mode;
    contextMenu.replaceChildren();

    const node = currentProject?.nodes?.[target?.nodeId] ?? null;
    let entries;
    if (mode === "filter") {
      entries = getFilterEntries();
    } else if (mode === "project-root") {
      entries = getProjectRootMenuEntries();
    } else {
      entries = getMenuEntries(node, mode, target);
    }

    const runAction = (action) => {
      const actionTarget = menuTarget;
      hideMenu();
      onAction(action, actionTarget, { dryRun: false });
    };

    entries.forEach(([label, action, submenu]) => {
      if (Array.isArray(submenu) && submenu.length) {
        // Entry with a hover-reveal submenu (e.g. "Export As").
        const wrapper = document.createElement("div");
        wrapper.className = "explorer-context-subwrap";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "explorer-context-sub-trigger";
        button.textContent = label;
        wrapper.append(button);

        const flyout = document.createElement("div");
        flyout.className = "explorer-context-submenu";
        submenu.forEach(([subLabel, subAction]) => {
          const subButton = document.createElement("button");
          subButton.type = "button";
          subButton.textContent = subLabel;
          subButton.addEventListener("click", () => runAction(subAction));
          flyout.append(subButton);
        });
        wrapper.append(flyout);
        contextMenu.append(wrapper);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => runAction(action));
      contextMenu.append(button);
    });

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.hidden = false;
    // Keep the menu inside the viewport — essential for touch long-press near an
    // edge, where an unclamped menu would render partly (or fully) off-screen.
    const rect = contextMenu.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) {
      contextMenu.style.left = `${Math.max(margin, window.innerWidth - margin - rect.width)}px`;
    }
    if (rect.bottom > window.innerHeight - margin) {
      contextMenu.style.top = `${Math.max(margin, window.innerHeight - margin - rect.height)}px`;
    }
  }

  // Close the menu on any click outside it. Clicks on a menu item are handled by
  // the item's own listener (which hides + runs the action), so excluding the
  // menu here avoids a race that could dismiss it before the action fires.
  document.addEventListener("click", (event) => {
    if (contextMenu.hidden || contextMenu.contains(event.target)) return;
    hideMenu();
  });

  // Touch long-press → context menu. The native `contextmenu` event is unreliable
  // on mobile (text selection / callout can swallow it), so detect a stationary
  // ~500 ms hold on a row ourselves and open the same menu.
  let pressTimer = null;
  let pressStart = null;
  let longPressFired = false;
  let movedAfterOpen = false;

  function clearPressTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  surface.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      clearPressTimer();
      pressStart = null;
      return;
    }
    const touch = event.touches[0];
    const row = event.target.closest(".tree-row");
    const inSurface = row ? container.contains(row) : surface.contains(event.target);
    if (!inSurface) {
      clearPressTimer();
      pressStart = null;
      return;
    }
    pressStart = { x: touch.clientX, y: touch.clientY };
    longPressFired = false;
    movedAfterOpen = false;
    clearPressTimer();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressFired = true;
      const target = row
        ? { nodeId: row.dataset.nodeId, entryId: row.dataset.entryId || null }
        : { nodeId: ROOT_ID, entryId: null };
      onSelectNode?.(target);
      const mode = row?.dataset.projectRoot ? "project-root" : "default";
      showMenu(pressStart.x, pressStart.y, target, mode);
    }, 500);
  }, { passive: true });

  surface.addEventListener("touchmove", (event) => {
    if (!pressStart) return;
    const touch = event.touches[0];
    const dist = Math.hypot(touch.clientX - pressStart.x, touch.clientY - pressStart.y);
    if (longPressFired) {
      if (dist > 6) movedAfterOpen = true; // dragging toward a menu item
    } else if (dist > 10) {
      clearPressTimer(); // moved before the hold completed → it's a scroll
      pressStart = null;
    }
  }, { passive: true });

  surface.addEventListener("touchend", (event) => {
    clearPressTimer();
    if (longPressFired) {
      // Every touch event of this gesture fires on the row where it STARTED, so
      // a natural hold-drag-release onto a menu item never reaches the button.
      // Bridge it: if the finger moved after the menu opened, activate whatever
      // menu item sits under the release point. Either way swallow the click that
      // would otherwise open the file / dismiss the just-opened menu.
      event.preventDefault();
      if (movedAfterOpen) {
        const touch = event.changedTouches[0];
        const el = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : null;
        const button = el?.closest?.(".explorer-context-menu button");
        if (button) button.click();
      }
      longPressFired = false;
      movedAfterOpen = false;
      pressStart = null;
    }
  }, { passive: false });

  surface.addEventListener("touchcancel", () => {
    clearPressTimer();
    pressStart = null;
    longPressFired = false;
    movedAfterOpen = false;
  }, { passive: true });

  surface.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".tree-row");
    if (row && container.contains(row)) {
      event.preventDefault();
      const target = {
        nodeId: row.dataset.nodeId,
        entryId: row.dataset.entryId || null
      };
      onSelectNode?.(target);
      showMenu(event.clientX, event.clientY, target, row.dataset.projectRoot ? "project-root" : "default");
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

  // Virtual project-name row pinned to the top of the tree. It is a display-only
  // placeholder (no files live directly "on" it); its context menu exports the
  // whole project and, for server workspaces, opens the preview access editor.
  function createProjectRootRow(project) {
    const row = document.createElement("div");
    const selectedTarget = getSelectedTarget?.() ?? { nodeId: ROOT_ID, entryId: null };
    const isSelected = selectedTarget.nodeId === ROOT_ID && !selectedTarget.entryId;
    row.className = `tree-row is-project-root${isSelected ? " is-active" : ""}`;
    row.setAttribute("role", "treeitem");
    row.dataset.nodeId = ROOT_ID;
    row.dataset.projectRoot = "1";
    row.title = project?.name ?? "Project";

    const indent = document.createElement("span");
    indent.className = "tree-depth";
    indent.style.setProperty("--depth", "0");
    row.append(indent);

    const toggle = document.createElement("span");
    toggle.className = "icon-button is-ghost";
    toggle.textContent = "·";
    row.append(toggle);

    const icon = document.createElement("span");
    icon.className = "tree-icon is-project";
    icon.setAttribute("aria-hidden", "true");
    row.append(icon);

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = project?.name ?? "Project";
    row.append(label);

    row.addEventListener("click", () => {
      onSelectNode?.({ nodeId: ROOT_ID, entryId: null });
    });

    return row;
  }

  function render(project, pendingPaths = new Set()) {
    currentProject = project;
    container.replaceChildren();
    container.append(createProjectRootRow(project));
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
      indent.style.setProperty("--depth", String(depth + 1));
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
          childIndent.style.setProperty("--depth", String(depth + 2));
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