"use strict";

// Never operates on the supplied files: all mutation is confined to a temporary
// directory under this repository. Accept only originals/copies you may inspect.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { FileLinkManager, hash } = require("../file-links");
const { analyze, transform } = require("../file-link-transform");

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const originalPath = option("--original"), legacyPath = option("--legacy");
  const version = option("--version");
  if (!originalPath || !legacyPath || !version) throw new Error("Usage: node scripts/verify-file-links-copy.cjs --original <file> --legacy <file> --version <version>");
  const original = await fs.readFile(originalPath), legacy = await fs.readFile(legacyPath);
  assert.equal(analyze(original.toString("utf8")).kind, "unpatched");
  assert.equal(analyze(legacy.toString("utf8")).kind, "legacy");
  assert.equal(transform(original.toString("utf8"), true), legacy.toString("utf8"));
  const repo = path.resolve(__dirname, "..");
  const tempRoot = path.join(repo, ".tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(tempRoot, "verify-file-links-"));
  const result = { version, originalHash: hash(original), legacyHash: hash(legacy), checks: [] };
  try {
    const extensionPath = path.join(root, "codex"), legacyRoot = path.join(root, "legacy");
    await fs.mkdir(extensionPath); await fs.mkdir(legacyRoot);
    const file = path.join(extensionPath, "entry.js");
    const extension = { extensionPath, packageJSON: { main: "entry.js", version } };
    const options = { getExtension: () => extension, storageRoot: path.join(root, "backups"), legacyRoot };
    const manager = new FileLinkManager(options);
    await fs.writeFile(file, original);
    const applied = await manager.reconcile(true);
    assert.equal(applied.state, "reload-pending", applied.reason);
    result.managedHash = hash(await fs.readFile(file));
    result.checks.push("complete original bundle: apply");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    result.checks.push("complete patched bundle: node --check");
    const stat = await fs.stat(file, { bigint: true });
    assert.equal((await manager.reconcile(true)).changed, undefined);
    assert.equal((await fs.stat(file, { bigint: true })).mtimeNs, stat.mtimeNs);
    result.checks.push("repeat apply: no write");
    assert.equal((await new FileLinkManager(options).reconcile(true)).state, "applied");
    result.checks.push("new manager activation: applied");
    assert.equal((await manager.reconcile(false)).action, "restored");
    assert.deepEqual(await fs.readFile(file), original);
    result.checks.push("restore: exact original bytes");
    const originalText = original.toString("utf8");
    const location = analyze(originalText);
    const { api, uri, rawLine, rawColumn } = location.context;
    const previousAddition = `/* codex-ui-customizer:file-links:v1 */if(${rawLine}==null&&${rawColumn}==null){try{await ${api}.commands.executeCommand("vscode.open",${uri},{preview:false});await ${api}.commands.executeCommand("revealInExplorer",${uri});return!0}catch(codexUiLinkError){await ${api}.commands.executeCommand("codexUiCustomizer.reportFileLinkError",String(codexUiLinkError)).catch(()=>{});return!1}}`;
    const previous = originalText.slice(0, location.insertion) + previousAddition + originalText.slice(location.insertion);
    assert.equal(analyze(previous).revision, 1);
    result.previousManagedHash = hash(previous);
    const recordFile = path.join(applied.backup, "manifest.json");
    const previousRecord = JSON.parse(await fs.readFile(recordFile, "utf8"));
    previousRecord.patchedHash = hash(previous);
    previousRecord.runId = "previous-activation";
    await fs.writeFile(recordFile, JSON.stringify(previousRecord));
    await fs.writeFile(file, previous);
    assert.equal((await manager.reconcile(true)).state, "reload-pending");
    assert.equal(hash(await fs.readFile(file)), result.managedHash);
    result.checks.push("complete previous managed bundle: verified v1 upgrade");
    assert.equal((await manager.reconcile(false)).action, "restored");
    assert.deepEqual(await fs.readFile(file), original);
    result.checks.push("upgraded bundle restore: exact original bytes");
    const checkedTemplate = (await fs.readFile(path.join(repo, "test", "fixtures", "managed-v2-branch.txt"), "utf8")).replace(/\r\n/g, "\n").trimEnd();
    const checkedAddition = checkedTemplate.replace(/\b(oo|v|r|n)\b/g, name => ({ oo: api, v: uri, r: rawLine, n: rawColumn })[name]);
    const checked = originalText.slice(0, location.insertion) + checkedAddition + originalText.slice(location.insertion);
    assert.equal(analyze(checked).revision, 2);
    result.previousCheckedHash = hash(checked);
    const checkedRecord = { ...previousRecord, patchedHash: hash(checked), runId: "previous-checked-activation" };
    await fs.writeFile(recordFile, JSON.stringify(checkedRecord));
    await fs.writeFile(file, checked);
    assert.equal((await manager.reconcile(true)).state, "reload-pending");
    assert.equal(hash(await fs.readFile(file)), result.managedHash);
    result.checks.push("complete checked bundle: verified v2 upgrade");
    assert.equal((await manager.reconcile(false)).action, "restored");
    assert.deepEqual(await fs.readFile(file), original);
    result.checks.push("v2 upgrade restore: exact original bytes");
    await fs.writeFile(file, legacy);
    await fs.writeFile(path.join(legacyRoot, "extension.original.js"), original);
    await fs.writeFile(path.join(legacyRoot, "extension.patched.js"), legacy);
    await fs.writeFile(path.join(legacyRoot, "manifest.json"), JSON.stringify({ extension_version: version, original_sha256: hash(original), patched_sha256: hash(legacy) }));
    assert.equal((await manager.reconcile(true)).state, "reload-pending");
    assert.equal(hash(await fs.readFile(file)), result.managedHash);
    result.checks.push("complete legacy bundle: verified migration");
    await fs.appendFile(file, "\n// external edit\n");
    const changed = await fs.readFile(file);
    assert.equal((await manager.reconcile(false)).state, "failed");
    assert.deepEqual(await fs.readFile(file), changed);
    result.checks.push("external edit: restore refused without overwrite");
    // Also leave the two supplied read-only input files unchanged.
    assert.deepEqual(await fs.readFile(originalPath), original);
    assert.deepEqual(await fs.readFile(legacyPath), legacy);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    const relative = path.relative(tempRoot, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unexpected temporary root; refusing cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
