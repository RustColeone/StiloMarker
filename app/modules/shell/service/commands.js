// Commands: named actions any module can add, and the menus and shortcuts
// that run them. A command id is "<owner>.<action>", e.g. "workspace.save".
import { parseChord } from "../model/keys.js";

const COMMAND_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

export function createCommands(ctx) {
  const commands = ctx.registry({
    validate(entry) {
      if (!COMMAND_ID.test(entry.id)) throw new Error(`Command ids look like "owner.action": ${entry.id}`);
      const titled = (typeof entry.title === "string" && entry.title) || typeof entry.title === "function";
      if (!titled) throw new Error(`${entry.id} needs a title (text, or a function giving it)`);
      if (typeof entry.run !== "function") throw new Error(`${entry.id} needs run()`);
      for (const keys of entry.keys ?? []) parseChord(keys);
    }
  });
  const menus = ctx.registry({
    validate(entry) {
      if (typeof entry.label !== "string" || !entry.label) throw new Error(`Menu ${entry.id} needs a label`);
    }
  });

  // Runs a command by id. Resolves to false when it is unknown or turned off
  // (its enabled() says no); errors reach the caller, which reports them.
  async function run(id, ...args) {
    const command = commands.get(id);
    if (!command) {
      ctx.log(`unknown command ${id}`);
      return false;
    }
    if (command.enabled && !command.enabled()) return false;
    ctx.log(`command ${id}`);
    await command.run(...args);
    return true;
  }

  return { commands, menus, run };
}
