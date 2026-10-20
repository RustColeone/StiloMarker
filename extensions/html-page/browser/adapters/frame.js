// A page's preview: the page in a sandboxed frame. Its scripts run, but in an
// origin of its own, never the app's (sandbox="allow-scripts" without
// allow-same-origin), so it reaches neither the app, the account nor the
// workspace. Its relative images (the workspace's) are embedded as data, read
// here: a cloud workspace's image address carries the session's token, which
// a page's scripts must never see.
import { ignore } from "../../../../app/kernel/index.js";
import { isRelative } from "../model/html.js";

export const SANDBOX = "allow-scripts";

async function asData(address, fetchImpl) {
  try {
    const response = await fetchImpl(address);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    ignore(error, "an image of the page could not be read; it shows as written");
    return null;
  }
}

// The page's text with each relative <img src> naming an image in the
// workspace embedded as data (resolve: a relative address to the image's own,
// or as written when it names none); the text as written when nothing changed.
export async function embedImages(html, resolve, { fetchImpl = globalThis.fetch, parser = globalThis.DOMParser } = {}) {
  const doc = new parser().parseFromString(html, "text/html"); // inert: nothing in it runs
  const images = [...doc.querySelectorAll("img[src]")].filter((img) => isRelative(img.getAttribute("src")));
  let changed = false;
  await Promise.all(images.map(async (img) => {
    const address = resolve(img.getAttribute("src"));
    if (!address || isRelative(address)) return; // not an image in the workspace
    const data = address.startsWith("data:") ? address : await asData(address, fetchImpl);
    if (!data) return;
    img.setAttribute("src", data);
    changed = true;
  }));
  if (!changed) return html;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return `${doctype}${doc.documentElement.outerHTML}`;
}

export function drawPage(target, html, resolve, doc = globalThis.document) {
  if (!html.trim()) {
    const hint = doc.createElement("div");
    hint.className = "html-page-hint";
    hint.textContent = "An empty page. Write some HTML, for example <h1>Title</h1>.";
    target.append(hint);
    return;
  }
  const frame = doc.createElement("iframe");
  frame.className = "html-page-frame";
  frame.setAttribute("sandbox", SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = "Page preview";
  target.append(frame);
  void embedImages(html, resolve).then((page) => { frame.srcdoc = page; });
}
