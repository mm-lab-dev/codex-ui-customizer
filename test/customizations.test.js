"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadExtension } = require("./helpers/extension-host");
const { fixture } = require("./helpers/file-links");
const { SUSPENDED_KEY } = require("../customization-controller");

const settle = () => new Promise(resolve => setTimeout(resolve, 80));

async function setup(t, options = {}) {
  const f = await fixture(t);
  const root = f.extension.extensionPath;
  await fs.mkdir(path.join(root, "webview", "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "webview", "index.html"), '<link rel="stylesheet" href="./assets/main.css">');
  const css = path.join(root, "webview", "assets", "main.css");
  const originalCss = "body { color: red; }\n";
  await fs.writeFile(css, originalCss);
  const h = await loadExtension(root, options.fileLinksEnabled ?? true, options);
  t.after(h.dispose);
  return { ...f, root, css, originalCss, h };
}

test("Apply and Remove control both features and never write Settings", async t => {
  const f = await setup(t);
  const h = f.h;
  const applied = await h.commands.get("codexUiCustomizer.apply")();
  assert.equal(applied.css.state, "applied");
  assert.equal(applied.fileLinks.state, "reload-pending");
  assert.notEqual(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.notEqual(await fs.readFile(f.file, "utf8"), f.source);
  const removed = await h.commands.get("codexUiCustomizer.remove")();
  assert.equal(removed.suspended, true);
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(h.settings["fileLinks.enabled"], true);
  assert.deepEqual(h.settingWrites, []);
  assert.ok(!h.commands.has("codexUiCustomizer.fileLinks.enable"));
  assert.ok(!h.commands.has("codexUiCustomizer.fileLinks.restore"));
  assert.ok(!h.commands.has("codexUiCustomizer.fileLinks.showStatus"));
});

test("Remove persists across restart, settings and extension events; only Apply resumes", async t => {
  const f = await setup(t, { settings: { autoApply: true }, delay: 10 });
  await f.h.commands.get("codexUiCustomizer.apply")();
  await f.h.commands.get("codexUiCustomizer.remove")();
  f.h.updateEvent();
  f.h.setSetting("userMessage.background", "#abcdef");
  await settle();
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(f.h.state.get(SUSPENDED_KEY), true);
  f.h.dispose();
  const restarted = await loadExtension(f.root, true, { state: f.h.state, settings: { autoApply: true }, delay: 10 });
  t.after(restarted.dispose);
  await settle();
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(restarted.notices.length, 0);
  await restarted.commands.get("codexUiCustomizer.apply")();
  assert.equal(restarted.state.get(SUSPENDED_KEY), false);
  assert.notEqual(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.notEqual(await fs.readFile(f.file, "utf8"), f.source);
  restarted.setSetting("fileLinks.enabled", false);
  await settle();
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.notEqual(await fs.readFile(f.css, "utf8"), f.originalCss);
});

test("Apply follows disabled file-link setting, restoring only that feature while applying CSS", async t => {
  const f = await setup(t);
  await f.h.commands.get("codexUiCustomizer.apply")();
  f.h.setSetting("fileLinks.enabled", false);
  const result = await f.h.commands.get("codexUiCustomizer.apply")();
  assert.equal(result.fileLinks.action, "restored");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.notEqual(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(f.h.settings["fileLinks.enabled"], false);
  assert.deepEqual(f.h.settingWrites, []);
});

test("autoApply=false keeps both features read-only until explicit Apply", async t => {
  const f = await setup(t, { delay: 10 });
  await settle();
  f.h.setSetting("userMessage.background", "#abcdef");
  f.h.updateEvent();
  await settle();
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(f.h.notices.length, 0);
  await f.h.commands.get("codexUiCustomizer.apply")();
  assert.notEqual(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.notEqual(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(f.h.settings.autoApply, false);
});

test("startup/update events apply both once and do not repeat notices after restart", async t => {
  const f = await setup(t, { settings: { autoApply: true }, delay: 10 });
  f.h.updateEvent(); f.h.updateEvent();
  await settle();
  assert.equal(f.h.notices.length, 1);
  const before = await fs.stat(f.file, { bigint: true });
  f.h.updateEvent();
  await settle();
  assert.equal(f.h.notices.length, 1);
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, before.mtimeNs);
  f.h.dispose();
  const next = await loadExtension(f.root, true, { state: f.h.state, settings: { autoApply: true }, delay: 10 });
  t.after(next.dispose);
  await settle();
  assert.equal(next.notices.length, 0);
});

test("combined status is read-only and shows both features plus suspension", async t => {
  const f = await setup(t);
  await f.h.commands.get("codexUiCustomizer.remove")();
  const before = await fs.stat(f.file, { bigint: true });
  const result = await f.h.commands.get("codexUiCustomizer.showTarget")();
  assert.equal(result.suspended, true);
  assert.equal(result.css.state, "unapplied");
  assert.ok(f.h.lines.some(line => line.includes("suspended by Remove: true")));
  assert.ok(f.h.lines.some(line => line.startsWith("CSS:")));
  assert.ok(f.h.lines.some(line => line.startsWith("File links:")));
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, before.mtimeNs);
});

test("Remove restores file links even when CSS detection fails", async t => {
  const f = await setup(t);
  await f.h.commands.get("codexUiCustomizer.apply")();
  await fs.unlink(path.join(f.root, "webview", "index.html"));
  const removed = await f.h.commands.get("codexUiCustomizer.remove")();
  assert.equal(removed.css.state, "failed");
  assert.equal(removed.fileLinks.action, "restored");
  assert.equal(removed.suspended, true);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.ok(f.h.errors.some(message => message.includes("Some operations failed")));
  const status = await f.h.commands.get("codexUiCustomizer.showTarget")();
  assert.equal(status.css.state, "failed");
  assert.equal(status.fileLinks.kind, "unpatched");
});

test("failed hash-guarded file restoration still removes CSS and stays suspended", async t => {
  const f = await setup(t, { settings: { autoApply: true }, delay: 10 });
  await f.h.commands.get("codexUiCustomizer.apply")();
  await fs.appendFile(f.file, "\n// external edit\n");
  const changed = await fs.readFile(f.file, "utf8");
  const result = await f.h.commands.get("codexUiCustomizer.remove")();
  assert.equal(result.fileLinks.state, "failed");
  assert.equal(result.suspended, true);
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), changed);
  f.h.updateEvent(); await settle();
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(await fs.readFile(f.file, "utf8"), changed);
});

test("reload is offered once per combined operation and only runs on button selection", async t => {
  const f = await setup(t, { language: "ja" });
  await f.h.commands.get("codexUiCustomizer.apply")();
  assert.equal(f.h.notices.length, 1);
  assert.deepEqual(f.h.notices[0].actions, ["ウィンドウを再読み込み"]);
  assert.deepEqual(f.h.executed, []);
  const status = await f.h.commands.get("codexUiCustomizer.showTarget")();
  assert.equal(status.reloadPending, true);
  assert.equal(f.h.notices.length, 1);
  f.h.notices[0].respond("ウィンドウを再読み込み");
  await settle();
  assert.deepEqual(f.h.executed, ["workbench.action.reloadWindow"]);
  await f.h.commands.get("codexUiCustomizer.remove")();
  f.h.notices[1].respond(undefined);
  await settle();
  assert.equal(f.h.executed.length, 1);
});

test("queued startup/apply/remove operations finish removed without a later auto reapply", async t => {
  const f = await setup(t, { settings: { autoApply: true } });
  const results = await Promise.all([
    f.h.customizations.autoCheck(), f.h.commands.get("codexUiCustomizer.apply")(),
    f.h.commands.get("codexUiCustomizer.remove")(), f.h.customizations.autoCheck(),
  ]);
  assert.equal(results.at(-1).action, "inspect");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  assert.equal(f.h.state.get(SUSPENDED_KEY), true);
});

test("removing an unchanged original does not offer a needless reload", async t => {
  const f = await setup(t);
  const before = await fs.stat(f.file, { bigint: true });
  const result = await f.h.commands.get("codexUiCustomizer.remove")();
  assert.equal(result.changed, false);
  assert.equal(result.reloadPending, false);
  assert.deepEqual(f.h.notices[0].actions, []);
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, before.mtimeNs);
});

test("a notification response after disposal cannot reload the window", async t => {
  const f = await setup(t);
  await f.h.commands.get("codexUiCustomizer.apply")();
  f.h.dispose();
  f.h.notices[0].respond("Reload Window");
  await settle();
  assert.deepEqual(f.h.executed, []);
});

test("an unchanged unsupported build does not repeat warnings when CSS write counts change or after restart", async t => {
  const f = await setup(t, { settings: { autoApply: true } });
  await fs.writeFile(f.file, "const unknown=true;\n");
  const first = await f.h.customizations.autoCheck();
  assert.equal(first.fileLinks.state, "unsupported");
  assert.equal(first.css.changed, true);
  assert.equal(f.h.notices.length, 1);
  await f.h.customizations.autoCheck();
  assert.equal(f.h.notices.length, 1);
  f.h.dispose();
  const next = await loadExtension(f.root, true, { state: f.h.state, settings: { autoApply: true }, delay: 10 });
  t.after(next.dispose);
  await settle();
  assert.equal(next.notices.length, 0);
  assert.equal(await fs.readFile(f.file, "utf8"), "const unknown=true;\n");
});

test("Remove waits for another window's in-flight apply and leaves both features restored", async t => {
  const f = await setup(t, { settings: { autoApply: true } });
  await f.h.commands.get("codexUiCustomizer.apply")();
  const other = await loadExtension(f.root, true, { settings: { autoApply: true } });
  t.after(other.dispose);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const paused = new Promise(resolve => { entered = resolve; });
  const reconcile = other.fileLinks.reconcile.bind(other.fileLinks);
  other.fileLinks.reconcile = async enabled => { entered(); await gate; return reconcile(enabled); };
  const background = other.customizations.autoCheck();
  await paused;
  let removalFinished = false;
  const removal = f.h.commands.get("codexUiCustomizer.remove")().then(result => { removalFinished = true; return result; });
  await settle();
  const finishedDuringApply = removalFinished;
  release();
  await Promise.all([background, removal]);
  assert.equal(finishedDuringApply, false);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
  // This window's memento was never updated by the other window.
  await other.customizations.autoCheck();
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.equal(await fs.readFile(f.css, "utf8"), f.originalCss);
});

test("a window with a stale local memento reads Remove's shared suspension", async t => {
  const f = await setup(t, { settings: { autoApply: true } });
  await f.h.commands.get("codexUiCustomizer.apply")();
  await f.h.commands.get("codexUiCustomizer.remove")();
  const other = await loadExtension(f.root, true, {
    state: new Map([[SUSPENDED_KEY, false]]), settings: { autoApply: true },
  });
  t.after(other.dispose);
  const checked = await other.customizations.autoCheck();
  assert.equal(checked.action, "inspect");
  assert.equal(checked.suspended, true);
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  await other.commands.get("codexUiCustomizer.apply")();
  assert.notEqual(await fs.readFile(f.file, "utf8"), f.source);
});

test("changing the exclusion setting does not rewrite an installed current handler", async t => {
  const f = await setup(t, { settings: { autoApply: true } });
  await f.h.commands.get("codexUiCustomizer.apply")();
  const before = await fs.stat(f.file, { bigint: true });
  f.h.setSetting("fileLinks.excludedExtensions", [".md", "TXT"]);
  await f.h.customizations.autoCheck();
  assert.equal((await fs.stat(f.file, { bigint: true })).mtimeNs, before.mtimeNs);
  await f.h.commands.get("codexUiCustomizer.showTarget")();
  assert.ok(f.h.lines.some(line => line.includes('Excluded extensions: [".md","TXT"]')));
  assert.deepEqual(f.h.settingWrites, []);
});
