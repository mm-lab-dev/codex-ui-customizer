"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { FileLinkManager, hash } = require("../file-links");
const { analyze, transform, CURRENT_REVISION } = require("../file-link-transform");
const { fixture, sourcePromise } = require("./helpers/file-links");

test("apply backs up the original; repeated events do not rewrite; reload is recognized", async t => {
  const f = await fixture(t);
  assert.equal((await f.manager.inspect()).state, "unapplied");
  const first = await f.manager.reconcile(true);
  assert.equal(first.state, "reload-pending");
  assert.equal(first.changed, true);
  const content = await fs.readFile(f.file);
  const stat = await fs.stat(f.file, { bigint: true });
  const recordFile = path.join(first.backup, "manifest.json");
  const recordStat = await fs.stat(recordFile, { bigint: true });
  assert.equal(await fs.readFile(path.join(first.backup, `${hash(f.source)}.original.js`), "utf8"), f.source);
  const repeat = await f.manager.reconcile(true);
  assert.equal(repeat.changed, undefined);
  assert.deepEqual(await fs.readFile(f.file), content);
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, stat.mtimeNs);
  assert.equal((await fs.stat(recordFile, { bigint: true })).mtimeNs, recordStat.mtimeNs);
  assert.equal((await new FileLinkManager(f.options).reconcile(true)).state, "applied");
});

test("disabling restores exactly, keeps the original backup, and does not restore repeatedly", async t => {
  const f = await fixture(t);
  const first = await f.manager.reconcile(true);
  const restored = await f.manager.reconcile(false);
  assert.equal(restored.state, "reload-pending");
  assert.equal(restored.action, "restored");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(await fs.readFile(path.join(first.backup, `${hash(f.source)}.original.js`), "utf8"), f.source);
  const stat = await fs.stat(f.file, { bigint: true });
  assert.equal((await f.manager.reconcile(false)).changed, undefined);
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, stat.mtimeNs);
  const restarted = new FileLinkManager(f.options);
  assert.equal((await restarted.reconcile(false)).state, "unapplied");
  assert.equal((await restarted.reconcile(true)).state, "reload-pending");
});

test("legacy manual patch migrates only using its hash-verified pristine original", async t => {
  const original = await sourcePromise;
  const legacy = transform(original, true);
  const f = await fixture(t, legacy);
  assert.equal((await f.manager.inspect()).kind, "legacy");
  assert.equal((await f.manager.reconcile(false)).changed, undefined);
  assert.equal((await f.manager.reconcile(true)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), legacy);
  await fs.mkdir(f.options.legacyRoot);
  await fs.writeFile(path.join(f.options.legacyRoot, "extension.original.js"), original);
  await fs.writeFile(path.join(f.options.legacyRoot, "extension.patched.js"), legacy);
  await fs.writeFile(path.join(f.options.legacyRoot, "manifest.json"), JSON.stringify({ extension_version: f.extension.packageJSON.version, original_sha256: hash(original), patched_sha256: hash(legacy) }));
  const result = await f.manager.reconcile(true);
  assert.equal(result.state, "reload-pending");
  assert.equal(analyze(await fs.readFile(f.file, "utf8")).kind, "managed");
  assert.equal(await fs.readFile(path.join(result.backup, `${hash(original)}.original.js`), "utf8"), original);
  await f.manager.reconcile(false);
  assert.equal(await fs.readFile(f.file, "utf8"), original);
});

test("unknown structures and multiple candidates remain byte-for-byte unchanged", async t => {
  for (const source of ["const unknown=true;", (await sourcePromise).replace("preview:!1", "preview:!0"), (await sourcePromise).replace("class CodexFileTarget", "class FirstTarget") + await sourcePromise]) {
    const f = await fixture(t, source);
    assert.equal((await f.manager.reconcile(true)).state, "unsupported");
    assert.equal(await fs.readFile(f.file, "utf8"), source);
    await assert.rejects(fs.access(f.options.storageRoot), { code: "ENOENT" });
  }
});

test("restoration refuses external edits and never overwrites them on re-enable", async t => {
  const f = await fixture(t);
  await f.manager.reconcile(true);
  const edited = (await fs.readFile(f.file, "utf8")) + "\n// unrelated edit\n";
  await fs.writeFile(f.file, edited);
  assert.equal((await f.manager.reconcile(false)).state, "failed");
  assert.equal((await f.manager.reconcile(true)).state, "unsupported");
  assert.equal(await fs.readFile(f.file, "utf8"), edited);
});

