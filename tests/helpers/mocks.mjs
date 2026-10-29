// Shared test helpers: repo root resolution, app-module loader, and the
// in-memory File System Access API mocks used by the filesystem-facing tests.
//
// This file lives under tests/helpers/ (not matching Node's test-file glob), so
// the built-in `node --test` runner does not pick it up as a test file.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function resolveFromRoot(relativePath) {
  return resolve(repoRoot, relativePath);
}

/**
 * Dynamically import the application's ES modules from the workspace `app/`
 * folder and return them keyed by short name.
 */
export async function loadModules() {
  const load = (relativePath) => import(pathToFileURL(resolveFromRoot(relativePath)).href);
  const [
    projectModel,
    zipService,
    markdownService,
    bmapService,
    mtreeService,
    fsAccessService,
    syncService
  ] = await Promise.all([
    load("app/modules/workspace/index.js"),
    load("app/modules/workspace/adapters/zip.js"),
    load("app/modules/editor/model/markdown.js"),
    load("extensions/bmap-diagram/browser/model/bmap.js"),
    load("extensions/module-map/browser/model/module-map.js"),
    load("app/modules/workspace/adapters/disk-folders.js"),
    load("app/modules/cloud/adapters/api.js")
  ]);
  return {
    projectModel,
    zipService,
    markdownService,
    bmapService,
    mtreeService,
    fsAccessService,
    syncService
  };
}

export class MockFileHandle {
  constructor(name, content = "") {
    this.kind = "file";
    this.name = name;
    this.content = content;
  }

  async createWritable() {
    return {
      write: async (value) => {
        this.content = typeof value === "string" ? value : String(value);
      },
      close: async () => {}
    };
  }

  // As a real handle's file; `size` may be set to stand for a large one.
  async getFile() {
    const blob = new Blob([this.content]);
    return { name: this.name, size: this.size ?? blob.size, lastModified: 0, text: async () => this.content, arrayBuffer: () => blob.arrayBuffer() };
  }
}

export class MockDirectoryHandle {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async queryPermission() {
    return "granted";
  }

  async *values() {
    yield* this.directories.values();
    yield* this.files.values();
  }

  async requestPermission() {
    return "granted";
  }

  async getDirectoryHandle(name, options = {}) {
    const current = this.directories.get(name);
    if (current) {
      return current;
    }
    if (!options.create) {
      throw new Error(`Directory not found: ${name}`);
    }
    const handle = new MockDirectoryHandle(name);
    this.directories.set(name, handle);
    return handle;
  }

  async getFileHandle(name, options = {}) {
    const current = this.files.get(name);
    if (current) {
      return current;
    }
    if (!options.create) {
      throw new Error(`File not found: ${name}`);
    }
    const handle = new MockFileHandle(name, "");
    this.files.set(name, handle);
    return handle;
  }

  async removeEntry(name, options = {}) {
    if (this.files.delete(name)) {
      return;
    }
    if (this.directories.has(name)) {
      const folder = this.directories.get(name);
      if (!options.recursive && (folder.files.size || folder.directories.size)) {
        throw Object.assign(new Error(`Directory not empty: ${name}`), { name: "InvalidModificationError" });
      }
      this.directories.delete(name);
      return;
    }
    throw new Error(`Entry not found: ${name}`);
  }
}

export function getDirectoryByPath(rootHandle, path) {
  return path
    .split("/")
    .filter(Boolean)
    .reduce((handle, segment) => handle.directories.get(segment), rootHandle);
}

export function getFileByPath(rootHandle, path) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.pop();
  const parent = segments.length === 0 ? rootHandle : getDirectoryByPath(rootHandle, segments.join("/"));
  return parent?.files.get(fileName) ?? null;
}
