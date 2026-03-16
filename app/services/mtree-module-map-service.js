const CONTINUATION_TOKEN = "...";

class ModuleNode {
  constructor(name) {
    this.name = name;
    this.description = "";
    this.parents = [];
    this.children = [];
  }
}

class ModuleGraph {
  constructor() {
    this.nodes = {};
    this.childConflicts = [];
    this.continuationRoots = [];
  }

  ensureNode(name) {
    if (!this.nodes[name]) {
      this.nodes[name] = new ModuleNode(name);
    }
    return this.nodes[name];
  }

  addContinuationRoot(name) {
    this.ensureNode(name);
    if (!this.continuationRoots.includes(name)) {
      this.continuationRoots.push(name);
    }
  }

  setDescription(name, description) {
    const node = this.ensureNode(name);
    if (description) {
      node.description = description;
    }
  }

  appendDescription(name, line) {
    const node = this.ensureNode(name);
    node.description = node.description ? `${node.description}\n${line}` : line;
  }

  addEdge(parent, child) {
    const parentNode = this.ensureNode(parent);
    const childNode = this.ensureNode(child);
    if (!parentNode.children.includes(child)) {
      parentNode.children.push(child);
    }
    if (!childNode.parents.includes(parent)) {
      childNode.parents.push(parent);
    }
  }

  roots() {
    return Object.entries(this.nodes)
      .filter(([, node]) => node.parents.length === 0)
      .map(([name]) => name);
  }
}

function splitNameAndDescription(content) {
  if (!content.includes(";")) {
    return [content.trim(), ""];
  }
  const [name, ...rest] = content.split(";");
  return [name.trim(), rest.join(";").trim()];
}

function indentLevelAndContent(rawLine, lineNumber) {
  let index = 0;
  let spaceRun = 0;
  let indent = 0;

  while (index < rawLine.length) {
    const character = rawLine[index];
    if (character === "\t") {
      if (spaceRun) {
        throw new Error(`Invalid indentation at line ${lineNumber}. Do not mix tabs with partial spaces.`);
      }
      indent += 1;
      index += 1;
      continue;
    }

    if (character === " ") {
      spaceRun += 1;
      index += 1;
      if (spaceRun === 4) {
        indent += 1;
        spaceRun = 0;
      }
      continue;
    }

    break;
  }

  if (spaceRun) {
    throw new Error(`Invalid indentation at line ${lineNumber}. Use tabs or multiples of 4 spaces per level.`);
  }

  return [indent, rawLine.slice(index).trim()];
}

function checkChildConflict(graph, parent, child, committedParents, lineNumber) {
  const parentNode = graph.nodes[parent];
  if (committedParents.has(parent) && parentNode && !parentNode.children.includes(child)) {
    graph.childConflicts.push(
      `Child conflict at line ${lineNumber}: '${parent}' already declared children elsewhere; adding new child '${child}' here.`
    );
  }
}

