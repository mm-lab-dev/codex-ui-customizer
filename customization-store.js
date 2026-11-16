"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { setTimeout: wait } = require("node:timers/promises");

// Each physical extensions directory shares its suspension state and a lock
// covering both CSS and JavaScript. This also works across extension processes.
class CustomizationStore {
  constructor({ getExtension, directory, lockTimeoutMs = 30000, retryMs = 25 }) {
    Object.assign(this, { getExtension, directoryOverride: directory, lockTimeoutMs, retryMs });
  }

  async directory() {
    if (this.directoryOverride) return this.directoryOverride;
    const extension = this.getExtension();
    let identity = extension ? await fs.realpath(path.dirname(extension.extensionPath)) : "codex-not-installed";
    if (process.platform === "win32") identity = identity.toLowerCase();
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    return path.join(os.homedir(), ".codex", "codex-ui-customizer", "control", key);
  }

  async withLock(operation) {
    const directory = await this.directory();
    await fs.mkdir(directory, { recursive: true });
    const lockFile = path.join(directory, "operation.lock");
    const deadline = Date.now() + this.lockTimeoutMs;
    let handle;
    while (!handle) {
      try {
        handle = await fs.open(lockFile, "wx", 0o600);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) {
          throw new Error(`Another customization operation is still holding ${lockFile}. Retry after it finishes. If it crashed, confirm no operation is running before removing the stale lock.`);
        }
        await wait(this.retryMs);
      }
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      const file = path.join(directory, "state.json");
      const read = async () => {
        let source;
        try { source = await fs.readFile(file, "utf8"); } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
        const state = JSON.parse(source);
        if (state.schema !== 1 || typeof state.suspended !== "boolean") throw new Error(`Invalid customization state: ${file}`);
        return state.suspended;
      };
      const write = async suspended => {
        const temporary = path.join(directory, `state-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, JSON.stringify({ schema: 1, suspended }) + "\n", { flag: "wx", mode: 0o600 });
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      };
      return await operation({ read, write });
    } finally {
      await handle.close();
      await fs.unlink(lockFile);
    }
  }
}

module.exports = { CustomizationStore };