test("corrupt backups and active locks prevent destructive operations", async t => {
  const f = await fixture(t);
  const first = await f.manager.reconcile(true);
  const patched = await fs.readFile(f.file, "utf8");
  const backup = path.join(first.backup, `${hash(f.source)}.original.js`);
  await fs.writeFile(backup, "corrupt");
  assert.equal((await f.manager.reconcile(false)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), patched);
  await fs.writeFile(backup, f.source);
  await fs.writeFile(path.join(first.backup, "operation.lock"), "another process");
  assert.equal((await f.manager.reconcile(false)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), patched);
});

test("managed marker without its backup is never backed up as a pristine original", async t => {
  const f = await fixture(t, transform(await sourcePromise));
  assert.equal((await f.manager.reconcile(true)).state, "unsupported");
  assert.equal((await f.manager.reconcile(false)).state, "unsupported");
  await assert.rejects(fs.access(f.options.storageRoot), { code: "ENOENT" });
});

test("simulated compatible update follows new extensionPath/version; unknown update is untouched", async t => {
  const f = await fixture(t);
  const old = await f.manager.reconcile(true);
  const newRoot = path.join(f.root, "codex-next");
  await fs.mkdir(newRoot);
  const nextFile = path.join(newRoot, "entry.js");
  await fs.writeFile(nextFile, f.source.replace(/\boo\b/g, "apiRenamed"));
  f.extension.extensionPath = newRoot;
  f.extension.packageJSON = { main: "entry.js", version: "simulated-next" };
  const next = await f.manager.reconcile(true);
  assert.equal(next.state, "reload-pending");
  assert.notEqual(next.backup, old.backup);
  assert.equal(analyze(await fs.readFile(nextFile, "utf8")).kind, "managed");
  const unknownFile = path.join(newRoot, "unknown.js");
  await fs.writeFile(unknownFile, "// unknown upstream\n");
  f.extension.packageJSON = { main: "unknown.js", version: "simulated-unknown" };
  assert.equal((await f.manager.reconcile(true)).state, "unsupported");
  assert.equal(await fs.readFile(unknownFile, "utf8"), "// unknown upstream\n");
});

test("simultaneous startup/update/apply requests produce one write", async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.manager.reconcile(true)));
  assert.equal(results.filter(r => r.changed).length, 1);
  assert.equal(results.filter(r => r.state === "failed").length, 0);
  assert.equal(analyze(await fs.readFile(f.file, "utf8")).kind, "managed");
});

test("extension updates during a write are rejected by the final hash check", async t => {
  const f = await fixture(t);
  const assertUnchanged = f.manager.assertUnchanged.bind(f.manager);
  f.manager.assertUnchanged = async snapshot => {
    await fs.writeFile(f.file, "// update raced with patch\n");
    return assertUnchanged(snapshot);
  };
  assert.equal((await f.manager.reconcile(true)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), "// update raced with patch\n");
});

test("missing extension, escaping entry points and missing files produce visible failure states", async t => {
  const f = await fixture(t);
  assert.equal((await new FileLinkManager({ ...f.options, getExtension: () => undefined }).reconcile(true)).state, "failed");
  f.extension.packageJSON.main = "../escape.js";
  assert.equal((await f.manager.reconcile(true)).state, "failed");
  f.extension.packageJSON.main = "./missing.js";
  assert.equal((await f.manager.reconcile(true)).state, "failed");
});

test("recognized equivalent official handler is never changed or backed up", async t => {
  const original = await sourcePromise;
  const index = analyze(original).insertion;
  const branch = 'if(r==null&&n==null){await oo.commands.executeCommand("vscode.open",v);await oo.commands.executeCommand("revealInExplorer",v);return!0}';
  const source = original.slice(0, index) + branch + original.slice(index);
  const f = await fixture(t, source);
  assert.equal((await f.manager.reconcile(true)).state, "official");
  assert.equal((await f.manager.reconcile(false)).state, "official");
  assert.equal(await fs.readFile(f.file, "utf8"), source);
  await assert.rejects(fs.access(f.options.storageRoot), { code: "ENOENT" });
});

test("mismatched legacy evidence cannot become a managed original backup", async t => {
  const original = await sourcePromise;
  const legacy = transform(original, true);
  const f = await fixture(t, legacy);
  await fs.mkdir(f.options.legacyRoot);
  await fs.writeFile(path.join(f.options.legacyRoot, "extension.original.js"), legacy);
  await fs.writeFile(path.join(f.options.legacyRoot, "extension.patched.js"), legacy);
  await fs.writeFile(path.join(f.options.legacyRoot, "manifest.json"), JSON.stringify({ extension_version: f.extension.packageJSON.version, original_sha256: hash(legacy), patched_sha256: hash(legacy) }));
  assert.equal((await f.manager.reconcile(true)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), legacy);
  const target = await f.manager.target();
  assert.deepEqual(await fs.readdir(target.directory), []);
});

