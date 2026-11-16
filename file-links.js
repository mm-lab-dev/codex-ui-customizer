"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { analyze, transform, CURRENT_REVISION } = require("./file-link-transform");

const hash = data => createHash("sha256").update(data).digest("hex");
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function readOptional(file) {
  try { return await fs.readFile(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(file, content, beforeRename = async () => {}, mode = 0o600) {
  const temp = `${file}.codex-ui-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, content, { flag: "wx", mode });
    await beforeRename();
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

class FileLinkManager {
  constructor({ getExtension, storageRoot = path.join(os.homedir(), ".codex", "codex-ui-customizer", "file-links"),
    legacyRoot = path.join(os.homedir(), ".codex", "fixes", "CODEX-MP4-LINK-01"), log = () => {} }) {
    Object.assign(this, { getExtension, storageRoot, legacyRoot, log });
    this.runId = randomUUID();
    this.tail = Promise.resolve();
  }

  // Serialize status reads, event-driven applies, configuration changes and restores.
  run(operation) {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }

  async target() {
    const extension = this.getExtension();
    if (!extension) throw new Error('Codex "openai.chatgpt" is not installed on this extension host. For Remote-SSH, install both extensions on the same host.');
    const main = extension.packageJSON?.main;
    if (typeof main !== "string" || !/\.(?:c?js)$/i.test(main)) throw new Error("Unsupported Codex entry point; package.json main must identify a JavaScript file.");
    const root = await fs.realpath(extension.extensionPath);
    const file = path.resolve(root, main);
    if (!within(root, file)) throw new Error("Codex entry point escapes its extension directory.");
    const realFile = await fs.realpath(file);
    if (!within(root, realFile) || !(await fs.stat(realFile)).isFile()) throw new Error("Codex entry point resolves outside its extension directory or is not a file.");
    const version = extension.packageJSON.version;
    if (typeof version !== "string" || !version) throw new Error("Codex version is missing.");
    const directory = path.join(this.storageRoot, `${version.replace(/[^\w.-]/g, "_")}-${hash(realFile).slice(0, 20)}`);
    return { file: realFile, root, version, directory, recordFile: path.join(directory, "manifest.json") };
  }

  async snapshot() {
    const target = await this.target();
    const content = await fs.readFile(target.file);
    const source = content.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(content)) throw new Error("Codex entry point is not valid UTF-8; refusing to rewrite it.");
    const digest = hash(content);
    const recordData = await readOptional(target.recordFile);
    const record = recordData ? JSON.parse(recordData.toString("utf8")) : null;
    if (record && (record.schema !== 1 || record.target !== target.file || record.version !== target.version ||
        !/^[a-f0-9]{64}$/.test(record.originalHash) || !/^[a-f0-9]{64}$/.test(record.patchedHash) ||
        (record.previousPatchedHash !== undefined && !/^[a-f0-9]{64}$/.test(record.previousPatchedHash)))) {
      throw new Error("Backup manifest is invalid or belongs to a different target.");
    }
    return { ...target, content, source, digest, record, mode: (await fs.stat(target.file)).mode, analysis: analyze(source) };
  }

  describe(snapshot, enabled) {
    const { analysis, record, digest } = snapshot;
    const base = { version: snapshot.version, file: snapshot.file, hash: digest, enabled,
      backup: record ? snapshot.directory : null, kind: analysis.kind };
    if (analysis.kind === "managed") {
      const owned = record && (record.patchedHash === digest || (analysis.revision < CURRENT_REVISION && record.previousPatchedHash === digest));
      if (!owned) return { ...base, state: "unsupported", reason: "A managed marker exists, but its backup is missing or its hash has changed. No changes made." };
      return { ...base, state: record.runId === this.runId ? "reload-pending" : "applied",
        reason: record.runId === this.runId ? "Reload Window manually to load the changed Codex entry point." : "Managed standard file-link handling is installed." };
    }
    if (analysis.kind === "legacy") return { ...base, state: "applied", reason: "Legacy manual MP4-only patch detected. It is not a pristine original; enable file links to migrate using a verified original." };
    if (analysis.kind === "official") return { ...base, state: "official", reason: analysis.reason };
    if (analysis.kind === "unsupported") return { ...base, state: "unsupported", reason: analysis.reason };
    if (record && digest !== record.originalHash) return { ...base, state: "unsupported", reason: "Entry point changed since the recorded backup. Refusing to overwrite another edit." };
    return { ...base, state: record?.restoredBy === this.runId ? "reload-pending" : "unapplied",
      reason: record?.restoredBy === this.runId ? "Original restored. Reload Window manually to unload the previous patch." : "Compatible handler detected; file-link override is not installed." };
  }

  inspect(enabled = false) {
    return this.run(() => this.safe(async () => this.describe(await this.snapshot(), enabled), enabled));
  }

  async safe(operation, enabled) {
    try {
      const status = await operation();
      this.log(`File links: ${status.state}; ${status.version ?? "unknown"}; ${status.reason}`);
      return status;
    } catch (error) {
      this.log(`File links failed: ${error.stack ?? error}`);
      return { state: "failed", enabled, reason: String(error) };
    }
  }

  async lock(target, operation) {
    await fs.mkdir(target.directory, { recursive: true });
    const lockFile = path.join(target.directory, "operation.lock");
    let handle;
    try { handle = await fs.open(lockFile, "wx"); } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Another file-link operation holds ${lockFile}. If no operation is running, inspect and remove the stale lock manually.`);
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, runId: this.runId }));
      return await operation();
    } finally {
      await handle.close();
      await fs.unlink(lockFile);
    }
  }

  async assertUnchanged(snapshot) {
    const target = await this.target();
    if (target.file !== snapshot.file || target.version !== snapshot.version ||
        hash(await fs.readFile(snapshot.file)) !== snapshot.digest) {
      throw new Error("Codex was updated or edited during the operation; refusing to overwrite it.");
    }
  }

  async legacyOriginal(snapshot) {
    const manifest = JSON.parse(await fs.readFile(path.join(this.legacyRoot, "manifest.json"), "utf8"));
    const original = await fs.readFile(path.join(this.legacyRoot, "extension.original.js"));
    const patched = await fs.readFile(path.join(this.legacyRoot, "extension.patched.js"));
    if (manifest.extension_version !== snapshot.version || manifest.original_sha256 !== hash(original) ||
        manifest.patched_sha256 !== hash(patched) || !patched.equals(snapshot.content) ||
        analyze(original.toString("utf8")).kind !== "unpatched" ||
        transform(original.toString("utf8"), true) !== snapshot.source) {
      throw new Error("Legacy MP4 patch does not match its original, hashes, version and exact transformation. Refusing migration.");
    }
    return original;
  }

  async backup(snapshot, original, patched) {
    const originalHash = hash(original);
    const backupFile = path.join(snapshot.directory, `${originalHash}.original.js`);
    try {
      await fs.writeFile(backupFile, original, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await fs.readFile(backupFile)).equals(original)) throw new Error("Existing original backup is corrupt; refusing to replace it.");
    }
    const record = { schema: 1, target: snapshot.file, version: snapshot.version,
      originalHash, patchedHash: hash(patched), appliedFromHash: snapshot.digest,
      previousPatchedHash: snapshot.analysis.kind === "managed" && snapshot.analysis.revision < CURRENT_REVISION ? snapshot.digest : undefined,
      runId: this.runId, createdAt: snapshot.record?.createdAt ?? new Date().toISOString() };
    // Write recovery metadata before modifying the target, so a crash between
    // writes still leaves a verified original and both expected hashes.
    await atomicWrite(snapshot.recordFile, JSON.stringify(record, null, 2) + "\n");
    return record;
  }

  async restoreSnapshot(snapshot) {
    if (!snapshot.record) throw new Error("No managed original backup exists. Legacy/manual changes are not restored automatically.");
    if (snapshot.digest === snapshot.record.originalHash) return this.describe(snapshot, false);
    const previous = snapshot.analysis.kind === "managed" && snapshot.analysis.revision < CURRENT_REVISION && snapshot.digest === snapshot.record.previousPatchedHash;
    if (snapshot.digest !== snapshot.record.patchedHash && !previous) throw new Error("Current hash differs from the managed patch (update or other edit). Restoration refused.");
    const original = await fs.readFile(path.join(snapshot.directory, `${snapshot.record.originalHash}.original.js`));
    if (hash(original) !== snapshot.record.originalHash || analyze(original.toString("utf8")).kind !== "unpatched") throw new Error("Original backup failed hash or structural verification.");
    const record = { ...snapshot.record, restoredBy: this.runId };
    await atomicWrite(snapshot.recordFile, JSON.stringify(record, null, 2) + "\n");
    await atomicWrite(snapshot.file, original, () => this.assertUnchanged(snapshot), snapshot.mode);
    return { ...this.describe({ ...snapshot, record, digest: hash(original), analysis: analyze(original.toString("utf8")) }, false), changed: true, action: "restored" };
  }

  reconcile(enabled) {
    return this.run(() => this.safe(async () => {
      const first = await this.snapshot();
      const status = this.describe(first, enabled);
      const needsApply = enabled && (["unpatched", "legacy"].includes(first.analysis.kind)) && status.state !== "unsupported";
      const needsUpgrade = enabled && first.analysis.kind === "managed" && first.analysis.revision < CURRENT_REVISION && status.state !== "unsupported";
      const needsRestore = !enabled && first.record && first.digest !== first.record.originalHash;
      if (!needsApply && !needsUpgrade && !needsRestore) return status;
      return this.lock(first, async () => {
        const current = await this.snapshot();
        if (current.file !== first.file || current.digest !== first.digest) throw new Error("Codex changed while acquiring the patch lock; retry the check.");
        if (needsRestore) return this.restoreSnapshot(current);
        let original = current.content;
        if (needsUpgrade) {
          original = await fs.readFile(path.join(current.directory, `${current.record.originalHash}.original.js`));
          if (hash(original) !== current.record.originalHash || analyze(original.toString("utf8")).kind !== "unpatched") throw new Error("Original backup failed verification; patch upgrade refused.");
        } else if (current.analysis.kind === "legacy") {
          original = await this.legacyOriginal(current);
        }
        const patched = Buffer.from(transform(original.toString("utf8")), "utf8");
        if (current.record && current.record.originalHash !== hash(original)) throw new Error("Existing backup manifest does not match this original; no changes made.");
        const record = await this.backup(current, original, patched);
        await atomicWrite(current.file, patched, () => this.assertUnchanged(current), current.mode);
        return { ...this.describe({ ...current, record, digest: hash(patched), analysis: analyze(patched.toString("utf8")) }, true), changed: true, action: "applied" };
      });
    }, enabled));
  }
}

module.exports = { FileLinkManager, hash };
