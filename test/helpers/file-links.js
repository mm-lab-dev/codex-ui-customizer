"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { FileLinkManager } = require("../../file-links");
const { analyze } = require("../../file-link-transform");

const sourcePromise = fs.readFile(path.join(__dirname, "..", "fixtures", "codex-file-target.txt"), "utf8");

async function fixture(t, source) {
  source ??= await sourcePromise;
  const root = await fs.mkdtemp(path.join(__dirname, "..", ".tmp-file-links-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const extensionPath = path.join(root, "codex");
  await fs.mkdir(path.join(extensionPath, "out"), { recursive: true });
  const file = path.join(extensionPath, "out", "extension.js");
  await fs.writeFile(file, source);
  const extension = { extensionPath, packageJSON: { main: "./out/extension.js", version: "26.1111.21308" } };
  const options = { getExtension: () => extension, storageRoot: path.join(root, "backups"), legacyRoot: path.join(root, "legacy") };
  return { root, file, source, extension, options, manager: new FileLinkManager(options) };
}

async function invoke(source, { file = "/tmp/日本語 ファイル.MP4", line, column, fileManager = false, failCommand, excludedExtensions = [], repeatWithExclusions = [] } = {}) {
  const info = analyze(source);
  assert.ok(info.context, info.reason);
  const names = info.context;
  const calls = [];
  let selection;
  let activeExclusions = excludedExtensions;
  const api = {
    commands: { executeCommand: async (command, uri, options) => {
      calls.push(command);
      if (command !== "codexUiCustomizer.reportFileLinkError") assert.equal(uri.path, file);
      if (command === "vscode.open") assert.equal(options.preview, false);
      if (command === failCommand) throw new Error(`Injected ${command} failure`);
    } },
    workspace: {
      getConfiguration: () => ({ get: () => activeExclusions }),
      fs: { stat: async () => ({ type: 1 }) },
      openTextDocument: async uri => { calls.push("text"); return uri; },
    },
    FileType: { Directory: 2 },
    window: { showTextDocument: async (doc, options) => { calls.push("showText"); selection = options.selection; assert.equal(options.preview, false); } },
    Position: class { constructor(line, character) { Object.assign(this, { line, character }); } },
    Range: class { constructor(start, end) { Object.assign(this, { start, end }); } },
  };
  const sandbox = { [names.api]: api, [names.fileManager]: fileManager,
    [names.line]: typeof line === "number" ? line : undefined,
    [names.column]: typeof column === "number" ? column : 1,
    [names.rawLine]: line, [names.rawColumn]: column };
  const handler = vm.runInNewContext(`(${source.slice(info.nodeStart, info.nodeEnd)})`, sandbox);
  const success = await handler({ path: file, fsPath: file, scheme: "file" });
  for (const exclusions of repeatWithExclusions) {
    activeExclusions = exclusions;
    await handler({ path: file, fsPath: file, scheme: "file" });
  }
  return { success, calls, selection };
}

module.exports = { fixture, invoke, sourcePromise };