async function previousManagedFixture(t, revision = 1) {
  const f = await fixture(t);
  const position = analyze(f.source).insertion;
  // Immutable v1 handler format from the previously generated 0.3.0 package.
  const addition = revision === 2 ? (await fs.readFile(path.join(__dirname, "fixtures", "managed-v2-branch.txt"), "utf8")).trimEnd() :
    '/* codex-ui-customizer:file-links:v1 */if(r==null&&n==null){try{await oo.commands.executeCommand("vscode.open",v,{preview:false});await oo.commands.executeCommand("revealInExplorer",v);return!0}catch(codexUiLinkError){await oo.commands.executeCommand("codexUiCustomizer.reportFileLinkError",String(codexUiLinkError)).catch(()=>{});return!1}}';
  const previous = f.source.slice(0, position) + addition + f.source.slice(position);
  assert.equal(analyze(previous).revision, revision);
  const target = await f.manager.target();
  await fs.mkdir(target.directory, { recursive: true });
  const originalHash = hash(f.source);
  const backupFile = path.join(target.directory, `${originalHash}.original.js`);
  await fs.writeFile(backupFile, f.source);
  const record = { schema: 1, target: f.file, version: f.extension.packageJSON.version,
    originalHash, patchedHash: hash(previous), runId: "previous-activation" };
  await fs.writeFile(target.recordFile, JSON.stringify(record));
  await fs.writeFile(f.file, previous);
  return { ...f, target, previous, record, backupFile };
}

test("owned v1 patches upgrade using the pristine backup and restore exactly", async t => {
  const f = await previousManagedFixture(t);
  const before = await fs.stat(f.backupFile, { bigint: true });
  const applied = await f.manager.reconcile(true);
  assert.equal(applied.state, "reload-pending");
  assert.equal(analyze(await fs.readFile(f.file, "utf8")).revision, CURRENT_REVISION);
  assert.equal((await fs.stat(f.backupFile, { bigint: true })).mtimeNs, before.mtimeNs);
  assert.equal((await f.manager.reconcile(true)).changed, undefined);
  assert.equal((await f.manager.reconcile(false)).action, "restored");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
});

test("v1 patches can be restored before upgrade and applied again with the new handler", async t => {
  const f = await previousManagedFixture(t);
  assert.equal((await f.manager.reconcile(false)).action, "restored");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal((await f.manager.reconcile(true)).state, "reload-pending");
  assert.equal(analyze(await fs.readFile(f.file, "utf8")).revision, CURRENT_REVISION);
});

test("interrupted v1 upgrade metadata permits safe retry or restoration", async t => {
  for (const enabled of [true, false]) {
    const f = await previousManagedFixture(t);
    const record = { ...f.record, patchedHash: hash(transform(f.source)), previousPatchedHash: hash(f.previous) };
    await fs.writeFile(f.target.recordFile, JSON.stringify(record));
    const result = await f.manager.reconcile(enabled);
    assert.equal(result.state, "reload-pending");
    const content = await fs.readFile(f.file, "utf8");
    if (enabled) assert.equal(analyze(content).revision, CURRENT_REVISION);
    else assert.equal(content, f.source);
  }
});

test("edited v1 patches and corrupt originals cannot be upgraded", async t => {
  const edited = await previousManagedFixture(t);
  const content = edited.previous + "\n// other edit\n";
  await fs.writeFile(edited.file, content);
  assert.equal((await edited.manager.reconcile(true)).state, "unsupported");
  assert.equal(await fs.readFile(edited.file, "utf8"), content);
  const corrupt = await previousManagedFixture(t);
  await fs.writeFile(corrupt.backupFile, "corrupt");
  assert.equal((await corrupt.manager.reconcile(true)).state, "failed");
  assert.equal(await fs.readFile(corrupt.file, "utf8"), corrupt.previous);
});

test("owned v2 patches upgrade or restore, including interrupted upgrade recovery", async t => {
  for (const [enabled, interrupted] of [[true, false], [false, false], [true, true], [false, true]]) {
    const f = await previousManagedFixture(t, 2);
    if (interrupted) await fs.writeFile(f.target.recordFile, JSON.stringify({
      ...f.record, patchedHash: hash(transform(f.source)), previousPatchedHash: hash(f.previous),
    }));
    const before = await fs.stat(f.backupFile, { bigint: true });
    const result = await f.manager.reconcile(enabled);
    assert.equal(result.state, "reload-pending");
    assert.equal((await fs.stat(f.backupFile, { bigint: true })).mtimeNs, before.mtimeNs);
    if (enabled) assert.equal(analyze(await fs.readFile(f.file, "utf8")).revision, CURRENT_REVISION);
    else assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  }
});
