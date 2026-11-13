"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { discoverCssTargets, getStylesheetReferences } = require("../css-targets");

async function fixture(t, html, files = {}) {
  // Keep all temporary files inside the repository, including on Windows.
  const root = await fs.mkdtemp(path.join(__dirname, ".tmp-css-targets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "webview", "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "webview", "index.html"), html);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, "webview", "assets", name), content);
  }
  return root;
}

test("finds both legacy names and hash-only names, preserving HTML order", async (t) => {
  for (const names of [
    ["app-initial-aad627bd9dff.css", "app-initial-49150e6a0951.css"],
    ["c33752c5468c.css", "bbfced09aa26.css", "49150e6a0951.css", "486da44dbe36.css", "70020a532256.css"],
  ]) {
    const html = names.map(n => `<link rel="stylesheet" crossorigin href="./assets/${n}">`).join("\n");
    const root = await fixture(t, html, Object.fromEntries([...names, "unused.css"].map(n => [n, "body {}\n"])));
    const result = await discoverCssTargets(root);
    assert.deepEqual(result.targets.map(t => t.href), names.map(n => `./assets/${n}`));
    assert.deepEqual(result.cssFiles, names.map(n => path.join(root, "webview", "assets", n)));
  }
});

test("ignores comments, script/style text, preloads, and unrelated links", () => {
  assert.deepEqual(getStylesheetReferences(`
    <!-- <link rel="stylesheet" href="comment.css"> -->
    <script>const table = ['other.css', '<link rel="stylesheet" href="script.css">'];</script>
    <style>/* <link rel="stylesheet" href="style.css"> */</style>
    <link rel="modulepreload" href="entry.js">
    <link rel="preload" as="style" href="preload.css">
    <LINK HREF='./assets/main.css?v=1&amp;b=2' REL='stylesheet' media='all' />
    <link rel=stylesheet href=./assets/second.css>
  `), ["./assets/main.css?v=1&b=2", "./assets/second.css"]);
});

test("decodes URL paths and deduplicates references", async (t) => {
  const root = await fixture(t, `
    <link rel="stylesheet" href="./assets/a%20b.css?v=1#theme">
    <link rel="stylesheet" href="./assets/a&#32;b.css">
  `, { "a b.css": "body {}" });
  assert.equal((await discoverCssTargets(root)).cssFiles.length, 1);
});

test("stops on missing HTML, missing files, directories, or no stylesheet", async (t) => {
  const root = await fixture(t, '<link rel="stylesheet" href="./assets/missing.css">');
  await assert.rejects(discoverCssTargets(root), /Cannot access stylesheet/);
  await fs.mkdir(path.join(root, "webview", "assets", "missing.css"));
  await assert.rejects(discoverCssTargets(root), /not a regular file/);
  await fs.writeFile(path.join(root, "webview", "index.html"), '<script src="entry.js"></script>');
  await assert.rejects(discoverCssTargets(root), /No explicit stylesheet/);
  await fs.unlink(path.join(root, "webview", "index.html"));
  await assert.rejects(discoverCssTargets(root), { code: "ENOENT" });
});

test("rejects external, absolute, escaping, malformed, and non-CSS references", async (t) => {
  const root = await fixture(t, "");
  for (const href of [
    "https://example.invalid/a.css", "//host/a.css", "/assets/a.css", "C:/a.css",
    "../outside.css", "./assets/%2e%2e/%2e%2e/outside.css", "assets\\a.css",
    "%2foutside.css", "%5coutside.css", "./assets/%00.css", "./assets/%.css", "./assets/entry.js",
  ]) {
    await fs.writeFile(path.join(root, "webview", "index.html"), `<link rel="stylesheet" href="${href}">`);
    await assert.rejects(discoverCssTargets(root), undefined, href);
  }
});

