"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { installPlainTextPaste, PlainTextPasteManager } = require("../plain-text-paste");
const { fixture } = require("./helpers/file-links");
const { loadExtension } = require("./helpers/extension-host");

function runtime() {
  const listeners = new Map(), inserted = [];
  let time = 0;
  const document = { defaultView: { navigator: { clipboard: { readText: () => new Promise(() => {}) } } }, addEventListener: (type, handler, capture) => {
    assert.equal(capture, true);
    listeners.set(type, handler);
  }, execCommand: (command, ui, text) => {
    assert.equal(command, "insertText"); assert.equal(ui, false); inserted.push(text); return true;
  } };
  const editor = { closest: () => editor };
  document.activeElement = editor;
  installPlainTextPaste(document, () => time);
  const key = overrides => {
    const event = { target: editor, key: "V", ctrlKey: true, shiftKey: true,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    listeners.get("keydown")(event);
    return event;
  };
  function paste(text = "日本語\r\n**literal**\n\nlast", overrides) {
    const event = { target: editor, clipboardData: { getData: type => { assert.equal(type, "text/plain"); return text; } },
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    listeners.get("paste")(event);
    return event;
  }
  return { listeners, editor, key, paste, inserted, document, tick: value => { time += value; } };
}

test("Ctrl+Shift+V inserts only text, preserving Unicode, literal Markdown and blank lines", () => {
  const r = runtime();
  r.key();
  const event = r.paste();
  assert.deepEqual(r.inserted, ["日本語\n**literal**\n\nlast"]);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(r.paste("ordinary").prevented, undefined);
});

test("ordinary paste, other inputs, IME, modifiers, stale shortcuts and focus changes retain native behavior", () => {
  for (const overrides of [{ shiftKey: false }, { ctrlKey: false }, { altKey: true }, { metaKey: true },
    { isComposing: true }, { defaultPrevented: true }, { key: "a" }, { target: {} }]) {
    const r = runtime(); r.key(overrides);
    assert.equal(r.paste().prevented, undefined);
    assert.equal(r.inserted.length, 0);
  }
  const r = runtime();
  assert.equal(r.paste().prevented, undefined);
  r.key(); r.tick(1501);
  assert.equal(r.paste().prevented, undefined);
  r.key(); r.listeners.get("focusout")();
  assert.equal(r.paste().prevented, undefined);
  r.key();
  assert.equal(r.paste("other input", { target: {} }).prevented, undefined);
});

test("image-only plain paste is a no-op; failed native insertion keeps native handling", () => {
  const r = runtime(); r.key();
  assert.equal(r.paste("").prevented, true);
  assert.equal(r.inserted.length, 0);
  r.document.execCommand = () => false; r.key();
  assert.equal(r.paste().prevented, undefined);
});

test("shortcut reads text directly even when VS Code never delivers a paste event", async () => {
  const r = runtime();
  let reads = 0;
  r.document.defaultView.navigator.clipboard.readText = async () => { reads++; return "日本語\r\n**plain**"; };
  const event = r.key();
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.deepEqual(r.inserted, ["日本語\n**plain**"]);
  assert.equal(r.paste("duplicate").prevented, undefined);
});

test("pending clipboard reads cannot insert after focus loss, another key or timeout", async () => {
  for (const cancel of [r => r.listeners.get("focusout")(), r => r.key({ key: "a" }), r => r.tick(1501),
    r => { r.document.activeElement = {}; }]) {
    const r = runtime();
    let resolve;
    r.document.defaultView.navigator.clipboard.readText = () => new Promise(done => { resolve = done; });
    r.key(); cancel(r); resolve("stale");
    await Promise.resolve();
    assert.deepEqual(r.inserted, []);
  }
});

test("clipboard permission rejection falls back to a sanitized native paste", async () => {
  const r = runtime();
  r.document.defaultView.navigator.clipboard.readText = async () => { throw new Error("NotAllowedError"); };
  r.document.execCommand = (command, ui, text) => {
    if (command === "paste") { assert.equal(r.paste("fallback text").prevented, true); return true; }
    assert.equal(command, "insertText"); r.inserted.push(text); return true;
  };
  r.key(); await Promise.resolve();
  assert.deepEqual(r.inserted, ["fallback text"]);
});

async function setup(t) {
  const f = await fixture(t);
  const root = f.extension.extensionPath;
  const assets = path.join(root, "webview", "assets");
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(root, "webview", "index.html"), '<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/main.css">');
  const module = path.join(assets, "index.js"), original = "globalThis.originalLoaded = true;\n";
  await fs.writeFile(module, original);
  await fs.writeFile(path.join(assets, "main.css"), "body {}\n");
  const manager = new PlainTextPasteManager({ getExtension: () => f.extension, storageRoot: path.join(root, "paste-backups") });
  return { ...f, root, module, original, manager };
}

test("module patch executes, applies once and restores the exact original", async t => {
  const f = await setup(t);
  assert.equal((await f.manager.inspect(false)).state, "unapplied");
  assert.equal((await f.manager.reconcile(true)).changed, true);
  const patched = await fs.readFile(f.module, "utf8");
  const listeners = [];
  vm.runInNewContext(patched, { document: { addEventListener: type => listeners.push(type) } });
  assert.deepEqual(listeners, ["keydown", "focusout", "paste"]);
  assert.equal((await f.manager.reconcile(true)).changed, false);
  assert.equal(await fs.readFile(f.module, "utf8"), patched);
  assert.equal((await f.manager.reconcile(false)).changed, true);
  assert.equal(await fs.readFile(f.module, "utf8"), f.original);
  assert.equal((await f.manager.reconcile(false)).changed, false);
  await f.manager.reconcile(true);
  assert.equal(await fs.readFile(f.module, "utf8"), patched);
});

test("changed modules and corrupt backups are never overwritten", async t => {
  const f = await setup(t);
  await f.manager.reconcile(true);
  await fs.appendFile(f.module, "// another customization\n");
  const changed = await fs.readFile(f.module, "utf8");
  await assert.rejects(f.manager.reconcile(false), /Unrecognized/);
  assert.equal(await fs.readFile(f.module, "utf8"), changed);
  const target = await f.manager.target();
  await fs.writeFile(target.recordFile, JSON.stringify({ file: target.file, hash: "wrong", source: f.original }));
  await assert.rejects(f.manager.reconcile(true), /Invalid.*backup/);
  assert.equal(await fs.readFile(f.module, "utf8"), changed);
});

test("unsupported and escaping script references stop before writing", async t => {
  const f = await setup(t);
  for (const html of ['<script type="module" src="../outside.js"></script>', '<script type="module" src="https://example.com/app.js"></script>',
    '<script type="module" src="./assets/index.js"></script><script type="module" src="./assets/other.js"></script>']) {
    await fs.writeFile(path.join(f.root, "webview", "index.html"), html);
    await assert.rejects(f.manager.reconcile(true), /Unsupported/);
    assert.equal(await fs.readFile(f.module, "utf8"), f.original);
  }
});

test("plain-text paste is enabled by default when the setting is absent", async t => {
  const manifest = require("../package.json");
  assert.equal(manifest.contributes.configuration.properties["codexUiCustomizer.plainTextPaste.enabled"].default, true);
  const f = await setup(t);
  const h = await loadExtension(f.root, false, { settings: { "plainTextPaste.enabled": undefined } });
  t.after(h.dispose);
  const applied = await h.commands.get("codexUiCustomizer.apply")();
  assert.equal(applied.plainTextPaste.state, "reload-pending");
  assert.notEqual(await fs.readFile(f.module, "utf8"), f.original);
});

test("Apply/Remove manage plain paste and suspension; disabled setting restores it", async t => {
  const f = await setup(t);
  const h = await loadExtension(f.root, false, { settings: { "plainTextPaste.enabled": true } });
  t.after(h.dispose);
  const applied = await h.commands.get("codexUiCustomizer.apply")();
  assert.equal(applied.plainTextPaste.state, "reload-pending");
  assert.notEqual(await fs.readFile(f.module, "utf8"), f.original);
  const inspection = await h.commands.get("codexUiCustomizer.showTarget")();
  assert.equal(inspection.plainTextPaste.state, "applied");
  assert.ok(h.lines.some(line => line.includes("Plain-text paste: applied")));
  await h.commands.get("codexUiCustomizer.remove")();
  assert.equal(await fs.readFile(f.module, "utf8"), f.original);
  await h.customizations.autoCheck();
  assert.equal(await fs.readFile(f.module, "utf8"), f.original);
  await h.commands.get("codexUiCustomizer.apply")();
  h.setSetting("plainTextPaste.enabled", false);
  await h.commands.get("codexUiCustomizer.apply")();
  assert.equal(await fs.readFile(f.module, "utf8"), f.original);
  assert.deepEqual(h.settingWrites, []);
});