function parseModuleTree(source) {
  const graph = new ModuleGraph();
  let stack = [];
  let lastModuleName = null;
  let definitionBlock = null;
  const committedParents = new Set();

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((rawEntry, index) => {
    const lineNumber = index + 1;
    const rawLine = rawEntry.replace(/^\ufeff/, "");
    const stripped = rawLine.trimStart();

    if (!stripped) {
      if (definitionBlock) {
        definitionBlock = null;
      }
      return;
    }

    if (stripped.startsWith("#")) {
      return;
    }

    if (stripped.startsWith("[") && stripped.endsWith("]")) {
      const definitionName = stripped.slice(1, -1).trim();
      if (!definitionName) {
        throw new Error(`Empty definition block name at line ${lineNumber}.`);
      }
      graph.ensureNode(definitionName);
      lastModuleName = definitionName;
      definitionBlock = definitionName;
      return;
    }

    if (definitionBlock) {
      const descriptionLine = stripped.startsWith("|") ? stripped.slice(1).trim() : stripped;
      graph.appendDescription(definitionBlock, descriptionLine);
      return;
    }

    if (stripped.startsWith("|")) {
      if (!lastModuleName) {
        throw new Error(`Continuation line at line ${lineNumber} has no preceding module.`);
      }
      graph.appendDescription(lastModuleName, stripped.slice(1).trim());
      return;
    }

    const [indent, content] = indentLevelAndContent(rawLine, lineNumber);
    if (!content) {
      return;
    }

    const [namePart, description] = splitNameAndDescription(content);

    if (namePart.includes("->")) {
      let chain = namePart.split("->").map((part) => part.trim()).filter(Boolean);
      if (chain[0] === CONTINUATION_TOKEN) {
        chain = chain.slice(1);
        if (chain.length === 0) {
          throw new Error(`'...->' with no module at line ${lineNumber}.`);
        }
        graph.addContinuationRoot(chain[0]);
      }
      if (chain.length < 2) {
        throw new Error(`Invalid chain at line ${lineNumber}: ${rawLine}`);
      }
      chain.forEach((moduleName) => graph.ensureNode(moduleName));
      chain.forEach((moduleName, chainIndex) => {
        if (chainIndex === chain.length - 1) {
          return;
        }
        const child = chain[chainIndex + 1];
        checkChildConflict(graph, moduleName, child, committedParents, lineNumber);
        graph.addEdge(moduleName, child);
      });
      chain.slice(0, -1).forEach((moduleName) => committedParents.add(moduleName));
      if (description) {
        graph.setDescription(chain[chain.length - 1], description);
      }
      lastModuleName = chain[chain.length - 1];
      return;
    }

    const moduleName = namePart.trim();
    if (!moduleName) {
      throw new Error(`Missing module name at line ${lineNumber}.`);
    }

    if (moduleName === CONTINUATION_TOKEN) {
      stack.slice(indent).forEach((entry) => {
        if (entry !== CONTINUATION_TOKEN && graph.nodes[entry]?.children.length) {
          committedParents.add(entry);
        }
      });
      stack = stack.slice(0, indent);
      stack.push(CONTINUATION_TOKEN);
      return;
    }

    graph.ensureNode(moduleName);
    graph.setDescription(moduleName, description);
    lastModuleName = moduleName;

    if (indent > stack.length) {
      throw new Error(`Invalid indentation at line ${lineNumber}. Only one tab deeper than previous line is allowed.`);
    }

    stack.slice(indent).forEach((entry) => {
      if (entry !== CONTINUATION_TOKEN && graph.nodes[entry]?.children.length) {
        committedParents.add(entry);
      }
    });
    stack = stack.slice(0, indent);

    if (indent > 0) {
      const parent = stack[indent - 1];
      if (parent === CONTINUATION_TOKEN) {
        graph.addContinuationRoot(moduleName);
      } else {
        checkChildConflict(graph, parent, moduleName, committedParents, lineNumber);
        graph.addEdge(parent, moduleName);
      }
    }

    stack.push(moduleName);
  });

  return graph;
}

function parseRenderFlags(renderFlags = "TT") {
  const flags = renderFlags.toUpperCase().padEnd(2, "T");
  return {
    simplify: flags[0] === "T",
    splitContinuationTrees: flags[1] === "T"
  };
}

function makeAnchor(name) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function renderChildren(graph, nodeName, prefix, path, output, recursionWarnings, options, fullyRendered) {
  const children = graph.nodes[nodeName].children;
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    output.push(`${prefix}${branch}${graph.nodes[child].name}`);
    const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;

    if (path.includes(child)) {
      const cycleStart = path.indexOf(child);
      const cyclePath = [...path.slice(cycleStart), child];
      recursionWarnings.add(`Recursion detected: ${cyclePath.join(" -> ")} (truncated to '...').`);
      output.push(`${nextPrefix}└── ...`);
      return;
    }

    if (options.splitContinuationTrees && graph.continuationRoots.includes(child)) {
      output.push(`${nextPrefix}└── ...`);
      return;
    }

    if (options.simplify && fullyRendered.has(child)) {
      output.push(`${nextPrefix}└── ...(same as above)...`);
      return;
    }

    fullyRendered.add(child);
    renderChildren(graph, child, nextPrefix, [...path, child], output, recursionWarnings, options, fullyRendered);
  });
}

function renderTree(graph, renderFlags = "TT") {
  if (Object.keys(graph.nodes).length === 0) {
    return { tree: "(no modules)", recursionWarnings: [] };
  }

  const options = parseRenderFlags(renderFlags);
  const lines = [];
  const recursionWarnings = new Set();
  const fullyRendered = new Set();
  const coveredNodes = new Set();
  const continuationRoots = new Set(graph.continuationRoots);
  const allRoots = graph.roots().length ? graph.roots() : Object.keys(graph.nodes);
  const mainRoots = allRoots.filter((root) => !(options.splitContinuationTrees && continuationRoots.has(root)));
  const continuationRootsToRender = options.splitContinuationTrees ? [...graph.continuationRoots] : [];

  function collectReachable(start) {
    const reachable = new Set();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop();
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      stack.push(...graph.nodes[current].children);
    }
    return reachable;
  }

  mainRoots.forEach((root, index) => {
    if (coveredNodes.has(root)) {
      return;
    }
    lines.push(graph.nodes[root].name);
    fullyRendered.add(root);
    renderChildren(graph, root, "", [root], lines, recursionWarnings, options, fullyRendered);
    collectReachable(root).forEach((nodeName) => coveredNodes.add(nodeName));
    if (index !== mainRoots.length - 1 || continuationRootsToRender.length > 0) {
      lines.push("");
    }
  });

  continuationRootsToRender.forEach((root, index) => {
    lines.push(CONTINUATION_TOKEN);
    lines.push(`└── ${graph.nodes[root].name}`);
    if (fullyRendered.has(root)) {
      lines.push("    └── ...(same as above)...");
    } else {
      fullyRendered.add(root);
      renderChildren(graph, root, "    ", [root], lines, recursionWarnings, options, fullyRendered);
    }
    if (index !== continuationRootsToRender.length - 1) {
      lines.push("");
    }
  });

  return {
    tree: lines.join("\n"),
    recursionWarnings: [...recursionWarnings].sort()
  };
}

