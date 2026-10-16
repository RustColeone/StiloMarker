// Legacy path (before the module restructure). The project model lives in the
// Workspace module; code that still imports it from here gets it through the
// module's public API. Import "../modules/workspace/index.js" in new code.
export * from "../modules/workspace/index.js";
