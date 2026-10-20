// A diagram where its code is: a .mmd file's preview, or a ```mermaid block in
// a Markdown preview. The code shows until the diagram is drawn; when it
// cannot be (offline, or a mistake in it), the code stays, with the reason.
const EMPTY_HINT = "An empty diagram. Write one, for example:\nflowchart LR\n    A[Start] --> B[Done]";

function note(doc, text, className) {
  const element = doc.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

// Draws code into `diagram` (an element), showing `reason` on failure.
async function drawDiagram(diagram, code, mermaid, onFailure) {
  diagram.classList.add("is-loading");
  try {
    diagram.innerHTML = await mermaid.draw(code); // Mermaid's own SVG, sanitized (strict mode)
    diagram.classList.remove("is-loading");
    return true;
  } catch (error) {
    diagram.remove();
    onFailure(String(error?.message || error).split("\n").slice(0, 3).join("\n"));
    return false;
  }
}

// A .mmd file's preview: the diagram over a hidden copy of its code.
export function drawFilePreview(target, code, mermaid, doc = globalThis.document) {
  const frame = doc.createElement("div");
  frame.className = "mermaid-preview";
  if (!code.trim()) {
    frame.append(note(doc, EMPTY_HINT, "mermaid-hint"));
    target.append(frame);
    return;
  }
  const diagram = doc.createElement("div");
  diagram.className = "mermaid-diagram";
  const source = doc.createElement("pre");
  source.className = "mermaid-source";
  source.append(Object.assign(doc.createElement("code"), { textContent: code }));
  frame.append(diagram, source);
  target.append(frame);
  void drawDiagram(diagram, code, mermaid, (reason) => frame.prepend(note(doc, reason, "mermaid-error"))).then((drawn) => {
    if (drawn) source.hidden = true;
  });
}

// A ```mermaid block in a Markdown preview (the Editor's codeBlocks): the
// diagram before its code, which hides once it is drawn (Copy still copies it).
export function drawCodeBlock(block, code, mermaid, doc = globalThis.document) {
  if (block.dataset.mermaid) return Promise.resolve(); // already drawn (a cached preview)
  block.dataset.mermaid = "drawing";
  const diagram = doc.createElement("div");
  diagram.className = "mermaid-diagram";
  block.querySelector("pre")?.before(diagram);
  return drawDiagram(diagram, code, mermaid, (reason) => {
    block.dataset.mermaid = "failed";
    block.querySelector("pre")?.before(note(doc, reason, "mermaid-error"));
  }).then((drawn) => {
    if (drawn) block.dataset.mermaid = "drawn";
  });
}
