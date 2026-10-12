// Links in the source pane: the hover tooltip that previews a linked file and
// Ctrl+Click to follow it, and the sidebar's Linked Notes panel (outgoing
// links and backlinks). main.js creates this on first use and passes its
// shared values in `app`.
import { getNodeIdByPath, getPath, isImageFileName, isMarkdownFileName } from "../domain/project-model.js";
import { extractMarkdownLinks, renderMarkdown } from "../services/markdown-service.js";

export function createLinks(app) {
  let _linkTooltipTimer = null;
  let _linkTooltipHideTimer = null;
  let _linkTooltipCurrentHref = null;
  let _lastHoveredLinkEl = null;

  function resolveEditorLinkHref(href) {
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !href) return null;
    if (/^(https?:\/\/|mailto:|data:|blob:|#|\/)/i.test(href)) return null;
    const basePath = getPath(project, activeFile.id);
    const baseSegments = basePath.split("/").filter(Boolean);
    baseSegments.pop();
    const resolvedPath = app.normalizePath([...baseSegments, href].join("/"));
    const nodeId = getNodeIdByPath(project, resolvedPath);
    const node = nodeId ? project.nodes[nodeId] : null;
    return node?.kind === "file" ? { nodeId, node, path: resolvedPath } : null;
  }

  function openLinkFromEditor(href) {
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noreferrer");
      return;
    }
    const resolved = resolveEditorLinkHref(href);
    if (!resolved) {
      app.notify(`Cannot resolve link: ${href}`);
      return;
    }
    app.openFileFromExplorer(resolved.nodeId);
  }

  function showLinkTooltipContent(linkEl) {
    const href = linkEl.dataset.href ?? "";
    _linkTooltipCurrentHref = href;

    const project = app.controller.getProject();
    const resolved = resolveEditorLinkHref(href);

    if (!resolved) {
      app.editorLinkTooltip.nameEl.textContent = href || "(empty link)";
      if (/^https?:\/\//i.test(href)) {
        app.editorLinkTooltip.nameEl.className = "editor-link-tooltip-name";
        app.editorLinkTooltip.hintEl.textContent = "External — Ctrl+Click to open in browser";
        if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(href)) {
          app.editorLinkTooltip.previewEl.innerHTML = `<img src="${app.escapeHtmlAttribute(href)}" alt="" style="max-width:100%;height:auto">`;
          app.editorLinkTooltip.previewEl.hidden = false;
        } else {
          app.editorLinkTooltip.previewEl.innerHTML = "";
          app.editorLinkTooltip.previewEl.hidden = true;
        }
      } else {
        app.editorLinkTooltip.nameEl.className = "editor-link-tooltip-name is-unresolved";
        app.editorLinkTooltip.hintEl.textContent = "File not found in project";
        app.editorLinkTooltip.previewEl.innerHTML = "";
        app.editorLinkTooltip.previewEl.hidden = true;
      }
      return;
    }

    const { node, nodeId } = resolved;
    app.editorLinkTooltip.nameEl.textContent = resolved.path;
    app.editorLinkTooltip.nameEl.className = "editor-link-tooltip-name";
    app.editorLinkTooltip.hintEl.textContent = "Follow Link (Ctrl+Click)";
    app.editorLinkTooltip.previewEl.hidden = false;

    if (isMarkdownFileName(node.name)) {
      app.editorLinkTooltip.previewEl.innerHTML = renderMarkdown(node.content, {
        resolveUrl(url) { return app.resolveProjectAssetUrl(project, nodeId, url); }
      });
    } else if (isImageFileName(node.name)) {
      app.editorLinkTooltip.previewEl.innerHTML = `<img src="${app.escapeHtmlAttribute(app.imageSrcFor(project, node))}" alt="${app.escapeHtmlAttribute(node.name)}" style="max-width:100%;height:auto">`;
    } else {
      app.editorLinkTooltip.previewEl.innerHTML = `<pre><code>${app.escapeEditorHtml(node.content ?? "")}</code></pre>`;
    }
  }

  function positionLinkTooltip(clientX, clientY) {
    const el = app.editorLinkTooltip.el;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const ttW = 380;
    const ttMaxH = 320;
    let left = clientX + 14;
    let top = clientY + 18;
    if (left + ttW > vpW - 8) left = clientX - ttW - 14;
    if (top + ttMaxH > vpH - 8) top = Math.max(8, clientY - ttMaxH - 8);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, top)}px`;
  }

  function showLinkTooltip(linkEl, clientX, clientY) {
    clearTimeout(_linkTooltipTimer);
    clearTimeout(_linkTooltipHideTimer);
    const href = linkEl.dataset.href ?? "";
    if (!href) return;
    _linkTooltipTimer = setTimeout(() => {
      if (_lastHoveredLinkEl !== linkEl) return;
      showLinkTooltipContent(linkEl);
      app.editorLinkTooltip.el.hidden = false;
      positionLinkTooltip(clientX, clientY);
    }, 400);
  }

  function hideLinkTooltip(immediate = false) {
    clearTimeout(_linkTooltipTimer);
    if (immediate) {
      app.editorLinkTooltip.el.hidden = true;
      _linkTooltipCurrentHref = null;
      return;
    }
    clearTimeout(_linkTooltipHideTimer);
    _linkTooltipHideTimer = setTimeout(() => {
      if (!app.editorLinkTooltip.el.matches(":hover")) {
        app.editorLinkTooltip.el.hidden = true;
        _linkTooltipCurrentHref = null;
      }
    }, 120);
  }

  function handleEditorLinkHover(event) {
    const activeFile = app.controller.getActiveFile();
    if (!isMarkdownFileName(activeFile?.name ?? "")) {
      if (!app.editorLinkTooltip.el.hidden) hideLinkTooltip(true);
      _lastHoveredLinkEl = null;
      return;
    }
    const linkEl = event.target?.closest?.(".token-link[data-href]") ?? null;
    if (linkEl !== _lastHoveredLinkEl) {
      _lastHoveredLinkEl = linkEl;
      if (linkEl) {
        showLinkTooltip(linkEl, event.clientX, event.clientY);
      } else if (!app.editorLinkTooltip.el.matches(":hover")) {
        hideLinkTooltip();
      }
    }
  }

  function handleEditorMouseLeave() {
    _lastHoveredLinkEl = null;
    hideLinkTooltip();
  }

  // Links found in each file, reused while its text is unchanged. Backlinks scan
  // every markdown file in the workspace, so this panel re-parsed the inline
  // markdown of the whole project on every render — more work than the preview.
  // File contents are shared between project versions now, so an unchanged file
  // is usually the very same string and the check is free.
  const markdownLinksCache = new Map(); // node id -> { content, links }

  function cachedMarkdownLinks(nodeId, content) {
    const text = content ?? "";
    const hit = markdownLinksCache.get(nodeId);
    if (hit && hit.content === text) return hit.links;
    const links = extractMarkdownLinks(text);
    if (markdownLinksCache.size > 2000) markdownLinksCache.clear();
    markdownLinksCache.set(nodeId, { content: text, links });
    return links;
  }

  function renderLinksPanel(project, activeFile) {
    if (!app.linksPanelEl) return;
    if (!activeFile || !isMarkdownFileName(activeFile.name)) {
      app.linksPanelEl.hidden = true;
      return;
    }
    app.linksPanelEl.hidden = false;

    const activePath = getPath(project, activeFile.id);
    const activeSegments = activePath.split("/").filter(Boolean);
    activeSegments.pop();

    // Outgoing links
    const outgoingLinks = cachedMarkdownLinks(activeFile.id, activeFile.content);
    app.outgoingLinksListEl.replaceChildren();
    if (outgoingLinks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "links-item links-item-empty";
      empty.textContent = "No outgoing links";
      app.outgoingLinksListEl.append(empty);
    } else {
      outgoingLinks.forEach(({ label, href }) => {
        const item = document.createElement("div");
        item.className = "links-item";
        const isExternal = /^(https?:\/\/|mailto:)/i.test(href);
        let resolvedId = null;
        if (!isExternal) {
          const resolvedPath = app.normalizePath([...activeSegments, href].join("/"));
          resolvedId = getNodeIdByPath(project, resolvedPath);
        }
        const missing = !isExternal && !resolvedId;
        item.classList.toggle("links-item-unresolved", missing);

        const labelEl = document.createElement("span");
        labelEl.className = "links-item-label";
        labelEl.textContent = label !== href ? label : "";

        const hrefEl = document.createElement("span");
        hrefEl.className = "links-item-href";
        hrefEl.textContent = href;

        item.append(labelEl, hrefEl);

        if (resolvedId) {
          item.title = getPath(project, resolvedId);
          item.classList.add("links-item-clickable");
          item.addEventListener("click", () => app.openFileFromExplorer(resolvedId));
        } else if (isExternal) {
          item.classList.add("links-item-clickable");
          item.addEventListener("click", () => window.open(href, "_blank", "noreferrer"));
        }
        app.outgoingLinksListEl.append(item);
      });
    }

    // Backlinks — scan all .md files for links pointing to the active file
    const backlinks = [];
    Object.values(project.nodes).forEach((node) => {
      if (node.kind !== "file" || !isMarkdownFileName(node.name) || node.id === activeFile.id) return;
      const nodePath = getPath(project, node.id);
      const nodeSegments = nodePath.split("/").filter(Boolean);
      nodeSegments.pop();
      const links = cachedMarkdownLinks(node.id, node.content);
      const matchCount = links.filter(({ href }) => {
        if (/^(https?:\/\/|mailto:)/i.test(href)) return false;
        return app.normalizePath([...nodeSegments, href].join("/")) === activePath;
      }).length;
      if (matchCount > 0) backlinks.push({ node, nodePath, matchCount });
    });

    app.backlinksListEl.replaceChildren();
    if (backlinks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "links-item links-item-empty";
      empty.textContent = "No backlinks";
      app.backlinksListEl.append(empty);
    } else {
      backlinks.forEach(({ node, nodePath, matchCount }) => {
        const item = document.createElement("div");
        item.className = "links-item links-item-clickable";
        item.title = nodePath;
        const labelEl = document.createElement("span");
        labelEl.className = "links-item-label";
        labelEl.textContent = node.name;
        const countEl = document.createElement("span");
        countEl.className = "links-item-count";
        countEl.textContent = matchCount > 1 ? `${matchCount}×` : "";
        item.append(labelEl, countEl);
        item.addEventListener("click", () => app.openFileFromExplorer(node.id));
        app.backlinksListEl.append(item);
      });
    }
  }

  return { handleEditorLinkHover, handleEditorMouseLeave, hideLinkTooltip, openLinkFromEditor, renderLinksPanel };
}
