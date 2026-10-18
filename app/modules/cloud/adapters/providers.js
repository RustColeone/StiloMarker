// Where the file browser looks: the server's teams and folders, or this
// device's projects. Each provider lists, makes folders and projects, opens,
// deletes, exports and imports in its own place. Moved from main.js.
import { createProjectOpfs, deleteOpfsEntry, exportProjectModelOpfs, importProjectModelOpfs, listOpfsDir, mkdirOpfs } from "../../workspace/index.js";
import { browseServer, createProjectServer, deleteServer, exportProjectServer, importProjectServer, mkdirServer } from "./api.js";

export function createProviders(app) {
  const serverProvider = {
    id: "server",
    rootLabel: "Teams",
    supportsAccess: true,
    supportsPublish: true,
    canCreateAt(path) {
      return app.splitServerPath(path).team !== "";
    },
    async list(path) {
      const { team, rel } = app.splitServerPath(path);
      const data = await browseServer(app.settings.serverUrl, app.identity.token(), team, rel);
      if (!team) {
        // Team list. Older servers return name strings; newer ones { name, modified }.
        const entries = (data.teams ?? []).map((item) => {
          const name = typeof item === "string" ? item : item.name;
          const modified = typeof item === "string" ? null : item.modified;
          return { name, kind: "team", path: name, modified };
        });
        return { path: "", entries, atRoot: true };
      }
      const entries = (data.entries ?? []).map((entry) => ({ ...entry, path: `${team}/${entry.path}` }));
      return { path, entries, atRoot: false };
    },
    async mkdir(path, name) {
      const { team, rel } = app.splitServerPath(path);
      await mkdirServer(app.settings.serverUrl, app.identity.token(), team, rel, name);
    },
    async createProject(path, name) {
      const { team, rel } = app.splitServerPath(path);
      const created = await createProjectServer(app.settings.serverUrl, app.identity.token(), team, rel, name);
      return { path: `${team}/${created.path}`, name };
    },
    async openProject(entry) {
      const { team, rel } = app.splitServerPath(entry.path);
      await app.handleOpenWorkspace(team, rel, { reason: "file-manager-open" });
    },
    async delete(entry) {
      const { team, rel } = app.splitServerPath(entry.path);
      await deleteServer(app.settings.serverUrl, app.identity.token(), team, rel);
    },
    async exportModel(entry) {
      const { team, rel } = app.splitServerPath(entry.path);
      const data = await exportProjectServer(app.settings.serverUrl, app.identity.token(), team, rel);
      return { name: data.name ?? entry.name, project: data.project };
    },
    async importModel(destPath, name, project) {
      const { team, rel } = app.splitServerPath(destPath);
      const created = await importProjectServer(app.settings.serverUrl, app.identity.token(), team, rel, name, project);
      return { path: `${team}/${created.path}`, name: created.name };
    },
    async openAccess(entry) {
      const { team, rel } = app.splitServerPath(entry.path);
      await app.openAccessEditor(team, rel, entry.name);
    }
  };

  const opfsProvider = {
    id: "local",
    rootLabel: "This device",
    supportsAccess: false,
    supportsPublish: false,
    canCreateAt() {
      return true;
    },
    async list(path) {
      const { entries } = await listOpfsDir(path);
      return { path, entries, atRoot: path === "" };
    },
    async mkdir(path, name) {
      await mkdirOpfs(path, name);
    },
    async createProject(path, name) {
      const created = await createProjectOpfs(path, name);
      return { path: created.path, name };
    },
    async openProject(entry) {
      await app.openLocalProjectFromBrowser(entry);
    },
    async delete(entry) {
      await deleteOpfsEntry(entry.path);
    },
    async exportModel(entry) {
      const pkg = await exportProjectModelOpfs(entry.path);
      return { name: pkg.name ?? entry.name, project: pkg.project };
    },
    async importModel(destPath, name, project) {
      return importProjectModelOpfs(destPath, name, project);
    }
  };

  return { serverProvider, opfsProvider };
}