function renderNavChildren(graph, nodeName, depth, path, output, recursionWarnings, options, fullyRendered) {
  const indent = "  ".repeat(depth);
  graph.nodes[nodeName].children.forEach((child) => {
    const anchor = makeAnchor(child);
    const childLabel = graph.nodes[child].name;
    if (path.includes(child)) {
      const cycleStart = path.indexOf(child);
      const cyclePath = [...path.slice(cycleStart), child];
      recursionWarnings.add(`Recursion detected: ${cyclePath.join(" -> ")} (truncated to '...').`);
      output.push(`${indent}- [${childLabel}](#${anchor}) _(cycle)_`);
      return;
    }
    if (options.splitContinuationTrees && graph.continuationRoots.includes(child)) {
      output.push(`${indent}- [${childLabel}](#${anchor}) _(continued below)_`);
      return;
    }
    if (options.simplify && fullyRendered.has(child)) {
      output.push(`${indent}- [${childLabel}](#${anchor}) _(same as above)_`);
      return;
    }
    output.push(`${indent}- [${childLabel}](#${anchor})`);
    fullyRendered.add(child);
    renderNavChildren(graph, child, depth + 1, [...path, child], output, recursionWarnings, options, fullyRendered);
  });
}

function renderNavigation(graph, renderFlags = "TT") {
  if (Object.keys(graph.nodes).length === 0) {
    return "(no modules)";
  }

  const options = parseRenderFlags(renderFlags);
  const lines = [];
  const recursionWarnings = new Set();
  const fullyRendered = new Set();
  const coveredNodes = new Set();
  const continuationRoots = new Set(graph.continuationRoots);
  const allRoots = graph.roots().length ? graph.roots() : Object.keys(graph.nodes);
  const mainRoots = allRoots.filter((root) => !(options.splitContinuationTrees && continuationRoots.has(root)));
  const continuationRootsToRender = options.splitContinuationTrees ? [...graph.continuationRoots] : [];

  function collectReachable(start) {
    const reachable = new Set();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop();
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      stack.push(...graph.nodes[current].children);
    }
    return reachable;
  }

  mainRoots.forEach((root, index) => {
    if (coveredNodes.has(root)) {
      return;
    }
    lines.push(`- [${root}](#${makeAnchor(root)})`);
    fullyRendered.add(root);
    renderNavChildren(graph, root, 1, [root], lines, recursionWarnings, options, fullyRendered);
    collectReachable(root).forEach((nodeName) => coveredNodes.add(nodeName));
    if (index !== mainRoots.length - 1 || continuationRootsToRender.length > 0) {
      lines.push("");
    }
  });

  continuationRootsToRender.forEach((root, index) => {
    lines.push(`- ${CONTINUATION_TOKEN}`);
    lines.push(`  - [${root}](#${makeAnchor(root)})`);
    if (fullyRendered.has(root)) {
      lines.push("    - _(same as above)_");
    } else {
      fullyRendered.add(root);
      renderNavChildren(graph, root, 2, [root], lines, recursionWarnings, options, fullyRendered);
    }
    if (index !== continuationRootsToRender.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

function renderCatalogSections(graph, options = {}) {
  const includeParents = options.includeParents !== false;
  const includeChildren = options.includeChildren !== false;
  const includeDescriptions = options.includeDescriptions !== false;
  const includeEmptySections = options.includeEmptySections === true;

  return Object.values(graph.nodes).map((node) => {
    const sections = [`#### ${node.name}`];

    if (includeParents && (includeEmptySections || node.parents.length > 0)) {
      sections.push("##### Parents");
      sections.push(node.parents.length > 0 ? node.parents.map((parent) => `[${parent}](#${makeAnchor(parent)})`).join(", ") : "—");
    }

    if (includeChildren && (includeEmptySections || node.children.length > 0)) {
      sections.push("##### Children");
      sections.push(node.children.length > 0 ? node.children.map((child) => `[${child}](#${makeAnchor(child)})`).join(", ") : "—");
    }

    if (includeDescriptions && (includeEmptySections || node.description)) {
      sections.push("##### Description");
      sections.push(node.description || "—");
    }

    sections.push("\n---\n");
    return sections.join("\n");
  }).join("\n");
}

function findMissingDescriptionModules(graph) {
  return Object.values(graph.nodes)
    .filter((node) => !node.description)
    .map((node) => node.name)
    .sort();
}

function findRecursionMistakes(graph) {
  const warnings = new Set();
  const recursionModules = new Set();

  Object.values(graph.nodes).forEach((node) => {
    if (node.children.includes(node.name)) {
      recursionModules.add(node.name);
      warnings.add(`Recursion mistake: self-reference detected (${node.name} -> ${node.name}).`);
    }
  });

  const visited = new Set();
  const path = [];
  const pathSet = new Set();

  function dfs(moduleName) {
    visited.add(moduleName);
    path.push(moduleName);
    pathSet.add(moduleName);

    graph.nodes[moduleName].children.forEach((child) => {
      if (child === moduleName) {
        return;
      }
      if (pathSet.has(child)) {
        const cycleStart = path.indexOf(child);
        const cyclePath = [...path.slice(cycleStart), child];
        cyclePath.slice(0, -1).forEach((entry) => recursionModules.add(entry));
        warnings.add(`Recursion mistake: cyclic dependency detected (${cyclePath.join(" -> ")}).`);
        return;
      }
      if (!visited.has(child)) {
        dfs(child);
      }
    });

    pathSet.delete(moduleName);
    path.pop();
  }

  Object.keys(graph.nodes).sort().forEach((name) => {
    if (!visited.has(name)) {
      dfs(name);
    }
  });

  return {
    warnings: [...warnings].sort(),
    recursionModules
  };
}

function buildModuleMapSection(source, options = {}) {
  const graph = parseModuleTree(source);
  const renderFlags = `${options.simplify === false ? "F" : "T"}${options.splitContinuationTrees === false ? "F" : "T"}`;
  const { tree, recursionWarnings } = renderTree(graph, renderFlags);
  const includeNavigation = options.includeNavigation !== false;
  const includeModules = options.includeModules !== false;
  const navigation = includeNavigation ? renderNavigation(graph, renderFlags) : "";
  const modules = includeModules ? renderCatalogSections(graph, options) : "";
  const { warnings: recursionMistakeWarnings, recursionModules } = findRecursionMistakes(graph);
  const missingDescriptionModules = findMissingDescriptionModules(graph);
  const warnings = [...new Set([
    ...recursionMistakeWarnings,
    ...recursionWarnings,
    ...graph.childConflicts,
    ...missingDescriptionModules.map((name) => `Module has no description: ${name}`)
  ])].sort();

  const sectionParts = [
    "## Module Map",
    "",
    "### Tree View",
    "```text",
    tree,
    "```"
  ];

  if (includeNavigation) {
    sectionParts.push("", "### Navigation", "", navigation);
  }

  if (includeModules) {
    sectionParts.push("", "### Modules", "", modules);
  }

  const section = sectionParts.join("\n");

  return {
    graph,
    section,
    warnings,
    quality: {
      totalModules: Object.keys(graph.nodes).length,
      missingDescriptionModules,
      recursionModules: [...recursionModules].sort()
    }
  };
}

function replaceOrAppendModuleMap(markdownText, newSection) {
  const startMarker = "<!-- MODULE_MAP_START -->";
  const endMarker = "<!-- MODULE_MAP_END -->";
  const wrappedSection = `${startMarker}\n${newSection.trimEnd()}\n${endMarker}`;

  const markerPattern = new RegExp(`${startMarker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}([\\s\\S]*?)${endMarker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`);
  if (markerPattern.test(markdownText)) {
    return markdownText.replace(markerPattern, wrappedSection);
  }

  const headingPattern = /^## Module Map\b[\s\S]*?(?=^##\s|\Z)/m;
  if (headingPattern.test(markdownText)) {
    return markdownText.replace(headingPattern, `${wrappedSection}\n\n`);
  }

  const base = markdownText.trimEnd();
  return base ? `${base}\n\n${wrappedSection}\n` : `${wrappedSection}\n`;
}

export {
  buildModuleMapSection,
  parseModuleTree,
  replaceOrAppendModuleMap
};