test("rejects symlink or junction escapes", async (t) => {
  const root = await fixture(t, '<link rel="stylesheet" href="./assets/linked/a.css">');
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "a.css"), "body {}");
  await fs.symlink(outside, path.join(root, "webview", "assets", "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(discoverCssTargets(root), /resolves outside/);
});

test("rejects unsupported base or conditional links rather than guessing", () => {
  for (const html of [
    '<base href="./other/"><link rel="stylesheet" href="a.css">',
    '<link rel="stylesheet" href="a.css" disabled>',
    '<link rel="alternate stylesheet" href="a.css">',
    '<link rel="stylesheet" href="a.css" media="print">',
    '<link rel="stylesheet">',
    '<link rel="stylesheet" href="a.css" href="b.css">',
  ]) assert.throws(() => getStylesheetReferences(html));
});

async function loadExtension(root) {
  const commands = new Map();
  const lines = [], errors = [];
  const channel = { appendLine: s => lines.push(s), clear: () => { lines.length = 0; }, show() {} };
  const vscode = {
    window: { createOutputChannel: () => channel, showInformationMessage() {}, showErrorMessage: s => errors.push(s) },
    env: {},
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => key === "autoApply" ? false : fallback }),
      onDidChangeConfiguration() {},
    },
    extensions: {
      getExtension: () => ({ id: "openai.chatgpt", extensionPath: root, packageJSON: { version: "fixture" } }),
      onDidChange() {},
    },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); } },
  };
  const sandbox = {
    require: name => name === "vscode" ? vscode : name.startsWith("./") ? require(`../${name.slice(2)}`) : require(name),
    module: { exports: {} }, setTimeout, clearTimeout,
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, "..", "extension.js"), "utf8"), sandbox);
  sandbox.module.exports.activate({ subscriptions: [] });
  return { commands, lines, errors };
}

test("Apply, repeat Apply, diagnostics, and Remove work on referenced CSS only", async (t) => {
  const original = "body { color: red; }\n";
  const root = await fixture(t, '<link rel="stylesheet" href="./assets/hash.css">', {
    "hash.css": original, "unused.css": "/* unused */",
  });
  const { commands, lines, errors } = await loadExtension(root);
  const css = path.join(root, "webview", "assets", "hash.css");
  const backup = `${css}.codex-ui-customizer.bak`;
  await commands.get("codexUiCustomizer.apply")();
  assert.equal(await fs.readFile(backup, "utf8"), original);
  const patched = await fs.readFile(css, "utf8");
  assert.match(patched, /\[data-user-message-bubble="true"\]/);
  await commands.get("codexUiCustomizer.apply")();
  assert.equal(await fs.readFile(css, "utf8"), patched);
  await commands.get("codexUiCustomizer.showTarget")();
  assert.ok(lines.some(s => s.includes("Codex version: fixture")));
  assert.ok(lines.some(s => s.includes("./assets/hash.css ->")));
  await commands.get("codexUiCustomizer.remove")();
  assert.equal(await fs.readFile(css, "utf8"), original);
  await assert.rejects(fs.access(backup), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(root, "webview", "assets", "unused.css"), "utf8"), "/* unused */");
  assert.deepEqual(errors, []);
});

test("validates all references before Apply writes, and reports failed detection", async (t) => {
  const root = await fixture(t, '<link rel="stylesheet" href="./assets/good.css"><link rel="stylesheet" href="./assets/missing.css">', {
    "good.css": "body {}",
  });
  const { commands, lines, errors } = await loadExtension(root);
  await commands.get("codexUiCustomizer.apply")();
  assert.equal(await fs.readFile(path.join(root, "webview", "assets", "good.css"), "utf8"), "body {}");
  assert.deepEqual(await fs.readdir(path.join(root, "webview", "assets")), ["good.css"]);
  await commands.get("codexUiCustomizer.showTarget")();
  assert.equal(errors.length, 2);
  assert.ok(lines.some(s => s.includes("Target detection failed:")));
});
